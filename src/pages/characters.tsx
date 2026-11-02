import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  GlassButton,
  GlassCard,
  GlassProgressCircle,
} from "@/components/ui/glass";
import { Img } from "@/utils/imageLoader";
import { useImageRequest } from "@/utils/imageCacheManager";
import { getSelectedAccount } from "@/utils/accountService";
import { roleDataService } from "@/utils/roleDataService";
import { CharSelectModal } from "@/components/cards/character-list/char-select-modal";
import type { CharDetailData, CharacterItem } from "@/types/charDetail";
import { logError } from "@/utils/logger";
import { BackToTopFab } from "@/components/ui/back-to-top";

const ICON_BASE = "/assets/icons";
const PROFESSION_ICON = (key: string) => `${ICON_BASE}/profession/${key}.png`;
const PROPERTY_ICON = (key: string) => `${ICON_BASE}/property/${key}.png`;

type FilterKey =
  "profession" | "rarity" | "property" | "weapon" | "mainAttr" | "subAttr";

function rarityLineColor(value: string): string {
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

function rarityTone(value: string): "orange" | "gold" | "purple" | "blue" {
  if (value === "6") return "orange";
  if (value === "5") return "gold";
  if (value === "4") return "purple";
  return "blue";
}

const rarityToneClass: Record<string, string> = {
  orange: "text-orange-500",
  gold: "text-yellow-500",
  purple: "text-purple-500",
  blue: "text-blue-500",
};

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
      const rect = btnRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 6,
        left: rect.left,
        width: rect.width,
      });
    }
    setOpen(next);
  };

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        ref={btnRef}
        type="button"
        onClick={handleToggle}
        className={`flex items-center gap-1 h-8 pl-2 pr-1.5 rounded-xl border text-[11px] transition-all duration-200 cursor-pointer
          ${open ? "border-primary bg-primary/5" : "border-separator/60 bg-background hover:border-primary/40 lg-hoverable-soft"}`}
      >
        <span className="text-muted whitespace-nowrap">{label}</span>
        <span
          className={`font-semibold ${current?.tone ? rarityToneClass[current.tone] : "text-foreground"}`}
        >
          {current?.label ?? "—"}
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 12 12"
          className={`w-2.5 h-2.5 text-default-500 transition-transform ${open ? "rotate-180" : ""}`}
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
            className="lg-regular fixed z-[999] min-w-[120px] max-h-64 overflow-y-auto rounded-xl border border-separator/60  shadow-xl animate-scale-in"
            style={{
              top: dropdownPos.top,
              left: dropdownPos.left,
              width: Math.max(120, dropdownPos.width || 0),
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
                  className={`w-full text-left px-3 py-2 text-xs whitespace-nowrap transition-colors cursor-pointer first:rounded-t-xl last:rounded-b-xl
                  ${active ? "bg-primary/10 text-primary-text font-semibold" : "text-foreground lg-hoverable-soft"}`}
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

function getSubProperty(char: CharacterItem): string | null {
  const tags = char.charData.tags || [];
  const mainValue = char.charData.property.value;
  for (const tag of tags) {
    if (tag && tag !== mainValue) return tag;
  }
  return null;
}

function OperatorCard({
  char,
  onClick,
}: {
  char: CharacterItem;
  onClick: () => void;
}) {
  const data = char.charData;
  const coverUrl = data.illustrationUrl || data.avatarRtUrl || data.avatarSqUrl;
  const lineColor = rarityLineColor(data.rarity.value);

  return (
    <div
      className="group relative aspect-[3/4] rounded-xl overflow-hidden border border-separator/60 lg-material cursor-pointer transition-all duration-300 hover:border-primary/40 hover:shadow-lg hover:-translate-y-0.5"
      onClick={onClick}
    >
      <Img
        src={coverUrl}
        alt={data.name}
        className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
        loading="lazy"
        draggable={false}
      />
      <div className="absolute inset-x-0 top-0 h-1/5 bg-gradient-to-b from-black/55 to-transparent pointer-events-none" />

      <div className="absolute top-1.5 left-1.5 z-10 flex flex-col gap-0.5">
        <img
          src={PROFESSION_ICON(data.profession.key)}
          alt={data.profession.value}
          title={data.profession.value}
          className="w-6 h-6 object-contain drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
          }}
        />
        <img
          src={PROPERTY_ICON(data.property.key)}
          alt={data.property.value}
          title={data.property.value}
          className="w-6 h-6 object-contain drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
          }}
        />
      </div>

      {char.potentialLevel != null && char.potentialLevel > 0 && (
        <div className="absolute bottom-[33px] right-1.5 z-10">
          <img
            src={`/assets/icons/potential/potential_${char.potentialLevel}.png`}
            alt=""
            className="w-7 h-7 object-contain drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]"
          />
        </div>
      )}

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

export default function CharactersPage() {
  const { t } = useTranslation();
  const [charDetail, setCharDetail] = useState<CharDetailData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedChar, setSelectedChar] = useState<CharacterItem | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const getPageScroller = useCallback(
    () => document.querySelector("main") as HTMLElement | null,
    [],
  );

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

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      const id = await getSelectedAccount();
      if (!id) {
        setIsLoading(false);
        return;
      }
      setAccountId(id);
      const detail = await roleDataService.getFullCharDetail(id);
      if (detail) {
        setCharDetail(detail);
      }
    } catch (error) {
      logError("Failed to load character data:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const handleAccountChange = () => loadData();
    window.addEventListener("accountChanged", handleAccountChange);
    return () =>
      window.removeEventListener("accountChanged", handleAccountChange);
  }, [loadData]);

  const sortedCharacters = useMemo(() => {
    if (!charDetail) return [];
    return [...charDetail.chars].sort((a, b) => {
      const rA = parseInt(a.charData.rarity.value) || 0;
      const rB = parseInt(b.charData.rarity.value) || 0;
      if (rB !== rA) return rB - rA;
      const lA = a.level ?? 0;
      const lB = b.level ?? 0;
      if (lB !== lA) return lB - lA;
      return a.charData.name.localeCompare(b.charData.name, "zh-Hans-CN");
    });
  }, [charDetail]);

  const uniqueProfessions = useMemo(
    () =>
      Array.from(
        new Set(
          charDetail?.chars.map((c) => c.charData.profession.value) ?? [],
        ),
      ).sort(),
    [charDetail],
  );

  const uniqueProperties = useMemo(
    () =>
      Array.from(
        new Set(charDetail?.chars.map((c) => c.charData.property.value) ?? []),
      ).sort(),
    [charDetail],
  );

  const uniqueRarities = useMemo(
    () =>
      Array.from(
        new Set(charDetail?.chars.map((c) => c.charData.rarity.value) ?? []),
      ).sort((a, b) => parseInt(b) - parseInt(a)),
    [charDetail],
  );

  const uniqueWeapons = useMemo(
    () =>
      Array.from(
        new Set(
          charDetail?.chars.map((c) => c.charData.weaponType.value) ?? [],
        ),
      ).sort(),
    [charDetail],
  );

  const uniqueMainAttrs = uniqueProperties;

  const uniqueSubAttrs = useMemo(() => {
    if (!charDetail) return [];
    const set = new Set<string>();
    charDetail.chars.forEach((c) => {
      const sub = getSubProperty(c);
      if (sub) set.add(sub);
    });
    return Array.from(set).sort();
  }, [charDetail]);

  const filteredCharacters = useMemo(() => {
    if (!sortedCharacters.length) return [];
    return sortedCharacters.filter((char) => {
      const data = char.charData;
      if (
        filters.profession !== "all" &&
        data.profession.value !== filters.profession
      )
        return false;
      if (filters.rarity !== "all" && data.rarity.value !== filters.rarity)
        return false;
      if (
        filters.property !== "all" &&
        data.property.value !== filters.property
      )
        return false;
      if (filters.weapon !== "all" && data.weaponType.value !== filters.weapon)
        return false;
      if (
        filters.mainAttr !== "all" &&
        data.property.value !== filters.mainAttr
      )
        return false;
      if (filters.subAttr !== "all") {
        const sub = getSubProperty(char);
        if (sub !== filters.subAttr) return false;
      }
      return true;
    });
  }, [sortedCharacters, filters]);

  const gridAvatarPaths = useMemo(
    () =>
      (charDetail?.chars
        .map(
          (c) =>
            c.charData.illustrationUrl ||
            c.charData.avatarRtUrl ||
            c.charData.avatarSqUrl,
        )
        .filter(Boolean) as string[]) || [],
    [charDetail],
  );
  useImageRequest(gridAvatarPaths, [gridAvatarPaths]);

  const handleCharClick = (char: CharacterItem) => {
    setSelectedChar(char);
    setIsDetailOpen(true);
  };

  const handleCloseDetail = () => {
    setIsDetailOpen(false);
    setSelectedChar(null);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-12">
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold text-foreground tracking-tight">
          {t("sidebar.characters")}
        </h1>
        {charDetail && (
          <p className="text-foreground/70 mt-1.5 text-sm">
            {filteredCharacters.length} / {charDetail.chars.length}{" "}
            {t("common.characters")}
          </p>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <GlassProgressCircle
            isIndeterminate
            size="lg"
            aria-label="Loading"
            className="text-primary-text"
          >
            <GlassProgressCircle.Track>
              <GlassProgressCircle.TrackCircle />
              <GlassProgressCircle.FillCircle />
            </GlassProgressCircle.Track>
          </GlassProgressCircle>
        </div>
      ) : !charDetail || charDetail.chars.length === 0 ? (
        <GlassCard className="p-16  border border-separator/90">
          <div className="text-center">
            <svg
              className="w-16 h-16 mx-auto mb-4 opacity-30 text-muted"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
            <p className="text-lg font-semibold text-foreground">
              {t("common.no_results_found")}
            </p>
          </div>
        </GlassCard>
      ) : (
        <>
          <div className="flex flex-nowrap items-center gap-1.5 lg-material p-2 rounded-xl border border-separator/90">
            <FloatSelect
              label={t("filters.profession")}
              value={filters.profession}
              options={[
                { value: "all", label: t("filters.all_professions") },
                ...uniqueProfessions.map((v) => ({ value: v, label: v })),
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
                { value: "all", label: t("filters.all_properties") },
                ...uniqueProperties.map((v) => ({ value: v, label: v })),
              ]}
              onChange={(v) => setFilter("property", v)}
            />
            <FloatSelect
              label={t("filters.weapon")}
              value={filters.weapon}
              options={[
                { value: "all", label: t("filters.all_weapons") },
                ...uniqueWeapons.map((v) => ({ value: v, label: v })),
              ]}
              onChange={(v) => setFilter("weapon", v)}
            />
            <FloatSelect
              label={t("filters.mainAttr")}
              value={filters.mainAttr}
              options={[
                { value: "all", label: t("filters.all_mainAttrs") },
                ...uniqueMainAttrs.map((v) => ({ value: v, label: v })),
              ]}
              onChange={(v) => setFilter("mainAttr", v)}
            />
            <FloatSelect
              label={t("filters.subAttr")}
              value={filters.subAttr}
              options={[
                { value: "all", label: t("filters.all_subAttrs") },
                ...uniqueSubAttrs.map((v) => ({ value: v, label: v })),
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

          {filteredCharacters.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <svg
                className="w-12 h-12 mb-3 text-muted/30"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p className="text-sm text-muted/60">
                {t("common.no_results_found")}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3">
              {filteredCharacters.map((char) => (
                <OperatorCard
                  key={char.charData.id}
                  char={char}
                  onClick={() => handleCharClick(char)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {selectedChar && accountId && charDetail && (
        <CharSelectModal
          isOpen={isDetailOpen}
          onClose={handleCloseDetail}
          charDetail={charDetail}
          selectedCharIds={[]}
          onSave={() => {}}
          roleId={accountId}
          initialCharId={selectedChar.charData.id}
          initialViewMode="detail"
        />
      )}

      <BackToTopFab getContainer={getPageScroller} />
    </div>
  );
}
