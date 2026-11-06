import { useCallback, useEffect, useMemo, useState } from "react";
import { GlassButton, GlassCard, GlassMeter, GlassProgressCircle } from "@/components/ui/glass";
import { useTranslation } from "react-i18next";
import { BaseCardProps } from "../registry/types";
import { useCardData } from "../base/use-card-data";
import { roleDataService } from "@/utils/roleDataService";
import { CardConfigService } from "@/utils/cardConfigService";
import { getAccounts } from "@/utils/accountService";
import { AccountAvatar } from "@/components/ui/account-avatar";
import { logError } from "@/utils/logger";
import { resolveServerLabel } from "@/types";
import {
  CustomModal,
  CustomModalHeader,
  CustomModalBody,
  CustomModalFooter,
} from "@/components/custom-modal";
import type { Account } from "@/utils/accountService";
import type { AccountProgressCardSettings } from "@/types/card-settings";

export interface DungeonData {
  curStamina?: string;
  maxTs?: string;
  maxStamina?: string;
}

export interface ProgressData {
  dungeon?: DungeonData;
  bpSystem?: { curLevel?: number; maxLevel?: number };
  dailyMission?: { dailyActivation?: number; maxDailyActivation?: number };
  weeklyMission?: { score?: number; total?: number };
}

function formatRecoverCountdownFromSec(totalSeconds: number): string {
  if (totalSeconds <= 0) return "00:00:00";
  const sec = Math.floor(totalSeconds);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function AccountProgressCard({
  roleId: defaultRoleId,
  cardId,
  settings,
}: BaseCardProps) {
  const { t, i18n } = useTranslation();
  const [customRoleId, setCustomRoleId] = useState<string | undefined>(
    (settings as AccountProgressCardSettings)?.roleId,
  );
  const [isRoleSelectOpen, setIsRoleSelectOpen] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const effectiveRoleId = customRoleId ?? defaultRoleId;

  const { data, isLoading } = useCardData<ProgressData>({
    fetchData: async () => {
      const result = await roleDataService.queryData(effectiveRoleId, "char_detail", [
        "dungeon",
        "bpSystem",
        "dailyMission",
        "weeklyMission",
      ]);
      if (!result) return {};
      return {
        dungeon: result["dungeon"],
        bpSystem: result["bpSystem"],
        dailyMission: result["dailyMission"],
        weeklyMission: result["weeklyMission"],
      };
    },
    reloadKey: effectiveRoleId,
  });

  const loadSettings = useCallback(async () => {
    try {
      const s = await CardConfigService.getCardSettings<AccountProgressCardSettings>(cardId);
      if (s.roleId) {
        setCustomRoleId(s.roleId);
      }
    } catch (error) {
      logError("Failed to load account progress settings:", error);
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

  const openAccountSelect = useCallback(async () => {
    try {
      const accs = await getAccounts();
      setAccounts(accs);
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
      }
    };
    window.addEventListener("cardAction", handler);
    return () => window.removeEventListener("cardAction", handler);
  }, [cardId, openAccountSelect]);

  const handleRoleConfirm = async (newRoleId: string) => {
    setCustomRoleId(newRoleId);
    setIsRoleSelectOpen(false);
    try {
      await CardConfigService.saveCardSettings(cardId, {
        roleId: newRoleId,
      } as AccountProgressCardSettings);
    } catch (error) {
      logError("Failed to save roleId:", error);
    }
  };

  const currentAccount = useMemo(
    () => accounts.find((a) => a.id === effectiveRoleId) ?? null,
    [accounts, effectiveRoleId],
  );

  const curStamina = Number(data?.dungeon?.curStamina) || 0;
  const maxStamina = Number(data?.dungeon?.maxStamina) || 0;
  const maxTsSec = Math.round(Number(data?.dungeon?.maxTs) || 0);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const REFILL_INTERVAL = 432;

  const { liveStamina, refillCountdown, recoverCountdown, isStaminaFull } = useMemo(() => {
    if (maxStamina <= 0 || maxTsSec <= 0) {
      return {
        liveStamina: curStamina,
        refillCountdown: "",
        recoverCountdown: "",
        isStaminaFull: maxStamina > 0 && curStamina >= maxStamina,
      };
    }
    const nowSec = now / 1000;
    const unitsBelowMax = (maxTsSec - nowSec) / REFILL_INTERVAL;
    let live = Math.floor(maxStamina - unitsBelowMax);
    if (live < 0) live = 0;
    if (live > maxStamina) live = maxStamina;

    if (live >= maxStamina) {
      return { liveStamina: live, refillCountdown: "", recoverCountdown: "", isStaminaFull: true };
    }

    const nextRefillTs = maxTsSec - (maxStamina - live - 1) * REFILL_INTERVAL;
    const refillCd = formatRecoverCountdownFromSec(nextRefillTs - nowSec);
    const fullCountdownSec = Math.max(0, maxTsSec - nowSec);
    const fullCd = formatRecoverCountdownFromSec(fullCountdownSec);
    return { liveStamina: live, refillCountdown: refillCd, recoverCountdown: fullCd, isStaminaFull: false };
  }, [curStamina, maxStamina, maxTsSec, now]);

  const bpCur = data?.bpSystem?.curLevel ?? 0;
  const bpMax = data?.bpSystem?.maxLevel ?? 0;

  const dailyCur = data?.dailyMission?.dailyActivation ?? 0;
  const dailyMax = data?.dailyMission?.maxDailyActivation ?? 0;

  const weeklyCur = data?.weeklyMission?.score ?? 0;
  const weeklyMax = data?.weeklyMission?.total ?? 0;

  const barSections = [
    {
      label: t("card:account_progress_daily"),
      value: `${dailyCur}/${dailyMax}`,
      suffix: "",
      percent: dailyMax > 0 ? dailyCur / dailyMax : 0,
    },
    {
      label: t("card:account_progress_weekly"),
      value: `${weeklyCur}/${weeklyMax}`,
      suffix: "",
      percent: weeklyMax > 0 ? weeklyCur / weeklyMax : 0,
    },
    {
      label: t("card:account_progress_bp"),
      value: bpMax > 0 ? `${bpCur}/${bpMax}` : `${bpCur}`,
      suffix: "",
      percent: bpMax > 0 ? bpCur / bpMax : 0,
    },
  ];

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

  return (
    <>
      <GlassCard className="p-2.5  border border-separator/90 h-full w-full select-none rounded-[10px] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between gap-2 min-w-0 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <AccountAvatar
              src={currentAccount?.avatar ?? ""}
              alt={currentAccount?.nickname ?? ""}
              size="sm"
              className="rounded-md border border-separator shrink-0"
            />
            <span className="text-xs font-semibold text-foreground truncate">
              {currentAccount?.nickname || t("common.unknown")}
            </span>
          </div>
          <button
            type="button"
            onClick={openAccountSelect}
            title={t("card:account_progress_switch_account")}
            aria-label={t("card:account_progress_switch_account")}
            className="shrink-0 w-5 h-5 flex items-center justify-center rounded-md text-muted hover:text-foreground lg-hoverable transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
            </svg>
          </button>
        </div>

        <div className="flex-1 flex items-stretch gap-3 min-h-0">
          <div className="w-24 shrink-0 flex flex-col items-center justify-center gap-1 border-r border-separator/60 pr-3">
            <span className="text-[10px] text-muted">{t("card:account_progress_stamina")}</span>
            <span className="text-xl font-bold text-foreground font-mono leading-none">
              {liveStamina}
              <span className="text-[11px] font-normal text-muted">/{maxStamina}</span>
            </span>
            <span className="flex flex-col items-center gap-0.5 text-center leading-tight">
              {isStaminaFull ? (
                <span className="text-[10px] text-muted">{t("card:account_progress_full")}</span>
              ) : (
                <>
                  <span className="text-[9px] text-muted">
                    {t("card:account_progress_recover_in")}: {recoverCountdown}
                  </span>
                  <span className="text-[9px] text-muted">
                    {t("card:account_progress_next_refill")}: {refillCountdown}
                  </span>
                </>
              )}
            </span>
          </div>

          <div className="flex-1 min-w-0 flex flex-col justify-center gap-2.5 py-0.5">
            {barSections.map((s, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-[10px] text-muted truncate">{s.label}</span>
                <GlassMeter
                  aria-label={s.label}
                  value={Math.min(100, Math.max(0, Math.round(s.percent * 100)))}
                  className="flex-1 min-w-0"
                >
                  <GlassMeter.Track className="lg-inset">
                    <GlassMeter.Fill className="bg-gradient-to-r from-primary/70 to-primary" />
                  </GlassMeter.Track>
                </GlassMeter>
                <span className="w-12 shrink-0 text-right text-[11px] text-foreground font-mono truncate">
                  {s.value}
                </span>
                {s.suffix && (
                  <span className="shrink-0 text-[9px] text-muted truncate max-w-[50px] text-right">
                    {s.suffix}
                  </span>
                )}
              </div>
            ))}
          </div>
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
                    <div className="font-medium text-sm truncate">
                      {account.nickname || t("common.unknown") || "Unknown"}
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
