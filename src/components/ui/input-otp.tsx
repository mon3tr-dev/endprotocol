import { createContext, useContext, useRef } from "react";
import { cn } from "@/lib/utils";

export interface GlassInputOTPProps {
  value?: string;
  onChange?: (value: string) => void;
  onComplete?: (value: string) => void;
  maxLength?: number;
  isInvalid?: boolean;
  "aria-describedby"?: string;
  className?: string;
  children?: React.ReactNode;
}

const OTPCtx = createContext<{ value: string; isInvalid: boolean }>({
  value: "",
  isInvalid: false,
});

function InputOTP({
  value = "",
  onChange,
  onComplete,
  maxLength = 6,
  isInvalid = false,
  "aria-describedby": ariaDescribedBy,
  className,
  children,
}: GlassInputOTPProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className={cn("inline-flex cursor-text items-center gap-2", className)}
      onClick={() => inputRef.current?.focus()}
    >
      <input
        ref={inputRef}
        className="sr-only"
        value={value}
        maxLength={maxLength}
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-describedby={ariaDescribedBy}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9A-Za-z]/g, "").slice(0, maxLength);
          onChange?.(raw);
          if (raw.length === maxLength) onComplete?.(raw);
        }}
      />
      <OTPCtx.Provider value={{ value, isInvalid }}>{children}</OTPCtx.Provider>
    </div>
  );
}

function OTPGroup({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return <div className={cn("flex gap-2", className)}>{children}</div>;
}

function OTPSlot({
  index,
  className,
}: {
  index: number;
  className?: string;
}) {
  const { value, isInvalid } = useContext(OTPCtx);
  const ch = value[index] ?? "";
  return (
    <span
      className={cn(
        // OTP 槽位：功能层字段材质（88% 实底，无模糊）
        "lg-field flex h-11 w-9 items-center justify-center rounded-lg bg-field",
        "text-base font-semibold text-foreground",
        isInvalid && "border-danger",
        className,
      )}
    >
      {ch}
    </span>
  );
}

function OTPSeparator({ className }: { className?: string }) {
  return (
    <span className={cn("text-muted/70", className)}>—</span>
  );
}

InputOTP.Group = OTPGroup;
InputOTP.Slot = OTPSlot;
InputOTP.Separator = OTPSeparator;

const GlassInputOTP = InputOTP;
GlassInputOTP.Group = OTPGroup;
GlassInputOTP.Slot = OTPSlot;
GlassInputOTP.Separator = OTPSeparator;

export { InputOTP, GlassInputOTP };
