/**
 * 悬浮覆盖式原生滚动条
 * 将纵向可滚动容器切换为 Chromium 的 overlay 滚动条（不占空间、可拖动），
 * 轨道透明、滑块默认隐藏，鼠标接近滚动区域时由 CSS :hover 浮出。
 */

function isScrollable(el: HTMLElement): boolean {
  const oy = getComputedStyle(el).overflowY;
  return oy === "auto" || oy === "scroll";
}

function attach(el: HTMLElement): void {
  if (!isScrollable(el)) return;
  if (el.hasAttribute("data-ovs")) return;
  // 显式退出：该容器不要可见滚动条，允许内容溢出后直接滚。
  // （设置页左侧分区栏用它 —— 玻璃材质铺满整块面板，多出一条 8px 滚动条
  //   既挤占宽度，也让材质在滚动时看起来"错位"。）
  if (el.hasAttribute("data-no-ovs")) return;

  // overflow: overlay 在 Chromium 中让滚动条覆盖内容、不占布局空间，
  // 且保留原生滚动条的拖动能力。不支持的浏览器会忽略该值回退为 auto。
  el.style.overflowY = "overlay";
  el.setAttribute("data-ovs", "");
}

let inited = false;

export function initOverlayScrollbar(): void {
  if (inited) return;
  inited = true;

  const scan = () => {
    document.querySelectorAll<HTMLElement>("*").forEach(attach);
  };
  scan();

  const mo = new MutationObserver(() => {
    requestAnimationFrame(scan);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
}
