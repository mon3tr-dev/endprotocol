import { createContext, useContext } from "react";
import { cn } from "@/lib/utils";

/* ======================================================
 * ProgressCircle — 环形加载
 * <ProgressCircle isIndeterminate size="lg" aria-label="Loading">
 *   <ProgressCircle.Track>
 *     <ProgressCircle.TrackCircle />
 *     <ProgressCircle.FillCircle />
 *   </ProgressCircle.Track>
 * </ProgressCircle>
 * ====================================================== */

interface ProgressCtxValue {
  size: number;
  strokeWidth: number;
  value: number;
  isIndeterminate: boolean;
}

const ProgressCtx = createContext<ProgressCtxValue>({
  size: 32,
  strokeWidth: 3,
  value: 0,
  isIndeterminate: false,
});

function ProgressCircle({
  isIndeterminate = false,
  size = "md",
  value = 0,
  "aria-label": ariaLabel,
  className,
  children,
}: {
  isIndeterminate?: boolean;
  size?: "sm" | "md" | "lg" | number;
  value?: number;
  "aria-label"?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const px = typeof size === "number" ? size : size === "sm" ? 24 : size === "md" ? 32 : 40;
  const sw = Math.max(2, Math.round(px / 10));
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={isIndeterminate ? undefined : clamped}
      className={cn(
        "inline-flex items-center justify-center",
        "[transition:transform_var(--lg-dur-fast)_var(--lg-ease-spring)]",
        "hover:scale-110",
        className,
      )}
    >
      <ProgressCtx.Provider
        value={{ size: px, strokeWidth: sw, value: clamped, isIndeterminate }}
      >
        <svg width={px} height={px} viewBox={`0 0 ${px} ${px}`} className="-rotate-90">
          {children}
        </svg>
      </ProgressCtx.Provider>
    </div>
  );
}

function Track({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return <g className={className}>{children}</g>;
}

function TrackCircle({ className }: { className?: string }) {
  const { size, strokeWidth } = useContext(ProgressCtx);
  const r = (size - strokeWidth) / 2;
  return (
    <circle
      cx={size / 2}
      cy={size / 2}
      r={r}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      className={cn("text-separator", className)}
    />
  );
}

function FillCircle({ className }: { className?: string }) {
  const { size, strokeWidth, value, isIndeterminate } = useContext(ProgressCtx);
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const offset = isIndeterminate ? c * 0.75 : c * (1 - value / 100);
  return (
    <circle
      cx={size / 2}
      cy={size / 2}
      r={r}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeDasharray={c}
      strokeDashoffset={offset}
      className={cn(
        "text-primary-text",
        isIndeterminate && "animate-spin",
        className,
      )}
      style={{
        // SVG 描边进度：stroke 属性动画无法走合成器，保持轻量
        // paint 级过渡（fast 档），属于属性动画白名单外可接受的例外
        transition: "stroke-dashoffset var(--lg-dur-fast) var(--lg-ease-standard)",
        transformBox: "fill-box",
        transformOrigin: "center",
      }}
    />
  );
}

ProgressCircle.Track = Track;
ProgressCircle.TrackCircle = TrackCircle;
ProgressCircle.FillCircle = FillCircle;

const GlassProgressCircle = ProgressCircle;

/* ======================================================
 * Meter — 进度条
 * <Meter aria-label value className>
 *   <Meter.Output />
 *   <Meter.Track><Meter.Fill /></Meter.Track>
 * </Meter>
 * ====================================================== */

const MeterCtx = createContext<{ value: number }>({ value: 0 });

function Meter({
  value = 0,
  "aria-label": ariaLabel,
  className,
  children,
}: {
  value?: number;
  "aria-label"?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="meter"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      className={className}
    >
      <MeterCtx.Provider value={{ value: clamped }}>{children}</MeterCtx.Provider>
    </div>
  );
}

function MeterOutput({ className }: { className?: string }) {
  const { value } = useContext(MeterCtx);
  return (
    <span className={cn("sr-only", className)}>{Math.round(value)}%</span>
  );
}

function MeterTrack({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full", className)}>
      {children}
    </div>
  );
}

function MeterFill({ className }: { className?: string }) {
  const { value } = useContext(MeterCtx);
  return (
    // 宽度变化驱动布局，但 Meter 是低频更新条，保留 width 过渡
    // 属黑名单豁免（与 grid-template-rows 折叠同级别的布局必然项）
    <div
      className={cn(
        "h-full rounded-full bg-primary [transition:width_var(--lg-dur-slow)_var(--lg-ease-standard)]",
        className,
      )}
      style={{ width: `${value}%` }}
    />
  );
}

Meter.Output = MeterOutput;
Meter.Track = MeterTrack;
Meter.Fill = MeterFill;

const GlassMeter = Meter;

export { ProgressCircle, Meter, GlassProgressCircle, GlassMeter };
