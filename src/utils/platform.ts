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
 * 两者都没有，才由前端兜底。
 */
export function needsSelfDrawnWindowRadius(): boolean {
  return (
    isTauriWindow() && !isWindowsPlatform() && !isMacPlatform()
  );
}

const WINDOW_EFFECTS_ATTR = "data-window-effects";
const WINDOW_RADIUS_ATTR = "data-window-radius";

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
}
