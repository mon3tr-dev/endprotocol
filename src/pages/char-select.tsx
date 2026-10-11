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
  GlassChip,
  GlassMeter,
  GlassProgressCircle,
} from "@/components/ui/glass";
import {
  CustomModal,
  CustomModalHeader,
  CustomModalBody,
} from "@/components/custom-modal";
import { CharDetailData, CharacterItem } from "@/types/charDetail";
import { getWikiRenderedBlocks, WIKI_COLOR_MAP } from "@/utils/wikiTableParser";
import { useTranslation } from "react-i18next";
import { Img } from "@/utils/imageLoader";
import { useImageRequest } from "@/utils/imageCacheManager";
import { roleDataService } from "@/utils/roleDataService";
import { getConfig } from "@/utils/configService";
import { logError } from "@/utils/logger";
import { MorphIcon } from "morphicons/react";
import { X } from "lucide";

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

export type FilterKey =
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
export function FloatSelect({
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
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 0 });

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onScroll = () => setOpen(false);
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
    if (next && wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      setMenuPos({ top: r.bottom + 4, left: r.left, width: r.width });
    }
    setOpen(next);
  };

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
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
            ref={menuRef}
            className="fixed z-[9999] min-w-[120px] max-h-64 overflow-y-auto rounded-md border border-separator bg-background glass-surface-strong shadow-lg animate-scale-in"
            style={{
              top: menuPos.top,
              left: menuPos.left,
              width: Math.max(120, menuPos.width || 0),
            }}
            onClick={(e) => e.stopPropagation()}
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
          document.body,
        )}
    </div>
  );
}

// ====== WIKI OperatorCard ======
// 复刻 WIKI 列表卡：全幅立绘背景 + 渐变蒙版 + 顶角稀有度星 + 右上 pin/LED + 底栏图标+名称+稀有度色条
export function OperatorCard({
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
        <div className="absolute bottom-7 right-1.5 z-10">
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
          className="h-[3px] w-full"
          style={{ backgroundColor: lineColor }}
        />
      </div>
    </div>
  );
}

// 模块级稀有度色条（与 OperatorCard 同源；后续可提取共享）
export function rarityLineColorLocal(value: string): string {
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
  }, []);

  // Reset all state when modal opens to ensure fresh data
  useEffect(() => {
    if (isOpen) {
      setTempSelectedIds(selectedCharIds);
      setViewMode(initialViewMode || "list");
      setDetailCharId(initialCharId || null);
      setEnteredDetailFromCard(initialViewMode === "detail");
      setSuccessMessage(null); // Clear success message
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
    setTimeout(() => onSave(newSelectedIds)); // 延迟保存，避免父组件重渲染导致 HeroUI Modal.Body 丢失滚动
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

            const equipData = [
              {
                key: "weapon",
                label: "武器",
                data: charItem?.weapon
                  ? {
                      iconUrl: charItem.weapon.weaponData?.iconUrl,
                      name: (charItem.weapon.weaponData?.name || "").trim(),
                      rarity: charItem.weapon.weaponData?.rarity?.value || "3",
                      level: `Lv.${charItem.weapon.level}`,
                    }
                  : null,
              },
              {
                key: "body",
                label: "护甲",
                data: charItem?.bodyEquip?.equipData
                  ? {
                      iconUrl: charItem.bodyEquip.equipData.iconUrl,
                      name: (charItem.bodyEquip.equipData.name || "").trim(),
                      rarity:
                        (
                          charItem.bodyEquip.equipData.rarity?.key || ""
                        ).replace("equip_rarity_", "") || "3",
                      level: charItem.bodyEquip.equipData.level?.value
                        ? `Lv.${charItem.bodyEquip.equipData.level.value}`
                        : undefined,
                    }
                  : null,
              },
              {
                key: "arm",
                label: "护手",
                data: charItem?.armEquip?.equipData
                  ? {
                      iconUrl: charItem.armEquip.equipData.iconUrl,
                      name: (charItem.armEquip.equipData.name || "").trim(),
                      rarity:
                        (charItem.armEquip.equipData.rarity?.key || "").replace(
                          "equip_rarity_",
                          "",
                        ) || "3",
                      level: charItem.armEquip.equipData.level?.value
                        ? `Lv.${charItem.armEquip.equipData.level.value}`
                        : undefined,
                    }
                  : null,
              },
              {
                key: "acc1",
                label: "配件",
                data: charItem?.firstAccessory?.equipData
                  ? {
                      iconUrl: charItem.firstAccessory.equipData.iconUrl,
                      name: (
                        charItem.firstAccessory.equipData.name || ""
                      ).trim(),
                      rarity:
                        (
                          charItem.firstAccessory.equipData.rarity?.key || ""
                        ).replace("equip_rarity_", "") || "3",
                      level: charItem.firstAccessory.equipData.level?.value
                        ? `Lv.${charItem.firstAccessory.equipData.level.value}`
                        : undefined,
                    }
                  : null,
              },
              {
                key: "acc2",
                label: "配件",
                data: charItem?.secondAccessory?.equipData
                  ? {
                      iconUrl: charItem.secondAccessory.equipData.iconUrl,
                      name: (
                        charItem.secondAccessory.equipData.name || ""
                      ).trim(),
                      rarity:
                        (
                          charItem.secondAccessory.equipData.rarity?.key || ""
                        ).replace("equip_rarity_", "") || "3",
                      level: charItem.secondAccessory.equipData.level?.value
                        ? `Lv.${charItem.secondAccessory.equipData.level.value}`
                        : undefined,
                    }
                  : null,
              },
              {
                key: "tactical",
                label: "战术物品",
                data: charItem?.tacticalItem?.tacticalItemData
                  ? {
                      iconUrl: charItem.tacticalItem.tacticalItemData.iconUrl,
                      name: charItem.tacticalItem.tacticalItemData.name || "",
                      rarity:
                        (
                          charItem.tacticalItem.tacticalItemData.rarity?.key ||
                          ""
                        ).replace("equip_rarity_", "") || "3",
                    }
                  : null,
              },
            ];
            return (
              <div
                className="h-full w-full relative overflow-hidden rounded-2xl"
                style={{ border: "none" }}
              >
                {/* Close button at top-right corner */}
                <button
                  onClick={() => {
                    if (enteredDetailFromCard) {
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
                      className="text-primary"
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
                      <div className="h-full p-3 flex flex-col items-center justify-center">
                        <Img
                          src={char.illustrationUrl}
                          alt={char.name}
                          className="w-full h-full object-contain"
                        />
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
                        {/* Character Info Header */}
                        <div className="flex items-start justify-between pb-3 border-b border-black/10">
                          <div className="flex items-start gap-3 min-w-0">
                            <div className="flex flex-col items-center gap-0.5">
                              <Img
                                src={char.avatarSqUrl}
                                alt={char.name}
                                className="w-12 h-12 rounded-lg shadow-sm shrink-0 avatar-feather"
                              />
                              {charItem?.level != null && (
                                <span className="text-[13px] font-semibold text-gray-500 leading-none">
                                  Lv.{charItem.level}
                                </span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="text-base font-bold text-black truncate">
                                  {char.name}
                                </h3>
                              </div>
                              <div className="flex items-center gap-1 mt-0.5">
                                {renderRarityIcons(char.rarity.value, 14)}
                              </div>
                              <div className="flex items-center gap-1.5 text-xs text-black/70 mt-0.5 flex-wrap">
                                <span>{char.profession.value}</span>
                                <span className="text-black/40">·</span>
                                <span>{char.property.value}</span>
                                <span className="text-black/40">·</span>
                                <span>{char.weaponType.value}</span>
                              </div>
                            </div>
                          </div>
                          {charItem?.evolvePhase != null && (
                            <img
                              src={`/assets/icons/evolve/phase-${charItem.evolvePhase}.png`}
                              alt={`Phase ${charItem.evolvePhase}`}
                              className="h-12 w-auto object-contain shrink-0 mr-8"
                            />
                          )}
                        </div>

                        {/* Talent Array + Equipment side by side */}
                        <div className="flex gap-6">
                          <div className="flex-1 space-y-6 min-w-0">
                            {/* Skills */}
                            <div>
                              <div className="flex flex-wrap gap-5">
                                {char.skills.map((skill) => {
                                  const isSel =
                                    sel?.type === "skill" &&
                                    sel.id === skill.id;
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
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Ability Talents */}
                            <div>
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
                                            ? "#e9d72c"
                                            : "#404040",
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
                          <div className="flex flex-col gap-2 w-40 shrink-0 justify-center">
                            {equipData.map((eq) => {
                              const d = eq.data;
                              const rc: Record<string, string> = {
                                "3": "#3b82f6",
                                "4": "#a855f7",
                                "5": "#ea580c",
                                "6": "#dc2626",
                              };
                              const lineColor = d
                                ? rc[d.rarity] || "transparent"
                                : "transparent";
                              return (
                                <div
                                  key={eq.key}
                                  className="flex items-center gap-2"
                                >
                                  <div className="flex flex-col items-center">
                                    <div className="w-16 h-16 shrink-0 flex items-center justify-center overflow-hidden text-black/30 font-bold text-3xl">
                                      {d ? (
                                        <Img
                                          src={d.iconUrl}
                                          alt={d.name}
                                          className="w-full h-full object-contain"
                                        />
                                      ) : (
                                        <MorphIcon icon={X} size={20} aria-hidden />
                                      )}
                                    </div>
                                    <div
                                      className="h-[3px] w-full rounded-full"
                                      style={{ backgroundColor: lineColor }}
                                    />
                                  </div>
                                  <div className="min-w-0">
                                    {d ? (
                                      <>
                                        <div className="text-[11px] text-black/50 leading-tight">
                                          {eq.label}
                                        </div>
                                        <div className="leading-tight text-sm text-black/80">
                                          {d.name}
                                        </div>
                                        {d.level && (
                                          <div className="text-[13px] text-black/50">
                                            {d.level}
                                          </div>
                                        )}
                                      </>
                                    ) : (
                                      <>
                                        <div className="text-[11px] text-black/50 leading-tight">
                                          {eq.label}
                                        </div>
                                        <div className="text-sm text-black/40 leading-tight">
                                          未装配
                                        </div>
                                      </>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
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
                              const wikiBlocks = !isPotential
                                ? getWikiRenderedBlocks(
                                    wikiDetail,
                                    (selectedItem as any).name || "",
                                    skillLevel,
                                    selectedItem._type || "",
                                    talentRank,
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
                                    {isPotential ? (
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
                                                  background: `conic-gradient(from 112.5deg, ${SKILL_BG_COLORS[selectedItem.property?.key] || "#5e5e5e"} 0deg, ${SKILL_BG_COLORS[selectedItem.property?.key] || "#5e5e5e"} 135deg, transparent 135deg)`,
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
                                      {"type" in selectedItem &&
                                        selectedItem.type && (
                                          <p className="text-[#222222] text-[15px]">
                                            {selectedItem.type.value}
                                            {"property" in selectedItem &&
                                              selectedItem.property && (
                                                <>
                                                  {" "}
                                                  •{" "}
                                                  {selectedItem.property.value}
                                                </>
                                              )}
                                            {selectedItem._type === "skill" &&
                                              sel?.id &&
                                              charItem?.userSkills?.[
                                                sel.id
                                              ] && (
                                                <>
                                                  {" "}
                                                  • Lv.
                                                  {
                                                    charItem.userSkills[sel.id]
                                                      .level
                                                  }
                                                </>
                                              )}
                                          </p>
                                        )}
                                    </div>
                                  </div>

                                  {isSkill &&
                                    (() => {
                                      const progress = Math.min(
                                        Math.round(
                                          (skillLevel / maxSkillLevel) * 100,
                                        ),
                                        100,
                                      );
                                      return (
                                        <div className="mb-5">
                                          <div className="flex items-center justify-between mb-1.5">
                                            <span className="text-[#222222] text-xs">
                                              技能等级
                                            </span>
                                            <span className="flex items-center gap-2">
                                              <span className="text-[#222222] text-sm font-medium">
                                                Lv.{skillLevel} /{" "}
                                                {maxSkillLevel}
                                              </span>
                                              {isMaxed && (
                                                <GlassChip
                                                  size="sm"
                                                  variant="soft"
                                                  color="success"
                                                  className="text-[10px]"
                                                >
                                                  MAX
                                                </GlassChip>
                                              )}
                                            </span>
                                          </div>
                                          <GlassMeter
                                            aria-label="Skill level progress"
                                            value={progress}
                                            className="w-full"
                                          >
                                            <GlassMeter.Track className="h-2 rounded-full bg-[#555]">
                                              <GlassMeter.Fill
                                                className={`h-2 rounded-full transition-all duration-500 ${isMaxed ? "bg-gradient-to-r from-green-500 to-emerald-400" : "bg-gradient-to-r from-yellow-500 to-orange-400"}`}
                                              />
                                            </GlassMeter.Track>
                                          </GlassMeter>
                                          {!isMaxed && (
                                            <p className="text-[#a09070] text-[11px] mt-1">
                                              离满级还差{" "}
                                              {maxSkillLevel - skillLevel} 级
                                            </p>
                                          )}
                                        </div>
                                      );
                                    })()}

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
                                                <span className="text-[#222222] font-mono text-right">
                                                  {p.value}
                                                  {!hasNext && isMaxed && (
                                                    <GlassChip
                                                      size="sm"
                                                      variant="soft"
                                                      color="success"
                                                      className="ml-1.5 text-[10px] min-w-0"
                                                    >
                                                      MAX
                                                    </GlassChip>
                                                  )}
                                                  {hasNext && (
                                                    <>
                                                      <span className="text-[#888] mx-1.5">
                                                        →
                                                      </span>
                                                      <span className="text-[#222222]">
                                                        {p.nextValue}
                                                      </span>
                                                      {showDelta &&
                                                        delta !== 0 && (
                                                          <GlassChip
                                                            size="sm"
                                                            variant="soft"
                                                            color={
                                                              delta! > 0
                                                                ? "success"
                                                                : "accent"
                                                            }
                                                            className="ml-1.5 text-[10px] min-w-0"
                                                          >
                                                            {delta! > 0
                                                              ? "+"
                                                              : ""}
                                                            {delta}
                                                            {unit}
                                                          </GlassChip>
                                                        )}
                                                    </>
                                                  )}
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
                              className="w-5 h-5 rounded-full bg-default-200 hover:bg-danger/20 hover:text-danger flex items-center justify-center shrink-0 transition-colors"
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
