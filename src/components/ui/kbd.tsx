import { cn } from "@/lib/utils";

export interface GlassKbdProps extends React.HTMLAttributes<HTMLElement> {}

const KEY_SYMBOLS: Record<string, string> = {
  command: "⌘",
  control: "⌃",
  option: "⌥",
  shift: "⇧",
  enter: "↵",
  backspace: "⌫",
  space: "␣",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
};

function Kbd({ className, children, ...rest }: GlassKbdProps) {
  return (
    <kbd
      className={cn(
        // 小元素不做模糊（无视觉收益），纯色轻底 + 1px 边
        "inline-flex items-center gap-0.5 rounded-md border border-separator lg-inset px-1.5 py-0.5",
        "font-sans text-[10px] font-medium text-muted",
        className,
      )}
      {...rest}
    >
      {children}
    </kbd>
  );
}

function Abbr({ keyValue, className }: { keyValue: string; className?: string }) {
  return (
    <abbr
      title={keyValue}
      className={cn("no-underline", className)}
    >
      {KEY_SYMBOLS[keyValue] ?? keyValue}
    </abbr>
  );
}

function Content({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <span className={className}>{children}</span>;
}

Kbd.Abbr = Abbr;
Kbd.Content = Content;

const GlassKbd = Kbd;

export { Kbd, GlassKbd };
