import { cn } from "@/lib/utils";

export interface GlassCheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "checked" | "onChange"> {
  isSelected?: boolean;
  onValueChange?: (selected: boolean) => void;
  onChange?: () => void;
}

function GlassCheckbox({
  isSelected = false,
  onValueChange,
  onChange,
  children,
  className,
  ...rest
}: GlassCheckboxProps) {
  return (
    <label className={cn("inline-flex cursor-pointer select-none items-center gap-2", className)}>
      <input
        type="checkbox"
        className="sr-only"
        checked={isSelected}
        onChange={() => {
          onChange?.();
          onValueChange?.(!isSelected);
        }}
        {...rest}
      />
      <span
        aria-hidden
        className={cn(
          "lg-control flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border",
          // 勾选弹性缩放：fast 档 spring，仅 transform
          "[transition:transform_var(--lg-dur-fast)_var(--lg-ease-spring),background-color_var(--lg-dur-fast)_var(--lg-ease-standard)]",
          "hover:scale-110 active:scale-90",
          "focus-within:ring-2 focus-within:ring-primary/40",
          isSelected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-default-400 bg-transparent",
        )}
      >
        {isSelected && (
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path
              d="M2.5 6.2 5 8.7l4.5-5.4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      {children}
    </label>
  );
}

interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "checked" | "onChange"> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

function Checkbox({
  checked = false,
  onCheckedChange,
  children,
  className,
  ...rest
}: CheckboxProps) {
  return (
    <label className={cn("inline-flex cursor-pointer select-none items-center gap-2", className)}>
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={() => onCheckedChange?.(!checked)}
        {...rest}
      />
      <span
        aria-hidden
        className={cn(
          "lg-control flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border",
          "[transition:transform_var(--lg-dur-fast)_var(--lg-ease-spring),background-color_var(--lg-dur-fast)_var(--lg-ease-standard)]",
          "hover:scale-110 active:scale-90",
          "focus-within:ring-2 focus-within:ring-primary/40",
          checked
            ? "border-primary bg-primary text-primary-foreground"
            : "border-default-400 bg-transparent",
        )}
      >
        {checked && (
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path
              d="M2.5 6.2 5 8.7l4.5-5.4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      {children}
    </label>
  );
}

export { Checkbox, GlassCheckbox };
