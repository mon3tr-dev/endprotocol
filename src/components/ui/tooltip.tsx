import { cn } from "@/lib/utils";
import { useSupportsHover } from "@/hooks/useMediaQuery";

export interface GlassTooltipProps extends React.HTMLAttributes<HTMLSpanElement> {
  delay?: number;
}

function GlassTooltip({ className, children, ...rest }: GlassTooltipProps) {
  return (
    <span className={cn("group relative inline-flex", className)} {...rest}>
      {children}
    </span>
  );
}

function TooltipContent({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  // 触屏上没有悬停，tooltip 永远不显形 —— 而且它的绝对定位层会盖住
  // 触发元素下方的一小片区域，手指点上去时可能被它接住（pointer-events
  // 虽然是 none，但仍然会改变点击落点）。
  // 直接不渲染：手机上「点一下提示条」不是可用的交互方式。
  const canHover = useSupportsHover();
  if (!canHover) return null;

  return (
    <span
      role="tooltip"
      className={cn(
        "lg-regular pointer-events-none absolute -top-1.5 left-1/2 z-50 -translate-x-1/2 -translate-y-full",
        "whitespace-nowrap rounded-lg border border-separator/60 px-2.5 py-1.5",
        "text-xs text-foreground opacity-0",
        // base 档 + emphasized：淡入与上浮 8px（--lg-shift-1）同步
        "[transition:opacity_var(--lg-dur-base)_var(--lg-ease-emphasized),transform_var(--lg-dur-base)_var(--lg-ease-emphasized),translate_var(--lg-dur-base)_var(--lg-ease-emphasized),scale_var(--lg-dur-base)_var(--lg-ease-emphasized)]",
        "group-hover:opacity-100 group-hover:-translate-y-[calc(100%+var(--lg-shift-1)/2)]",
        className,
      )}
    >
      {children}
    </span>
  );
}

GlassTooltip.Content = TooltipContent;

interface TooltipProps extends React.HTMLAttributes<HTMLSpanElement> {}

function Tooltip({ className, children, ...rest }: TooltipProps) {
  return (
    <span className={cn("peer/group relative inline-flex", className)} {...rest}>
      {children}
    </span>
  );
}

function TooltipContentAlt({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  // 同 TooltipContent：触屏不渲染 tooltip。
  const canHover = useSupportsHover();
  if (!canHover) return null;

  return (
    <span
      role="tooltip"
      className={cn(
        "lg-regular pointer-events-none absolute -top-1.5 left-1/2 z-50 -translate-x-1/2 -translate-y-full",
        "whitespace-nowrap rounded-lg border border-separator/60 px-2.5 py-1.5",
        "text-xs text-foreground opacity-0",
        "[transition:opacity_var(--lg-dur-base)_var(--lg-ease-emphasized),transform_var(--lg-dur-base)_var(--lg-ease-emphasized),translate_var(--lg-dur-base)_var(--lg-ease-emphasized),scale_var(--lg-dur-base)_var(--lg-ease-emphasized)]",
        "group-hover:opacity-100 group-hover:-translate-y-[calc(100%+var(--lg-shift-1)/2)]",
        "peer-focus-within:opacity-100 peer-focus-within:-translate-y-[calc(100%+var(--lg-shift-1)/2)]",
        className,
      )}
    >
      {children}
    </span>
  );
}

Tooltip.Content = TooltipContentAlt;

export { Tooltip, GlassTooltip };
