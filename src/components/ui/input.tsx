import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface GlassInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  variant?: string;
  size?: "sm" | "md" | "lg";
  isDisabled?: boolean;
  isInvalid?: boolean;
  isClearable?: boolean;
  startContent?: React.ReactNode;
  endContent?: React.ReactNode;
  onValueChange?: (value: string) => void;
}

const GlassInput = forwardRef<HTMLInputElement, GlassInputProps>(
  function GlassInput(
    {
      variant,
      size = "md",
      isDisabled = false,
      isInvalid = false,
      isClearable = false,
      startContent,
      endContent,
      className,
      onChange,
      onValueChange,
      disabled,
      ...rest
    },
    ref,
  ) {
    const sizeClass =
      size === "sm" ? "h-8 text-sm" : size === "lg" ? "h-11 text-sm" : "h-9 text-sm";

    const inner = (
      <input
        ref={ref}
        disabled={disabled || isDisabled}
        onChange={(e) => {
          onChange?.(e);
          onValueChange?.(e.target.value);
        }}
        className={cn(
          // lg-field：替换元素直接铺 88% 实底（::before 不渲染），
          // focus 反馈用 ring 而非边框变色
          "lg-field w-full min-w-0 rounded-xl px-3 text-foreground placeholder:text-muted/70",
          "[transition:box-shadow_var(--lg-dur-fast)_var(--lg-ease-standard)]",
          "focus:outline-none focus:ring-2 focus:ring-primary/40",
          "hover:brightness-[1.03]",
          "disabled:opacity-50 disabled:pointer-events-none",
          isInvalid && "border-danger",
          sizeClass,
          startContent && "pl-9",
          endContent && "pr-9",
          className,
        )}
        {...rest}
      />
    );

    if (!startContent && !endContent) return inner;

    return (
      <div className="relative flex w-full items-center">
        {startContent && (
          <span className="pointer-events-none absolute left-3 text-muted">{startContent}</span>
        )}
        {inner}
        {endContent && (
          <span className="pointer-events-none absolute right-3 text-muted">{endContent}</span>
        )}
      </div>
    );
  },
);

GlassInput.displayName = "GlassInput";

interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = forwardRef<HTMLInputElement, InputProps>(
  function Input({ className, type = "text", ...rest }, ref) {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          "lg-field flex h-9 w-full rounded-xl px-3 py-1 text-sm text-foreground",
          "placeholder:text-muted/70",
          "[transition:box-shadow_var(--lg-dur-fast)_var(--lg-ease-standard)]",
          "focus:outline-none focus:ring-2 focus:ring-primary/40",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...rest}
      />
    );
  },
);

Input.displayName = "Input";

export { Input, GlassInput };
