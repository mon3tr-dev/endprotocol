import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { readGameInstallPath } from "@/utils/launcherService";
import {
  ALL_GAMES,
  getActiveGame,
  setActiveGame,
  subscribeActiveGame,
  type LauncherGame,
} from "@/stores/launcherGame";

/** 收起时鼠标靠近左边缘多少像素即展开 */
const PROXIMITY_PX = 110;
/** 面板命中判定的外扩像素（覆盖图标与边缘之间的空隙） */
const PANEL_HOVER_PAD = 10;
/** 展开判定相对视口中线的竖向半带（避开标题栏，也不让条子在全高乱弹） */
const VERTICAL_BAND_PX = 150;
/** 标题栏高度 + 余量：指针在这条带里一律不触发，窗口再矮也不会误展开 */
const TITLEBAR_SAFE_PX = 64;

/** 展开后的量：图标边长 / 图标间距 / 内边距 */
const CELL_PX = 48;
const GAP_PX = 10;
const PAD_PX = 10;
const RAIL_WIDTH = CELL_PX + PAD_PX * 2; // 68
const RAIL_HEIGHT = CELL_PX * 2 + GAP_PX + PAD_PX * 2; // 126
/** 收起时的窄把手 */
const HANDLE_WIDTH = 10;
const HANDLE_HEIGHT = 56;

/** 每个游戏的图标（`public/games/`，官方启动器 `res/icons` 的 256px 帧，已切成超椭圆） */
const GAME_ICON: Record<LauncherGame, string> = {
  endfield: "/games/endfield.png",
  arknights: "/games/arknights.png",
};

/**
 * 超椭圆（squircle）轮廓：|x|^4 + |y|^4 = 1 的 72 段折线。
 *
 * 用 `clip-path` 而不是 `border-radius`，因为圆角方在 48px 这种尺寸下四角会显得"塌"，
 * 超椭圆曲率连续，更接近官方启动器图标的外形；图片本身已按同一公式切过 alpha
 * （`public/games/*.png`），这里再裁一次是为了让选中环与悬停高亮吃到同一个轮廓。
 *
 * 必须用**百分比**而不是 `path()`：CSS 的 `path()` 里所有长度都是 px、不随元素缩放，
 * 把按 100×100 画好的 path 套到 48×48 的盒子上只会露出左上角一小块。
 */
const SQUIRCLE_CLIP =
  "polygon(99.5% 50%, 99.41% 64.61%, 99.12% 70.63%, 98.65% 75.18%, 97.98% 78.95%, 97.12% 82.18%, 96.06% 85%, 94.8% 87.49%, 93.32% 89.69%, 91.62% 91.62%, 89.69% 93.32%, 87.49% 94.8%, 85% 96.06%, 82.18% 97.12%, 78.95% 97.98%, 75.18% 98.65%, 70.63% 99.12%, 64.61% 99.41%, 50% 99.5%, 35.39% 99.41%, 29.37% 99.12%, 24.82% 98.65%, 21.05% 97.98%, 17.82% 97.12%, 15% 96.06%, 12.51% 94.8%, 10.31% 93.32%, 8.38% 91.62%, 6.68% 89.69%, 5.2% 87.49%, 3.94% 85%, 2.88% 82.18%, 2.02% 78.95%, 1.35% 75.18%, 0.88% 70.63%, 0.59% 64.61%, 0.5% 50%, 0.59% 35.39%, 0.88% 29.37%, 1.35% 24.82%, 2.02% 21.05%, 2.88% 17.82%, 3.94% 15%, 5.2% 12.51%, 6.68% 10.31%, 8.38% 8.38%, 10.31% 6.68%, 12.51% 5.2%, 15% 3.94%, 17.82% 2.88%, 21.05% 2.02%, 24.82% 1.35%, 29.37% 0.88%, 35.39% 0.59%, 50% 0.5%, 64.61% 0.59%, 70.63% 0.88%, 75.18% 1.35%, 78.95% 2.02%, 82.18% 2.88%, 85% 3.94%, 87.49% 5.2%, 89.69% 6.68%, 91.62% 8.38%, 93.32% 10.31%, 94.8% 12.51%, 96.06% 15%, 97.12% 17.82%, 97.98% 21.05%, 98.65% 24.82%, 99.12% 29.37%, 99.41% 35.39%)";

/**
 * 游戏界面左侧的游戏切换栏。
 *
 * 形态照搬右侧的官方社媒栏（`game-sidebar-rail.tsx`）：一根**贴左边缘**的常驻条，
 * 收起时只有一条窄把手，鼠标靠近左边缘才向右展开，竖直排列两个游戏的超椭圆图标。
 * 鼠标离开立即收起。
 *
 * 与右侧栏的差异：
 * - 只有两个固定条目（终末地 / 明日方舟），不依赖接口数据；
 * - 图标就是游戏本身的 icon，装过的游戏在角上带一个圆点，没装的降饱和度；
 * - 选中项带一层同轮廓的外环，点击即切换 `launcherGame` store，整套配置随之换掉。
 *
 * 展开/收起的判定只用**视口中线**和一个固定竖向半带，不去量动画中的矩形做触发布尔：
 * 条子本身与中线同心，所以这个判据比"相对当前矩形 ±150px"更稳，窗口再矮也不会
 * 因为条子贴近标题栏而误展开。命中条子时仍按实时矩形判断，避免展开过程中丢手。
 */
export function GameSwitchRail() {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [game, setGame] = useState<LauncherGame>(getActiveGame);
  const expandedRef = useRef(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => subscribeActiveGame(() => setGame(getActiveGame())), []);

  const expand = useCallback(() => {
    if (expandedRef.current) return;
    expandedRef.current = true;
    setExpanded(true);
  }, []);

  const collapse = useCallback(() => {
    if (!expandedRef.current) return;
    expandedRef.current = false;
    setExpanded(false);
  }, []);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const { clientX: x, clientY: y } = event;
      const rect = panelRef.current?.getBoundingClientRect();

      // 指针落在（展开后的）面板上：保持展开
      const inPanel =
        !!rect &&
        x >= rect.left - PANEL_HOVER_PAD &&
        x <= rect.right + PANEL_HOVER_PAD &&
        y >= rect.top - PANEL_HOVER_PAD &&
        y <= rect.bottom + PANEL_HOVER_PAD;

      // 贴左边缘、且在中线附近的竖向带内：展开
      const nearLeftEdge =
        x <= PROXIMITY_PX &&
        y >= TITLEBAR_SAFE_PX &&
        Math.abs(y - window.innerHeight / 2) <= VERTICAL_BAND_PX;

      if (inPanel || nearLeftEdge) {
        expand();
      } else {
        collapse();
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [expand, collapse]);

  return createPortal(
    <div
      ref={panelRef}
      className={`fixed left-0 top-1/2 z-30 -translate-y-1/2 ${
        expanded ? "" : "pointer-events-none"
      }`}
    >
      {/* 常驻条本体：贴左边缘、只圆右侧两角；宽度/高度同时进退 → 向右、向上下生长 */}
      <div
        className="relative grid place-items-center overflow-hidden rounded-r-2xl border border-l-0 lg-media-chip lg-hairline transition-[width,height] duration-300 ease-out"
        style={{
          width: expanded ? RAIL_WIDTH : HANDLE_WIDTH,
          height: expanded ? RAIL_HEIGHT : HANDLE_HEIGHT,
        }}
      >
        {/* 收起态的窄把手：只给一个"这里能拉出来"的暗示，不收指针事件 */}
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 left-0 flex w-full items-center justify-center transition-opacity duration-200 ease-out ${
            expanded ? "opacity-0" : "opacity-100"
          }`}
        >
          <span className="h-8 w-1 rounded-full bg-white/40" />
        </span>

        {/* 图标列：挂 `inert`，收起时既不接收指针也不进 Tab 序列 */}
        <div
          inert={!expanded}
          role="group"
          aria-label={t("launcher.select_game_title")}
          className={`absolute left-0 top-1/2 flex w-full -translate-y-1/2 flex-col items-center transition-opacity duration-200 ease-out ${
            expanded ? "opacity-100" : "opacity-0"
          }`}
          style={{ gap: GAP_PX, padding: PAD_PX }}
        >
          {ALL_GAMES.map((candidate) => {
            const active = candidate === game;
            const installed = Boolean(readGameInstallPath(candidate));
            const label = t(`launcher.game_group_${candidate}`);

            return (
              <button
                key={candidate}
                type="button"
                aria-label={label}
                aria-current={active ? "true" : undefined}
                title={
                  installed
                    ? label
                    : `${label} · ${t("launcher.game_not_configured_hint")}`
                }
                onClick={() => setActiveGame(candidate)}
                className="group relative shrink-0 cursor-pointer transition-transform duration-200 ease-out active:scale-95"
                style={{ width: CELL_PX, height: CELL_PX }}
              >
                {/* 选中环 / 悬停提亮：与图标同一个超椭圆轮廓 */}
                <span
                  aria-hidden="true"
                  className={`absolute inset-0 transition-opacity duration-200 ${
                    active ? "opacity-100" : "opacity-0 group-hover:opacity-60"
                  }`}
                  style={{
                    clipPath: SQUIRCLE_CLIP,
                    background: active
                      ? "color-mix(in srgb, var(--primary) 60%, transparent)"
                      : "color-mix(in srgb, white 32%, transparent)",
                  }}
                />
                {/* 图标整体内缩 10%，让上面的环露成一圈 */}
                <img
                  src={GAME_ICON[candidate]}
                  alt=""
                  draggable={false}
                  className={`absolute inset-0 h-full w-full select-none object-cover transition-[opacity,filter] duration-200 ${
                    active
                      ? "opacity-100"
                      : "opacity-70 grayscale-[0.7] group-hover:opacity-100 group-hover:grayscale-0"
                  }`}
                  style={{ clipPath: SQUIRCLE_CLIP, transform: "scale(0.9)" }}
                />
                {/* 已安装标记：右上角的小圆点（落在超椭圆内部，不会被轮廓切掉） */}
                {installed && (
                  <span
                    aria-hidden="true"
                    className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400 ring-1 ring-black/40"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
