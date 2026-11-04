import { cn } from "@/lib/utils";

export interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  isPressable?: boolean;
  onPress?: () => void;
  shadow?: "none" | "sm" | "md" | "lg";
}

/**
 * GlassCard — 内容层标准材质（Apple HIG：Liquid Glass 不用于内容层）。
 * 卡片/列表/分区容器是「内容」而非「悬浮控件」，因此不使用实时模糊，
 * 改用高不透明度的 .lg-material 纯色材质，靠边框与阴影建立层次。
 */
function GlassCard({
  isPressable = false,
  onPress,
  shadow = "none",
  className,
  children,
  ...rest
}: GlassCardProps) {
  if (isPressable) {
    return (
      <button
        type="button"
        onClick={onPress}
        className={cn(
          "lg-material rounded-xl border border-separator overflow-hidden text-left w-full",
          // 反馈：上浮 + 轻微放大 + 阴影加深（transform/box-shadow 合成友好）。
          // 位移走 press 档 + glide：fast 档的 150ms 让 2px 上跳看着像弹。
          "[transition:transform_var(--lg-dur-press)_var(--lg-ease-glide),translate_var(--lg-dur-press)_var(--lg-ease-glide),scale_var(--lg-dur-press)_var(--lg-ease-glide),box-shadow_var(--lg-dur-press)_var(--lg-ease-standard)] cursor-pointer",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
          "hover:-translate-y-1 hover:scale-[1.02] hover:shadow-lg active:translate-y-0 active:scale-[0.99]",
          shadow === "sm" && "shadow-sm",
          shadow === "md" && "shadow-md",
          shadow === "lg" && "shadow-lg",
          className,
        )}
        {...(rest as React.HTMLAttributes<HTMLButtonElement>)}
      >
        {children}
      </button>
    );
  }
  return (
    <div
      className={cn(
        "lg-material rounded-xl border border-separator overflow-hidden",
        "[transition:transform_var(--lg-dur-press)_var(--lg-ease-glide),translate_var(--lg-dur-press)_var(--lg-ease-glide),scale_var(--lg-dur-press)_var(--lg-ease-glide),box-shadow_var(--lg-dur-press)_var(--lg-ease-standard)]",
        "hover:-translate-y-1 hover:scale-[1.01] hover:shadow-lg",
        shadow === "sm" && "shadow-sm",
        shadow === "md" && "shadow-md",
        shadow === "lg" && "shadow-lg",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  shadow?: "none" | "sm" | "md" | "lg";
}

function Card({ shadow = "none", className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        "lg-material rounded-xl border border-separator",
        shadow === "sm" && "shadow-sm",
        shadow === "md" && "shadow-md",
        shadow === "lg" && "shadow-lg",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

function CardHeader({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex flex-col space-y-1.5 p-6", className)} {...rest}>
      {children}
    </div>
  );
}

function CardTitle({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "text-lg font-semibold leading-none tracking-tight",
        className,
      )}
      {...rest}
    >
      {children}
    </h3>
  );
}

function CardDescription({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-sm text-muted", className)} {...rest}>
      {children}
    </p>
  );
}

function CardContent({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("p-6 pt-0", className)} {...rest}>
      {children}
    </div>
  );
}

function CardFooter({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex items-center p-6 pt-0", className)} {...rest}>
      {children}
    </div>
  );
}

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  GlassCard,
};
