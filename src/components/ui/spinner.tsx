import { cn } from "@/lib/utils";

export interface GlassSpinnerProps {
  size?: "sm" | "md" | "lg" | number;
  color?: "current" | "default" | "primary";
  className?: string;
}

const colorMap = {
  current: "text-current",
  default: "text-default-400",
  primary: "text-primary-text",
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
      <path
        className="opacity-90"
        fill="currentColor"
        d="M12 2a10 10 0 0 1 10 10h-4a6 6 0 0 0-6-6V2z"
      />
    </svg>
  );
}

const GlassSpinner = Spinner;

export { Spinner, GlassSpinner };
