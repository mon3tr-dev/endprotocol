import { Component, type ErrorInfo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { GlassButton } from "@/components/ui/glass";
import { EmptyStateUserIcon } from "@/components/ui/empty-state";
import { reportCrash } from "@/utils/crashReporting";
import i18n from "@/i18n";

type ErrorFallbackRenderer = (error: Error, reset: () => void) => ReactNode;

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ErrorFallbackRenderer;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

/**
 * 应用级 Error Boundary
 * 任何子组件抛出未捕获错误时显示 fallback，并写入崩溃日志。
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportCrash({
      title: i18n.t("crash.title"),
      message: error.message || String(error),
      stack: [error.stack, info.componentStack].filter(Boolean).join("\n\n"),
      source: "react",
      fatal: true,
    });
    this.props.onError?.(error, info);
  }

  reset = () => this.setState({ hasError: false, error: undefined });

  render() {
    if (this.state.hasError) {
      const { fallback } = this.props;
      if (typeof fallback === "function") {
        return fallback(this.state.error ?? new Error("Unknown error"), this.reset);
      }
      if (fallback) return fallback;
      return (
        <DefaultErrorFallback
          error={this.state.error}
          onReset={this.reset}
        />
      );
    }
    return this.props.children;
  }
}

function DefaultErrorFallback({
  error,
  onReset,
}: {
  error?: Error;
  onReset: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-4">
        <EmptyStateUserIcon className="mx-auto w-16 h-16 text-danger" />
        <h2 className="text-xl font-semibold text-foreground">
          {t("crash.title")}
        </h2>
        <p className="text-sm text-muted">
          {error?.message || t("crash.cause_unknown")}
        </p>
        <GlassButton variant="primary" onPress={onReset}>
          {t("crash.action_reload")}
        </GlassButton>
      </div>
    </div>
  );
}
