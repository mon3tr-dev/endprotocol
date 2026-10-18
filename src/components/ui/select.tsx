import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { ChevronDownIcon } from "@/components/ui/app-icon";

export interface GlassSelectOption {
  value: string;
  label: string;
}

export interface GlassSelectProps {
  value: string | null;
  options: GlassSelectOption[];
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  maxMenuHeight?: number;
  highlightSelected?: boolean;
}

function GlassSelect({
  value,
  options,
  onChange,
  className,
  placeholder,
  maxMenuHeight = 288,
  highlightSelected = false,
}: GlassSelectProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const normalized = value ?? "";
  const current = options.find((o) => o.value === normalized);

  const handleToggle = () => {
    const next = !open;
    if (next && wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    }
    setOpen(next);
  };

  return (
    <div ref={wrapRef} className={cn("relative shrink-0", className)}>
      <button
        type="button"
        onClick={handleToggle}
        className={cn(
          "flex items-center gap-2 h-9 pl-3 pr-2.5 rounded-xl border border-separator bg-surface text-sm cursor-pointer transition-all duration-200",
          "hover:scale-105 hover:border-primary/50",
          "active:scale-95",
          open && "border-primary/50",
        )}
      >
        <span className={cn("truncate", current ? "text-foreground" : "text-muted")}>
          {current?.label ?? placeholder}
        </span>
        <ChevronDownIcon
          size={12}
          className={cn("shrink-0 text-muted transition-transform", open && "rotate-180")}
        />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className={cn(
              "fixed z-[9999] min-w-[150px] rounded-xl border border-separator/70 glass-surface-strong shadow-xl overflow-y-auto overflow-x-hidden animate-scale-in",
            )}
            style={{
              top: pos.top,
              left: pos.left,
              width: Math.max(150, pos.width || 0),
              maxHeight: maxMenuHeight,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {options.map((opt) => {
              const active = opt.value === normalized;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "w-full text-left px-3 py-2 text-sm truncate transition-colors cursor-pointer",
                    active
                      ? highlightSelected
                        ? "bg-primary/10 text-primary font-semibold"
                        : "bg-primary/10 text-primary"
                      : "text-foreground hover:bg-foreground/5",
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}

interface SelectProps {
  value: string | null;
  options: GlassSelectOption[];
  onValueChange?: (value: string) => void;
  onChange?: (value: string) => void;
  className?: string;
  placeholder?: string;
  maxMenuHeight?: number;
}

function Select({
  value,
  options,
  onValueChange,
  onChange,
  className,
  placeholder,
  maxMenuHeight = 288,
}: SelectProps) {
  const handleChange = onValueChange ?? onChange;
  if (!handleChange) return null;
  return (
    <GlassSelect
      value={value}
      options={options}
      onChange={handleChange}
      className={className}
      placeholder={placeholder}
      maxMenuHeight={maxMenuHeight}
    />
  );
}

export { Select, GlassSelect };
