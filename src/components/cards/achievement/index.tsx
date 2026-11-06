import { useCallback, useEffect, useMemo, useState } from "react";
import { GlassButton, GlassCard, GlassProgressCircle } from "@/components/ui/glass";
import { CharDetailData, AchieveMedal } from "@/types/charDetail";
import { logDebug, logError } from "@/utils/logger";
import { useTranslation } from "react-i18next";
import { roleDataService } from "@/utils/roleDataService";
import { BaseCardProps } from "../registry/types";
import { CardConfigService } from "@/utils/cardConfigService";
import type { AchievementCardSettings } from "@/types/card-settings";
import { useCardData } from "../base/use-card-data";
import { Img } from "@/utils/imageLoader";
import { useImageRequest, usePinImages } from "@/utils/imageCacheManager";
import { AchievementModal } from "./achievement-modal";
import { getAccounts } from "@/utils/accountService";
import { resolveServerLabel } from "@/types";
import {
  CustomModal,
  CustomModalHeader,
  CustomModalBody,
  CustomModalFooter,
} from "@/components/custom-modal";
import type { Account } from "@/utils/accountService";

const MAX_DISPLAY = 10;

const HEX_W = 71;
const HEX_H = 82;
const HEX_CLIP = "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)";

function effectiveLevel(medal: AchieveMedal): number {
  return Math.min(medal.achievementData.initLevel + medal.level - 1, 3);
}

function getMedalIcon(medal: AchieveMedal): string {
  if (medal.isPlated && medal.achievementData.platedIcon) {
    return medal.achievementData.platedIcon;
  }
  const lv = effectiveLevel(medal);
  if (lv >= 3 && medal.achievementData.reforge3Icon) return medal.achievementData.reforge3Icon;
  if (lv >= 2 && medal.achievementData.reforge2Icon) return medal.achievementData.reforge2Icon;
  return medal.achievementData.initIcon || "";
}

function HexImg({ src, alt }: { src: string; alt: string }) {
  return (
    <div
      className="relative overflow-hidden"
      style={{ width: HEX_W, height: HEX_H, clipPath: HEX_CLIP, WebkitClipPath: HEX_CLIP }}
    >
      <Img
        src={src}
        alt={alt}
        className="absolute inset-0 w-full h-full object-cover"
        draggable={false}
      />
    </div>
  );
}

function EmptyHex() {
  return (
    <div className="relative" style={{ width: HEX_W, height: HEX_H }}>
      <div
        style={{ width: HEX_W, height: HEX_H, clipPath: HEX_CLIP, WebkitClipPath: HEX_CLIP }}
      />
      <svg
        className="absolute pointer-events-none"
        style={{ top: 0, left: 0 }}
        width={HEX_W}
        height={HEX_H}
        viewBox={`0 0 ${HEX_W} ${HEX_H}`}
      >
        <polygon
          points={`${HEX_W / 2},0 ${HEX_W},${HEX_H * 0.25} ${HEX_W},${HEX_H * 0.75} ${HEX_W / 2},${HEX_H} 0,${HEX_H * 0.75} 0,${HEX_H * 0.25}`}
          fill="none"
          stroke="rgba(120,120,120,0.3)"
          strokeWidth={1}
          strokeDasharray="3 2"
        />
      </svg>
    </div>
  );
}

function Honeycomb({ displayMedals, shownMedals }: { displayMedals: any[]; shownMedals: number }) {
  const GAP = 0;
  const CELL_W = HEX_W + GAP;
  const ROW_Y_OFFSET = Math.round(HEX_H * 0.75);
  const ROW_Y = [0, ROW_Y_OFFSET];
  const ROW_X = (i: number, row: number) => (i + (row === 1 ? 0.5 : 0)) * CELL_W;

  return (
    <div className="relative" style={{ width: 5.5 * CELL_W, height: ROW_Y[1] + HEX_H }}>
      {Array.from({ length: 5 }).flatMap((_, col) =>
        [0, 1].map((row) => {
          const idx = col * 2 + row;
          const medal = shownMedals > idx ? displayMedals[idx] : null;
          const icon = medal ? getMedalIcon(medal) : "";
          return (
            <div
              key={`${row}-${col}`}
              className="absolute"
              style={{ left: ROW_X(col, row), top: ROW_Y[row] }}
            >
              {icon ? (
                <HexImg src={icon} alt={medal!.achievementData.name} />
              ) : (
                <EmptyHex />
              )}
            </div>
          );
        }),
      )}
    </div>
  );
}

export default function AchievementCard({
  roleId: defaultRoleId,
  cardId,
  settings,
  isEditMode = false,
}: BaseCardProps) {
  const { t, i18n } = useTranslation();
  const [selectedMedalIds, setSelectedMedalIds] = useState<string[]>([]);
  const [useDisplayList, setUseDisplayList] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isRoleSelectOpen, setIsRoleSelectOpen] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [customRoleId, setCustomRoleId] = useState<string | undefined>(
    (settings as AchievementCardSettings)?.roleId,
  );

  const effectiveRoleId = customRoleId ?? defaultRoleId;

  const { data: charDetail, isLoading } = useCardData<CharDetailData>({
    fetchData: () => roleDataService.getFullCharDetail(effectiveRoleId),
    reloadKey: effectiveRoleId,
  });

  const allMedals = useMemo(() => {
    if (!charDetail?.achieve?.achieveMedals) return [];
    return charDetail.achieve.achieveMedals;
  }, [charDetail]);

  const loadSettings = useCallback(async () => {
    try {
      const s = await CardConfigService.getCardSettings<AchievementCardSettings>(cardId);
      logDebug("Loaded achievement card settings:", s);
      if (s.useDisplayList === true) {
        setUseDisplayList(true);
        setSelectedMedalIds([]);
      } else if (s.selectedMedalIds && s.selectedMedalIds.length > 0) {
        setUseDisplayList(false);
        setSelectedMedalIds(s.selectedMedalIds);
      } else {
        setUseDisplayList(true);
        setSelectedMedalIds([]);
      }
      if (s.roleId) {
        setCustomRoleId(s.roleId);
      }
    } catch (error) {
      logError("Failed to load achievement settings:", error);
    }
  }, [cardId]);

  useEffect(() => {
    if (allMedals.length > 0) {
      loadSettings();
    }
  }, [allMedals, loadSettings]);

  const displayMedalIds = useMemo(() => {
    if (!charDetail?.achieve?.display) return [];
    return Object.values(charDetail.achieve.display);
  }, [charDetail?.achieve?.display]);

  const displayMedals = useMemo(() => {
    if (allMedals.length === 0) return [];
    if (useDisplayList || selectedMedalIds.length === 0) {
      const displayMap = charDetail?.achieve?.display;
      if (displayMap) {
        const ids = Object.values(displayMap).slice(0, MAX_DISPLAY);
        const idToMedal = new Map(allMedals.map((m) => [m.achievementData.id, m]));
        return ids.map((id) => idToMedal.get(id) ?? null);
      }
      return allMedals.slice(0, MAX_DISPLAY);
    }
    const idToMedal = new Map(allMedals.map((m) => [m.achievementData.id, m]));
    return selectedMedalIds
      .slice(0, MAX_DISPLAY)
      .map((id) => id ? idToMedal.get(id) ?? null : null);
  }, [allMedals, useDisplayList, selectedMedalIds, charDetail?.achieve?.display]);

  const iconPaths = useMemo(
    () => displayMedals.filter((m): m is AchieveMedal => m !== null).map((m) => getMedalIcon(m)),
    [displayMedals],
  );
  useImageRequest(iconPaths, [iconPaths]);
  usePinImages(iconPaths);

  useEffect(() => {
    if (isModalOpen) {
      window.dispatchEvent(new CustomEvent("clearLongPressTimers"));
    }
  }, [isModalOpen]);

  const handleCardAction = useCallback((e: Event) => {
    const detail = (e as CustomEvent).detail as { cardId: string; action: string } | undefined;
    if (detail?.cardId !== cardId) return;
    if (detail.action === "select-medals") {
      setIsModalOpen(true);
    } else if (detail.action === "change-role") {
      getAccounts().then((accs) => {
        setAccounts(accs);
        setIsRoleSelectOpen(true);
      }).catch((err) => logError("Failed to load accounts:", err));
    }
  }, [cardId]);

  useEffect(() => {
    window.addEventListener("cardAction", handleCardAction);
    return () => window.removeEventListener("cardAction", handleCardAction);
  }, [handleCardAction]);

  const handleRoleConfirm = async (newRoleId: string) => {
    setCustomRoleId(newRoleId);
    setIsRoleSelectOpen(false);
    try {
      await CardConfigService.saveCardSettings(cardId, {
        roleId: newRoleId,
      } as AchievementCardSettings);
      logDebug("Saved achievement roleId:", newRoleId);
    } catch (error) {
      logError("Failed to save roleId:", error);
    }
  };

  const handleModalSave = async (ids: string[], useDisplay: boolean) => {
    setSelectedMedalIds(ids);
    setUseDisplayList(useDisplay);
    try {
      await CardConfigService.saveCardSettings(cardId, {
        selectedMedalIds: useDisplay ? undefined : ids,
        useDisplayList: useDisplay ? true : undefined,
        roleId: customRoleId,
      } as AchievementCardSettings);
      logDebug("Saved achievement settings:", { ids, useDisplay });
    } catch (error) {
      logError("Failed to save achievement settings:", error);
    }
  };

  if (isLoading) {
    return (
      <GlassCard className="p-6 border border-separator/70 h-full w-full flex items-center justify-center">
        <GlassProgressCircle isIndeterminate size="md" aria-label="Loading" className="text-primary">
          <GlassProgressCircle.Track>
            <GlassProgressCircle.TrackCircle />
            <GlassProgressCircle.FillCircle />
          </GlassProgressCircle.Track>
        </GlassProgressCircle>
      </GlassCard>
    );
  }

  if (!charDetail?.achieve?.achieveMedals) {
    return (
      <GlassCard className="p-6 border border-separator/70 h-full w-full flex items-center justify-center">
        <p className="text-muted text-center text-sm">{t("card:no_data")}</p>
      </GlassCard>
    );
  }

  const shownMedals = MAX_DISPLAY;

  return (
    <>
      <GlassCard
        className="px-[3px] py-0 border border-separator/70 h-full w-full select-none cursor-pointer hover:shadow-md transition-all rounded-[10px] overflow-hidden"
        isPressable
        onPress={() => !isEditMode && setIsModalOpen(true)}
      >
        <div className="flex items-center justify-center h-full">
          <Honeycomb displayMedals={displayMedals} shownMedals={shownMedals} />
        </div>
      </GlassCard>

      <AchievementModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        medals={allMedals}
        selectedMedalIds={selectedMedalIds}
        useDisplayList={useDisplayList}
        displayMedalIds={displayMedalIds}
        onSave={handleModalSave}
      />

      {/* Role select modal */}
      <CustomModal
        isOpen={isRoleSelectOpen}
        onClose={() => setIsRoleSelectOpen(false)}
        size="md"
      >
        <CustomModalHeader onClose={() => setIsRoleSelectOpen(false)}>
          {t("card:select_role") || "Select Account"}
        </CustomModalHeader>
        <CustomModalBody>
          <div className="space-y-3">
            {accounts.length === 0 ? (
              <div className="text-center text-muted py-8">
                {t("card:no_accounts") || "No accounts available"}
              </div>
            ) : (
              accounts.map((account) => (
                <div
                  key={account.id}
                  className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all lg-hoverable-soft lg-material-row border border-separator/70 hover:border-primary/50"
                  onClick={() => handleRoleConfirm(account.id)}
                >
                   <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 lg-field">
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
                    <div className="font-medium text-sm truncate">
                      {account.nickname || t("common.unknown") || "Unknown"}
                    </div>
                    <div className="text-xs text-muted">
                      {resolveServerLabel(account.server, i18n.language)} · Lv.{account.level}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </CustomModalBody>
        <CustomModalFooter>
          <GlassButton
            variant="secondary"
            onPress={() => setIsRoleSelectOpen(false)}
          >
            {t("common.cancel") || "Cancel"}
          </GlassButton>
        </CustomModalFooter>
      </CustomModal>
    </>
  );
}
