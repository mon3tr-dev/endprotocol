import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GlassButton, GlassCard, GlassProgressCircle } from "@/components/ui/glass";
import { useTranslation } from "react-i18next";
import { BaseCardProps } from "../registry/types";
import { useCardData } from "../base/use-card-data";
import { CardConfigService } from "@/utils/cardConfigService";
import { getAccounts } from "@/utils/accountService";
import { fetchArknightsPlayerInfo } from "@/utils/arknightsDataService";
import { filterAccountsForCard } from "@/config/gameSupport";
import { AccountAvatar } from "@/components/ui/account-avatar";
import { logError } from "@/utils/logger";
import { resolveServerLabel } from "@/types";
import { AccountNameLine } from "@/components/ui/game-badge";
import {
  CustomModal,
  CustomModalHeader,
  CustomModalBody,
  CustomModalFooter,
} from "@/components/custom-modal";
import type { Account } from "@/utils/accountService";
import type { ArknightsPlayerInfo } from "@/types/arknights";
import type { BuildingCardSettings } from "@/types/card-settings";
import {
  dormRestSummary,
  laborPercent,
  laborRemainingMs,
  manufactureState,
  tradingSummary,
} from "./building-shared";
import { formatCountdown } from "../recruitment/recruit-shared";

export default function BuildingCard({
  roleId: defaultRoleId,
  cardId,
  settings,
}: BaseCardProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [customRoleId, setCustomRoleId] = useState<string | undefined>(
    (settings as BuildingCardSettings)?.roleId,
  );
  const [isRoleSelectOpen, setIsRoleSelectOpen] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const effectiveRoleId = customRoleId ?? defaultRoleId;

  const { data: info, isLoading, refetch: refetchInfo } = useCardData<ArknightsPlayerInfo | null>({
    fetchData: () =>
      effectiveRoleId
        ? fetchArknightsPlayerInfo({ roleId: effectiveRoleId })
        : Promise.resolve(null),
    reloadKey: effectiveRoleId,
  });

  // 无人机补满倒计时按秒重算
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const s = await CardConfigService.getCardSettings<BuildingCardSettings>(cardId);
      if (s.roleId) setCustomRoleId(s.roleId);
    } catch (error) {
      logError("Failed to load building settings:", error);
    }
  }, [cardId]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const loadAccounts = useCallback(async () => {
    try {
      const accs = await getAccounts();
      // 基建只对明日方舟账户有意义
      setAccounts(filterAccountsForCard(accs, "building"));
    } catch (error) {
      logError("Failed to load accounts:", error);
    }
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts, effectiveRoleId]);

  const openAccountSelect = useCallback(async () => {
    try {
      const accs = await getAccounts();
      setAccounts(filterAccountsForCard(accs, "building"));
      setIsRoleSelectOpen(true);
    } catch (err) {
      logError("Failed to load accounts:", err);
    }
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { cardId: string; action: string } | undefined;
      if (detail?.cardId === cardId && detail?.action === "change-role") {
        openAccountSelect();
      } else if (detail?.cardId === cardId && detail?.action === "refresh") {
        void refetchInfo(true);
      }
    };
    window.addEventListener("cardAction", handler);
    return () => window.removeEventListener("cardAction", handler);
  }, [cardId, openAccountSelect, refetchInfo]);

  const handleRoleConfirm = async (newRoleId: string) => {
    setCustomRoleId(newRoleId);
    setIsRoleSelectOpen(false);
    try {
      await CardConfigService.saveCardSettings(cardId, {
        roleId: newRoleId,
      } as BuildingCardSettings);
    } catch (error) {
      logError("Failed to save roleId:", error);
    }
  };

  const currentAccount = useMemo(
    () => accounts.find((a) => a.id === effectiveRoleId) ?? null,
    [accounts, effectiveRoleId],
  );

  const building = info?.building ?? null;

  // 汇总：制造站状态 / 贸易站订单 / 疲劳干员 / 训练室
  const stats = useMemo(() => {
    const manufactures = building?.manufactures ?? [];
    let producing = 0;
    let done = 0;
    for (const line of manufactures) {
      const st = manufactureState(line, nowMs);
      if (st.kind === "producing") producing += 1;
      if (st.kind === "done") done += 1;
    }
    const tradings = building?.tradings ?? [];
    let orderCount = 0;
    let orderLimit = 0;
    for (const post of tradings) {
      const s = tradingSummary(post);
      orderCount += s.count;
      orderLimit += s.limit;
    }
    return {
      producing,
      done,
      orderCount,
      orderLimit,
      tiredCount: building?.tiredChars?.length ?? 0,
      specializing: Boolean(building?.training?.trainee && building.training.trainee.targetSkill >= 0),
    };
  }, [building, nowMs]);

  const rest = useMemo(() => dormRestSummary(building), [building]);
  const labor = building?.labor ?? null;

  if (isLoading) {
    return (
      <GlassCard className="p-6  border border-separator/90 h-full w-full flex items-center justify-center">
        <GlassProgressCircle isIndeterminate size="md" aria-label="Loading" className="text-primary">
          <GlassProgressCircle.Track>
            <GlassProgressCircle.TrackCircle />
            <GlassProgressCircle.FillCircle />
          </GlassProgressCircle.Track>
        </GlassProgressCircle>
      </GlassCard>
    );
  }

  if (!info || !building) {
    return (
      <GlassCard className="p-6  border border-separator/90 h-full w-full flex items-center justify-center">
        <p className="text-muted text-center text-sm">{t("card:no_data")}</p>
      </GlassCard>
    );
  }

  const laborPct = laborPercent(labor);
  const laborRemainMs = laborRemainingMs(labor, nowMs);
  const dronesFull = laborPct >= 100 || !labor;

  return (
    <>
      <GlassCard className="p-2.5  border border-separator/90 h-full w-full select-none rounded-[10px] overflow-hidden flex flex-col">
        {/* 头部：账户 */}
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <AccountAvatar
              src={currentAccount?.avatar ?? info.status.avatar?.base64 ?? info.status.avatar?.url ?? ""}
              alt={currentAccount?.nickname ?? ""}
              size="sm"
              className="rounded-md border border-separator shrink-0"
            />
            <div className="min-w-0">
              <div className="text-xs font-semibold text-foreground truncate">
                {t("card:building_title")}
              </div>
              <div className="text-[10px] text-muted truncate">
                {currentAccount?.nickname ? (
                  <AccountNameLine game={currentAccount.game}>
                    {currentAccount.nickname}
                  </AccountNameLine>
                ) : null}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={openAccountSelect}
            title={t("card:building_switch_account")}
            aria-label={t("card:building_switch_account")}
            className="shrink-0 w-5 h-5 flex items-center justify-center rounded-md text-muted hover:text-foreground lg-hoverable transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
            </svg>
          </button>
        </div>

        {/* 无人机 + 宿舍休息 */}
        <div className="mt-2 grid grid-cols-2 gap-2 min-h-0">
          <div className="rounded-lg border border-separator/60 bg-default-50/40 px-2.5 py-1.5 min-w-0">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] text-muted truncate">
                {t("card:building_drones")}
              </span>
              <span className="text-[10px] text-muted font-mono shrink-0">
                {labor?.value ?? 0}/{labor?.maxValue ?? 0}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full lg-inset overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary/70 to-primary transition-all duration-500"
                style={{ width: `${laborPct}%` }}
              />
            </div>
            <div className="mt-1 text-[10px] text-muted leading-none">
              {dronesFull
                ? t("card:building_drones_full")
                : t("card:building_drones_full_in", {
                    time: formatCountdown(laborRemainMs, i18n.language),
                  })}
            </div>
          </div>
          <div className="rounded-lg border border-separator/60 bg-default-50/40 px-2.5 py-1.5 min-w-0">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] text-muted truncate">
                {t("card:building_dorm_rest")}
              </span>
              <span className="text-[10px] text-muted font-mono shrink-0">
                {rest.restingCount > 0
                  ? `${rest.restingCount}/${rest.charCount}`
                  : `${rest.charCount}`}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full lg-inset overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-success/70 to-success transition-all duration-500"
                style={{ width: `${rest.percent}%` }}
              />
            </div>
            <div className="mt-1 text-[10px] text-muted leading-none">
              {Math.round(rest.percent)}%
            </div>
          </div>
        </div>

        {/* 汇总条：制造 / 订单 / 疲劳 / 专精 */}
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-separator/60 pt-1.5 flex-1 min-h-0">
          {[
            {
              label: t("card:building_manufactures"),
              value: stats.done > 0 ? `${stats.producing}+${stats.done}` : `${stats.producing}`,
            },
            {
              label: t("card:building_tradings"),
              value: stats.orderLimit > 0 ? `${stats.orderCount}/${stats.orderLimit}` : "--",
            },
            {
              label: t("card:building_tired"),
              value: stats.tiredCount > 0 ? `${stats.tiredCount}` : "0",
              warn: stats.tiredCount > 0,
            },
            {
              label: t("card:building_training"),
              value: stats.specializing
                ? t("card:building_specializing")
                : t("card:building_idle"),
            },
          ].map((item, idx) => (
            <div key={idx} className="flex-1 min-w-0 text-center">
              <div
                className={`text-xs font-medium truncate ${
                  item.warn ? "text-warning-text" : "text-foreground"
                }`}
              >
                {item.value}
              </div>
              <div className="text-[9px] text-muted truncate">{item.label}</div>
            </div>
          ))}
        </div>

        {/* 底部：跳转独立页面 */}
        <div className="mt-1.5 flex items-center justify-end border-t border-separator/60 pt-1.5">
          <button
            type="button"
            onClick={() => navigate("/building")}
            className="text-[10px] text-muted hover:text-foreground lg-hoverable transition-colors flex items-center gap-1"
          >
            {t("card:building_view_page")}
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </GlassCard>

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
                  className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all lg-hoverable border border-separator hover:border-primary/50"
                  onClick={() => handleRoleConfirm(account.id)}
                >
                  <AccountAvatar
                    src={account.avatar}
                    alt={account.nickname}
                    size="sm"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">
                      <AccountNameLine game={account.game}>
                        {account.nickname || t("common.unknown") || "Unknown"}
                      </AccountNameLine>
                    </div>
                    <div className="text-xs text-muted">
                      {resolveServerLabel(account.server, i18n.language)} · Lv.{account.level}
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
          <GlassButton variant="secondary" onPress={() => setIsRoleSelectOpen(false)}>
            {t("common.cancel") || "Cancel"}
          </GlassButton>
        </CustomModalFooter>
      </CustomModal>
    </>
  );
}
