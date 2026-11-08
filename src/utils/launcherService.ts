import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// ========== Types ==========

export type GameChannel =
  | "official"
  | "bilibili"
  | "global"
  | "google_play"
  | "arknights"
  | "arknights_bilibili";

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
  /** 服务端是否下发了版本补丁包（`patch`） */
  has_patch: boolean;
  /** 补丁分卷（加密）下载总字节数 */
  patch_total_bytes: number;
  /** 是否存在未加密的整补丁包（`patch.url`） */
  has_patch_whole: boolean;
  /** 补丁包是否为差量形态（V2 索引非空，需要 hpatch；此时走整补丁 zip 或清单逐文件） */
  patch_is_delta: boolean;
  /** 未加密整补丁包地址（差量包的兜底形态，条目就是最终游戏文件） */
  patch_whole_url: string;
  /** 未加密整补丁包的 MD5（可能为空） */
  patch_whole_md5: string;
  /** 未加密整补丁包字节数 */
  patch_whole_bytes: number;
  /** 预下载分卷需下载的总字节数 */
  preload_total_bytes: number;
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
  overlay_unavailable: "launcher.launch_overlay_unavailable",
  unknown: "launcher.launch_err_unknown",
};

/** 非致命提示的标题文案：按 token 区分，缺省沿用「已直接启动」。 */
export const LAUNCH_WARNING_TITLE_KEYS: Record<string, string> = {
  fallback: "launcher.launch_fallback_title",
  overlay_unavailable: "launcher.launch_overlay_title",
};

/**
 * 「停止游戏」失败的 `<token>: <detail>` 契约（`launcher_kill_game` 返回的 Err 串），
 * 与启动结果同格式，便于复用 `splitLaunchToken`。
 */
export const KILL_TOKEN_KEYS: Record<string, string> = {
  cancelled: "launcher.stop_err_cancelled",
  kill_failed: "launcher.stop_err_kill_failed",
  unknown: "launcher.stop_err_unknown",
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
  /** 官方启动器右侧栏数据（社媒二维码 + 工具入口） */
  sidebars: SidebarItem[];
}

/**
 * 侧边栏条目（后端 `get_sidebar_rsp` 已合并成扁平结构）。
 *
 * `media` 是渠道标识（`Skland`/`Bilibili`/`Weibo`/`Taptap`/`Douyin`/
 * `Xiaohongshu`/`Wechat`/`CS`/`SklandTool`），前端据此匹配本地图标；
 * `display_type` 为 `DisplayType_LIST`（单链接）或 `DisplayType_GRID`（一组工具链接）。
 */
export interface SidebarItem {
  media: string;
  display_type: string;
  /** 悬停提示 / 二维码说明文案 */
  title: string;
  /** 二维码图片地址，空串表示无图 */
  qr_url: string;
  /** 点击打开的网页地址，空串表示只能扫码 */
  jump_url: string;
  need_token: boolean;
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
  maxConcurrent?: number,
  resume?: boolean,
): Promise<LauncherResult> {
  return invoke<LauncherResult>("launcher_install_or_update", {
    channel,
    installPath,
    maxConcurrent: maxConcurrent ?? null,
    resume: resume ?? true,
  });
}

export async function verifyAndRepair(
  channel: GameChannel,
  installPath: string,
  maxConcurrent?: number,
  quick?: boolean,
  resume?: boolean,
): Promise<LauncherResult> {
  const result = await invoke<LauncherResult>("launcher_verify_and_repair", {
    channel,
    installPath,
    maxConcurrent: maxConcurrent ?? null,
    quick: quick ?? false,
    resume: resume ?? true,
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
  resume?: boolean,
): Promise<LauncherResult> {
  return invoke<LauncherResult>("launcher_preload_download", {
    channel,
    installPath,
    maxConcurrent: maxConcurrent ?? null,
    resume: resume ?? true,
  });
}

export async function installPreload(
  channel: GameChannel,
  installPath: string,
  maxConcurrent?: number,
  resume?: boolean,
): Promise<LauncherResult> {
  return invoke<LauncherResult>("launcher_install_preload", {
    channel,
    installPath,
    maxConcurrent: maxConcurrent ?? null,
    resume: resume ?? true,
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
  dx11?: boolean;
}

export async function createGameShortcut(
  options?: LaunchExportOptions,
): Promise<string | null> {
  return invoke<string | null>("create_game_shortcut", {
    dx11: options?.dx11,
  });
}

/** Steam 第三方游戏条目的可编辑参数（对应后端 `SteamShortcutOptions`）。 */
export interface SteamShortcutOptions extends LaunchExportOptions {
  name: string;
  iconPath: string | null;
  createAdminShortcut: boolean;
  elevateStartMenu: boolean;
}

/** Steam 弹窗默认值（对应后端 `SteamShortcutDefaults`）。 */
export interface SteamShortcutDefaults {
  name: string;
  icon_path: string;
  icon_extracted: boolean;
  game_exe_found: boolean;
  dx11: boolean;
  create_admin_shortcut: boolean;
  elevate_start_menu: boolean;
  start_menu_shortcut_count: number;
  is_elevated: boolean;
}

/** `add_steam_shortcut` 的返回值（对应后端 `AddSteamShortcutResult`）。 */
export interface AddSteamShortcutResult {
  shortcuts_path: string;
  admin_shortcut: string | null;
  elevated_start_menu: string[];
}

export async function getSteamShortcutDefaults(): Promise<SteamShortcutDefaults> {
  return invoke<SteamShortcutDefaults>("steam_shortcut_defaults");
}

export async function pickSteamIcon(): Promise<string | null> {
  return invoke<string | null>("pick_steam_icon");
}

export async function pickSteamIconSource(): Promise<string | null> {
  return invoke<string | null>("pick_steam_icon_source");
}

export async function extractSteamIcon(exePath: string): Promise<string> {
  return invoke<string>("extract_steam_icon", { exePath });
}

export async function addSteamShortcut(
  options: SteamShortcutOptions,
): Promise<AddSteamShortcutResult> {
  return invoke<AddSteamShortcutResult>("add_steam_shortcut", {
    options: {
      name: options.name,
      icon_path: options.iconPath,
      dx11: options.dx11,
      create_admin_shortcut: options.createAdminShortcut,
      elevate_start_menu: options.elevateStartMenu,
    },
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

/**
 * 结束游戏进程（`launcher_kill_game`）。
 *
 * 返回 `true` = 进程已结束，`false` = 本来就没有同名进程。**失败会 reject**，错误串是同
 * `<token>: <detail>` 契约（token 为 `cancelled` / `kill_failed` / `unknown`）——调用方据此
 * 展示「需要管理员授权」之类的提示，而不是像以前那样静默忽略。
 */
export async function killGame(channel: GameChannel): Promise<boolean> {
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
  arknights: { zh: "明日方舟 官服", en: "Arknights CN" },
  arknights_bilibili: { zh: "明日方舟 B服", en: "Arknights Bilibili" },
};

/** 渠道列表按钮上的圆形徽标文字 */
export const CHANNEL_SHORT: Record<GameChannel, string> = {
  official: "官",
  bilibili: "B",
  global: "G",
  google_play: "GP",
  arknights: "方",
  arknights_bilibili: "方B",
};

/** 游戏标识：与后端 `GameChannel::game_id()` 一致 */
export type GameId = "endfield" | "arknights";

/** 按游戏分组的渠道表（安装/选择渠道时按组展示） */
export const GAME_CHANNELS: Record<GameId, GameChannel[]> = {
  endfield: ["official", "bilibili", "global", "google_play"],
  arknights: ["arknights", "arknights_bilibili"],
};

/** 游戏分组展示顺序 */
export const GAME_ORDER: GameId[] = ["endfield", "arknights"];

/** 渠道 → 所属游戏 */
export const CHANNEL_GAME: Record<GameChannel, GameId> = {
  official: "endfield",
  bilibili: "endfield",
  global: "endfield",
  google_play: "endfield",
  arknights: "arknights",
  arknights_bilibili: "arknights",
};

/** 全部渠道（选择渠道/安装入口用） */
export const ALL_CHANNELS: GameChannel[] = GAME_ORDER.flatMap(
  (game) => GAME_CHANNELS[game],
);

/**
 * 可以切换到的渠道。
 *
 * 只有终末地支持换服：它的渠道差异都落在游戏清单里，换服就是换差异文件。
 * 明日方舟的渠道差异在渠道 SDK/DLL 与目录结构上（不在清单里），用同一套逻辑换服
 * 会留下半套渠道文件，所以这里返回空表，界面上不提供换服入口。
 */
export function switchableChannels(from: GameChannel): GameChannel[] {
  const game = CHANNEL_GAME[from];
  if (game !== "endfield") return [];
  return GAME_CHANNELS.endfield.filter((channel) => channel !== from);
}

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
