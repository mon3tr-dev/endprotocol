import { invoke } from "@tauri-apps/api/core";
import { logError, logWarn } from "@/utils/logger";
import { getConfig, setConfig } from "@/utils/configService";
import type { SystemResourceDefaults, SystemSnapshot } from "@/types/system-resource";
import { DEFAULT_SYSTEM_RESOURCE_DEFAULTS } from "@/types/system-resource";

export interface SnapshotResult {
  /** 是否成功拿到快照 */
  ok: boolean;
  data?: SystemSnapshot;
  /** 失败时的友好错误信息 */
  error?: string;
}

/**
 * 系统资源采集服务封装。
 *
 * 后端 `get_system_snapshot` 命令返回 camelCase 快照；本服务把异常统一转换为
 * `{ ok:false, error }`，调用方据此展示友好提示而不崩溃。
 */
export class SystemResourceService {
  static async getSnapshot(): Promise<SnapshotResult> {
    try {
      const data = await invoke<SystemSnapshot>("get_system_snapshot");
      return { ok: true, data };
    } catch (error) {
      logWarn("Failed to collect system snapshot: " + error, "SystemResourceService");
      return { ok: false, error: String(error) };
    }
  }

  /** 忽略失败、仅取数据的便捷方法（用于历史曲线等非关键路径）。 */
  static async safeSnapshot(): Promise<SystemSnapshot | null> {
    try {
      const result = await SystemResourceService.getSnapshot();
      return result.ok && result.data ? result.data : null;
    } catch (error) {
      logError("Unexpected error while collecting snapshot:", error);
      return null;
    }
  }
}

export type { SystemSnapshot };

/** 全局默认值结构版本：v2 起历史曲线默认开启 */
const DEFAULTS_VERSION_KEY = "system_resource_defaults_version";
const DEFAULTS_VERSION = 2;

/**
 * 读取全局「系统资源卡片」默认值（配置键 `system_resource_defaults`）。
 * 读取失败时回退到内置默认值。
 */
export async function getSystemResourceDefaults(): Promise<SystemResourceDefaults> {
  try {
    const [stored, version] = await Promise.all([
      getConfig<Partial<SystemResourceDefaults>>("system_resource_defaults"),
      getConfig<number>(DEFAULTS_VERSION_KEY),
    ]);
    let merged: SystemResourceDefaults = {
      ...DEFAULT_SYSTEM_RESOURCE_DEFAULTS,
      ...(stored ?? {}),
    };
    // 一次性迁移：旧版本默认关闭曲线，v2 起改为默认开启
    if ((version ?? 1) < DEFAULTS_VERSION) {
      merged = { ...merged, showSparklines: true };
      await setConfig("system_resource_defaults", merged);
      await setConfig(DEFAULTS_VERSION_KEY, DEFAULTS_VERSION);
    }
    return merged;
  } catch (error) {
    logError("Failed to load system resource defaults:", error);
    return DEFAULT_SYSTEM_RESOURCE_DEFAULTS;
  }
}

/** 保存全局「系统资源卡片」默认值（合并更新）。 */
export async function setSystemResourceDefaults(
  patch: Partial<SystemResourceDefaults>,
): Promise<void> {
  try {
    const current = await getSystemResourceDefaults();
    await setConfig("system_resource_defaults", { ...current, ...patch });
  } catch (error) {
    logError("Failed to save system resource defaults:", error);
  }
}
