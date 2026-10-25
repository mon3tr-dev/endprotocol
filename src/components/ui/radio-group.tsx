import * as React from "react";
import { cn } from "@/lib/utils";

export interface GlassRadioGroupProps {
  /** 当前选中项的值 */
  value: string;
  /** 选中项变化回调（同一项重复点击不会再次触发） */
  onValueChange?: (value: string) => void;
  /** 必须是 `GlassRadioGroup.Item` */
  children?: React.ReactNode;
  className?: string;
  /** 整组禁用 */
  isDisabled?: boolean;
  /** 无障碍名称 */
  "aria-label"?: string;
  /** 布局方向，默认横向 */
  orientation?: "horizontal" | "vertical";
}

export interface GlassRadioGroupItemProps {
  value: string;
  children?: React.ReactNode;
  className?: string;
  isDisabled?: boolean;
}

interface RadioGroupContextValue {
  value: string;
  onValueChange?: (value: string) => void;
  isDisabled: boolean;
  orientation: "horizontal" | "vertical";
  /** 注册/注销可聚焦项，用于方向键轮转 */
  register: (value: string, node: HTMLButtonElement | null) => void;
  order: string[];
}

const RadioGroupContext = React.createContext<RadioGroupContextValue | null>(
  null,
);

/**
 * 单选组：`<GlassRadioGroup value=... onValueChange=...>` + 若干 `<GlassRadioGroup.Item value=...>`。
 *
 * 不依赖 Radix ToggleGroup（它的 `type` 只接受 `single` / `multiple`，把
 * `horizontal | vertical` 直接透传会让组件报错），这里用原生 button + roving tabindex
 * 实现单选语义：点击切换、←/→/↑/↓ 轮转、空格/回车选中。
 */
function GlassRadioGroupRoot({
  value,
  onValueChange,
  children,
  className,
  isDisabled = false,
  "aria-label": ariaLabel,
  orientation = "horizontal",
}: GlassRadioGroupProps) {
  const nodesRef = React.useRef(new Map<string, HTMLButtonElement>());
  const orderRef = React.useRef<string[]>([]);

  const register = React.useCallback(
    (itemValue: string, node: HTMLButtonElement | null) => {
      if (node) {
        nodesRef.current.set(itemValue, node);
        if (!orderRef.current.includes(itemValue)) {
          orderRef.current = [...orderRef.current, itemValue];
        }
      } else {
        nodesRef.current.delete(itemValue);
        orderRef.current = orderRef.current.filter((v) => v !== itemValue);
      }
    },
    [],
  );

  const move = (direction: 1 | -1) => {
    const enabled = orderRef.current.filter(
      (itemValue) => !nodesRef.current.get(itemValue)?.disabled,
    );
    if (enabled.length === 0) return;
    const currentIndex = enabled.indexOf(value);
    const nextIndex =
      currentIndex < 0
        ? direction === 1
          ? 0
          : enabled.length - 1
        : (currentIndex + direction + enabled.length) % enabled.length;
    const next = enabled[nextIndex];
    onValueChange?.(next);
    nodesRef.current.get(next)?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const forwardKey = orientation === "vertical" ? "ArrowDown" : "ArrowRight";
    const backwardKey = orientation === "vertical" ? "ArrowUp" : "ArrowLeft";
    if (event.key === forwardKey) {
      event.preventDefault();
      move(1);
    } else if (event.key === backwardKey) {
      event.preventDefault();
      move(-1);
    }
  };

  const context = React.useMemo<RadioGroupContextValue>(
    () => ({
      value,
      onValueChange,
      isDisabled,
      orientation,
      register,
      order: orderRef.current,
    }),
    [value, onValueChange, isDisabled, orientation, register],
  );

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={isDisabled || undefined}
      aria-orientation={orientation}
      onKeyDown={handleKeyDown}
      className={cn(
        "inline-flex w-fit max-w-full items-center gap-1 rounded-xl border border-separator/60 bg-default-100/50 p-1",
        orientation === "vertical" && "flex-col items-stretch",
        className,
      )}
    >
      <RadioGroupContext.Provider value={context}>
        {children}
      </RadioGroupContext.Provider>
    </div>
  );
}

function GlassRadioGroupItem({
  value,
  children,
  className,
  isDisabled = false,
}: GlassRadioGroupItemProps) {
  const ctx = React.useContext(RadioGroupContext);
  if (!ctx) {
    throw new Error("GlassRadioGroup.Item 必须放在 GlassRadioGroup 内部");
  }

  const checked = ctx.value === value;
  const disabled = isDisabled || ctx.isDisabled;
  const ref = React.useCallback(
    (node: HTMLButtonElement | null) => ctx.register(value, node),
    [ctx, value],
  );

  return (
    <button
      ref={ref}
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      tabIndex={checked ? 0 : -1}
      onClick={() => {
        if (!checked) ctx.onValueChange?.(value);
      }}
      className={cn(
        "inline-flex h-8 select-none items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-all duration-200",
        "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        checked
          ? "bg-primary/15 text-primary shadow-[inset_0_0_0_1px_rgba(99,102,241,0.35)]"
          : "text-muted hover:bg-default-200/40 hover:text-foreground",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border transition-colors",
          checked ? "border-primary" : "border-default-400",
        )}
      >
        {checked && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
      </span>
      {children}
    </button>
  );
}

export const GlassRadioGroup = Object.assign(GlassRadioGroupRoot, {
  Item: GlassRadioGroupItem,
});
