import { forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { GlassSpinner } from "./spinner";

export type GlassButtonVariant = "primary" | "secondary" | "tertiary" | "outline" | "ghost" | "danger";
export type GlassButtonSize = "sm" | "md" | "lg";

export interface GlassButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "size"> {
  variant?: GlassButtonVariant;
  size?: GlassButtonSize;
  isIconOnly?: boolean;
  isDisabled?: boolean;
  isLoading?: boolean;
  fullWidth?: boolean;
  onPress?: React.MouseEventHandler<HTMLButtonElement>;
  startContent?: React.ReactNode;
  endContent?: React.ReactNode;
}

const buttonVariants = cva(
  // 注意：lg-control（玻璃底）放在各实底变体里而不是基础类——ghost/tertiary
  // 是纯透明按钮，若基础类带 lg-control，其 ::before 玻璃层会被渲染出来；
  // 而此前用 before:hidden 去hide又会连带杀死调用方通过 className 追加的
  // lg-material 玻璃（display:none 对同一个 ::before 一票否决）。
  "inline-flex items-center justify-center font-medium select-none whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50 disabled:pointer-events-none " +
    // Liquid Glass 交互反馈：亮度/高光经 inset 高光与阴影过渡体现，
    // 不做生硬边框变色；位移只用 transform（fast 档 + spring）。
    "[transition:transform_var(--lg-dur-press)_var(--lg-ease-spring),translate_var(--lg-dur-press)_var(--lg-ease-spring),scale_var(--lg-dur-press)_var(--lg-ease-spring),box-shadow_var(--lg-dur-fast)_var(--lg-ease-standard)] hover:-translate-y-px hover:shadow-[0_4px_14px_rgba(0,0,0,0.14)] active:translate-y-0 active:scale-[0.97]",
  {
    variants: {
      variant: {
        // 强调色只用于交互焦点与关键状态（HIG：玻璃上克制用色）
        // lg-solid：主色/危险色是实底，玻璃层只留边缘高光、不铺填充；否则
        // ::before 的 tint 会把实底压成灰紫，深色主题下近黑前景字直接读不出。
        primary:
          "lg-control lg-solid bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.28)] hover:bg-primary/90",
        secondary: "lg-control text-foreground hover:brightness-105 active:brightness-95",
        tertiary: "bg-transparent text-foreground/85 hover:text-foreground",
        outline: "lg-control lg-field border bg-transparent hover:brightness-105",
        ghost: "bg-transparent text-foreground/85 hover:text-foreground",
        danger:
          "lg-control lg-solid bg-danger text-danger-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] hover:bg-danger/90",
      },
      size: {
        sm: "h-8 px-3 text-xs gap-1.5 rounded-xl",
        md: "h-9 px-4 text-sm gap-2 rounded-xl",
        lg: "h-10 px-5 text-sm gap-2 rounded-xl",
      },
      isIconOnly: {
        true: "px-0",
        false: "",
      },
      fullWidth: {
        true: "w-full",
        false: "",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  }
);

const iconOnlySize: Record<GlassButtonSize, string> = {
  sm: "w-8 h-8",
  md: "w-9 h-9",
  lg: "w-10 h-10",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "secondary",
      size = "md",
      className,
      type = "button",
      disabled,
      children,
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled}
        className={cn(buttonVariants({ variant, size, className }))}
        {...rest}
      >
        {children}
      </button>
    );
  },
);

Button.displayName = "Button";

export { Button, buttonVariants };

const GlassButton = forwardRef<HTMLButtonElement, GlassButtonProps>(
  function GlassButton(
    {
      variant = "secondary",
      size = "md",
      isIconOnly = false,
      isDisabled = false,
      isLoading = false,
      fullWidth = false,
      onPress,
      startContent,
      endContent,
      className,
      type = "button",
      disabled,
      children,
      ...rest
    },
    ref,
  ) {
    const pressed = disabled || isDisabled || isLoading;
    return (
      <button
        ref={ref}
        type={type}
        disabled={pressed}
        onClick={(e) => {
          if (!pressed) onPress?.(e);
        }}
        className={cn(
          buttonVariants({ variant, size, className }),
          isIconOnly && cn(iconOnlySize[size], "shrink-0 px-0"),
          fullWidth && "w-full",
        )}
        {...rest}
      >
        {isLoading && <GlassSpinner size="sm" className="shrink-0" />}
        {startContent}
        {children}
        {endContent}
      </button>
    );
  },
);

GlassButton.displayName = "GlassButton";

export { GlassButton };
