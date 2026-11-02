import React from "react";
import ReactDOM from "react-dom/client";
import { TrayPanel } from "./components/tray-panel";
import "./styles/globals.css";
import { getConfig } from "./utils/configService";
import { listen } from "@tauri-apps/api/event";
import { setInitialLanguage } from "./i18n";
import logger from "./utils/logger";
import { applyWindowEffectsSupport } from "./utils/platform";
import {
  applyThemeColor,
  applyThemeMode,
  resolveThemeColor,
  loadTheme,
  type ThemeColor,
  type ThemeMode,
} from "./utils/theme";

/**
 * 托盘面板的第二入口（tray-panel.html）。
 * 在渲染前同步语言与完整主题（模式 / 主题色 / 玻璃清晰度），
 * 使浮层与主窗口观感一致；随后订阅主题变更事件实时跟随。
 */

async function initLanguage() {
  try {
    const savedLang = await getConfig<string>("app.language");
    const lng = savedLang || (navigator.language.startsWith("zh") ? "zh" : "en");
    setInitialLanguage(lng);
  } catch (error) {
    logger.warn(
      "Failed to initialize tray panel language: " + error,
      null,
      "TrayPanelEntry",
    );
  }
}

/** 主题色变更没有独立事件，跟随 theme-changed 一并重读配置 */
async function refreshThemeColor() {
  const [colorName, customColors] = await Promise.all([
    getConfig<string>("theme_color"),
    getConfig<ThemeColor[]>("theme_custom_colors"),
  ]);
  applyThemeColor(resolveThemeColor(colorName, customColors ?? []).colors);
}

async function initTheme() {
  try {
    await loadTheme();
  } catch (error) {
    logger.warn(
      "Failed to initialize tray panel theme: " + error,
      null,
      "TrayPanelEntry",
    );
    applyThemeMode("system");
  }

  // 主窗口切换主题时广播 theme-changed，这里同步模式 + 主题色
  void listen<ThemeMode>("theme-changed", async (event) => {
    applyThemeMode(event.payload);
    await refreshThemeColor();
  });
}

void initLanguage();
void initTheme();
// 托盘浮层是独立 webview，同样需要知道有没有原生磨砂 / 是否自己裁圆角。
applyWindowEffectsSupport();

ReactDOM.createRoot(document.getElementById("tray-panel-root")!).render(
  <React.StrictMode>
    <TrayPanel />
  </React.StrictMode>,
);
