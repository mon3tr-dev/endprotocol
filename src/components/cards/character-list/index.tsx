import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GlassButton,
  GlassCard,
  GlassProgressCircle,
} from "@/components/ui/glass";
import { CharDetailData, CharacterItem } from "@/types/charDetail";
import { CharSelectModal } from "./char-select-modal";
import { logDebug, logError } from "@/utils/logger";
import { resolveServerLabel } from "@/types";
import { AccountNameLine } from "@/components/ui/game-badge";
import { useTranslation } from "react-i18next";
import { roleDataService } from "@/utils/roleDataService";
import { BaseCardProps } from "../registry/types";
import { CardConfigService } from "@/utils/cardConfigService";
import type {
  CharacterListCardSettings,
  CharacterListDisplayMode,
} from "@/types/card-settings";
import { useCardData } from "../base/use-card-data";
import { Img } from "@/utils/imageLoader";
import { useImageRequest, usePinImages } from "@/utils/imageCacheManager";
import { getAccounts } from "@/utils/accountService";
import type { Account } from "@/utils/accountService";
import { filterAccountsForCard } from "@/config/gameSupport";
import {
  CustomModal,
  CustomModalHeader,
  CustomModalBody,
  CustomModalFooter,
} from "@/components/custom-modal";

const DISPLAY_MODE_CONFIG: Record<
  CharacterListDisplayMode,
  { slotCount: number; gridCols: number }
> = {
  single: { slotCount: 1, gridCols: 1 },
  double: { slotCount: 2, gridCols: 2 },
  triple: { slotCount: 3, gridCols: 3 },
};

function getSelectedCharacters(
  charDetail: CharDetailData | null,
  ids: string[],
  count: number,
): CharacterItem[] {
  if (!charDetail) return [];
  return ids
    .map((id) => charDetail.chars.find((c) => c.charData.id === id))
    .filter((c): c is CharacterItem => c !== undefined)
    .slice(0, count);
}

export default function CharacterListCard({
  roleId,
  cardId,
  isEditMode = false,
}: BaseCardProps) {
  const { t, i18n } = useTranslation();
  const [selectedCharIds, setSelectedCharIds] = useState<string[]>([]);
  const [displayMode, setDisplayMode] =
    useState<CharacterListDisplayMode>("triple");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [preopenCharId, setPreopenCharId] = useState<string | null>(null);
  const [customRoleId, setCustomRoleId] = useState<string | null>(null);
  const [isRoleSelectModalOpen, setIsRoleSelectModalOpen] = useState(false);
  const [availableAccounts, setAvailableAccounts] = useState<Account[]>([]);
  const prevRoleIdRef = useRef<string | null>(null);

  // 加载自定义roleId
  useEffect(() => {
    const loadCustomRoleId = async () => {
      try {
        const settings =
          await CardConfigService.getCardSettings<CharacterListCardSettings>(
            cardId,
          );
        if (settings.roleId) {
          setCustomRoleId(settings.roleId);
        }
      } catch (error) {
        logError("Failed to load custom roleId:", error);
      }
    };
    loadCustomRoleId();
  }, [cardId]);

  // 使用自定义roleId或props中的roleId
  const effectiveRoleId = customRoleId || roleId;

  // 跟踪 roleId 变化
  const roleIdChanged =
    prevRoleIdRef.current !== null && prevRoleIdRef.current !== effectiveRoleId;
  useEffect(() => {
    prevRoleIdRef.current = effectiveRoleId;
  }, [effectiveRoleId]);

  const { data: charDetail, isLoading } = useCardData<CharDetailData>({
    fetchData: () => roleDataService.getFullCharDetail(effectiveRoleId),
    reloadKey: effectiveRoleId,
  });

  const processedCharDetail = useMemo(() => {
    if (!charDetail) return null;
    return { ...charDetail, chars: [...charDetail.chars] };
  }, [charDetail]);

  const loadSettings = useCallback(async () => {
    try {
      const settings =
        await CardConfigService.getCardSettings<CharacterListCardSettings>(
          cardId,
        );

      logDebug(`Loaded settings for card ${cardId}:`, settings);

      if (settings.displayMode) {
        setDisplayMode(settings.displayMode);
      }

      // 如果 roleId 发生变化，不加载之前的 selectedCharIds
      if (roleIdChanged) {
        logDebug("roleId changed, skipping selectedCharIds load");
        return;
      }

      if (settings.selectedCharIds && settings.selectedCharIds.length > 0) {
        const validIds = settings.selectedCharIds.filter(
          (id) => id && id.trim() !== "",
        );
        setSelectedCharIds(validIds);
        logDebug("Filtered valid IDs:", validIds);
      } else {
        setSelectedCharIds([]);
        logDebug("No saved IDs, using empty selection");
      }
    } catch (error) {
      logError("Failed to load settings:", error);
    }
  }, [processedCharDetail, cardId, roleIdChanged]);

  useEffect(() => {
    if (processedCharDetail) {
      loadSettings();
    }
  }, [processedCharDetail, loadSettings]);

  const { slotCount, gridCols } = DISPLAY_MODE_CONFIG[displayMode];

  const selectedCharacters = useMemo(() => {
    return getSelectedCharacters(
      processedCharDetail,
      selectedCharIds,
      slotCount,
    );
  }, [processedCharDetail, selectedCharIds, slotCount]);

  const avatarPaths = useMemo(
    () =>
      selectedCharacters
        .map((c) => c.charData.avatarRtUrl || c.charData.avatarSqUrl)
        .filter(Boolean),
    [selectedCharacters],
  );

  useImageRequest(avatarPaths, [avatarPaths]);
  usePinImages(avatarPaths);

  useEffect(() => {
    if (isModalOpen) {
      logDebug("Modal opened, clearing long press timers");
      window.dispatchEvent(new CustomEvent("clearLongPressTimers"));
    }
  }, [isModalOpen]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        { cardId: string; action: string } | undefined;
      if (detail?.cardId === cardId && detail?.action === "view-list") {
        setIsModalOpen(true);
      } else if (
        detail?.cardId === cardId &&
        detail?.action === "change-role"
      ) {
        handleOpenRoleSelect();
      }
    };
    window.addEventListener("cardAction", handler);
    return () => window.removeEventListener("cardAction", handler);
  }, [cardId]);

  const handleOpenRoleSelect = async () => {
    try {
      const accounts = await getAccounts();
      // 干员列表依赖终末地的 card/detail，明日方舟账户不在候选里
      setAvailableAccounts(filterAccountsForCard(accounts, "character_list"));
      setIsRoleSelectModalOpen(true);
    } catch (error) {
      logError("Failed to load accounts:", error);
    }
  };

  const handleRoleSelect = async (newRoleId: string) => {
    setCustomRoleId(newRoleId);
    setIsRoleSelectModalOpen(false);
    try {
      setSelectedCharIds([]);
      await Promise.all([
        CardConfigService.updateCardSetting(cardId, "roleId", newRoleId),
        CardConfigService.updateCardSetting(cardId, "selectedCharIds", []),
      ]);
      logDebug(
        `Updated roleId for card ${cardId}, empty selection:`,
        newRoleId,
      );
    } catch (error) {
      logError("Failed to save roleId:", error);
    }
  };

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

  const ICON_BASE = "/assets/icons";
  const professionIconUrl = (key: string) =>
    `${ICON_BASE}/profession/${key}.png`;
  const propertyIconUrl = (key: string) => `${ICON_BASE}/property/${key}.png`;

  function renderCharSlot(char: CharacterItem) {
    const data = char.charData;
    const coverUrl =
      data.illustrationUrl || data.avatarRtUrl || data.avatarSqUrl;
    return (
      <div
        key={data.id}
        className="group relative h-full w-full overflow-hidden border border-separator transition-all duration-200 hover:border-blue-400/60 hover:shadow-md cursor-pointer first:rounded-l-[10px] last:rounded-r-[10px]"
        onClick={(e) => {
          if (isEditMode) return;
          e.stopPropagation();
          setPreopenCharId(data.id);
          setIsModalOpen(true);
        }}
      >
        <Img
          src={coverUrl}
          alt={data.name}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          transparentPlaceholder
          loading="lazy"
          draggable={false}
        />
        <div className="absolute inset-x-0 top-0 h-1/4 bg-gradient-to-b from-black/60 to-transparent pointer-events-none" />

        {/* 左上：profession + property 图标，无底 */}
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

        {/* 右下：potential 图标（potential 为 0 时不显示） */}
        {char.potentialLevel != null && char.potentialLevel > 0 && (
          <div className="absolute bottom-9 right-2 z-10">
            <img
              src={`/assets/icons/potential/potential_${char.potentialLevel}.png`}
              alt=""
              className="w-10 h-10 object-contain"
            />
          </div>
        )}

        {/* 底栏：透明背景 + 等级/phase（左侧）+ 名字（右侧）+ 稀有度色条 */}
        <div className="absolute inset-x-0 bottom-0 z-10">
          <div className="px-1.5 pt-4 pb-1 flex items-end gap-2">
            <div className="flex items-center gap-1 shrink-0">
              {char.evolvePhase != null && (
                <img
                  src={`/assets/icons/evolve/phase-${char.evolvePhase}.png`}
                  alt=""
                  className="w-5 h-5 object-contain drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]"
                />
              )}
              {char.level != null && (
                <span className="text-sm font-bold text-gray-800 drop-shadow-[0_1px_1px_rgba(255,255,255,0.6)]">
                  Lv.{char.level}
                </span>
              )}
            </div>
            <span className="flex-1 min-w-0 text-xs font-medium text-white truncate text-right drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]">
              {data.name}
            </span>
          </div>
          <div
            style={{
              borderBottom: "3px solid " + rarityLineColor(data.rarity.value),
              width: "100%",
            }}
          />
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <GlassCard className="p-6  border border-separator/90 h-full w-full flex items-center justify-center">
        <GlassProgressCircle
          isIndeterminate
          size="md"
          aria-label="Loading"
          className="text-primary"
        >
          <GlassProgressCircle.Track>
            <GlassProgressCircle.TrackCircle />
            <GlassProgressCircle.FillCircle />
          </GlassProgressCircle.Track>
        </GlassProgressCircle>
      </GlassCard>
    );
  }

  if (!processedCharDetail) {
    return (
      <GlassCard className="p-6  border border-separator/90">
        <p className="text-muted text-center">{t("card:no_data")}</p>
      </GlassCard>
    );
  }

  return (
    <>
      <GlassCard
        className="p-0  border border-separator/90 h-full w-full select-none cursor-pointer hover:shadow-md transition-shadow rounded-[10px] overflow-hidden"
        isPressable
        onPress={() => !isEditMode && setIsModalOpen(true)}
      >
        <div
          className="grid flex-1 min-h-0 h-full"
          style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}
        >
          {selectedCharacters.map(renderCharSlot)}

          {Array.from({
            length: Math.max(0, slotCount - selectedCharacters.length),
          }).map((_, index) => (
            <div
              key={`empty-${index}`}
              className="h-full flex flex-col items-center justify-center cursor-pointer lg-hoverable-soft/60 first:rounded-l-[10px] last:rounded-r-[10px]"
              onClick={(e) => {
                e.stopPropagation();
                !isEditMode && setIsModalOpen(true);
              }}
            >
              <svg
                className="w-6 h-6 mb-1 text-foreground opacity-70"
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
              <span className="text-foreground text-xs">
                {t("card:empty_slot")}
              </span>
            </div>
          ))}
        </div>
      </GlassCard>

      <CharSelectModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setPreopenCharId(null);
        }}
        charDetail={processedCharDetail}
        selectedCharIds={selectedCharIds.slice(0, slotCount)}
        roleId={effectiveRoleId}
        maxSlots={slotCount}
        initialCharId={preopenCharId ?? undefined}
        initialViewMode={preopenCharId ? "detail" : undefined}
        onSave={async (newIds: string[]) => {
          const trimmedIds = newIds.slice(0, slotCount);
          setSelectedCharIds(trimmedIds);
          try {
            await CardConfigService.updateCardSetting(
              cardId,
              "selectedCharIds",
              trimmedIds,
            );
            logDebug(
              `Saved selected character IDs for card ${cardId}:`,
              trimmedIds,
            );
          } catch (error) {
            logError("Failed to save selected character IDs:", error);
          }
        }}
      />

      {/* Role Select Modal */}
      <CustomModal
        isOpen={isRoleSelectModalOpen}
        onClose={() => setIsRoleSelectModalOpen(false)}
        size="md"
      >
        <CustomModalHeader onClose={() => setIsRoleSelectModalOpen(false)}>
          {t("card:change_role") || "Change Account"}
        </CustomModalHeader>
        <CustomModalBody>
          <div className="space-y-3">
            {availableAccounts.length === 0 ? (
              <div className="text-center text-muted py-8">
                {t("card:no_accounts") || "No accounts available"}
              </div>
            ) : (
              availableAccounts.map((account) => (
                <div
                  key={account.id}
                  className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all lg-hoverable border ${
                    effectiveRoleId === account.id
                      ? "border-primary bg-primary/10"
                      : "border-separator hover:border-primary/50"
                  }`}
                  onClick={() => handleRoleSelect(account.id)}
                >
                  <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0">
                    {account.avatar ? (
                      <Img
                        src={account.avatar}
                        alt={account.nickname}
                        className="w-full h-full avatar-feather"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted text-sm">
                        {account.nickname?.charAt(0) || "?"}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">
                      <AccountNameLine game={account.game}>
                        {account.nickname || t("common.unknown") || "Unknown"}
                      </AccountNameLine>
                    </div>
                    <div className="text-xs text-muted">
                      {resolveServerLabel(account.server, i18n.language)} · Lv.
                      {account.level}
                    </div>
                  </div>
                  {effectiveRoleId === account.id && (
                    <div className="text-primary-text text-xs font-medium">
                      {t("card:current") || "Current"}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </CustomModalBody>
        <CustomModalFooter>
          <GlassButton
            variant="secondary"
            onPress={() => setIsRoleSelectModalOpen(false)}
          >
            {t("common.cancel") || "Cancel"}
          </GlassButton>
        </CustomModalFooter>
      </CustomModal>
    </>
  );
}
