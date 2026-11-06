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

/** viewBox 24 下的环：底圈与不定量弧共用这一套描边参数 */
const RADIUS = 10;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

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
        r={RADIUS}
        stroke="currentColor"
        strokeWidth="4"
      />
      {/* 不定量弧与底圈共用 r / strokeWidth，并带圆端帽——与
          GlassProgressCircle 的不定量态是同一族样式。
          此前弧用 fill 扇形画（外弧 r=10 / 内弧 r=6）：既与底圈错开一个
          线宽，两端又是径向切边，于是「首次加载的兜底环」和「页面内的
          加载环」一个方头一个圆头。 */}
      <circle
        className="opacity-90"
        cx="12"
        cy="12"
        r={RADIUS}
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={CIRCUMFERENCE * 0.75}
        transform="rotate(-90 12 12)"
      />
    </svg>
  );
}

const GlassSpinner = Spinner;

export { Spinner, GlassSpinner };
