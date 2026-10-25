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
import { roleDataService } from "@/utils/roleDataService";
import { getConfig, setConfig } from "@/utils/configService";
import { resolveServerLabel } from "@/types";
import { logError } from "@/utils/logger";
import {
  type DomainData,
  type DomainSettlement,
  formatMoney,
  formatDateTime,
  getMoneyName,
} from "@/components/cards/domain-info/domain-shared";

/** 页面内独立记住的游戏账户（未设置时跟随全局选中账户） */
const ROLE_CONFIG_KEY = "domain_page_role_id";

function percent(
  current: string | number | undefined,
  max: string | number | undefined,
): number {
  const c = Number(current) || 0;
  const m = Number(max) || 0;
  if (m <= 0) return 0;
  return Math.min(100, Math.max(0, (c / m) * 100));
}

export default function DomainPage() {
  const { t, i18n } = useTranslation();
  const [roleId, setRoleId] = useState<string | null>(null);
  const [domains, setDomains] = useState<DomainData[]>([]);
  const [selectedDomainId, setSelectedDomainId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showRoleMenu, setShowRoleMenu] = useState(false);
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
        setDomains([]);
        return;
      }
      const result = await roleDataService.queryData(id, "char_detail", ["domain"]);
      const list = result?.["domain"];
      const arr: DomainData[] = Array.isArray(list) ? list : [];
      setDomains(arr);
      setSelectedDomainId((prev) =>
        prev && arr.some((d) => d.domainId === prev)
          ? prev
          : arr[0]?.domainId ?? null,
      );
    } catch (error) {
      logError("Failed to load domain data:", error);
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
        roleDataService.clearCache(roleId, "char_detail", ["domain"]);
      }
      await loadData();
    } catch (error) {
      logError("Failed to refresh domain data:", error);
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

  const effectiveDomain = useMemo(
    () =>
      domains.find((d) => d.domainId === selectedDomainId) ?? domains[0] ?? null,
    [domains, selectedDomainId],
  );

  const currentAccount = useMemo(
    () => accounts.find((a) => a.id === roleId) ?? null,
    [accounts, roleId],
  );

  const settlements: DomainSettlement[] = effectiveDomain?.settlements ?? [];
  const moneyName =
    getMoneyName(effectiveDomain?.domainId, i18n.language) ||
    t("domain_page.money");

  return (
    <div className="max-w-6xl mx-auto pb-6">
      {/* 页头 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3 min-w-0">
          <CardIcon iconKey="map" size={28} className="text-primary shrink-0" />
          <div className="min-w-0">
            <h1 className="text-2xl lg:text-3xl font-bold text-foreground tracking-tight">
              {t("sidebar.domain")}
            </h1>
            <p className="text-foreground/70 mt-1 text-sm truncate">
              {t("domain_page.subtitle")}
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
                {currentAccount?.nickname || t("domain_page.switch_account")}
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
      ) : !effectiveDomain ? (
        <GlassCard className="p-16 glass-surface border border-separator/90">
          <div className="text-center text-muted">
            <p className="text-sm">{t("domain_page.empty")}</p>
          </div>
        </GlassCard>
      ) : (
        <div className="space-y-5">
          {/* 区域切换（标题下方居中，毛玻璃胶囊） */}
          {domains.length > 1 && (
            <div className="w-full max-w-2xl mx-auto rounded-full p-1.5 flex gap-1.5 glass-surface border border-separator/70">
              {domains.map((d) => {
                const active = d.domainId === effectiveDomain.domainId;
                return (
                  <button
                    key={d.domainId}
                    type="button"
                    onClick={() => setSelectedDomainId(d.domainId ?? null)}
                    className={clsx(
                      "flex-1 h-10 rounded-full text-sm lg:text-base font-semibold transition-all duration-200",
                      "flex items-center justify-center gap-2 min-w-0",
                      "hover:scale-105 active:scale-95",
                      active
                        ? "glass-surface-strong border border-primary/50 text-primary"
                        : "border border-transparent text-foreground/70 hover:text-foreground hover:bg-default-100",
                    )}
                  >
                    <span className="truncate max-w-[60%]">
                      {d.name || t("common.unknown")}
                    </span>
                    <span className="shrink-0 text-xs lg:text-sm opacity-80">
                      Lv.{d.level ?? "--"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* 概览 */}
          <GlassCard className="p-4 lg:p-5 glass-surface border border-separator/90">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {/* 区域名称 */}
              <div className="col-span-2 lg:col-span-1 min-w-0 flex flex-col justify-center">
                <p className="text-xs text-muted mb-1">
                  {t("domain_page.domain")}
                </p>
                <p className="text-lg font-semibold text-foreground truncate">
                  {effectiveDomain.name || t("common.unknown")}
                </p>
              </div>
              {/* 区域等级 */}
              <div className="min-w-0 flex flex-col justify-center">
                <p className="text-xs text-muted mb-1">
                  {t("card:domain_info_level")}
                </p>
                <p className="text-2xl lg:text-3xl font-bold text-foreground font-mono leading-none">
                  {effectiveDomain.level ?? "--"}
                </p>
              </div>
              {/* 货币 */}
              <div className="col-span-2 min-w-0 flex flex-col justify-center gap-2">
                <div className="flex items-baseline justify-between gap-2 min-w-0">
                  <p className="text-xs text-muted truncate">{moneyName}</p>
                  <p className="text-sm font-mono text-foreground shrink-0">
                    {formatMoney(effectiveDomain.moneyMgr?.count)}
                    <span className="text-muted">
                      /{formatMoney(effectiveDomain.moneyMgr?.total)}
                    </span>
                  </p>
                </div>
                <div className="h-1.5 rounded-full bg-default-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-success/70 to-success transition-all duration-500"
                    style={{
                      width: `${percent(
                        effectiveDomain.moneyMgr?.count,
                        effectiveDomain.moneyMgr?.total,
                      )}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </GlassCard>

          {/* 基建建设点 */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase text-muted">
                {t("card:domain_info_settlements")}
              </h2>
              <span className="text-xs tabular-nums text-muted">
                {settlements.length}
              </span>
            </div>
            {settlements.length === 0 ? (
              <GlassCard className="p-10 glass-surface border border-separator/90">
                <p className="text-center text-sm text-muted">
                  {t("domain_page.empty")}
                </p>
              </GlassCard>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {settlements.map((s) => {
                  const expPct = percent(s.exp, s.expToLevelUp);
                  const moneyPct = percent(s.remainMoney, s.moneyMax);
                  return (
                    <GlassCard
                      key={s.id}
                      className="p-3.5 glass-surface border border-separator/80 min-w-0"
                    >
                      {/* 标题行：头像 + 名称 + 等级 */}
                      <div className="flex items-center gap-2.5 min-w-0">
                        {s.officerCharAvatar ? (
                          <Img
                            src={s.officerCharAvatar}
                            alt={s.officerCharIds ?? ""}
                            className="w-10 h-10 rounded-lg border border-separator shrink-0 avatar-feather"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-lg border border-separator/60 bg-content2/30 flex items-center justify-center text-xs font-semibold text-muted shrink-0">
                            {(s.name ?? "?").charAt(0)}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">
                              {s.name ?? "--"}
                            </p>
                            {s.isFinalMaxLevel && (
                              <span className="shrink-0 text-[10px] font-semibold text-success">
                                MAX
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted">
                            {t("card:domain_info_settlement_level")} Lv.
                            {s.level ?? "--"}
                          </p>
                        </div>
                      </div>

                      {/* 货币进度 */}
                      <div className="mt-3 space-y-2.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[11px] text-muted shrink-0 w-16 truncate">
                            {moneyName}
                          </span>
                          <div className="flex-1 min-w-0 h-1.5 rounded-full bg-default-100 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-success/70 to-success transition-all duration-500"
                              style={{ width: `${moneyPct}%` }}
                            />
                          </div>
                          <span className="text-[11px] text-foreground font-mono shrink-0">
                            {formatMoney(s.remainMoney)}
                            <span className="text-muted">
                              /{formatMoney(s.moneyMax)}
                            </span>
                          </span>
                        </div>
                        {/* 经验进度（满级不显示） */}
                        {!s.isFinalMaxLevel && Number(s.expToLevelUp) > 0 && (
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[11px] text-muted shrink-0 w-16">
                              {t("card:domain_info_settlement_exp")}
                            </span>
                            <div className="flex-1 min-w-0 h-1.5 rounded-full bg-default-100 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-primary/70 to-primary transition-all duration-500"
                                style={{ width: `${expPct}%` }}
                              />
                            </div>
                            <span className="text-[11px] text-foreground font-mono shrink-0">
                              {formatMoney(s.exp)}
                              <span className="text-muted">
                                /{formatMoney(s.expToLevelUp)}
                              </span>
                            </span>
                          </div>
                        )}
                        <div className="flex items-center justify-between text-[11px] text-muted pt-0.5 border-t border-separator/50">
                          <span>{t("card:domain_info_settlement_last_tick")}</span>
                          <span className="font-mono">
                            {formatDateTime(s.lastTickTime)}
                          </span>
                        </div>
                      </div>
                    </GlassCard>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
