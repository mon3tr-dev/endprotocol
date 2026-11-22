import { useEffect, useState } from "react";
import { isNarrowLayout } from "@/utils/platform";

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

/**
 * 是否启用**窄屏模式** —— 判据是**操作系统，不是视口宽度**。
 *
 * 见 `utils/platform.ts` 的 `isNarrowLayout()`：只有 Android 走窄屏版式。
 * 桌面端（Windows / macOS / Linux）无论把窗口拖多窄都保持桌面版式 ——
 * 否则窗口一窄就切到「窄屏顶栏 + 底部导航」，而窄屏顶栏按设计不带窗口
 * 控制按钮，窗口既不能拖也关不掉。
 *
 * 名字保留 `useIsBelowSm` 是为了不动调用点（弹窗/自定义弹窗/账户页）；
 * 语义已从「视口够窄」改为「设备是手机」，二者在 Android 上一致。
 */
export function useIsBelowSm(): boolean {
  return isNarrowLayout();
}

/**
 * 窄屏模式的读取入口（语义化的别名，供新代码使用）。
 *
 * 判据是常量（操作系统不会在运行期改变），因此不需要订阅媒体查询 ——
 * 但保留 Hook 形态，调用点仍按 Hook 规则统一调用。
 */
export function useNarrowLayout(): boolean {
  return isNarrowLayout();
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
