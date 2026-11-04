import { cn } from "@/lib/utils";

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
