import { useCallback, useEffect, useMemo, useState } from "react";
import { GlassButton, GlassCard, GlassProgressCircle } from "@/components/ui/glass";
import { useTranslation } from "react-i18next";
import { BaseCardProps } from "../registry/types";
import { useCardData } from "../base/use-card-data";
import { roleDataService } from "@/utils/roleDataService";
import { CardConfigService } from "@/utils/cardConfigService";
import { getAccounts } from "@/utils/accountService";
import { AccountAvatar } from "@/components/ui/account-avatar";
import { Img } from "@/utils/imageLoader";
import { logError } from "@/utils/logger";
import { resolveServerLabel } from "@/types";
import { useImageRequest } from "@/utils/imageCacheManager";
import {
  CustomModal,
  CustomModalHeader,
  CustomModalBody,
  CustomModalFooter,
} from "@/components/custom-modal";
import { CardIcon } from "@/components/icons";
import type { Account } from "@/utils/accountService";
import type { CharDetailData, CharacterItem } from "@/types/charDetail";
import type { SpaceshipCardSettings } from "@/types/card-settings";
import {
  type SpaceShipRoom,
  type SpaceShipRoomChar,
  type StationedCharView,
  TRUST_TEXT_CLASS,
  getMoodPercent,
  getTrustPercent,
  getTrustLevel,
  getMoodRingClass,
  getMoodTextClass,
  getRoomMeta,
  collectSpaceshipIds,
  sortSpaceshipRooms,
} from "./spaceship-shared";

export type { SpaceShipRoom, SpaceShipRoomChar };

export default function SpaceshipCard({
  roleId: defaultRoleId,
  cardId,
  settings,
  isEditMode = false,
}: BaseCardProps) {
  const { t, i18n } = useTranslation();
  const [customRoleId, setCustomRoleId] = useState<string | undefined>(
    (settings as SpaceshipCardSettings)?.roleId,
  );
  const [isRoleSelectOpen, setIsRoleSelectOpen] = useState(false);
  const [detailRoomIndex, setDetailRoomIndex] = useState<number | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const effectiveRoleId = customRoleId ?? defaultRoleId;

  const { data: rooms, isLoading } = useCardData<SpaceShipRoom[]>({
    fetchData: async () => {
      const result = await roleDataService.queryData(effectiveRoleId, "char_detail", ["spaceShip"]);
      const list = result?.spaceShip?.rooms;
      return Array.isArray(list) ? list : [];
    },
    reloadKey: effectiveRoleId,
  });

  const { data: charDetail } = useCardData<CharDetailData>({
    fetchData: () => roleDataService.getFullCharDetail(effectiveRoleId),
    reloadKey: effectiveRoleId,
  });

  // 总控中枢置顶，其余保持接口顺序；未识别类型的舱室不展示
  const sortedRooms = useMemo(() => sortSpaceshipRooms(rooms ?? []), [rooms]);

  const resolveStationedChar = useCallback(
    (shipCharId: string | undefined, roomChar: SpaceShipRoomChar): StationedCharView => {
      let owned: CharacterItem | undefined;
      if (shipCharId && charDetail?.chars) {
        owned = charDetail.chars.find((c) =>
          collectSpaceshipIds(c).some((id) => id.includes(shipCharId)),
        );
      }
      return {
        charId: shipCharId || "",
        name: owned?.charData.name || "",
        avatar:
          owned?.charData.avatarSqUrl ||
          owned?.charData.avatarRtUrl ||
          roomChar.avatarUrl ||
          "",
        moodPct: getMoodPercent(roomChar.physicalStrength),
        trustPct: getTrustPercent(roomChar.favorability),
        trustLevel: getTrustLevel(roomChar.favorability),
      };
    },
    [charDetail],
  );

  const allAvatarPaths = useMemo(() => {
    const paths: string[] = [];
    sortedRooms.forEach((room) => {
      (room.chars || []).forEach((c) => {
        if (c.avatarUrl) paths.push(c.avatarUrl);
      });
    });
    (charDetail?.chars || []).forEach((c) => {
      if (c.charData.avatarSqUrl) paths.push(c.charData.avatarSqUrl);
    });
    return Array.from(new Set(paths));
  }, [sortedRooms, charDetail]);

  useImageRequest(allAvatarPaths, [allAvatarPaths]);

  const loadSettings = useCallback(async () => {
    try {
      const s = await CardConfigService.getCardSettings<SpaceshipCardSettings>(cardId);
      if (s.roleId) setCustomRoleId(s.roleId);
    } catch (error) {
      logError("Failed to load spaceship settings:", error);
    }
  }, [cardId]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const openAccountSelect = useCallback(async () => {
    try {
      const accs = await getAccounts();
      setAccounts(accs);
      setIsRoleSelectOpen(true);
    } catch (err) {
      logError("Failed to load accounts:", err);
    }
  }, []);

  const loadAccounts = useCallback(async () => {
    try {
      const accs = await getAccounts();
      setAccounts(accs);
    } catch (error) {
      logError("Failed to load accounts:", error);
    }
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts, effectiveRoleId]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { cardId: string; action: string } | undefined;
      if (detail?.cardId !== cardId) return;
      if (detail.action === "change-role") {
        openAccountSelect();
      }
    };
    window.addEventListener("cardAction", handler);
    return () => window.removeEventListener("cardAction", handler);
  }, [cardId, openAccountSelect]);

  const handleRoleConfirm = async (newRoleId: string) => {
    setCustomRoleId(newRoleId);
    setIsRoleSelectOpen(false);
    try {
      await CardConfigService.saveCardSettings(cardId, { roleId: newRoleId });
    } catch (error) {
      logError("Failed to save spaceship roleId:", error);
    }
  };

  const currentAccount = useMemo(
    () => accounts.find((a) => a.id === effectiveRoleId) ?? null,
    [accounts, effectiveRoleId],
  );

  const renderRoomName = (type: number | undefined) => {
    const meta = getRoomMeta(type);
    return meta ? t(`card:spaceship_room_${meta.key}`) : t("card:spaceship_room_unknown");
  };

  const detailRoom = detailRoomIndex !== null ? sortedRooms[detailRoomIndex] : null;
  const detailChars: StationedCharView[] = detailRoom
    ? (detailRoom.chars || []).map((c) => resolveStationedChar(c.charId, c))
    : [];

  if (isLoading) {
    return (
      <GlassCard className="p-6 glass-surface border border-separator/90 h-full w-full flex items-center justify-center">
        <GlassProgressCircle isIndeterminate size="md" aria-label="Loading" className="text-primary">
          <GlassProgressCircle.Track>
            <GlassProgressCircle.TrackCircle />
            <GlassProgressCircle.FillCircle />
          </GlassProgressCircle.Track>
        </GlassProgressCircle>
      </GlassCard>
    );
  }

  if (!sortedRooms.length) {
    return (
      <GlassCard className="p-6 glass-surface border border-separator/90 h-full w-full flex items-center justify-center">
        <p className="text-muted text-center text-sm">{t("card:spaceship_empty")}</p>
      </GlassCard>
    );
  }

  return (
    <>
      <GlassCard className="p-2.5 glass-surface border border-separator/90 h-full w-full select-none rounded-[10px] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between gap-2 min-w-0 mb-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <AccountAvatar
              src={currentAccount?.avatar ?? ""}
              alt={currentAccount?.nickname ?? ""}
              size="sm"
              className="rounded-md border border-separator shrink-0"
            />
            <div className="min-w-0">
              <span className="block text-xs font-semibold text-foreground truncate">
                {t("card:spaceship_title")}
              </span>
              <span className="block text-[10px] text-muted truncate">
                {currentAccount?.nickname
                  ? `${currentAccount.nickname} · `
                  : ""}
                {t("card:spaceship_rooms_count", { n: sortedRooms.length })}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={openAccountSelect}
            title={t("card:spaceship_switch_account")}
            aria-label={t("card:spaceship_switch_account")}
            className="shrink-0 w-5 h-5 flex items-center justify-center rounded-md text-muted hover:text-foreground hover:bg-default-100 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 min-h-0 flex-1 content-start overflow-y-auto pr-0.5">
          {sortedRooms.map((room, idx) => {
            const meta = getRoomMeta(room.type);
            const chars = (room.chars || []).map((c) => resolveStationedChar(c.charId, c));
            return (
              <div
                key={`${room.type}-${idx}`}
                className="rounded-lg bg-default-50/40 border border-separator/60 px-2 py-1.5 cursor-pointer transition-all hover:border-primary/50 hover:bg-default-50/70"
                onClick={() => {
                  if (isEditMode) return;
                  setDetailRoomIndex(idx);
                }}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="shrink-0" aria-hidden>
                    <CardIcon iconKey={meta?.icon ?? "help"} size={14} />
                  </span>
                  <span className="text-[11px] font-semibold text-foreground truncate min-w-0">
                    {renderRoomName(room.type)}
                  </span>
                  <span className="ml-auto shrink-0 text-[9px] text-muted font-mono">
                    Lv.{room.level ?? "--"}
                  </span>
                </div>

                {chars.length > 0 ? (
                  <div className="mt-1.5 flex items-center gap-1 min-w-0">
                    <div className="flex -space-x-1.5 shrink-0">
                      {chars.map((c, ci) => (
                        <div
                          key={`${c.charId}-${ci}`}
                          title={`${c.name || t("card:spaceship_unknown_char")} · ${t("card:spaceship_mood")} ${c.moodPct}%`}
                          className={`w-7 h-7 rounded-full border-2 ${getMoodRingClass(c.moodPct)} overflow-hidden bg-default-100`}
                        >
                          {c.avatar ? (
                            <Img
                              src={c.avatar}
                              alt={c.name}
                              className="w-full h-full object-cover avatar-feather"
                              draggable={false}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[9px] text-muted">
                              ?
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    <span className="ml-auto shrink-0 text-[9px] text-muted">
                      {t("card:spaceship_stationed_count", { n: chars.length })}
                    </span>
                  </div>
                ) : (
                  <div className="mt-1 h-7 rounded-md border border-dashed border-separator/70 flex items-center justify-center">
                    <span className="text-[9px] text-muted">{t("card:spaceship_no_stationed")}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </GlassCard>

      <CustomModal
        isOpen={detailRoom !== null}
        onClose={() => setDetailRoomIndex(null)}
        size="sm"
      >
        <CustomModalHeader onClose={() => setDetailRoomIndex(null)}>
          {detailRoom ? (
            <>
              {getRoomMeta(detailRoom.type)?.icon && (
                <span className="mr-1" aria-hidden>
                  <CardIcon iconKey={getRoomMeta(detailRoom.type)?.icon ?? "help"} size={18} />
                </span>
              )}
              {renderRoomName(detailRoom.type)} · Lv.{detailRoom.level ?? "--"}
            </>
          ) : null}
        </CustomModalHeader>
        <CustomModalBody>
          {detailChars.length === 0 ? (
            <div className="text-center text-muted py-8 text-sm">
              {t("card:spaceship_no_stationed")}
            </div>
          ) : (
            <div className="space-y-2">
              {detailChars.map((c, ci) => (
                <div
                  key={`${c.charId}-${ci}`}
                  className="rounded-lg border border-separator/60 bg-default-50/40 px-2.5 py-2"
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-9 h-9 rounded-full border-2 ${getMoodRingClass(c.moodPct)} overflow-hidden bg-default-100 shrink-0`}
                    >
                      {c.avatar ? (
                        <Img
                          src={c.avatar}
                          alt={c.name}
                          className="w-full h-full object-cover avatar-feather"
                          draggable={false}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[10px] text-muted">
                          ?
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-foreground truncate">
                        {c.name || c.charId || t("card:spaceship_unknown_char")}
                      </div>
                      <div className={`text-[10px] ${TRUST_TEXT_CLASS[c.trustLevel]}`}>
                        {t(`card:spaceship_trust_${c.trustLevel}`)} {c.trustPct}%
                      </div>
                    </div>
                  </div>

                  <div className="mt-1.5 space-y-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[9px] text-muted shrink-0 w-7">
                        {t("card:spaceship_mood")}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="h-1 rounded-full bg-default-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              c.moodPct >= 50
                                ? "bg-gradient-to-r from-success/70 to-success"
                                : c.moodPct >= 25
                                  ? "bg-gradient-to-r from-warning/70 to-warning"
                                  : "bg-gradient-to-r from-danger/70 to-danger"
                            }`}
                            style={{ width: `${c.moodPct}%` }}
                          />
                        </div>
                      </div>
                      <span className={`shrink-0 text-[9px] font-mono ${getMoodTextClass(c.moodPct)}`}>
                        {c.moodPct}%
                      </span>
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[9px] text-muted shrink-0 w-7">
                        {t("card:spaceship_trust")}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="h-1 rounded-full bg-default-100 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-primary/70 to-primary transition-all duration-500"
                            style={{ width: `${Math.min(100, (c.trustPct / 200) * 100)}%` }}
                          />
                        </div>
                      </div>
                      <span className="shrink-0 text-[9px] text-foreground font-mono">
                        {c.trustPct}%
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CustomModalBody>
        <CustomModalFooter>
          <GlassButton variant="secondary" onPress={() => setDetailRoomIndex(null)}>
            {t("card:spaceship_close")}
          </GlassButton>
        </CustomModalFooter>
      </CustomModal>

      <CustomModal
        isOpen={isRoleSelectOpen}
        onClose={() => setIsRoleSelectOpen(false)}
        size="md"
      >
        <CustomModalHeader onClose={() => setIsRoleSelectOpen(false)}>
          {t("card:spaceship_select_role")}
        </CustomModalHeader>
        <CustomModalBody>
          <div className="space-y-3">
            {accounts.length === 0 ? (
              <div className="text-center text-muted py-8">
                {t("card:spaceship_no_accounts")}
              </div>
            ) : (
              accounts.map((account) => (
                <div
                  key={account.id}
                  className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all hover:bg-default-100 border border-separator hover:border-primary/50"
                  onClick={() => handleRoleConfirm(account.id)}
                >
                  <AccountAvatar
                    src={account.avatar}
                    alt={account.nickname}
                    size="sm"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">
                      {account.nickname || t("card:spaceship_unknown_char")}
                    </div>
                    <div className="text-xs text-muted">
                      {resolveServerLabel(account.server, i18n.language)} · Lv.{account.level}
                    </div>
                  </div>
                  {effectiveRoleId === account.id && (
                    <div className="text-primary text-xs font-medium">
                      {t("card:spaceship_current")}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </CustomModalBody>
        <CustomModalFooter>
          <GlassButton variant="secondary" onPress={() => setIsRoleSelectOpen(false)}>
            {t("card:spaceship_cancel")}
          </GlassButton>
        </CustomModalFooter>
      </CustomModal>
    </>
  );
}
