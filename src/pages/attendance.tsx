import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  GlassCard,
  GlassProgressCircle,
  GlassButton,
  GlassSwitch,
} from "@/components/ui/glass";
import {
  getSelectedAccount,
  getAccounts,
  setSelectedAccount,
  type Account,
} from "@/utils/accountService";
import { resolveServerLabel } from "@/types";
import { AccountNameLine } from "@/components/ui/game-badge";
import { AttendanceRewards } from "@/components/cards/attendance/attendance-rewards";
import { AttendanceBatchModal } from "@/components/cards/attendance/attendance-batch-modal";
import {
  parseAttendanceData,
  rewardAt,
  type AttendanceData,
} from "@/components/cards/attendance/index";
import {
  fetchAttendanceRaw,
  resolveAttendanceGame,
  signInWithFeedback,
} from "@/utils/attendanceService";
import { CardStartupService } from "@/cards/startup-service";
import { Img } from "@/utils/imageLoader";
import { logError } from "@/utils/logger";

type SignPhase = "idle" | "spinning" | "done";

/** 批量签到图标 */
function BatchIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 14l2 2 4-4" />
    </svg>
  );
}

export default function AttendancePage() {
  const { t, i18n } = useTranslation();
  const [attendanceData, setAttendanceData] = useState<AttendanceData | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signPhase, setSignPhase] = useState<SignPhase>("idle");
  const [showBatchModal, setShowBatchModal] = useState(false);
  /**
   * 当前账户的「启动时自动签到」开关。
   *
   * 真值来自全局配置 `card_auto_sign_users`（按 roleId 记，与卡片实例无关），
   * 因此这里**必须**走 `CardStartupService`，不能用页面本地 state 当唯一来源，
   * 否则会与卡片、批量签到弹窗显示的开关值不一致。
   */
  const [autoSign, setAutoSign] = useState(false);

  /**
   * 账户列表的 ref 镜像。
   *
   * `loadData` 里要按角色的 `game` 字段分流到两个不同命令，但不能把 `accounts`
   * 放进依赖数组 —— 否则「加载账户」与「拉取签到」会互相触发、无限重拉。
   */
  const accountsRef = useRef<Account[]>([]);

  const loadData = useCallback(
    async (roleIdOverride?: string) => {
      try {
        setIsLoading(true);
        setError(null);
        const id = roleIdOverride ?? (await getSelectedAccount());
        if (!id) {
          setAttendanceData(null);
          setAccountId(null);
          return;
        }
        setAccountId(id);

        const accs = await getAccounts();
        accountsRef.current = accs;
        setAccounts(accs);

        // 两个游戏的签到接口完全不同，按角色所属游戏分流到各自的命令
        const game = resolveAttendanceGame(accs, id);
        const result = await fetchAttendanceRaw(id, game);
        const parsed = parseAttendanceData(result);
        if (!parsed) {
          setAttendanceData(null);
          setError(t("card:attendance_error"));
        } else {
          setAttendanceData(parsed);
        }

        // 自动签到开关的真值（全局配置，按 roleId）
        setAutoSign(await CardStartupService.isAutoSignEnabled(id));
      } catch (e) {
        logError("[Attendance] Failed to load page data:", e);
        setError(String(e));
      } finally {
        setIsLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const handleAccountChange = () => loadData();
    window.addEventListener("accountChanged", handleAccountChange);
    return () => window.removeEventListener("accountChanged", handleAccountChange);
  }, [loadData]);

  /**
   * 订阅自动签到变更广播。
   *
   * 只要有任何一个入口（本页开关、卡片设置弹窗、批量签到弹窗）改了某角色的
   * 自动签到，这里就会收到通知并同步 UI —— 这是「多处显示保持一致」的关键。
   */
  useEffect(() => {
    const unsubscribe = CardStartupService.onAutoSignChanged((changedRoleId, enabled) => {
      if (changedRoleId === accountId) setAutoSign(enabled);
    });
    return unsubscribe;
  }, [accountId]);

  /** 切换当前账户的自动签到（立即落盘 + 广播，其他入口随之刷新） */
  const handleToggleAutoSign = useCallback(
    async (enabled: boolean) => {
      if (!accountId) return;
      // 先乐观更新，失败再回滚，避免开关有迟滞感
      setAutoSign(enabled);
      try {
        await CardStartupService.setAutoSign(accountId, enabled);
      } catch (e) {
        logError("[Attendance] Failed to toggle auto-sign:", e);
        setAutoSign(!enabled);
      }
    },
    [accountId],
  );

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === accountId) ?? null,
    [accounts, accountId],
  );

  /** 所有可签到的角色（两个游戏都列出来，方便在同一页面切换） */
  const roleOptions = useMemo(
    () => accounts.filter((a) => a.id),
    [accounts],
  );

  const handleSignIn = useCallback(async () => {
    if (!accountId || signPhase !== "idle") return;
    // 已签到不再重复请求（后端对重复签到是幂等成功，但没必要白跑一趟）
    if (attendanceData?.hasToday) return;

    setSignPhase("spinning");
    const game = resolveAttendanceGame(accountsRef.current, accountId);
    const ok = await signInWithFeedback(accountId, game, t, async () => {
      await loadData(accountId);
    });
    setSignPhase(ok ? "done" : "idle");
    // 「完成」动画留一小段时间后回到可再次操作的状态
    if (ok) {
      setTimeout(() => setSignPhase("idle"), 1200);
    }
  }, [accountId, signPhase, attendanceData?.hasToday, t, loadData]);

  const handleSwitchRole = useCallback(
    async (roleId: string) => {
      if (roleId === accountId) return;
      await setSelectedAccount(roleId);
      setSignPhase("idle");
      await loadData(roleId);
    },
    [accountId, loadData],
  );

  const todayReward = useMemo(
    () => rewardAt(attendanceData, attendanceData?.todayIndex ?? null),
    [attendanceData],
  );
  const tomorrowReward = useMemo(
    () => rewardAt(attendanceData, attendanceData?.tomorrowIndex ?? null),
    [attendanceData],
  );

  const signedToday = Boolean(attendanceData?.hasToday);
  const canSign = Boolean(accountId) && Boolean(attendanceData) && !signedToday;
  const isSpinning = signPhase === "spinning";

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl lg:text-3xl font-bold text-foreground tracking-tight">
            {t("sidebar.attendance")}
          </h1>
          {selectedAccount && (
            <p className="text-foreground/70 mt-1.5 text-sm">
              {/* 徽标紧跟名字之后，同一行内联排版 */}
              <AccountNameLine game={selectedAccount.game}>
                {selectedAccount.nickname}
              </AccountNameLine>
              {" · "}
              {resolveServerLabel(selectedAccount.server, i18n.language)} · Lv.
              {selectedAccount.level}
            </p>
          )}
        </div>

        {/* 右上角：批量签到 */}
        <GlassButton
          variant="secondary"
          size="md"
          className="shrink-0"
          startContent={<BatchIcon />}
          onPress={() => setShowBatchModal(true)}
        >
          {t("card:attendance_batch_sign")}
        </GlassButton>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <GlassProgressCircle isIndeterminate size="lg" aria-label="Loading" className="text-primary">
            <GlassProgressCircle.Track>
              <GlassProgressCircle.TrackCircle />
              <GlassProgressCircle.FillCircle />
            </GlassProgressCircle.Track>
          </GlassProgressCircle>
        </div>
      ) : error ? (
        <GlassCard className="p-16  border border-separator/90">
          <div className="text-center text-muted">
            <p>{error}</p>
            <GlassButton className="mt-4" variant="secondary" onPress={() => loadData()}>
              {t("card:attendance_refresh")}
            </GlassButton>
          </div>
        </GlassCard>
      ) : !attendanceData ? (
        <GlassCard className="p-16  border border-separator/90">
          <div className="text-center text-muted">
            <p>{t("card:attendance_no_account")}</p>
          </div>
        </GlassCard>
      ) : (
        <>
          {/* 签到操作区：今日/明日奖励 + 签到按钮 */}
          <GlassCard className="p-6  border border-separator/90">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-6">
                <RewardSummary
                  label={t("card:attendance_today")}
                  reward={todayReward}
                  claimed={signedToday}
                />
                <div className="w-px bg-separator self-stretch" />
                <RewardSummary
                  label={t("card:attendance_tomorrow")}
                  reward={tomorrowReward}
                  claimed={false}
                />
              </div>

              <div className="flex items-center gap-3">
                <span
                  className={`text-sm font-medium ${
                    signedToday ? "text-success-text" : "text-warning-text"
                  }`}
                >
                  {t(
                    signedToday
                      ? "card:attendance_signed"
                      : "card:attendance_not_signed",
                  )}
                </span>
                <GlassButton
                  variant="primary"
                  size="md"
                  isLoading={isSpinning}
                  isDisabled={!canSign || isSpinning}
                  onPress={handleSignIn}
                >
                  {signedToday
                    ? t("card:attendance_already_signed")
                    : t("card:attendance_sign_btn")}
                </GlassButton>
                <GlassButton
                  variant="secondary"
                  size="md"
                  isDisabled={isSpinning}
                  onPress={() => loadData(accountId ?? undefined)}
                >
                  {t("card:attendance_refresh")}
                </GlassButton>
              </div>
            </div>

            {/* 自动签到开关：与卡片、批量签到弹窗共用同一份全局配置 */}
            <div className="mt-5 pt-4 border-t border-separator flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t("card:attendance_auto_sign")}</p>
                <p className="text-xs text-muted">
                  {t("card:attendance_auto_sign_persist_hint")}
                </p>
              </div>
              <GlassSwitch
                isSelected={autoSign}
                isDisabled={!accountId}
                onValueChange={(v) => void handleToggleAutoSign(v)}
              >
                <GlassSwitch.Control>
                  <GlassSwitch.Thumb />
                </GlassSwitch.Control>
              </GlassSwitch>
            </div>

            {/* 角色切换：同一通行证下有多个角色时（如官服/B服各一个）必须能切 */}
            {roleOptions.length > 1 && (
              <div className="mt-5 pt-4 border-t border-separator">
                <p className="text-xs text-muted mb-2">
                  {t("card:attendance_select_account")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {roleOptions.map((role) => {
                    const active = role.id === accountId;
                    return (
                      <button
                        key={role.id}
                        type="button"
                        onClick={() => handleSwitchRole(role.id)}
                        disabled={isSpinning}
                        className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 ${
                          active
                            ? "border-primary text-foreground"
                            : "border-separator text-muted hover:text-foreground"
                        }`}
                      >
                        <span className="flex items-center">
                          <AccountNameLine game={role.game}>
                            {role.nickname}
                          </AccountNameLine>
                        </span>
                        <span className="opacity-70">
                          {resolveServerLabel(role.server, i18n.language)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </GlassCard>

          <GlassCard className="p-6  border border-separator/90">
            <AttendanceRewards attendanceData={attendanceData} />
          </GlassCard>
        </>
      )}

      <AttendanceBatchModal
        isOpen={showBatchModal}
        onClose={() => setShowBatchModal(false)}
        onSigned={() => loadData(accountId ?? undefined)}
      />
    </div>
  );
}

/** 一处奖励的简要展示（图标 + 名称 + 数量） */
function RewardSummary({
  label,
  reward,
  claimed,
}: {
  label: string;
  reward: { name: string; icon: string; count: number } | null;
  claimed: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted mb-1.5">{label}</p>
      {reward ? (
        <div className={`flex items-center gap-2.5 ${claimed ? "opacity-45" : ""}`}>
          <div className="relative w-10 h-10 shrink-0">
            <Img
              src={reward.icon}
              alt={reward.name}
              className="w-full h-full object-contain rounded"
            />
            {claimed && (
              <div className="absolute inset-0 flex items-center justify-center">
                <svg
                  className="w-7 h-7 text-default-700"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={3}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            )}
          </div>
          <div className="min-w-0 leading-tight">
            <p className="text-sm font-medium truncate">{reward.name}</p>
            <p className="text-xs text-muted">x{reward.count}</p>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted">--</p>
      )}
    </div>
  );
}
