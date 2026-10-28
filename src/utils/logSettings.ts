import { invoke } from "@tauri-apps/api/core";
import { getConfig, setConfig } from "@/utils/configService";
import logger, {
  LogLevel,
  logLevelToConfigValue,
  parseLogLevel,
} from "@/utils/logger";

/** 与后端共享的配置键，值为 "debug" | "info" | "warn" | "error"。 */
export const LOG_LEVEL_CONFIG_KEY = "log_level";

let initialized = false;
let developerMode = false;
let preferredLevel = LogLevel.DEBUG;

/** 未开启开发者模式时，至少屏蔽 DEBUG。 */
export function resolveEffectiveLogLevel(
  devMode: boolean,
  level: LogLevel,
): LogLevel {
  return devMode ? level : Math.max(level, LogLevel.INFO);
}

function applyLevel(): void {
  const effective = resolveEffectiveLogLevel(developerMode, preferredLevel);
  logger.updateConfig({ minLevel: effective });

  // 后端日志级别需要单独同步；浏览器环境下 invoke 不可用，忽略即可。
  void invoke("set_log_level", {
    level: logLevelToConfigValue(effective),
  }).catch(() => {
    // Tauri unavailable (e.g. plain Vite preview).
  });
}

export function handleDeveloperModeChange(enabled: boolean): void {
  developerMode = enabled;
  applyLevel();
}

/** 在开发者模式中调整日志级别并持久化。 */
export async function setLogLevel(level: LogLevel): Promise<void> {
  preferredLevel = level;
  await setConfig(LOG_LEVEL_CONFIG_KEY, logLevelToConfigValue(level));
  applyLevel();
}

/**
 * 读取开发者模式与日志级别配置。
 * 未开启开发者模式时强制提升到 INFO，避免默认刷屏 DEBUG。
 */
export async function initLogSettings(): Promise<void> {
  if (initialized) return;
  initialized = true;

  try {
    const [devMode, savedLevel] = await Promise.all([
      getConfig<boolean>("developer_mode"),
      getConfig<string>(LOG_LEVEL_CONFIG_KEY),
    ]);
    developerMode = devMode ?? false;
    preferredLevel = parseLogLevel(savedLevel, LogLevel.DEBUG);
    applyLevel();
  } catch {
    // 配置读取失败时保持 logger 的默认 INFO 级别。
    logger.updateConfig({ minLevel: LogLevel.INFO });
  }

  window.addEventListener("developerModeChange", (event) => {
    const detail = (event as CustomEvent<{ enabled?: boolean }>).detail;
    if (typeof detail?.enabled === "boolean") {
      handleDeveloperModeChange(detail.enabled);
    }
  });
}
