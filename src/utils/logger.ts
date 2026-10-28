export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: "DEBUG",
  [LogLevel.INFO]: "INFO",
  [LogLevel.WARN]: "WARN",
  [LogLevel.ERROR]: "ERROR",
};

export interface LoggerConfig {
  enableConsole: boolean;
  enableLocalStorage: boolean;
  minLevel: LogLevel;
  maxStorageSize: number;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  module: string;
  source: "frontend" | "backend";
  data?: unknown;
}

/** 调试日志过长会拖慢控制台并挤占日志面板，统一截断。 */
const MAX_DEBUG_MESSAGE_LENGTH = 600;
const MAX_DATA_LENGTH = 1200;

/**
 * 将配置值解析为日志级别。
 * 支持数字、枚举值以及 "debug"/"info"/"warn"/"error" 字符串。
 */
export function parseLogLevel(value: unknown, fallback = LogLevel.INFO): LogLevel {
  if (typeof value === "number" && value >= LogLevel.DEBUG && value <= LogLevel.ERROR) {
    return value as LogLevel;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed !== "" && /^\d+$/.test(trimmed)) {
      const numeric = Number(trimmed);
      if (numeric >= LogLevel.DEBUG && numeric <= LogLevel.ERROR) {
        return numeric as LogLevel;
      }
    }
    switch (trimmed.toLowerCase()) {
      case "debug":
        return LogLevel.DEBUG;
      case "info":
        return LogLevel.INFO;
      case "warn":
      case "warning":
        return LogLevel.WARN;
      case "error":
        return LogLevel.ERROR;
      default:
        break;
    }
  }
  return fallback;
}

/** 配置持久化使用的字符串形式。 */
export function logLevelToConfigValue(level: LogLevel): string {
  return LOG_LEVEL_NAMES[level].toLowerCase();
}

// 默认不输出 DEBUG；开发者模式会按配置提升到 DEBUG。
const DEFAULT_CONFIG: LoggerConfig = {
  enableConsole: true,
  enableLocalStorage: true,
  minLevel: LogLevel.INFO,
  maxStorageSize: 1000,
};

class Logger {
  private config: LoggerConfig;
  private storageKey = "app_logs";
  private memoryBuffer: LogEntry[] = [];
  private maxMemorySize = 5000;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private getTimestamp(): string {
    const now = new Date();
    const pad = (n: number, len = 2) => n.toString().padStart(len, "0");
    const ms = pad(now.getMilliseconds(), 3);
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${ms}`;
  }

  /** 控制台只保留时分秒，避免每行前缀过长。 */
  private getConsoleTimestamp(timestamp: string): string {
    return timestamp.slice(11);
  }

  private getLevelColor(level: LogLevel): string {
    switch (level) {
      case LogLevel.DEBUG: return "#00BCD4";
      case LogLevel.INFO: return "#4CAF50";
      case LogLevel.WARN: return "#FF9800";
      case LogLevel.ERROR: return "#F44336";
    }
  }

  private truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength)}… (${value.length} chars)`;
  }

  /** 避免超长 data 撑爆 localStorage / 控制台（仅对 DEBUG 做额外序列化检查）。 */
  private normalizeData(level: LogLevel, data: unknown): unknown {
    if (data === undefined || data === null) return data;
    if (typeof data === "string") {
      return level === LogLevel.DEBUG
        ? this.truncate(data, MAX_DATA_LENGTH)
        : data;
    }
    if (level === LogLevel.DEBUG && typeof data === "object") {
      try {
        const json = JSON.stringify(data);
        if (json.length > MAX_DATA_LENGTH) {
          return this.truncate(json, MAX_DATA_LENGTH);
        }
      } catch {
        return String(data);
      }
    }
    return data;
  }

  private getLevel(): LogLevel {
    return this.config.minLevel;
  }

  isEnabled(level: LogLevel): boolean {
    return level >= this.getLevel();
  }

  private writeLog(level: LogLevel, message: string, module: string, data?: unknown): void {
    if (!this.isEnabled(level)) return;

    const timestamp = this.getTimestamp();
    const normalizedData = this.normalizeData(level, data);
    const entry: LogEntry = {
      timestamp,
      level,
      message:
        level === LogLevel.DEBUG
          ? this.truncate(message, MAX_DEBUG_MESSAGE_LENGTH)
          : message,
      module,
      source: "frontend",
      data: normalizedData,
    };

    this.memoryBuffer.push(entry);
    if (this.memoryBuffer.length > this.maxMemorySize) {
      this.memoryBuffer.splice(0, this.memoryBuffer.length - this.maxMemorySize);
    }

    if (this.config.enableConsole) {
      const levelName = LOG_LEVEL_NAMES[level];
      const color = this.getLevelColor(level);
      const prefix = `%c${this.getConsoleTimestamp(timestamp)} [${levelName}] [${module}]`;
      const style = `color:${color};font-weight:bold`;
      const args: unknown[] = [prefix, style, entry.message];
      if (normalizedData !== undefined && normalizedData !== null) {
        args.push(normalizedData);
      }
      switch (level) {
        case LogLevel.DEBUG:
          console.debug(...args);
          break;
        case LogLevel.INFO:
          console.info(...args);
          break;
        case LogLevel.WARN:
          console.warn(...args);
          break;
        case LogLevel.ERROR:
          console.error(...args);
          break;
      }
    }

    if (this.config.enableLocalStorage && typeof window !== "undefined") {
      this.saveToLocalStorage(entry);
    }
  }

  private saveToLocalStorage(entry: LogEntry): void {
    try {
      const logs = this.getLogsFromStorage();
      logs.push(entry);
      if (logs.length > this.config.maxStorageSize) {
        logs.splice(0, logs.length - this.config.maxStorageSize);
      }
      localStorage.setItem(this.storageKey, JSON.stringify(logs));
    } catch {
      // ignore localStorage errors
    }
  }

  private getLogsFromStorage(): LogEntry[] {
    try {
      const logsStr = localStorage.getItem(this.storageKey);
      return logsStr ? JSON.parse(logsStr) : [];
    } catch {
      return [];
    }
  }

  debug(message: string, data?: unknown, module?: string): void {
    this.writeLog(LogLevel.DEBUG, message, module ?? "frontend", data);
  }

  info(message: string, data?: unknown, module?: string): void {
    this.writeLog(LogLevel.INFO, message, module ?? "frontend", data);
  }

  warn(message: string, data?: unknown, module?: string): void {
    this.writeLog(LogLevel.WARN, message, module ?? "frontend", data);
  }

  error(message: string, data?: unknown, module?: string): void {
    this.writeLog(LogLevel.ERROR, message, module ?? "frontend", data);
  }

  getLogs(): LogEntry[] {
    return [...this.memoryBuffer];
  }

  /** 读取 localStorage 中持久化的日志（跨页面重载可用，用于崩溃导出）。 */
  getPersistedLogs(): LogEntry[] {
    return this.getLogsFromStorage();
  }

  getAllLogs(backendLogs: LogEntry[] = []): LogEntry[] {
    const merged = [...backendLogs, ...this.memoryBuffer];
    merged.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return merged;
  }

  clearLogs(): void {
    this.memoryBuffer = [];
    localStorage.removeItem(this.storageKey);
  }

  updateConfig(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

const logger = new Logger();

export default logger;

export const logDebug = (message: string, data?: unknown, module?: string) => logger.debug(message, data, module);
export const logInfo = (message: string, data?: unknown, module?: string) => logger.info(message, data, module);
export const logWarn = (message: string, data?: unknown, module?: string) => logger.warn(message, data, module);
export const logError = (message: string, data?: unknown, module?: string) => logger.error(message, data, module);
