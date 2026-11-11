import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { ChevronDownIcon } from "@/components/ui/app-icon";

export interface GlassSelectOption {
  value: string;
  /**
   * 选项文案。
   *
   * 允许 `ReactNode` 是为了在同一行里放标识类元素（如 `<AccountNameLine>`：
   * 昵称 + 紧跟其后的游戏徽标）。纯字符串场景完全不变
   * （`string` 本身即合法 `ReactNode`），因此是向后兼容的类型放宽。
   */
  label: ReactNode;
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
  const [closing, setClosing] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  const closeMenu = () => {
    if (!open || closing) return;
    setClosing(true);
    closeTimerRef.current = setTimeout(() => {
      setOpen(false);
      setClosing(false);
      closeTimerRef.current = null;
    }, 280);
  };

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      if (wrapRef.current?.contains(e.target as Node)) return;
      closeMenu();
    };
    const onScroll = () => closeMenu();
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  useEffect(
    () => () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    },
    [],
  );

  const normalized = value ?? "";
  const current = options.find((o) => o.value === normalized);

  const handleToggle = () => {
    const next = !open;
    if (!next) {
      closeMenu();
      return;
    }
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
          "lg-field flex items-center gap-2 h-9 pl-3 pr-2.5 rounded-xl text-sm cursor-pointer",
          "[transition:transform_var(--lg-dur-press)_var(--lg-ease-spring),translate_var(--lg-dur-press)_var(--lg-ease-spring),scale_var(--lg-dur-press)_var(--lg-ease-spring),box-shadow_var(--lg-dur-fast)_var(--lg-ease-standard)]",
          "hover:-translate-y-px active:translate-y-0",
          open && "ring-2 ring-primary/40",
        )}
      >
        <span className={cn("min-w-0 flex-1 text-left", current ? "text-foreground" : "text-muted")}>
          {current?.label ?? placeholder}
        </span>
        <ChevronDownIcon
          size={12}
          className={cn(
            "shrink-0 text-muted",
            "[transition:transform_var(--lg-dur-fast)_var(--lg-ease-standard),translate_var(--lg-dur-fast)_var(--lg-ease-standard),scale_var(--lg-dur-fast)_var(--lg-ease-standard)]",
            open && "rotate-180",
          )}
        />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className={cn(
              "lg-regular fixed z-[9999] min-w-[150px] rounded-xl border border-separator/60",
              closing ? "animate-fade-out" : "animate-scale-in",
            )}
            style={{
              top: pos.top,
              left: pos.left,
              width: Math.max(150, pos.width || 0),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 玻璃宿主与滚动容器分层：::before 材质层随滚动容器一起滚走 */}
            <div
              className="overflow-y-auto overflow-x-hidden rounded-xl"
              style={{ maxHeight: maxMenuHeight }}
            >
            {options.map((opt) => {
              const active = opt.value === normalized;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    closeMenu();
                  }}
                  className={cn(
                    "w-full text-left px-3 py-2 text-sm cursor-pointer",
                    "[transition:background-color_var(--lg-dur-fast)_var(--lg-ease-standard)]",
                    active
                      ? highlightSelected
                        ? "bg-primary/10 text-primary-text font-semibold"
                        : "bg-primary/10 text-primary-text"
                      : "text-foreground hover:bg-foreground/5",
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
            </div>
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
