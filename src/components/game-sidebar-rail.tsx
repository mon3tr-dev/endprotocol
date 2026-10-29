import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Headset, Share2 } from "lucide";
import { MorphIcon } from "morphicons/react";
import { openInAppBrowser } from "@/stores/inAppBrowser";
import type { SidebarItem } from "@/utils/launcherService";

/** 收起时鼠标靠近右边缘多少像素即展开 */
const PROXIMITY_PX = 110;
/** 展开判定在常驻条上下各放宽多少像素（限定竖向范围，避免标题栏按钮误触发） */
const VERTICAL_PAD_PX = 56;
/** 常驻条命中判定的外扩像素：跨过与二维码浮层之间的那道缝隙 */
const RAIL_HOVER_PAD = 6;
/** 二维码浮层的估算高度，用于把它夹在视口内（顶部不溢出） */
const FLYOUT_ESTIMATE_HEIGHT = 250;
/**
 * 不展示的条目：`SklandTool` 是 `DisplayType_GRID`，官方把它做成一组森空岛工具链接的弹层
 * （每日签到 / 游戏数据 / 配队 / 地图 / WIKI / 养成建议），没有二维码，需求里明确不显示。
 */
const HIDDEN_MEDIA = new Set(["SklandTool"]);

/**
 * media → 本地图标（`public/assets/icons/sidebar/`，统一 32×32 画布、已反色为白色）。
 *
 * `CS`（客服帮助）不在这里：官方给的是一张森空岛吉祥物插画，不适合当功能图标，
 * 改走 morphicons 的 `Headset`（见渲染分支）。
 */
const ICON_BY_MEDIA: Record<string, string> = {
  Skland: "skland",
  Bilibili: "bilibili",
  Weibo: "weibo",
  Taptap: "taptap",
  Douyin: "douyin",
  Xiaohongshu: "xiaohongshu",
  Wechat: "wechat",
};

function iconFor(item: SidebarItem): string | null {
  const name = ICON_BY_MEDIA[item.media];
  return name ? `/assets/icons/sidebar/${name}.svg` : null;
}

/** 二维码浮层的视口定位（fixed，锚在触发项左侧） */
interface FlyoutAnchor {
  right: number;
  bottom: number;
}

export interface GameSidebarRailProps {
  items: SidebarItem[];
}

/**
 * 游戏界面右侧的官方社媒栏。
 *
 * 形态是**一根贴右边缘的常驻条**（只有左侧圆角，右侧与窗口边线齐平）：收起时它就只有
 * 一个浮标那么大；鼠标靠近右边缘即向左、向上下两侧生长成一列渠道图标（容器垂直居中，
 * 内容长高即双向延伸），鼠标离开**立即**收起（无关闭按钮、无延迟）。
 * 悬停图标在左侧浮出该渠道二维码，点击图标用内嵌浏览器打开官方页面。
 *
 * 两个实现要点：
 * 1. **展开/收起完全由几何判定驱动**，不挂 DOM 事件、不设防抖定时器：每次 `mousemove`
 *    直接量常驻条与二维码浮层的实时矩形，命中任一即保持展开，否则立即收起。
 *    之所以要连浮层一起量：浮层挂在条的左侧、中间有 6px 缝隙，只判条的话鼠标一移过去
 *    就收起了；而用定时器给缝隙留缓冲会带来可感知的回缩延迟，故不用定时器。
 *    矩形是实时读取的，动画途中也不会读到过期值。
 * 2. **二维码浮层单独 portal 到 body**：它既会被常驻条的 `overflow-hidden`（高度动画需要）
 *    裁掉，也会因常驻条带 `transform` 而使 `position: fixed` 退化为相对该祖先定位。
 *    浮层是纯展示层，`pointer-events-none`，命中判定靠上面的几何测量。
 *
 * 数据来自启动器 `get_sidebar`（与公告、Banner 同一次 batch_proxy 请求），
 * 由 `layouts/dashboard.tsx` 在游戏模式下挂载。
 */
export function GameSidebarRail({ items }: GameSidebarRailProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  /** 当前悬停的条目下标，-1 表示没有（收起时清空） */
  const [hoveredIndex, setHoveredIndex] = useState(-1);
  const [flyout, setFlyout] = useState<FlyoutAnchor | null>(null);
  const expandedRef = useRef(false);
  const railRef = useRef<HTMLDivElement | null>(null);
  const flyoutRef = useRef<HTMLDivElement | null>(null);

  const visibleItems = items.filter(
    (item) =>
      !HIDDEN_MEDIA.has(item.media) && item.display_type !== "DisplayType_GRID",
  );

  const expand = useCallback(() => {
    if (expandedRef.current) return;
    expandedRef.current = true;
    setExpanded(true);
  }, []);

  const collapse = useCallback(() => {
    if (!expandedRef.current) return;
    expandedRef.current = false;
    setExpanded(false);
    setHoveredIndex(-1);
    setFlyout(null);
  }, []);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const { clientX: x, clientY: y } = event;

      const hits = (rect: DOMRect, pad: number) =>
        x >= rect.left - pad &&
        x <= rect.right + pad &&
        y >= rect.top - pad &&
        y <= rect.bottom + pad;

      const rail = railRef.current?.getBoundingClientRect();
      const flyoutRect = flyoutRef.current?.getBoundingClientRect();

      // 指针在条或二维码浮层内（含外扩）→ 保持展开
      if ((rail && hits(rail, RAIL_HOVER_PAD)) || (flyoutRect && hits(flyoutRect, 0))) {
        expand();
        return;
      }

      // 靠近右边缘且与条在同一竖向带内 → 展开
      const nearRightEdge = x >= window.innerWidth - PROXIMITY_PX;
      const inVerticalBand =
        !rail ||
        (y >= rail.top - VERTICAL_PAD_PX && y <= rail.bottom + VERTICAL_PAD_PX);

      if (nearRightEdge && inVerticalBand) {
        expand();
      } else {
        collapse();
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [expand, collapse]);

  /** 记住悬停项的视口矩形，把二维码浮层钉在它左侧，并夹在视口内 */
  const handleItemEnter = useCallback(
    (index: number, element: HTMLElement | null) => {
      setHoveredIndex(index);
      if (!element) return;
      const rect = element.getBoundingClientRect();
      setFlyout({
        right: window.innerWidth - rect.left + 8,
        bottom: Math.max(
          12,
          Math.min(
            window.innerHeight - rect.bottom,
            window.innerHeight - FLYOUT_ESTIMATE_HEIGHT,
          ),
        ),
      });
    },
    [],
  );

  if (visibleItems.length === 0) return null;

  const label = t("launcher.sidebar.title", "官方社媒");
  const hoveredItem =
    hoveredIndex >= 0 ? visibleItems[hoveredIndex] : undefined;
  const hoveredTip = hoveredItem
    ? hoveredItem.title || hoveredItem.media
    : "";

  /** 收起时 32px 见方的小条，展开时图标与内边距一起变大 → 向左、向上下延伸 */
  const cell = expanded ? "h-9 w-9" : "h-8 w-8";

  return (
    <>
      {createPortal(
        <div
          ref={railRef}
          className={`fixed right-0 top-1/2 z-30 -translate-y-1/2 ${
            expanded ? "" : "pointer-events-none"
          }`}
        >
          {/* 常驻条本体：贴右边缘、只圆左侧两角 */}
          <div
            className={`flex flex-col items-center overflow-hidden rounded-l-2xl border border-r-0 shadow-2xl backdrop-blur-md transition-[padding,background-color] duration-300 ease-out ${
              expanded
                ? "border-white/10 bg-black/55 p-1.5"
                : "border-white/10 bg-black/45 p-1"
            }`}
          >
            {/* 图标列：grid-template-rows 0fr → 1fr 做高度动画，opacity 同步换内容 */}
            <div
              className="grid w-full transition-[grid-template-rows] duration-300 ease-out"
              style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
            >
              <div
                className={`flex min-h-0 flex-col items-center gap-1 transition-opacity duration-200 ease-out ${
                  expanded ? "opacity-100" : "opacity-0"
                }`}
              >
                {visibleItems.map((item, index) => {
                  const icon = iconFor(item);
                  const canOpen = Boolean(item.jump_url);
                  const tip = item.title || item.media;

                  return (
                    <button
                      key={`${item.media}-${index}`}
                      type="button"
                      aria-label={tip}
                      title={
                        canOpen
                          ? tip
                          : `${tip} · ${t(
                              "launcher.sidebar.scan_only",
                              "仅支持扫码",
                            )}`
                      }
                      aria-disabled={!canOpen ? true : undefined}
                      onMouseEnter={(e) => handleItemEnter(index, e.currentTarget)}
                      onFocus={(e) => handleItemEnter(index, e.currentTarget)}
                      onClick={() => {
                        if (!canOpen) return;
                        openInAppBrowser(item.jump_url);
                      }}
                      className={`flex shrink-0 items-center justify-center rounded-xl transition-[width,height,color,background-color] duration-300 ease-out ${cell} ${
                        canOpen
                          ? "cursor-pointer text-white/75 hover:bg-white/10 hover:text-white"
                          : "cursor-default text-white/55 hover:bg-white/10"
                      }`}
                    >
                      {item.media === "CS" ? (
                        // 客服帮助：官方图是森空岛吉祥物，改用 morphicons 的耳机图标
                        <MorphIcon icon={Headset} size={19} aria-hidden />
                      ) : icon ? (
                        <img
                          src={icon}
                          alt=""
                          aria-hidden
                          className="h-[22px] w-[22px] select-none"
                          draggable={false}
                        />
                      ) : (
                        <span className="text-[10px]">{item.media.slice(0, 3)}</span>
                      )}
                    </button>
                  );
                })}

                {/* 列表与浮标之间的分隔线，收起时随高度一起被裁掉 */}
                <span
                  className="my-0.5 h-px w-6 shrink-0 bg-white/10"
                  aria-hidden
                />
              </div>
            </div>

            {/* 浮标：常驻、始终在条的底端；无关闭按钮，离开自动收起 */}
            <button
              type="button"
              aria-label={label}
              title={label}
              aria-expanded={expanded}
              onMouseEnter={() => setHoveredIndex(-1)}
              onClick={() => (expandedRef.current ? collapse() : expand())}
              className="pointer-events-auto flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-xl text-white/80 transition-colors duration-200 hover:bg-white/10 hover:text-white"
            >
              <MorphIcon icon={Share2} size={15} aria-hidden />
            </button>
          </div>
        </div>,
        document.body,
      )}

      {/* 二维码浮层：单独 portal 到 body（避开常驻条的 transform 与 overflow 裁剪），
          纯展示层不吃指针事件，命中判定由上面的几何测量负责 */}
      {expanded &&
        flyout &&
        hoveredItem &&
        createPortal(
          <div
            ref={flyoutRef}
            className="pointer-events-none fixed z-30 animate-fade-in"
            style={{ right: flyout.right, bottom: flyout.bottom }}
          >
            <div className="flex w-max max-w-[260px] flex-col items-center gap-1.5 rounded-xl border border-white/10 bg-black/70 p-3 shadow-2xl backdrop-blur-xl">
              {hoveredItem.qr_url ? (
                <img
                  src={hoveredItem.qr_url}
                  alt={hoveredTip}
                  className="h-36 w-36 rounded-lg bg-white object-contain p-1"
                  draggable={false}
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : (
                <div className="flex h-14 min-w-[120px] items-center justify-center px-2 text-center text-xs text-white/70">
                  {hoveredTip}
                </div>
              )}
              {hoveredItem.qr_url && (
                <span className="text-[11px] text-white/70">{hoveredTip}</span>
              )}
              {hoveredItem.jump_url && (
                <span className="text-[10px] text-white/40">
                  {t("launcher.sidebar.open_hint", "点击打开网页")}
                </span>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

export default GameSidebarRail;
