import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App.tsx";
import { Provider } from "./provider.tsx";
import "@/styles/globals.css";
import { setInitialLanguage } from "./i18n";
import i18n from "./i18n";
import { getConfig } from "./utils/configService";
import { CardStartupService } from "@/cards/startup-service";
import { loadAllCards } from "@/components/cards/registry/loader";
import { initOverlayScrollbar } from "@/utils/overlayScrollbar";
import { checkAndNotify } from "@/utils/updateService";
import logger from "@/utils/logger";
import { initLogSettings } from "@/utils/logSettings";
import { refreshTrayUserData } from "@/utils/trayService";
import { loadBackgroundSettings } from "@/utils/backgroundSettings";
import { syncSilentLaunchConfig } from "@/utils/launcherService";
import {
  armStartupTimeout,
  beginStartupTracking,
  failStartup,
  setStartupPhase,
  trackStartupTask,
} from "@/utils/startupProgress";
import { installCrashHandlers } from "@/utils/crashReporting";
import { loadAccountAvailability } from "@/utils/accountAvailability";
import { applyWindowEffectsSupport, isDesktopApp } from "@/utils/platform";
import { syncSafeAreaInsets } from "@/utils/safeArea";
import {
  applyThemeColor,
  applyThemeMode,
  resolveThemeColor,
  type ThemeColor,
  type ThemeMode,
} from "@/utils/theme";

// Initialize crash handling before any startup work can fail.
installCrashHandlers();

// 开发构建（或显式 VITE_DEV_DECK=1 的度量构建）下启动 devdeck 内存监视器：
// 独立窗口，Ctrl+Alt+M 打开。动态 import + 常量门控，Release 构建下整个分支被消除。
// 移动端（Android/iOS）跳过：devdeck 插件仅桌面编译注册，调用只会得到"命令不存在"。
if (
  (import.meta.env.DEV || import.meta.env.VITE_DEV_DECK === "1") &&
  isDesktopApp()
) {
  void import("tauri-plugin-devdeck").then((mod) => mod.startDevdeck());
}

// main.tsx 已执行：取消 index.html 中针对「前端脚本未启动」的静态兜底计时器，
// 并撤销静态面板（避免慢启动时残留误报）。
// 同时把标记置空：index.html 的早期错误监听只在「模块尚未接手」时报告错误，
// 之后交给 React 侧的崩溃弹窗处理。
window.clearTimeout(window.__endprotocolBootTimer);
window.__endprotocolBootTimer = undefined;
const bootErrorPanel = document.getElementById("startup-splash-error");
if (bootErrorPanel) {
  bootErrorPanel.hidden = true;
  document.getElementById("startup-splash-export")?.removeAttribute("style");
  document.getElementById("startup-splash-open-logs")?.removeAttribute("style");
}

// Initialize language and theme from config service before rendering
setStartupPhase(12, i18n.t("startup.loadingSettings"));
// 决定窗口是否需要前端自绘底色（Linux 无系统级磨砂），必须在首屏前生效。
applyWindowEffectsSupport();
// Android edge-to-edge：env(safe-area-inset-*) 在 Android WebView 里恒为 0
// （wry 从不把系统栏 inset 告诉页面），改为向原生问真实值并写入 CSS 变量。
// 必须在首屏渲染前完成 —— 否则顶栏会先闪一下被状态栏压住的样子。
// iOS/桌面不发起请求（env() 本来就是对的）。
void syncSafeAreaInsets();
// Cover the case where an IPC invoke never resolves and React is never mounted.
armStartupTimeout();
void syncSilentLaunchConfig().catch((error: unknown) => {
  logger.warn("Failed to sync game launch config: " + error, "Main");
});
Promise.all([
  getConfig<string>("app.language"),
  getConfig<ThemeMode>("theme_mode"),
  getConfig<string>("theme_color"),
  getConfig<ThemeColor[]>("theme_custom_colors"),
  loadBackgroundSettings(),
  loadAccountAvailability(),
  initLogSettings(),
]).then(([savedLang, savedMode, savedColor, savedCustom]) => {
  const lng = savedLang || (navigator.language.startsWith("zh") ? "zh" : "en");
  setInitialLanguage(lng);
  setStartupPhase(30, i18n.t("startup.loadingData"));

  // Apply theme before render to avoid flash
  const colors = resolveThemeColor(savedColor, savedCustom ?? []).colors;
  applyThemeColor(colors);
  applyThemeMode(savedMode ?? "system");

  initOverlayScrollbar();

  logger.info("Tauri interop ready", "Main");

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <BrowserRouter>
        <Provider>
          <App />
        </Provider>
      </BrowserRouter>
    </React.StrictMode>,
  );
  beginStartupTracking(
    i18n.t("startup.loadingData"),
    i18n.t("startup.ready"),
  );

  // Build card registry to register startup handlers, then run startup tasks
  loadAllCards();
  setTimeout(() => {
    void trackStartupTask(CardStartupService.runAll());
  }, 0);

  // Auto-check for updates on startup
  setTimeout(() => {
    checkAndNotify();
  }, 3000);

  // Fetch tray user data on startup
  setTimeout(async () => {
    try {
      const trayRoleId = await getConfig<string>("tray_user_role_id");
      if (trayRoleId) {
        await refreshTrayUserData(trayRoleId);
      }
    } catch (err) {
      logger.error("Failed to fetch tray user data on startup: " + err);
    }
  }, 5000);
}).catch((error: unknown) => {
  logger.error("Failed to initialize the application", error);
  failStartup(i18n.t("startup.failed"), String(error));
});
