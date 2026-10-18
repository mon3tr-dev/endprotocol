import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { CloseIcon } from "@/components/ui/app-icon";
import { AchieveMedal } from "@/types/charDetail";
import { useTranslation } from "react-i18next";
import { Img } from "@/utils/imageLoader";
import { useImageRequest } from "@/utils/imageCacheManager";
import { BackToTopFab } from "@/components/ui/back-to-top";

const HEX_CLIP =
  "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)";

export function effectiveLevel(medal: AchieveMedal): number {
  return Math.min(medal.achievementData.initLevel + medal.level - 1, 3);
}

export function getMedalIcon(medal: AchieveMedal): string {
  if (medal.isPlated && medal.achievementData.platedIcon) {
    return medal.achievementData.platedIcon;
  }
  const lv = effectiveLevel(medal);
  if (lv >= 3 && medal.achievementData.reforge3Icon)
    return medal.achievementData.reforge3Icon;
  if (lv >= 2 && medal.achievementData.reforge2Icon)
    return medal.achievementData.reforge2Icon;
  return medal.achievementData.initIcon || "";
}

export function formatTimestamp(ts: string): string {
  if (!ts) return "";
  const num = parseInt(ts, 10);
  if (isNaN(num)) return ts;
  const d = new Date(num * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const LEVEL_NAMES: Record<number, string> = { 1: "一级", 2: "二级", 3: "三级" };

function ReforgeLevel({ medal }: { medal: AchieveMedal }) {
  const lv = effectiveLevel(medal);
  return (
    <span className="text-foreground font-medium">
      {LEVEL_NAMES[lv] ?? `Lv.${lv}`}
    </span>
  );
}

interface MedalBrowserProps {
  medals: AchieveMedal[];
  selectedIds?: string[];
  onToggle?: (id: string) => void;
  headerLeft?: React.ReactNode;
}

export function MedalBrowser({
  medals,
  selectedIds,
  onToggle,
  headerLeft,
}: MedalBrowserProps) {
  const { t } = useTranslation();
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [levelFilter, setLevelFilter] = useState(0);
  const [platedFilter, setPlatedFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("time");
  const [globalQuery, setGlobalQuery] = useState("");
  const [scrollTargetId, setScrollTargetId] = useState<string | null>(null);
  const medalListRef = useRef<HTMLDivElement>(null);
  const getMedalList = useCallback(() => medalListRef.current, []);

  const categories = useMemo(() => {
    const catMap = new Map<string, string>();
    catMap.set("all", t("card:ach_all"));
    for (const m of medals) {
      if (!catMap.has(m.achievementData.cate)) {
        catMap.set(m.achievementData.cate, m.achievementData.cateName);
      }
    }
    return Array.from(catMap.entries()).map(([key, label]) => ({ key, label }));
  }, [medals, t]);

  const levelOptions = useMemo(() => {
    const set = new Set<number>();
    for (const m of medals) set.add(effectiveLevel(m));
    return [0, ...[1, 2, 3].filter((l) => set.has(l))];
  }, [medals]);

  const LEVEL_LABELS: Record<number, string> = {
    0: t("card:ach_all"),
    1: "一级",
    2: "二级",
    3: "三级",
  };

  const filteredMedals = useMemo(() => {
    let result = medals;
    if (activeCategory !== "all")
      result = result.filter((m) => m.achievementData.cate === activeCategory);
    if (levelFilter > 0)
      result = result.filter((m) => effectiveLevel(m) === levelFilter);
    if (platedFilter === "plated") result = result.filter((m) => m.isPlated);
    else if (platedFilter === "unplated")
      result = result.filter((m) => !m.isPlated);
    result = [...result].sort((a, b) => {
      const byName = a.achievementData.name.localeCompare(
        b.achievementData.name,
      );
      if (sortBy === "time") {
        const byTime = Number(b.obtainTs) - Number(a.obtainTs);
        if (byTime !== 0) return byTime;
        const byLevel = effectiveLevel(b) - effectiveLevel(a);
        if (byLevel !== 0) return byLevel;
        return byName;
      }
      const byLevel = effectiveLevel(b) - effectiveLevel(a);
      if (byLevel !== 0) return byLevel;
      const byTime = Number(b.obtainTs) - Number(a.obtainTs);
      if (byTime !== 0) return byTime;
      return byName;
    });
    return result;
  }, [medals, activeCategory, levelFilter, platedFilter, sortBy]);

  const globalResults = useMemo(() => {
    const q = globalQuery.trim().toLowerCase();
    if (!q) return [];
    return medals
      .filter((m) => m.achievementData.name.toLowerCase().includes(q))
      .sort((a, b) =>
        a.achievementData.name.localeCompare(b.achievementData.name),
      );
  }, [medals, globalQuery]);

  const handleLocate = (medal: AchieveMedal) => {
    setActiveCategory(medal.achievementData.cate);
    setLevelFilter(0);
    setPlatedFilter("all");
    setGlobalQuery("");
    setScrollTargetId(medal.achievementData.id);
  };

  useEffect(() => {
    if (!scrollTargetId) return;
    const timer = setTimeout(() => {
      const el = document.querySelector(
        `[data-medal-id="${CSS.escape(scrollTargetId)}"]`,
      );
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      setScrollTargetId(null);
    }, 60);
    return () => clearTimeout(timer);
  }, [scrollTargetId]);

  // 切换分类后，右侧列表回到新分类最上方
  useEffect(() => {
    if (medalListRef.current) medalListRef.current.scrollTop = 0;
  }, [activeCategory]);

  const imagePaths = useMemo(
    () => filteredMedals.map((m) => getMedalIcon(m)).filter(Boolean),
    [filteredMedals],
  );
  useImageRequest(imagePaths, [imagePaths]);

  const selectable = selectedIds != null;

  return (
    <>
      <div className="flex gap-2 h-full overflow-hidden p-0.5">
        <div className="w-44 shrink-0 flex flex-col px-2 rounded-xl border border-separator/70 glass-surface overflow-x-hidden">
          <div className="relative mb-2 shrink-0">
            <div className="relative p-1.5">
              <input
                type="text"
                value={globalQuery}
                onChange={(e) => setGlobalQuery(e.target.value)}
                placeholder={t("card:ach_search")}
                className="w-full px-2 py-1.5 pl-2 pr-6 rounded-lg glass-field border border-separator/70 text-xs text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-200 hover:border-primary/50"
              />
              {globalQuery && (
                <button
                  type="button"
                  onClick={() => setGlobalQuery("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded-full text-muted hover:text-foreground transition-all duration-150 hover:scale-110 active:scale-90"
                  aria-label="Clear search"
                >
                  <CloseIcon size={12} />
                </button>
              )}
            </div>
            {globalQuery.trim() && (
              <div className="absolute left-1.5 right-1.5 top-full z-20 max-h-72 overflow-y-auto rounded-lg border border-separator/70 glass-surface-strong shadow-xl">
                {globalResults.length > 0 ? (
                  globalResults.slice(0, 50).map((medal) => (
                    <button
                      key={medal.achievementData.id}
                      type="button"
                      onClick={() => handleLocate(medal)}
                      className="w-full text-left px-3 py-1.5 rounded-md text-xs truncate text-foreground hover:bg-white/5 transition-all duration-150 hover:translate-x-1"
                      title={medal.achievementData.name}
                    >
                      {medal.achievementData.name}
                    </button>
                  ))
                ) : (
                  <p className="text-xs text-muted text-center py-2">
                    {t("card:ach_no_medals")}
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto space-y-1 px-1">
            {categories.map((cat) => (
              <button
                key={cat.key}
                type="button"
                className={`w-full text-left px-4 py-2 rounded-lg text-sm transition-all duration-200 ${
                  activeCategory === cat.key
                    ? "glass-surface border border-separator text-foreground font-medium hover:scale-[1.02] active:scale-[0.98]"
                    : "text-foreground hover:bg-white/5 border border-transparent hover:scale-[1.02] active:scale-[0.98]"
                }`}
                onClick={() => setActiveCategory(cat.key)}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center gap-2 mb-3 shrink-0 flex-wrap border border-separator/50 rounded-lg p-2 glass-surface">
            <span className="text-xs text-muted mr-1">
              {t("card:ach_level")}:
            </span>
            {levelOptions.map((lv) => (
              <button
                key={lv}
                type="button"
                className={`text-xs px-2.5 py-1 rounded-full border transition-all duration-200 font-medium ${
                  levelFilter === lv
                    ? "border border-separator text-foreground shadow-sm hover:scale-110 active:scale-95"
                    : "border border-separator/50 text-muted hover:border-foreground/50 hover:text-foreground hover:bg-white/5 hover:scale-110 active:scale-95"
                }`}
                onClick={() => setLevelFilter(lv)}
              >
                {LEVEL_LABELS[lv]}
              </button>
            ))}
            <span className="text-xs text-muted ml-2 mr-1">
              {t("card:ach_plated")}:
            </span>
            {(["all", "plated", "unplated"] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                className={`text-xs px-2.5 py-1 rounded-full border transition-all duration-200 font-medium ${
                  platedFilter === opt
                    ? "border border-separator text-foreground shadow-sm hover:scale-110 active:scale-95"
                    : "border border-separator/50 text-muted hover:border-foreground/50 hover:text-foreground hover:bg-white/5 hover:scale-110 active:scale-95"
                }`}
                onClick={() => setPlatedFilter(opt)}
              >
                {opt === "all"
                  ? t("card:ach_all")
                  : opt === "plated"
                    ? t("card:ach_plated")
                    : t("card:ach_unplated")}
              </button>
            ))}
            <span className="text-xs text-muted ml-2 mr-1">
              {t("card:ach_sort")}:
            </span>
            {(["time", "level"] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                className={`text-xs px-2.5 py-1 rounded-full border transition-all duration-200 font-medium ${
                  sortBy === opt
                    ? "border border-separator text-foreground shadow-sm hover:scale-110 active:scale-95"
                    : "border border-separator/50 text-muted hover:border-foreground/50 hover:text-foreground hover:bg-white/5 hover:scale-110 active:scale-95"
                }`}
                onClick={() => setSortBy(opt)}
              >
                {opt === "time" ? t("card:ach_time") : t("card:ach_level_sort")}
              </button>
            ))}
          </div>

          <div
            ref={medalListRef}
            className="flex-1 overflow-y-auto space-y-1 min-h-[420px] pb-16 border border-separator/50 rounded-lg p-2 glass-surface"
          >
            {filteredMedals.length === 0 ? (
              <div className="text-center text-muted py-12">
                {t("card:ach_no_medals")}
              </div>
            ) : (
              filteredMedals.map((medal) => {
                const id = medal.achievementData.id;
                const isSelected = selectable && selectedIds!.includes(id);
                const icon = getMedalIcon(medal);
                return (
                  <div
                    key={id}
                    data-medal-id={id}
                    className={`flex items-center gap-3 p-2 rounded-lg border glass-surface transition-all duration-200 ${
                      selectable ? "cursor-pointer" : ""
                    } ${
                      isSelected
                        ? "border-primary/50 bg-primary/10"
                        : "border-transparent hover:bg-white/5 hover:scale-[1.01] active:scale-[0.99]"
                    }`}
                    onClick={() => selectable && onToggle?.(id)}
                  >
                    {icon ? (
                      <div
                        className="w-14 h-14 shrink-0 overflow-hidden"
                        style={{ clipPath: HEX_CLIP, WebkitClipPath: HEX_CLIP }}
                      >
                        <Img
                          src={icon}
                          alt={medal.achievementData.name}
                          className="w-full h-full object-cover"
                          draggable={false}
                        />
                      </div>
                    ) : (
                      <div className="w-14 h-14 shrink-0 bg-default-200" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {medal.achievementData.name}
                      </div>
                      <div className="flex items-center gap-3 text-xs mt-0.5">
                        <ReforgeLevel medal={medal} />
                        <span className="text-yellow-500 font-medium inline-block w-7 text-center">
                          {medal.isPlated ? t("card:ach_plated") : ""}
                        </span>
                        <span className="text-muted">
                          {medal.obtainTs
                            ? formatTimestamp(medal.obtainTs)
                            : ""}
                        </span>
                      </div>
                    </div>
                    {selectable && (
                      <div
                        className={`w-5 h-5 rounded shrink-0 flex items-center justify-center transition-colors ${
                          isSelected
                            ? "bg-primary text-white"
                            : "border-2 border-default-300"
                        }`}
                      >
                        {isSelected && (
                          <svg
                            className="w-3 h-3"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={3}
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <BackToTopFab getContainer={getMedalList} />
    </>
  );
}
