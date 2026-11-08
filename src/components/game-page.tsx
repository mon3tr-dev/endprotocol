import { useEffect, useMemo, useRef, useState } from "react";
import {
  type BannerItem,
  type AnnouncementItem,
  type SidebarItem,
  getNoticeContent,
  getBackgroundImage,
  readGameChannel,
} from "@/utils/launcherService";
import { type LauncherGame } from "@/stores/launcherGame";
import { GameActionPanel } from "@/components/game-action-panel";
import { GameSidebarRail } from "@/components/game-sidebar-rail";

/**
 * 游戏模式下的「一页」——某个游戏（终末地 / 明日方舟）的完整界面。
 *
 * 切游戏时做的是**整页推移**：旧页往一个方向退出、新页从另一个方向进来，
 * 两页同时在画面上。要做到这一点，两页必须各自持有自己的数据
 * （背景图 / 横幅 / 公告 / 右侧社媒栏），不能共用同一份 state ——
 * 共用的话新页推上来时会是旧页的内容，或者干脆空白。
 *
 * 数据按游戏分别缓存：切回去时不用重新拉（后端要走 HTTP，耗时不可控，
 * 等数据到了再开始动画会让新页推上来一片空白）。
 */

/** 一个游戏对应的页面数据 */
export interface GamePageData {
  background: { image_url: string | null; video_url: string | null } | null;
  banners: BannerItem[];
  announcements: AnnouncementItem[];
  sidebars: SidebarItem[];
}

/** 空数据（还没拉到、或拉取失败） */
export const EMPTY_PAGE_DATA: GamePageData = {
  background: null,
  banners: [],
  announcements: [],
  sidebars: [],
};

/** 页面数据缓存：按游戏存一份，跨切换保留 */
const pageCache = new Map<LauncherGame, GamePageData>();

/** 正在进行的拉取（避免同一游戏并发拉两次） */
const inflight = new Map<LauncherGame, Promise<void>>();

/** 读缓存 */
export function getCachedPageData(game: LauncherGame): GamePageData | undefined {
  return pageCache.get(game);
}

/**
 * 拉取某个游戏的数据并写入缓存。
 *
 * 已经在拉或已经拉到就直接返回 —— 切换动画不能等网络。
 */
export function fetchPageData(game: LauncherGame): Promise<void> {
  const existing = inflight.get(game);
  if (existing) return existing;

  const channel = readGameChannel(game);
  const task = (async () => {
    const [background, content] = await Promise.all([
      getBackgroundImage(channel).catch(() => null),
      getNoticeContent(channel).catch(() => null),
    ]);
    pageCache.set(game, {
      background,
      banners: content?.banners ?? [],
      announcements: content?.announcements ?? [],
      sidebars: content?.sidebars ?? [],
    });
  })();

  inflight.set(game, task);
  void task.finally(() => inflight.delete(game));
  return task;
}

/**
 * 预取另一个游戏的数据。
 *
 * 切换动画开始时新页面的数据必须已经在手，否则会看到新页「空着」推上来。
 * 提前把另一个游戏的数据拉好，切换时就能立刻用上。
 */
export function prefetchOtherGame(current: LauncherGame): void {
  const other: LauncherGame = current === "endfield" ? "arknights" : "endfield";
  if (pageCache.has(other)) return;
  void fetchPageData(other);
}

/** 游戏页 props */
export interface GamePageProps {
  /** 这一页是哪个游戏 */
  game: LauncherGame;
  /** 页面数据 */
  data: GamePageData;
}

/**
 * 单个游戏页的内容层（不含背景 —— 背景由外层统一管理，避免两层背景互相穿插）。
 */
export function GamePageContent({ game, data }: GamePageProps) {
  const [bannerIndex, setBannerIndex] = useState(0);
  const [bannerHovered, setBannerHovered] = useState(false);
  const [announcementTab, setAnnouncementTab] = useState(0);
  const bannerPrevRef = useRef<{ url: string; index: number } | null>(null);
  const [bannerDir, setBannerDir] = useState<1 | -1>(1);
  const [outgoingBanner, setOutgoingBanner] = useState<{
    url: string;
    index: number;
  } | null>(null);

  const banners = data.banners;
  const announcements = data.announcements;

  // 列表换了游戏后，轮播下标可能越界，夹回合法范围
  useEffect(() => {
    setBannerIndex((i) => (banners.length === 0 ? 0 : i >= banners.length ? 0 : i));
  }, [banners.length]);

  // 公告分类数也会变，选中的分类下标越界时夹回第一个
  const announcementCategories = useMemo(
    () => [...new Set(announcements.map((a) => a.category))],
    [announcements],
  );
  useEffect(() => {
    setAnnouncementTab((i) =>
      announcementCategories.length === 0
        ? 0
        : i >= announcementCategories.length
          ? 0
          : i,
    );
  }, [announcementCategories.length]);

  const activeAnnouncementCategory =
    announcementCategories[announcementTab] || announcementCategories[0];
  const filteredAnnouncements = announcements.filter(
    (a) => a.category === activeAnnouncementCategory,
  );

  // Banner 自动轮播（悬停时暂停）
  useEffect(() => {
    if (banners.length <= 1 || bannerHovered) return;
    const timer = setInterval(() => {
      setBannerIndex((i) => (i + 1) % banners.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [banners.length, bannerHovered]);

  // 轮播「推动」动画：判据用 URL 而不是下标 —— 换游戏时整组横幅被换掉，
  // 下标可能没变（都从 0 开始）但内容全换了，只看下标会漏掉。
  useEffect(() => {
    const current = banners[bannerIndex];
    const currentUrl = current?.image_url ?? null;
    const prev = bannerPrevRef.current;

    if (!currentUrl) {
      setOutgoingBanner(null);
      return;
    }
    if (prev?.url === currentUrl) {
      bannerPrevRef.current = { url: currentUrl, index: bannerIndex };
      setOutgoingBanner(null);
      return;
    }

    const len = banners.length;
    setBannerDir(
      prev !== null && len > 1 && bannerIndex === (prev.index + 1) % len ? 1 : -1,
    );
    setOutgoingBanner(prev ? { url: prev.url, index: prev.index } : null);
    bannerPrevRef.current = { url: currentUrl, index: bannerIndex };
    const timer = setTimeout(() => setOutgoingBanner(null), 400);
    return () => clearTimeout(timer);
  }, [bannerIndex, banners]);

  return (
    <>
      {/* 右侧官方社媒栏：收起为浮标，靠近右边缘展开，悬停出二维码 */}
      <GameSidebarRail items={data.sidebars} />

      {/* Content layer */}
      <div className="relative z-10 flex-1 flex flex-col p-4 lg:p-8">
        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom: banner/announcements (left) + game action (right) */}
        <div className="flex items-end justify-between gap-4">
          {/* Banner + announcements box */}
          <div className="lg-media-chip lg-hairline flex items-stretch h-40 max-w-2xl flex-1 min-w-0 rounded-xl overflow-hidden">
            {/* Banner — left side, 4px margin top/left/bottom, auto width by aspect ratio */}
            {banners.length > 0 && (
              <div
                className="relative shrink-0 my-1 ml-1 flex items-center group overflow-hidden rounded-lg"
                onMouseEnter={() => setBannerHovered(true)}
                onMouseLeave={() => setBannerHovered(false)}
              >
                {/* Outgoing banner — pushed out to the opposite side */}
                {outgoingBanner !== null && (
                  <img
                    key={`banner-out-${outgoingBanner.url}`}
                    src={outgoingBanner.url}
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
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                </div>
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
                      className="flex items-center justify-between py-1.5 px-1 rounded-lg lg-hoverable-soft transition-colors cursor-pointer"
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
                {""}
              </div>
            )}
          </div>

          {/* Game action panel — right side */}
          <div className="shrink-0 self-end mb-2">
            <GameActionPanel game={game} />
          </div>
        </div>
      </div>
    </>
  );
}
