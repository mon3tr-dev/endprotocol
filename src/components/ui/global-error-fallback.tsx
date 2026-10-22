import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import {
  CrashActionBar,
  CrashDetails,
} from "@/components/crash-report-host";
import type { CrashReport } from "@/utils/crashReporting";

/** 应用根 ErrorBoundary 兜底 */
export function GlobalErrorFallback({ error }: { error: Error }) {
  const { t } = useTranslation();
  const report = useMemo<CrashReport>(
    () => ({
      id: 0,
      title: t("crash.title"),
      message: error.message || String(error),
      stack: error.stack,
      source: "react",
      timestamp: new Date().toISOString(),
      fatal: true,
    }),
    [error, t],
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-2xl space-y-5 rounded-2xl border border-separator/90 bg-surface p-6 shadow-xl">
        <h1 className="text-xl font-bold text-foreground">{report.title}</h1>
        <CrashDetails report={report} />
        <div className="border-t border-separator pt-4">
          <CrashActionBar
            report={report}
            primaryLabel={t("crash.action_reload")}
            onPrimary={() => window.location.reload()}
            onQuit={() => {
              void invoke("app_quit");
            }}
          />
        </div>
      </div>
    </div>
  );
}
