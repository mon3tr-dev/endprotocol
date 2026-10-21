import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// ========== Types ==========

export type GameChannel = "official" | "bilibili" | "global" | "google_play";

export interface GameStatus {
  is_installed: boolean;
  has_update: boolean;
  local_version: string | null;
  remote_version: string | null;
  has_preload: boolean;
  preload_version: string | null;
  preload_installable: boolean;
  /** 预下载分卷需下载的总字节数（无预下载时为 0） */
  preload_total_bytes: number;
  preload_completed: boolean;
  active_operation: ActiveOperation | null;
}

export interface ActiveOperation {
  type: "installing" | "verifying" | "repairing" | "switching";
  stage?: string;
  phase?: string;
  downloaded?: number;
  total?: number;
  current_file?: string | null;
  file_index?: number;
  file_count?: number;
  verified_bytes?: number;
  from_channel?: string;
  to_channel?: string;
}

export interface RemotePackage {
  version: string;
  resource_base_url: string;
}

export interface DownloadProgress {
  downloaded: number;
  total: number;
  stage: string;
  current_file: string | null;
  file_index: number;
  file_count: number;
  verified_bytes: number;
}

export interface BackgroundMedia {
  image_url: string | null;
  video_url: string | null;
}

/**
 * 后端启动结果里的 `<token>: <detail>` 契约：token 决定用哪条 i18n 文案，
 * detail 是后端给的技术细节（英文诊断/错误码），不含用户可见文案。
 */
export const LAUNCH_TOKEN_KEYS: Record<string, string> = {
  not_found: "launcher.launch_err_not_found",
  no_launcher: "launcher.launch_err_no_launcher",
  cancelled: "launcher.launch_err_cancelled",
  create: "launcher.launch_err_create",
  wait_failed: "launcher.launch_err_wait",
  fallback: "launcher.launch_fallback_body",
  unknown: "launcher.launch_err_unknown",
};

export function splitLaunchToken(message: string): {
  token: string;
  detail: string;
} {
  const separator = message.indexOf(":");
  if (separator < 0) return { token: "", detail: message.trim() };
  return {
    token: message.slice(0, separator).trim(),
    detail: message.slice(separator + 1).trim(),
  };
}

export interface LauncherResult {
  success: boolean;
  message: string;
  version: string | null;
  /** 非致命提示，格式同 message（`<token>: <detail>`）。 */
  warning?: string | null;
}

export interface PayloadState {
  channel: string;
  version: string;
  manifest_sha256: string;
  file_count: number;
  total_bytes: number;
  updated_at: string;
  preload_version: string | null;
  preload_completed: boolean;
}

export interface BannerItem {
  image_url: string;
  jump_url: string;
}

export interface AnnouncementItem {
  category: string;
  title: string;
  date: string;
  jump_url: string;
}

export interface LauncherNoticeContent {
  banners: BannerItem[];
  announcements: AnnouncementItem[];
}

export interface FileScanResult {
  channel_detected: boolean;
  detected_channel: string | null;
  total_files: number;
  valid_files: number;
  corrupted_files: number;
  missing_files: number;
  existing_bytes: number;
  download_bytes: number;
  corrupted_file_list: string[];
  missing_file_list: string[];
}

export interface DiskSpace {
  total: number;
  free: number;
}

/** 游戏运行时长快照（仅统计 EndProtocol 运行期间） */
export interface GamePlaytime {
  /** 已累计的总时长（不含当前会话），秒 */
  total_seconds: number;
  /** 当前会话已运行时长（未运行时为 0），秒 */
  session_seconds: number;
  /** 游戏进程当前是否在运行 */
  running: boolean;
}

// ========== API Calls ==========

export async function checkGameStatus(
  channel: GameChannel,
  installPath: string,
): Promise<GameStatus> {
  return invoke<GameStatus>("launcher_check_status", { channel, installPath });
}

export async function installOrUpdate(
  channel: GameChannel,
  installPath: string,
): Promise<LauncherResult> {
  return invoke<LauncherResult>("launcher_install_or_update", {
    channel,
    installPath,
  });
}

export async function verifyAndRepair(
  channel: GameChannel,
  installPath: string,
  maxConcurrent?: number,
  quick?: boolean,
): Promise<LauncherResult> {
  const result = await invoke<LauncherResult>("launcher_verify_and_repair", {
    channel,
    installPath,
    maxConcurrent: maxConcurrent ?? null,
    quick: quick ?? false,
  });
  if (!result.success) {
    throw result.message;
  }
  return result;
}

export function getProcessReadBytes(): Promise<number> {
  return invoke<number>("launcher_get_process_read_bytes");
}

export async function getRemoteVersion(
  channel: GameChannel,
): Promise<RemotePackage> {
  return invoke<RemotePackage>("launcher_get_remote_version", { channel });
}

export async function getPayloadState(
  channel: GameChannel,
): Promise<PayloadState | null> {
  return invoke<PayloadState | null>("launcher_get_payload_state", { channel });
}

export async function cancelDownload(installPath?: string): Promise<void> {
  return invoke("launcher_cancel_download", { installPath: installPath ?? null });
}

export async function preloadDownload(
  channel: GameChannel,
  installPath: string,
  maxConcurrent?: number,
): Promise<LauncherResult> {
  return invoke<LauncherResult>("launcher_preload_download", {
    channel,
    installPath,
    maxConcurrent: maxConcurrent ?? null,
  });
}

export async function installPreload(
  channel: GameChannel,
  installPath: string,
  maxConcurrent?: number,
): Promise<LauncherResult> {
  return invoke<LauncherResult>("launcher_install_preload", {
    channel,
    installPath,
    maxConcurrent: maxConcurrent ?? null,
  });
}

export async function resetDownloadCancel(): Promise<void> {
  return invoke("launcher_reset_download_cancel");
}

export async function hasDownloadCache(installPath: string): Promise<boolean> {
  return invoke<boolean>("launcher_has_download_cache", { installPath });
}

export async function getBanners(
  channel: GameChannel,
): Promise<BannerItem[]> {
  return invoke<BannerItem[]>("launcher_get_banners", { channel });
}

export async function getAnnouncements(
  channel: GameChannel,
): Promise<AnnouncementItem[]> {
  return invoke<AnnouncementItem[]>("launcher_get_announcements", { channel });
}

export async function getNoticeContent(
  channel: GameChannel,
): Promise<LauncherNoticeContent> {
  return invoke<LauncherNoticeContent>("launcher_get_notice_content", {
    channel,
  });
}

export async function getBackgroundImage(
  channel: GameChannel,
): Promise<BackgroundMedia | null> {
  return invoke<BackgroundMedia | null>("launcher_get_background_image", {
    channel,
  });
}

export async function startGame(
  installPath: string,
  channel: GameChannel,
  dx11?: boolean,
): Promise<LauncherResult> {
  await invoke("set_config", {
    key: "launcher_install_path",
    value: installPath,
  });
  await invoke("set_config", { key: "launcher_channel", value: channel });
  return invoke<LauncherResult>("launcher_start_game", {
    installPath,
    channel,
    dx11,
  });
}

export async function syncSilentLaunchConfig(): Promise<void> {
  const installPath = localStorage.getItem("launcher_install_path");
  const channel = localStorage.getItem("launcher_channel");
  const dx11 = localStorage.getItem("launcher_dx11");
  if (installPath) {
    await invoke("set_config", {
      key: "launcher_install_path",
      value: installPath,
    });
  }
  if (channel) {
    await invoke("set_config", { key: "launcher_channel", value: channel });
  }
  if (dx11 !== null) {
    await invoke("set_config", {
      key: "launcher_dx11",
      value: dx11 === "true",
    });
  }
}

export async function restoreLaunchConfig(): Promise<void> {
  try {
    const installPath = await invoke<string | null>("get_config", {
      key: "launcher_install_path",
    });
    if (installPath) {
      localStorage.setItem("launcher_install_path", installPath);
    }
    const channel = await invoke<string | null>("get_config", {
      key: "launcher_channel",
    });
    if (channel) {
      localStorage.setItem("launcher_channel", channel);
    }
    const dx11 = await invoke<boolean | null>("get_config", {
      key: "launcher_dx11",
    });
    if (typeof dx11 === "boolean") {
      localStorage.setItem("launcher_dx11", String(dx11));
    }
  } catch {
    // 后端不可用时保留 localStorage 现状
  }
}

export async function getGameLaunchCommand(): Promise<string> {
  return invoke<string>("get_game_launch_command");
}

export interface LaunchExportOptions {
  closeAfterLaunch?: boolean;
  dx11?: boolean;
}

export async function createGameShortcut(
  options?: LaunchExportOptions,
): Promise<string | null> {
  return invoke<string | null>("create_game_shortcut", {
    closeAfterLaunch: options?.closeAfterLaunch ?? false,
    dx11: options?.dx11,
  });
}

export async function createLaunchBat(
  options?: LaunchExportOptions,
): Promise<string | null> {
  return invoke<string | null>("create_launch_bat", {
    closeAfterLaunch: options?.closeAfterLaunch ?? false,
    dx11: options?.dx11,
  });
}

export async function browseFolder(): Promise<string | null> {
  return invoke<string | null>("launcher_browse_folder");
}

export async function checkExecutable(
  installPath: string,
  channel: GameChannel,
): Promise<boolean> {
  return invoke<boolean>("launcher_check_executable", {
    installPath,
    channel,
  });
}

export async function checkGameRunning(
  channel: GameChannel,
): Promise<boolean> {
  return invoke<boolean>("launcher_check_game_running", {
    channel,
  });
}

export async function killGame(
  channel: GameChannel,
): Promise<boolean> {
  return invoke<boolean>("launcher_kill_game", {
    channel,
  });
}

export async function getGamePlaytime(): Promise<GamePlaytime> {
  return invoke<GamePlaytime>("launcher_get_game_playtime");
}

export async function detectChannel(
  installPath: string,
): Promise<GameChannel | null> {
  return invoke<GameChannel | null>("launcher_detect_channel", { installPath });
}

export async function scanInstallDir(
  channel: GameChannel,
  installPath: string,
): Promise<FileScanResult> {
  return invoke<FileScanResult>("launcher_scan_install_dir", {
    channel,
    installPath,
  });
}

export async function getDiskSpace(path: string): Promise<DiskSpace> {
  return invoke<DiskSpace>("launcher_get_disk_space", { path });
}

export async function switchChannel(
  fromChannel: GameChannel,
  toChannel: GameChannel,
  installPath: string,
): Promise<string> {
  return invoke<string>("launcher_switch_channel", {
    fromChannel,
    toChannel,
    installPath,
  });
}

export async function cancelSwitch(): Promise<void> {
  return invoke<void>("launcher_cancel_switch");
}

export async function cancelAll(): Promise<void> {
  return invoke<void>("launcher_cancel_all");
}

// ========== Event Listener ==========

export function onLauncherProgress(
  callback: (progress: DownloadProgress) => void,
): Promise<UnlistenFn> {
  return listen<DownloadProgress>("launcher-progress", (event) => {
    callback(event.payload);
  });
}

export function onProgress(
  callback: (op: ActiveOperation) => void,
): Promise<UnlistenFn> {
  return listen<ActiveOperation>("launcher://progress", (event) => {
    callback(event.payload);
  });
}

export function onSwitchProgress(
  callback: (progress: DownloadProgress) => void,
): Promise<UnlistenFn> {
  return listen<DownloadProgress>("launcher://switch-progress", (event) => {
    callback(event.payload);
  });
}

// ========== Helpers ==========

export const CHANNEL_LABELS: Record<GameChannel, Record<string, string>> = {
  official: { zh: "终末地 官服", en: "Endfield CN" },
  bilibili: { zh: "终末地 B服", en: "Endfield Bilibili" },
  global: { zh: "终末地 国际服", en: "Endfield Global" },
  google_play: { zh: "终末地 Google Play", en: "Endfield Google Play" },
};

export const ALL_CHANNELS: GameChannel[] = [
  "official",
  "bilibili",
  "global",
  "google_play",
];

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export const STAGE_LABELS: Record<string, Record<string, string>> = {
  checking: { zh: "检查中", en: "Checking" },
  comparing: { zh: "比较中", en: "Comparing" },
  downloading: { zh: "下载中", en: "Downloading" },
  verifying: { zh: "校验中", en: "Verifying" },
  repairing: { zh: "修复中", en: "Repairing" },
  applying: { zh: "应用中", en: "Applying" },
  completed: { zh: "已完成", en: "Completed" },
  error: { zh: "出错了", en: "Error" },
};
