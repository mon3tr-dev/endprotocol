import { useEffect, useState } from "react";

/**
 * 响应式媒体查询 hook（SSR / 首帧安全）。
 *
 * 为什么需要它：Tailwind 的 `sm:` / `lg:` 等断点只能在**样式**层面切换，
 * 而很多移动端优化需要改的是**结构**（例如侧栏在窄屏换成底部导航条、
 * 弹窗在窄屏从居中卡片换成底部抽屉）。这些必须由 JS 决定渲染哪套 DOM，
 * 否则两套结构会同时挂载（双份 DOM、状态不同步、焦点错乱）。
 *
 * 首帧返回 `false`（桌面假设），等 effect 跑完再切到真实值 —— 与 Tailwind
 * 断点的行为一致（`lg:` 之前就是手机样式）。对「宽屏才渲染」的结构，
 * 首帧多渲染一次桌面结构是无害的；反过来则由调用方自行处理。
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    try {
      return window.matchMedia(query).matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia(query);
    } catch {
      return;
    }
    const sync = () => setMatches(mql.matches);
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, [query]);

  return matches;
}

/** 视口宽度小于 `sm`（640px）—— 与 Tailwind 的 `sm` 断点对齐。 */
export function useIsBelowSm(): boolean {
  return useMediaQuery("(max-width: 639px)");
}

/**
 * 触屏主设备（`pointer: coarse` + `hover: none`）。
 *
 * 用于把「只有悬停才出现」的控件在手机上改为常驻 / 点击触发。
 */
export function useIsTouchPrimary(): boolean {
  return useMediaQuery("(pointer: coarse) and (hover: none)");
}

/**
 * 设备能否悬停。
 *
 * tooltip、hover 浮出这类交互在手机上没有意义（点一下就消失），
 * 用它在渲染期直接关掉，省掉一次无用的浮层渲染。
 */
export function useSupportsHover(): boolean {
  return useMediaQuery("(hover: hover)");
}
