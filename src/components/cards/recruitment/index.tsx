import { useCallback, useEffect, useMemo, useState } from "react";
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
import type { ArknightsPlayerInfo, ArknightsRecruitSlot } from "@/types/arknights";
import type { RecruitmentCardSettings } from "@/types/card-settings";
import {
  recruitSlotState,
  recruitRemainingMs,
  recruitProgressPercent,
  formatCountdown,
  type RecruitSlotState,
} from "./recruit-shared";

/** 槽位状态徽标的颜色类（与页面共用语义） */
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

export default function RecruitmentCard({
  roleId: defaultRoleId,
  cardId,
  settings,
}: BaseCardProps) {
  const { t, i18n } = useTranslation();
  const [customRoleId, setCustomRoleId] = useState<string | undefined>(
    (settings as RecruitmentCardSettings)?.roleId,
  );
  const [isRoleSelectOpen, setIsRoleSelectOpen] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  // 每秒重算倒计时（数据本身来自缓存，无需重新请求）
  const [nowMs, setNowMs] = useState(() => Date.now());

  const effectiveRoleId = customRoleId ?? defaultRoleId;

  const { data: info, isLoading, refetch: refetchInfo } = useCardData<ArknightsPlayerInfo | null>({
    fetchData: () =>
      effectiveRoleId
        ? fetchArknightsPlayerInfo({ roleId: effectiveRoleId })
        : Promise.resolve(null),
    reloadKey: effectiveRoleId,
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const s = await CardConfigService.getCardSettings<RecruitmentCardSettings>(cardId);
      if (s.roleId) setCustomRoleId(s.roleId);
    } catch (error) {
      logError("Failed to load recruitment settings:", error);
    }
  }, [cardId]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const loadAccounts = useCallback(async () => {
    try {
      const accs = await getAccounts();
      // 公开招募只对明日方舟账户有意义
      setAccounts(filterAccountsForCard(accs, "recruitment"));
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
      setAccounts(filterAccountsForCard(accs, "recruitment"));
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
      } as RecruitmentCardSettings);
    } catch (error) {
      logError("Failed to save roleId:", error);
    }
  };

  const currentAccount = useMemo(
    () => accounts.find((a) => a.id === effectiveRoleId) ?? null,
    [accounts, effectiveRoleId],
  );

  const slots = useMemo(() => padSlots(info?.recruit), [info]);

  // 状态汇总（徽标行）：招募中 / 已完成 / 空闲 / 未开放
  const summary = useMemo(() => {
    const counts: Record<RecruitSlotState, number> = {
      running: 0,
      finished: 0,
      free: 0,
      locked: 0,
    };
    for (const slot of slots) counts[recruitSlotState(slot, nowMs)] += 1;
    return counts;
  }, [slots, nowMs]);

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

  if (!info) {
    return (
      <GlassCard className="p-6  border border-separator/90 h-full w-full flex items-center justify-center">
        <p className="text-muted text-center text-sm">{t("card:no_data")}</p>
      </GlassCard>
    );
  }

  const stateLabel = (state: RecruitSlotState) =>
    state === "running"
      ? t("card:recruitment_slot_running")
      : state === "finished"
        ? t("card:recruitment_slot_finished")
        : state === "free"
          ? t("card:recruitment_slot_free")
          : t("card:recruitment_slot_locked");

  return (
    <>
      <GlassCard className="p-2.5  border border-separator/90 h-full w-full select-none rounded-[10px] overflow-hidden flex flex-col">
        {/* 头部：账户 + 汇总 */}
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
                {t("card:recruitment_title")}
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
          <div className="flex items-center gap-1.5 shrink-0">
            {(
              [
                ["running", summary.running],
                ["finished", summary.finished],
                ["free", summary.free],
                ["locked", summary.locked],
              ] as [RecruitSlotState, number][]
            )
              .filter(([, n]) => n > 0)
              .map(([state, n]) => (
                <span
                  key={state}
                  className={`px-1.5 py-0.5 rounded-md text-[10px] font-medium ${STATE_BADGE_CLASS[state]}`}
                >
                  {n} {stateLabel(state)}
                </span>
              ))}
            <button
              type="button"
              onClick={openAccountSelect}
              title={t("card:recruitment_switch_account")}
              aria-label={t("card:recruitment_switch_account")}
              className="shrink-0 w-5 h-5 flex items-center justify-center rounded-md text-muted hover:text-foreground lg-hoverable transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
              </svg>
            </button>
          </div>
        </div>

        {/* 2x2 栏位网格 */}
        <div className="mt-2 grid grid-cols-2 gap-2 flex-1 min-h-0">
          {slots.map((slot, idx) => {
            const state = recruitSlotState(slot, nowMs);
            const remainMs = recruitRemainingMs(slot, nowMs);
            const pct = recruitProgressPercent(slot, nowMs);
            return (
              <div
                key={idx}
                className="rounded-lg border border-separator/60 bg-default-50/40 px-2.5 py-1.5 flex flex-col justify-between min-w-0"
              >
                <div className="flex items-center justify-between gap-1 min-w-0">
                  <span className="text-[10px] text-muted truncate">
                    {t("card:recruitment_slot", { number: idx + 1 })}
                  </span>
                  <span className={`shrink-0 px-1.5 py-0.5 rounded-md text-[9px] font-medium ${STATE_BADGE_CLASS[state]}`}>
                    {stateLabel(state)}
                  </span>
                </div>
                {state === "running" || state === "finished" ? (
                  <div className="mt-1">
                    <div
                      className={`text-sm font-bold font-mono leading-none ${
                        state === "finished" ? "text-success-text" : "text-foreground"
                      }`}
                    >
                      {state === "finished" ? "--:--:--" : formatCountdown(remainMs, i18n.language)}
                    </div>
                    <div className="mt-1.5 h-1 rounded-full lg-inset overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          state === "finished"
                            ? "bg-gradient-to-r from-success/70 to-success"
                            : "bg-gradient-to-r from-primary/70 to-primary"
                        }`}
                        style={{ width: `${state === "finished" ? 100 : pct}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="mt-1 text-[10px] text-muted/70 leading-none">—</div>
                )}
              </div>
            );
          })}
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
