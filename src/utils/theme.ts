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

/** 玻璃清晰度默认值（0–100，55 对应约 28px 模糊） */
export const DEFAULT_GLASS_CLARITY = 55;

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

/** 把色板写入 CSS 变量（primary 系列） */
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
  root.style.setProperty("--primary-foreground", colors.foreground);
}

/** 切换浅色 / 深色：给 <html> 打 `dark` 类（globals.css 的 @custom-variant 依赖它） */
export function applyThemeMode(mode: ThemeMode) {
  const isDark = mode === "dark" || (mode === "system" && isSystemDark());
  document.documentElement.classList.toggle("dark", isDark);
}

/** 玻璃清晰度（0–100）→ CSS 变量，与设置页滑块保持一致 */
export function applyGlassClarity(clarity: number) {
  const value = Math.max(0, Math.min(100, clarity));
  const blur = 48 - (20 / 55) * value;
  const surfaceOpacity = 63 + (15 / 55) * value;
  const root = document.documentElement;
  root.style.setProperty("--glass-blur", `${blur}px`);
  root.style.setProperty("--glass-surface-opacity", `${surfaceOpacity}%`);
  root.style.setProperty(
    "--glass-strong-opacity",
    `${Math.min(98, surfaceOpacity + 7)}%`,
  );
  root.style.setProperty("--glass-field-opacity", `${surfaceOpacity + 2}%`);
  // 原生磨砂窗口（托盘面板）也跟随「毛玻璃清晰度」：
  // 清晰度越高 → 面板越实。托盘浮层直接压在桌面上，需要比普通玻璃更宽的
  // 可调区间（38%–92%），并把底层底色乘以 --glass-native-base，
  // 让最透/最实两档的差距真的看得出来。
  root.style.setProperty(
    "--glass-native-opacity",
    `${Math.round(38 + (54 / 100) * value)}%`,
  );
  root.style.setProperty(
    "--glass-native-base",
    `${Math.round(12 + (26 / 100) * value)}%`,
  );
}

export interface AppliedTheme {
  mode: ThemeMode;
  colorName: string;
}

/**
 * 读取配置并一次性应用主题（模式 + 主题色 + 玻璃清晰度）。
 * 供主窗口启动与托盘面板每次获得焦点时调用，保证两个窗口观感一致。
 */
export async function loadTheme(): Promise<AppliedTheme> {
  const [savedMode, savedColor, customColors, savedClarity] = await Promise.all([
    getConfig<ThemeMode>("theme_mode"),
    getConfig<string>("theme_color"),
    getConfig<ThemeColor[]>("theme_custom_colors"),
    getConfig<number>("glass_clarity"),
  ]);

  const mode = savedMode ?? "system";
  const custom = customColors ?? [];
  const color = resolveThemeColor(savedColor, custom);

  applyThemeColor(color.colors);
  applyThemeMode(mode);
  applyGlassClarity(savedClarity ?? DEFAULT_GLASS_CLARITY);

  return { mode, colorName: color.name };
}
