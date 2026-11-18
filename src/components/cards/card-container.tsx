import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  type DragStartEvent,
  type DragEndEvent,
  type DragMoveEvent,
} from "@dnd-kit/core";
import { GlassProgressCircle } from "@/components/ui/glass";
import { MorphIcon } from "morphicons/react";
import { MapPin, TriangleAlert } from "lucide";
import { CardConfig } from "@/types/dashboard";
import { updateCardLayout } from "@/utils/dashboardConfig";
import { useLongPressDrag } from "@/hooks/useLongPressDrag";
import logger from "@/utils/logger";
import { loadAllCards } from "./registry/loader";
import { CardContextMenu, type ContextMenuItem } from "./card-context-menu";
import { confirmDialog } from "@/components/ui/confirm-dialog";

// Grid configuration
//
// 网格列的基准宽度（px）。布局坐标、拖拽吸附、卡片尺寸全部以它为单位，
// 与视口无关 —— 卡片的位置是持久化的，不能随窗口宽度漂移。
//
// 窄屏缩放：容器装不下 4 列（400px）时，整个网格按同一比例缩小
// （见 `CardContainer` 里的 `gridScale`）。坐标仍按 100 记，只是渲染时乘上
// 这个系数，所以「手机上排成几列」与桌面完全一致，不会因为窗口窄了
// 就把卡片挤成一条、或让最后一张卡探出右边缘。
const GRID_SIZE = 100; // Each grid cell is 100x100 pixels

// 窄屏断点（px），与 Tailwind 的 `sm` 对齐。
//
// 低于该宽度时，绝对定位的网格不再可用：4 列缩到 400px 以下，卡片会小到
// 看不清、且每张卡只占屏幕一角。此时改为**单列纵向堆叠**（见
// `CardContainer` 的 `isNarrow`），卡片宽度撑满内容区、高度按原网格行数
// 换算，因此手机上永远只有纵向滚动，没有横向溢出。
const NARROW_BREAKPOINT = 640;
/** 窄屏媒体查询：与 NARROW_BREAKPOINT 同源，避免两处阈值漂移 */
const NARROW_MEDIA_QUERY = `(max-width: ${NARROW_BREAKPOINT - 1}px)`;

// Generate SVG grid pattern with dashed lines (uses default token)
const generateGridSVG = (isDragging: boolean) => {
  const opacity = isDragging ? 0.3 : 0.15;
  const stroke = `hsl(var(--heroui-default-400) / ${opacity})`;
  const svg = `<svg width='${GRID_SIZE}' height='${GRID_SIZE}' xmlns='http://www.w3.org/2000/svg'>
    <defs>
      <pattern id='grid' width='${GRID_SIZE}' height='${GRID_SIZE}' patternUnits='userSpaceOnUse'>
        <path d='M ${GRID_SIZE} 0 L 0 0 0 ${GRID_SIZE}' fill='none' stroke='${stroke}' stroke-width='1' stroke-dasharray='5,5'/>
      </pattern>
    </defs>
    <rect width='100%' height='100%' fill='url(#grid)'/>
  </svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
};
export const CONTAINER_HEIGHT = 2000; // Available height (scrollable)

interface FreeDragCardProps {
  card: CardConfig;
  roleId: string;
  isEditMode: boolean;
  onRemoveCard: (cardId: string) => void;
  onUpdatePosition: (cardId: string, x: number, y: number) => void;
}

// Individual draggable card
function FreeDragCard({
  card,
  roleId,
  isEditMode,
  onRemoveCard,
  isDragging,
  showGridCoords,
  onLongPress,
  onExitEditMode,
  highlightCardId,
  gridScale = 1,
  stacked = false,
}: FreeDragCardProps & {
  isDragging?: boolean;
  showGridCoords?: boolean;
  onLongPress?: () => void;
  onExitEditMode?: () => void;
  highlightCardId?: string | null;
  /** 窄屏缩放系数：网格坐标仍是 100px 一格，渲染时统一乘以它 */
  gridScale?: number;
  /**
   * 纵向堆叠模式（窄屏）。
   *
   * `true` 时卡片不再是画布上的绝对定位块，而是普通文档流里的一行：
   * 宽度撑满内容区（`width: 100%`），高度仍按 `h * cell` 换算，于是
   * 「高几格」的语义在手机上保持可读。此时拖拽自由摆放没有意义
   * （坐标是给网格用的），因此 dnd-kit 被禁用，编辑模式只剩删除。
   */
  stacked?: boolean;
}) {
  const { t } = useTranslation();
  /** 当前缩放下的格子边长 */
  const cell = GRID_SIZE * gridScale;

  const draggable = useDraggable({
    id: card.id,
    // 堆叠模式下卡片按文档流排列，自由拖拽既无意义也会把卡片拖出画布
    disabled: !isEditMode || stacked,
  });

  const { setNodeRef, attributes, listeners, transform } = draggable;

  // Use reusable long press hook
  const {
    longPressProgress,
    handlePointerDown,
    handlePointerUp: originalHandlePointerUp,
    handlePointerLeave,
    triggerDragStart,
  } = useLongPressDrag({
    isEditMode,
    isDragging: isDragging || false,
    onLongPress,
  });

  // Create a ref to track the latest isDragging value
  const isDraggingRef = useRef(isDragging);

  // Update the ref whenever isDragging changes
  useEffect(() => {
    isDraggingRef.current = isDragging;
  }, [isDragging]);

  // Wrap handlePointerUp to check if we should exit edit mode
  const handlePointerUp = () => {
    logger.info(
      "handlePointerUp called, isEditMode: " +
        isEditMode +
        " isDragging: " +
        isDragging,
      "CardContainer",
    );

    // If in edit mode and not dragging, it means user long-pressed but didn't drag
    // In this case, we should exit edit mode
    if (isEditMode && !isDragging) {
      logger.info(
        "Pointer up in edit mode without dragging, exiting edit mode",
        "CardContainer",
      );
      // Delay slightly to allow dnd-kit to process the event
      setTimeout(() => {
        // Use the ref to get the latest value
        logger.info(
          "Checking isDraggingRef after delay: " + isDraggingRef.current,
          "CardContainer",
        );
        if (!isDraggingRef.current) {
          logger.info("Calling onExitEditMode", "CardContainer");
          onExitEditMode?.();
        }
      }, 50);
    }
    originalHandlePointerUp();
  };

  // After entering edit mode, trigger drag start if user is still holding
  useEffect(() => {
    logger.info(
      "useEffect triggered, isEditMode: " +
        isEditMode +
        " hasListeners: " +
        !!listeners?.onPointerDown,
      "CardContainer",
    );
    if (isEditMode && listeners?.onPointerDown) {
      logger.info("Calling triggerDragStart", "CardContainer");
      triggerDragStart(listeners.onPointerDown as any);
    }
  }, [isEditMode, listeners, triggerDragStart]);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const getContextMenuItems = (): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];

    if (card.type === "character_list") {
      items.push({
        key: "view-list",
        label: t("card:view_list"),
        onPress: () => {
          window.dispatchEvent(
            new CustomEvent("cardAction", {
              detail: { cardId: card.id, action: "view-list" },
            }),
          );
        },
      });
      items.push({
        key: "change-role",
        label: t("card:change_role"),
        onPress: () => {
          window.dispatchEvent(
            new CustomEvent("cardAction", {
              detail: { cardId: card.id, action: "change-role" },
            }),
          );
        },
      });
    } else if (card.type === "attendance") {
      items.push({
        key: "settings",
        label: t("card:settings"),
        onPress: () => {
          window.dispatchEvent(
            new CustomEvent("cardAction", {
              detail: { cardId: card.id, action: "settings" },
            }),
          );
        },
      });
    } else if (card.type === "achievement") {
      items.push({
        key: "select-medals",
        label: t("card:ach_select_medals"),
        onPress: () => {
          window.dispatchEvent(
            new CustomEvent("cardAction", {
              detail: { cardId: card.id, action: "select-medals" },
            }),
          );
        },
      });
      items.push({
        key: "change-role",
        label: t("card:change_role"),
        onPress: () => {
          window.dispatchEvent(
            new CustomEvent("cardAction", {
              detail: { cardId: card.id, action: "change-role" },
            }),
          );
        },
      });
    } else if (
      card.type === "account_info" ||
      card.type === "account_progress" ||
      card.type === "domain_info" ||
      card.type === "spaceship"
    ) {
      items.push({
        key: "change-role",
        label: t("card:change_role"),
        onPress: () => {
          window.dispatchEvent(
            new CustomEvent("cardAction", {
              detail: { cardId: card.id, action: "change-role" },
            }),
          );
        },
      });
      if (card.type === "domain_info") {
        items.push({
          key: "view-list",
          label: t("card:domain_info_view_list"),
          onPress: () => {
            window.dispatchEvent(
              new CustomEvent("cardAction", {
                detail: { cardId: card.id, action: "view-list" },
              }),
            );
          },
        });
        items.push({
          key: "switch-domain",
          label: t("card:domain_info_switch_domain"),
          onPress: () => {
            window.dispatchEvent(
              new CustomEvent("cardAction", {
                detail: { cardId: card.id, action: "switch-domain" },
              }),
            );
          },
        });
      }
    }

    if (card.type === "system_resource") {
      items.push({
        key: "sr-settings",
        label: t("card:system_resource_settings"),
        onPress: () => {
          window.dispatchEvent(
            new CustomEvent("cardAction", {
              detail: { cardId: card.id, action: "system-resource-settings" },
            }),
          );
        },
      });
      items.push({
        key: "sr-refresh",
        label: t("card:system_resource_refresh_now"),
        onPress: () => {
          window.dispatchEvent(
            new CustomEvent("cardAction", {
              detail: { cardId: card.id, action: "refresh" },
            }),
          );
        },
      });
    }

    // Universal "刷新" menu item — let each card type handle its own data refresh.
    items.push({
      key: "refresh",
      label: t("card:refresh"),
      onPress: () => {
        window.dispatchEvent(
          new CustomEvent("cardAction", {
            detail: { cardId: card.id, action: "refresh" },
          }),
        );
      },
    });

    if (card.type === "todo") {
      const dispatch = (action: string) => {
        window.dispatchEvent(
          new CustomEvent("cardAction", {
            detail: { cardId: card.id, action },
          }),
        );
      };
      items.push({ key: "todo-edit", label: t("card:todo_edit_modal"), onPress: () => dispatch("todo-edit") });
      items.push({ key: "todo-open-page", label: t("card:todo_open_page"), onPress: () => dispatch("todo-open-page") });
      items.push({ key: "todo-rename", label: t("card:todo_rename"), onPress: () => dispatch("todo-rename") });
      items.push({ key: "todo-duplicate", label: t("card:todo_duplicate"), onPress: () => dispatch("todo-duplicate") });
      items.push({ key: "todo-sort", label: t("card:todo_sort_mode"), onPress: () => dispatch("todo-sort") });
      items.push({ key: "todo-hide-completed", label: t("card:todo_hide_completed"), onPress: () => dispatch("todo-hide-completed") });
      items.push({ key: "todo-clear-completed", label: t("card:todo_clear_completed"), onPress: () => dispatch("todo-clear-completed") });
      items.push({ key: "todo-color-icon", label: t("card:todo_color_icon"), onPress: () => dispatch("todo-color-icon") });
      items.push({
        key: "todo-delete-list",
        label: t("card:todo_delete_list"),
        danger: true,
        onPress: () => dispatch("todo-delete-list"),
      });
    }

    items.push({
      key: "delete",
      label: t("common.delete"),
      danger: true,
      onPress: () => {
        confirmDialog({
          title: t("card:confirm_delete_title"),
          body: t("card:confirm_delete_body"),
          confirmText: t("common.delete"),
          cancelText: t("common.cancel"),
          tone: "danger",
        }).then((confirmed) => {
          if (confirmed) onRemoveCard(card.id);
        });
      },
    });

    return items;
  };

  // Calculate position from grid coordinates (offset by 1px for card gap)
  const x = (card.x ?? 0) * cell + 1;
  const y = (card.y ?? 0) * cell + 1;

  // Apply transform if dragging.
  //
  // 拖拽位移来自 dnd-kit 的像素值，是**已经乘过缩放**的实际位移，
  // 不能再乘 cell —— 直接相加即可。
  //
  // 堆叠模式（窄屏）下卡片回到文档流：宽度 100%，高度仍按网格行数换算，
  // 于是「这卡高两格」在任何屏宽下读起来一样。绝对定位 / 拖拽位移一律不写，
  // 否则卡片会脱离文档流又叠回左上角。
  const style: React.CSSProperties = stacked
    ? {
        position: "relative",
        width: "100%",
        height: (card.h ?? 2) * cell - 2, // Default 3x2
        cursor: "default",
        // 纵向堆叠时高度就是内容高度：禁止 flex 收缩，否则父容器一旦
        // 有高度约束，卡片会被压扁成几条。
        flexShrink: 0,
        opacity: isDragging ? 0 : 1,
        visibility: isDragging ? "hidden" : "visible",
      }
    : {
        position: "absolute",
        left: x,
        top: y,
        width: (card.w ?? 3) * cell - 2,
        height: (card.h ?? 2) * cell - 2, // Default 3x2
        transform: transform
          ? `translate(${transform.x}px, ${transform.y}px)`
          : undefined,
        cursor: isEditMode ? "grab" : "default",
        // Hide original card when dragging to prevent ghosting
        opacity: isDragging ? 0 : 1,
        visibility: isDragging ? "hidden" : "visible",
      };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-card-id={card.id}
      className={`dashboard-card-shell group ${isEditMode && !stacked ? "active:cursor-grabbing" : "card-hover cursor-default"} ${
        card.id === highlightCardId ? "card-flash-highlight" : ""
      }`}
      {...(isEditMode && !stacked ? { ...attributes, ...listeners } : {})}
      onContextMenu={handleContextMenu}
      onPointerDown={(e) => {
        // 堆叠模式没有拖拽：长按进编辑也没意义（没有可以摆放的位置），
        // 直接不接管指针事件，把事件留给卡片内容自己的点击。
        if (stacked) return;
        // In edit mode, let dnd-kit handle everything
        if (isEditMode) {
          if (listeners?.onPointerDown) {
            listeners.onPointerDown(e);
          }
        } else {
          // Not in edit mode - handle long press to enter edit mode
          handlePointerDown(e);
        }
      }}
      onPointerUp={(e) => {
        // 堆叠模式下没有长按/拖拽状态要收尾
        if (stacked) return;

        // Always call our custom handlePointerUp first
        handlePointerUp();

        // Then let dnd-kit handle it if in edit mode
        if (isEditMode) {
          if (listeners?.onPointerUp) {
            listeners.onPointerUp(e);
          }
        }
      }}
      onPointerLeave={() => {
        if (!isEditMode && !stacked) {
          handlePointerLeave();
        }
      }}
    >
      {/* Long Press Progress Circle - Top Right Corner */}
      {!isEditMode && !isDragging && !stacked && longPressProgress > 0 && (
        <div className="absolute top-2 right-2 z-50 pointer-events-none">
          <GlassProgressCircle
            aria-label="Loading"
            value={longPressProgress}
            size="sm"
            className="w-12 h-12 text-primary"
          >
            <GlassProgressCircle.Track>
              <GlassProgressCircle.TrackCircle />
              <GlassProgressCircle.FillCircle />
            </GlassProgressCircle.Track>
          </GlassProgressCircle>
          {/* Progress percentage text */}
          <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-primary-text drop-shadow-md">
            {Math.round(longPressProgress)}%
          </div>
        </div>
      )}

      {/* Grid Coordinates Display - Show when dragging */}
      {showGridCoords && (
        <div className="absolute -top-8 left-0 z-30 px-2 py-1 lg-regular rounded shadow-lg text-xs font-mono whitespace-nowrap">
          <span className="text-primary-text">Row: {card.y ?? 0}</span>
          <span className="mx-2 text-divider">|</span>
          <span className="text-secondary">Col: {card.x ?? 0}</span>
        </div>
      )}

      {/* Delete Button - Hide when dragging */}
      {isEditMode && !isDragging && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemoveCard(card.id);
          }}
          onPointerDown={(e) => {
            // 阻止指针事件传播，避免触发父元素的 onPointerUp
            e.stopPropagation();
          }}
          onPointerUp={(e) => {
            // 阻止指针事件传播，避免触发父元素的 onPointerUp
            e.stopPropagation();
          }}
          className="absolute top-2 right-2 z-20 p-1 bg-content1 rounded-full shadow-md hover:bg-danger/10 text-danger-text"
          aria-label="Delete card"
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}

      {/* Card Content */}
      <div className="h-full w-full">
        {(() => {
          const cardRegistry = loadAllCards();
          const CardComponent = cardRegistry.get(card.type)?.component;

          if (!CardComponent) {
            return (
              <div className="p-6 lg-material border border-separator/90 rounded-[10px] h-full w-full">
                <p className="text-danger-text text-center">
                  Unknown card type: {card.type}
                </p>
              </div>
            );
          }

          return (
            <CardComponent
              roleId={roleId}
              cardId={card.id}
              settings={card.settings}
              isEditMode={isEditMode}
              w={card.w ?? 3}
              h={card.h ?? 2}
            />
          );
        })()}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <CardContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getContextMenuItems()}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

interface CardContainerProps {
  roleId: string;
  tabId?: string;
  cards: CardConfig[];
  onRemoveCard: (cardId: string) => void;
  isEditMode?: boolean;
  onEnterEditMode?: () => void; // Callback for long press to enter edit mode
  onExitEditMode?: () => void; // Callback for exiting edit mode after drag
  highlightCardId?: string | null; // Card to flash after being added
}

export function CardContainer({
  roleId,
  tabId,
  cards,
  onRemoveCard,
  isEditMode = false,
  onEnterEditMode,
  onExitEditMode,
  highlightCardId,
}: CardContainerProps) {
  const { t } = useTranslation();
  const [sortedCards, setSortedCards] = useState<CardConfig[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [extraHeight, setExtraHeight] = useState(0);
  const [draggedViaLongPress, setDraggedViaLongPress] = useState(false);
  const [highlightGrid, setHighlightGrid] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [hasCollision, setHasCollision] = useState(false);
  const sortedCardsRef = useRef<CardConfig[]>(sortedCards);

  // ========== 窄屏缩放 ==========
  //
  // 卡片的坐标与尺寸都以 100px 的格子记（见 GRID_SIZE），布局是绝对定位、
  // 宽度写死的。容器一旦窄于 `GRID_COLS * 100`，最后一张卡就会探出右边缘：
  // 在 411px 宽的手机上，一行的 4 列 = 398px 而内容区只有 379px，
  // 于是整页横向溢出 4px（卡片贴着右边缘、还能横向拖动）。
  //
  // 修法不是改坐标（那是持久化的用户布局），而是整体缩放渲染：
  // 按 `containerWidth / (GRID_COLS * 100)` 求一个 ≤ 1 的系数，
  // 格子边长、卡片尺寸、拖拽吸附全部乘以它。桌面宽屏系数恒为 1，行为不变。
  //
  // 但一直缩下去没有尽头：400px 时系数 0.99 还好，320px 就只剩 0.79，
  // 4 列各占 79px，卡片内容全被压扁。所以**屏幕**窄于 NARROW_BREAKPOINT 时
  // 不再缩放，改用 `isNarrow` 切到单列堆叠（见 `FreeDragCard` 的 `stacked`）。
  const GRID_COLS = 4;
  const [gridScale, setGridScale] = useState(1);

  // 窄屏以**视口**为准（用户说的「屏幕为窄屏」），不用内容区宽度：
  // 内容区还受侧栏展开与否影响，用它会关掉侧栏就换布局、来回跳。
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia(NARROW_MEDIA_QUERY).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(NARROW_MEDIA_QUERY);
    const sync = () => setIsNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const observerRef = useRef<ResizeObserver | null>(null);

  // 用回调 ref 而不是 useEffect 起观察者：空列表时本组件会提前 return，
  // 网格 div 根本不存在，`useEffect(() => {...}, [])` 只会跑在没有节点的
  // 那一刻然后永远不再跑 —— 加进第一张卡时测量结果仍是初值，手机上
  // 第一张卡就会横向溢出。挂在 ref 上则节点出现/消失都会重新测量。
  const gridAreaRef = useCallback(
    (el: HTMLDivElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!el) return;

      const measure = () => {
        const width = el.clientWidth;
        if (width <= 0) return;
        // 堆叠模式下宽度已是 100%，格子边长只用来定**高度**；
        // 若继续按视口缩放，越窄的手机卡片越矮，最后挤成一条。
        // 所以窄屏固定 1:1（一「行」就是 100px），宽屏才按列宽收缩。
        // 留 1px 余量，避免亚像素舍入造成的新溢出。
        const scale = isNarrow
          ? 1
          : Math.min(1, (width - 1) / (GRID_COLS * GRID_SIZE));
        setGridScale((prev) => (Math.abs(prev - scale) < 0.001 ? prev : scale));
      };

      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      observerRef.current = observer;
    },
    [isNarrow],
  );

  useEffect(() => () => observerRef.current?.disconnect(), []);

  /** 当前缩放下的格子边长 */
  const cell = GRID_SIZE * gridScale;

  useEffect(() => {
    sortedCardsRef.current = sortedCards;
  }, [sortedCards]);

  // 卡片自身请求调整尺寸（如系统资源卡片的「卡片尺寸」设置）
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { cardId?: string; w?: number; h?: number }
        | undefined;
      if (!detail?.cardId) return;
      const target = sortedCardsRef.current.find((c) => c.id === detail.cardId);
      if (!target) return;
      const w = Math.max(1, Math.min(20, Math.round(detail.w ?? target.w ?? 3)));
      const h = Math.max(1, Math.min(20, Math.round(detail.h ?? target.h ?? 2)));
      if (w === (target.w ?? 3) && h === (target.h ?? 2)) return;
      setSortedCards((prev) =>
        prev.map((c) => (c.id === detail.cardId ? { ...c, w, h } : c)),
      );
      void updateCardLayout(tabId ?? roleId, detail.cardId, {
        x: target.x ?? 0,
        y: target.y ?? 0,
        w,
        h,
      });
      window.dispatchEvent(
        new CustomEvent("cardLayoutChanged", { detail: { tabId: tabId ?? roleId } }),
      );
    };
    window.addEventListener("cardResize", handler);
    return () => window.removeEventListener("cardResize", handler);
  }, [tabId, roleId]);

  // Sort and initialize cards
  useEffect(() => {
    const sorted = [...cards].sort((a, b) => a.position - b.position);

    // Assign default positions to cards without x,y coordinates
    const cardsWithPositions = sorted.map((card, index) => {
      if (card.x === undefined || card.y === undefined) {
        // Calculate default position: 3 cards per row, each card is 2 grid units high
        const col = index % 3;
        const row = Math.floor(index / 3);
        return {
          ...card,
          x: col,
          y: row * 2, // Each row is 2 grid units high
          w: card.w ?? 3,
          h: card.h ?? 2,
        };
      }
      return card;
    });

    setSortedCards(cardsWithPositions);
  }, [cards.length]);

  // Calculate required container height based on card positions
  const containerHeight = useMemo(() => {
    if (sortedCards.length === 0) return 100;

    let maxY = 0;
    for (const card of sortedCards) {
      const cardBottom = ((card.y ?? 0) + (card.h ?? 2)) * cell;
      maxY = Math.max(maxY, cardBottom);
    }

    // Add padding and extra height during drag
    const basePadding = 100 * gridScale;
    return maxY + basePadding + extraHeight;
  }, [sortedCards, extraHeight, cell, gridScale]);

  // Configure sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
  );

  // Snap to grid helper
  //
  // 拖拽位移是像素值；除以 `cell`（当前缩放下的格子边长）再取整，
  // 得到的才是**网格坐标**。若仍除以固定的 GRID_SIZE，窄屏（缩放 < 1）下
  // 拖动一格会被算成不足一格、吸附不上去。
  const snapToGrid = useCallback(
    (value: number) => {
      return Math.round(value / cell) * cell;
    },
    [cell],
  );

  // Handle drag start
  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
    setIsDragging(true);
    logger.info("Drag started: " + event.active.id, "CardContainer");
  };

  // Track mouse position during drag
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY });
    };

    // Also listen to pointermove for better compatibility with dnd-kit
    const handlePointerMove = (e: PointerEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY });
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("pointermove", handlePointerMove);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("pointermove", handlePointerMove);
    };
  }, [isDragging]);

  // Auto-scroll and expand when dragging near bottom edge
  useEffect(() => {
    if (!isDragging) return;

    const checkAutoScroll = () => {
      const windowHeight = window.innerHeight;
      const mouseY = mousePosition.y;

      // Calculate mouse position relative to viewport bottom
      const distanceFromBottom = windowHeight - mouseY;

      // If mouse is within 150px of bottom edge
      if (distanceFromBottom < 150 && distanceFromBottom > 0) {
        // Scroll down smoothly - speed increases as you get closer to edge
        const scrollSpeed = Math.max(10, (150 - distanceFromBottom) / 3);
        window.scrollBy({ top: scrollSpeed, behavior: "auto" });
      }
    };

    const interval = setInterval(checkAutoScroll, 50);
    return () => clearInterval(interval);
  }, [isDragging, mousePosition]);

  // Handle drag move - auto scroll based on dragged element position
  const handleDragMove = (event: DragMoveEvent) => {
    const windowHeight = window.innerHeight;

    // Method 1: Use the dragged card's rect if available
    let cardBottom: number | null = null;
    let cardLeft: number | null = null;

    if (event.active.rect.current.translated) {
      const rect = event.active.rect.current.translated;
      cardBottom = rect.top + rect.height;
      cardLeft = rect.left;
    }
    // Method 2: Fallback to mouse position
    else if (mousePosition.y > 0) {
      cardBottom = mousePosition.y;
      cardLeft = mousePosition.x;
    }

    if (cardBottom === null || cardLeft === null) return;

    const distanceFromBottom = windowHeight - cardBottom;

    // If card is near bottom edge, scroll down and expand
    if (distanceFromBottom < 200 && distanceFromBottom > -100) {
      const scrollSpeed = Math.max(15, (200 - distanceFromBottom) / 2);
      window.scrollBy({ top: scrollSpeed, behavior: "auto" });

      // Expand container height as we scroll
      setExtraHeight((prev) => prev + scrollSpeed);
    }

    // Calculate and highlight the target grid cell
    // Use delta to calculate the new position relative to the original position
    const card = sortedCards.find((c) => c.id === event.active.id);

    if (card && event.delta) {
      // Get the current grid position
      const currentGridX = card.x ?? 0;
      const currentGridY = card.y ?? 0;

      // Calculate the offset in grid units
      const offsetX = Math.round(event.delta.x / cell);
      const offsetY = Math.round(event.delta.y / cell);

      // Calculate the new grid position
      const newGridX = Math.max(0, currentGridX + offsetX);
      const newGridY = Math.max(0, currentGridY + offsetY);

      const cardW = card.w ?? 3;
      const cardH = card.h ?? 2;

      // Check for collision with other cards
      const collision = sortedCards.some((otherCard) => {
        if (otherCard.id === card.id) return false; // Skip self

        const otherX = otherCard.x ?? 0;
        const otherY = otherCard.y ?? 0;
        const otherW = otherCard.w ?? 3;
        const otherH = otherCard.h ?? 2;

        // Check if rectangles overlap
        return (
          newGridX < otherX + otherW &&
          newGridX + cardW > otherX &&
          newGridY < otherY + otherH &&
          newGridY + cardH > otherY
        );
      });

      setHasCollision(collision);

      logger.info(
        "Highlight update: currentGrid=(" +
          currentGridX +
          "," +
          currentGridY +
          ") delta=(" +
          event.delta.x +
          "," +
          event.delta.y +
          ") newGrid=(" +
          newGridX +
          "," +
          newGridY +
          ") collision=" +
          collision,
        "CardContainer",
      );

      setHighlightGrid({
        x: newGridX,
        y: newGridY,
        w: cardW,
        h: cardH,
      });
    }
  };

  // Handle drag end - snap to grid
  const handleDragEnd = async (event: DragEndEvent) => {
    logger.info(
      "handleDragEnd called: draggedViaLongPress=" +
        draggedViaLongPress +
        " activeId=" +
        event.active.id +
        " delta=" +
        JSON.stringify(event.delta),
      "CardContainer",
    );
    const { active, delta } = event;
    setActiveId(null);
    setIsDragging(false);
    setExtraHeight(0); // Reset extra height after drag
    setHighlightGrid(null); // Clear highlight
    setHasCollision(false); // Reset collision state
    logger.info("States cleared", "CardContainer");

    // Exit edit mode if entered via long press (even without dragging)
    if (draggedViaLongPress && onExitEditMode) {
      logger.info(
        "Exiting edit mode after long press (with or without drag)",
        "CardContainer",
      );
      onExitEditMode();
      setDraggedViaLongPress(false);
    }

    // If no delta, exit early (no position update needed)
    if (!delta) {
      logger.info("No delta, exiting early", "CardContainer");
      return;
    }

    const card = sortedCards.find((c) => c.id === active.id);
    if (!card) return;

    // Calculate new position（全部换算成当前缩放下的像素）
    const currentX = (card.x ?? 0) * cell;
    const currentY = (card.y ?? 0) * cell;

    const newX = snapToGrid(currentX + delta.x);
    const newY = snapToGrid(currentY + delta.y);

    // Convert back to grid coordinates
    const gridX = Math.max(0, Math.round(newX / cell));
    const gridY = Math.max(0, Math.round(newY / cell));

    const cardW = card.w ?? 3;
    const cardH = card.h ?? 2;

    // Check for collision with other cards
    const hasCollision = sortedCards.some((otherCard) => {
      if (otherCard.id === card.id) return false; // Skip self

      const otherX = otherCard.x ?? 0;
      const otherY = otherCard.y ?? 0;
      const otherW = otherCard.w ?? 3;
      const otherH = otherCard.h ?? 2;

      // Check if rectangles overlap
      return (
        gridX < otherX + otherW &&
        gridX + cardW > otherX &&
        gridY < otherY + otherH &&
        gridY + cardH > otherY
      );
    });

    if (hasCollision) {
      // Collision detected - card will snap back to original position (no update)
      logger.info(
        "Collision detected, reverting to original position",
        "CardContainer",
      );
      return;
    }

    // Update card position
    const updatedCards = sortedCards.map((c) =>
      c.id === card.id ? { ...c, x: gridX, y: gridY } : c,
    );

    setSortedCards(updatedCards);

    // Save to config
    const layoutTabId = tabId ?? roleId;
    await updateCardLayout(layoutTabId, card.id, {
      x: gridX,
      y: gridY,
      w: cardW,
      h: cardH,
    });
  };

  // Find active card for overlay
  const activeCard = activeId
    ? sortedCards.find((card) => card.id === activeId)
    : null;

  /**
   * 实际渲染顺序。
   *
   * 宽屏照旧用 `sortedCards`（按 `position`，位置由绝对定位决定、顺序无关）。
   * 窄屏是文档流堆叠，顺序直接决定阅读顺序，所以改按**视觉位置**排：
   * 先按 `y` 分排、同排按 `x`。这样手机上看到的先后与桌面网格完全一致，
   * 用户不会因为「`position` 是添加顺序、`x/y` 是拖拽后位置」两者错位，
   * 而发现同一批卡片在手机上换了次序。
   */
  const displayCards = useMemo(() => {
    if (!isNarrow) return sortedCards;
    return [...sortedCards].sort(
      (a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0),
    );
  }, [sortedCards, isNarrow]);

  // Debug: Log rendering state
  useEffect(() => {
    logger.info(
      "Render state: " +
        JSON.stringify({ isDragging, highlightGrid, activeId }),
      "CardContainer",
    );
  }, [isDragging, highlightGrid, activeId]);

  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-80 text-center px-6">
        <div className="w-16 h-16 rounded-2xl lg-inset flex items-center justify-center mb-4">
          <svg
            className="w-8 h-8 text-muted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 4v16m8-8H4"
            />
          </svg>
        </div>
        <p className="text-lg font-medium text-foreground mb-2">
          {t("dashboard.no_cards")}
        </p>
        <p className="text-sm text-muted max-w-sm">
          {t("dashboard.no_cards_guide") ||
            "Click the + button at the bottom right to add cards and customize your dashboard"}
        </p>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
    >
      <div
        ref={gridAreaRef}
        className="relative w-full"
        style={{
          // 堆叠模式没有网格坐标可供参照，画网格只会变成背景噪点
          backgroundImage:
            !isNarrow && (isEditMode || isDragging)
              ? generateGridSVG(isDragging)
              : "none",
          backgroundSize: `${cell}px ${cell}px`,
        }}
      >
        {/* Highlight Grid Cell - Fill the entire grid area */}
        {!isNarrow && isDragging && highlightGrid && (
          <div
            className={`absolute pointer-events-none transition-all duration-150 ease-out rounded-lg border-[3px] z-[100] ${
              hasCollision
                ? "bg-danger/30 border-danger shadow-[0_0_30px_hsl(var(--heroui-danger)/0.6),inset_0_0_40px_hsl(var(--heroui-danger)/0.2)]"
                : "bg-primary/30 border-primary shadow-[0_0_30px_hsl(var(--heroui-primary)/0.6),inset_0_0_40px_hsl(var(--heroui-primary)/0.2)]"
            }`}
            style={{
              left: highlightGrid.x * cell + 1,
              top: highlightGrid.y * cell + 1,
              width: highlightGrid.w * cell - 2,
              height: highlightGrid.h * cell - 2,
            }}
            data-testid="highlight-grid"
          >
            <div
              className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-sm font-bold bg-content1/90 px-3 py-2 rounded shadow-lg whitespace-nowrap flex items-center gap-1 ${
                hasCollision ? "text-danger-text" : "text-primary-text"
              }`}
            >
              <MorphIcon icon={MapPin} size={14} />({highlightGrid.x},{" "}
              {highlightGrid.y}) {highlightGrid.w}x{highlightGrid.h}
              {hasCollision && <MorphIcon icon={TriangleAlert} size={14} />}
            </div>
          </div>
        )}
        {/* Grid Coordinate Labels */}
        {!isNarrow && (isEditMode || isDragging) && (
          <div className="absolute inset-0 pointer-events-none">
            {Array.from({ length: Math.ceil(containerHeight / cell) }).map(
              (_, rowIndex) => (
                <div
                  key={`row-${rowIndex}`}
                  className="absolute left-2 text-xs text-muted/50 font-mono"
                  style={{ top: rowIndex * cell + 4 }}
                >
                  {rowIndex}
                </div>
              ),
            )}
            {Array.from({ length: 20 }).map((_, colIndex) => (
              <div
                key={`col-${colIndex}`}
                className="absolute top-2 text-xs text-muted/50 font-mono"
                style={{ left: colIndex * cell + 4 }}
              >
                {colIndex}
              </div>
            ))}
          </div>
        )}
        {/* Container with dynamic height */}
        <div
          className={isNarrow ? "relative w-full flex flex-col" : "relative w-full"}
          style={
            isNarrow
              ? // 堆叠模式下高度由内容决定：卡片依次排开，间距用 margin 兜住，
                // 不用 minHeight（那 N 张卡会先被拉成一张 2000px 的空画布）
                { rowGap: 12 }
              : { minHeight: containerHeight }
          }
        >
          {displayCards.map((card) => (
            <FreeDragCard
              key={card.id}
              card={card}
              roleId={roleId}
              isEditMode={isEditMode}
              onRemoveCard={onRemoveCard}
              onUpdatePosition={() => {}}
              isDragging={activeId === card.id}
              showGridCoords={isDragging && activeId === card.id}
              highlightCardId={highlightCardId}
              gridScale={gridScale}
              stacked={isNarrow}
              onLongPress={() => {
                onEnterEditMode?.();
                setDraggedViaLongPress(true);
              }}
              onExitEditMode={onExitEditMode}
            />
          ))}
        </div>
      </div>

      {/* Drag Overlay — portaled to body so backdrop-filter ancestors don't break position:fixed（注释保留：该前提在新玻璃体系下依然成立） */}
      {createPortal(
        <DragOverlay dropAnimation={null}>
          {activeCard ? (
            <div
              // 拖拽幽灵同样套壳：与画布上卡片一致的底色/圆角/阴影
              className="dashboard-card-shell opacity-80 scale-105 rotate-2"
              style={{
                width: (activeCard.w ?? 3) * cell - 2,
                height: (activeCard.h ?? 2) * cell - 2,
              }}
            >
              {(() => {
                const cardRegistry = loadAllCards();
                const CardComponent = cardRegistry.get(
                  activeCard.type,
                )?.component;

                if (!CardComponent) {
                  return null;
                }

                return (
                  <CardComponent
                    roleId={roleId}
                    cardId={activeCard.id}
                    settings={activeCard.settings}
                    isEditMode={isEditMode}
                    w={activeCard.w ?? 3}
                    h={activeCard.h ?? 2}
                  />
                );
              })()}
            </div>
          ) : null}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
}
