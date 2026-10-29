import { useState, useEffect, useRef, Suspense } from "react";
import { useLocation } from "react-router-dom";
import clsx from "clsx";
import { CustomTitlebar } from "@/components/custom-titlebar";
import { Sidebar } from "@/components/dashboard-sidebar";
import { GlassSpinner } from "@/components/ui/glass";
import { getConfig, setConfig } from "@/utils/configService";
import {
  getLauncherMode,
  subscribeLauncherMode,
  getLauncherBgMedia,
  setLauncherBgMedia,
  subscribeLauncherBgMedia,
  getGameBgMode,
  setGameBgMode,
  subscribeGameBgMode,
  type LauncherBgMedia,
  type GameBgMode,
} from "@/stores/launcherMode";
import {
  openInAppBrowser,
  suspendInAppBrowser,
  resumeInAppBrowser,
} from "@/stores/inAppBrowser";
import { InAppBrowser } from "@/components/in-app-browser";
import { GameActionPanel } from "@/components/game-action-panel";
import { GameSidebarRail } from "@/components/game-sidebar-rail";
import { useTranslation } from "react-i18next";
import { MorphIcon } from "morphicons/react";
import {
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Video,
} from "lucide";
import { trackStartupTask } from "@/utils/startupProgress";
import {
  type GameChannel,
  type BannerItem,
  type AnnouncementItem,
  type SidebarItem,
  getNoticeContent,
  getBackgroundImage,
} from "@/utils/launcherService";
import { isWindowsPlatform } from "@/utils/platform";

const STORAGE_KEY_CHANNEL = "launcher_channel";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [viewMode, setViewMode] = useState(getLauncherMode);
  const [bgMedia, setBgMedia] = useState<LauncherBgMedia | null>(
    getLauncherBgMedia,
  );
  const [bgMediaMode, setBgMediaMode] = useState<GameBgMode>(getGameBgMode);
  const [channel] = useState<GameChannel>(() => {
    return (
      (localStorage.getItem(STORAGE_KEY_CHANNEL) as GameChannel) || "official"
    );
  });
  const [banners, setBanners] = useState<BannerItem[]>([]);
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  const [sidebars, setSidebars] = useState<SidebarItem[]>([]);
  const [bannerIndex, setBannerIndex] = useState(0);
  const [bannerHovered, setBannerHovered] = useState(false);
  const bannerPrevIndexRef = useRef(0);
  const [bannerDir, setBannerDir] = useState<1 | -1>(1);
  const [outgoingBanner, setOutgoingBanner] = useState<number | null>(null);
  const [announcementTab, setAnnouncementTab] = useState(0);

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
    return subscribeLauncherBgMedia(() => {
      setBgMedia(getLauncherBgMedia());
    });
  }, []);

  useEffect(() => {
    return subscribeGameBgMode(() => {
      setBgMediaMode(getGameBgMode());
    });
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_CHANNEL, channel);
  }, [channel]);

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

  // Fetch background + banners when channel changes
  useEffect(() => {
    if (!isWindowsPlatform()) return;
    const initialData = Promise.all([
      getBackgroundImage(channel)
        .then(setLauncherBgMedia)
        .catch(() => setLauncherBgMedia(null)),

      getNoticeContent(channel)
        .then((content) => {
          console.log(
            "[Dashboard] Notices loaded:",
            content.banners.length,
            "banners,",
            content.announcements.length,
            "announcements,",
            content.sidebars?.length ?? 0,
            "sidebars",
          );
          setBanners(content.banners);
          setAnnouncements(content.announcements);
          setSidebars(content.sidebars ?? []);
        })
        .catch((e) => {
          console.error("[Dashboard] Failed to load notices:", e);
          setBanners([]);
          setAnnouncements([]);
          setSidebars([]);
        }),
    ]);

    void trackStartupTask(initialData);
  }, [channel]);

  // Banner auto-rotate (paused on hover)
  useEffect(() => {
    if (banners.length <= 1 || bannerHovered) return;
    const timer = setInterval(() => {
      setBannerIndex((i) => (i + 1) % banners.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [banners.length, bannerHovered]);

  // Derive push direction + keep the outgoing banner mounted for the transition
  useEffect(() => {
    const prev = bannerPrevIndexRef.current;
    if (prev === bannerIndex) {
      // List reloaded without navigating (e.g. channel switch): drop any stale clone.
      setOutgoingBanner(null);
      return;
    }
    const len = banners.length;
    // Wrap-around (last -> first) counts as "next"; anything else that is not
    // the immediate successor slides in from the left.
    setBannerDir(len > 1 && bannerIndex === (prev + 1) % len ? 1 : -1);
    setOutgoingBanner(prev);
    bannerPrevIndexRef.current = bannerIndex;
    const timer = setTimeout(() => setOutgoingBanner(null), 400);
    return () => clearTimeout(timer);
  }, [bannerIndex, banners.length]);

  // Preload banner images so the push transition never flashes a blank frame
  useEffect(() => {
    banners.forEach((b) => {
      if (!b.image_url) return;
      const img = new Image();
      img.src = b.image_url;
    });
  }, [banners]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      setLauncherBgMedia(null);
    };
  }, []);

  const isGameMode = viewMode === "game";
  const announcementCategories = [
    ...new Set(announcements.map((a) => a.category)),
  ];
  const activeAnnouncementCategory =
    announcementCategories[announcementTab] || announcementCategories[0];
  const filteredAnnouncements = announcements.filter(
    (a) => a.category === activeAnnouncementCategory,
  );

  // ========== GAME MODE ==========
  if (isGameMode) {
    const bgVideoSrc =
      bgMedia && bgMediaMode === "video" ? bgMedia.video_url : null;
    const bgImageSrc = bgMedia
      ? (bgMedia.image_url ?? bgMedia.video_url)
      : null;
    const showVideo =
      typeof bgVideoSrc === "string" && bgVideoSrc.length > 0;
    const bgSrc = showVideo ? bgVideoSrc : bgImageSrc;

    return (
      <div className="relative flex flex-col h-screen">
        {/* Full-bleed background */}
        <div className="fixed inset-0 z-0">
          {bgSrc ? (
            <>
              {showVideo ? (
                <video
                  src={bgSrc}
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
                    backgroundImage: `url("${bgSrc}")`,
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

        <CustomTitlebar />

        {/* Background mode switch — floats in near the top center */}
        {bgMedia && (
          <GameBackgroundSwitch mode={bgMediaMode} media={bgMedia} />
        )}

        {/* In-app browser overlay — 全屏覆盖（含标题栏），自带窗口控制 */}
        <InAppBrowser />

        {/* 右侧官方社媒栏：收起为浮标，靠近右边缘展开，悬停出二维码 */}
        <GameSidebarRail items={sidebars} />

        {/* Content layer */}
        <div className="relative z-10 flex-1 flex flex-col p-4 lg:p-8">
          {/* Spacer */}
          <div className="flex-1" />

          {/* Bottom: banner/announcements (left) + game action (right) */}
          <div className="flex items-end justify-between gap-4">
            {/* Banner + announcements box */}
            <div className="flex items-stretch h-40 max-w-2xl flex-1 min-w-0 rounded-xl bg-black/40 backdrop-blur-md border border-white/10 overflow-hidden shadow-2xl">
              {/* Banner — left side, 4px margin top/left/bottom, auto width by aspect ratio */}
              {banners.length > 0 && (
                <div
                  className="relative shrink-0 my-1 ml-1 flex items-center group overflow-hidden rounded-lg"
                  onMouseEnter={() => setBannerHovered(true)}
                  onMouseLeave={() => setBannerHovered(false)}
                >
                  {/* Outgoing banner — pushed out to the opposite side */}
                  {outgoingBanner !== null && banners[outgoingBanner] && (
                    <img
                      key={`banner-out-${outgoingBanner}`}
                      src={banners[outgoingBanner].image_url}
                      alt=""
                      aria-hidden="true"
                      className={`absolute inset-y-0 left-0 h-full w-auto object-contain rounded-lg pointer-events-none ${
                        bannerDir === 1
                          ? "animate-banner-push-out-left"
                          : "animate-banner-push-out-right"
                      }`}
                    />
                  )}

                  {/* Incoming banner — slides in, then zooms on hover */}
                  <div
                    key={`banner-in-${bannerIndex}`}
                    className={`relative z-[1] h-full flex items-center ${
                      outgoingBanner !== null
                        ? bannerDir === 1
                          ? "animate-banner-push-in-right"
                          : "animate-banner-push-in-left"
                        : ""
                    }`}
                  >
                    <img
                      src={banners[bannerIndex].image_url}
                      alt="Banner"
                      className="h-full w-auto object-contain rounded-lg cursor-pointer transition-transform duration-300 ease-out group-hover:scale-[1.08]"
                      onClick={() => {
                        const url = banners[bannerIndex].jump_url;
                        if (url) openInAppBrowser(url);
                      }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  </div>

                  {/* Left / Right arrows — visible on hover */}
                  {banners.length > 1 && bannerHovered && (
                    <>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setBannerIndex(
                            (i) => (i - 1 + banners.length) % banners.length,
                          );
                        }}
                        className="absolute left-0.5 top-1/2 -translate-y-1/2 w-5 h-14 flex items-center justify-center rounded-full bg-black/50 text-white/80 hover:bg-black/70 hover:text-white transition-colors cursor-pointer z-10"
                      >
                        <MorphIcon icon={ChevronLeft} size={16} aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setBannerIndex((i) => (i + 1) % banners.length);
                        }}
                        className="absolute right-0.5 top-1/2 -translate-y-1/2 w-5 h-14 flex items-center justify-center rounded-full bg-black/50 text-white/80 hover:bg-black/70 hover:text-white transition-colors cursor-pointer z-10"
                      >
                        <MorphIcon icon={ChevronRight} size={16} aria-hidden />
                      </button>
                    </>
                  )}

                  {/* Dots */}
                  {banners.length > 1 && (
                    <div className="absolute bottom-0 left-1/2 -translate-x-1/2 flex gap-1 z-10">
                      {banners.map((_, i) => (
                        <button
                          key={i}
                          type="button"
                          className={`w-1.5 h-1.5 rounded-full transition-all cursor-pointer ${
                            i === bannerIndex ? "bg-white w-3" : "bg-white/40"
                          }`}
                          onClick={() => setBannerIndex(i)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Announcements — right side */}
              {announcementCategories.length > 0 ? (
                <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                  {/* Tabs */}
                  <div className="flex items-center gap-0 px-3 pt-2 shrink-0">
                    {announcementCategories.map((cat, i) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setAnnouncementTab(i)}
                        className={`px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                          i === announcementTab
                            ? "text-white border-b-2 border-white"
                            : "text-white/50 hover:text-white/80"
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>

                  {/* List */}
                  <div className="flex-1 px-3 pb-2 pt-1 space-y-0.5 overflow-y-auto">
                    {filteredAnnouncements.slice(0, 6).map((item, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between py-1.5 px-1 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
                        onClick={() => {
                          if (item.jump_url) openInAppBrowser(item.jump_url);
                        }}
                      >
                        <span className="text-xs text-white/80 truncate mr-2">
                          {item.title}
                        </span>
                        <span className="text-[10px] text-white/40 shrink-0">
                          {item.date}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-xs text-white/30">
                  No announcements
                </div>
              )}
            </div>

            {/* Game action panel — right side */}
            <div className="shrink-0 self-end mb-2">
              <GameActionPanel />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ========== DATA MODE ==========
  return (
    <div className="relative flex flex-col h-screen glass-window">
      <div className="dashboard-background" aria-hidden="true" />

      <CustomTitlebar />

      <div className="relative z-10 flex flex-1 overflow-hidden">
        {/* Desktop Sidebar */}
        <div
          className={clsx(
            "hidden lg:flex shrink-0 overflow-hidden transition-[width] duration-300 ease-out will-change-[width]",
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
              className="lg:hidden fixed inset-0 z-40 bg-foreground/50 backdrop-blur-sm animate-fade-in"
              onClick={() => setMobileOpen(false)}
              aria-label="Close sidebar"
              role="button"
            />
            <div className="lg:hidden fixed inset-y-0 left-0 z-50 w-72 glass-surface-strong border-r border-separator/70 animate-slide-in-left">
              <Sidebar onNavigate={() => setMobileOpen(false)} />
            </div>
          </>
        )}

        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <main className="flex-1 overflow-y-auto p-4 lg:p-8 pt-6">
            <div key={location.pathname} className="h-full min-h-full">
              <Suspense
                fallback={
                  <div className="flex h-full min-h-[50vh] items-center justify-center">
                    <GlassSpinner color="primary" size="lg" />
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
        className="lg:hidden fixed bottom-6 right-6 z-30 p-3.5 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all duration-200"
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
        className="relative flex items-center rounded-full border border-white/15 bg-black/45 p-1 shadow-2xl backdrop-blur-md"
      >
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-1 left-1 w-9 rounded-full border border-white/30 bg-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_1px_4px_rgba(0,0,0,0.25)] transition-transform duration-300 ease-out ${
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
