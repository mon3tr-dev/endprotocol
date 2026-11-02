import { getConfig } from "@/utils/configService";

/**
 * 主题系统的单一数据源。
 *
 * 主窗口（main.tsx）、设置页（appearance-settings.tsx）、侧栏切换（theme-switch.tsx）
 * 与托盘面板（tray-panel.tsx）都从这里取预设色板 / 应用函数，
 * 避免此前「每个入口各写一份 PRESET_COLORS」导致托盘窗口拿不到自定义主题色的问题。
 */

export type ThemeMode = "light" | "dark" | "system";

export interface ThemeColor {
  name: string;
  label: string;
  colors: {
    50: string;
    100: string;
    200: string;
    300: string;
    400: string;
    500: string;
    600: string;
    700: string;
    800: string;
    900: string;
    foreground: string;
  };
}

/** 默认主题色（与设置页「预设」首项一致） */
export const DEFAULT_THEME_COLOR = "indigo";

export const PRESET_COLORS: ThemeColor[] = [
  {
    name: "indigo",
    label: "Indigo",
    colors: {
      50: "#eef2ff",
      100: "#e0e7ff",
      200: "#c7d2fe",
      300: "#a5b4fc",
      400: "#818cf8",
      500: "#6366f1",
      600: "#4f46e5",
      700: "#4338ca",
      800: "#3730a3",
      900: "#312e81",
      foreground: "#ffffff",
    },
  },
  {
    name: "blue",
    label: "Blue",
    colors: {
      50: "#eff6ff",
      100: "#dbeafe",
      200: "#bfdbfe",
      300: "#93c5fd",
      400: "#60a5fa",
      500: "#3b82f6",
      600: "#2563eb",
      700: "#1d4ed8",
      800: "#1e40af",
      900: "#1e3a8a",
      foreground: "#ffffff",
    },
  },
  {
    name: "emerald",
    label: "Emerald",
    colors: {
      50: "#ecfdf5",
      100: "#d1fae5",
      200: "#a7f3d0",
      300: "#6ee7b7",
      400: "#34d399",
      500: "#10b981",
      600: "#059669",
      700: "#047857",
      800: "#065f46",
      900: "#064e3b",
      foreground: "#ffffff",
    },
  },
  {
    name: "rose",
    label: "Rose",
    colors: {
      50: "#fff1f2",
      100: "#ffe4e6",
      200: "#fecdd3",
      300: "#fda4af",
      400: "#fb7185",
      500: "#f43f5e",
      600: "#e11d48",
      700: "#be123c",
      800: "#9f1239",
      900: "#881337",
      foreground: "#ffffff",
    },
  },
  {
    name: "amber",
    label: "Amber",
    colors: {
      50: "#fffbeb",
      100: "#fef3c7",
      200: "#fde68a",
      300: "#fcd34d",
      400: "#fbbf24",
      500: "#f59e0b",
      600: "#d97706",
      700: "#b45309",
      800: "#92400e",
      900: "#78350f",
      foreground: "#ffffff",
    },
  },
  {
    name: "slate",
    label: "Slate",
    colors: {
      50: "#f8fafc",
      100: "#f1f5f9",
      200: "#e2e8f0",
      300: "#cbd5e1",
      400: "#94a3b8",
      500: "#64748b",
      600: "#475569",
      700: "#334155",
      800: "#1e293b",
      900: "#0f172a",
      foreground: "#ffffff",
    },
  },
];

/** 系统是否处于深色外观 */
export function isSystemDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** 预设 + 用户自定义色板 */
export function getAllColors(customColors: ThemeColor[] = []): ThemeColor[] {
  return [...PRESET_COLORS, ...customColors];
}

/** 按名称查找色板，未命中返回 undefined（调用方自行决定兜底） */
export function findColorByName(
  name: string,
  customColors: ThemeColor[] = [],
): ThemeColor | undefined {
  return getAllColors(customColors).find((color) => color.name === name);
}

/**
 * 解析实际生效的色板：自定义色优先，其次预设，最后回退首项。
 * 自定义色被删除后配置里可能残留旧名称，这里保证永远有可用色板。
 */
export function resolveThemeColor(
  name: string | null | undefined,
  customColors: ThemeColor[] = [],
): ThemeColor {
  return findColorByName(name ?? DEFAULT_THEME_COLOR, customColors) ?? getAllColors(customColors)[0];
}

/**
 * 相对亮度（WCAG 2.1 定义），用于挑选前景色。
 * 输入 "#rrggbb"；非法输入返回 null，调用方保留原配置。
 */
function relativeLuminance(hex: string): number | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const int = parseInt(m[1], 16);
  const channels = [(int >> 16) & 255, (int >> 8) & 255, int & 255];
  const linear = channels.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/**
 * 把颜色朝黑/白混合，直到与给定背景的对比度达标，返回十六进制。
 *
 * 为什么要算而不是直接取某个色阶：主题色可以由用户任意指定（#00FFBC、
 * #66CCFF 甚至纯白）。`text-primary` 直接用主色时，#00FFBC 落在浅色底上
 * 只有 1.25:1——选中按钮、链接、数值高亮全部读不清。这里保证文字色
 * 一定能达到 WCAG AA 的 4.5:1，同时尽量保留原色相（只调明度）。
 */
function mixUntilContrast(fg: string, bg: string, toward: string, target = 4.5): string {
  const fgLum = relativeLuminance(fg);
  const bgLum = relativeLuminance(bg);
  const towardLum = relativeLuminance(toward);
  if (fgLum === null || bgLum === null || towardLum === null) return fg;

  const contrast = (a: number, b: number) => {
    const hi = Math.max(a, b);
    const lo = Math.min(a, b);
    return (hi + 0.05) / (lo + 0.05);
  };
  if (contrast(fgLum, bgLum) >= target) return fg;

  const from = parseInt(fg.slice(1), 16);
  const to = parseInt(toward.slice(1), 16);
  let best = fg;
  for (let step = 1; step <= 20; step++) {
    const k = step / 20;
    const channel = (shift: number) => {
      const a = (from >> shift) & 255;
      const b = (to >> shift) & 255;
      return Math.round(a * (1 - k) + b * k);
    };
    const candidate =
      "#" +
      [16, 8, 0]
        .map((shift) => channel(shift).toString(16).padStart(2, "0"))
        .join("");
    const lum = relativeLuminance(candidate);
    if (lum !== null && contrast(lum, bgLum) >= target) {
      best = candidate;
      break;
    }
    best = candidate;
  }
  return best;
}

/**
 * 挑选落在该主题色上的前景色。
 *
 * 必须自动算，不能信配色表里的 `foreground`：用户可以自由建自定义主题色，
 * 例如 #00FFBC 这种高亮青绿——配表里的 #ffffff 落在它上面只有约 1.2:1，
 * 主按钮/徽章/标题栏模式切换上的文字会直接读不出来（WCAG AA 正文要
 * ≥4.5:1）。规则：取黑/白中与该底色对比度更高的一个，
 * 阈值取亮度 0.5（两种极端色的对比度在此处交叉）。
 */
export function pickForegroundOn(hex: string, fallback = "#ffffff"): string {
  const lum = relativeLuminance(hex);
  if (lum === null) return fallback;
  const contrastWithWhite = 1.05 / (lum + 0.05);
  const contrastWithBlack = (lum + 0.05) / 0.05;
  return contrastWithWhite >= contrastWithBlack ? "#ffffff" : "#0b0b0d";
}

/** 当前主题的正文底色（与 --background / --surface 保持一致） */
function currentSurfaceColor(): string {
  return document.documentElement.classList.contains("dark")
    ? "#0b0b0d"
    : "#fafafa";
}

/**
 * 计算并写入 `--primary-text`：主色"当作文本色"时的可读版本。
 *
 * 浅色主题往下压（混黑）、深色主题往上提（混白），只调明度不换色相，
 * 所以仍看得出是同一个主题色。`text-primary` 一律读它，而不是直接读
 * `--primary`（后者是给背景/边框用的，可以任意鲜艳）。
 */
export function applyPrimaryTextColor(primary: string) {
  const bg = currentSurfaceColor();
  const toward = document.documentElement.classList.contains("dark")
    ? "#ffffff"
    : "#000000";
  document.documentElement.style.setProperty(
    "--primary-text",
    mixUntilContrast(primary, bg, toward),
  );
}

/**
 * 把色板写入 CSS 变量（primary 系列）。
 *
 * 玻璃底色的染色走 `--lg-fill-*`（定义在 `src/styles/globals.css` §⑤，
 * 由 `color-mix(primary X%, tint / alpha)` 算出）。自定义属性里的 `var()`
 * 在计算值阶段解析，所以这里写完 `--primary`，全应用的玻璃会自动重算，
 * 无需逐条重写填充色。模糊半径是静态令牌，运行时禁止改写（会触发
 * WebKitGTK 重合成 bug）。
 *
 * `--primary-foreground` 不直接采用配色表里的值：高亮主题色（#00FFBC /
 * #66CCFF 这类）需要足够暗的前景才读得清，见 pickForegroundOn。
 */
export function applyThemeColor(colors: ThemeColor["colors"]) {
  const root = document.documentElement;
  root.style.setProperty("--primary-50", colors[50]);
  root.style.setProperty("--primary-100", colors[100]);
  root.style.setProperty("--primary-200", colors[200]);
  root.style.setProperty("--primary-300", colors[300]);
  root.style.setProperty("--primary-400", colors[400]);
  root.style.setProperty("--primary-500", colors[500]);
  root.style.setProperty("--primary-600", colors[600]);
  root.style.setProperty("--primary-700", colors[700]);
  root.style.setProperty("--primary-800", colors[800]);
  root.style.setProperty("--primary-900", colors[900]);
  root.style.setProperty("--primary", colors[500]);
  root.style.setProperty(
    "--primary-foreground",
    pickForegroundOn(colors[500], colors.foreground),
  );
  // 文字版主色：随主题模式（浅/深）与主题色一起算，切换模式后需要重算
  applyPrimaryTextColor(colors[500]);
}

/** 切换浅色 / 深色：给 <html> 打 `dark` 类（globals.css 的 @custom-variant 依赖它） */
export function applyThemeMode(mode: ThemeMode) {
  const isDark = mode === "dark" || (mode === "system" && isSystemDark());
  document.documentElement.classList.toggle("dark", isDark);
  // --primary-text 的达标方向取决于底色是浅还是深，模式一变必须重算，
  // 否则浅色下压深的那个值会被带到深色主题上（白字场景反而读不清）。
  const primary = getComputedStyle(document.documentElement)
    .getPropertyValue("--primary")
    .trim();
  if (primary) applyPrimaryTextColor(primary);
}

export interface AppliedTheme {
  mode: ThemeMode;
  colorName: string;
}

/**
 * 读取配置并一次性应用主题（模式 + 主题色）。
 * 供主窗口启动与托盘面板每次获得焦点时调用，保证两个窗口观感一致。
 *
 * 注：旧「毛玻璃清晰度」（glass_clarity / applyGlassClarity）已随
 * Liquid Glass 重构移除——新体系的模糊半径是静态设计令牌，运行时
 * 改写模糊半径正是 WebKitGTK 模糊层重合成 bug 的触发源。
 */
export async function loadTheme(): Promise<AppliedTheme> {
  const [savedMode, savedColor, customColors] = await Promise.all([
    getConfig<ThemeMode>("theme_mode"),
    getConfig<string>("theme_color"),
    getConfig<ThemeColor[]>("theme_custom_colors"),
  ]);

  const mode = savedMode ?? "system";
  const custom = customColors ?? [];
  const color = resolveThemeColor(savedColor, custom);

  applyThemeColor(color.colors);
  applyThemeMode(mode);

  return { mode, colorName: color.name };
}
