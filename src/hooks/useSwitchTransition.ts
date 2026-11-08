import { useEffect, useRef } from "react";

/**
 * 切换过渡：每次 `seq` 变化时，让元素播放一次位移动画。
 *
 * 为什么用 Web Animations API 而不是「CSS 动画类 + key 重挂载」：
 *  - key 重挂载会把整棵子树重建——面板的 state 丢失、滚动位置丢失、
 *    后端请求重发一遍；而这里只想让**已经在页面上的**元素动一下。
 *  - `element.animate()` 每次调用都产生一个**新的动画对象**，天然支持重播，
 *    不需要靠换 key 逼浏览器重新应用样式。
 *
 * 时长与缓动从 `--lg-dur-*` / `--lg-ease-*` / `--lg-shift-*` 令牌读，
 * 动效系统仍是唯一真相（与 globals.css 里那些 keyframes 同一套参数）。
 *
 * 只动 transform，不动 opacity：元素 opacity < 1 会让它成为 backdrop root，
 * 其自身与后代的 backdrop-filter 当场失效，玻璃退化成半透明色块。
 *
 * `direction` 的语义与切换栏一致：切换栏自上而下是终末地、明日方舟，
 * 所以 `1`（往下切）时新内容从下方推入，`-1`（往上切）时从上方推入。
 */
export function useSwitchTransition<T extends HTMLElement>(
  /** 每次切换自增的序号（用 activeGame 当序号是不行的：分不出「刚切过」与「本来就是它」） */
  seq: number,
  /** 切换方向：1 = 往下切，-1 = 往上切 */
  direction: 1 | -1,
  /** 位移幅度对应的令牌，默认 --lg-shift-2 */
  shiftToken = "--lg-shift-2",
): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    // seq 为 0 表示还没切过（初次挂载），不播入场动画。
    if (!el || seq === 0) return;

    // prefers-reduced-motion：系统里关了动画效果就不该再有位移。
    // 全局那条 `animation-duration: 80ms !important` 只管 CSS 动画与过渡，
    // **管不到 Web Animations API**（它不产生 CSS animation-duration），
    // 所以这里必须自己判一次。
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const styles = getComputedStyle(el);
    const duration =
      parseFloat(styles.getPropertyValue("--lg-dur-slow")) || 420;
    const easing =
      styles.getPropertyValue("--lg-ease-emphasized").trim() ||
      "cubic-bezier(0.16, 1, 0.3, 1)";
    const shift = parseFloat(styles.getPropertyValue(shiftToken)) || 16;

    el.animate(
      [
        { transform: `translateY(${direction * shift}px)` },
        { transform: "translateY(0)" },
      ],
      {
        duration,
        easing,
        // backwards：动画开始前保持首帧；结束后不保留终态，
        // 免得元素永久带着动画属性（fill-mode forwards 的老问题）。
        fill: "backwards",
      },
    );
  }, [seq, direction, shiftToken]);

  return ref;
}
