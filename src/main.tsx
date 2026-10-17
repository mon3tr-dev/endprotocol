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
import { roleDataService } from "@/utils/roleDataService";
import { getAccounts } from "@/utils/accountService";
import { invoke } from "@tauri-apps/api/core";
import { loadBackgroundSettings } from "@/utils/backgroundSettings";
import { syncSilentLaunchConfig } from "@/utils/launcherService";
import {
  beginStartupTracking,
  failStartup,
  setStartupPhase,
  trackStartupTask,
} from "@/utils/startupProgress";

type ThemeMode = "light" | "dark" | "system";

interface ThemeColor {
  name: string;
  colors: Record<string, string>;
}

const PRESET_COLORS: Record<string, Record<string, string>> = {
  indigo: {
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
  blue: {
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
  emerald: {
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
  rose: {
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
  amber: {
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
  slate: {
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
};

function findColors(
  colorName: string,
  customColors: ThemeColor[],
): Record<string, string> | undefined {
  const custom = customColors.find((c) => c.name === colorName);
  if (custom) return custom.colors;
  return PRESET_COLORS[colorName];
}

function applyThemeColor(colors: Record<string, string>) {
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

function applyThemeMode(mode: ThemeMode) {
  const root = document.documentElement;
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = mode === "dark" || (mode === "system" && systemDark);
  root.classList.toggle("dark", isDark);
}

// Initialize language and theme from config service before rendering
setStartupPhase(12, i18n.t("startup.loadingSettings"));
void syncSilentLaunchConfig().catch((error: unknown) => {
  logger.warn("Failed to sync game launch config: " + error, "Main");
});
Promise.all([
  getConfig<string>("app.language"),
  getConfig<ThemeMode>("theme_mode"),
  getConfig<string>("theme_color"),
  getConfig<ThemeColor[]>("theme_custom_colors"),
  loadBackgroundSettings(),
]).then(([savedLang, savedMode, savedColor, savedCustom]) => {
  const lng = savedLang || (navigator.language.startsWith("zh") ? "zh" : "en");
  setInitialLanguage(lng);
  setStartupPhase(30, i18n.t("startup.loadingData"));

  // Apply theme before render to avoid flash
  const colorName = savedColor ?? "indigo";
  const colors = findColors(colorName, savedCustom ?? []);
  if (colors) applyThemeColor(colors);
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
        const result = await roleDataService.queryData(
          trayRoleId,
          "char_detail",
          ["dungeon", "bpSystem", "dailyMission", "weeklyMission"],
        );
        const accs = await getAccounts();
        const account = accs.find((a) => a.id === trayRoleId);
        await invoke("update_tray_user_data", {
          userInfo: {
            roleId: trayRoleId,
            nickname: account?.nickname ?? null,
            avatar: account?.avatar ?? null,
            curStamina: Number(result?.dungeon?.curStamina) || 0,
            maxStamina: Number(result?.dungeon?.maxStamina) || 0,
            maxTs: Number(result?.dungeon?.maxTs) || 0,
            dailyActivation: Number(result?.dailyMission?.dailyActivation) || 0,
            maxDailyActivation:
              Number(result?.dailyMission?.maxDailyActivation) || 0,
            weeklyScore: Number(result?.weeklyMission?.score) || 0,
            weeklyTotal: Number(result?.weeklyMission?.total) || 0,
            bpCurLevel: Number(result?.bpSystem?.curLevel) || 0,
            bpMaxLevel: Number(result?.bpSystem?.maxLevel) || 0,
          },
        });
      }
    } catch (err) {
      logger.error("Failed to fetch tray user data on startup: " + err);
    }
  }, 5000);
}).catch((error: unknown) => {
  logger.error("Failed to initialize the application", error);
  failStartup(i18n.t("startup.failed"));
});
