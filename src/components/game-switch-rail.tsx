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

/** 收起时鼠标靠近左边缘多少像素即出现 */
const PROXIMITY_PX = 110;
/** 面板命中判定的外扩像素（覆盖图标与边缘之间的空隙） */
const PANEL_HOVER_PAD = 10;
/**
 * 靠近左边缘时，只在这个竖向半带内展开。
 *
 * 不加限制的话，鼠标擦过标题栏左侧（应用图标 / 拖拽区）也会把栏拉出来。
 * 两个图标竖排的展开高度约 100px，取 ±150px 留出余量。
 */
const VERTICAL_BAND_PX = 150;

/** 每个游戏的图标（`public/games/`，官方启动器 `res/icons` 的 256px 帧，已切成超椭圆） */
const GAME_ICON: Record<LauncherGame, string> = {
  endfield: "/games/endfield.png",
  arknights: "/games/arknights.png",
};

/**
 * 超椭圆（squircle）轮廓：|x|^4 + |y|^4 = 1 的 72 段折线，viewBox 0 0 100 100。
 *
 * 用它做 `clipPath` 而不是 `border-radius`：圆角方在图标这种尺寸下四角会显得"塌"，
 * 超椭圆的曲率是连续的，看起来更接近官方启动器的游戏图标外形。
 * 图本身已经按同一公式切过 alpha（`public/games/*.png`），这里再裁一次是为了让
 * 选中环与悬停高亮也吃到同一个轮廓。
 */
const SQUIRCLE_PATH =
  "M 99.50 50.00 L 99.41 64.61 L 99.12 70.63 L 98.65 75.18 L 97.98 78.95 L 97.12 82.18 L 96.06 85.00 L 94.80 87.49 L 93.32 89.69 L 91.62 91.62 L 89.69 93.32 L 87.49 94.80 L 85.00 96.06 L 82.18 97.12 L 78.95 97.98 L 75.18 98.65 L 70.63 99.12 L 64.61 99.41 L 50.00 99.50 L 35.39 99.41 L 29.37 99.12 L 24.82 98.65 L 21.05 97.98 L 17.82 97.12 L 15.00 96.06 L 12.51 94.80 L 10.31 93.32 L 8.38 91.62 L 6.68 89.69 L 5.20 87.49 L 3.94 85.00 L 2.88 82.18 L 2.02 78.95 L 1.35 75.18 L 0.88 70.63 L 0.59 64.61 L 0.50 50.00 L 0.59 35.39 L 0.88 29.37 L 1.35 24.82 L 2.02 21.05 L 2.88 17.82 L 3.94 15.00 L 5.20 12.51 L 6.68 10.31 L 8.38 8.38 L 10.31 6.68 L 12.51 5.20 L 15.00 3.94 L 17.82 2.88 L 21.05 2.02 L 24.82 1.35 L 29.37 0.88 L 35.39 0.59 L 50.00 0.50 L 64.61 0.59 L 70.63 0.88 L 75.18 1.35 L 78.95 2.02 L 82.18 2.88 L 85.00 3.94 L 87.49 5.20 L 89.69 6.68 L 91.62 8.38 L 93.32 10.31 L 94.80 12.51 L 96.06 15.00 L 97.12 17.82 L 97.98 21.05 L 98.65 24.82 L 99.12 29.37 L 99.41 35.39 Z";

/**
 * 游戏界面左侧的游戏切换栏。
 *
 * 形态照搬右侧的官方社媒栏（`game-sidebar-rail.tsx`）：一根**贴左边缘**的常驻条，
 * 平时只有一个窄窄的触发器那么大，鼠标靠近左边缘才向左展开，竖直排列两个游戏的
 * 方形图标（超椭圆）。鼠标离开立即收起。
 *
 * 与右侧栏的差异：
 * - 只有两个固定条目（终末地 / 明日方舟），不依赖接口数据；
 * - 图标就是游戏本身的 icon，装过的游戏带一个小圆点；
 * - 选中项带一层外环，点击即切换 `launcherGame` store，配置随之整套切换。
 *
 * 展开/收起同样**由几何判定驱动**（每次 mousemove 量实时矩形），不挂 DOM 事件、
 * 不设防抖定时器：动画途中读到的矩形也是当下的值，不会出现"移进去了却还收着"。
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

      const hits =
        rect &&
        x >= rect.left - PANEL_HOVER_PAD &&
        x <= rect.right + PANEL_HOVER_PAD &&
        y >= rect.top - PANEL_HOVER_PAD &&
        y <= rect.bottom + PANEL_HOVER_PAD;

      // 靠近左边缘时只在中段竖向带内展开（避开标题栏与应用图标）
      const bandTop = rect ? rect.top - VERTICAL_BAND_PX : 0;
      const bandBottom = rect ? rect.bottom + VERTICAL_BAND_PX : window.innerHeight;
      const inVerticalBand = y >= bandTop && y <= bandBottom;

      if (hits || (x <= PROXIMITY_PX && inVerticalBand)) {
        expand();
      } else {
        collapse();
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [expand, collapse]);

  /** 收起时窄条 10px 宽，展开后 44px 见方一格 → 向右、向上下延伸 */
  const cell = expanded ? "h-11 w-11" : "h-11 w-2.5";

  return createPortal(
    <div
      ref={panelRef}
      className={`fixed left-0 top-1/2 z-30 -translate-y-1/2 ${
        expanded ? "" : "pointer-events-none"
      }`}
    >
      <div
        className={`flex flex-col items-center overflow-hidden rounded-r-2xl border border-l-0 transition-[padding,background-color] duration-300 ease-out ${
          expanded ? "lg-media-chip lg-hairline p-1.5" : "lg-media-chip lg-hairline p-1"
        }`}
      >
        <div
          className="grid w-full transition-[grid-template-rows] duration-300 ease-out"
          style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
        >
          <div
            className={`flex min-h-0 flex-col items-center gap-1.5 transition-opacity duration-200 ease-out ${
              expanded ? "opacity-100" : "opacity-0"
            }`}
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
                  title={installed ? label : `${label} · ${t("launcher.game_not_configured_hint")}`}
                  onClick={() => setActiveGame(candidate)}
                  className={`group relative ${cell} shrink-0 cursor-pointer overflow-hidden transition-[width,transform] duration-300 ease-out active:scale-95`}
                >
                  {/* 选中环 + 悬停提亮：与图标同一个超椭圆轮廓 */}
                  <span
                    aria-hidden="true"
                    className={`absolute left-0 top-0 h-11 w-11 transition-opacity duration-200 ${
                      active
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-60"
                    }`}
                    style={{
                      clipPath: `path("${SQUIRCLE_PATH}")`,
                      background: active
                        ? "color-mix(in srgb, var(--primary) 55%, transparent)"
                        : "color-mix(in srgb, white 30%, transparent)",
                    }}
                  />
                  {/* 图标固定 44×44 锚在左侧：收起时靠 overflow 裁掉右半，而不是被压扁 */}
                  <img
                    src={GAME_ICON[candidate]}
                    alt=""
                    draggable={false}
                    className={`absolute left-0 top-0 h-11 w-11 select-none object-cover transition-opacity duration-200 ${
                      active ? "opacity-100" : "opacity-70 group-hover:opacity-95"
                    }`}
                    style={{
                      clipPath: `path("${SQUIRCLE_PATH}")`,
                      // 内缩 2px，让上面的选中环露成一圈
                      transform: "scale(0.91)",
                    }}
                  />
                  {/* 已安装标记：右下角的小圆点 */}
                  {installed && (
                    <span
                      aria-hidden="true"
                      className={`absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full ring-1 ring-black/30 ${
                        active ? "bg-primary-text" : "bg-emerald-400"
                      }`}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
