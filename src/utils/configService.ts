import { invoke } from '@tauri-apps/api/core';
import logger from "@/utils/logger";
import { trackStartupTask } from "@/utils/startupProgress";

/**
 * 获取配置值
 * @param key 配置键
 * @returns 配置值或 null
 */
export async function getConfig<T = any>(key: string): Promise<T | null> {
  try {
    const value = await trackStartupTask(invoke<any>('get_config', { key }));
    return value ?? null;
  } catch (error) {
    logger.warn('Failed to get config from Tauri, using localStorage fallback: ' + error, "ConfigService");
    // Fallback to localStorage for development
    const value = localStorage.getItem(`config_${key}`);
    return value ? JSON.parse(value) : null;
  }
}

/**
 * 设置配置值
 * @param key 配置键
 * @param value 配置值
 */
export async function setConfig(key: string, value: any): Promise<void> {
  try {
    await invoke('set_config', { key, value });
  } catch (error) {
    logger.warn('Failed to set config via Tauri, using localStorage fallback: ' + error, "ConfigService");
    // Fallback to localStorage for development
    localStorage.setItem(`config_${key}`, JSON.stringify(value));
  }
}

/**
 * 删除配置项
 * @param key 配置键
 * @returns 是否成功删除
 */
export async function removeConfig(key: string): Promise<boolean> {
  try {
    return await invoke('remove_config', { key });
  } catch (error) {
    logger.warn('Failed to remove config via Tauri, using localStorage fallback: ' + error, "ConfigService");
    localStorage.removeItem(`config_${key}`);
    return true;
  }
}

/**
 * 获取所有配置
 *
 * ⚠️ 后端会剔除所有机密字段（凭据只存在于 OS 凭据库，不经过 IPC）。
 * @returns 所有**非机密**配置的键值对
 */
export async function getAllConfigs(): Promise<Record<string, any>> {
  try {
    return await invoke('get_all_configs');
  } catch (error) {
    logger.warn('Failed to get all configs from Tauri, using localStorage fallback: ' + error, "ConfigService");
    // Fallback to localStorage
    const configs: Record<string, any> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('config_')) {
        const configKey = key.substring(7);
        const value = localStorage.getItem(key);
        if (value) {
          configs[configKey] = JSON.parse(value);
        }
      }
    }
    return configs;
  }
}

/** 机密存储后端标识。 */
export type SecretBackend = 'credential-store' | 'encrypted-file' | 'plaintext';

/** 机密存储状态。 */
export interface SecretStorageStatus {
  /** 当前后端。`credential-store` = OS 凭据库（最强保护）。 */
  backend: SecretBackend;
  /** 是否处于降级状态（未使用 OS 凭据库）。 */
  degraded: boolean;
}

/**
 * 查询机密存储的当前保护等级。
 *
 * 用于设置页提示用户机密数据的存放位置。失败时返回 null（不阻断界面）。
 */
export async function getSecretStorageStatus(): Promise<SecretStorageStatus | null> {
  try {
    return await invoke<SecretStorageStatus>('get_secret_storage_status');
  } catch (error) {
    logger.warn('Failed to get secret storage status: ' + error, 'ConfigService');
    return null;
  }
}
