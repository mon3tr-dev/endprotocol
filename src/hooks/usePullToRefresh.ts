import { useCallback, useRef, useState } from "react";

/**
 * 下拉刷新（移动端）。**最常见的刷新方式**，替代页面里的刷新按钮。
 *
 * 只在**滚动容器已经到顶**（`scrollTop <= 0`）且位移向下时接管，
 * 否则把手势让给滚动 —— 否则页面中途往下拖会误触发刷新。
 *
 * 为什么不用第三方：需要的只是「记录起点 → 跟手位移（带阻尼）→
 * 超过阈值松手触发」，二十行足够；引库还要处理它与页面内横向轮播的
 * 手势仲裁。
 */
export interface PullToRefreshOptions {
  onRefresh: () => Promise<void> | void;
  /** 触发阈值（px），默认 64 */
  threshold?: number;
  disabled?: boolean;
}

export function usePullToRefresh({
  onRefresh,
  threshold = 64,
  disabled = false,
}: PullToRefreshOptions) {
  const [pull, setPull] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const startYRef = useRef<number | null>(null);
  const axisRef = useRef<"unknown" | "y" | "x">("unknown");

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;
      // 只有滚动到顶才可能是下拉刷新
      const el = e.currentTarget as HTMLElement;
      const scroller = el.closest<HTMLElement>("[data-scroll-root]") ?? null;
      const atTop = scroller ? scroller.scrollTop <= 0 : true;
      if (!atTop) {
        startYRef.current = null;
        return;
      }
      startYRef.current = e.clientY;
      axisRef.current = "unknown";
    },
    [disabled],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (disabled || startYRef.current === null || isRefreshing) return;
      const dy = e.clientY - startYRef.current;

      if (axisRef.current === "unknown") {
        if (Math.abs(dy) < 6) return;
        // 往下拖才是下拉刷新；往上拖交还给滚动
        axisRef.current = dy > 0 ? "y" : "x";
        if (axisRef.current === "x") {
          startYRef.current = null;
          return;
        }
      }
      if (axisRef.current !== "y") return;

      // 阻尼：越拉越沉，避免一拉到底
      const damped = Math.min(120, dy * 0.5);
      setPull(Math.max(0, damped));
    },
    [disabled, isRefreshing],
  );

  const finish = useCallback(async () => {
    if (startYRef.current === null) return;
    startYRef.current = null;
    axisRef.current = "unknown";

    if (pull >= threshold && !isRefreshing) {
      setIsRefreshing(true);
      setPull(threshold); // 停在阈值处转圈
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
        setPull(0);
      }
    } else {
      setPull(0);
    }
  }, [pull, threshold, isRefreshing, onRefresh]);

  return {
    /** 当前下拉距离（px），用于渲染指示器 */
    pull,
    isRefreshing,
    /** 是否已达触发阈值 */
    armed: pull >= threshold,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: () => void finish(),
      onPointerCancel: () => void finish(),
    },
  };
}