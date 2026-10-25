import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import {
  GlassButton,
  GlassCard,
  GlassProgressCircle,
  GlassTooltip,
} from "@/components/ui/glass";
import { Img } from "@/utils/imageLoader";
import { RefreshIcon, ChevronDownIcon, CheckIcon } from "@/components/ui/app-icon";
import { CardIcon } from "@/components/icons";
import {
  CustomModal,
  CustomModalHeader,
  CustomModalBody,
  CustomModalFooter,
} from "@/components/custom-modal";
import {
  getAccounts,
  getSelectedAccount,
  refreshAccountData,
  type Account,
} from "@/utils/accountService";
import { roleDataService } from "@/utils/roleDataService";
import { getConfig, setConfig } from "@/utils/configService";
import { resolveServerLabel } from "@/types";
import { logError } from "@/utils/logger";
import type { CharDetailData, CharacterItem } from "@/types/charDetail";
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
  getMoodBarClass,
  getRoomMeta,
  collectSpaceshipIds,
  sortSpaceshipRooms,
} from "@/components/cards/spaceship/spaceship-shared";

/** 页面内独立记住的游戏账户（未设置时跟随全局选中账户） */
const ROLE_CONFIG_KEY = "spaceship_page_role_id";

export default function SpaceshipPage() {
  const { t, i18n } = useTranslation();
  const [roleId, setRoleId] = useState<string | null>(null);
  const [rooms, setRooms] = useState<SpaceShipRoom[]>([]);
  const [charDetail, setCharDetail] = useState<CharDetailData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showRoleMenu, setShowRoleMenu] = useState(false);
  const [detailRoomIndex, setDetailRoomIndex] = useState<number | null>(null);
  const roleMenuRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async (targetRoleId?: string | null) => {
    try {
      setIsLoading(true);
      const id =
        targetRoleId !== undefined
          ? targetRoleId
          : await getConfig<string>(ROLE_CONFIG_KEY).then(
              (saved) => saved || getSelectedAccount(),
            );
      setRoleId(id);
      if (!id) {
        setRooms([]);
        setCharDetail(null);
        return;
      }
      const [shipResult, detail] = await Promise.all([
        roleDataService.queryData(id, "char_detail", ["spaceShip"]),
        roleDataService.getFullCharDetail(id),
      ]);
      const list = shipResult?.spaceShip?.rooms;
      setRooms(Array.isArray(list) ? list : []);
      setCharDetail(detail);
    } catch (error) {
      logError("Failed to load spaceship data:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    void (async () => {
      try {
        setAccounts(await getAccounts());
      } catch (error) {
        logError("Failed to load accounts:", error);
      }
    })();
  }, [loadData]);

  // 账户切换 / 全局手动刷新时重新加载
  useEffect(() => {
    const handleAccountChanged = () => void loadData(null);
    const handleManualRefresh = () => void loadData();
    window.addEventListener("accountChanged", handleAccountChanged);
    window.addEventListener("manualRefresh", handleManualRefresh);
    return () => {
      window.removeEventListener("accountChanged", handleAccountChanged);
      window.removeEventListener("manualRefresh", handleManualRefresh);
    };
  }, [loadData]);

  // 点击外部关闭账户下拉
  useEffect(() => {
    if (!showRoleMenu) return;
    const handle = (e: MouseEvent) => {
      if (roleMenuRef.current && !roleMenuRef.current.contains(e.target as Node)) {
        setShowRoleMenu(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [showRoleMenu]);

  const handleRefresh = useCallback(async () => {
    try {
      setIsRefreshing(true);
      await refreshAccountData();
      if (roleId) {
        roleDataService.clearCache(roleId, "char_detail", ["spaceShip"]);
      }
      await loadData();
    } catch (error) {
      logError("Failed to refresh spaceship data:", error);
    } finally {
      setIsRefreshing(false);
    }
  }, [loadData, roleId]);

  const handleSelectRole = useCallback(
    async (newRoleId: string) => {
      setShowRoleMenu(false);
      await setConfig(ROLE_CONFIG_KEY, newRoleId);
      await loadData(newRoleId);
    },
    [loadData],
  );

  const currentAccount = useMemo(
    () => accounts.find((a) => a.id === roleId) ?? null,
    [accounts, roleId],
  );

  // 总控中枢置顶，其余保持接口顺序；未识别类型的舱室不展示
  const sortedRooms = useMemo(() => sortSpaceshipRooms(rooms), [rooms]);

  const resolveStationedChar = useCallback(
    (
      shipCharId: string | undefined,
      roomChar: SpaceShipRoomChar,
    ): StationedCharView => {
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

  const roomsWithChars = useMemo(
    () =>
      sortedRooms.map((room) => ({
        room,
        meta: getRoomMeta(room.type),
        chars: (room.chars || []).map((c) => resolveStationedChar(c.charId, c)),
      })),
    [sortedRooms, resolveStationedChar],
  );

  const detailItem = detailRoomIndex !== null ? roomsWithChars[detailRoomIndex] : null;

  const renderRoomName = (type: number | undefined) => {
    const meta = getRoomMeta(type);
    return meta ? t(`card:spaceship_room_${meta.key}`) : t("card:spaceship_room_unknown");
  };

  return (
    <div className="max-w-6xl mx-auto pb-6">
      {/* 页头 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3 min-w-0">
          <CardIcon iconKey="satellite" size={28} className="text-primary shrink-0" />
          <div className="min-w-0">
            <h1 className="text-2xl lg:text-3xl font-bold text-foreground tracking-tight">
              {t("card:spaceship_title")}
            </h1>
            <p className="text-foreground/70 mt-1 text-sm truncate">
              {t("spaceship_page.subtitle")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* 账户切换下拉（样式对齐抽卡记录页，仅本页生效） */}
          <div className="relative" ref={roleMenuRef}>
            <GlassButton
              variant="ghost"
              isDisabled={accounts.length === 0}
              onPress={() => setShowRoleMenu((v) => !v)}
              endContent={<ChevronDownIcon size={14} />}
              className="glass-surface border border-separator/70 max-w-48"
            >
              <span className="truncate">
                {currentAccount?.nickname || t("spaceship_page.switch_account")}
              </span>
            </GlassButton>

            {showRoleMenu && (
              <div className="absolute right-0 top-full mt-2 z-50 w-64 glass-surface-strong rounded-xl border border-separator/70 shadow-xl overflow-hidden">
                <div className="max-h-72 overflow-y-auto">
                  {accounts.map((acc) => {
                    const isSelected = acc.id === roleId;
                    return (
                      <button
                        key={acc.id}
                        type="button"
                        onClick={() => void handleSelectRole(acc.id)}
                        className={clsx(
                          "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-all duration-150",
                          "hover:translate-x-1 active:translate-x-0.5",
                          isSelected ? "bg-primary/15" : "hover:bg-default-100",
                        )}
                      >
                        <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-default-100 flex items-center justify-center">
                          {acc.avatar ? (
                            <Img
                              src={acc.avatar}
                              alt={acc.nickname}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="text-muted text-xs font-semibold">
                              {(acc.nickname ?? "?").charAt(0)}
                            </span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {acc.nickname || t("common.unknown")}
                          </p>
                          <p className="text-xs text-muted truncate">
                            {resolveServerLabel(acc.server, i18n.language)} · Lv.
                            {acc.level}
                          </p>
                        </div>
                        {isSelected && (
                          <CheckIcon size={14} className="text-primary shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <GlassTooltip>
            <GlassButton
              isIconOnly
              variant="ghost"
              size="sm"
              onPress={handleRefresh}
              isDisabled={isRefreshing}
              className="text-muted hover:text-foreground hover:bg-default-100 rounded-xl"
              aria-label={t("common.refresh")}
            >
              <RefreshIcon size={20} className={isRefreshing ? "animate-spin" : ""} />
            </GlassButton>
            <GlassTooltip.Content>{t("common.refresh")}</GlassTooltip.Content>
          </GlassTooltip>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <GlassProgressCircle
            isIndeterminate
            size="lg"
            aria-label="Loading"
            className="text-primary"
          >
            <GlassProgressCircle.Track>
              <GlassProgressCircle.TrackCircle />
              <GlassProgressCircle.FillCircle />
            </GlassProgressCircle.Track>
          </GlassProgressCircle>
        </div>
      ) : roomsWithChars.length === 0 ? (
        <GlassCard className="p-16 glass-surface border border-separator/90">
          <div className="text-center text-muted">
            <p className="text-sm">{t("card:spaceship_empty")}</p>
          </div>
        </GlassCard>
      ) : (
        <div className="space-y-5">
          {/* 概览 */}
          <GlassCard className="p-4 lg:p-5 glass-surface border border-separator/90">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="min-w-0 flex flex-col justify-center">
                <p className="text-xs text-muted mb-1">
                  {t("spaceship_page.total_rooms")}
                </p>
                <p className="text-2xl lg:text-3xl font-bold text-foreground font-mono leading-none">
                  {roomsWithChars.length}
                </p>
              </div>
              <div className="min-w-0 flex flex-col justify-center">
                <p className="text-xs text-muted mb-1">
                  {t("spaceship_page.stationed_total")}
                </p>
                <p className="text-2xl lg:text-3xl font-bold text-foreground font-mono leading-none">
                  {roomsWithChars.reduce((n, r) => n + r.chars.length, 0)}
                </p>
              </div>
              {/* 舱室等级一览 */}
              <div className="col-span-2 min-w-0 flex flex-col justify-center gap-2">
                <p className="text-xs text-muted">
                  {t("spaceship_page.room_levels")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {roomsWithChars.map(({ room, meta }, idx) => (
                    <button
                      key={`${room.type}-${idx}`}
                      type="button"
                      onClick={() => setDetailRoomIndex(idx)}
                      className="flex items-center gap-1.5 rounded-full glass-surface border border-separator/70 px-2.5 py-1 text-xs hover:border-primary/50 transition-colors"
                    >
                      <CardIcon iconKey={meta?.icon ?? "help"} size={13} />
                      <span className="text-foreground truncate max-w-[110px]">
                        {renderRoomName(room.type)}
                      </span>
                      <span className="text-muted font-mono shrink-0">
                        Lv.{room.level ?? "--"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </GlassCard>

          {/* 舱室详情 */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase text-muted">
                {t("spaceship_page.section_rooms")}
              </h2>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {roomsWithChars.map(({ room, meta, chars }, idx) => (
                <GlassCard
                  key={`${room.type}-${idx}`}
                  className="p-4 glass-surface border border-separator/80 min-w-0"
                >
                  {/* 舱室标题 */}
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="shrink-0 w-9 h-9 rounded-lg glass-surface border border-separator/60 flex items-center justify-center text-primary"
                      aria-hidden
                    >
                      <CardIcon iconKey={meta?.icon ?? "help"} size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground truncate">
                        {renderRoomName(room.type)}
                      </p>
                      <p className="text-xs text-muted">
                        {t("card:spaceship_stationed_count", { n: chars.length })}
                      </p>
                    </div>
                    <span className="shrink-0 text-lg font-bold text-foreground font-mono">
                      Lv.{room.level ?? "--"}
                    </span>
                  </div>

                  {/* 派驻干员列表 */}
                  {chars.length === 0 ? (
                    <div className="mt-3 h-12 rounded-lg border border-dashed border-separator/70 flex items-center justify-center">
                      <span className="text-xs text-muted">
                        {t("card:spaceship_no_stationed")}
                      </span>
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {chars.map((c, ci) => (
                        <div
                          key={`${c.charId}-${ci}`}
                          className="flex items-center gap-3 min-w-0 rounded-lg bg-default-50/40 border border-separator/50 px-2.5 py-2"
                        >
                          <div
                            className={`w-11 h-11 rounded-full border-2 ${getMoodRingClass(c.moodPct)} overflow-hidden bg-default-100 shrink-0`}
                          >
                            {c.avatar ? (
                              <Img
                                src={c.avatar}
                                alt={c.name}
                                className="w-full h-full object-cover avatar-feather"
                                draggable={false}
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-xs text-muted">
                                ?
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">
                                {c.name ||
                                  c.charId ||
                                  t("card:spaceship_unknown_char")}
                              </p>
                              <span
                                className={clsx(
                                  "shrink-0 text-[10px]",
                                  TRUST_TEXT_CLASS[c.trustLevel],
                                )}
                              >
                                {t(`card:spaceship_trust_${c.trustLevel}`)}{" "}
                                {c.trustPct}%
                              </span>
                            </div>
                            {/* 心情进度 */}
                            <div className="mt-1.5 flex items-center gap-2 min-w-0">
                              <span className="text-[10px] text-muted shrink-0">
                                {t("card:spaceship_mood")}
                              </span>
                              <div className="flex-1 min-w-0 h-1.5 rounded-full bg-default-100 overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-500 ${getMoodBarClass(c.moodPct)}`}
                                  style={{ width: `${c.moodPct}%` }}
                                />
                              </div>
                              <span
                                className={clsx(
                                  "shrink-0 text-[10px] font-mono",
                                  getMoodTextClass(c.moodPct),
                                )}
                              >
                                {c.moodPct}%
                              </span>
                            </div>
                            {/* 信赖进度 */}
                            <div className="mt-1 flex items-center gap-2 min-w-0">
                              <span className="text-[10px] text-muted shrink-0">
                                {t("card:spaceship_trust")}
                              </span>
                              <div className="flex-1 min-w-0 h-1.5 rounded-full bg-default-100 overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-primary/70 to-primary transition-all duration-500"
                                  style={{
                                    width: `${Math.min(100, (c.trustPct / 200) * 100)}%`,
                                  }}
                                />
                              </div>
                              <span className="shrink-0 text-[10px] text-foreground font-mono">
                                {c.trustPct}%
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </GlassCard>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* 舱室详情弹窗（复用卡片交互） */}
      <CustomModal
        isOpen={detailItem !== null}
        onClose={() => setDetailRoomIndex(null)}
        size="sm"
      >
        <CustomModalHeader onClose={() => setDetailRoomIndex(null)}>
          {detailItem ? (
            <>
              {detailItem.meta?.icon && (
                <span className="mr-1" aria-hidden>
                  <CardIcon iconKey={detailItem.meta.icon} size={18} />
                </span>
              )}
              {renderRoomName(detailItem.room.type)} · Lv.
              {detailItem.room.level ?? "--"}
            </>
          ) : null}
        </CustomModalHeader>
        <CustomModalBody>
          {detailItem && detailItem.chars.length === 0 ? (
            <div className="text-center text-muted py-8 text-sm">
              {t("card:spaceship_no_stationed")}
            </div>
          ) : (
            <div className="space-y-2">
              {detailItem?.chars.map((c, ci) => (
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
                      <div
                        className={clsx(
                          "text-[10px]",
                          TRUST_TEXT_CLASS[c.trustLevel],
                        )}
                      >
                        {t(`card:spaceship_trust_${c.trustLevel}`)}{" "}
                        {c.trustPct}%
                      </div>
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
    </div>
  );
}
