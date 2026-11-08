import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from "react";
import { useLocation } from "react-router-dom";
import clsx from "clsx";
import { CustomTitlebar } from "@/components/custom-titlebar";
import { Sidebar } from "@/components/dashboard-sidebar";
import { GlassProgressCircle } from "@/components/ui/glass";
import { getConfig, setConfig } from "@/utils/configService";
import {
  getLauncherMode,
  subscribeLauncherMode,
  setLauncherBgMedia,
  getGameBgMode,
  setGameBgMode,
  subscribeGameBgMode,
  type LauncherBgMedia,
  type GameBgMode,
} from "@/stores/launcherMode";
import {
  suspendInAppBrowser,
  resumeInAppBrowser,
} from "@/stores/inAppBrowser";
import { InAppBrowser } from "@/components/in-app-browser";
import { GameSwitchRail } from "@/components/game-switch-rail";
import { useTranslation } from "react-i18next";
import { MorphIcon } from "morphicons/react";
import { Image as ImageIcon, Video } from "lucide";
import {
  type GameChannel,
  CHANNEL_GAME,
  readGameChannel,
} from "@/utils/launcherService";
import {
  getActiveGame,
  subscribeActiveGame,
  getGameSwitchDirection,
  type LauncherGame,
} from "@/stores/launcherGame";
import {
  GamePageContent,
  EMPTY_PAGE_DATA,
  fetchPageData,
  getCachedPageData,
  prefetchOtherGame,
  type GamePageData,
} from "@/components/game-page";

/** 旧键名：仅用于把历史选择迁移到按游戏分区的键上（见下方 channel effect）。 */

interface DashboardLayoutProps {
  children: React.ReactNode;
}

/**
 * 推移中的页面状态。
 *
 * `direction` 与 `stores/launcherGame` 的一致：`1` = 往下切（终末地 → 明日方舟），
 * `-1` = 往上切。`progress` 是动画进度（0 = 起始，1 = 结束）。
 */
interface PushState {
  from: LauncherGame;
  to: LauncherGame;
  direction: 1 | -1;
  progress: number;
}

/** 渲染中的一个页面层 */
interface PageLayer {
  game: LauncherGame;
  /** 垂直位移（CSS transform 值） */
  offset: string;
  /** 是否是正在进入的新页（层级更高） */
  enter: boolean;
  data: GamePageData;
  /** 该页的背景资源（原始形态，交给背景模式切换器用） */
  background: LauncherBgMedia | null;
  /** 按当前背景模式解析出来的实际要显示的资源 */
  backgroundSrc: { src: string; showVideo: boolean } | null;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [viewMode, setViewMode] = useState(getLauncherMode);
  const [bgMediaMode, setBgMediaMode] = useState<GameBgMode>(getGameBgMode);
  // 公告 / 背景图 / 横幅都跟着"当前游戏"走：切换游戏后重新拉该游戏的内容。
  const [activeGame, setActiveGame] = useState(getActiveGame);
  /**
   * 当前游戏的 ref 镜像。
   *
   * 切游戏的订阅 effect **只订阅一次**（依赖数组为空），靠这个 ref 记住
   * 「切换前是哪个游戏」——用 state 的话每次切换都会重订阅 store，
   * 时序上会漏掉事件。
   */
  const activeGameRef = useRef(activeGame);
  const [channel, setChannel] = useState<GameChannel>(() =>
    readGameChannel(getActiveGame()),
  );

  // ========== 游戏切换：整页推移 ==========
  //
  // 往下切（《终末地》→《明日方舟》）：新页从下方进入，把旧页往上方推出视口。
  // 往上切则相反：新页从上方进入，把旧页往下方推出。
  //
  // 两页同时在场，所以每一页都得带自己的数据（背景/横幅/公告/侧边栏）。
  // 数据提前拉好（见 game-page.tsx 的预取），否则新页推上来是空白。

  /** 推移期间显示的页面层（出栈页 + 入栈页）；非推移期间只有当前页 */
  const [push, setPush] = useState<PushState | null>(null);
  /** 推移动画的实时进度（0 = 起始，1 = 结束），用 rAF 驱动 */
  const pushProgressRef = useRef(0);
  const pushRafRef = useRef<number | null>(null);
  /** 推移进度变化时更新 state（节流到每帧一次） */
  const [pushProgress, setPushProgress] = useState(0);

  // 推移动画：出栈页与入栈页各自沿 Y 轴移动一整屏。
  //
  // 用 rAF 驱动而不是 CSS transition —— 因为两页的位置都由同一个进度算出来，
  // CSS 要写两套 keyframes 且难以保证严格同步（一边先到、一边后到就穿帮了）。
  //
  // 进度用 `--lg-ease-emphasized` 的曲线（起步爆发、收尾长），位移一整屏。
  const runPush = useCallback(
    (from: LauncherGame, to: LauncherGame, direction: 1 | -1) => {
      if (pushRafRef.current) cancelAnimationFrame(pushRafRef.current);

      const duration = 460;
      const start = performance.now();
      // 缓动与 globals.css 的 --lg-ease-emphasized 一致（cubic-bezier(0.16,1,0.3,1)）
      const ease = (t: number) => 1 - Math.pow(1 - t, 3);

      setPush({
        from,
        to,
        direction,
        progress: 0,
      });
      pushProgressRef.current = 0;

      const step = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = ease(t);
        pushProgressRef.current = eased;
        setPushProgress(eased);
        if (t < 1) {
          pushRafRef.current = requestAnimationFrame(step);
        } else {
          pushRafRef.current = null;
          // 推移结束：只留新页
          setPush(null);
          setPushProgress(0);
        }
      };
      pushRafRef.current = requestAnimationFrame(step);
    },
    [],
  );

  // 卸载时停掉动画帧
  useEffect(
    () => () => {
      if (pushRafRef.current) cancelAnimationFrame(pushRafRef.current);
    },
    [],
  );

  useEffect(() => {
    return subscribeLauncherMode(() => {
      setViewMode(getLauncherMode());
    });
  }, []);

  const prevModeRef = useRef(viewMode);
  useEffect(() => {
    const prev = prevModeRef.current;
    if (prev === "game" && viewMode === "data") {
      suspendInAppBrowser();
    } else if (prev === "data" && viewMode === "game") {
      resumeInAppBrowser();
    }
    prevModeRef.current = viewMode;
  }, [viewMode]);

  useEffect(() => {
    return subscribeGameBgMode(() => {
      setBgMediaMode(getGameBgMode());
    });
  }, []);

  // 切换游戏时，把 dashboard 的渠道与背景/公告一起换到该游戏。
  //
  // effect **只订阅一次**（依赖数组为空）：当前游戏用 ref 记录。
  // 若把 `activeGame` 放进依赖，每次切换都会退订并重新订阅 store ——
  // 而 `setActiveGame(next)` 触发的正是这次重订阅，时序上会漏掉事件，
  // 表现为「切回去时没有推移动画」。
  useEffect(() => {
    return subscribeActiveGame(() => {
      const next = getActiveGame();
      const prev = activeGameRef.current;
      if (prev === next) return;
      activeGameRef.current = next;
      setActiveGame(next);
      setChannel(readGameChannel(next));

      const direction = getGameSwitchDirection();

      // 整页推移：旧页往 direction 的反方向退出，新页从 direction 方向进来。
      //
      // 先确保新页的数据在手（没有数据的话新页推上来是空白）：
      // 缓存里有就直接推，没有就等拉完再推 —— 等的时候旧页还留在原地，
      // 用户看到的是「新页从下面推上来」，而不是「旧页没了、新页空白」。
      const cached = getCachedPageData(next);
      if (cached) {
        runPush(prev, next, direction);
      } else {
        void fetchPageData(next).then(() => {
          runPush(prev, next, direction);
        });
      }
    });
  }, [runPush]);

  // 预取另一个游戏的数据：第一次切过去时不用等网络，推移动画立刻就能播。
  useEffect(() => {
    prefetchOtherGame(activeGame);
  }, [activeGame]);

  // 初次进入（F5 刷新 / 应用启动）：页面数据缓存是模块级 Map，刷新后为空，
  // 而上面的预取只拉「另一个游戏」——当前游戏没人拉，背景与公告就一直空着
  // （切一次游戏触发订阅里的 fetch 才恢复）。挂载时补拉当前游戏，完成后
  // bump 版本号让页面层（pages useMemo）重算出有数据的页。
  const [pageDataVersion, setPageDataVersion] = useState(0);
  useEffect(() => {
    if (getCachedPageData(activeGame)) return;
    void fetchPageData(activeGame).then(() => {
      setPageDataVersion((v) => v + 1);
    });
  }, [activeGame, pageDataVersion]);

  // 渠道变化（切游戏 / 换服）时，若跨了游戏，把游戏选择也跟上。
  useEffect(() => {
    const owner = CHANNEL_GAME[channel];
    if (owner && owner !== activeGame) {
      setActiveGame(owner);
    }
  }, [channel, activeGame]);

  // Restore persisted sidebar collapse state
  useEffect(() => {
    getConfig<boolean>("sidebar_rail_collapsed").then((value) => {
      if (typeof value === "boolean") setSidebarCollapsed(value);
    });
  }, []);

  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      void setConfig("sidebar_rail_collapsed", next);
      return next;
    });
  };


  // Cleanup on unmount
  useEffect(() => {
    return () => {
      setLauncherBgMedia(null);
    };
  }, []);

  const isGameMode = viewMode === "game";

  // ========== 页面层（整页推移用） ==========
  //
  // 推移期间要同时渲染两页：出栈页（旧游戏）与入栈页（新游戏）。
  // 每页的背景来自它自己的数据，所以两页的画面互不干扰。
  const pages = useMemo<PageLayer[]>(() => {
    const makePage = (
      game: LauncherGame,
      offset: string,
      enter: boolean,
    ): PageLayer => {
      const media = getCachedPageData(game)?.background ?? null;
      const videoSrc =
        media && bgMediaMode === "video" ? media.video_url : null;
      const src =
        typeof videoSrc === "string" && videoSrc.length > 0
          ? videoSrc
          : (media?.image_url ?? media?.video_url ?? null);
      return {
        game,
        offset,
        enter,
        data: getCachedPageData(game) ?? EMPTY_PAGE_DATA,
        background: media,
        backgroundSrc:
          typeof src === "string" && src.length > 0
            ? { src, showVideo: src === videoSrc }
            : null,
      };
    };

    if (push) {
      const { from, to, direction } = push;
      // 往下切（direction = 1）：新页从下方进来，旧页往上方走
      // 往上切（direction = -1）：新页从上方进来，旧页往下方走
      //
      // 位移用 `vh` 而不是 `%`：`%` 的基准是元素自身高度，而页面层是
      // `absolute inset-0`（高度跟随父容器）。父容器一旦因为内容塌陷或
      // 布局异常而比视口矮，推移距离就会跟着缩水 —— 动画变成"抖一下"。
      // `vh` 直接以视口为基准，与实际观感一致。
      const enterOffset = direction * 100;
      const exitOffset = -direction * 100;
      return [
        makePage(from, `translateY(${exitOffset * pushProgress}vh)`, false),
        makePage(to, `translateY(${enterOffset * (1 - pushProgress)}vh)`, true),
      ];
    }

    return [makePage(activeGame, "translateY(0vh)", true)];
    // `pageDataVersion`：初次拉到页面数据后 bump，让这里重算出带背景/公告的页
    // （缓存此时是模块级 Map，读取不进依赖，必须有这个版本号触发）。
  }, [push, pushProgress, activeGame, bgMediaMode, pageDataVersion]);

  // ========== GAME MODE ==========
  if (isGameMode) {
    return (
      <div className="relative flex flex-col h-screen">
        {/*
         * 标题栏拆成两半：
         *  - **品牌区**（图标 + 游戏名 + 数据/游戏模式切换）在页面层里，两页各一份，
         *    跟着页面一起被推走；
         *  - **右侧区**（铃铛 + 窗口控制按钮）只渲染一份，放在页面层之外 ——
         *    两份会出现重复的窗口按钮。
         *
         * 右侧区这一份是固定不动的：它不跟页面走，推移时始终停在右上角。
         */}
        <div className="absolute inset-0 z-20 flex flex-col pointer-events-none">
          {/* 只占右侧控件自身宽度：整宽覆盖层会带着 drag region 盖住页面层里的
              品牌区（数据/游戏模式拨杆），点拨杆全被这层劫持成拖拽。 */}
          <div className="pointer-events-auto self-end">
            <CustomTitlebar
              brandOnly={false}
              className="relative z-10"
              controlsOnly
            />
          </div>
        </div>

        {/*
         * 整页推移：切换游戏时**两页同时在场**。
         *
         * 往下切（《明日方舟》）：新页从下方进入，把旧页往上方推出视口；
         * 往上切（《终末地》）：新页从上方进入，把旧页往下方推出视口。
         *
         * 所以这里渲染的是「页面层」而不是「当前页」——
         * `pages` 里是推移期间要显示的两页（出栈页 + 入栈页），
         * 各自带着自己的背景、横幅、公告与操作面板。
         */}
        {pages.map((page) => (
          <div
            key={page.game}
            className="absolute inset-0 flex flex-col"
            style={{
              // 出栈页推出去、入栈页推进来；两者都用整屏位移，不做淡入
              // （淡入会让玻璃宿主变成 backdrop root，玻璃当场失效）。
              transform: page.offset,
              willChange: "transform",
              zIndex: page.enter ? 1 : 0,
            }}
          >
            {/* Full-bleed background */}
            <div className="fixed inset-0 z-0">
              {page.backgroundSrc ? (
                <>
                  {page.backgroundSrc.showVideo ? (
                    <video
                      src={page.backgroundSrc.src}
                      autoPlay
                      loop
                      muted
                      playsInline
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    // 图片背景规则（等价 CSS object-fit/background-size: cover）：
                    // 保持原始宽高比，取 max(W/w, H/h) 等比缩放，使缩放后的宽和高都
                    // ≥ 容器，从而完全覆盖、不留空白；溢出的一边（长边方向）居中裁掉。
                    <div
                      role="img"
                      aria-label="Background"
                      className="w-full h-full"
                      style={{
                        backgroundImage: `url("${page.backgroundSrc.src}")`,
                        backgroundRepeat: "no-repeat",
                        backgroundPosition: "center",
                        backgroundSize: "cover",
                      }}
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-background/50 via-transparent to-background/10" />
                </>
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-primary/10 via-background to-background" />
              )}
            </div>

            {/* 标题栏品牌区：随页面一起被推走 */}
            <CustomTitlebar game={page.game} brandOnly className="relative z-10" />

            {/* Background mode switch — floats in near the top center */}
            {page.background && (
              <GameBackgroundSwitch mode={bgMediaMode} media={page.background} />
            )}

            {/* In-app browser overlay — 全屏覆盖（含标题栏），自带窗口控制 */}
            <InAppBrowser />

            {/* 左侧游戏切换：贴左边缘，鼠标靠近才展开（终末地 / 明日方舟） */}
            <GameSwitchRail />

            {/* 页面内容：右侧社媒栏 + 底部横幅公告 + 操作面板 */}
            <GamePageContent game={page.game} data={page.data} />
          </div>
        ))}
      </div>
    );
  }

  // ========== DATA MODE ==========
  return (
    <div className="relative flex flex-col h-screen">
      <div className="dashboard-background" aria-hidden="true" />
      {/*
       * 渐变磨砂层：单个全屏覆盖层，遮罩用纵向（标题栏）+ 横向（侧边栏）
       * 两层渐变取并集，合成连通的 L 形强区——两块磨砂连成一片，
       * 左上角没有断裂。backdrop-filter 只采样它下方已绘制的内容，
       * 因此页面内容不受影响；mask 只控制这层自身的合成强度，不产生底色。
       */}
      <div
        className="frost-main frost-with-sidebar"
        style={
          {
            "--frost-sidebar-w": sidebarCollapsed ? "64px" : "288px",
          } as React.CSSProperties
        }
        aria-hidden="true"
      />
      <div className="dashboard-veil" aria-hidden="true" />

      <CustomTitlebar />

      <div className="relative z-10 flex flex-1 overflow-hidden">
        {/* Desktop Sidebar */}
        <div
          className={clsx(
            "relative hidden lg:flex shrink-0 overflow-hidden transition-[width] duration-300 ease-out will-change-[width]",
            sidebarCollapsed ? "w-[64px]" : "w-72",
          )}
        >
          <Sidebar
            collapsed={sidebarCollapsed}
            onToggleCollapsed={toggleSidebarCollapsed}
          />
        </div>

        {/* Mobile Drawer */}
        {mobileOpen && (
          <>
            <div
              className="lg-scrim lg:hidden fixed inset-0 z-40 [animation:lg-backdrop-in_var(--lg-dur-base)_var(--lg-ease-emphasized)]"
              onClick={() => setMobileOpen(false)}
              aria-label="Close sidebar"
              role="button"
            />
            <div className="lg:hidden fixed inset-y-0 left-0 z-50 w-72 border-r border-separator/60 animate-slide-in-left">
              {/*
               * 抽屉自身的磨砂：fixed 定位，不能复用桌面端那条全屏覆盖层。
               * 这里只需要侧边栏的横向遮罩（抽屉从顶部到底，不经过标题栏段）。
               */}
              <div
                className="frost-main frost-drawer"
                style={
                  {
                    "--frost-sidebar-w": "288px",
                  } as React.CSSProperties
                }
                aria-hidden="true"
              />
              <Sidebar onNavigate={() => setMobileOpen(false)} />
            </div>
          </>
        )}

        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <main className="flex-1 overflow-y-auto p-4 lg:p-8 pt-6">
            <div
              id="dashboard-main"
              key={location.pathname}
              className="h-full min-h-full"
            >
              <Suspense
                fallback={
                  <div className="flex h-full min-h-[50vh] items-center justify-center">
                    {/* 路由懒加载兜底：与页面自身的加载态用同一种环，
                        否则首次切换页面会先闪一个另一种样式的指示器。 */}
                    <GlassProgressCircle isIndeterminate size="lg" aria-label="Loading">
                      <GlassProgressCircle.Track>
                        <GlassProgressCircle.TrackCircle />
                        <GlassProgressCircle.FillCircle />
                      </GlassProgressCircle.Track>
                    </GlassProgressCircle>
                  </div>
                }
              >
                {children}
              </Suspense>
            </div>
          </main>
        </div>
      </div>

      {/* Mobile menu trigger */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed bottom-6 right-6 z-30 p-3.5 rounded-full bg-primary text-primary-foreground shadow-lg [transition:transform_var(--lg-dur-press)_var(--lg-ease-spring),translate_var(--lg-dur-press)_var(--lg-ease-spring),scale_var(--lg-dur-press)_var(--lg-ease-spring)] hover:scale-105 active:scale-95"
        aria-label="Open menu"
      >
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            d="M4 6h16M4 12h16M4 18h16"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
          />
        </svg>
      </button>
    </div>
  );
}

const BG_SWITCH_TRIGGER_HEIGHT = 150;
const BG_SWITCH_TRIGGER_HALF_WIDTH = 220;
const BG_SWITCH_HIDE_DELAY = 300;

const BG_MODE_OPTIONS: Array<{
  value: GameBgMode;
  icon: typeof Video;
  labelKey: string;
}> = [
  {
    value: "video",
    icon: Video,
    labelKey: "settings.game_launch.bg_media_video",
  },
  {
    value: "image",
    icon: ImageIcon,
    labelKey: "settings.game_launch.bg_media_image",
  },
];

/**
 * 游戏界面顶部中央的背景模式切换器：鼠标靠近顶部中央时浮出，
 * 两侧图标分别对应视频 / 图片背景，与设置页共用 launcherMode store。
 */
function GameBackgroundSwitch({
  mode,
  media,
}: {
  mode: GameBgMode;
  media: LauncherBgMedia;
}) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  const videoAvailable = Boolean(media.video_url);
  const imageAvailable = Boolean(media.image_url);

  useEffect(() => {
    let hideTimer: number | null = null;

    const handleMouseMove = (event: MouseEvent) => {
      const nearTopCenter =
        event.clientY <= BG_SWITCH_TRIGGER_HEIGHT &&
        Math.abs(event.clientX - window.innerWidth / 2) <=
          BG_SWITCH_TRIGGER_HALF_WIDTH;

      if (nearTopCenter) {
        if (hideTimer !== null) {
          window.clearTimeout(hideTimer);
          hideTimer = null;
        }
        setVisible(true);
        return;
      }

      if (hideTimer !== null) return;
      hideTimer = window.setTimeout(() => {
        hideTimer = null;
        setVisible(false);
      }, BG_SWITCH_HIDE_DELAY);
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      if (hideTimer !== null) window.clearTimeout(hideTimer);
    };
  }, []);

  if (!videoAvailable && !imageAvailable) return null;

  return (
    <div
      className={`fixed left-1/2 top-12 z-30 -translate-x-1/2 transition-all duration-300 ease-out will-change-transform ${
        visible
          ? "translate-y-0 scale-100 opacity-100"
          : "pointer-events-none -translate-y-2 scale-95 opacity-0"
      }`}
    >
      <div
        role="group"
        aria-label={t("settings.game_launch.bg_media")}
        className="lg-media-chip lg-hairline relative flex items-center rounded-full p-1"
      >
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-1 left-1 w-9 rounded-full border border-white/30 bg-primary shadow-[inset_0_1px_1px_var(--lg-edge-glint),0_1px_4px_rgba(0,0,0,0.25)] [transition:translate_var(--lg-dur-press)_var(--lg-ease-inertia)] ${
            mode === "image" ? "translate-x-9" : "translate-x-0"
          }`}
        />
        {BG_MODE_OPTIONS.map((option) => {
          const Icon = option.icon;
          const active = mode === option.value;
          const available =
            option.value === "video" ? videoAvailable : imageAvailable;

          return (
            <button
              key={option.value}
              type="button"
              title={t(option.labelKey)}
              aria-label={t(option.labelKey)}
              aria-pressed={active}
              disabled={!available}
              onClick={() => {
                if (!active) setGameBgMode(option.value);
              }}
              className={`relative z-10 flex h-8 w-9 items-center justify-center rounded-full transition-colors duration-200 ${
                active
                  ? "cursor-pointer text-primary-foreground"
                  : available
                    ? "cursor-pointer text-white/75 hover:text-white"
                    : "cursor-not-allowed text-white/30"
              }`}
            >
              <MorphIcon icon={Icon} size={16} aria-hidden />
            </button>
          );
        })}
      </div>
    </div>
  );
}
