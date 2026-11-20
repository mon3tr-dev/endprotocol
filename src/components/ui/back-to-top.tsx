import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { MorphIcon } from "morphicons/react";
import { ArrowUp } from "lucide";

/**
 * 返回顶部 FAB（与 char-select 一致）：
 * 滚动超过 50% 时显示，悬停显示上箭头图标，否则显示滚动百分比。
 */
export function BackToTopFab({
  getContainer,
  className,
}: {
  getContainer: () => HTMLElement | null;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);
  const [percent, setPercent] = useState(0);
  const [hovering, setHovering] = useState(false);

  useEffect(() => {
    let el: HTMLElement | null = null;
    let alive = true;
    let raf = 0;
    const handler = () => {
      if (!el) return;
      const { scrollTop, scrollHeight, clientHeight } = el;
      const total = scrollHeight - clientHeight;
      const p = total > 0 ? Math.round((scrollTop / total) * 100) : 0;
      setPercent(p);
      setVisible(p > 20);
    };
    const bind = () => {
      if (!alive) return;
      el = getContainer();
      if (!el) {
        raf = requestAnimationFrame(bind);
        return;
      }
      handler();
      el.addEventListener("scroll", handler, { passive: true });
    };
    bind();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      el?.removeEventListener("scroll", handler);
    };
  }, [getContainer]);

  if (!visible) return null;

  return createPortal(
    <button
      type="button"
      className={cn(
        // 移动端（<lg）：右下角是**悬浮的底部导航胶囊**（`fixed bottom-0`，高约
        // 56px，通栏），与本按钮的 `bottom-6 right-6` 完全重合 —— 本按钮
        // z-[10003] 更高，会把导航胶囊整个盖住，导航在移动端就用不了了。
        // 参照 DashboardFAB 的做法：<lg 抬到导航胶囊上方，lg 及以上恢复 bottom-6
        // （桌面没有底部导航）。
        "fixed right-6 z-[10003] w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center transition-all duration-300 hover:scale-110 active:scale-90",
        "bottom-[calc(7rem+var(--safe-area-bottom))] lg:bottom-6",
        className,
      )}
      onClick={() => getContainer()?.scrollTo({ top: 0, behavior: "smooth" })}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      aria-label="Back to top"
    >
      {hovering ? (
        <MorphIcon icon={ArrowUp} size={24} spring="snappy" />
      ) : (
        <span className="text-xs font-bold">{percent}%</span>
      )}
    </button>,
    document.body,
  );
}