import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";

interface FlipSnapshot {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface UseFlipListOptions {
  /** 位移过渡时长（ms） */
  duration?: number;
  /** 位移过渡缓动 */
  easing?: string;
  /** 子项定位属性，默认 data-flip-id */
  attr?: string;
}

/**
 * 列表换位（FLIP）动画。
 *
 * 针对「拖拽换位时直接改数组顺序 → DOM 瞬间跳位」的场景：keys 顺序变化后的同一帧内，
 * 按 `data-flip-id` 取回每个子项的新位置，与上一帧记录的位置求差，先用 transform 把它
 * 按回旧位置，再过渡回 0 —— 换位因此是「滑过去」而不是闪现。
 *
 * 位置用 getBoundingClientRect 相对容器计算（不受祖先定位方式影响）。记录的是**视觉位置**
 * （含上一次未完成的 transform），所以拖拽中连续快速跨越多次时，动画会从当前视觉位置续接，
 * 不会跳回中途被取消的旧位置。
 *
 * 只在 keys 序列真正变化时播放；折叠、主题切换等不改变 keys 的重渲染不受干扰。
 * `prefers-reduced-motion: reduce` 时自动跳过。
 *
 * @param containerRef 列表容器（其直接子元素需带 data-flip-id）
 * @param keys 当前顺序标识（如 navOrder、tab id 列表）
 */
export function useFlipList(
  containerRef: RefObject<HTMLElement | null>,
  keys: readonly string[],
  options: UseFlipListOptions = {},
) {
  const {
    duration = 240,
    easing = "cubic-bezier(0.33, 1, 0.68, 1)",
    attr = "data-flip-id",
  } = options;

  const prevSnapshot = useRef<Map<string, FlipSnapshot>>(new Map());
  const timers = useRef<number[]>([]);

  const signature = keys.join("\u0000");
  const prevSignature = useRef(signature);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const changed = prevSignature.current !== signature;
    prevSignature.current = signature;
    if (!container) return;

    const items = Array.from(
      container.querySelectorAll<HTMLElement>(`:scope > [${attr}]`),
    );
    const containerRect = container.getBoundingClientRect();

    const measure = (el: HTMLElement): FlipSnapshot => {
      const rect = el.getBoundingClientRect();
      return {
        top: rect.top - containerRect.top,
        left: rect.left - containerRect.left,
        width: rect.width,
        height: rect.height,
      };
    };

    const record = () => {
      const next = new Map<string, FlipSnapshot>();
      for (const el of items) {
        const id = el.getAttribute(attr);
        if (id) next.set(id, measure(el));
      }
      prevSnapshot.current = next;
    };

    if (
      !changed ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      // 首帧或仅由其它状态（折叠/主题）引起的重渲染：只记录基准位置。
      record();
      return;
    }

    const next = new Map<string, FlipSnapshot>();
    const moved: HTMLElement[] = [];

    for (const el of items) {
      const id = el.getAttribute(attr);
      if (!id) continue;
      const to = measure(el);
      next.set(id, to);

      const from = prevSnapshot.current.get(id);
      if (!from) continue; // 新挂载项不参与动画
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;

      el.style.transition = "none";
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      moved.push(el);
    }

    prevSnapshot.current = next;
    if (moved.length === 0) return;

    // 强制回流，确保「旧位置」这一帧真的被绘制，再放开过渡。
    void container.offsetHeight;

    const raf = window.requestAnimationFrame(() => {
      for (const el of moved) {
        el.style.transition = `transform ${duration}ms ${easing}`;
        el.style.transform = "";
      }
    });

    const timer = window.setTimeout(() => {
      for (const el of moved) {
        el.style.transition = "";
        if (!el.getAttribute("style")?.trim()) el.removeAttribute("style");
      }
    }, duration + 40);

    timers.current.push(timer);

    return () => {
      window.cancelAnimationFrame(raf);
    };
  }, [containerRef, signature, attr, duration, easing]);

  useLayoutEffect(
    () => () => {
      for (const timer of timers.current) window.clearTimeout(timer);
      timers.current = [];
    },
    [],
  );
}

export default useFlipList;
