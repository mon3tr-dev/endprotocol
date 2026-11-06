import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { GlassCard, GlassProgressCircle } from "@/components/ui/glass";
import { invoke } from "@tauri-apps/api/core";
import { getSelectedAccount, getAccounts, type Account } from "@/utils/accountService";
import { resolveServerLabel } from "@/types";
import { AttendanceRewards } from "@/components/cards/attendance/attendance-rewards";
import { parseAttendanceData, type AttendanceData } from "@/components/cards/attendance/index";
import { logError } from "@/utils/logger";

export default function AttendancePage() {
  const { t, i18n } = useTranslation();
  const [attendanceData, setAttendanceData] = useState<AttendanceData | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const id = await getSelectedAccount();
      if (!id) {
        setAttendanceData(null);
        setAccountId(null);
        setIsLoading(false);
        return;
      }
      setAccountId(id);
      const accs = await getAccounts();
      setAccounts(accs);
      const result = await invoke<any>("get_attendance", { roleId: id });
      const parsed = parseAttendanceData(result);
      if (!parsed) {
        setAttendanceData(null);
        setError(t("card:attendance_error"));
      } else {
        setAttendanceData(parsed);
      }
    } catch (e) {
      logError("[Attendance] Failed to load page data:", e);
      setError(String(e));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const handleAccountChange = () => loadData();
    window.addEventListener("accountChanged", handleAccountChange);
    return () => window.removeEventListener("accountChanged", handleAccountChange);
  }, [loadData]);

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === accountId) ?? null,
    [accounts, accountId],
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold text-foreground tracking-tight">
          {t("sidebar.attendance")}
        </h1>
        {selectedAccount && (
          <p className="text-foreground/70 mt-1.5 text-sm">
            {selectedAccount.nickname} ·{" "}
            {resolveServerLabel(selectedAccount.server, i18n.language)} · Lv.
            {selectedAccount.level}
          </p>
        )}
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
          </div>
        </GlassCard>
      ) : !attendanceData ? (
        <GlassCard className="p-16  border border-separator/90">
          <div className="text-center text-muted">
            <p>{t("card:attendance_no_account")}</p>
          </div>
        </GlassCard>
      ) : (
        <GlassCard className="p-6  border border-separator/90">
          <AttendanceRewards attendanceData={attendanceData} />
        </GlassCard>
      )}
    </div>
  );
}
