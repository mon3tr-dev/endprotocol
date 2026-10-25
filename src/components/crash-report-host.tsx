import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { MorphIcon } from "morphicons/react";
import { AlertTriangle, Copy, Download, FolderOpen, RotateCcw, UserRound, X } from "lucide";
import { GlassAlert, GlassButton } from "@/components/ui/glass";
import { GlassModalCompound as GlassModal } from "@/components/ui/modal";
import {
  acknowledgeCrashReports,
  exportDiagnostics,
  openLogDirectory,
  revealDiagnostics,
} from "@/utils/diagnostics";
import {
  type CrashReport,
  diagnoseCrash,
  dismissCrashReport,
  formatCrashReport,
  getCurrentCrashReport,
  loadPendingCrashReports,
  subscribeCrashReports,
} from "@/utils/crashReporting";

function useCrashReportState(): CrashReport | null {
  const [report, setReport] = useState<CrashReport | null>(() =>
    getCurrentCrashReport(),
  );

  useEffect(() => {
    const unsubscribe = subscribeCrashReports(() => {
      setReport(getCurrentCrashReport());
    });
    void loadPendingCrashReports();
    return unsubscribe;
  }, []);

  return report;
}

interface CrashDetailsProps {
  report: CrashReport;
}

export function CrashDetails({ report }: CrashDetailsProps) {
  const { t } = useTranslation();
  const diagnosis = useMemo(() => diagnoseCrash(report), [report]);
  const clockSkewMinutes =
    report.api?.clock_skew_seconds != null
      ? Math.max(1, Math.round(Math.abs(report.api.clock_skew_seconds) / 60))
      : null;
  const summary = report.api && report.detail ? report.detail : report.message;
  const technicalDetails = [
    `${t("crash.details_message")}: ${report.message}`,
    report.detail ? `${t("crash.details_detail")}: ${report.detail}` : "",
    report.stack
      ? `${t("crash.details_stack")}:\n${report.stack}`
      : "",
    report.api
      ? `${t("crash.details_api")}:\n${JSON.stringify(report.api, null, 2)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-danger/10 text-danger">
          <MorphIcon icon={AlertTriangle} size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-relaxed text-foreground">{summary}</p>
          <p className="mt-1 text-[11px] text-muted">
            {t("crash.time_label")}:{" "}
            {new Date(report.timestamp).toLocaleString()}
          </p>
        </div>
      </div>

      {clockSkewMinutes != null && (
        <GlassAlert status="warning">
          <GlassAlert.Indicator />
          <GlassAlert.Content>
            <GlassAlert.Description>
              {t("crash.api_clock_body", { minutes: clockSkewMinutes })}
            </GlassAlert.Description>
          </GlassAlert.Content>
        </GlassAlert>
      )}

      {report.api?.kind === "device_fingerprint" && (
        <GlassAlert status="warning">
          <GlassAlert.Indicator />
          <GlassAlert.Content>
            <GlassAlert.Description>
              {t("crash.api_fingerprint_body", {
                count: report.api.consecutive_failures,
              })}
            </GlassAlert.Description>
          </GlassAlert.Content>
        </GlassAlert>
      )}

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
          {t("crash.diagnosis_title")}
        </h3>
        <p className="mt-1.5 text-sm leading-relaxed text-foreground">
          {t(diagnosis.causeKey)}
        </p>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
          {t("crash.suggestions_title")}
        </h3>
        <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm leading-relaxed text-foreground/85">
          {diagnosis.suggestionKeys.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
      </div>

      {technicalDetails && (
        <details className="rounded-xl border border-separator/70 bg-default-100/30">
          <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted transition-colors hover:text-foreground">
            {t("crash.show_details")}
          </summary>
          <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all border-t border-separator/60 p-3 text-[11px] leading-relaxed text-muted">
            {technicalDetails}
          </pre>
        </details>
      )}
    </div>
  );
}

interface CrashActionBarProps {
  report: CrashReport;
  primaryLabel?: string;
  onPrimary?: () => void;
  onClose?: () => void;
  onQuit?: () => void;
}

export function CrashActionBar({
  report,
  primaryLabel,
  onPrimary,
  onClose,
  onQuit,
}: CrashActionBarProps) {
  const { t } = useTranslation();
  const [isExporting, setIsExporting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(formatCrashReport(report));
      setStatus(t("crash.action_copied"));
    } catch (error) {
      setStatus(t("crash.copy_failed", { error: String(error) }));
    }
  }, [report, t]);

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    setStatus(t("crash.action_exporting"));
    try {
      const path = await exportDiagnostics(formatCrashReport(report));
      await revealDiagnostics(path);
      setStatus(`${t("crash.action_exported")}: ${path}`);
    } catch (error) {
      setStatus(t("crash.export_failed", { error: String(error) }));
    } finally {
      setIsExporting(false);
    }
  }, [report, t]);

  const handleOpenLogs = useCallback(async () => {
    try {
      await openLogDirectory();
    } catch (error) {
      setStatus(t("crash.log_dir_failed", { error: String(error) }));
    }
  }, [t]);

  return (
    <div className="space-y-2.5">
      {status && (
        <p
          role="status"
          className="break-all text-[11px] leading-relaxed text-muted"
        >
          {status}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">        <GlassButton
          variant="outline"
          size="sm"
          onPress={handleCopy}
          startContent={<MorphIcon icon={Copy} size={14} />}
        >
          {t("crash.action_copy")}
        </GlassButton>
        <GlassButton
          variant="outline"
          size="sm"
          onPress={handleExport}
          isDisabled={isExporting}
          isLoading={isExporting}
          startContent={
            isExporting ? undefined : <MorphIcon icon={Download} size={14} />
          }
        >
          {isExporting
            ? t("crash.action_exporting")
            : t("crash.action_export")}
        </GlassButton>
        <GlassButton
          variant="outline"
          size="sm"
          onPress={handleOpenLogs}
          startContent={<MorphIcon icon={FolderOpen} size={14} />}
        >
          {t("crash.action_open_logs")}
        </GlassButton>
        {onQuit && (
          <GlassButton variant="danger" size="sm" onPress={onQuit}>
            {t("crash.action_quit")}
          </GlassButton>
        )}
        {onClose && (
          <GlassButton
            variant="tertiary"
            size="sm"
            onPress={onClose}
            startContent={<MorphIcon icon={X} size={14} />}
          >
            {t("crash.action_close")}
          </GlassButton>
        )}
        {onPrimary && (
          <GlassButton
            variant="primary"
            size="sm"
            onPress={onPrimary}
            startContent={<MorphIcon icon={RotateCcw} size={14} />}
          >
            {primaryLabel ?? t("crash.action_reload")}
          </GlassButton>
        )}
      </div>
    </div>
  );
}

/** 全局崩溃/API 熔断提示宿主，挂载在 Provider 内。 */
export function CrashReportHost() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const report = useCrashReportState();

  const dismiss = useCallback(() => {
    const paths = getCurrentCrashReport()?.crashPaths;
    dismissCrashReport();
    if (paths?.length) {
      void acknowledgeCrashReports(paths).catch(() => {
        // 忽略：下次启动会再次提示。
      });
    }
  }, []);

  if (!report) return null;

  const handlePrimary = () => {
    if (report.crashPaths?.length) {
      void acknowledgeCrashReports(report.crashPaths).catch(() => {
        // 忽略：下次启动会再次提示。
      });
    }
    if (report.source === "api") {
      void (async () => {
        try {
          await invoke("reset_api_health");
        } catch {
          // 即使重置失败也尝试重新加载。
        }
        window.location.reload();
      })();
      return;
    }
    window.location.reload();
  };

  const handleGoToAccount = () => {
    dismiss();
    void navigate("/account");
  };

  return (
    <GlassModal
      isOpen
      onOpenChange={(open) => {
        if (!open && !report.fatal) dismiss();
      }}
    >
      <GlassModal.Backdrop isDismissable={!report.fatal} className="z-[150]">
        <GlassModal.Container size="lg" placement="center" scroll="outside">
          <GlassModal.Dialog className="glass-surface-strong border border-separator/90 p-0">
            <GlassModal.Header className="px-6 pt-5 pb-2">
              <GlassModal.Heading>{report.title}</GlassModal.Heading>
            </GlassModal.Header>
            <GlassModal.Body className="max-h-[62vh] px-6 py-2">
              <CrashDetails report={report} />
            </GlassModal.Body>
            <GlassModal.Footer className="border-t border-separator px-6 py-4">
              <div className="flex w-full flex-wrap items-center justify-end gap-2">
                {report.source === "api" && (
                  <GlassButton
                    variant="outline"
                    size="sm"
                    onPress={handleGoToAccount}
                    startContent={<MorphIcon icon={UserRound} size={14} />}
                  >
                    {t("crash.action_go_account")}
                  </GlassButton>
                )}
                <CrashActionBar
                  report={report}
                  primaryLabel={
                    report.source === "api"
                      ? t("crash.action_retry")
                      : t("crash.action_reload")
                  }
                  onPrimary={handlePrimary}
                  onClose={report.fatal ? undefined : dismiss}
                  onQuit={
                    report.source === "backend-panic" && report.fatal
                      ? () => {
                          void invoke("app_quit");
                        }
                      : undefined
                  }
                />
              </div>
            </GlassModal.Footer>
          </GlassModal.Dialog>
        </GlassModal.Container>
      </GlassModal.Backdrop>
    </GlassModal>
  );
}
