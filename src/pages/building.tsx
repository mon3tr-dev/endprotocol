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
  getAccounts,
  getSelectedAccount,
  refreshAccountData,
  type Account,
} from "@/utils/accountService";
import { fetchArknightsPlayerInfo } from "@/utils/arknightsDataService";
import { getConfig, setConfig } from "@/utils/configService";
import { resolveServerLabel } from "@/types";
import { AccountNameLine } from "@/components/ui/game-badge";
import { filterAccountsForPage } from "@/config/gameSupport";
import { logError } from "@/utils/logger";
import {
  arknightsMoodOf,
  arknightsMoodPercent,
  dormRestSummary,
  laborPercent,
  laborRemainingMs,
  manufactureState,
  tradingSummary,
  FACILITY_ORDER,
  type FacilityKey,
} from "@/components/cards/building/building-shared";
import { arknightsPortraitUrl } from "@/types/arknights";
import { formatCountdown } from "@/components/cards/recruitment/recruit-shared";
import { RemoteThumb } from "@/components/ui/remote-thumb";
import type {
  ArknightsPlayerInfo,
  ArknightsRoomSegment,
} from "@/types/arknights";

/** 页面内独立记住的游戏账户（未设置时跟随全局选中账户） */
const ROLE_CONFIG_KEY = "building_page_role_id";

const MOOD_MAX = 24;

/** 设施键 → i18n 标题键 */
const FACILITY_TITLE_KEY: Record<FacilityKey, string> = {
  control: "building_page.room_control",
  powers: "building_page.room_powers",
  tradings: "building_page.room_tradings",
  manufactures: "building_page.room_manufactures",
  dormitories: "building_page.room_dormitories",
  meeting: "building_page.room_meeting",
};

/** 心情条颜色：低于一半告警，耗尽危险 */
function moodBarClass(mood: number): string {
  if (mood <= 0.05) return "bg-gradient-to-r from-danger/70 to-danger";
  if (mood < MOOD_MAX / 2) return "bg-gradient-to-r from-warning/70 to-warning";
  return "bg-gradient-to-r from-success/70 to-success";
}

export default function BuildingPage() {
  const { t, i18n } = useTranslation();
  const [roleId, setRoleId] = useState<string | null>(null);
  const [info, setInfo] = useState<ArknightsPlayerInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showRoleMenu, setShowRoleMenu] = useState(false);
  const roleMenuRef = useRef<HTMLDivElement>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

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
        setInfo(null);
        return;
      }
      const result = await fetchArknightsPlayerInfo({ roleId: id });
      setInfo(result);
    } catch (error) {
      logError("Failed to load building data:", error);
      setInfo(null);
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

  // 无人机/专精倒计时重算
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

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
      await loadData();
    } catch (error) {
      logError("Failed to refresh building data:", error);
    } finally {
      setIsRefreshing(false);
    }
  }, [loadData]);

  const handleSelectRole = useCallback(
    async (newRoleId: string) => {
      setShowRoleMenu(false);
      await setConfig(ROLE_CONFIG_KEY, newRoleId);
      await loadData(newRoleId);
    },
    [loadData],
  );

  const pageAccounts = useMemo(
    () => filterAccountsForPage(accounts, "building"),
    [accounts],
  );

  const currentAccount = useMemo(
    () => pageAccounts.find((a) => a.id === roleId) ?? null,
    [pageAccounts, roleId],
  );

  const building = info?.building ?? null;
  const rest = useMemo(() => dormRestSummary(building), [building]);
  const labor = building?.labor ?? null;
  const laborPct = laborPercent(labor);
  const dronesFull = laborPct >= 100 || !labor;

  /** charId → 干员名（charInfoMap 缺失时回退 charId） */
  const charName = useCallback(
    (charId: string) =>
      (info?.charInfoMap && info.charInfoMap[charId]?.name) || charId,
    [info],
  );

  /** 一段排班里的干员心情条列表 */
  const roomChars = useCallback(
    (segment: ArknightsRoomSegment | undefined) => {
      const chars = segment?.chars ?? [];
      return chars.map((c) => ({
        charId: c.charId,
        name: charName(c.charId),
        mood: arknightsMoodOf(c.ap),
        percent: arknightsMoodPercent(c.ap),
      }));
    },
    [charName],
  );

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto pb-6">
        <PageHeader
          accounts={pageAccounts}
          currentAccount={currentAccount}
          roleId={roleId}
          showRoleMenu={showRoleMenu}
          roleMenuRef={roleMenuRef}
          onToggleMenu={() => setShowRoleMenu((v) => !v)}
          onSelectRole={handleSelectRole}
          onRefresh={handleRefresh}
          isRefreshing={isRefreshing}
        />
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
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto pb-6">
      <PageHeader
        accounts={pageAccounts}
        currentAccount={currentAccount}
        roleId={roleId}
        showRoleMenu={showRoleMenu}
        roleMenuRef={roleMenuRef}
        onToggleMenu={() => setShowRoleMenu((v) => !v)}
        onSelectRole={handleSelectRole}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
      />

      {!info || !building ? (
        <GlassCard className="p-16 border border-separator/90">
          <div className="text-center text-muted">
            <p className="text-sm">{t("building_page.empty")}</p>
          </div>
        </GlassCard>
      ) : (
        <div className="space-y-4">
          {/* 概览：无人机 / 宿舍休息 / 疲劳干员 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <GlassCard className="p-4 border border-separator/90">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted">{t("building_page.drones")}</span>
                <span className="text-sm font-bold text-foreground font-mono">
                  {labor?.value ?? 0}/{labor?.maxValue ?? 0}
                </span>
              </div>
              <div className="mt-2 h-2 rounded-full lg-inset overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary/70 to-primary transition-all duration-500"
                  style={{ width: `${laborPct}%` }}
                />
              </div>
              <div className="mt-1.5 text-[11px] text-muted">
                {dronesFull
                  ? t("building_page.drones_full")
                  : t("building_page.drones_full_in", {
                      time: formatCountdown(laborRemainingMs(labor, nowMs), i18n.language),
                    })}
              </div>
            </GlassCard>

            <GlassCard className="p-4 border border-separator/90">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted">{t("building_page.dorm_rest")}</span>
                <span className="text-sm font-bold text-foreground font-mono">
                  {Math.round(rest.percent)}%
                </span>
              </div>
              <div className="mt-2 h-2 rounded-full lg-inset overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-success/70 to-success transition-all duration-500"
                  style={{ width: `${rest.percent}%` }}
                />
              </div>
              <div className="mt-1.5 text-[11px] text-muted">
                {rest.charCount > 0
                  ? `${t("building_page.resting")} ${rest.restingCount}/${rest.charCount}`
                  : "—"}
              </div>
            </GlassCard>

            <GlassCard className="p-4 border border-separator/90">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted">{t("building_page.tired_chars")}</span>
                <span
                  className={clsx(
                    "text-sm font-bold font-mono",
                    (building.tiredChars?.length ?? 0) > 0 ? "text-warning-text" : "text-foreground",
                  )}
                >
                  {building.tiredChars?.length ?? 0}
                </span>
              </div>
              <div className="mt-2 text-[11px] text-muted space-y-1 min-h-[32px]">
                {(building.tiredChars?.length ?? 0) === 0 ? (
                  <span>{t("building_page.tired_none")}</span>
                ) : (
                  building.tiredChars.slice(0, 2).map((c) => (
                    <div key={`${c.charId}-${c.roomSlotId}`} className="flex items-center gap-1.5 min-w-0">
                      <RemoteThumb
                        src={arknightsPortraitUrl(c.charId)}
                        alt={charName(c.charId)}
                        className="w-8 h-8 rounded-md border border-separator"
                      />
                      <span className="truncate">
                        {charName(c.charId)} · {c.roomSlotId}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </GlassCard>
          </div>

          {/* 办公室 / 训练室 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <GlassCard className="p-4 border border-separator/90">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground">
                  {t("building_page.office")}
                </span>
                {building.hire ? (
                  <span className="text-[11px] text-muted">
                    {t("building_page.level", { level: building.hire.level })}
                  </span>
                ) : null}
              </div>
              {building.hire ? (
                <div className="mt-2 text-xs text-muted">
                  {t("building_page.hire_refresh_usage", {
                    used: Math.min(building.hire.refreshCount ?? 0, 3),
                    total: 3,
                  })}
                </div>
              ) : (
                <div className="mt-2 text-xs text-muted/70">—</div>
              )}
            </GlassCard>

            <GlassCard className="p-4 border border-separator/90">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground">
                  {t("building_page.training")}
                </span>
                {building.training ? (
                  <span className="text-[11px] text-muted">
                    {t("building_page.level", { level: building.training.level })}
                  </span>
                ) : null}
              </div>
              {building.training?.trainee && building.training.trainee.targetSkill >= 0 ? (
                <div className="mt-2 text-xs text-muted space-y-0.5">
                  <div className="truncate">
                    {t("building_page.trainee")}:{" "}
                    <span className="text-foreground font-medium">
                      {charName(building.training.trainee.charId)}
                    </span>
                  </div>
                  {building.training.trainer && (
                    <div className="truncate">
                      {t("building_page.trainer")}:{" "}
                      <span className="text-foreground font-medium">
                        {charName(building.training.trainer.charId)}
                      </span>
                    </div>
                  )}
                  <div>
                    {t("building_page.training_specializing")} · ×
                    {(building.training.speed ?? 0).toFixed(2)}
                    {(building.training.remainSecs ?? 0) > 0 &&
                      ` · ${formatCountdown((building.training.remainSecs ?? 0) * 1000, i18n.language)}`}
                  </div>
                </div>
              ) : (
                <div className="mt-2 text-xs text-muted">
                  {t("building_page.training_idle")}
                </div>
              )}
            </GlassCard>
          </div>

          {/* 各设施详情 */}
          {FACILITY_ORDER.map((key) => {
            const segments = (building[key] ?? []) as ArknightsRoomSegment[];
            if (segments.length === 0) return null;
            return (
              <GlassCard key={key} className="p-4 border border-separator/90">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <span className="text-sm font-semibold text-foreground">
                    {t(FACILITY_TITLE_KEY[key])}
                  </span>
                  <span className="text-[11px] text-muted">
                    {segments.length > 1
                      ? `${segments.length}`
                      : t("building_page.level", { level: segments[0]?.level ?? 0 })}
                  </span>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {segments.map((segment, segIdx) => {
                    const chars = roomChars(segment);
                    const manu =
                      key === "manufactures" ? manufactureState(segment, nowMs) : null;
                    const trading =
                      key === "tradings" ? tradingSummary(segment) : null;
                    const clue = key === "meeting" ? segment.clue : null;
                    return (
                      <div
                        key={`${segment.slotId}-${segIdx}`}
                        className="rounded-lg border border-separator/60 bg-default-50/40 px-3 py-2.5 space-y-2 min-w-0"
                      >
                        {/* 槽位头：等级 / 生产状态 / 订单 */}
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="text-muted font-mono truncate">
                            {segment.slotId}
                            {segments.length > 1 ? ` · L${segment.level}` : ""}
                          </span>
                          {manu ? (
                            <span
                              className={clsx(
                                "shrink-0",
                                manu.kind === "done"
                                  ? "text-success-text font-medium"
                                  : manu.kind === "producing"
                                    ? "text-primary-text"
                                    : "text-muted",
                              )}
                            >
                              {manu.kind === "done"
                                ? t("building_page.production_done")
                                : manu.kind === "producing"
                                  ? t("building_page.producing")
                                  : t("building_page.production_idle")}
                            </span>
                          ) : null}
                          {trading ? (
                            <span className="shrink-0 text-muted">
                              {t("building_page.orders", {
                                count: trading.count,
                                limit: trading.limit,
                              })}
                              {trading.isGold
                                ? ` · ${t("building_page.order_strategy_gold")}`
                                : ""}
                            </span>
                          ) : null}
                        </div>

                        {/* 制造站进度条 */}
                        {manu && manu.kind === "producing" && (
                          <div>
                            <div className="h-1.5 rounded-full lg-inset overflow-hidden">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-primary/70 to-primary transition-all duration-500"
                                style={{ width: `${manu.percent}%` }}
                              />
                            </div>
                            <div className="mt-1 text-[10px] text-muted">
                              {t("building_page.production_complete_at", {
                                time: formatCountdown(
                                  Math.max(0, manu.completeAtTs * 1000 - nowMs),
                                  i18n.language,
                                ),
                              })}
                            </div>
                          </div>
                        )}
                        {manu && (segment.complete ?? 0) > 0 && (
                          <div className="text-[10px] text-success-text">
                            ×{segment.complete}
                          </div>
                        )}

                        {/* 会客室线索 */}
                        {clue && (
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">
                            <span>{t("building_page.clue_own", { count: clue.own ?? 0 })}</span>
                            <span>
                              {t("building_page.clue_board", { count: clue.board?.length ?? 0 })}
                            </span>
                            <span
                              className={
                                clue.dailyReward ? "text-success-text" : "text-warning-text"
                              }
                            >
                              {clue.dailyReward
                                ? t("building_page.clue_daily_done")
                                : t("building_page.clue_daily_pending")}
                            </span>
                          </div>
                        )}

                        {/* 干员心情条 */}
                        <div className="space-y-1.5">
                          {chars.length === 0 ? (
                            <div className="text-[10px] text-muted/70">
                              {t("building_page.char_idle_slot")}
                            </div>
                          ) : (
                            chars.map((c) => (
                              <div key={`${c.charId}-${c.mood}`} className="flex items-center gap-2.5 min-w-0">
                                <RemoteThumb
                                  src={arknightsPortraitUrl(c.charId)}
                                  alt={c.name}
                                  className="w-10 h-10 rounded-lg border border-separator"
                                />
                                <span className="text-[11px] text-foreground truncate max-w-[110px]">
                                  {c.name}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <div className="h-1 rounded-full lg-inset overflow-hidden">
                                    <div
                                      className={clsx(
                                        "h-full rounded-full transition-all duration-500",
                                        moodBarClass(c.mood),
                                      )}
                                      style={{ width: `${c.percent}%` }}
                                    />
                                  </div>
                                </div>
                                <span className="shrink-0 text-[10px] text-muted font-mono">
                                  {c.mood}/{MOOD_MAX}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 页头（账户切换 + 刷新），加载态与正常态共用 */
function PageHeader({
  accounts,
  currentAccount,
  roleId,
  showRoleMenu,
  roleMenuRef,
  onToggleMenu,
  onSelectRole,
  onRefresh,
  isRefreshing,
}: {
  accounts: Account[];
  currentAccount: Account | null;
  roleId: string | null;
  showRoleMenu: boolean;
  roleMenuRef: React.RefObject<HTMLDivElement | null>;
  onToggleMenu: () => void;
  onSelectRole: (roleId: string) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  const { t, i18n } = useTranslation();
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
      <div className="flex items-center gap-3 min-w-0">
        <CardIcon iconKey="factory" size={28} className="text-primary-text shrink-0" />
        <div className="min-w-0">
          <h1 className="text-2xl lg:text-3xl font-bold text-foreground tracking-tight">
            {t("sidebar.building")}
          </h1>
          <p className="text-foreground/70 mt-1 text-sm truncate">
            {t("building_page.subtitle")}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <div className="relative" ref={roleMenuRef}>
          <GlassButton
            variant="ghost"
            isDisabled={accounts.length === 0}
            onPress={onToggleMenu}
            endContent={<ChevronDownIcon size={14} />}
            className="lg-material border border-separator/70 max-w-48"
          >
            {currentAccount ? (
              <AccountNameLine game={currentAccount.game} className="max-w-full">
                {currentAccount.nickname}
              </AccountNameLine>
            ) : (
              <span className="truncate">{t("building_page.switch_account")}</span>
            )}
          </GlassButton>

          {showRoleMenu && (
            <div className="lg-regular absolute right-0 top-full mt-2 z-50 w-64 rounded-xl border border-separator/60 overflow-hidden animate-scale-in">
              <div className="max-h-72 overflow-y-auto">
                {accounts.map((acc) => {
                  const isSelected = acc.id === roleId;
                  return (
                    <button
                      key={acc.id}
                      type="button"
                      onClick={() => onSelectRole(acc.id)}
                      className={clsx(
                        "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors duration-200",
                        isSelected ? "bg-primary/15" : "lg-hoverable",
                      )}
                    >
                      <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 lg-inset flex items-center justify-center">
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
                        <p className="text-sm font-medium">
                          <AccountNameLine game={acc.game}>
                            {acc.nickname || t("common.unknown")}
                          </AccountNameLine>
                        </p>
                        <p className="text-xs text-muted truncate">
                          {resolveServerLabel(acc.server, i18n.language)} · Lv.{acc.level}
                        </p>
                      </div>
                      {isSelected && (
                        <CheckIcon size={14} className="text-primary-text shrink-0" />
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
            onPress={onRefresh}
            isDisabled={isRefreshing}
            className="text-muted hover:text-foreground lg-hoverable rounded-xl"
            aria-label={t("common.refresh")}
          >
            <RefreshIcon size={20} className={isRefreshing ? "animate-spin" : ""} />
          </GlassButton>
          <GlassTooltip.Content>{t("common.refresh")}</GlassTooltip.Content>
        </GlassTooltip>
      </div>
    </div>
  );
}
