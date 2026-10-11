import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  key: string;
  label: string;
  danger?: boolean;
  onPress: () => void;
}

interface CardContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function CardContextMenu({
  x,
  y,
  items,
  onClose,
}: CardContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const updatePosition = () => {
      const { width, height } = menu.getBoundingClientRect();
      const margin = 8;
      const maxX = Math.max(margin, window.innerWidth - width - margin);
      const maxY = Math.max(margin, window.innerHeight - height - margin);
      const left = Math.min(x, maxX);
      const top = Math.min(
        y + height > window.innerHeight - margin ? y - height : y,
        maxY,
      );
      const nextPosition = {
        x: Math.max(margin, left),
        y: Math.max(margin, top),
      };

      setPosition((current) =>
        current.x === nextPosition.x && current.y === nextPosition.y
          ? current
          : nextPosition,
      );
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [items.length, x, y]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] min-w-[160px] max-w-[calc(100vw-16px)] max-h-[calc(100vh-16px)] overflow-y-auto glass-surface border border-separator/80 rounded-xl py-1 animate-fade-in"
      style={{ left: position.x, top: position.y }}
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`mx-1 box-border w-[calc(100%-0.5rem)] cursor-pointer rounded-lg px-3 py-2 text-left text-sm transition-colors flex items-center gap-2 ${
            item.danger
              ? "text-danger hover:bg-danger/10"
              : "context-item-normal"
          }`}
          onClick={() => {
            item.onPress();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
