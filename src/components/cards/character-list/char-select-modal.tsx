import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import { createPortal } from "react-dom";
import {
  GlassAlert,
  GlassButton,
  GlassProgressCircle,
} from "@/components/ui/glass";
import {
  CustomModal,
  CustomModalHeader,
  CustomModalBody,
} from "@/components/custom-modal";
import { CharDetailData, CharacterItem } from "@/types/charDetail";
import {
  getWikiRenderedBlocks,
  renderWikiBlocksFromIds,
  getUpgradeMaterials,
  findContentIds,
  extractCell,
  WIKI_COLOR_MAP,
} from "@/utils/wikiTableParser";
import { useTranslation } from "react-i18next";
import { Img } from "@/utils/imageLoader";
import { useImageRequest } from "@/utils/imageCacheManager";
import { roleDataService } from "@/utils/roleDataService";
import { getConfig } from "@/utils/configService";
import { logError } from "@/utils/logger";

const SKILL_BG_COLORS: Record<string, string> = {
  skill_property_pulse: "#ffc000",
  skill_property_fire: "#fe623d",
  skill_property_natural: "#abbf00",
  skill_property_cryst: "#21c6d0",
  skill_property_physical: "#5e5e5e",
};
const SKILL_BG_CIRCLE = "#6d6d6d";

// ====== 图标资源路径（占位，等用户提供资源文件）======
// 职业图标：/assets/icons/profession/<profession.key>.png
//   已知 key 例子：profession_caster, profession_guard, profession_medic, profession_sniper, ...
// 属性图标：/assets/icons/property/<property.key>.png
//   已知 key 例子：char_property_cryst, char_property_phys, ...
// 资源就位后，本组件无需改动，直接可用
const ICON_BASE = "/assets/icons";
const professionIconUrl = (key: string) => `${ICON_BASE}/profession/${key}.png`;
const propertyIconUrl = (key: string) => `${ICON_BASE}/property/${key}.png`;
const RARITY_ICON_URL = "/assets/rarity.svg";

type FilterKey =
  "profession" | "rarity" | "property" | "weapon" | "mainAttr" | "subAttr";

interface CharSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  charDetail: CharDetailData;
  selectedCharIds: string[];
  onSave: (selectedIds: string[]) => void;
  roleId: string;
  initialCharId?: string;
  initialViewMode?: "list" | "detail";
  maxSlots?: number;
}

// ====== 稀有度色阶（WIKI 风格的稀有度 tone）======
function rarityTone(value: string): "orange" | "gold" | "purple" | "blue" {
  if (value === "6") return "orange";
  if (value === "5") return "gold";
  if (value === "4") return "purple";
  return "blue";
}
const rarityToneClass: Record<ReturnType<typeof rarityTone>, string> = {
  orange: "text-orange-500",
  gold: "text-yellow-500",
  purple: "text-purple-500",
  blue: "text-blue-500",
};

// ====== WIKI 风格 FloatSelect ======
// 仿 WIKI 的 FloatSelect__SelectTrigger：标签 + 下拉箭头
// 点开后是绝对定位的下拉面板；点击外部自动关闭
interface FloatSelectOption {
  value: string;
  label: string;
  tone?: ReturnType<typeof rarityTone>;
}
function FloatSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: FloatSelectOption[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // Portal target — the nearest .glass-surface-strong ancestor.
  // This keeps the dropdown inside the modal's overlay tree so React Aria
  // doesn't treat clicks on it as "outside" interactions.
  const portalTargetRef = useRef<HTMLElement | null>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (dropdownRef.current?.contains(e.target as Node)) return;
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onScroll = (e: Event) => {
      // Don't close when scrolling inside the dropdown itself.
      if (e.target instanceof Node && dropdownRef.current?.contains(e.target))
        return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const current = options.find((o) => o.value === value) ?? options[0];

  const handleToggle = () => {
    const next = !open;
    if (next && btnRef.current) {
      const btnRect = btnRef.current.getBoundingClientRect();
      // Find the modal dialog (glass-surface-strong) to use as both the
      // portal target and the positioning reference. When rendered inside a
      // HeroUI Modal, the dialog's backdrop-filter creates a containing block,
      // so we must position relative to the dialog, not the viewport.
      const dialog = btnRef.current.closest(
        ".glass-surface-strong",
      ) as HTMLElement | null;
      portalTargetRef.current = dialog;
      if (dialog) {
        const dialogRect = dialog.getBoundingClientRect();
        setDropdownPos({
          top: btnRect.bottom - dialogRect.top + 6,
          left: btnRect.left - dialogRect.left,
          width: Math.max(btnRect.width, 120),
        });
      } else {
        // Fallback: no modal dialog found, use viewport coordinates.
        setDropdownPos({
          top: btnRect.bottom + 6,
          left: btnRect.left,
          width: Math.max(btnRect.width, 120),
        });
      }
    }
    setOpen(next);
  };

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        ref={btnRef}
        type="button"
        onClick={handleToggle}
        className={`flex items-center gap-1.5 h-8 pl-2.5 pr-2 rounded-md border text-xs transition-colors cursor-pointer
          ${open ? "border-blue-500 bg-white dark:bg-neutral-800" : "border-separator bg-white dark:bg-neutral-800 hover:border-blue-400/60"}`}
      >
        <span className="text-muted">{label}</span>
        <span
          className={`font-semibold ${current?.tone ? rarityToneClass[current.tone] : "text-foreground"}`}
        >
          {current?.label ?? "—"}
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 12 12"
          className={`w-3 h-3 text-default-500 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path
            fill="currentColor"
            fillRule="evenodd"
            d="M6 8.617 2.04 4.289h7.92z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[999] min-w-[120px] max-h-64 overflow-y-auto rounded-xl border border-separator/60 bg-background glass-surface-strong shadow-xl animate-scale-in"
            style={{
              top: dropdownPos.top,
              left: dropdownPos.left,
              width: Math.max(120, dropdownPos.width || 0),
            }}
            onClick={(e) => e.stopPropagation()}
            onWheel={(e) => {
              // Block wheel events from propagating to the modal body behind.
              e.stopPropagation();
            }}
          >
            {options.map((opt) => {
              const active = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-xs whitespace-nowrap transition-colors cursor-pointer
                  ${active ? "bg-blue-500/15 text-blue-500 font-semibold" : "text-foreground hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
                >
                  {opt.tone ? (
                    <span className={rarityToneClass[opt.tone]}>
                      {opt.label}
                    </span>
                  ) : (
                    opt.label
                  )}
                </button>
              );
            })}
          </div>,
          portalTargetRef.current || document.body,
        )}
    </div>
  );
}

// ====== WIKI OperatorCard ======
// 复刻 WIKI 列表卡：全幅立绘背景 + 渐变蒙版 + 顶角稀有度星 + 右上 pin/LED + 底栏图标+名称+稀有度色条
function OperatorCard({
  char,
  isPinned,
  onOpenDetail,
  onDragMouseDown,
}: {
  char: CharacterItem;
  isPinned: boolean;
  onOpenDetail: () => void;
  onDragMouseDown: (charId: string, e: React.MouseEvent) => void;
}) {
  const data = char.charData;
  const coverUrl = data.illustrationUrl || data.avatarRtUrl || data.avatarSqUrl;
  const rarityValue = data.rarity.value;
  const lineColor = rarityLineColorLocal(rarityValue);
  const isDraggingRef = useRef(false);

  return (
    <div
      className={`group relative aspect-[3/4] rounded-lg overflow-hidden border glass-surface cursor-pointer transition-all duration-200
        ${isPinned ? "border-blue-500 ring-1 ring-blue-500/40" : "border-separator hover:border-blue-400/60 hover:shadow-md"}`}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => {
        isDraggingRef.current = false;
        onDragMouseDown(char.charData.id, e);
        const checkMove = () => {
          isDraggingRef.current = true;
          document.removeEventListener("mousemove", checkMove);
        };
        document.addEventListener("mousemove", checkMove);
        document.addEventListener(
          "mouseup",
          () => document.removeEventListener("mousemove", checkMove),
          { once: true },
        );
      }}
      onDragStart={(e) => e.preventDefault()}
      onClick={(e) => {
        if (isDraggingRef.current) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        onOpenDetail();
      }}
    >
      {/* 全幅立绘（走 imageCacheManager 转 blob URL，object-cover 铺满） */}
      <Img
        src={coverUrl}
        alt={data.name}
        className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
        loading="lazy"
        draggable={false}
      />
      {/* 顶部轻微渐变（角标可读） */}
      <div className="absolute inset-x-0 top-0 h-1/5 bg-gradient-to-b from-black/55 to-transparent pointer-events-none" />

      {/* 左上：profession + property 图标，垂直堆叠，无底 */}
      <div className="absolute top-1.5 left-1.5 z-10 flex flex-col gap-0.5">
        <img
          src={professionIconUrl(data.profession.key)}
          alt={data.profession.value}
          title={data.profession.value}
          className="w-6 h-6 object-contain drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
          }}
        />
        <img
          src={propertyIconUrl(data.property.key)}
          alt={data.property.value}
          title={data.property.value}
          className="w-6 h-6 object-contain drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
          }}
        />
      </div>

      {/* 右上：已选中状态指示 */}
      <div className="absolute top-1.5 right-1.5 z-10">
        {isPinned && (
          <div
            className="w-2.5 h-2.5 rounded-full bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.85)]"
            title="Pinned"
          />
        )}
      </div>

      {/* 右下：potential 图标（potential 为 0 时不显示） */}
      {char.potentialLevel != null && char.potentialLevel > 0 && (
        <div className="absolute bottom-[33px] right-1.5 z-10">
          <img
            src={`/assets/icons/potential/potential_${char.potentialLevel}.png`}
            alt=""
            className="w-7 h-7 object-contain drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]"
          />
        </div>
      )}

      {/* 底栏：透明 + 名字 + 稀有度色条 */}
      <div className="absolute inset-x-0 bottom-0 z-10">
        <div className="px-2 py-1 flex items-center gap-1.5">
          <div className="flex items-center gap-1 shrink-0">
            {char.evolvePhase != null && (
              <img
                src={`/assets/icons/evolve/phase-${char.evolvePhase}.png`}
                alt=""
                className="w-5 h-5 object-contain"
              />
            )}
            {char.level != null && (
              <span className="text-xs font-bold text-gray-800 drop-shadow-[0_1px_1px_rgba(255,255,255,0.5)]">
                Lv.{char.level}
              </span>
            )}
          </div>
          <span className="flex-1 min-w-0 text-sm font-medium text-black dark:text-white truncate text-right">
            {data.name}
          </span>
        </div>
        <div
          style={{ borderBottom: "3px solid " + lineColor, width: "100%" }}
        />
      </div>
    </div>
  );
}

// 模块级稀有度色条（与 OperatorCard 同源；后续可提取共享）
function rarityLineColorLocal(value: string): string {
  switch (value) {
    case "6":
      return "#ff7100";
    case "5":
      return "#ffcc00";
    case "4":
      return "#b380ff";
    default:
      return "transparent";
  }
}

export function CharSelectModal({
  isOpen,
  onClose,
  charDetail,
  selectedCharIds,
  onSave,
  roleId,
  initialCharId,
  initialViewMode,
  maxSlots = 3,
}: CharSelectModalProps) {
  const { t } = useTranslation();
  const [tempSelectedIds, setTempSelectedIds] =
    useState<string[]>(selectedCharIds);
  const [viewMode, setViewMode] = useState<"list" | "detail">("list");
  const [detailCharId, setDetailCharId] = useState<string | null>(null);
  const [selectedDetailItem, setSelectedDetailItem] = useState<{
    type:
      | "skill"
      | "combatTalent"
      | "abilityTalent"
      | "cultivationTalent"
      | "potential";
    id: string;
    formIndex?: number;
  } | null>(null);
  const [detailActive, setDetailActive] = useState(false);
  const [enteredDetailFromCard, setEnteredDetailFromCard] = useState(false);
  const detailRafRef = useRef<number>(0);
  const detailTimerRef = useRef<number>(0);

  // Wiki 详情相关（仅非预加载时: 显示加载指示 + 关闭时清理后端缓存）
  const [wikiLoading, setWikiLoading] = useState(false);
  const wikiCleanupRef = useRef(false);
  const wikiPreloadRef = useRef(false);
  const [wikiDetail, setWikiDetail] = useState<any>(null);
  const [itemNameMap, setItemNameMap] = useState<Map<
    string,
    { name: string; cover: string }
  > | null>(null);

  // 从 Wiki detail 中提取潜能数据（在 widgetCommonMap 中按 title="干员潜能" 查找）
  // 从 Wiki detail 中提取潜能数据（通过 chapterGroup 查找"干员潜能"章节的 widgetId）
  const potentialData = useMemo(() => {
    if (!wikiDetail?.document) return null;
    const doc = wikiDetail.document;
    const commonMap = doc.widgetCommonMap;
    if (!commonMap || !doc.documentMap) return null;
    const chapterGroup: any[] = (doc as any).chapterGroup;
    if (!chapterGroup) return null;
    const potentialChapter = chapterGroup.find(
      (ch: any) => ch.title === "干员潜能",
    );
    if (!potentialChapter?.widgets) return null;
    const potentialWidgetEntry = (potentialChapter.widgets as any[]).find(
      (w: any) => w.title === "干员潜能",
    );
    const widgetKey: string = potentialWidgetEntry?.id;
    const widget = widgetKey ? commonMap[widgetKey] : null;
    if (!widget?.tabList || !widget?.tabDataMap) return null;
    return widget.tabList.map((tab: any, index: number) => {
      const tabData = widget.tabDataMap[tab.tabId];
      const contentDocId = tabData?.content;
      const contentDoc = contentDocId ? doc.documentMap[contentDocId] : null;
      return {
        level: index + 1,
        iconUrl: `/assets/icons/potential/potential_${index + 1}.png`,
        contentDoc,
      };
    });
  }, [wikiDetail]);

  /** 打开详情面板：先渲染内容，下一帧再触发宽度动画 */
  const openDetailPanel = (item: {
    type:
      | "skill"
      | "combatTalent"
      | "abilityTalent"
      | "cultivationTalent"
      | "potential";
    id: string;
  }) => {
    if (detailTimerRef.current) clearTimeout(detailTimerRef.current);
    if (detailRafRef.current) cancelAnimationFrame(detailRafRef.current);
    setSelectedDetailItem(item);
    detailRafRef.current = requestAnimationFrame(() => {
      setDetailActive(true);
    });
  };

  /** 关闭详情面板：先关宽度动画，动画完成后再清除内容 */
  const closeDetailPanel = () => {
    if (detailRafRef.current) cancelAnimationFrame(detailRafRef.current);
    setDetailActive(false);
    detailTimerRef.current = window.setTimeout(() => {
      setSelectedDetailItem(null);
    }, 300);
  };

  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<number | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const dragCharIdRef = useRef<string | null>(null);
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const slotRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dragGhostRef = useRef<HTMLDivElement>(null);
  const tempSelectedIdsRef = useRef(tempSelectedIds);

  // Keep ref in sync
  useEffect(() => {
    tempSelectedIdsRef.current = tempSelectedIds;
  }, [tempSelectedIds]);

  const handleDragStart = (charId: string, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    dragCharIdRef.current = charId;
    dragStartPosRef.current = { x: e.clientX, y: e.clientY };
    setDragPos({ x: e.clientX, y: e.clientY });
    isDraggingRef.current = false;

    const handleMouseMove = (moveE: MouseEvent) => {
      const start = dragStartPosRef.current;
      if (!start) return;

      const dx = moveE.clientX - start.x;
      const dy = moveE.clientY - start.y;
      if (!isDraggingRef.current && Math.sqrt(dx * dx + dy * dy) < 5) return;

      isDraggingRef.current = true;
      setDragPos({ x: moveE.clientX, y: moveE.clientY });

      const id = dragCharIdRef.current;
      let found: number | null = null;
      const ids = tempSelectedIdsRef.current;
      slotRefs.current.forEach((slot, i) => {
        if (!slot) return;
        const rect = slot.getBoundingClientRect();
        if (
          moveE.clientX >= rect.left &&
          moveE.clientX <= rect.right &&
          moveE.clientY >= rect.top &&
          moveE.clientY <= rect.bottom &&
          ids[i] !== id
        ) {
          found = i;
        }
      });
      setDragOverSlot(found);
    };

    const handleMouseUp = (upE: MouseEvent) => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);

      if (isDraggingRef.current) {
        const id = dragCharIdRef.current;
        if (id) {
          let target: number | null = null;
          const ids = tempSelectedIdsRef.current;
          slotRefs.current.forEach((slot, i) => {
            if (!slot) return;
            const rect = slot.getBoundingClientRect();
            if (
              upE.clientX >= rect.left &&
              upE.clientX <= rect.right &&
              upE.clientY >= rect.top &&
              upE.clientY <= rect.bottom &&
              ids[i] !== id
            ) {
              target = i;
            }
          });
          if (target !== null) {
            handleDropOnSlot(target, id);
          }
        }
      }

      dragCharIdRef.current = null;
      dragStartPosRef.current = null;
      setDragPos(null);
      setDragOverSlot(null);
      isDraggingRef.current = false;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  // 6 维筛选：每个维度独立
  const [filters, setFilters] = useState<Record<FilterKey, string>>({
    profession: "all",
    rarity: "all",
    property: "all",
    weapon: "all",
    mainAttr: "all",
    subAttr: "all",
  });
  const setFilter = (key: FilterKey, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }));
  const resetFilters = () =>
    setFilters({
      profession: "all",
      rarity: "all",
      property: "all",
      weapon: "all",
      mainAttr: "all",
      subAttr: "all",
    });

  const [showFilters, setShowFilters] = useState<boolean>(true);
  const [showBackToTop, setShowBackToTop] = useState<boolean>(false);
  const [scrollPercent, setScrollPercent] = useState<number>(0);
  const [isHoveringBackToTop, setIsHoveringBackToTop] =
    useState<boolean>(false);
  const modalBodyRef = useRef<HTMLDivElement>(null);

  // 重置 Wiki 状态
  const resetWikiState = useCallback(() => {
    setWikiLoading(false);
    setWikiDetail(null);
    setMaterialCoverMap({});
    fetchedCoverIdsRef.current.clear();
  }, []);

  // Reset all state when modal opens to ensure fresh data
  useEffect(() => {
    if (isOpen) {
      setTempSelectedIds(selectedCharIds);
      setViewMode(initialViewMode || "list");
      setDetailCharId(initialCharId || null);
      setEnteredDetailFromCard(initialViewMode === "detail");
      setSuccessMessage(null); // Clear success message
      dragCharIdRef.current = null;
      setSelectedDetailItem(null);
      setDetailActive(false);
      resetFilters();
      setShowFilters(true); // Keep filter panel visible
      wikiCleanupRef.current = false;
      resetWikiState();
    } else {
      resetWikiState();
    }
  }, [isOpen]);

  // Reset detail selection when entering detail view
  useEffect(() => {
    if (viewMode === "detail" && detailCharId) {
      setSelectedDetailItem(null);
      setDetailActive(false);
    }
  }, [viewMode, detailCharId]);

  // 进入 detail view 时加载 Wiki 详情
  useLayoutEffect(() => {
    if (viewMode !== "detail" || !detailCharId || !roleId) {
      return;
    }

    const charItem = getCharItemById(detailCharId);
    const wikiItemId = charItem?.wikiItemId;
    if (!wikiItemId || wikiItemId === "0") return;

    let cancelled = false;

    // 同步设置加载状态，配合 useLayoutEffect 在浏览器绘制前完成重渲染，
    // 避免在异步检查预加载设置期间闪烁一次详情页面
    setWikiLoading(true);

    const loadWikiDetail = async () => {
      try {
        // 检查预加载设置
        const preload =
          (await getConfig<boolean>("wiki_detail_preload")) ?? false;
        wikiPreloadRef.current = preload;

        // 加载 Wiki 详情
        const detail = await roleDataService.getWikiItemDetail(
          roleId,
          wikiItemId,
        );
        if (cancelled) return;
        if (detail) setWikiDetail(detail);

        // 加载物品目录（ID → 名称映射）
        if (!itemNameMap && roleId) {
          console.log("[Wiki] Loading item catalog for roleId:", roleId);
          roleDataService
            .getItemCatalog(roleId)
            .then((map) => {
              console.log("[Wiki] Item catalog loaded, map size:", map?.size);
              if (map) {
                // 打印前5个条目检查cover字段
                let count = 0;
                for (const [id, info] of map) {
                  console.log(
                    `[Wiki] catalog item: ${id} -> name=${info.name}, cover=${info.cover || "(empty)"}`,
                  );
                  if (++count >= 5) break;
                }
              }
              if (!cancelled && map) setItemNameMap(map);
            })
            .catch((e) => {
              logError("[Wiki] Failed to load item catalog:", e);
            });
        }

        wikiCleanupRef.current = true;
      } catch (e) {
        if (!cancelled) {
          logError("[Wiki] Failed to load wiki detail:", e);
        }
      } finally {
        if (!cancelled) {
          setWikiLoading(false);
        }
      }
    };

    loadWikiDetail();

    return () => {
      cancelled = true;
    };
  }, [viewMode, detailCharId, roleId]);

  // 从 selectedDetailItem 中解析技能/天赋名称
  const selectedItemName = useMemo(() => {
    if (!selectedDetailItem || !detailCharId) return "";
    if (selectedDetailItem.type === "potential") return "";
    const char = charDetail.chars.find(
      (c: any) => c.charData.id === detailCharId,
    )?.charData;
    if (!char) return "";
    if (selectedDetailItem.type === "skill") {
      return (
        char.skills.find((s: any) => s.id === selectedDetailItem.id)?.name || ""
      );
    }
    const pool =
      selectedDetailItem.type === "combatTalent"
        ? char.combatTalents
        : selectedDetailItem.type === "abilityTalent"
          ? char.abilityTalents
          : char.cultivationTalents || [];
    const t = pool.find((x: any) => x.id === selectedDetailItem.id);
    return t?.name || "";
  }, [selectedDetailItem, detailCharId]);

  // 多形态技能标签页：图标取自 char detail 的 forms，正文/描述仍从 wiki 匹配（按顺序对应）
  const skillFormTabs = useMemo(() => {
    if (!selectedDetailItem || selectedDetailItem.type !== "skill") return null;
    const char = charDetail.chars.find(
      (c: any) => c.charData.id === detailCharId,
    )?.charData;
    if (!char) return null;
    const skill = char.skills.find((s: any) => s.id === selectedDetailItem.id);
    if (!skill) return null;
    const forms = skill.forms;
    if (!forms || forms.length < 2) return null;

    const doc = wikiDetail?.document;
    const commonMap = doc?.widgetCommonMap;
    const wikiTabs: { contentId: string; descriptionId: string }[] = [];
    if (commonMap) {
      for (const docKey of Object.keys(commonMap)) {
        const wdoc = commonMap[docKey];
        if (wdoc?.type !== "common") continue;
        const tabMap = wdoc.tabDataMap;
        if (!tabMap) continue;
        const tabList = wdoc.tabList || [];
        for (const tab of tabList) {
          const tabData = tabMap[tab.tabId];
          if (!tabData?.intro?.name) continue;
          if (tabData.intro.name !== skill.name) continue;
          wikiTabs.push({
            contentId: tabData.content || "",
            descriptionId: tabData.intro.description || "",
          });
        }
      }
    }

    return forms.map((form, fi) => ({
      iconUrl: form.iconUrl,
      name: form.name,
      contentId: wikiTabs[fi]?.contentId || "",
      descriptionId: wikiTabs[fi]?.descriptionId || "",
    }));
  }, [selectedDetailItem, wikiDetail, charDetail, detailCharId]);

  // 加载升级材料的封面图
  const fetchedCoverIdsRef = useRef(new Set<string>());
  const [materialCoverMap, setMaterialCoverMap] = useState<
    Record<string, string>
  >({});
  const cacheDirRef = useRef<string>("");
  useEffect(() => {
    if (!selectedDetailItem || !wikiDetail || !roleId) {
      console.log(
        "[MaterialCover] Skipped: missing selectedDetailItem/wikiDetail/roleId",
        {
          selectedDetailItem: !!selectedDetailItem,
          wikiDetail: !!wikiDetail,
          roleId,
        },
      );
      return;
    }
    if (selectedDetailItem.type === "potential") {
      console.log("[MaterialCover] Skipped: potential type");
      return;
    }
    if (!selectedItemName) {
      console.log("[MaterialCover] Skipped: no selectedItemName");
      return;
    }

    let cancelled = false;

    const fetchCovers = async () => {
      console.log(
        "[MaterialCover] Start fetching covers for:",
        selectedItemName,
      );
      const doc =
        wikiDetail.document ||
        wikiDetail.data?.item?.document ||
        wikiDetail.item?.document;
      if (!doc?.widgetCommonMap || !doc?.documentMap) {
        console.log(
          "[MaterialCover] No widgetCommonMap/documentMap in wikiDetail",
        );
        return;
      }

      // 使用 findContentIds 查找匹配的内容文档
      const { contentIds } = findContentIds(
        doc.widgetCommonMap,
        doc.documentMap,
        selectedItemName,
      );
      console.log("[MaterialCover] Found contentIds:", contentIds);
      if (cancelled) return;

      const itemIds = new Set<string>();
      for (const contentId of contentIds) {
        const contentDoc = doc.documentMap[contentId] as any;
        if (!contentDoc?.blockIds || !contentDoc?.blockMap) continue;
        let inMaterialSection = false;
        for (const blockId of contentDoc.blockIds) {
          const block = contentDoc.blockMap[blockId] as any;
          // 检查 "升级材料" 文本标记
          if (block?.kind === "text" || block?.kind === "heading3") {
            const segments = block?.text?.inlineElements || block?.children;
            if (segments) {
              const plainText = (Array.isArray(segments) ? segments : [])
                .map((s: any) => s?.text?.text || s?.text || "")
                .join("");
              if (plainText.includes("升级材料")) {
                inMaterialSection = true;
                continue;
              }
            }
            inMaterialSection = false;
          }
          if (block?.kind === "table" && inMaterialSection) {
            const table = block.table as any;
            if (
              !table?.rowIds?.length ||
              !table?.columnIds?.length ||
              !table?.cellMap
            )
              break;
            // 遍历所有行和列，提取 entries
            for (const rowId of table.rowIds) {
              for (const colId of table.columnIds) {
                const cellKey = `${rowId}_${colId}`;
                const cell = table.cellMap[cellKey];
                const extracted = extractCell(cell, contentDoc.blockMap);
                if (extracted?.entries) {
                  for (const e of extracted.entries) {
                    itemIds.add(e.itemId);
                  }
                }
              }
            }
            break;
          }
        }
      }

      console.log("[MaterialCover] Extracted itemIds from wiki:", [...itemIds]);
      const needed = [...itemIds].filter(
        (id) => !fetchedCoverIdsRef.current.has(id),
      );
      console.log("[MaterialCover] Needed (not yet fetched):", needed);
      if (needed.length === 0) return;

      // 从 catalog 获取物品的 cover URL
      if (!itemNameMap) {
        console.log("[MaterialCover] itemNameMap is null, cannot proceed");
        return;
      }
      console.log("[MaterialCover] itemNameMap size:", itemNameMap.size);

      // 检查每个 item 在 catalog 中的信息
      for (const itemId of needed) {
        const itemInfo = itemNameMap.get(itemId);
        console.log(
          `[MaterialCover] catalog lookup for ${itemId}:`,
          itemInfo
            ? { name: itemInfo.name, cover: itemInfo.cover }
            : "NOT FOUND",
        );
      }

      // 获取缓存目录
      if (!cacheDirRef.current) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          cacheDirRef.current = await invoke<string>("get_image_cache_dir");
          console.log("[MaterialCover] Got cache dir:", cacheDirRef.current);
        } catch (e) {
          console.error("[MaterialCover] Failed to get cache dir:", e);
          return;
        }
      }

      const { invoke } = await import("@tauri-apps/api/core");
      const newCovers: Record<string, string> = {};

      for (const itemId of needed) {
        if (cancelled) return;
        const itemInfo = itemNameMap.get(itemId);
        if (!itemInfo?.cover) {
          console.log(
            `[MaterialCover] Skipping ${itemId}: no cover URL in catalog`,
          );
          continue;
        }

        console.log(
          `[MaterialCover] Downloading cover for ${itemId} from: ${itemInfo.cover}`,
        );
        try {
          // 下载图片到本地缓存
          const localPath = await invoke<string>("download_image", {
            url: itemInfo.cover,
            cacheDir: cacheDirRef.current,
            subDir: "item_icons",
          });
          console.log(`[MaterialCover] Downloaded ${itemId} -> ${localPath}`);
          newCovers[itemId] = localPath;
          fetchedCoverIdsRef.current.add(itemId);
        } catch (e) {
          console.error(
            `[MaterialCover] Failed to download cover for ${itemId}:`,
            e,
          );
        }
      }

      console.log("[MaterialCover] Final newCovers:", newCovers);
      if (Object.keys(newCovers).length > 0) {
        setMaterialCoverMap((prev) => ({ ...prev, ...newCovers }));
      }
    };

    fetchCovers();
    return () => {
      cancelled = true;
    };
  }, [selectedDetailItem, wikiDetail, roleId, itemNameMap]);

  // 离开 detail view 时重置 Wiki 状态
  const prevViewMode = useRef(viewMode);
  useEffect(() => {
    if (prevViewMode.current === "detail" && viewMode !== "detail") {
      resetWikiState();
    }
    prevViewMode.current = viewMode;
  }, [viewMode, resetWikiState]);

  // Cleanup animation refs
  useEffect(() => {
    return () => {
      if (detailRafRef.current) cancelAnimationFrame(detailRafRef.current);
      if (detailTimerRef.current) clearTimeout(detailTimerRef.current);
    };
  }, []);

  function renderRarityIcons(value: string, size: number = 14) {
    const count = parseInt(value, 10) || 0;
    return (
      <span className="inline-flex items-center gap-px">
        {Array.from({ length: count }).map((_, i) => (
          <img
            key={i}
            src={RARITY_ICON_URL}
            alt=""
            className="inline-block"
            style={{ width: `${size}px`, height: `${size}px` }}
          />
        ))}
      </span>
    );
  }

  // 排序：pinned first → rarity desc → level desc → name asc
  const sortedCharacters = [...charDetail.chars].sort((a, b) => {
    const aPinned = tempSelectedIds.includes(a.charData.id);
    const bPinned = tempSelectedIds.includes(b.charData.id);

    // Pinned characters come first
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;

    // 1) 稀有度降序
    const rA = parseInt(a.charData.rarity.value) || 0;
    const rB = parseInt(b.charData.rarity.value) || 0;
    if (rB !== rA) return rB - rA;

    // 2) 等级降序
    const lA = a.level ?? 0;
    const lB = b.level ?? 0;
    if (lB !== lA) return lB - lA;

    // 3) 名称升序
    return a.charData.name.localeCompare(b.charData.name, "zh-Hans-CN");
  });

  // 副能力派生：从 charData.tags 中提取非主属性的 tag 作为 sub-property
  // （WIKI 中主能力=property，副能力可来自 tags 数组；数据无明确字段时为 null）
  const getSubProperty = (char: CharacterItem): string | null => {
    const tags = char.charData.tags || [];
    const mainValue = char.charData.property.value;
    for (const tag of tags) {
      if (tag && tag !== mainValue) return tag;
    }
    return null;
  };

  // 6 维筛选选项
  const uniqueProfessions = useMemo(
    () =>
      Array.from(
        new Set(charDetail.chars.map((c) => c.charData.profession.value)),
      ).sort(),
    [charDetail.chars],
  );

  const uniqueProperties = useMemo(
    () =>
      Array.from(
        new Set(charDetail.chars.map((c) => c.charData.property.value)),
      ).sort(),
    [charDetail.chars],
  );

  const uniqueRarities = useMemo(
    () =>
      Array.from(
        new Set(charDetail.chars.map((c) => c.charData.rarity.value)),
      ).sort((a, b) => parseInt(b) - parseInt(a)),
    [charDetail.chars],
  );

  const uniqueWeapons = useMemo(
    () =>
      Array.from(
        new Set(charDetail.chars.map((c) => c.charData.weaponType.value)),
      ).sort(),
    [charDetail.chars],
  );

  // 主能力 = property
  const uniqueMainAttrs = uniqueProperties;

  // 副能力：所有非空 sub-property 去重
  const uniqueSubAttrs = useMemo(() => {
    const set = new Set<string>();
    charDetail.chars.forEach((c) => {
      const sub = getSubProperty(c);
      if (sub) set.add(sub);
    });
    return Array.from(set).sort();
  }, [charDetail.chars]);

  // 过滤
  const filteredCharacters = sortedCharacters.filter((char) => {
    const data = char.charData;
    if (
      filters.profession !== "all" &&
      data.profession.value !== filters.profession
    )
      return false;
    if (filters.rarity !== "all" && data.rarity.value !== filters.rarity)
      return false;
    if (filters.property !== "all" && data.property.value !== filters.property)
      return false;
    if (filters.weapon !== "all" && data.weaponType.value !== filters.weapon)
      return false;
    // 主能力 = property，等价于单独筛选
    if (filters.mainAttr !== "all" && data.property.value !== filters.mainAttr)
      return false;
    // 副能力：tag 中非主属性的项
    if (filters.subAttr !== "all") {
      const sub = getSubProperty(char);
      if (sub !== filters.subAttr) return false;
    }
    return true;
  });

  // Get character data by ID
  const getCharById = (id: string) => {
    return charDetail.chars.find((c) => c.charData.id === id)?.charData;
  };

  // Get full character item by ID (including talent info)
  const getCharItemById = (id: string) => {
    return charDetail.chars.find((c) => c.charData.id === id);
  };

  // Compute image paths for cache requests（OperatorCard 用 illustrationUrl 作 cover）
  const gridAvatarPaths = useMemo(
    () =>
      charDetail.chars
        .map(
          (c) =>
            c.charData.illustrationUrl ||
            c.charData.avatarRtUrl ||
            c.charData.avatarSqUrl,
        )
        .filter(Boolean),
    [charDetail.chars],
  );

  const detailImagePaths = useMemo(() => {
    if (viewMode !== "detail" || !detailCharId) return [];
    const item = charDetail.chars.find((c) => c.charData.id === detailCharId);
    if (!item) return [];
    const char = item.charData;
    const paths: string[] = [];
    if (char.illustrationUrl) paths.push(char.illustrationUrl);
    if (char.avatarSqUrl) paths.push(char.avatarSqUrl);
    char.skills.forEach((s) => {
      if (s.iconUrl) paths.push(s.iconUrl);
    });
    char.abilityTalents.forEach((t) => {
      if (t.iconUrl) paths.push(t.iconUrl);
    });
    char.combatTalents.forEach((t) => {
      if (t.iconUrl) paths.push(t.iconUrl);
    });
    (char.cultivationTalents || []).forEach((t) => {
      if (t.iconUrl) paths.push(t.iconUrl);
    });
    const pushEquipIcon = (obj: any, field: string) => {
      const url = obj?.[field]?.iconUrl;
      if (url) paths.push(url);
    };
    pushEquipIcon(item.weapon, "weaponData");
    for (const eq of [
      item.bodyEquip,
      item.armEquip,
      item.firstAccessory,
      item.secondAccessory,
    ]) {
      pushEquipIcon(eq, "equipData");
    }
    pushEquipIcon(item.tacticalItem, "tacticalItemData");
    return paths;
  }, [viewMode, detailCharId, charDetail.chars]);

  const allCachePaths = useMemo(
    () => [...gridAvatarPaths, ...detailImagePaths],
    [gridAvatarPaths, detailImagePaths],
  );

  useImageRequest(allCachePaths, [allCachePaths]);

  // Handle drop on slot
  const handleDropOnSlot = (slotIndex: number, charId: string) => {
    const isDuplicate = tempSelectedIds.some(
      (id, idx) => id === charId && idx !== slotIndex,
    );
    if (isDuplicate) return;

    const newSelectedIds = [...tempSelectedIds];
    newSelectedIds[slotIndex] = charId;
    setTempSelectedIds(newSelectedIds);
    setTimeout(() => onSave(newSelectedIds)); // 延迟保存，避免父组件重渲染导致 HeroUI Modal.Body 丢失滚动

    const charName = getCharById(charId)?.name || "Character";
    setSuccessMessage(
      t("settings.characters.pin_success", {
        name: charName,
        slot: slotIndex + 1,
      }),
    );
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  // Remove character from slot
  const handleRemoveFromSlot = (slotIndex: number) => {
    const newSelectedIds = [...tempSelectedIds];
    newSelectedIds.splice(slotIndex, 1);
    newSelectedIds.push("");
    setTempSelectedIds(newSelectedIds);
    setTimeout(() => onSave(newSelectedIds));
  };

  // 滚动事件处理
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const totalHeight = scrollHeight - clientHeight;
    const percent =
      totalHeight > 0 ? Math.round((scrollTop / totalHeight) * 100) : 0;

    setScrollPercent(percent);
    setShowBackToTop(percent > 50);
  };

  return (
    <>
      {/* Floating Success Alert — 窗口顶部固定浮窗 */}
      {successMessage && (
        <div className="fixed top-0 left-0 right-0 z-[10003] flex justify-center px-6 pt-4">
          <GlassAlert status="success" className="shadow-lg max-w-md">
            <GlassAlert.Indicator />
            <GlassAlert.Content>
              <GlassAlert.Description>{successMessage}</GlassAlert.Description>
            </GlassAlert.Content>
          </GlassAlert>
        </div>
      )}

      <CustomModal isOpen={isOpen} onClose={onClose} size="xl" height="fixed">
        {viewMode === "detail" ? (
          detailCharId &&
          (() => {
            const char = getCharById(detailCharId);
            const charItem = getCharItemById(detailCharId);
            if (!char) return null;

            const sel = selectedDetailItem;
            const activeCombatNodes =
              charItem?.talent?.latestPassiveSkillNodes || [];
            const activeAbilityNodes = charItem?.talent?.attrNodes || [];
            const activeCultivationNodes =
              charItem?.talent?.latestSpaceshipSkillNodes || [];
            const hasSelection = detailActive;

            const groupChains = (talents: typeof char.combatTalents) => {
              const groups = new Map<string, typeof char.combatTalents>();
              talents.forEach((t) => {
                const baseId = t.id.replace(/_\d+$/, "");
                if (!groups.has(baseId)) groups.set(baseId, []);
                groups.get(baseId)!.push(t);
              });
              groups.forEach((g) =>
                g.sort((a, b) => {
                  const aL = parseInt(a.id.match(/_(\d+)$/)?.[1] || "0");
                  const bL = parseInt(b.id.match(/_(\d+)$/)?.[1] || "0");
                  return aL - bL;
                }),
              );
              return Array.from(groups.values());
            };

            const findItem = () => {
              if (!sel) return null;
              if (sel.type === "skill") {
                const s = char.skills.find((x) => x.id === sel.id);
                return s ? { ...s, _type: "skill" as const } : null;
              }
              if (sel.type === "potential") {
                const p = potentialData?.find(
                  (x: any) => x.level === parseInt(sel.id),
                );
                return p
                  ? {
                      _type: "potential" as const,
                      level: p.level,
                      iconUrl: p.iconUrl,
                      contentDoc: p.contentDoc,
                      name: `潜能 ${p.level}`,
                    }
                  : null;
              }
              const pool =
                sel.type === "combatTalent"
                  ? char.combatTalents
                  : sel.type === "abilityTalent"
                    ? char.abilityTalents
                    : char.cultivationTalents || [];
              const t = pool.find((x) => x.id === sel.id);
              return t ? { ...t, _type: sel.type } : null;
            };
            const selectedItem = findItem();

            const isNodeUnlocked = (
              chain: typeof char.combatTalents,
              index: number,
              type: string,
            ) => {
              const activeNodes =
                type === "combatTalent"
                  ? activeCombatNodes
                  : type === "abilityTalent"
                    ? activeAbilityNodes
                    : activeCultivationNodes;
              if (type === "skill") return true;
              if (type === "abilityTalent")
                return activeNodes.includes(chain[index].id);
              for (let i = index; i < chain.length; i++) {
                if (activeNodes.includes(chain[i].id)) return true;
              }
              return false;
            };

            const talentIcon = (
              iconUrl: string,
              name: string,
              unlocked: boolean,
            ) => {
              return unlocked ? (
                <Img
                  src={iconUrl}
                  alt={name}
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="relative w-full h-full">
                  <Img
                    src={iconUrl}
                    alt={name}
                    className="w-full h-full object-contain opacity-30"
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <svg
                      className="w-4 h-4 text-white drop-shadow"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6zm8 14H7c-.55 0-1-.45-1-1v-8c0-.55.45-1 1-1h10c.55 0 1 .45 1 1v8c0 .55-.45 1-1 1z" />
                    </svg>
                  </div>
                </div>
              );
            };

            const btnBase = (
              isFirstThree: boolean,
              active: boolean,
              unlocked: boolean,
            ) =>
              `w-12 h-12 border-2 p-1 transition-all cursor-pointer flex-shrink-0
            ${isFirstThree ? "rounded-full" : "rounded-lg"}
            ${unlocked ? "border-yellow-300" : "border-neutral-500"}
            ${active ? "ring-2 ring-blue-500/40 scale-110" : "hover:scale-105"}
            ${unlocked ? "shadow-[0_0_14px_rgba(0,0,0,0.35)]" : ""}`;

            const pasCombatChains = groupChains(char.combatTalents);
            const cultChains = groupChains(char.cultivationTalents || []);

            const showLoading = wikiLoading;

            const getLevelNum = (v: any): number | null => {
              if (v == null) return null;
              const n = parseInt(String(v), 10);
              return isNaN(n) ? null : n;
            };

            const eqCard = (
              key: string,
              label: string,
              iconUrl: string | null | undefined,
              name: string | null | undefined,
              rarityKey: string | null | undefined,
              levelVal: any,
              hasData: boolean,
            ) => ({
              key,
              label,
              iconUrl: iconUrl || null,
              name: (name || "").trim() || null,
              rarityValue:
                (rarityKey || "").replace("equip_rarity_", "") || "3",
              levelNum: getLevelNum(levelVal),
              hasData,
            });

            const equipData = [
              eqCard(
                "weapon",
                "武器",
                charItem?.weapon?.weaponData?.iconUrl,
                charItem?.weapon?.weaponData?.name,
                charItem?.weapon?.weaponData?.rarity?.value,
                charItem?.weapon?.level,
                !!charItem?.weapon,
              ),
              eqCard(
                "body",
                "护甲",
                charItem?.bodyEquip?.equipData?.iconUrl,
                charItem?.bodyEquip?.equipData?.name,
                charItem?.bodyEquip?.equipData?.rarity?.key,
                charItem?.bodyEquip?.equipData?.level?.value,
                !!charItem?.bodyEquip?.equipData,
              ),
              eqCard(
                "arm",
                "护手",
                charItem?.armEquip?.equipData?.iconUrl,
                charItem?.armEquip?.equipData?.name,
                charItem?.armEquip?.equipData?.rarity?.key,
                charItem?.armEquip?.equipData?.level?.value,
                !!charItem?.armEquip?.equipData,
              ),
              eqCard(
                "acc1",
                "配件",
                charItem?.firstAccessory?.equipData?.iconUrl,
                charItem?.firstAccessory?.equipData?.name,
                charItem?.firstAccessory?.equipData?.rarity?.key,
                charItem?.firstAccessory?.equipData?.level?.value,
                !!charItem?.firstAccessory?.equipData,
              ),
              eqCard(
                "acc2",
                "配件",
                charItem?.secondAccessory?.equipData?.iconUrl,
                charItem?.secondAccessory?.equipData?.name,
                charItem?.secondAccessory?.equipData?.rarity?.key,
                charItem?.secondAccessory?.equipData?.level?.value,
                !!charItem?.secondAccessory?.equipData,
              ),
              eqCard(
                "tactical",
                "战术物品",
                charItem?.tacticalItem?.tacticalItemData?.iconUrl,
                charItem?.tacticalItem?.tacticalItemData?.name,
                charItem?.tacticalItem?.tacticalItemData?.rarity?.key,
                null,
                !!charItem?.tacticalItem?.tacticalItemData,
              ),
            ];

            const gem = charItem?.weapon?.gem?.gemData;
            const gemRarity =
              charItem?.weapon?.gem?.gemData?.templateId?.replace(
                "item_gem_rarity_",
                "",
              ) || null;

            return (
              <div
                className="h-full w-full relative overflow-hidden rounded-2xl"
                style={{ border: "none" }}
              >
                {/* Close button at top-right corner */}
                <button
                  onClick={() => {
                    if (hasSelection) {
                      closeDetailPanel();
                    } else if (enteredDetailFromCard) {
                      onClose();
                    } else {
                      setViewMode("list");
                      setDetailCharId(null);
                    }
                  }}
                  className="absolute top-2 right-2 z-30 w-8 h-8 flex items-center justify-center rounded-full text-black/50 hover:text-black transition-colors cursor-pointer"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>

                {showLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <GlassProgressCircle
                      isIndeterminate
                      size="lg"
                      aria-label="Loading wiki"
                      className="text-primary-text"
                    >
                      <GlassProgressCircle.Track>
                        <GlassProgressCircle.TrackCircle />
                        <GlassProgressCircle.FillCircle />
                      </GlassProgressCircle.Track>
                    </GlassProgressCircle>
                  </div>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      height: "100%",
                      overflow: "hidden",
                      position: "relative",
                    }}
                  >
                    {/* Left column - fixed */}
                    <div
                      style={{
                        width: "35%",
                        minWidth: 0,
                        flexShrink: 0,
                        overflow: "hidden",
                        backgroundImage:
                          "url(/assets/illustration_background.png)",
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        backgroundRepeat: "no-repeat",
                      }}
                    >
                      <div className="h-full p-3 flex flex-col items-center">
                        <div className="flex-1 flex items-center justify-center w-full min-h-0 mb-2">
                          <Img
                            src={char.illustrationUrl}
                            alt={char.name}
                            className="w-full h-full object-contain"
                          />
                        </div>
                        <div className="flex flex-row items-center gap-3 shrink-0 w-full justify-center">
                          {/* Left: avatar + (property + profession stacked on right) */}
                          <div className="flex items-center gap-1.5">
                            <Img
                              src={char.avatarSqUrl}
                              alt={char.name}
                              className="w-11 h-11 rounded-lg shadow-sm shrink-0 avatar-feather"
                            />
                            <div className="flex flex-col gap-0.5">
                              <img
                                src={professionIconUrl(char.profession.key)}
                                alt={char.profession.value}
                                title={char.profession.value}
                                className="w-5 h-5 object-contain drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]"
                                onError={(e) => {
                                  (
                                    e.currentTarget as HTMLImageElement
                                  ).style.visibility = "hidden";
                                }}
                              />
                              <img
                                src={propertyIconUrl(char.property.key)}
                                alt={char.property.value}
                                title={char.property.value}
                                className="w-5 h-5 object-contain drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]"
                                onError={(e) => {
                                  (
                                    e.currentTarget as HTMLImageElement
                                  ).style.visibility = "hidden";
                                }}
                              />
                            </div>
                          </div>

                          {/* Middle: name + rarity + weapon */}
                          <div className="flex flex-col min-w-0">
                            <h3 className="text-sm font-bold text-black truncate">
                              {char.name}
                            </h3>
                            <div className="flex items-center">
                              {renderRarityIcons(char.rarity.value, 11)}
                            </div>
                            <span className="text-[11px] text-black/60">
                              {char.weaponType.value}
                            </span>
                          </div>

                          {/* Right: level + evolve phase */}
                          <div className="flex items-center gap-1">
                            {charItem?.level != null && (
                              <div className="flex items-baseline gap-0.5">
                                <span className="text-[10px] text-gray-400 font-semibold">
                                  LEVEL
                                </span>
                                <span className="text-[44px] font-thin text-[#dddddd] leading-none">
                                  {charItem.level}
                                </span>
                              </div>
                            )}
                            {charItem?.evolvePhase != null && (
                              <img
                                src={`/assets/icons/evolve/phase-${charItem.evolvePhase}.png`}
                                alt={`Phase ${charItem.evolvePhase}`}
                                className="w-11 h-11 object-contain"
                              />
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Middle column - fixed */}
                    <div
                      style={{
                        width: "65%",
                        minWidth: 0,
                        flexShrink: 0,
                        overflow: "hidden",
                        backgroundColor: "#dddddd",
                      }}
                    >
                      <div className="h-full p-4 overflow-y-hidden space-y-6">
                        {/* Talent Array + Equipment side by side */}
                        <div className="flex gap-4">
                          <div className="flex-1 space-y-3 min-w-0">
                            {/* Skills */}
                            <div>
                              <div className="mb-2">
                                <div
                                  className="relative flex items-center px-2"
                                  style={{
                                    background:
                                      "linear-gradient(to bottom, transparent 8px, #d3d3d3 8px)",
                                    width: "320px",
                                  }}
                                >
                                  <div className="w-[4px] h-4 bg-[#555] shrink-0 mr-1.5" />
                                  <span className="text-sm font-semibold text-[#444]">
                                    技能
                                  </span>
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-5">
                                {char.skills.map((skill) => {
                                  const isSel =
                                    sel?.type === "skill" &&
                                    sel.id === skill.id;
                                  const skillLevel =
                                    charItem?.userSkills?.[skill.id]?.level;
                                  return (
                                    <div
                                      key={skill.id}
                                      className="flex flex-col items-center"
                                    >
                                      <div
                                        className="relative"
                                        style={{ width: 56, height: 56 }}
                                      >
                                        <div
                                          className="absolute inset-0 rounded-full"
                                          style={{
                                            background: `conic-gradient(from 145deg, transparent 0deg 70deg, ${SKILL_BG_CIRCLE} 70deg 360deg)`,
                                            WebkitMask:
                                              "radial-gradient(circle at 50% 50%, transparent 26px, black 26px)",
                                            mask: "radial-gradient(circle at 50% 50%, transparent 26px, black 26px)",
                                          }}
                                        />
                                        <button
                                          onClick={() =>
                                            openDetailPanel({
                                              type: "skill",
                                              id: skill.id,
                                            })
                                          }
                                          className={`${btnBase(true, isSel, true)} overflow-hidden`}
                                          style={{
                                            position: "absolute",
                                            top: 4,
                                            left: 4,
                                            backgroundColor: SKILL_BG_CIRCLE,
                                            borderColor: SKILL_BG_CIRCLE,
                                          }}
                                          title={skill.name}
                                        >
                                          <div
                                            className="absolute rounded-full"
                                            style={
                                              skill.type.key ===
                                              "skill_type_ultimate_skill"
                                                ? {
                                                    top: 1,
                                                    right: 1,
                                                    bottom: 1,
                                                    left: 1,
                                                    backgroundColor:
                                                      SKILL_BG_COLORS[
                                                        skill.property.key
                                                      ] || "#5e5e5e",
                                                  }
                                                : {
                                                    top: 1,
                                                    right: 1,
                                                    bottom: 1,
                                                    left: 1,
                                                    background: `conic-gradient(from 112.5deg, ${SKILL_BG_COLORS[skill.property.key] || "#5e5e5e"} 0deg, ${SKILL_BG_COLORS[skill.property.key] || "#5e5e5e"} 135deg, transparent 135deg)`,
                                                  }
                                            }
                                          />
                                          <Img
                                            src={skill.iconUrl}
                                            alt={skill.name}
                                            className="relative z-10 w-full h-full object-contain"
                                          />
                                        </button>
                                      </div>
                                      {skillLevel != null && (
                                        <span className="mt-0.5 bg-[#999999] text-white text-xs leading-none w-[48px] py-[3px] rounded-full font-medium z-10 flex items-center justify-center gap-0.5">
                                          {skillLevel >= 10 ? (
                                            <img
                                              src={`/assets/icons/specialization/rank_${skillLevel >= 12 ? 12 : skillLevel}.png`}
                                              alt=""
                                              className="h-[14px] w-auto object-contain"
                                            />
                                          ) : (
                                            <span>RANK {skillLevel}</span>
                                          )}
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            <hr className="border-t border-gray-300/30 my-1" />

                            {/* Ability Talents */}
                            <div>
                              <div className="mb-2">
                                <div
                                  className="relative flex items-center px-2"
                                  style={{
                                    background:
                                      "linear-gradient(to bottom, transparent 8px, #d3d3d3 8px)",
                                    width: "320px",
                                  }}
                                >
                                  <div className="w-[4px] h-4 bg-[#555] shrink-0 mr-1.5" />
                                  <span className="text-sm font-semibold text-[#444]">
                                    天赋阵列
                                  </span>
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-5">
                                {[...char.abilityTalents]
                                  .sort((a, b) => {
                                    const numA = parseInt(
                                      a.id.match(/_(\d+)$/)?.[1] || "0",
                                    );
                                    const numB = parseInt(
                                      b.id.match(/_(\d+)$/)?.[1] || "0",
                                    );
                                    return numA - numB;
                                  })
                                  .map((talent) => {
                                    const isSel =
                                      sel?.type === "abilityTalent" &&
                                      sel.id === talent.id;
                                    const unlocked =
                                      activeAbilityNodes.includes(talent.id);
                                    return (
                                      <button
                                        key={talent.id}
                                        onClick={() =>
                                          openDetailPanel({
                                            type: "abilityTalent",
                                            id: talent.id,
                                          })
                                        }
                                        className={`${btnBase(true, isSel, unlocked)} relative`}
                                        style={{
                                          backgroundColor: unlocked
                                            ? "#ffd806"
                                            : "#404040",
                                          border: "none",
                                          boxShadow: "inset 0 0 0 2px #a4a4a4",
                                        }}
                                        title={talent.name}
                                      >
                                        {talentIcon(
                                          talent.iconUrl,
                                          talent.name,
                                          unlocked,
                                        )}
                                      </button>
                                    );
                                  })}
                              </div>
                            </div>

                            {/* Passive Skills */}
                            {pasCombatChains.length > 0 && (
                              <div>
                                <div className="flex flex-col gap-4">
                                  {pasCombatChains.map((chain, ci) => (
                                    <div
                                      key={ci}
                                      className="flex items-center gap-1"
                                    >
                                      {chain.map((talent, ti) => {
                                        const isSel =
                                          sel?.type === "combatTalent" &&
                                          sel.id === talent.id;
                                        const unlocked = isNodeUnlocked(
                                          chain,
                                          ti,
                                          "combatTalent",
                                        );
                                        return (
                                          <div
                                            key={talent.id}
                                            className="flex items-center gap-1"
                                          >
                                            {ti > 0 && (
                                              <div
                                                className={`w-10 border-t-2 rounded-none ${unlocked ? "border-white" : "border-dashed border-neutral-400"}`}
                                              />
                                            )}
                                            <button
                                              onClick={() =>
                                                openDetailPanel({
                                                  type: "combatTalent",
                                                  id: talent.id,
                                                })
                                              }
                                              className={`${btnBase(true, isSel, unlocked)} relative`}
                                              style={{
                                                backgroundColor: unlocked
                                                  ? "#ffd806"
                                                  : "#404040",
                                                border: "none",
                                                boxShadow:
                                                  "inset 0 0 0 2px #a4a4a4",
                                              }}
                                              title={talent.name}
                                            >
                                              {talentIcon(
                                                talent.iconUrl,
                                                talent.name,
                                                unlocked,
                                              )}
                                            </button>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Cultivation Talents */}
                            {cultChains.length > 0 && (
                              <div>
                                <div className="flex flex-col gap-4">
                                  {cultChains.map((chain, ci) => (
                                    <div
                                      key={ci}
                                      className="flex items-center gap-1"
                                    >
                                      {chain.map((talent, ti) => {
                                        const isSel =
                                          sel?.type === "cultivationTalent" &&
                                          sel.id === talent.id;
                                        const unlocked = isNodeUnlocked(
                                          chain,
                                          ti,
                                          "cultivationTalent",
                                        );
                                        return (
                                          <div
                                            key={talent.id}
                                            className="flex items-center gap-1"
                                          >
                                            {ti > 0 && (
                                              <div
                                                className={`w-10 border-t-2 rounded-none ${unlocked ? "border-white" : "border-dashed border-neutral-400"}`}
                                              />
                                            )}
                                            <button
                                              onClick={() =>
                                                openDetailPanel({
                                                  type: "cultivationTalent",
                                                  id: talent.id,
                                                })
                                              }
                                              className={`${btnBase(false, isSel, unlocked)} relative`}
                                              style={{
                                                backgroundColor: unlocked
                                                  ? "#a2a2a2"
                                                  : "#404040",
                                                border: "none",
                                              }}
                                              title={talent.name}
                                            >
                                              {talentIcon(
                                                talent.iconUrl,
                                                talent.name,
                                                unlocked,
                                              )}
                                            </button>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Potential */}
                            {potentialData && (
                              <div>
                                <div className="mb-2">
                                  <div
                                    className="relative flex items-center px-2"
                                    style={{
                                      background:
                                        "linear-gradient(to bottom, transparent 8px, #d3d3d3 8px)",
                                      width: "320px",
                                    }}
                                  >
                                    <div className="w-[4px] h-4 bg-[#555] shrink-0 mr-1.5" />
                                    <span className="text-sm font-semibold text-[#444]">
                                      潜能
                                    </span>
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-3">
                                  {potentialData.map((p: any, i: number) => {
                                    const isSel =
                                      sel?.type === "potential" &&
                                      sel.id === String(p.level);
                                    const unlocked =
                                      i < (charItem?.potentialLevel ?? 0);
                                    return (
                                      <button
                                        key={p.level}
                                        onClick={() =>
                                          openDetailPanel({
                                            type: "potential",
                                            id: String(p.level),
                                          })
                                        }
                                        className={btnBase(
                                          true,
                                          isSel,
                                          unlocked,
                                        )}
                                        style={{
                                          backgroundColor: unlocked
                                            ? "#a2a2a2"
                                            : "#404040",
                                          border: "none",
                                        }}
                                        title={`潜能 ${p.level}`}
                                      >
                                        <div className="relative w-full h-full">
                                          {unlocked ? (
                                            <div className="absolute -inset-1">
                                              <img
                                                src={p.iconUrl}
                                                alt={`潜${p.level}`}
                                                className="w-full h-full object-cover"
                                              />
                                            </div>
                                          ) : (
                                            <>
                                              <div className="absolute -inset-1">
                                                <img
                                                  src={p.iconUrl}
                                                  alt={`潜${p.level}`}
                                                  className="w-full h-full object-cover opacity-30"
                                                />
                                              </div>
                                              <div className="absolute inset-0 flex items-center justify-center z-10">
                                                <svg
                                                  className="w-4 h-4 text-white drop-shadow"
                                                  fill="currentColor"
                                                  viewBox="0 0 24 24"
                                                >
                                                  <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6zm8 14H7c-.55 0-1-.45-1-1v-8c0-.55.45-1 1-1h10c.55 0 1 .45 1 1v8c0 .55-.45 1-1 1z" />
                                                </svg>
                                              </div>
                                            </>
                                          )}
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Equipment column */}
                          <div className="flex flex-col gap-1.5 flex-1 min-w-0 justify-center">
                            {(() => {
                              const rc: Record<string, string> = {
                                "2": "#c1d681",
                                "3": "#33c1fe",
                                "4": "#b380ff",
                                "5": "#fac800",
                                "6": "#fe7100",
                              };

                              const sectionTitle = (text: string) => (
                                <div
                                  className="flex items-center px-2 w-full"
                                  style={{
                                    background:
                                      "linear-gradient(to bottom, transparent 8px, #d3d3d3 8px)",
                                  }}
                                >
                                  <div className="w-[4px] h-4 bg-[#555] shrink-0 mr-1.5" />
                                  <span className="text-sm font-semibold text-[#444]">
                                    {text}
                                  </span>
                                </div>
                              );

                              const renderCard = (
                                eq: (typeof equipData)[number],
                                compact?: boolean,
                                opts?: { showLabel?: boolean },
                              ) => {
                                const lineColor = eq.hasData
                                  ? rc[eq.rarityValue] || "transparent"
                                  : "transparent";
                                const rarityCount =
                                  parseInt(eq.rarityValue, 10) || 0;
                                const imgSize = compact
                                  ? "w-14 h-14"
                                  : "w-20 h-20";
                                const svgSize = compact ? 12 : 16;
                                const nameSize = compact
                                  ? "text-xs"
                                  : "text-sm";
                                const levelNumSize = compact
                                  ? "text-xl"
                                  : "text-2xl";
                                const levelLabelSize = compact
                                  ? "text-[8px]"
                                  : "text-[10px]";
                                return (
                                  <div
                                    key={eq.key}
                                    className="relative bg-[#eeeeee] overflow-hidden h-full"
                                    style={{ borderRadius: 0 }}
                                  >
                                    {/* Top-left: Level or Label badge */}
                                    {eq.hasData && opts?.showLabel && (
                                      <div className="absolute top-0 left-0 z-10 flex items-baseline pt-[3px] pl-[3px]">
                                        <span className="text-black text-xs leading-tight">
                                          {eq.label}
                                        </span>
                                      </div>
                                    )}
                                    {eq.hasData &&
                                      !opts?.showLabel &&
                                      eq.levelNum !== null && (
                                        <div
                                          className="absolute top-0 left-1 z-10 flex items-baseline px-1"
                                          style={{
                                            background: `linear-gradient(to bottom, transparent ${eq.key === "weapon" ? "36px" : "16px"}, #d3d3d3 ${eq.key === "weapon" ? "36px" : "16px"})`,
                                          }}
                                        >
                                          <span
                                            className={
                                              "text-black " +
                                              levelNumSize +
                                              " leading-tight"
                                            }
                                          >
                                            {eq.levelNum}
                                          </span>
                                          <span
                                            className={
                                              levelLabelSize +
                                              " text-gray-500 ml-0.5 leading-tight"
                                            }
                                          >
                                            LEVEL
                                          </span>
                                          {eq.key === "weapon" &&
                                            charItem?.weapon?.refineLevel !=
                                              null && (
                                              <img
                                                src={`/assets/icons/potential/potential_${charItem.weapon.refineLevel}.png`}
                                                alt=""
                                                className="w-10 h-10 object-contain ml-[15px] translate-y-[17px]"
                                                onError={(e) => {
                                                  (
                                                    e.currentTarget as HTMLImageElement
                                                  ).style.display = "none";
                                                }}
                                              />
                                            )}
                                        </div>
                                      )}
                                    {/* Top-right: Equipment image */}
                                    <div
                                      className={
                                        "absolute top-0 right-0 z-10 " + imgSize
                                      }
                                    >
                                      {eq.hasData && eq.iconUrl ? (
                                        <Img
                                          src={eq.iconUrl}
                                          alt={eq.name || ""}
                                          className="w-full h-full object-contain"
                                        />
                                      ) : null}
                                    </div>
                                    {/* Bottom-left: Name (no SVG stars for tactical) */}
                                    <div className="absolute bottom-1 left-1 z-10 flex items-start gap-1">
                                      <div>
                                        {eq.hasData ? (
                                          <div className="flex flex-col items-start">
                                            {!opts?.showLabel && (
                                              <span className="inline-flex items-center gap-px">
                                                {Array.from({
                                                  length: rarityCount,
                                                }).map((_, i) => (
                                                  <img
                                                    key={i}
                                                    src={RARITY_ICON_URL}
                                                    alt=""
                                                    className="inline-block"
                                                    style={{
                                                      width: svgSize,
                                                      height: svgSize,
                                                    }}
                                                  />
                                                ))}
                                              </span>
                                            )}
                                            <span className="inline-flex items-center gap-1">
                                              {eq.hasData &&
                                                eq.key === "weapon" && (
                                                  <div
                                                    className="shrink-0 rounded-sm"
                                                    style={{
                                                      width: 3,
                                                      height: "1.1em",
                                                      backgroundColor:
                                                        lineColor,
                                                    }}
                                                  />
                                                )}
                                              <span
                                                className={
                                                  nameSize +
                                                  " text-black/90 leading-tight"
                                                }
                                              >
                                                {eq.name}
                                              </span>
                                            </span>
                                          </div>
                                        ) : (
                                          <span className="text-[10px] text-black/40 leading-tight">
                                            未装配
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    {/* Bottom: 3px rarity line inside card (not for weapon) */}
                                    {eq.key !== "weapon" && (
                                      <div
                                        className="absolute bottom-0 left-0 right-0"
                                        style={{
                                          borderBottom:
                                            "3px solid " + lineColor,
                                        }}
                                      />
                                    )}
                                  </div>
                                );
                              };

                              const renderGemCard = () => {
                                if (!gem?.icon && !gem?.name) return null;
                                const lineColor = gemRarity
                                  ? rc[gemRarity] || "transparent"
                                  : "transparent";
                                return (
                                  <div
                                    className="relative bg-[#eeeeee] overflow-hidden h-full"
                                    style={{ borderRadius: 0 }}
                                  >
                                    {gem?.icon && (
                                      <div className="absolute top-0 right-0 z-10 w-20 h-20">
                                        <Img
                                          src={gem.icon}
                                          alt={gem?.name || ""}
                                          className="w-full h-full object-contain"
                                        />
                                      </div>
                                    )}
                                    <div className="absolute bottom-1 left-1 z-10">
                                      <span className="text-xs text-black/70 leading-tight">
                                        {gem?.name || ""}
                                      </span>
                                    </div>
                                    <div
                                      className="absolute bottom-0 left-0 right-0"
                                      style={{
                                        borderBottom: "3px solid " + lineColor,
                                      }}
                                    />
                                  </div>
                                );
                              };

                              const weapon = equipData[0];
                              const rest = equipData.slice(1);

                              return (
                                <>
                                  {sectionTitle("武器")}
                                  <div
                                    className="flex gap-1.5"
                                    style={{ height: 95 }}
                                  >
                                    <div
                                      className="shrink-0"
                                      style={{ width: "65%" }}
                                    >
                                      {renderCard(weapon)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      {renderGemCard()}
                                    </div>
                                  </div>
                                  {sectionTitle("装备")}
                                  <div className="flex gap-1.5">
                                    <div className="flex flex-col gap-1.5 flex-1">
                                      <div style={{ height: 111 }}>
                                        {renderCard(rest[0])}
                                      </div>
                                      <div style={{ height: 111 }}>
                                        {renderCard(rest[1])}
                                      </div>
                                    </div>
                                    <div className="flex flex-col gap-1.5 flex-1">
                                      <div style={{ height: 72 }}>
                                        {renderCard(rest[2], true)}
                                      </div>
                                      <div style={{ height: 72 }}>
                                        {renderCard(rest[3], true)}
                                      </div>
                                      <div style={{ height: 72 }}>
                                        {renderCard(rest[4], true, {
                                          showLabel: true,
                                        })}
                                      </div>
                                    </div>
                                  </div>
                                </>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Backdrop */}
                    {hasSelection && (
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          backgroundColor: "rgba(0,0,0,0.25)",
                          backdropFilter: "blur(4px)",
                          zIndex: 10,
                        }}
                        onClick={closeDetailPanel}
                      />
                    )}

                    {/* Right drawer */}
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        bottom: 0,
                        right: hasSelection ? 0 : "-52%",
                        width: "52%",
                        transition: "right 300ms ease",
                        backgroundColor: "#dddddd",
                        zIndex: 20,
                      }}
                    >
                      <div className="h-full relative">
                        <button
                          onClick={closeDetailPanel}
                          className="absolute right-2 top-2 z-20 w-8 h-8 flex items-center justify-center text-black/40 hover:text-black transition-colors cursor-pointer rounded-full hover:bg-black/10"
                          title="Collapse detail"
                        >
                          <svg
                            className="w-5 h-5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </button>
                        <div className="h-full overflow-y-auto">
                          {selectedItem &&
                            (() => {
                              const skillLevel: number =
                                selectedItem._type === "skill" &&
                                sel?.id &&
                                charItem?.userSkills?.[sel.id]
                                  ? charItem.userSkills[sel.id].level
                                  : 1;
                              const isSkill = selectedItem._type === "skill";
                              const maxSkillLevel = 12;
                              const isMaxed =
                                isSkill && skillLevel >= maxSkillLevel;
                              const getBaseName = (n: string) =>
                                n.replace(
                                  /·(?:[αβγδε]|[一二三四五六七八九十]+|\d+)$/,
                                  "",
                                );
                              const talentRank = (() => {
                                if (!sel || selectedItem._type === "skill")
                                  return -1;
                                const pool =
                                  selectedItem._type === "abilityTalent"
                                    ? char.abilityTalents
                                    : selectedItem._type === "combatTalent"
                                      ? char.combatTalents
                                      : char.cultivationTalents || [];
                                const baseName = getBaseName(
                                  (selectedItem as any).name,
                                );
                                const sameBaseName = [...pool]
                                  .filter(
                                    (t: any) =>
                                      getBaseName(t.name) === baseName,
                                  )
                                  .sort((a: any, b: any) => {
                                    const numA = parseInt(
                                      a.id.match(/_(\d+)$/)?.[1] || "0",
                                    );
                                    const numB = parseInt(
                                      b.id.match(/_(\d+)$/)?.[1] || "0",
                                    );
                                    return numA - numB;
                                  });
                                const idx = sameBaseName.findIndex(
                                  (t: any) => t.id === sel.id,
                                );
                                return idx >= 0 ? idx + 1 : -1;
                              })();
                              const isPotential =
                                selectedItem._type === "potential";
                              const hasSkillForms =
                                !isPotential &&
                                skillFormTabs != null &&
                                skillFormTabs.length > 1;
                              const currentFormIndex = hasSkillForms
                                ? (sel?.formIndex ?? 0)
                                : 0;
                              const currentFormTab =
                                hasSkillForms && currentFormIndex >= 0
                                  ? skillFormTabs![currentFormIndex]
                                  : null;
                              const wikiBlocks = !isPotential
                                ? hasSkillForms && currentFormTab
                                  ? renderWikiBlocksFromIds(
                                      wikiDetail?.document?.documentMap,
                                      [currentFormTab.contentId],
                                      [currentFormTab.descriptionId],
                                      skillLevel,
                                      selectedItem._type || "",
                                      talentRank,
                                    )
                                  : getWikiRenderedBlocks(
                                      wikiDetail,
                                      (selectedItem as any).name || "",
                                      skillLevel,
                                      selectedItem._type || "",
                                      talentRank,
                                    )
                                : [];
                              const upgradeMaterials = !isPotential
                                ? getUpgradeMaterials(
                                    wikiDetail,
                                    (selectedItem as any).name || "",
                                    skillLevel,
                                    selectedItem._type || "",
                                    talentRank,
                                    false,
                                    hasSkillForms && currentFormTab
                                      ? currentFormTab.contentId
                                      : undefined,
                                  )
                                : [];
                              const upgradeToMax =
                                isSkill && !isMaxed && skillLevel < 12
                                  ? getUpgradeMaterials(
                                      wikiDetail,
                                      (selectedItem as any).name || "",
                                      skillLevel,
                                      selectedItem._type || "",
                                      talentRank,
                                      true,
                                      hasSkillForms && currentFormTab
                                        ? currentFormTab.contentId
                                        : undefined,
                                    )
                                  : [];

                              // 从 contentDoc 提取潜能描述文本块
                              const getPotentialSegments = (doc: any) => {
                                if (!doc?.blockMap || !doc?.blockIds) return [];
                                const result: {
                                  kind: string;
                                  segments: any[];
                                }[] = [];
                                for (const blockId of doc.blockIds) {
                                  const block = doc.blockMap[blockId];
                                  if (
                                    !block ||
                                    block.kind === "table" ||
                                    block.kind === "horizontalLine"
                                  )
                                    continue;
                                  const segs: any[] = [];
                                  if (block.text?.inlineElements) {
                                    for (const el of block.text
                                      .inlineElements) {
                                      if (
                                        el.kind === "text" ||
                                        el.kind === "link"
                                      ) {
                                        const rawColor = (el as any).color;
                                        const mappedColor = rawColor
                                          ? WIKI_COLOR_MAP[rawColor] || rawColor
                                          : undefined;
                                        segs.push({
                                          text: el.text?.text || "",
                                          bold: (el as any).bold || false,
                                          underline:
                                            (el as any).underline || false,
                                          color:
                                            rawColor === "light_text_primary"
                                              ? undefined
                                              : mappedColor,
                                        });
                                      }
                                    }
                                  }
                                  if (segs.length > 0) {
                                    result.push({
                                      kind: block.text?.kind || "text",
                                      segments: segs,
                                    });
                                  }
                                }
                                return result;
                              };
                              const contentDoc = isPotential
                                ? (selectedItem as any).contentDoc
                                : null;
                              const potentialSegments = contentDoc
                                ? getPotentialSegments(contentDoc)
                                : [];

                              return (
                                <div className="pl-10 p-5 text-[#222222]">
                                  <div className="flex items-center gap-4 mb-4">
                                    {hasSkillForms ? (
                                      <div className="flex gap-3">
                                        {skillFormTabs!.map((formTab, fi) => (
                                          <button
                                            key={fi}
                                            onClick={() => {
                                              setSelectedDetailItem(
                                                sel
                                                  ? { ...sel, formIndex: fi }
                                                  : null,
                                              );
                                            }}
                                            className={`flex flex-col items-center gap-1 rounded-lg p-1.5 transition-colors cursor-pointer ${
                                              fi === currentFormIndex
                                                ? "bg-black/15 ring-1 ring-black/20"
                                                : "hover:bg-black/10"
                                            }`}
                                          >
                                            <div
                                              className="relative w-12 h-12 rounded-full"
                                              style={{
                                                backgroundColor:
                                                  SKILL_BG_CIRCLE,
                                              }}
                                            >
                                              <div
                                                className="absolute rounded-full"
                                                style={
                                                  (selectedItem as any).type
                                                    ?.key ===
                                                  "skill_type_ultimate_skill"
                                                    ? {
                                                        top: 1,
                                                        right: 1,
                                                        bottom: 1,
                                                        left: 1,
                                                        backgroundColor:
                                                          SKILL_BG_COLORS[
                                                            (
                                                              selectedItem as any
                                                            ).property?.key
                                                          ] || "#5e5e5e",
                                                      }
                                                    : {
                                                        top: 1,
                                                        right: 1,
                                                        bottom: 1,
                                                        left: 1,
                                                        background: `conic-gradient(from 112.5deg, ${SKILL_BG_COLORS[(selectedItem as any).property?.key] || "#5e5e5e"} 0deg, ${SKILL_BG_COLORS[(selectedItem as any).property?.key] || "#5e5e5e"} 135deg, transparent 135deg)`,
                                                      }
                                                }
                                              />
                                              <Img
                                                src={formTab.iconUrl}
                                                alt={selectedItem.name}
                                                className="relative z-10 w-full h-full object-contain p-1.5 rounded-full"
                                                style={{
                                                  boxShadow:
                                                    "0 0 14px rgba(0,0,0,0.35)",
                                                }}
                                              />
                                            </div>
                                            <span className="text-xs leading-none text-[#222222]">
                                              {formTab.name}
                                            </span>
                                          </button>
                                        ))}
                                      </div>
                                    ) : isPotential ? (
                                      <img
                                        src={selectedItem.iconUrl}
                                        alt={selectedItem.name}
                                        className="w-16 h-16 object-contain p-1.5 rounded-full"
                                        style={{
                                          boxShadow:
                                            "0 0 14px rgba(0,0,0,0.35)",
                                        }}
                                      />
                                    ) : selectedItem._type === "skill" ? (
                                      <div
                                        className="relative w-16 h-16 rounded-full"
                                        style={{
                                          backgroundColor: SKILL_BG_CIRCLE,
                                        }}
                                      >
                                        <div
                                          className="absolute rounded-full"
                                          style={
                                            selectedItem.type?.key ===
                                            "skill_type_ultimate_skill"
                                              ? {
                                                  top: 1,
                                                  right: 1,
                                                  bottom: 1,
                                                  left: 1,
                                                  backgroundColor:
                                                    SKILL_BG_COLORS[
                                                      selectedItem.property?.key
                                                    ] || "#5e5e5e",
                                                }
                                              : {
                                                  top: 1,
                                                  right: 1,
                                                  bottom: 1,
                                                  left: 1,
                                                  background: `conic-gradient(from 112.5deg, ${SKILL_BG_COLORS[(selectedItem as any).property?.key] || "#5e5e5e"} 0deg, ${SKILL_BG_COLORS[(selectedItem as any).property?.key] || "#5e5e5e"} 135deg, transparent 135deg)`,
                                                }
                                          }
                                        />
                                        <Img
                                          src={selectedItem.iconUrl}
                                          alt={selectedItem.name}
                                          className="relative z-10 w-full h-full object-contain p-1.5 rounded-full"
                                          style={{
                                            boxShadow:
                                              "0 0 14px rgba(0,0,0,0.35)",
                                          }}
                                        />
                                      </div>
                                    ) : (
                                      <Img
                                        src={selectedItem.iconUrl}
                                        alt={selectedItem.name}
                                        className={`w-16 h-16 object-contain p-1.5 ${selectedItem._type === "cultivationTalent" ? "rounded-lg" : "rounded-full"}`}
                                        style={{
                                          backgroundColor: "#e9d72c",
                                          boxShadow:
                                            "0 0 14px rgba(0,0,0,0.35)",
                                        }}
                                      />
                                    )}
                                    <div>
                                      <h4 className="font-semibold text-lg text-[#222222]">
                                        {selectedItem.name}
                                      </h4>
                                      {selectedItem._type === "skill" && (
                                        <div className="flex flex-wrap items-center gap-2 mt-1">
                                          {"type" in selectedItem &&
                                            selectedItem.type && (
                                              <span className="inline-flex items-center bg-[#999999] text-white text-sm leading-none px-3 py-1.5 rounded-md font-medium">
                                                {selectedItem.type.value}
                                              </span>
                                            )}
                                          {sel?.id &&
                                            charItem?.userSkills?.[sel.id] &&
                                            (() => {
                                              const sl =
                                                charItem.userSkills[sel.id]
                                                  .level;
                                              return (
                                                <span className="inline-flex items-center gap-1 bg-[#999999] text-white text-sm leading-none px-3 py-1.5 rounded-md font-medium">
                                                  {sl >= 10 ? (
                                                    <img
                                                      src={`/assets/icons/specialization/rank_${sl >= 12 ? 12 : sl}.png`}
                                                      alt=""
                                                      className="h-[14px] w-auto object-contain"
                                                    />
                                                  ) : (
                                                    <span>RANK {sl}</span>
                                                  )}
                                                </span>
                                              );
                                            })()}
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  {isPotential ? (
                                    potentialSegments.length > 0 ? (
                                      potentialSegments.map((seg, i) =>
                                        seg.kind === "heading3" ? (
                                          <h5
                                            key={i}
                                            className="font-semibold text-[#222222] mt-4 mb-2 text-[15px]"
                                          >
                                            {seg.segments.map(
                                              (s: any, si: number) => {
                                                const isSpecial =
                                                  s.bold ||
                                                  s.underline ||
                                                  s.color;
                                                return (
                                                  <span
                                                    key={si}
                                                    style={{
                                                      fontWeight: isSpecial
                                                        ? 700
                                                        : undefined,
                                                      textDecoration:
                                                        s.underline
                                                          ? "underline"
                                                          : undefined,
                                                      color:
                                                        s.color || undefined,
                                                    }}
                                                  >
                                                    {s.text}
                                                  </span>
                                                );
                                              },
                                            )}
                                          </h5>
                                        ) : (
                                          <p
                                            key={i}
                                            className="text-[#222222] leading-relaxed text-[15px]"
                                          >
                                            {seg.segments.map(
                                              (s: any, si: number) => {
                                                const isSpecial =
                                                  s.bold ||
                                                  s.underline ||
                                                  s.color;
                                                return (
                                                  <span
                                                    key={si}
                                                    style={{
                                                      fontWeight: isSpecial
                                                        ? 700
                                                        : undefined,
                                                      textDecoration:
                                                        s.underline
                                                          ? "underline"
                                                          : undefined,
                                                      color:
                                                        s.color || undefined,
                                                    }}
                                                  >
                                                    {s.text}
                                                  </span>
                                                );
                                              },
                                            )}
                                          </p>
                                        ),
                                      )
                                    ) : (
                                      <p className="text-[#222222] italic mt-2 text-[15px]">
                                        暂无 Wiki 数据
                                      </p>
                                    )
                                  ) : (
                                    wikiBlocks.map((block, i) =>
                                      block.kind === "text" ? (
                                        block.data.kind === "heading3" ? (
                                          <h5
                                            key={i}
                                            className="font-semibold text-[#222222] mt-4 mb-2 text-[15px]"
                                          >
                                            {block.data.segments.map(
                                              (seg, si) => {
                                                const isSpecial =
                                                  seg.bold ||
                                                  seg.underline ||
                                                  seg.color;
                                                return (
                                                  <span
                                                    key={si}
                                                    style={{
                                                      fontWeight: isSpecial
                                                        ? 700
                                                        : undefined,
                                                      textDecoration:
                                                        seg.underline
                                                          ? "underline"
                                                          : undefined,
                                                      color:
                                                        seg.color || undefined,
                                                    }}
                                                  >
                                                    {seg.text}
                                                  </span>
                                                );
                                              },
                                            )}
                                          </h5>
                                        ) : (
                                          <p
                                            key={i}
                                            className="text-[#222222] leading-relaxed text-[15px]"
                                          >
                                            {block.data.segments.flatMap(
                                              (seg, si) => {
                                                const isSpecial =
                                                  seg.bold ||
                                                  seg.underline ||
                                                  seg.color;
                                                const parts =
                                                  seg.text.split("\n");
                                                return parts.flatMap(
                                                  (part, pi) => {
                                                    const nodes: React.ReactNode[] =
                                                      [];
                                                    if (pi > 0)
                                                      nodes.push(
                                                        <br
                                                          key={`${si}-br-${pi}`}
                                                        />,
                                                      );
                                                    nodes.push(
                                                      <span
                                                        key={`${si}-${pi}`}
                                                        style={{
                                                          fontWeight: isSpecial
                                                            ? 700
                                                            : undefined,
                                                          textDecoration:
                                                            seg.underline
                                                              ? "underline"
                                                              : undefined,
                                                          color:
                                                            seg.color ||
                                                            undefined,
                                                        }}
                                                      >
                                                        {part}
                                                      </span>,
                                                    );
                                                    return nodes;
                                                  },
                                                );
                                              },
                                            )}
                                          </p>
                                        )
                                      ) : block.kind === "materials" ? null : (
                                        <div
                                          key={i}
                                          className="mt-3 bg-black/20 rounded-lg p-3"
                                        >
                                          {block.data.map((p, pi) => {
                                            const hasNext =
                                              p.nextValue &&
                                              p.nextValue !== p.value;
                                            const extractUnit = (
                                              s: string,
                                            ): string => {
                                              const m =
                                                s.match(/^[\d.,]+([\s\S]*)$/);
                                              return m ? m[1] : "";
                                            };
                                            const unit = extractUnit(p.value);
                                            const parseNum = (
                                              s: string,
                                            ): number | null => {
                                              const m = s
                                                .replace(/,/g, "")
                                                .match(/^-?[\d.]+/);
                                              return m
                                                ? parseFloat(m[0])
                                                : null;
                                            };
                                            const currNum = parseNum(p.value);
                                            const nextNum = hasNext
                                              ? parseNum(p.nextValue!)
                                              : null;
                                            const showDelta =
                                              currNum !== null &&
                                              nextNum !== null;
                                            const delta = showDelta
                                              ? nextNum! - currNum!
                                              : null;
                                            return (
                                              <div
                                                key={pi}
                                                className="flex items-center justify-between py-1.5 text-[14px] border-b border-white/5 last:border-b-0"
                                              >
                                                <span className="text-[#222222] font-medium">
                                                  {p.label}
                                                </span>
                                                <span className="text-[#222222] font-mono text-right inline-flex items-center gap-1.5">
                                                  <span>{p.value}</span>
                                                  {hasNext && (
                                                    <>
                                                      <span className="text-[#888]">
                                                        →
                                                      </span>
                                                      <span>{p.nextValue}</span>
                                                    </>
                                                  )}
                                                  <span className="inline-flex items-center min-w-[60px] justify-end">
                                                    {hasNext &&
                                                    showDelta &&
                                                    delta !== 0 ? (
                                                      <span className="font-bold text-[15px] leading-none text-white">
                                                        {delta! > 0 ? "+" : ""}
                                                        {Math.round(delta!)}
                                                        {unit}
                                                      </span>
                                                    ) : !hasNext && isMaxed ? (
                                                      <span className="font-bold text-[15px] leading-none text-white">
                                                        MAX
                                                      </span>
                                                    ) : (
                                                      <span className="w-8 inline-block" />
                                                    )}
                                                  </span>
                                                </span>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      ),
                                    )
                                  )}
                                  {!isPotential && wikiBlocks.length === 0 && (
                                    <p className="text-[#222222] italic mt-2 text-[15px]">
                                      暂无 Wiki 数据
                                    </p>
                                  )}

                                  {/* Upgrade Materials */}
                                  {!isPotential &&
                                    !isMaxed &&
                                    upgradeMaterials.length > 0 && (
                                      <div className="mt-4">
                                        <h5 className="font-semibold text-[#222222] text-[14px] mb-2">
                                          {isSkill
                                            ? `升级至 Lv.${skillLevel + 1} 所需材料`
                                            : "下一级所需材料"}
                                        </h5>
                                        <div className="bg-black/20 rounded-lg p-3 space-y-1">
                                          {upgradeMaterials.map((mat, mi) => {
                                            const itemInfo = itemNameMap?.get(
                                              mat.itemId,
                                            );
                                            const itemName =
                                              itemInfo?.name ||
                                              `#${mat.itemId}`;
                                            const coverUrl =
                                              materialCoverMap[mat.itemId];
                                            return (
                                              <div
                                                key={mi}
                                                className="flex items-center justify-between py-1 text-[14px]"
                                              >
                                                <div className="flex items-center gap-2">
                                                  {coverUrl && (
                                                    <Img
                                                      src={coverUrl}
                                                      className="w-7 h-7 rounded object-cover shrink-0"
                                                    />
                                                  )}
                                                  <span className="text-[#222222]">
                                                    {itemName}
                                                  </span>
                                                </div>
                                                <span className="text-[#222222] font-mono font-semibold">
                                                  ×{mat.count}
                                                </span>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    )}

                                  {/* To Max Materials */}
                                  {isSkill &&
                                    !isMaxed &&
                                    skillLevel < 11 &&
                                    upgradeToMax.length > 0 && (
                                      <div className="mt-3">
                                        <h5 className="font-semibold text-[#222222] text-[14px] mb-2">
                                          升级至满级 (Lv.12) 共需
                                        </h5>
                                        <div className="bg-black/15 rounded-lg p-3 space-y-1">
                                          {upgradeToMax.map((mat, mi) => {
                                            const itemInfo = itemNameMap?.get(
                                              mat.itemId,
                                            );
                                            const itemName =
                                              itemInfo?.name ||
                                              `#${mat.itemId}`;
                                            const coverUrl =
                                              materialCoverMap[mat.itemId];
                                            return (
                                              <div
                                                key={mi}
                                                className="flex items-center justify-between py-1 text-[13px]"
                                              >
                                                <div className="flex items-center gap-2">
                                                  {coverUrl && (
                                                    <Img
                                                      src={coverUrl}
                                                      className="w-6 h-6 rounded object-cover shrink-0"
                                                    />
                                                  )}
                                                  <span className="text-[#222222]">
                                                    {itemName}
                                                  </span>
                                                </div>
                                                <span className="text-[#222222] font-mono font-semibold">
                                                  ×{mat.count}
                                                </span>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    )}
                                </div>
                              );
                            })()}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })()
        ) : (
          <>
            <CustomModalHeader onClose={onClose}>
              {viewMode === "list" ? (
                <div className="flex items-center w-full">
                  <h2>{t("card:title")}</h2>
                </div>
              ) : null}
            </CustomModalHeader>

            {/* Slot Bar — 独立区域，不随内容滚动 */}
            {viewMode === "list" && (
              <div className="px-6 py-3 border-b border-separator glass-surface">
                <div className="flex items-center gap-3">
                  {Array.from({ length: maxSlots }).map((_, slotIndex) => {
                    const currentCharId = tempSelectedIds[slotIndex];
                    const currentChar = currentCharId
                      ? getCharById(currentCharId)
                      : null;

                    return (
                      <div
                        key={slotIndex}
                        ref={(el) => {
                          slotRefs.current[slotIndex] = el;
                        }}
                        className={`relative flex-1 min-w-0 rounded-lg border-2 transition-all ${
                          dragOverSlot === slotIndex
                            ? "border-blue-500 bg-blue-50 dark:bg-blue-900/40 scale-105 shadow-md"
                            : currentChar
                              ? "border-blue-400/60 glass-surface"
                              : "border-dashed border-separator bg-default-50"
                        }`}
                      >
                        {currentChar ? (
                          <div className="flex items-center gap-2 p-1.5">
                            <Img
                              src={currentChar.avatarSqUrl}
                              alt={currentChar.name}
                              className="w-10 h-10 rounded shrink-0 avatar-feather"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-medium truncate">
                                {currentChar.name}
                              </div>
                              <div className="text-[10px] text-muted">
                                {t("common.slot", { number: slotIndex + 1 }) ||
                                  `Slot ${slotIndex + 1}`}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveFromSlot(slotIndex);
                              }}
                              className="w-5 h-5 rounded-full bg-default-200 hover:bg-danger/20 hover:text-danger-text flex items-center justify-center shrink-0 transition-colors"
                              title={t("common.remove") || "Remove"}
                            >
                              <svg
                                className="w-3 h-3"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M6 18L18 6M6 6l12 12"
                                />
                              </svg>
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-1.5 p-2 text-muted">
                            <svg
                              className="w-4 h-4"
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
                            <span className="text-xs">
                              {t("common.slot", { number: slotIndex + 1 }) ||
                                `Slot ${slotIndex + 1}`}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Body */}
            <CustomModalBody
              ref={modalBodyRef}
              onScroll={handleScroll}
              className="!p-0"
            >
              {viewMode === "list" ? (
                <div className="space-y-4">
                  {/* Filter Section — 6 维 FloatSelect（WIKI 风格） */}
                  {showFilters && (
                    <div className="px-6 pt-4 pb-3 border-b border-separator space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <FloatSelect
                          label={t("filters.profession")}
                          value={filters.profession}
                          options={[
                            {
                              value: "all",
                              label: t("filters.all_professions"),
                            },
                            ...uniqueProfessions.map((v) => ({
                              value: v,
                              label: v,
                            })),
                          ]}
                          onChange={(v) => setFilter("profession", v)}
                        />
                        <FloatSelect
                          label={t("filters.rarity")}
                          value={filters.rarity}
                          options={[
                            { value: "all", label: t("filters.all_rarities") },
                            ...uniqueRarities.map((v) => ({
                              value: v,
                              label: `${v}★`,
                              tone: rarityTone(v),
                            })),
                          ]}
                          onChange={(v) => setFilter("rarity", v)}
                        />
                        <FloatSelect
                          label={t("filters.property")}
                          value={filters.property}
                          options={[
                            {
                              value: "all",
                              label: t("filters.all_properties"),
                            },
                            ...uniqueProperties.map((v) => ({
                              value: v,
                              label: v,
                            })),
                          ]}
                          onChange={(v) => setFilter("property", v)}
                        />
                        <FloatSelect
                          label={t("filters.weapon")}
                          value={filters.weapon}
                          options={[
                            { value: "all", label: t("filters.all_weapons") },
                            ...uniqueWeapons.map((v) => ({
                              value: v,
                              label: v,
                            })),
                          ]}
                          onChange={(v) => setFilter("weapon", v)}
                        />
                        <FloatSelect
                          label={t("filters.mainAttr")}
                          value={filters.mainAttr}
                          options={[
                            { value: "all", label: t("filters.all_mainAttrs") },
                            ...uniqueMainAttrs.map((v) => ({
                              value: v,
                              label: v,
                            })),
                          ]}
                          onChange={(v) => setFilter("mainAttr", v)}
                        />
                        <FloatSelect
                          label={t("filters.subAttr")}
                          value={filters.subAttr}
                          options={[
                            { value: "all", label: t("filters.all_subAttrs") },
                            ...uniqueSubAttrs.map((v) => ({
                              value: v,
                              label: v,
                            })),
                          ]}
                          onChange={(v) => setFilter("subAttr", v)}
                        />

                        <GlassButton
                          size="sm"
                          variant="outline"
                          isIconOnly
                          className="rounded-full!"
                          aria-label={t("common.clear")}
                          onPress={resetFilters}
                        >
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                        </GlassButton>
                      </div>
                    </div>
                  )}

                  {/* Character Grid — WIKI OperatorCard 风格 */}
                  {filteredCharacters.length === 0 ? (
                    <div className="text-center py-8 text-muted">
                      <p>
                        {t("common.no_results_found") || "No characters found"}
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-2.5 px-6 pb-6">
                      {filteredCharacters.map((char) => (
                        <OperatorCard
                          key={char.charData.id}
                          char={char}
                          isPinned={tempSelectedIds.includes(char.charData.id)}
                          onOpenDetail={() => {
                            setDetailCharId(char.charData.id);
                            setViewMode("detail");
                            setEnteredDetailFromCard(false);
                          }}
                          onDragMouseDown={(charId, e) =>
                            handleDragStart(charId, e)
                          }
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </CustomModalBody>
          </>
        )}

        {/* Back to Top Button */}
        {viewMode === "list" && showBackToTop && (
          <button
            className="fixed bottom-6 right-6 z-[10003] w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center transition-all duration-300 hover:scale-110"
            onClick={() => {
              if (modalBodyRef.current) {
                modalBodyRef.current.scrollTo({ top: 0, behavior: "smooth" });
              }
            }}
            onMouseEnter={() => setIsHoveringBackToTop(true)}
            onMouseLeave={() => setIsHoveringBackToTop(false)}
            aria-label="Back to top"
          >
            {isHoveringBackToTop ? (
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 8h18M12 20V8m0 0l-6 6m6-6l6 6"
                />
              </svg>
            ) : (
              <span className="text-xs font-bold">{scrollPercent}%</span>
            )}
          </button>
        )}

        {/* Drag Ghost */}
        {dragPos &&
          dragCharIdRef.current &&
          (() => {
            const charData = getCharById(dragCharIdRef.current!);
            if (!charData) return null;
            return (
              <div
                ref={dragGhostRef}
                className="fixed pointer-events-none z-[10004] flex flex-col items-center"
                style={{
                  left: dragPos.x - 40,
                  top: dragPos.y - 60,
                  width: 80,
                  height: 100,
                }}
              >
                <Img
                  src={charData.avatarSqUrl}
                  alt={charData.name}
                  className="w-16 h-20 rounded-lg object-cover shadow-xl ring-2 ring-blue-500"
                />
                <div className="text-xs font-bold text-white bg-blue-500/90 px-2 py-0.5 rounded-full mt-1 whitespace-nowrap shadow">
                  {charData.name}
                </div>
              </div>
            );
          })()}
      </CustomModal>
    </>
  );
}
