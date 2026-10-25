import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
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
import {
  getLauncherMode,
  setLauncherMode,
  subscribeLauncherMode,
  type LauncherViewMode,
} from "@/stores/launcherMode";
import logger from "@/utils/logger";
import { isWindowsPlatform } from "@/utils/platform";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export const CustomTitlebar = () => {
  const { t } = useTranslation();
  const [isMaximized, setIsMaximized] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(() => getUnreadCount());
  const [hasUrgent, setHasUrgent] = useState(() => hasUrgentUnread());
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [closeAction, setCloseAction] = useState<string>("ask");
  const [viewMode, setViewMode] = useState<LauncherViewMode>(getLauncherMode);
  const supportsLauncher = isWindowsPlatform();
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
      setNewMessage((prev) =>
        prev && !messages.some((m) => m.id === prev.id) ? null : prev,
      );
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

  useEffect(() => {
    return subscribeLauncherMode(() => {
      setViewMode(getLauncherMode());
    });
  }, []);

  // Load close action setting
  useEffect(() => {
    getConfig<string>("close_action").then((value) => {
      setCloseAction(value ?? "ask");
    });
  }, []);

  const checkMaximizedState = async () => {
    try {
      const win = getCurrentWindow();
      const maximized = await win.isMaximized();
      setIsMaximized(maximized);
    } catch (error) {
      logger.error("Failed to check maximized state: " + error, "Titlebar");
    }
  };

  useEffect(() => {
    let unlistenResize: UnlistenFn | null = null;
    let unlistenMove: UnlistenFn | null = null;

    checkMaximizedState();

    listen("tauri://resize", async () => {
      await checkMaximizedState();
    }).then((u) => (unlistenResize = u));

    listen("tauri://move", async () => {
      await checkMaximizedState();
    }).then((u) => (unlistenMove = u));

    return () => {
      unlistenResize?.();
      unlistenMove?.();
    };
  }, []);

  const handleMinimize = async () => {
    try {
      await invoke("minimize_window");
    } catch (error) {
      logger.error("Failed to minimize window: " + error, "Titlebar");
    }
  };

  const handleMaximize = async () => {
    try {
      await invoke("toggle_maximize_window");
      window.setTimeout(checkMaximizedState, 100);
    } catch (error) {
      logger.error("Failed to toggle maximize: " + error, "Titlebar");
    }
  };

  const handleClose = async () => {
    try {
      if (closeAction === "ask") {
        setShowCloseConfirm(true);
      } else if (closeAction === "minimize_to_tray") {
        await invoke("minimize_to_tray");
      } else {
        await invoke("app_quit");
      }
    } catch (error) {
      logger.error("Failed to close window: " + error, "Titlebar");
    }
  };

  const handleConfirmClose = async (action: "close" | "minimize_to_tray") => {
    try {
      if (action === "minimize_to_tray") {
        await invoke("minimize_to_tray");
      } else {
        await invoke("app_quit");
      }
      // Update local state if user chose to remember
      const newAction = await getConfig<string>("close_action");
      if (newAction) {
        setCloseAction(newAction);
      }
    } catch (error) {
      logger.error("Failed to execute close action: " + error, "Titlebar");
    }
  };

  return (
    <>
      <div className="titlebar-shell relative h-11">
        <div
          className="relative flex h-full items-center pl-5 pr-2"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        >
          <div
            className="flex items-center gap-2.5"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            <div className="w-2 h-2 rounded-full bg-primary/60" />
            <h1 className="adaptive-contrast-text text-sm font-bold tracking-widest">
              {viewMode === "game" ? t("launcher.game_title") : "ENDPROTOCOL"}
            </h1>
          </div>

          {supportsLauncher && (
            <ToggleGroup
              type="single"
              value={viewMode}
              onValueChange={(value) => {
                if (value) setLauncherMode(value as LauncherViewMode);
              }}
              aria-label={`${t("launcher.mode_data")} / ${t("launcher.mode_game")}`}
              className={`titlebar-mode-toggle ml-2 relative grid h-7 w-[104px] grid-cols-2 overflow-hidden rounded-full border-white/20 bg-default-100/55 p-0.5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.2)] ${viewMode === "game" ? "is-game" : ""}`}
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
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

          <div
            className="flex-1"
            style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
          />

          <button
            type="button"
            onClick={() => setInfoOpen(true)}
            aria-label="Messages"
            className="relative flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-all duration-200 hover:bg-white/10 hover:text-foreground hover:scale-110 active:scale-90 cursor-pointer mr-2"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
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
                className="fixed right-12 top-10 z-[10005] w-[340px] max-w-[calc(100vw-2rem)] rounded-xl glass-surface-strong p-1 shadow-xl animate-fade-in"
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
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
            className={`flex items-center rounded-xl overflow-hidden ${
              viewMode === "game"
                ? "bg-black/40 backdrop-blur-md border border-white/10"
                : "glass-surface border border-separator/60"
            }`}
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            <button
              type="button"
              onClick={handleMinimize}
              aria-label="Minimize"
              className="flex h-7 w-8 items-center justify-center rounded-l-xl text-muted transition-all duration-200 hover:bg-white/10 hover:text-foreground hover:scale-105 active:scale-95 cursor-pointer"
            >
              <MinimizeIcon size={14} />
            </button>

            <button
              type="button"
              onClick={handleMaximize}
              aria-label={isMaximized ? "Restore" : "Maximize"}
              className="flex h-7 w-8 items-center justify-center text-muted transition-all duration-200 hover:bg-white/10 hover:text-foreground hover:scale-105 active:scale-95 cursor-pointer"
            >
              {isMaximized ? (
                <RestoreIcon size={14} />
              ) : (
                <MaximizeIcon size={14} />
              )}
            </button>

            <button
              type="button"
              onClick={handleClose}
              aria-label="Close"
              className="flex h-7 w-8 items-center justify-center rounded-r-xl text-muted transition-all duration-200 hover:bg-danger/20 hover:text-danger hover:scale-105 active:scale-95 cursor-pointer"
            >
              <CloseIcon size={14} />
            </button>
          </div>
        </div>
      </div>

      <AppInfoDrawer isOpen={infoOpen} onClose={() => setInfoOpen(false)} />
      <CloseConfirmDialog
        isOpen={showCloseConfirm}
        onOpenChange={setShowCloseConfirm}
        onConfirm={handleConfirmClose}
      />
    </>
  );
};
