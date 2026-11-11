import { useState, useEffect, useCallback, useMemo } from "react";
import {
  GlassButton,
  GlassProgressCircle,
  GlassSwitch,
  GlassCheckbox,
} from "@/components/ui/glass";
import {
  CustomModal,
  CustomModalHeader,
  CustomModalBody,
  CustomModalFooter,
} from "@/components/custom-modal";
import { useTranslation } from "react-i18next";
import { getAccounts, type Account } from "@/utils/accountService";
import {
  fetchAttendanceStates,
  performBatchAttendance,
  type RoleAttendanceState,
} from "@/utils/attendanceService";
import { CardStartupService } from "@/cards/startup-service";
import { Img } from "@/utils/imageLoader";
import { resolveServerLabel } from "@/types";
import { AccountNameLine } from "@/components/ui/game-badge";
import { addMessage } from "@/utils/messageStore";
import { logError } from "@/utils/logger";

interface AttendanceBatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 签到完成后回调（页面/卡片据此刷新各自的数据） */
  onSigned?: () => void;
}

type Phase = "idle" | "signing" | "done";

/**
 * 批量签到弹窗。
 *
 * # 三件事
 *
 * 1. **多选未签到账户一起签到**：进弹窗先并发查一遍每个角色的今日状态，
 *    已签到的置灰不可选，未签到的默认勾选。
 * 2. **每个账号一个自动签到开关**：开关直接读写 `card_auto_sign_users`
 *    （经 `CardStartupService`），这是全局配置，**与是否有签到卡片无关**。
 * 3. **单一真值同步**：开关变更后 `setAutoSign` 会广播给所有
 *    `onAutoSignChanged` 监听者 —— 签到卡片、签到页面都会收到并刷新，
 *    因此多处显示的开关值始终保持一致。
 */
export function AttendanceBatchModal({
  isOpen,
  onClose,
  onSigned,
}: AttendanceBatchModalProps) {
  const { t, i18n } = useTranslation();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [states, setStates] = useState<Record<string, RoleAttendanceState>>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** 本地开关镜像：roleId → 是否自动签到 */
  const [autoSign, setAutoSign] = useState<Record<string, boolean>>({});
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [resultSummary, setResultSummary] = useState<{ ok: number; total: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setResultSummary(null);
    setPhase("idle");
    try {
      const accs = await getAccounts();
      // 只保留可用账户（两个游戏都支持签到）
      const valid = accs.filter(
        (a) => a.id && (a.status === "online" || a.status === "offline"),
      );
      setAccounts(valid);

      const autoSignList = await CardStartupService.getAutoSignUsers();
      const map: Record<string, boolean> = {};
      for (const acc of valid) map[acc.id] = autoSignList.includes(acc.id);
      setAutoSign(map);

      // 并发查询今日状态
      const fetched = await fetchAttendanceStates(
        valid,
        valid.map((a) => a.id),
      );
      setStates(fetched);

      // 默认勾选「确实未签到」的账户
      const unsigned = valid
        .filter((a) => fetched[a.id]?.signed === false)
        .map((a) => a.id);
      setSelected(new Set(unsigned));
    } catch (e) {
      logError("[AttendanceBatch] load failed:", e);
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void load();
  }, [isOpen, load]);

  /** 账号按「未签到 → 已签到 → 未知」排序，未签到排前面更好操作 */
  const sortedAccounts = useMemo(() => {
    const rank = (acc: Account) => {
      const s = states[acc.id]?.signed;
      if (s === false) return 0;
      if (s === true) return 1;
      return 2;
    };
    return [...accounts].sort((a, b) => rank(a) - rank(b));
  }, [accounts, states]);

  const unsignedIds = useMemo(
    () => sortedAccounts.filter((a) => states[a.id]?.signed === false).map((a) => a.id),
    [sortedAccounts, states],
  );

  const toggleSelect = useCallback((roleId: string, next: boolean) => {
    setSelected((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(roleId);
      else copy.delete(roleId);
      return copy;
    });
  }, []);

  const selectAllUnsigned = useCallback(() => {
    setSelected(new Set(unsignedIds));
  }, [unsignedIds]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  /** 切换某个账户的自动签到（立即落盘 + 广播，实现跨处同步） */
  const toggleAutoSign = useCallback(
    async (roleId: string, enabled: boolean) => {
      setAutoSign((prev) => ({ ...prev, [roleId]: enabled }));
      try {
        await CardStartupService.setAutoSign(roleId, enabled);
      } catch (e) {
        logError("[AttendanceBatch] setAutoSign failed:", e);
        // 回滚 UI，避免显示与服务端不一致
        setAutoSign((prev) => ({ ...prev, [roleId]: !enabled }));
      }
    },
    [],
  );

  const handleBatchSign = useCallback(async () => {
    const roleIds = Array.from(selected);
    if (roleIds.length === 0) return;

    setPhase("signing");
    setProgress({ done: 0, total: roleIds.length });
    try {
      // 后端串行执行，这里拿不到中间进度；先按「全部完成」收尾，
      // 进度条用于表示「进行中」，完成后展示汇总。
      setProgress({ done: 0, total: roleIds.length });
      const items = await performBatchAttendance(roleIds);
      const ok = items.filter((i) => i.ok).length;

      setProgress({ done: roleIds.length, total: roleIds.length });
      setResultSummary({ ok, total: roleIds.length });
      setPhase("done");

      // 汇总提示：全成功发 info，有失败发 urgent 并带上失败原因
      const failures = items.filter((i) => !i.ok && i.error);
      if (failures.length === 0) {
        addMessage({
          type: "info",
          title: t("card:attendance_batch_done", {
            ok,
            total: roleIds.length,
          }),
          tag: "attendance",
        });
      } else {
        addMessage({
          type: "urgent",
          title: t("card:attendance_batch_done", {
            ok,
            total: roleIds.length,
          }),
          body: failures.map((f) => `${f.roleId}: ${f.error}`).join("\n"),
          tag: "attendance",
        });
      }

      // 刷新这几行的状态
      const refreshed = await fetchAttendanceStates(accounts, roleIds);
      setStates((prev) => ({ ...prev, ...refreshed }));
      setSelected(new Set());

      onSigned?.();
    } catch (e) {
      logError("[AttendanceBatch] batch sign failed:", e);
      addMessage({
        type: "urgent",
        title: t("card:attendance_sign_failed"),
        body: String(e),
        tag: "attendance",
      });
      setPhase("idle");
    }
  }, [selected, accounts, t, onSigned]);

  const handleClose = () => {
    if (phase === "signing") return; // 签到时不允许中途关闭
    onClose();
  };

  const lang = i18n.language;
  const selectedCount = selected.size;
  const allUnsignedSelected =
    unsignedIds.length > 0 && unsignedIds.every((id) => selected.has(id));

  return (
    <CustomModal isOpen={isOpen} onClose={handleClose} size="lg">
      <CustomModalHeader onClose={handleClose}>
        {t("card:attendance_batch_title")}
      </CustomModalHeader>
      <CustomModalBody>
        {loading ? (
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <GlassProgressCircle
              isIndeterminate
              size="md"
              aria-label={t("card:attendance_batch_loading")}
              className="text-primary"
            >
              <GlassProgressCircle.Track>
                <GlassProgressCircle.TrackCircle />
                <GlassProgressCircle.FillCircle />
              </GlassProgressCircle.Track>
            </GlassProgressCircle>
            <p className="text-xs text-muted">{t("card:attendance_batch_loading")}</p>
          </div>
        ) : accounts.length === 0 ? (
          <div className="text-center py-8 text-muted text-sm">
            {t("card:attendance_no_account")}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-muted">{t("card:attendance_batch_desc")}</p>

            {/* 批量操作条 */}
            <div className="flex items-center gap-2 flex-wrap">
              <GlassButton
                size="sm"
                variant="secondary"
                isDisabled={phase === "signing" || unsignedIds.length === 0}
                onPress={allUnsignedSelected ? clearSelection : selectAllUnsigned}
              >
                {allUnsignedSelected
                  ? t("card:attendance_batch_clear")
                  : t("card:attendance_batch_select_all")}
              </GlassButton>
              <span className="text-xs text-muted">
                {t("card:attendance_batch_sign_selected", { count: selectedCount })}
              </span>
              {resultSummary && (
                <span className="ml-auto text-xs text-success-text">
                  {t("card:attendance_batch_done", {
                    ok: resultSummary.ok,
                    total: resultSummary.total,
                  })}
                </span>
              )}
            </div>

            {/* 账户列表 */}
            <div className="space-y-2 max-h-[46vh] overflow-y-auto pr-1">
              {sortedAccounts.map((acc) => {
                const state = states[acc.id];
                const signed = state?.signed;
                const isChecked = selected.has(acc.id);
                const autoOn = Boolean(autoSign[acc.id]);
                const disabled = signed !== false || phase === "signing";

                return (
                  <div
                    key={acc.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border ${
                      isChecked
                        ? "border-primary bg-primary-50 dark:bg-primary-900/30"
                        : "border-separator"
                    }`}
                  >
                    {/* 多选：只有「确认未签到」的账户可选 */}
                    <GlassCheckbox
                      isSelected={isChecked}
                      disabled={disabled}
                      onValueChange={(v) => toggleSelect(acc.id, v)}
                    />

                    <div className="w-9 h-9 rounded-lg overflow-hidden shrink-0">
                      {acc.avatar ? (
                        <Img
                          src={acc.avatar}
                          alt={acc.nickname}
                          className="w-full h-full avatar-feather"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted text-sm font-semibold">
                          {acc.nickname.charAt(0)}
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium min-w-0 truncate">
                        <AccountNameLine game={acc.game}>{acc.nickname}</AccountNameLine>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted">
                        <span>{resolveServerLabel(acc.server, lang)}</span>
                        <span>Lv.{acc.level}</span>
                        <span
                          className={
                            signed === true
                              ? "text-success-text"
                              : signed === false
                                ? "text-warning-text"
                                : "text-muted"
                          }
                        >
                          {signed === true
                            ? t("card:attendance_signed")
                            : signed === false
                              ? t("card:attendance_not_signed")
                              : state?.error
                                ? t("card:attendance_batch_query_failed")
                                : t("card:attendance_batch_unknown_state")}
                        </span>
                      </div>
                    </div>

                    {/* 每个账户独立的自动签到开关（与卡片/页面共享同一配置） */}
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] text-muted hidden sm:inline">
                        {t("card:attendance_auto_sign")}
                      </span>
                      <GlassSwitch
                        isSelected={autoOn}
                        onValueChange={(v) => void toggleAutoSign(acc.id, v)}
                      >
                        <GlassSwitch.Control>
                          <GlassSwitch.Thumb />
                        </GlassSwitch.Control>
                      </GlassSwitch>
                    </div>
                  </div>
                );
              })}
            </div>

            <p className="text-[11px] text-muted">
              {t("card:attendance_auto_sign_persist_hint")}
            </p>
          </div>
        )}
      </CustomModalBody>
      <CustomModalFooter>
        <GlassButton variant="secondary" onPress={handleClose} isDisabled={phase === "signing"}>
          {t("common.close")}
        </GlassButton>
        <GlassButton
          variant="primary"
          isLoading={phase === "signing"}
          isDisabled={selectedCount === 0 || phase === "signing" || loading}
          onPress={handleBatchSign}
        >
          {phase === "signing"
            ? t("card:attendance_batch_signing", {
                done: progress.done,
                total: progress.total,
              })
            : t("card:attendance_batch_sign_selected", { count: selectedCount })}
        </GlassButton>
      </CustomModalFooter>
    </CustomModal>
  );
}
