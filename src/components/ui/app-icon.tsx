import {
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  X,
  Plus,
  Pencil,
  Check,
  ArrowLeftRight,
  Minus,
  Square,
  Copy,
  Menu,
  Bell,
  Link2,
  Unlink,
  Info,
  AlertTriangle,
  Globe,
  LoaderCircle,
} from "lucide";
import { createMorphIcon } from "@/components/morph-icon";
import clsx from "clsx";

export const RefreshIcon = createMorphIcon(RefreshCw);
export const ChevronLeftIcon = createMorphIcon(ChevronLeft);
export const ChevronRightIcon = createMorphIcon(ChevronRight);
export const ChevronDownIcon = createMorphIcon(ChevronDown);
export const CloseIcon = createMorphIcon(X);
export const PlusIcon = createMorphIcon(Plus);
export const EditIcon = createMorphIcon(Pencil);
export const CheckIcon = createMorphIcon(Check);
export const SwitchIcon = createMorphIcon(ArrowLeftRight);
export const MinimizeIcon = createMorphIcon(Minus);
export const MaximizeIcon = createMorphIcon(Square);
export const RestoreIcon = createMorphIcon(Copy);
export const MenuIcon = createMorphIcon(Menu);
export const BellIcon = createMorphIcon(Bell);
export const LinkIcon = createMorphIcon(Link2);
export const UnlinkIcon = createMorphIcon(Unlink);
export const InfoIcon = createMorphIcon(Info);
export const GlobeIcon = createMorphIcon(Globe);
export const LoadingIcon = createMorphIcon(LoaderCircle);
export const AlertTriangleIcon = createMorphIcon(AlertTriangle);

export function StatusDot({
  tone = "default",
  pulse = false,
  size = "md",
  className,
}: {
  tone?: "success" | "warning" | "danger" | "default";
  pulse?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizeClass = {
    sm: "w-2 h-2",
    md: "w-3 h-3",
    lg: "w-4 h-4",
  }[size];

  const toneClass = {
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
    default: "bg-default-400",
  }[tone];

  return (
    <span className={clsx("relative flex-shrink-0 inline-block", className)}>
      <span className={clsx("rounded-full", sizeClass, toneClass)} />
      {pulse && (
        <span
          className={clsx(
            "absolute inset-0 rounded-full opacity-25 animate-ping",
            toneClass,
          )}
        />
      )}
    </span>
  );
}
