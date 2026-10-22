import { ErrorBoundary } from "@/components/ui/error-boundary";
import { GlobalErrorFallback } from "@/components/ui/global-error-fallback";
import { GlobalAlertHost } from "@/components/ui/global-alert";
import { ConfirmDialogHost } from "@/components/ui/confirm-dialog";
import { CrashReportHost } from "@/components/crash-report-host";

interface ProviderProps {
  children: React.ReactNode;
}

export function Provider({ children }: ProviderProps) {
  return (
    <ErrorBoundary
      fallback={(error) => <GlobalErrorFallback error={error} />}
    >
      <GlobalAlertHost />
      <ConfirmDialogHost />
      <CrashReportHost />
      {children}
    </ErrorBoundary>
  );
}
