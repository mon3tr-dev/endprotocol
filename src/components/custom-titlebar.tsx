import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import {
  MinimizeIcon,
  MaximizeIcon,
  RestoreIcon,
  CloseIcon,
  BellIcon,
} from "@/components/ui/app-icon";
import { AppInfoDrawer } from "@/components/app-info-drawer";
import { CloseConfirmDialog } from "@/components/close-confirm-dialog";
import {
  getMessages,
  getUnreadCount,
  hasUrgentUnread,
  subscribeMessages,
  type AppMessage,
} from "@/utils/messageStore";
import { MessageCard } from "@/components/message-card";
import { getConfig } from "@/utils/configService";
import { isTrayAvailable } from "@/utils/trayService";
import {
  getLauncherMode,
  setLauncherMode,
  subscribeLauncherMode,
  type LauncherViewMode,
} from "@/stores/launcherMode";
import {
  getActiveGame,
  subscribeActiveGame,
  getGameSwitchSeq,
  getGameSwitchDirection,
  type LauncherGame,
} from "@/stores/launcherGame";
import logger from "@/utils/logger";
import { isWindowsPlatform } from "@/utils/platform";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useSwitchTransition } from "@/hooks/useSwitchTransition";

/**
 * 标题栏的**品牌区**（图标 + 游戏名 + 数据/游戏模式切换）。
 *
 * 切游戏走**整页推移**：两页同时在场，品牌区要分别显示各自的游戏名，
 * 所以它随页面一起被推走（两页各渲染一份）。
 */
export const TitlebarBrand = ({
  game,
}: {
  game?: LauncherGame;
}) => {
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<LauncherViewMode>(getLauncherMode);
  const [followedGame, setFollowedGame] = useState<LauncherGame>(getActiveGame);
  const activeGame = game ?? followedGame;
  const [gameSwitch, setGameSwitch] = useState<{
    seq: number;
    direction: 1 | -1;
  }>({ seq: getGameSwitchSeq(), direction: getGameSwitchDirection() });
  /** 标题名的推入动画（切换游戏时从另一侧滑入） */
  const titleRef = useSwitchTransition<HTMLHeadingElement>(
    gameSwitch.seq,
    gameSwitch.direction,
  );

  useEffect(() => {
    return subscribeLauncherMode(() => {
      setViewMode(getLauncherMode());
    });
  }, []);

  // 当前游戏变化 → 标题跟着换
  useEffect(() => {
    return subscribeActiveGame(() => {
      // 钉在某个游戏上时（整页推移中的一页）不跟随 store 变化，
      // 否则新页一切换，旧页的标题也跟着换，两页就显示同一个游戏名了。
      if (game) return;
      setFollowedGame(getActiveGame());
      // 记下切换序号与方向：标题名的推入动画靠它触发（并决定推入方向）。
      setGameSwitch({
        seq: getGameSwitchSeq(),
        direction: getGameSwitchDirection(),
      });
    });
  }, [game]);

  return (
    <div className="flex items-center gap-2.5">
      <img
        src="/app-icon.png"
        alt=""
        aria-hidden="true"
        draggable={false}
        className="h-[18px] w-[18px] shrink-0 select-none"
      />
      <h1
        ref={titleRef}
        className={`adaptive-contrast-text text-sm font-bold tracking-widest ${
          viewMode === "game" ? "overflow-hidden" : ""
        }`}
      >
        {viewMode === "game"
          ? t(`launcher.game_group_${activeGame}`)
          : "ENDPROTOCOL"}
      </h1>

      {isWindowsPlatform() && (
        <ToggleGroup
          type="single"
          value={viewMode}
          onValueChange={(value) => {
            if (value) setLauncherMode(value as LauncherViewMode);
          }}
          aria-label={`${t("launcher.mode_data")} / ${t("launcher.mode_game")}`}
          className={`titlebar-mode-toggle ml-2 relative grid h-7 w-[104px] grid-cols-2 rounded-full p-[3px] ${viewMode === "game" ? "is-game" : ""}`}
          data-tauri-drag-region="false"
        >
          <ToggleGroupItem
            value="data"
            className={`relative z-10 h-full w-full rounded-full px-1 text-[10px] font-medium data-[state=on]:bg-transparent data-[state=on]:text-primary-foreground ${viewMode === "data" ? "text-primary-foreground" : "adaptive-contrast-text"}`}
          >
            {t("launcher.mode_data")}
          </ToggleGroupItem>
          <ToggleGroupItem
            value="game"
            className={`relative z-10 h-full w-full rounded-full px-1 text-[10px] font-medium data-[state=on]:bg-transparent data-[state=on]:text-primary-foreground ${viewMode === "game" ? "text-primary-foreground" : "adaptive-contrast-text"}`}
          >
            {t("launcher.mode_game")}
          </ToggleGroupItem>
        </ToggleGroup>
      )}
    </div>
  );
};

/**
 * 标题栏的**右侧区**（铃铛 + 窗口控制按钮）。
 *
 * 只渲染一份 —— 整页推移时两页同场，两份会出现重复的窗口按钮。
 */
export const TitlebarControls = () => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(() => getUnreadCount());
  const [hasUrgent, setHasUrgent] = useState(() => hasUrgentUnread());
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [closeAction, setCloseAction] = useState<string>("ask");
  const [trayAvailable, setTrayAvailable] = useState(true);
  const [newMessage, setNewMessage] = useState<AppMessage | null>(null);
  const [flyoutOpen, setFlyoutOpen] = useState(true);
  const seenMessageIds = useRef(new Set(getMessages().map((m) => m.id)));
  const flyoutTimer = useRef<number | null>(null);

  useEffect(() => {
    return subscribeMessages(() => {
      const messages = getMessages();
      const latest = messages[0];
      if (latest && !seenMessageIds.current.has(latest.id)) {
        seenMessageIds.current.add(latest.id);
        setNewMessage(latest);
        setFlyoutOpen(true);
        if (flyoutTimer.current) window.clearTimeout(flyoutTimer.current);
        if (latest.progress === undefined || latest.progress < 0) {
          flyoutTimer.current = window.setTimeout(
            () => setNewMessage(null),
            5000,
          );
        }
      }
      setNewMessage((prev) => {
        if (!prev) return prev;
        return messages.find((m) => m.id === prev.id) ?? null;
      });
      setUnreadCount(getUnreadCount());
      setHasUrgent(hasUrgentUnread());
    });
  }, []);

  useEffect(
    () => () => {
      if (flyoutTimer.current) window.clearTimeout(flyoutTimer.current);
    },
    [],
  );

  // Load close action setting
  useEffect(() => {
    getConfig<string>("close_action").then((value) => {
      setCloseAction(value ?? "ask");
    });
  }, []);

  // 无系统托盘时不允许「最小化到托盘」：窗口一藏就没有任何入口，进程也退不掉。
  useEffect(() => {
    isTrayAvailable().then(setTrayAvailable);
  }, []);

  const checkMaximizedState = useCallback(async () => {
    try {
      setIsMaximized(await getCurrentWindow().isMaximized());
    } catch (error) {
      logger.error("Failed to check maximized state: " + error, "Titlebar");
    }
  }, []);

  // 窗口尺寸 / 位置变化时同步最大化状态
  useEffect(() => {
    void checkMaximizedState();
    const unlistenResize = listen("tauri://resize", async () => {
      await checkMaximizedState();
    });
    const unlistenMove = listen("tauri://move", async () => {
      await checkMaximizedState();
    });
    return () => {
      void unlistenResize.then((fn) => fn());
      void unlistenMove.then((fn) => fn());
    };
  }, [checkMaximizedState]);

  const handleMinimize = useCallback(async () => {
    try {
      await invoke("minimize_window");
    } catch (error) {
      logger.error("Failed to execute minimize action: " + error, "Titlebar");
    }
  }, []);

  const handleMaximize = useCallback(async () => {
    try {
      await invoke("toggle_maximize_window");
      setTimeout(() => void checkMaximizedState(), 100);
    } catch (error) {
      logger.error("Failed to execute maximize action: " + error, "Titlebar");
    }
  }, [checkMaximizedState]);

  const handleClose = useCallback(async () => {
    if (!trayAvailable) {
      try {
        await invoke("app_quit");
      } catch (error) {
        logger.error("Failed to execute close action: " + error, "Titlebar");
      }
      return;
    }
    if (closeAction === "ask") {
      setShowCloseConfirm(true);
    } else if (closeAction === "minimize_to_tray") {
      try {
        await invoke("minimize_to_tray");
      } catch (error) {
        logger.error("Failed to execute close action: " + error, "Titlebar");
      }
    } else {
      try {
        await invoke("app_quit");
      } catch (error) {
        logger.error("Failed to execute close action: " + error, "Titlebar");
      }
    }
  }, [closeAction, trayAvailable]);

  const handleConfirmClose = useCallback(
    async (action: "close" | "minimize_to_tray") => {
      try {
        if (action === "minimize_to_tray" && trayAvailable) {
          await invoke("minimize_to_tray");
        } else {
          await invoke("app_quit");
        }
        const newAction = await getConfig<string>("close_action");
        if (newAction) {
          setCloseAction(newAction);
        }
      } catch (error) {
        logger.error("Failed to execute close action: " + error, "Titlebar");
      }
    },
    [trayAvailable],
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setInfoOpen(true)}
        aria-label="Messages"
        className="relative flex h-7 w-7 items-center justify-center rounded-lg text-muted [transition:transform_var(--lg-dur-press)_var(--lg-ease-spring),translate_var(--lg-dur-press)_var(--lg-ease-spring),scale_var(--lg-dur-press)_var(--lg-ease-spring),background-color_var(--lg-dur-fast)_var(--lg-ease-standard),color_var(--lg-dur-fast)_var(--lg-ease-standard)] lg-hoverable hover:text-foreground active:scale-90 cursor-pointer mr-2"
        data-tauri-drag-region="false"
      >
        <BellIcon size={14} />
        {unreadCount > 0 && (
          <span
            className={`absolute -top-0.5 -right-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full px-0.5 text-[8px] font-bold leading-none text-primary-foreground ${hasUrgent ? "bg-danger" : "bg-primary"}`}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {newMessage && flyoutOpen &&
        createPortal(
          <div
            className="lg-regular lg-float-in fixed right-12 top-10 z-[10005] w-[340px] max-w-[calc(100vw-2rem)] rounded-xl p-1"
            data-tauri-drag-region="false"
          >
            <MessageCard
              msg={newMessage}
              compact
              onOpen={() => {
                setFlyoutOpen(false);
                setInfoOpen(true);
              }}
            />
          </div>,
          document.body,
        )}

      <div
        className="flex items-center rounded-xl overflow-hidden lg-regular border border-separator/60"
        data-tauri-drag-region="false"
      >
        <button
          type="button"
          onClick={handleMinimize}
          aria-label="Minimize"
          className="flex h-7 w-8 items-center justify-center rounded-l-xl text-muted [transition:transform_var(--lg-dur-press)_var(--lg-ease-spring),translate_var(--lg-dur-press)_var(--lg-ease-spring),scale_var(--lg-dur-press)_var(--lg-ease-spring),background-color_var(--lg-dur-fast)_var(--lg-ease-standard),color_var(--lg-dur-fast)_var(--lg-ease-standard)] lg-hoverable hover:text-foreground active:scale-95 cursor-pointer"
        >
          <MinimizeIcon size={14} />
        </button>

        <button
          type="button"
          onClick={handleMaximize}
          aria-label={isMaximized ? "Restore" : "Maximize"}
          className="flex h-7 w-8 items-center justify-center text-muted [transition:transform_var(--lg-dur-press)_var(--lg-ease-spring),translate_var(--lg-dur-press)_var(--lg-ease-spring),scale_var(--lg-dur-press)_var(--lg-ease-spring),background-color_var(--lg-dur-fast)_var(--lg-ease-standard),color_var(--lg-dur-fast)_var(--lg-ease-standard)] lg-hoverable hover:text-foreground active:scale-95 cursor-pointer"
        >
          {isMaximized ? <RestoreIcon size={14} /> : <MaximizeIcon size={14} />}
        </button>

        <button
          type="button"
          onClick={handleClose}
          aria-label="Close"
          className="flex h-7 w-8 items-center justify-center rounded-r-xl text-muted [transition:transform_var(--lg-dur-press)_var(--lg-ease-spring),translate_var(--lg-dur-press)_var(--lg-ease-spring),scale_var(--lg-dur-press)_var(--lg-ease-spring),background-color_var(--lg-dur-fast)_var(--lg-ease-standard),color_var(--lg-dur-fast)_var(--lg-ease-standard)] hover:bg-danger/20 hover:text-danger-text active:scale-95 cursor-pointer"
        >
          <CloseIcon size={14} />
        </button>
      </div>

      <AppInfoDrawer isOpen={infoOpen} onClose={() => setInfoOpen(false)} />
      <CloseConfirmDialog
        isOpen={showCloseConfirm}
        onOpenChange={setShowCloseConfirm}
        onConfirm={handleConfirmClose}
        allowMinimize={trayAvailable}
      />
    </>
  );
};

export interface CustomTitlebarProps {
  /**
   * 标题栏要显示哪个游戏的名字。
   *
   * 切游戏走**整页推移**：旧页与新页同时在画面上，标题要分别显示各自的
   * 游戏名 —— 所以这里允许把标题栏「钉」在某个游戏上。
   * 不传时跟随全局 store（普通用法）。
   */
  game?: LauncherGame;
  /**
   * 是否只渲染**品牌区**（图标 + 游戏名 + 数据/游戏模式切换）。
   *
   * 整页推移时用：品牌区随页面一起移动（两页各一份），而右侧的铃铛与
   * **窗口控制按钮只渲染一份** —— 两份会出现重复的窗口按钮。
   */
  brandOnly?: boolean;
  /**
   * 是否只渲染**右侧区**（铃铛 + 窗口控制按钮）。
   *
   * 与 `brandOnly` 互补：整页推移时，品牌区随页面走（两页各一份），
   * 而右侧区固定在右上角（只一份）—— 两份窗口按钮会重复。
   */
  controlsOnly?: boolean;
  /** 外层容器的 class（页面层里用来定位） */
  className?: string;
}

/**
 * 窗口标题栏。
 *
 * 由两块组成：
 *  - `TitlebarBrand` —— 品牌区（图标 + 游戏名 + 模式切换）。整页推移时它
 *    随页面一起被推走，所以两页各渲染一份（`brandOnly`）。
 *  - `TitlebarControls` —— 铃铛与窗口控制按钮。**只渲染一份**：
 *    整页推移时两页同场，两份会出现重复的窗口按钮（`controlsOnly`）。
 *
 * 数据模式（`viewMode === "data"`）没有页面推移，整条一起渲染即可。
 */
export const CustomTitlebar = ({
  game,
  brandOnly = false,
  controlsOnly = false,
  className,
}: CustomTitlebarProps = {}) => {
  return (
    <div className={`titlebar-shell relative h-11 ${className ?? ""}`}>
      {/*
       * 窗口拖拽用 Tauri 的 `data-tauri-drag-region`（"deep" = 子树空白处都能拖）。
       * 不要用 `-webkit-app-region`：它在 WebKitGTK 上不生效（wry 自己的
       * examples/custom_titlebar.rs 也注明 app-region 只在 Windows WebView2 123+ 受支持），
       * 而 Linux 发行版走的正是 WebKitGTK，所以那两个 drag 区在 Linux 上完全没反应。
       * 按钮等可点击元素由 Tauri 的 drag.js 自动排除，无需再逐个标 no-drag。
       */}
      <div
        className="relative flex h-full items-center pl-5 pr-2"
        data-tauri-drag-region="deep"
      >
        {controlsOnly ? null : <TitlebarBrand game={game} />}

        <div className="flex-1" data-tauri-drag-region="deep" />
        {brandOnly ? null : <TitlebarControls />}
      </div>
    </div>
  );
};
