import { cn } from "@/lib/utils";

export interface GlassSpinnerProps {
  size?: "sm" | "md" | "lg" | number;
  color?: "current" | "default" | "primary";
  className?: string;
}

const colorMap = {
  current: "text-current",
  default: "text-default-400",
  // 描边属于「图形」而非「文字」：状态色说明里明确只给文字用 -text 变体，
  // 背景/边框/描边保持原色（globals.css §状态色的「文字版」）。
  primary: "text-primary",
};

function Spinner({
  size = "sm",
  color = "current",
  className,
}: GlassSpinnerProps) {
  const px = typeof size === "number" ? size : size === "sm" ? 16 : size === "md" ? 24 : 32;
  return (
    <svg
      className={cn("lg-spin animate-spin", colorMap[color], className)}
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      {/* 弧段必须与底圈落在同一条半径带上：底圈是 stroke(r=10, width=4)，
          即半径 8→12。外弧取 r=12、内弧取 r=8 才能与它严格重合；
          旧值 (外 10 / 内 6) 比底圈整整内缩了一个线宽，视觉上弧段脱离
          底圈、看起来像偏心。 */}
      <path
        className="opacity-90"
        fill="currentColor"
        d="M12 0a12 12 0 0 1 12 12h-4a8 8 0 0 0-8-8V0z"
      />
    </svg>
  );
}

const GlassSpinner = Spinner;

export { Spinner, GlassSpinner };
