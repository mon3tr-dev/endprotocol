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
  recruitSlotState,
  recruitRemainingMs,
  recruitProgressPercent,
  formatCountdown,
  formatShortDateTime,
  type RecruitSlotState,
} from "@/components/cards/recruitment/recruit-shared";
import type {
  ArknightsPlayerInfo,
  ArknightsRecruitSlot,
} from "@/types/arknights";

/** 页面内独立记住的游戏账户（未设置时跟随全局选中账户） */
const ROLE_CONFIG_KEY = "recruitment_page_role_id";

/** 槽位状态徽标的颜色类（与公开招募卡片共用语义） */
const STATE_BADGE_CLASS: Record<RecruitSlotState, string> = {
  running: "text-primary-text bg-primary/15",
  finished: "text-success-text bg-success/15",
  free: "text-muted bg-default-100/60",
  locked: "text-muted/60 bg-default-100/40",
};

function padSlots(recruit: ArknightsRecruitSlot[] | undefined): ArknightsRecruitSlot[] {
  const list = Array.isArray(recruit) ? recruit.slice(0, 4) : [];
  while (list.length < 4) list.push({ state: 0, startTs: -1, finishTs: -1 });
  return list;
}

export default function RecruitmentPage() {
  const { t, i18n } = useTranslation();
  const [roleId, setRoleId] = useState<string | null>(null);
  const [info, setInfo] = useState<ArknightsPlayerInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showRoleMenu, setShowRoleMenu] = useState(false);
  const roleMenuRef = useRef<HTMLDivElement>(null);
  // 倒计时按秒重算（数据来自缓存快照，无需重新请求）
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
      logError("Failed to load recruitment data:", error);
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

  // 倒计时刷新
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
      // refresh_accounts 会重新拉取明日方舟 player/info 并落新格式缓存
      await refreshAccountData();
      await loadData();
    } catch (error) {
      logError("Failed to refresh recruitment data:", error);
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

  // 账户下拉只列出支持公开招募的账户（明日方舟）
  const pageAccounts = useMemo(
    () => filterAccountsForPage(accounts, "recruitment"),
    [accounts],
  );

  const currentAccount = useMemo(
    () => pageAccounts.find((a) => a.id === roleId) ?? null,
    [pageAccounts, roleId],
  );

  const slots = useMemo(() => padSlots(info?.recruit), [info]);
  const hire = info?.building?.hire ?? null;

  const stateLabel = (state: RecruitSlotState) =>
    state === "running"
      ? t("recruitment_page.state_running")
      : state === "finished"
        ? t("recruitment_page.state_finished")
        : state === "free"
          ? t("recruitment_page.state_free")
          : t("recruitment_page.state_locked");

  return (
    <div className="max-w-6xl mx-auto pb-6">
      {/* 页头 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3 min-w-0">
          <CardIcon iconKey="clock" size={28} className="text-primary-text shrink-0" />
          <div className="min-w-0">
            <h1 className="text-2xl lg:text-3xl font-bold text-foreground tracking-tight">
              {t("sidebar.recruitment")}
            </h1>
            <p className="text-foreground/70 mt-1 text-sm truncate">
              {t("recruitment_page.subtitle")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* 账户切换下拉（样式对齐区域信息页，仅本页生效） */}
          <div className="relative" ref={roleMenuRef}>
            <GlassButton
              variant="ghost"
              isDisabled={pageAccounts.length === 0}
              onPress={() => setShowRoleMenu((v) => !v)}
              endContent={<ChevronDownIcon size={14} />}
              className="lg-material border border-separator/70 max-w-48"
            >
              {currentAccount ? (
                <AccountNameLine game={currentAccount.game} className="max-w-full">
                  {currentAccount.nickname}
                </AccountNameLine>
              ) : (
                <span className="truncate">{t("recruitment_page.switch_account")}</span>
              )}
            </GlassButton>

            {showRoleMenu && (
              <div className="lg-regular absolute right-0 top-full mt-2 z-50 w-64 rounded-xl border border-separator/60 overflow-hidden animate-scale-in">
                <div className="max-h-72 overflow-y-auto">
                  {pageAccounts.map((acc) => {
                    const isSelected = acc.id === roleId;
                    return (
                      <button
                        key={acc.id}
                        type="button"
                        onClick={() => void handleSelectRole(acc.id)}
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
              onPress={handleRefresh}
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
      ) : !info ? (
        <GlassCard className="p-16 border border-separator/90">
          <div className="text-center text-muted">
            <p className="text-sm">{t("recruitment_page.empty")}</p>
          </div>
        </GlassCard>
      ) : (
        <div className="space-y-4">
          {/* 办公室刷新（公开招募的附带信息） */}
          {hire && (
            <GlassCard className="px-4 py-2.5 border border-separator/90">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-muted">{t("recruitment_page.hire_refresh")}</span>
                <span className="font-medium text-foreground">
                  {t("recruitment_page.hire_refresh_usage", {
                    used: Math.min(hire.refreshCount ?? 0, 3),
                    total: 3,
                  })}
                </span>
              </div>
            </GlassCard>
          )}

          {/* 四个招募栏位 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {slots.map((slot, idx) => {
              const state = recruitSlotState(slot, nowMs);
              const remainMs = recruitRemainingMs(slot, nowMs);
              const pct = recruitProgressPercent(slot, nowMs);
              const isTimed = state === "running" || state === "finished";
              return (
                <GlassCard
                  key={idx}
                  className="p-4 border border-separator/90 flex flex-col gap-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      {t("recruitment_page.slot", { number: idx + 1 })}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${STATE_BADGE_CLASS[state]}`}
                    >
                      {stateLabel(state)}
                    </span>
                  </div>

                  {isTimed ? (
                    <>
                      <div className="flex items-baseline justify-between gap-2">
                        <span
                          className={`text-2xl font-bold font-mono leading-none ${
                            state === "finished" ? "text-success-text" : "text-foreground"
                          }`}
                        >
                          {state === "finished"
                            ? "--:--:--"
                            : formatCountdown(remainMs, i18n.language)}
                        </span>
                        <span className="text-[10px] text-muted shrink-0">
                          {t("recruitment_page.remaining")}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full lg-inset overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            state === "finished"
                              ? "bg-gradient-to-r from-success/70 to-success"
                              : "bg-gradient-to-r from-primary/70 to-primary"
                          }`}
                          style={{ width: `${state === "finished" ? 100 : pct}%` }}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 text-[10px] text-muted">
                        <span className="truncate">
                          {t("recruitment_page.start_time")}:{" "}
                          {formatShortDateTime(slot.startTs > 0 ? slot.startTs : undefined)}
                        </span>
                        <span className="truncate text-right">
                          {t("recruitment_page.complete_at")}:{" "}
                          {formatShortDateTime(slot.finishTs > 0 ? slot.finishTs : undefined)}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="py-3 text-center text-xs text-muted/70">—</div>
                  )}
                </GlassCard>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
