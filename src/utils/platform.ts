export function isWindowsPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /^win/i.test(navigator.platform) || /windows/i.test(navigator.userAgent)
  );
}

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /^mac/i.test(navigator.platform) ||
    /mac os x|macintosh/i.test(navigator.userAgent)
  );
}

/**
 * 是否运行在 Android（Tauri Android 的系统 WebView UA 必然包含 "Android"，
 * 桌面 WebView2 / WebKitGTK 的 UA 不会出现该关键词）。
 * `navigator.userAgentData.platform`（Chromium 90+）作为补充信号。
 */
export function isAndroidApp(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaData = (
    navigator as unknown as { userAgentData?: { platform?: string } }
  ).userAgentData;
  if (uaData?.platform && /android/i.test(uaData.platform)) return true;
  return /android/i.test(navigator.userAgent);
}

/** 是否运行在 iOS（预留：Tauri iOS 同样按移动端处理）。 */
export function isIosApp(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * 是否运行在移动端（Android / iOS）。桌面 UA 不含移动端关键词，
 * 因此桌面端（Windows / macOS / Linux）恒为 false。
 */
export function isMobileApp(): boolean {
  return isAndroidApp() || isIosApp();
}

/** 是否运行在桌面端（Windows / macOS / Linux 的 Tauri 窗口或浏览器）。 */
export function isDesktopApp(): boolean {
  return !isMobileApp();
}

/**
 * 是否启用**窄屏模式**（底部导航栏那一套版式）。
 *
 * ⚠️ 判据是**操作系统**，不是视口宽度。
 *
 * 早先这里统一走 `useIsBelowSm()`（`max-width: 639px`）与 Tailwind 的 `lg:`
 * 断点，结果是「把电脑上的窗口拖窄」也会切进窄屏版式：侧边栏与桌面标题栏
 * 一起消失，换成窄屏顶栏 + 底部导航 —— 而窄屏顶栏按设计**不带窗口控制按钮**，
 * 窗口既不能拖动也不能关闭，只能靠任务栏或键盘恢复窗口大小。
 *
 * 窄屏版式本身是为 Android 手写的（全屏、贴底导航、安全区、拇指可达），
 * 桌面窗口只是「画布变小」而不是「设备变了」，所以这里只认 Android。
 * 桌面端无论窗口多窄都保持桌面版式（侧边栏 + 标题栏 + 窗口按钮）。
 *
 * iOS 暂时也返回 `false`：Tauri iOS 尚未出包，等真要支持时把它并入即可。
 */
export function isNarrowLayout(): boolean {
  return isAndroidApp();
}

/**
 * 是否是「粗指针 / 无悬停」设备（手机、平板触屏）。
 *
 * 桌面浏览器在某些外接触屏屏上也会命中 `(hover: none)`，但桌面端的主交互
 * 仍然是鼠标，所以这里用 `pointer: coarse` 与 `hover: none` **同时**成立才判定
 * 为触屏主设备 —— 这样 Windows 触屏笔记本仍按桌面布局处理。
 *
 * 用途：把「只有悬停才出现」的控件（卡片编辑按钮、右键菜单入口、tooltip）
 * 在触屏上改成常驻或长按触发，否则手机上这些按钮永远点不到。
 */
export function isTouchPrimaryDevice(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return (
      window.matchMedia("(pointer: coarse)").matches &&
      window.matchMedia("(hover: none)").matches
    );
  } catch {
    return false;
  }
}

/**
 * 是否支持「悬停」交互（指针能稳定停在元素上并触发 hover 状态）。
 *
 * 与 `isTouchPrimaryDevice` 互补：这里问的是「设备**能不能**悬停」，
 * 用于决定 tooltip / hover 浮出这类交互是否值得启用。
 */
export function supportsHover(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  try {
    return window.matchMedia("(hover: hover)").matches;
  } catch {
    return true;
  }
}

/**
 * 是否运行在 Tauri 窗口内（而非直接用浏览器打开 dev server）。
 * 直接读 `window.__TAURI_INTERNALS__`（Tauri v2 在每个 webview 里注入），
 * 不引入 `@tauri-apps/api` 依赖，保证本模块保持零依赖。
 */
function isTauriWindow(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    (window as unknown as { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__,
  );
}

/**
 * 是否具备原生窗口磨砂（Windows Acrylic / macOS Vibrancy）。
 *
 * Tauri 的窗口效果只有这两个平台有实现：`tauri::vibrancy::set_window_effects`
 * 仅按 `#[cfg(windows)]` / `#[cfg(target_os = "macos")]` 分发，Linux（WebKitGTK）
 * 分支直接返回成功但什么也不做。所以 `transparent(true)` 的窗口在 Linux 上
 * 没有任何系统层兜底，窗口背后就是桌面。浏览器里也没有系统窗口可借，
 * 一并按无磨砂处理。
 */
export function supportsNativeWindowEffects(): boolean {
  return isTauriWindow() && (isWindowsPlatform() || isMacPlatform());
}

/**
 * Linux 上是否需要前端自己把窗口裁成圆角。
 *
 * `decorations(false)` 的无边框窗口本该自己画圆角，但 `overflow:hidden` +
 * `border-radius` **裁不住 `position: fixed` 后代**（实测：`fixed inset-0` 的层
 * 依旧是直角并铺满视口），而这个界面上到处都是 `fixed inset-0`。
 * 只有 `clip-path` 加在 `<html>` 上才能既裁到 fixed 层、又不改变它们相对视口的定位。
 *
 * Windows 交给 DWM 的窗口圆角（Win11），macOS 交给系统；只有 Linux（WebKitGTK）
 * 两者都没有，才由前端兜底。移动端（Android/iOS）是系统全屏窗口，没有
 * 无边框圆角问题，不参与这个兜底。
 */
export function needsSelfDrawnWindowRadius(): boolean {
  return (
    isTauriWindow() &&
    !isMobileApp() &&
    !isWindowsPlatform() &&
    !isMacPlatform()
  );
}

const WINDOW_EFFECTS_ATTR = "data-window-effects";
const WINDOW_RADIUS_ATTR = "data-window-radius";
const NARROW_LAYOUT_ATTR = "data-narrow-layout";

/**
 * 把窗口磨砂能力写进 `<html data-window-effects="native|fallback">`，
 * `globals.css` 据此在缺少原生磨砂时补一层不透明的主题底色，并在需要时
 * 自行把整个窗口裁成圆角。
 * 必须在首屏渲染前调用，否则会先闪一帧透明背景/直角窗口。
 */
export function applyWindowEffectsSupport(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute(
    WINDOW_EFFECTS_ATTR,
    supportsNativeWindowEffects() ? "native" : "fallback",
  );
  root.setAttribute(
    WINDOW_RADIUS_ATTR,
    needsSelfDrawnWindowRadius() ? "self" : "native",
  );
  applyNarrowLayoutMode();
}

/**
 * 把「是否窄屏模式」写进 `<html data-narrow-layout="on|off">`，供
 * `globals.css` 的 `narrow:` / `wide:` 变体（见 `@custom-variant`）分流。
 *
 * 由 `isNarrowLayout()` 决定 —— 即**只看操作系统**，与窗口/视口宽度无关。
 * 写入 `html` 而不是某个容器：`<body>` 下还有大量 portal 出来的浮层
 * （弹窗、抽屉、FAB）不在布局 DOM 树里，只有根元素能覆盖到它们。
 *
 * `applyWindowEffectsSupport()` 会顺带调用；`index.html` 的启动内联脚本
 * 也写了同一个属性 —— 那次写入早于样式表首帧，保证不会先闪一帧桌面版式。
 */
export function applyNarrowLayoutMode(): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute(
    NARROW_LAYOUT_ATTR,
    isNarrowLayout() ? "on" : "off",
  );
}
