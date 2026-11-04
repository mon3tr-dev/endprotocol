import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export type GlassChipTone = "default" | "primary" | "success" | "warning" | "danger" | "accent";

export interface GlassChipProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  variant?: "soft" | "solid" | "outline";
  size?: "sm" | "md" | "lg";
  color?: GlassChipTone;
}

const badgeVariants = cva(
  // Chip：小面积纯色标签，不做模糊（小元素模糊无收益，HIG 克制原则）
  "inline-flex items-center gap-1 whitespace-nowrap font-medium rounded-full [transition:transform_var(--lg-dur-press)_var(--lg-ease-spring),translate_var(--lg-dur-press)_var(--lg-ease-spring),scale_var(--lg-dur-press)_var(--lg-ease-spring)]",
  {
    variants: {
      variant: {
        soft: "",
        solid: "",
        outline: "",
      },
      size: {
        sm: "h-5 px-2 text-[11px]",
        md: "h-6 px-2.5 text-xs",
        lg: "h-8 px-3.5 text-sm",
      },
      color: {
        default: "",
        primary: "",
        success: "",
        warning: "",
        danger: "",
        accent: "",
      },
    },
    defaultVariants: {
      variant: "soft",
      size: "md",
      color: "default",
    },
  }
);

const softTone: Record<GlassChipTone, string> = {
  default: "lg-inset text-default-700",
  primary: "bg-primary/10 text-primary-text",
  success: "bg-success/10 text-success-text",
  warning: "bg-warning/10 text-warning-dark",
  danger: "bg-danger/10 text-danger-text",
  accent: "bg-accent/10 text-accent",
};

const solidTone: Record<GlassChipTone, string> = {
  default: "bg-default-500 text-white",
  primary: "bg-primary text-primary-foreground",
  success: "bg-success text-success-foreground",
  warning: "bg-warning text-warning-foreground",
  danger: "bg-danger text-white",
  accent: "bg-accent text-white",
};

const outlineTone: Record<GlassChipTone, string> = {
  default: "border border-separator text-foreground",
  primary: "border border-primary/50 text-primary-text",
  success: "border border-success/50 text-success-text",
  warning: "border border-warning/50 text-warning-dark",
  danger: "border border-danger/50 text-danger-text",
  accent: "border border-accent/50 text-accent",
};

function Badge({
  variant = "soft",
  size = "md",
  color = "default",
  className,
  children,
  ...rest
}: GlassChipProps) {
  const tone =
    variant === "solid"
      ? solidTone[color!]
      : variant === "outline"
        ? outlineTone[color!]
        : softTone[color!];

  return (
    <span
      className={cn(badgeVariants({ variant, size }), tone, className)}
      {...rest}
    >
      {children}
    </span>
  );
}

const GlassChip = Badge;

export { Badge, GlassChip };
