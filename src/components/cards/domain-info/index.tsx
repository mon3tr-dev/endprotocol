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
import {
  CustomModal,
  CustomModalHeader,
  CustomModalBody,
  CustomModalFooter,
} from "@/components/custom-modal";
import type { Account } from "@/utils/accountService";
import type { DomainInfoCardSettings } from "@/types/card-settings";
import {
  type DomainData,
  type DomainSettlement,
  formatMoney,
  formatDateTime,
  getMoneyName,
} from "./domain-shared";

export type { DomainData, DomainSettlement };

export default function DomainInfoCard({
  roleId: defaultRoleId,
  cardId,
  settings,
}: BaseCardProps) {
  const { t, i18n } = useTranslation();
  const [customRoleId, setCustomRoleId] = useState<string | undefined>(
    (settings as DomainInfoCardSettings)?.roleId,
  );
  const [domainId, setDomainId] = useState<string | undefined>(
    (settings as DomainInfoCardSettings)?.domainId,
  );
  const [isRoleSelectOpen, setIsRoleSelectOpen] = useState(false);
  const [isDomainSelectOpen, setIsDomainSelectOpen] = useState(false);
  const [isListOpen, setIsListOpen] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const effectiveRoleId = customRoleId ?? defaultRoleId;

  const { data, isLoading } = useCardData<DomainData[]>({
    fetchData: async () => {
      const result = await roleDataService.queryData(effectiveRoleId, "char_detail", ["domain"]);
      if (!result) return [];
      const list = result["domain"];
      return Array.isArray(list) ? list : [];
    },
    reloadKey: effectiveRoleId,
  });

  const domains = useMemo(() => data ?? [], [data]);

  const effectiveDomain = useMemo(
    () => domains.find((d) => d.domainId === domainId) ?? domains[0] ?? null,
    [domains, domainId],
  );

  const loadSettings = useCallback(async () => {
    try {
      const s = await CardConfigService.getCardSettings<DomainInfoCardSettings>(cardId);
      if (s.roleId) setCustomRoleId(s.roleId);
      if (s.domainId) setDomainId(s.domainId);
    } catch (error) {
      logError("Failed to load domain info settings:", error);
    }
  }, [cardId]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

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

  const saveDomain = useCallback(
    async (newDomainId: string, newRoleId?: string) => {
      const patch: DomainInfoCardSettings = {};
      if (newDomainId) patch.domainId = newDomainId;
      if (newRoleId) patch.roleId = newRoleId;
      try {
        await CardConfigService.saveCardSettings(cardId, patch);
      } catch (error) {
        logError("Failed to save domain settings:", error);
      }
    },
    [cardId],
  );

  const openAccountSelect = useCallback(async () => {
    try {
      const accs = await getAccounts();
      setAccounts(accs);
      setIsRoleSelectOpen(true);
    } catch (err) {
      logError("Failed to load accounts:", err);
    }
  }, []);

  const openDomainSelect = useCallback(() => {
    setIsDomainSelectOpen(true);
  }, []);

  const openList = useCallback(() => {
    setIsListOpen(true);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { cardId: string; action: string } | undefined;
      if (detail?.cardId !== cardId) return;
      if (detail.action === "change-role") {
        openAccountSelect();
      } else if (detail.action === "switch-domain") {
        openDomainSelect();
      } else if (detail.action === "view-list") {
        openList();
      }
    };
    window.addEventListener("cardAction", handler);
    return () => window.removeEventListener("cardAction", handler);
  }, [cardId, openAccountSelect, openDomainSelect, openList]);

  const handleRoleConfirm = async (newRoleId: string) => {
    setCustomRoleId(newRoleId);
    setIsRoleSelectOpen(false);
    await saveDomain(domainId ?? "", newRoleId);
  };

  const handleDomainConfirm = async (newDomainId: string) => {
    setDomainId(newDomainId);
    setIsDomainSelectOpen(false);
    await saveDomain(newDomainId);
  };

  const currentAccount = useMemo(
    () => accounts.find((a) => a.id === effectiveRoleId) ?? null,
    [accounts, effectiveRoleId],
  );

  const settlements = effectiveDomain?.settlements ?? [];

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

  if (!effectiveDomain) {
    return (
      <GlassCard className="p-6 glass-surface border border-separator/90 h-full w-full flex items-center justify-center">
        <p className="text-muted text-center text-sm">{t("card:domain_info_empty")}</p>
      </GlassCard>
    );
  }

  return (
    <>
      <GlassCard className="p-2.5 glass-surface border border-separator/90 h-full w-full select-none rounded-[10px] overflow-hidden">
        <div className="flex items-center justify-between gap-2 min-w-0 mb-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <AccountAvatar
              src={currentAccount?.avatar ?? ""}
              alt={currentAccount?.nickname ?? ""}
              size="sm"
              className="rounded-md border border-separator shrink-0"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-xs font-semibold text-foreground truncate">
                  {effectiveDomain.name || t("common.unknown")}
                </span>
                {domains.length > 1 && (
                  <button
                    type="button"
                    onClick={openDomainSelect}
                    title={t("card:domain_info_switch_domain")}
                    aria-label={t("card:domain_info_switch_domain")}
                    className="shrink-0 w-4 h-4 flex items-center justify-center rounded text-muted hover:text-foreground hover:bg-default-100 transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h11M8 12h11M8 17h11M5 7h.01M5 12h.01M5 17h.01" />
                    </svg>
                  </button>
                )}
              </div>
              <div className="text-[10px] text-muted">
                {t("card:domain_info_level")} {effectiveDomain.level ?? "--"}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={openAccountSelect}
            title={t("card:domain_info_switch_account")}
            aria-label={t("card:domain_info_switch_account")}
            className="shrink-0 w-5 h-5 flex items-center justify-center rounded-md text-muted hover:text-foreground hover:bg-default-100 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
            </svg>
          </button>
        </div>

        <div className="flex items-stretch gap-3 min-h-0">
          <div className="w-24 shrink-0 flex flex-col justify-center gap-1.5">
            <span className="text-[11px] text-muted text-center">
              {getMoneyName(effectiveDomain.domainId, i18n.language) ||
                t("card:domain_info_money")}
            </span>
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-2xl font-bold text-foreground font-mono leading-none">
                {formatMoney(effectiveDomain.moneyMgr?.count)}
              </span>
              <span className="text-xs text-muted font-mono">/ {formatMoney(effectiveDomain.moneyMgr?.total)}</span>
            </div>
          </div>

          <div className="flex-1 min-w-0 border-l border-separator/60 pl-3">
            <div className="text-[11px] text-muted mb-1.5">
              {t("card:domain_info_settlements")} ({settlements.length})
            </div>
            {settlements.length > 0 && (
              <div className="space-y-2">
                {settlements.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-2 min-w-0"
                    title={`${s.name ?? ""} Lv.${s.level ?? "--"} ${formatMoney(s.remainMoney)}`}
                  >
                    {s.officerCharAvatar ? (
                      <Img
                        src={s.officerCharAvatar}
                        alt=""
                        className="w-6 h-6 rounded border border-separator shrink-0 avatar-feather"
                      />
                    ) : null}
                    <span className="text-xs text-foreground truncate max-w-[110px]">
                      {s.name ?? "--"}
                    </span>
                    <span className="shrink-0 text-xs text-muted">
                      {t("card:domain_info_settlement_level")} {s.level ?? "--"}
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-foreground font-mono">
                      {formatMoney(s.remainMoney)}
                      <span className="text-muted">/{formatMoney(s.moneyMax)}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </GlassCard>

      <CustomModal
        isOpen={isListOpen}
        onClose={() => setIsListOpen(false)}
        size="md"
      >
        <CustomModalHeader onClose={() => setIsListOpen(false)}>
          {effectiveDomain.name || t("card:domain_info_empty")} ·{" "}
          {t("card:domain_info_settlements")}
        </CustomModalHeader>
        <CustomModalBody>
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-lg bg-default-50/60 border border-separator/60 px-3 py-1.5">
              <span className="text-xs text-muted">{t("card:domain_info_level")}</span>
              <span className="text-xs font-medium text-foreground">
                {effectiveDomain.level ?? "--"}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-default-50/60 border border-separator/60 px-3 py-1.5">
              <span className="text-xs text-muted">
                {getMoneyName(effectiveDomain.domainId, i18n.language) || t("card:domain_info_money")}
              </span>
              <span className="text-xs font-medium text-foreground font-mono">
                {formatMoney(effectiveDomain.moneyMgr?.count)} /{" "}
                {formatMoney(effectiveDomain.moneyMgr?.total)}
              </span>
            </div>

            <div className="pt-1 border-t border-separator/60">
              <div className="text-[10px] text-muted mb-1.5">
                {t("card:domain_info_settlements")} ({settlements.length})
              </div>
              {settlements.length === 0 ? (
                <div className="text-center text-muted py-6 text-sm">
                  {t("card:domain_info_empty")}
                </div>
              ) : (
                <div className="space-y-1.5 max-h-[320px] overflow-y-auto pr-1">
                  {settlements.map((s) => {
                    const expNum = Number(s.exp) || 0;
                    const expToLevelUp = Number(s.expToLevelUp) || 0;
                    const expPct =
                      expToLevelUp > 0
                        ? Math.min(100, Math.max(0, (expNum / expToLevelUp) * 100))
                        : 100;
                    const moneyNum = Number(s.remainMoney) || 0;
                    const moneyMaxNum = Number(s.moneyMax) || 0;
                    return (
                      <div
                        key={s.id}
                        className="rounded-lg border border-separator/60 bg-default-50/40 px-2.5 py-2"
                      >
                        <div className="flex items-center gap-2.5">
                          {s.officerCharAvatar ? (
                            <Img
                              src={s.officerCharAvatar}
                              alt={s.officerCharIds ?? ""}
                              className="w-8 h-8 rounded border border-separator shrink-0 avatar-feather"
                            />
                          ) : null}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-xs font-medium text-foreground truncate">
                                {s.name ?? "--"}
                              </span>
                              <span className="shrink-0 text-[9px] text-muted">
                                {t("card:domain_info_settlement_level")} {s.level ?? "--"}
                              </span>
                              {s.isFinalMaxLevel && (
                                <span className="shrink-0 text-[9px] text-success">MAX</span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
                          <div className="flex items-center gap-1 min-w-0">
                            <span className="text-[9px] text-muted shrink-0">
                              {getMoneyName(effectiveDomain.domainId, i18n.language) ||
                                t("card:domain_info_settlement_money")}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="h-1 rounded-full bg-default-100 overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-success/70 to-success transition-all duration-500"
                                  style={{
                                    width: `${moneyMaxNum > 0 ? Math.min(100, (moneyNum / moneyMaxNum) * 100) : 0}%`,
                                  }}
                                />
                              </div>
                            </div>
                            <span className="text-[9px] text-foreground font-mono truncate">
                              {formatMoney(s.remainMoney)}/{formatMoney(s.moneyMax)}
                            </span>
                          </div>
                          {!s.isFinalMaxLevel && expToLevelUp > 0 && (
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-[9px] text-muted shrink-0">
                                {t("card:domain_info_settlement_exp")}
                              </span>
                              <div className="flex-1 min-w-0">
                                <div className="h-1 rounded-full bg-default-100 overflow-hidden">
                                  <div
                                    className="h-full rounded-full bg-gradient-to-r from-primary/70 to-primary transition-all duration-500"
                                    style={{ width: `${expPct}%` }}
                                  />
                                </div>
                              </div>
                              <span className="text-[9px] text-foreground font-mono shrink-0">
                                {formatMoney(expNum)}/{formatMoney(expToLevelUp)} Exp
                              </span>
                            </div>
                          )}
                          <div className="flex items-center gap-1 min-w-0 col-span-2">
                            <span className="text-[9px] text-muted shrink-0">
                              {t("card:domain_info_settlement_last_tick")}
                            </span>
                            <span className="text-[9px] text-muted font-mono truncate">
                              {formatDateTime(s.lastTickTime)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </CustomModalBody>
        <CustomModalFooter>
          <GlassButton variant="secondary" onPress={() => setIsListOpen(false)}>
            {t("common.close") || "Close"}
          </GlassButton>
        </CustomModalFooter>
      </CustomModal>

      <CustomModal
        isOpen={isDomainSelectOpen}
        onClose={() => setIsDomainSelectOpen(false)}
        size="sm"
      >
        <CustomModalHeader onClose={() => setIsDomainSelectOpen(false)}>
          {t("card:domain_info_switch_domain")}
        </CustomModalHeader>
        <CustomModalBody>
          <div className="space-y-2">
            {domains.map((d) => (
              <div
                key={d.domainId}
                className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all hover:bg-default-100 border border-separator hover:border-primary/50"
                onClick={() => handleDomainConfirm(d.domainId ?? "")}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{d.name || "--"}</div>
                  <div className="text-xs text-muted">
                    {t("card:domain_info_level")} {d.level ?? "--"}
                  </div>
                </div>
                {effectiveDomain.domainId === d.domainId && (
                  <div className="text-primary text-xs font-medium">
                    {t("card:current") || "Current"}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CustomModalBody>
        <CustomModalFooter>
          <GlassButton variant="secondary" onPress={() => setIsDomainSelectOpen(false)}>
            {t("common.cancel") || "Cancel"}
          </GlassButton>
        </CustomModalFooter>
      </CustomModal>

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
                      {account.nickname || t("common.unknown") || "Unknown"}
                    </div>
                    <div className="text-xs text-muted">
                      {resolveServerLabel(account.server, i18n.language)} · Lv.{account.level}
                    </div>
                  </div>
                  {effectiveRoleId === account.id && (
                    <div className="text-primary text-xs font-medium">
                      {t("card:current") || "Current"}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </CustomModalBody>
        <CustomModalFooter>
          <GlassButton variant="secondary" onPress={() => setIsRoleSelectOpen(false)}>
            {t("common.cancel") || "Cancel"}
          </GlassButton>
        </CustomModalFooter>
      </CustomModal>
    </>
  );
}
