import { createContext, useContext } from "react";
import { cn } from "@/lib/utils";
import { GlassInput } from "./input";

export interface GlassNumberFieldProps {
  value?: number;
  onChange?: (value: number) => void;
  minValue?: number;
  maxValue?: number;
  "aria-label"?: string;
  className?: string;
  children?: React.ReactNode;
}

const NumberFieldCtx = createContext<{
  value: number;
  min: number | undefined;
  max: number | undefined;
  onChange: (value: number) => void;
}>({
  value: 0,
  min: undefined,
  max: undefined,
  onChange: () => {},
});

function NumberField({
  value = 0,
  onChange,
  minValue,
  maxValue,
  "aria-label": ariaLabel,
  className,
  children,
}: GlassNumberFieldProps) {
  return (
    <NumberFieldCtx.Provider
      value={{
        value,
        min: minValue,
        max: maxValue,
        onChange: onChange ?? (() => {}),
      }}
    >
      <div
        role="group"
        aria-label={ariaLabel}
        className={cn("inline-flex items-center gap-1", className)}
      >
        {children}
      </div>
    </NumberFieldCtx.Provider>
  );
}

function Group({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("inline-flex items-center gap-1", className)}>
      {children}
    </div>
  );
}

function DecrementButton({
  className,
  "aria-label": ariaLabel,
}: {
  className?: string;
  "aria-label"?: string;
}) {
  const { value, min, onChange } = useContext(NumberFieldCtx);
  const disabled = min !== undefined && value <= min;
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(value - 1)}
      className={cn(
        "lg-control flex h-9 w-9 items-center justify-center rounded-xl text-foreground",
        "[transition:transform_var(--lg-dur-press)_var(--lg-ease-spring),translate_var(--lg-dur-press)_var(--lg-ease-spring),scale_var(--lg-dur-press)_var(--lg-ease-spring),color_var(--lg-dur-fast)_var(--lg-ease-standard)]",
        "hover:text-primary-text hover:scale-110 active:scale-90 disabled:opacity-40 disabled:pointer-events-none",
        className,
      )}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <path d="M2 6h8" />
      </svg>
    </button>
  );
}

function IncrementButton({
  className,
  "aria-label": ariaLabel,
}: {
  className?: string;
  "aria-label"?: string;
}) {
  const { value, max, onChange } = useContext(NumberFieldCtx);
  const disabled = max !== undefined && value >= max;
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(value + 1)}
      className={cn(
        "lg-control flex h-9 w-9 items-center justify-center rounded-xl text-foreground",
        "[transition:transform_var(--lg-dur-press)_var(--lg-ease-spring),translate_var(--lg-dur-press)_var(--lg-ease-spring),scale_var(--lg-dur-press)_var(--lg-ease-spring),color_var(--lg-dur-fast)_var(--lg-ease-standard)]",
        "hover:text-primary-text hover:scale-110 active:scale-90 disabled:opacity-40 disabled:pointer-events-none",
        className,
      )}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <path d="M6 2v8M2 6h8" />
      </svg>
    </button>
  );
}

function NumberInput({ className }: { className?: string }) {
  const { value, min, max, onChange } = useContext(NumberFieldCtx);
  return (
    <GlassInput
      type="number"
      className={cn("h-9 text-center", className)}
      value={Number.isNaN(value) ? "" : String(value)}
      min={min}
      max={max}
      onChange={(e) => {
        const n = Number(e.target.value);
        onChange(Number.isNaN(n) ? 0 : n);
      }}
    />
  );
}

NumberField.Group = Group;
NumberField.DecrementButton = DecrementButton;
NumberField.IncrementButton = IncrementButton;
NumberField.Input = NumberInput;

const GlassNumberField = NumberField;
GlassNumberField.Group = Group;
GlassNumberField.DecrementButton = DecrementButton;
GlassNumberField.IncrementButton = IncrementButton;
GlassNumberField.Input = NumberInput;

export { NumberField, GlassNumberField };
