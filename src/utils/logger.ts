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

const DEFAULT_CONFIG: LoggerConfig = {
  enableConsole: true,
  enableLocalStorage: true,
  minLevel: LogLevel.DEBUG,
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

  private getLevelColor(level: LogLevel): string {
    switch (level) {
      case LogLevel.DEBUG: return "#00BCD4";
      case LogLevel.INFO: return "#4CAF50";
      case LogLevel.WARN: return "#FF9800";
      case LogLevel.ERROR: return "#F44336";
    }
  }

  private writeLog(level: LogLevel, message: string, module: string, data?: unknown): void {
    if (level < this.config.minLevel) return;

    const timestamp = this.getTimestamp();
    const entry: LogEntry = {
      timestamp,
      level,
      message,
      module,
      source: "frontend",
      data,
    };

    this.memoryBuffer.push(entry);
    if (this.memoryBuffer.length > this.maxMemorySize) {
      this.memoryBuffer.splice(0, this.memoryBuffer.length - this.maxMemorySize);
    }

    if (this.config.enableConsole) {
      const levelName = LOG_LEVEL_NAMES[level];
      const color = this.getLevelColor(level);
      const prefix = `%c[${timestamp}] [${levelName}] [${module}]`;
      const style = `color:${color};font-weight:bold`;
      switch (level) {
        case LogLevel.DEBUG:
          console.debug(prefix, style, message, data ?? "");
          break;
        case LogLevel.INFO:
          console.info(prefix, style, message, data ?? "");
          break;
        case LogLevel.WARN:
          console.warn(prefix, style, message, data ?? "");
          break;
        case LogLevel.ERROR:
          console.error(prefix, style, message, data ?? "");
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
