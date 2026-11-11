import { useCallback, useEffect, useMemo, useState } from "react";
import { GlassButton, GlassCard, GlassMeter, GlassProgressCircle } from "@/components/ui/glass";
import { useTranslation } from "react-i18next";
import { BaseCardProps } from "../registry/types";
import { useCardData } from "../base/use-card-data";
import { roleDataService } from "@/utils/roleDataService";
import { CardConfigService } from "@/utils/cardConfigService";
import { getAccounts } from "@/utils/accountService";
import { resolveRoleGame } from "@/utils/roleGame";
import { invoke } from "@tauri-apps/api/core";
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
import type { AccountProgressCardSettings } from "@/types/card-settings";

export interface DungeonData {
  curStamina?: string;
  maxTs?: string;
  maxStamina?: string;
  /** 恢复 1 点所需的秒数。终末地 432，明日方舟 360；不填按 432 */
  refillInterval?: number;
}

export interface ProgressData {
  dungeon?: DungeonData;
  bpSystem?: { curLevel?: number; maxLevel?: number };
  dailyMission?: { dailyActivation?: number; maxDailyActivation?: number };
  weeklyMission?: { score?: number; total?: number };
  /**
   * 数据来源游戏。决定第三根进度条显示什么：
   * - 终末地：通行证等级（bpSystem）
   * - 明日方舟：剿灭作战进度（campaign）—— 明日方舟没有通行证系统
   */
  variant?: "endfield" | "arknights";
  /** 明日方舟的剿灭进度（仅 variant === "arknights" 时使用） */
  campaign?: { current?: number; total?: number };
}

/** 终末地的体力恢复节奏：1 点 / 432 秒（7 分 12 秒）。 */
const ENDFIELD_AP_REFILL_SECONDS = 432;
/** 明日方舟的理智恢复节奏：1 点 / 360 秒（6 分钟）。 */
const ARKNIGHTS_AP_REFILL_SECONDS = 360;

function formatRecoverCountdownFromSec(totalSeconds: number): string {
  if (totalSeconds <= 0) return "00:00:00";
  const sec = Math.floor(totalSeconds);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * 把《明日方舟》的 `player/info` 折成卡片认识的 `ProgressData`。
 *
 * 对应关系：
 * - 理智 `status.ap` → `dungeon.curStamina/maxStamina`（明日方舟也叫理智，数值语义一致）
 * - 日常 `routine.daily` → `dailyMission`（当前/上限）
 * - 周常 `routine.weekly` → `weeklyMission`（已完成/总数）
 * - 剿灭 `campaign.reward` → `campaign`（明日方舟没有通行证等级，剿灭进度占第三根条）
 *
 * 体力恢复：明日方舟 1 点 / 6 分钟（360 秒），终末地是 1 点 / 7 分 12 秒（432 秒），
 * 两者节奏不同，因此节奏随数据一起带过去，不能写死。
 */
function mapArknightsProgress(info: any): ProgressData {
  const status = info?.status ?? {};
  const ap = status.ap ?? {};
  const routine = info?.routine ?? {};
  const campaign = info?.campaign?.reward ?? {};

  const max = Number(ap.max ?? 0);
  const current = Number(ap.current ?? 0);

  // 距回满的剩余秒数：优先用接口给的回满时间戳
  const completeRecovery = Number(ap.completeRecoveryTime ?? 0);
  let recoverSecs = 0;
  if (completeRecovery > 0) {
    recoverSecs = Math.max(0, completeRecovery - Math.floor(Date.now() / 1000));
  } else if (max > current) {
    // 没有回满时间戳时，按缺口 × 单点恢复时间估算
    recoverSecs = (max - current) * ARKNIGHTS_AP_REFILL_SECONDS;
  }

  return {
    variant: "arknights",
    dungeon: {
      curStamina: String(current),
      maxStamina: String(max),
      // 距回满的秒数（卡片自己换算成倒计时）
      maxTs: String(Math.floor(Date.now() / 1000) + recoverSecs),
      refillInterval: ARKNIGHTS_AP_REFILL_SECONDS,
    },
    dailyMission: {
      dailyActivation: Number(routine.daily?.current ?? 0),
      maxDailyActivation: Number(routine.daily?.total ?? 0),
    },
    weeklyMission: {
      score: Number(routine.weekly?.current ?? 0),
      total: Number(routine.weekly?.total ?? 0),
    },
    campaign: {
      current: Number(campaign.current ?? 0),
      total: Number(campaign.total ?? 0),
    },
  };
}

/** 按角色所属的游戏取「账户进度」。 */
async function fetchAccountProgress(roleId: string): Promise<ProgressData> {
  const game = await resolveRoleGame(roleId);
  if (game === "arknights") {
    const info = await invoke<any>("get_arknights_player_info", {
      roleId,
      force: false,
    });
    return mapArknightsProgress(info);
  }
  const result = await roleDataService.queryData(roleId, "char_detail", [
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

  const { data, isLoading, refetch: refetchProgress } =
    useCardData<ProgressData>({
      fetchData: () => fetchAccountProgress(effectiveRoleId),
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
      setAccounts(filterAccountsForCard(accs, "account_progress"));
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
      setAccounts(filterAccountsForCard(accs, "account_progress"));
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
        void refetchProgress(true);
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

  // 恢复节奏随数据源而定：终末地 432 秒/点，明日方舟 360 秒/点
  const REFILL_INTERVAL =
    data?.dungeon?.refillInterval ?? ENDFIELD_AP_REFILL_SECONDS;

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
  }, [curStamina, maxStamina, maxTsSec, now, REFILL_INTERVAL]);

  const bpCur = data?.bpSystem?.curLevel ?? 0;
  const bpMax = data?.bpSystem?.maxLevel ?? 0;

  const dailyCur = data?.dailyMission?.dailyActivation ?? 0;
  const dailyMax = data?.dailyMission?.maxDailyActivation ?? 0;

  const weeklyCur = data?.weeklyMission?.score ?? 0;
  const weeklyMax = data?.weeklyMission?.total ?? 0;

  // 第三根条按游戏切换内容：明日方舟没有通行证等级，改显示剿灭作战进度
  const isArknights = data?.variant === "arknights";
  const campaignCur = data?.campaign?.current ?? 0;
  const campaignMax = data?.campaign?.total ?? 0;

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
    isArknights
      ? {
          label: t("card:account_progress_campaign"),
          value: `${campaignCur}/${campaignMax}`,
          suffix: "",
          percent: campaignMax > 0 ? campaignCur / campaignMax : 0,
        }
      : {
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
              <AccountNameLine game={currentAccount?.game}>
                {currentAccount?.nickname || t("common.unknown")}
              </AccountNameLine>
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
