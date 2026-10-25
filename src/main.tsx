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
import {
  DEFAULT_GLASS_CLARITY,
  applyGlassClarity,
  applyThemeColor,
  applyThemeMode,
  resolveThemeColor,
  type ThemeColor,
  type ThemeMode,
} from "@/utils/theme";

// Initialize crash handling before any startup work can fail.
installCrashHandlers();
// main.tsx 已执行：取消 index.html 中针对「前端脚本未启动」的静态兜底计时器，
// 并撤销静态面板（避免慢启动时残留误报）。
window.clearTimeout(window.__endprotocolBootTimer);
const bootErrorPanel = document.getElementById("startup-splash-error");
if (bootErrorPanel) {
  bootErrorPanel.hidden = true;
  document.getElementById("startup-splash-export")?.removeAttribute("style");
  document.getElementById("startup-splash-open-logs")?.removeAttribute("style");
}

// Initialize language and theme from config service before rendering
setStartupPhase(12, i18n.t("startup.loadingSettings"));
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
  getConfig<number>("glass_clarity"),
  loadBackgroundSettings(),
  loadAccountAvailability(),
]).then(([savedLang, savedMode, savedColor, savedCustom, savedClarity]) => {
  const lng = savedLang || (navigator.language.startsWith("zh") ? "zh" : "en");
  setInitialLanguage(lng);
  setStartupPhase(30, i18n.t("startup.loadingData"));

  // Apply theme before render to avoid flash
  const colors = resolveThemeColor(savedColor, savedCustom ?? []).colors;
  applyThemeColor(colors);
  applyThemeMode(savedMode ?? "system");
  applyGlassClarity(savedClarity ?? DEFAULT_GLASS_CLARITY);

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
