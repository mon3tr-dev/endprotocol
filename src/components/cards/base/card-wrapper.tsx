import { Component, Suspense, type ErrorInfo, type ReactNode } from "react";
import { GlassCard } from "@/components/ui/glass";
import { LoadingBlock } from "@/components/ui/loading-block";

interface CardWrapperProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class CardErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[CardErrorBoundary]", error, info);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || <ErrorState />;
    }
    return this.props.children;
  }
}

export function CardWrapper({ children, fallback }: CardWrapperProps) {
  return (
    <CardErrorBoundary fallback={fallback}>
      <Suspense fallback={<LoadingSkeleton />}>{children}</Suspense>
    </CardErrorBoundary>
  );
}

function LoadingSkeleton() {
  return (
    <GlassCard className="p-6  border border-separator/80">
      <LoadingBlock label="" minHeight={120} />
    </GlassCard>
  );
}

function ErrorState() {
  return (
    <GlassCard className="p-6  border border-separator/80">
      <p className="text-danger-text text-center">加载失败</p>
    </GlassCard>
  );
}
