import { invoke } from "@tauri-apps/api/core";
import { isAndroidApp } from "@/utils/platform";

/**
 * 系统栏 inset —— 写入根元素的 CSS 变量。
 *
 * ## 为什么不能只靠 `env(safe-area-inset-*)`
 *
 * 那是 web 平台的标准做法，在 iOS Safari 与桌面浏览器上都工作正常。
 * **但 Android 上它恒为 0**：Android 15（API 35）起，应用 targetSdk ≥ 35 会被
 * 强制 edge-to-edge —— WebView 被排到状态栏/手势条**之下**，而 wry 的
 * Android WebView 从来没被告知这些 inset 是多少（wry 0.57 没有任何 safe-area
 * 通路，`WryActivity` 也从不调用 `setDecorFitsSystemWindows(false)`）。
 *
 * 结果是：`env(safe-area-inset-top)` 求值为 `0px`，**而状态栏就明明白白压在
 * 页面上**（实测 Pixel 7 模拟器：状态栏占 28 CSS px，env() 报 0）。
 * 任何依赖 `env()` 让开状态栏的布局，在 Android 上等于完全没让。
 *
 * ## 这里的做法
 *
 * 移动端启动时向原生问一次真实 inset（`tauri-plugin-safe-area`），把结果写成
 * CSS 变量 `--safe-area-top` / `--safe-area-bottom` / `--safe-area-left` /
 * `--safe-area-right`。globals.css 里这些变量的默认值就是 `env(...)`，
 * 因此：
 * - **Android**：原生返回真实值 → 覆盖掉 env() 的 0 → 布局正确让开；
 * - **iOS / 桌面**：原生不参与（插件只在 Android 编译），变量保持 env() 的值 →
 *   行为与改动前完全一致。
 *
 * 用 CSS 变量而不是把数值散进各处样式，是为了让「让开状态栏」这件事
 * 仍然只有**一个**真相来源。
 */

/** 与 globals.css 的 `--safe-area-*` 同名的属性名 */
const VARIABLE_NAMES = {
  top: "--safe-area-top",
  bottom: "--safe-area-bottom",
  left: "--safe-area-left",
  right: "--safe-area-right",
} as const;

interface SafeAreaInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * 把 inset 写入根元素的 CSS 变量。
 *
 * 只写**大于 0** 的值：平台报告 0 时保留 globals.css 里 `env()` 的默认值，
 * 这样 iOS/桌面完全不受这条链路影响。
 */
function applyInsets(insets: SafeAreaInsets): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const key of Object.keys(VARIABLE_NAMES) as Array<keyof typeof VARIABLE_NAMES>) {
    const value = insets[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      continue;
    }
    root.style.setProperty(VARIABLE_NAMES[key], `${value}px`);
  }
}

/**
 * 读取系统栏 inset 并写入 CSS 变量。
 *
 * 只在 Android 上真正发请求：其它平台的 `env()` 本来就是对的，多一次 IPC
 * 只是浪费。失败时静默降级 —— 退回 `env()`，也就是「状态栏可能压住顶栏」
 * 这个既有状态，而不是让整个应用起不来。
 */
export async function syncSafeAreaInsets(): Promise<void> {
  if (!isAndroidApp()) return;
  try {
    // Tauri v2 的插件命令必须带 `plugin:<plugin-name>|` 前缀
    // （与 updateService 里调用 `plugin:apk-installer|install_apk` 同一条规则）。
    const insets = await invoke<SafeAreaInsets>(
      "plugin:safe-area|get_safe_area_insets",
    );
    if (insets) applyInsets(insets);
  } catch {
    // 插件不可用（非 Android 构建、或 IPC 失败）——保留 env() 的默认值。
  }
}
