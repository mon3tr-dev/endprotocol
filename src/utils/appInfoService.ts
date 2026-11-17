import { getIdentifier, getTauriVersion, getVersion } from "@tauri-apps/api/app";
import logger from "@/utils/logger";

/**
 * 应用元信息（版本 / Tauri 版本 / 应用标识符）读取封装。
 *
 * 为什么不能直接调 `@tauri-apps/api/app`：这三个值都走 IPC
 * （`plugin:app|version` / `plugin:app|tauri_version` / `plugin:app|identifier`）。
 * 命令缺失、ACL 拒绝或者返回空串时调用会 reject 或拿到 `""`；调用方若把它们
 * 和其他配置读取塞进同一个 `Promise.all`，一次失败就会连带整块配置不落地，
 * 界面上看起来就是「版本卡片一直是 ...」。以前 Android 上就出现过这种表现。
 *
 * 这里的约定是 **永不 reject、永不返回空串**：IPC 失败时退回构建期常量
 * （Vite `define` 注入，见 `vite.config.ts`），保证卡片上永远有值。
 */

/** 兜底版本号：`package.json` 的 version（CI 会按 git tag 改写）。 */
const BUILD_APP_VERSION: string = __APP_VERSION__;

/** 兜底 Tauri 版本：`Cargo.lock` 里 `tauri` 包的版本（即实际编进二进制的核心版本）。 */
const BUILD_TAURI_VERSION: string = __TAURI_CORE_VERSION__;

/** 兜底标识符：`tauri.conf.json` 的 identifier。 */
const BUILD_IDENTIFIER: string = __APP_IDENTIFIER__;

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 应用版本（如 `0.1.7-pre4`）。IPC 失败时用构建期常量。 */
export async function getAppVersion(): Promise<string> {
  try {
    const version = normalize(await getVersion());
    if (version) return version;
    logger.warn(
      "getVersion returned an empty value; falling back to the build constant",
      { fallback: BUILD_APP_VERSION },
      "AppInfoService",
    );
  } catch (error) {
    logger.warn(
      "getVersion failed; falling back to the build constant",
      { error: String(error), fallback: BUILD_APP_VERSION },
      "AppInfoService",
    );
  }
  return BUILD_APP_VERSION;
}

/** Tauri 核心版本（如 `2.12.5`）。IPC 失败时用 `Cargo.lock` 里锁定的版本。 */
export async function getTauriVersionSafe(): Promise<string> {
  try {
    const version = normalize(await getTauriVersion());
    if (version) return version;
    logger.warn(
      "getTauriVersion returned an empty value; falling back to the build constant",
      { fallback: BUILD_TAURI_VERSION },
      "AppInfoService",
    );
  } catch (error) {
    logger.warn(
      "getTauriVersion failed; falling back to the build constant",
      { error: String(error), fallback: BUILD_TAURI_VERSION },
      "AppInfoService",
    );
  }
  return BUILD_TAURI_VERSION;
}

/** 应用标识符（如 `cn.msk-network.endprotocol`）。IPC 失败时用配置里的常量。 */
export async function getAppIdentifier(): Promise<string> {
  try {
    const identifier = normalize(await getIdentifier());
    if (identifier) return identifier;
    logger.warn(
      "getIdentifier returned an empty value; falling back to the build constant",
      { fallback: BUILD_IDENTIFIER },
      "AppInfoService",
    );
  } catch (error) {
    logger.warn(
      "getIdentifier failed; falling back to the build constant",
      { error: String(error), fallback: BUILD_IDENTIFIER },
      "AppInfoService",
    );
  }
  return BUILD_IDENTIFIER;
}
