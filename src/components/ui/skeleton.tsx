import { cn } from "@/lib/utils";

export interface GlassSkeletonProps extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * Skeleton — 内容层占位（纯色 + 不透明度脉冲，零模糊零位移）。
 */
function Skeleton({ className, ...rest }: GlassSkeletonProps) {
  const hasBg = className?.includes("bg-") ?? false;
  return (
    <div
      aria-hidden
      className={cn(
        "animate-pulse rounded-lg",
        !hasBg && "bg-muted",
        className,
      )}
      {...rest}
    />
  );
}

const GlassSkeleton = Skeleton;

export { Skeleton, GlassSkeleton };
