import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import logger, { type LogEntry } from "./logger";

export interface BackendCrashReport {
  path: string;
  file_name: string;
  timestamp: string;
  message: string;
  content: string;
  acknowledged: boolean;
}

/**
 * 打包前端/后端日志、崩溃报告和系统信息，返回 zip 文件路径。
 */
export async function exportDiagnostics(context?: string): Promise<string> {
  const merged = new Map<string, LogEntry>();
  for (const entry of [...logger.getPersistedLogs(), ...logger.getLogs()]) {
    merged.set(
      `${entry.timestamp}|${entry.level}|${entry.module}|${entry.message}`,
      entry,
    );
  }
  const frontendLogs = [...merged.values()]
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    .map((entry) => ({
      ...entry,
      data: sanitizeLogData(entry.data),
    }));
  return invoke<string>("export_diagnostics", {
    frontendLogs,
    context: context ?? null,
  });
}

function sanitizeLogData(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  try {
    return JSON.parse(
      JSON.stringify(value, (_key, nested) => {
        if (nested instanceof Error) {
          return { name: nested.name, message: nested.message, stack: nested.stack };
        }
        return nested;
      }),
    );
  } catch {
    return String(value);
  }
}

/** 在文件管理器中定位导出文件。 */
export async function revealDiagnostics(path: string): Promise<void> {
  await revealItemInDir(path);
}

/** 打开应用日志目录。 */
export async function openLogDirectory(): Promise<void> {
  const dir = await invoke<string>("get_log_dir");
  await revealItemInDir(dir);
}

export async function getPendingCrashReports(): Promise<BackendCrashReport[]> {
  return invoke<BackendCrashReport[]>("get_pending_crash_reports");
}

export async function acknowledgeCrashReports(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await invoke("ack_crash_reports", { paths });
}
