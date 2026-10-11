import { MorphIcon } from "morphicons/react";
import {
  BookOpen,
  BriefcaseBusiness,
  Bug,
  CalendarDays,
  Check,
  ClipboardList,
  Gamepad2,
  Gem,
  Home,
  Lightbulb,
  MapPin,
  ShoppingCart,
  Swords,
  Target,
} from "lucide";
import type { TodoIconId } from "@/types/todo";
import { normalizeTodoIcon } from "@/types/todo";

const TODO_ICON_COMPONENTS = {
  file: ClipboardList,
  check: Check,
  cart: ShoppingCart,
  calendar: CalendarDays,
  bug: Bug,
  idea: Lightbulb,
  pin: MapPin,
  target: Target,
  book: BookOpen,
  home: Home,
  work: BriefcaseBusiness,
  game: Gamepad2,
  swords: Swords,
  gem: Gem,
} satisfies Record<TodoIconId, typeof ClipboardList>;

interface TodoIconProps {
  icon?: string | null;
  size?: number;
  className?: string;
}

export function TodoIcon({ icon, size = 20, className }: TodoIconProps) {
  const iconId = normalizeTodoIcon(icon);
  return (
    <MorphIcon
      icon={TODO_ICON_COMPONENTS[iconId]}
      size={size}
      className={className}
      aria-hidden
    />
  );
}
