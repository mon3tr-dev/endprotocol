import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Check, Copy } from "lucide";
import { MorphIcon } from "morphicons/react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { GlassButton, GlassSwitch, GlassInput } from "@/components/ui/glass";
import { Slider } from "@/components/ui/slider";
import { SettingsDivider } from "@/components/ui/settings-row";
import { GlassModalCompound as GlassModal } from "@/components/ui/modal";
import {
  ExternalLinkIcon,
  GamepadIcon,
  TerminalIcon,
} from "@/components/icons";
import {
  addSteamShortcut,
  createGameShortcut,
  extractSteamIcon,
  getGameLaunchCommand,
  getSteamShortcutDefaults,
  pickSteamIcon,
  pickSteamIconSource,
  syncSilentLaunchConfig,
} from "@/utils/launcherService";
import { isWindowsPlatform } from "@/utils/platform";
import { addMessage } from "@/utils/messageStore";
import { logError } from "@/utils/logger";
import { setConfig } from "@/utils/configService";
import {
  getGameBgMode,
  setGameBgMode,
  subscribeGameBgMode,
  type GameBgMode,
} from "@/stores/launcherMode";

export const CANCEL_BEHAVIOR_KEY = "launcher_cancel_behavior";
export const VERIFY_THREADS_KEY = "launcher_verify_threads";
export const DOWNLOAD_THREADS_KEY = "launcher_download_threads";
export const DOWNLOAD_RESUME_KEY = "launcher_download_resume";
export const DX11_KEY = "launcher_dx11";
export const GAME_LAUNCH_SYNC_EVENT = "game-launch-settings-sync";

const COPY_FEEDBACK_MS = 3000;
const DEFAULT_DOWNLOAD_THREADS = 8;

export const readCancelBehavior = (): string => {
  try {
    return localStorage.getItem(CANCEL_BEHAVIOR_KEY) || "ask";
  } catch {
    return "ask";
  }
};

export const readVerifyThreads = (): number => {
  try {
    const parsed = parseInt(localStorage.getItem(VERIFY_THREADS_KEY) || "12", 10);
    return Number.isFinite(parsed) ? Math.min(32, Math.max(1, parsed)) : 12;
  } catch {
    return 12;
  }
};

export const readDownloadThreads = (): number => {
  try {
    const parsed = parseInt(
      localStorage.getItem(DOWNLOAD_THREADS_KEY) ||
        String(DEFAULT_DOWNLOAD_THREADS),
      10,
    );
    return Number.isFinite(parsed)
      ? Math.min(32, Math.max(1, parsed))
      : DEFAULT_DOWNLOAD_THREADS;
  } catch {
    return DEFAULT_DOWNLOAD_THREADS;
  }
};

/** 断点续传默认开启：仅当用户显式关闭时返回 false。 */
export const readDownloadResume = (): boolean => {
  try {
    return localStorage.getItem(DOWNLOAD_RESUME_KEY) !== "false";
  } catch {
    return true;
  }
};

export const readDx11 = (): boolean => {
  try {
    return localStorage.getItem(DX11_KEY) === "true";
  } catch {
    return false;
  }
};

export const persistGameLaunchSetting = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
  window.dispatchEvent(new Event(GAME_LAUNCH_SYNC_EVENT));
};

/** DX11 开关同时写 localStorage（界面同步）与后端配置（静默启动读取）。 */
export const setDx11Setting = (value: boolean) => {
  persistGameLaunchSetting(DX11_KEY, String(value));
  void setConfig("launcher_dx11", value);
};

/**
 * 游戏启动设置字段（取消下载行为 / 下载线程数 / 断点续传 / DX11 / 校验线程数 / 界面背景）。
 * 设置页与游戏行动面板的「游戏设置」弹窗共用本组件，任意一处修改立即同步到另一处。
 */
export function GameLaunchSettingsFields() {
  const { t } = useTranslation();
  const [cancelBehavior, setCancelBehavior] = useState(readCancelBehavior);
  const [verifyThreads, setVerifyThreads] = useState(readVerifyThreads);
  const [downloadThreads, setDownloadThreads] = useState(readDownloadThreads);
  const [downloadResume, setDownloadResume] = useState(readDownloadResume);
  const [bgMediaMode, setBgMediaMode] = useState<GameBgMode>(getGameBgMode);
  const [dx11, setDx11] = useState(readDx11);

  useEffect(() => {
    const sync = () => {
      setCancelBehavior(readCancelBehavior());
      setVerifyThreads(readVerifyThreads());
      setDownloadThreads(readDownloadThreads());
      setDownloadResume(readDownloadResume());
      setDx11(readDx11());
    };
    window.addEventListener(GAME_LAUNCH_SYNC_EVENT, sync);
    const unsubscribeBg = subscribeGameBgMode(() => {
      setBgMediaMode(getGameBgMode());
    });
    return () => {
      window.removeEventListener(GAME_LAUNCH_SYNC_EVENT, sync);
      unsubscribeBg();
    };
  }, []);

  const handleCancelChange = (value: string) => {
    setCancelBehavior(value);
    persistGameLaunchSetting(CANCEL_BEHAVIOR_KEY, value);
  };

  const handleThreadsChange = (value: number) => {
    setVerifyThreads(value);
    persistGameLaunchSetting(VERIFY_THREADS_KEY, String(value));
  };

  const handleDownloadThreadsChange = (value: number) => {
    setDownloadThreads(value);
    persistGameLaunchSetting(DOWNLOAD_THREADS_KEY, String(value));
  };

  const handleDownloadResumeChange = (value: boolean) => {
    setDownloadResume(value);
    persistGameLaunchSetting(DOWNLOAD_RESUME_KEY, String(value));
  };

  const handleBgMediaChange = (value: GameBgMode) => {
    if (value === getGameBgMode()) return;
    setBgMediaMode(value);
    setGameBgMode(value);
  };

  const handleDx11Change = (value: boolean) => {
    setDx11(value);
    setDx11Setting(value);
  };

  return (
    <>
      {/* Cancel Download Behavior */}
      <div id="settings-cancel-behavior">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="font-medium text-foreground">
              {t("launcher.cancel_download_behavior")}
            </p>
            <p className="text-sm text-muted mt-0.5">
              {t("launcher.cancel_download_behavior_desc")}
            </p>
          </div>
          <div className="flex gap-2 shrink-0 whitespace-nowrap">
            {[
              { value: "ask", label: t("launcher.cancel_behavior_ask") },
              { value: "keep", label: t("launcher.cancel_behavior_keep") },
              { value: "delete", label: t("launcher.cancel_behavior_delete") },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`px-3 py-1.5 rounded-lg text-sm border transition-all cursor-pointer whitespace-nowrap ${
                  cancelBehavior === opt.value
                    ? "border-primary/50 bg-primary/10 text-primary font-medium"
                    : "border-separator/40 text-muted hover:bg-default-100/50"
                }`}
                onClick={() => handleCancelChange(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <SettingsDivider />

      {/* DX11 Launch */}
      <div id="settings-dx11">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="font-medium text-foreground whitespace-nowrap">
              {t("settings.game_launch.dx11")}
            </p>
            <p className="text-sm text-muted mt-0.5">
              {t("settings.game_launch.dx11_desc")}
            </p>
          </div>
          <GlassSwitch isSelected={dx11} onValueChange={handleDx11Change}>
            <GlassSwitch.Control>
              <GlassSwitch.Thumb />
            </GlassSwitch.Control>
          </GlassSwitch>
        </div>
      </div>

      <SettingsDivider />

      {/* Download Threads */}
      <div id="settings-download-threads">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="font-medium text-foreground">
              {t("settings.game_launch.download_threads")}
            </p>
            <p className="text-sm text-muted mt-0.5">
              {t("settings.game_launch.download_threads_desc")}
            </p>
          </div>
          <div className="flex items-center gap-3 sm:w-56 shrink-0">
            <Slider
              min={1}
              max={32}
              step={1}
              value={[downloadThreads]}
              aria-label={t("settings.game_launch.download_threads")}
              className="w-full"
              onValueChange={([value]) => handleDownloadThreadsChange(value)}
            />
            <span className="w-8 text-right text-sm tabular-nums text-muted">
              {downloadThreads}
            </span>
          </div>
        </div>
      </div>

      <SettingsDivider />

      {/* Download Resume */}
      <div id="settings-download-resume">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="font-medium text-foreground whitespace-nowrap">
              {t("settings.game_launch.download_resume")}
            </p>
            <p className="text-sm text-muted mt-0.5">
              {t("settings.game_launch.download_resume_desc")}
            </p>
          </div>
          <GlassSwitch
            isSelected={downloadResume}
            onValueChange={handleDownloadResumeChange}
          >
            <GlassSwitch.Control>
              <GlassSwitch.Thumb />
            </GlassSwitch.Control>
          </GlassSwitch>
        </div>
      </div>

      <SettingsDivider />

      {/* Verify Threads */}
      <div id="settings-verify-threads">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="font-medium text-foreground">
              {t("settings.game_launch.verify_threads")}
            </p>
            <p className="text-sm text-muted mt-0.5">
              {t("settings.game_launch.verify_threads_desc")}
            </p>
          </div>
          <div className="flex items-center gap-3 sm:w-56 shrink-0">
            <Slider
              min={1}
              max={32}
              step={1}
              value={[verifyThreads]}
              aria-label={t("settings.game_launch.verify_threads")}
              className="w-full"
              onValueChange={([value]) => handleThreadsChange(value)}
            />
            <span className="w-8 text-right text-sm tabular-nums text-muted">
              {verifyThreads}
            </span>
          </div>
        </div>
      </div>

      <SettingsDivider />

      {/* Background Media: video / image */}
      <div id="settings-bg-media">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="font-medium text-foreground">
              {t("settings.game_launch.bg_media")}
            </p>
            <p className="text-sm text-muted mt-0.5">
              {t("settings.game_launch.bg_media_desc")}
            </p>
          </div>
          <div className="flex gap-2 shrink-0 whitespace-nowrap">
            {[
              {
                value: "video" as GameBgMode,
                label: t("settings.game_launch.bg_media_video"),
              },
              {
                value: "image" as GameBgMode,
                label: t("settings.game_launch.bg_media_image"),
              },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`px-3 py-1.5 rounded-lg text-sm border transition-all cursor-pointer whitespace-nowrap ${
                  bgMediaMode === opt.value
                    ? "border-primary/50 bg-primary/10 text-primary font-medium"
                    : "border-separator/40 text-muted hover:bg-default-100/50"
                }`}
                onClick={() => handleBgMediaChange(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * 游戏启动设置项（取消下载行为 / 下载线程数 / 断点续传 / DX11 / 校验线程数 / 界面背景）。
 * 与游戏行动面板的「游戏设置」弹窗共用同一份存储，任意一处修改立即同步到另一处。
 */
export function GameLaunchSettings() {
  const { t } = useTranslation();
  const [quickLaunchOpen, setQuickLaunchOpen] = useState(false);

  return (
    <>
      <GameLaunchSettingsFields />

      <SettingsDivider />

      <div id="settings-silent-launch">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="font-medium text-foreground">
              {t("settings.game_launch.silent_launch_title")}
            </p>
            <p className="text-sm text-muted mt-0.5">
              {t("settings.game_launch.silent_launch_desc")}
            </p>
          </div>
          <GlassButton
            variant="secondary"
            onPress={() => setQuickLaunchOpen(true)}
          >
            {t("settings.game_launch.quick_launch_open")}
          </GlassButton>
        </div>
      </div>

      {quickLaunchOpen && (
        <QuickLaunchModal onClose={() => setQuickLaunchOpen(false)} />
      )}
    </>
  );
}

/**
 * 静默启动游戏独立弹窗：展示启动命令、复制命令，并可创建 Windows 快捷方式或添加 Steam 条目。
 */
export function QuickLaunchModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [baseCommand, setBaseCommand] = useState("");
  const [dx11, setDx11] = useState(readDx11);
  const [copied, setCopied] = useState(false);
  const [creatingShortcut, setCreatingShortcut] = useState(false);
  const [steamOpen, setSteamOpen] = useState(false);
  const copyResetTimer = useRef<number | undefined>(undefined);
  const supportsWindows = isWindowsPlatform();

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await syncSilentLaunchConfig();
        const command = await getGameLaunchCommand();
        if (active) setBaseCommand(command);
      } catch (error) {
        if (active) {
          addMessage({
            type: "warn",
            title: t("settings.game_launch.command_error"),
            body: String(error),
            tag: "quick-launch-command",
          });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [t]);

  useEffect(() => {
    const sync = () => setDx11(readDx11());
    window.addEventListener(GAME_LAUNCH_SYNC_EVENT, sync);
    return () => window.removeEventListener(GAME_LAUNCH_SYNC_EVENT, sync);
  }, []);

  useEffect(() => () => window.clearTimeout(copyResetTimer.current), []);

  const launchCommand = [baseCommand, dx11 ? "--dx11" : ""]
    .filter(Boolean)
    .join(" ");

  const handleToggleDx11 = (value: boolean) => {
    setDx11(value);
    setDx11Setting(value);
  };

  const handleCopyCommand = async () => {
    try {
      await navigator.clipboard.writeText(launchCommand);
      setCopied(true);
      window.clearTimeout(copyResetTimer.current);
      copyResetTimer.current = window.setTimeout(
        () => setCopied(false),
        COPY_FEEDBACK_MS,
      );
    } catch (error) {
      addMessage({
        type: "warn",
        title: t("settings.game_launch.command_copy_error"),
        body: String(error),
        tag: "quick-launch-command",
      });
    }
  };

  const handleCreateShortcut = async () => {
    setCreatingShortcut(true);
    try {
      await syncSilentLaunchConfig();
      const savedPath = await createGameShortcut({ dx11 });
      if (savedPath) {
        addMessage({
          type: "info",
          title: t("settings.game_launch.shortcut_created"),
          body: savedPath,
          tag: "quick-launch-shortcut",
          actions: [
            {
              label: t("settings.game_launch.open_folder"),
              variant: "secondary",
              onClick: async () => {
                try {
                  await revealItemInDir(savedPath);
                } catch (error) {
                  logError(`Failed to reveal ${savedPath}`, error);
                }
              },
            },
          ],
        });
      }
    } catch (error) {
      addMessage({
        type: "warn",
        title: t("settings.game_launch.shortcut_error"),
        body: `${String(error)} ${t("settings.game_launch.command_fallback")}`,
        tag: "quick-launch-shortcut",
      });
    } finally {
      setCreatingShortcut(false);
    }
  };

  const sectionTitle = "text-sm font-medium text-foreground";
  const sectionHint = "text-xs text-muted mt-0.5";

  return (
    <GlassModal isOpen onOpenChange={(open) => !open && onClose()}>
      <GlassModal.Backdrop isDismissable className="z-[300] backdrop-blur-md">
        <GlassModal.Container size="lg">
          <GlassModal.Dialog className="glass-surface-strong border border-separator/70 shadow-2xl">
            <GlassModal.Header>
              <div className="flex items-center justify-between px-5 py-4 border-b border-separator/50">
                <GlassModal.Heading className="text-sm">
                  {t("settings.game_launch.silent_launch_title")}
                </GlassModal.Heading>
                <GlassModal.CloseTrigger />
              </div>
            </GlassModal.Header>
            <GlassModal.Body>
              <div className="flex flex-col gap-5 px-5 py-4">
                <p className="text-sm text-muted">
                  {t("settings.game_launch.silent_launch_desc")}
                </p>
                <div className="flex flex-col gap-5 sm:flex-row">
                  <aside className="flex flex-col justify-center items-center gap-5 text-center sm:w-56 sm:shrink-0 sm:border-r sm:border-separator/50 sm:pr-5">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted">
                      {t("settings.game_launch.launch_options")}
                    </p>
                    <div className="flex flex-col items-center gap-2">
                      <p className={`${sectionTitle} whitespace-nowrap`}>
                        {t("settings.game_launch.dx11")}
                      </p>
                      <p className={sectionHint}>
                        {t("settings.game_launch.dx11_silent_desc")}
                      </p>
                      <GlassSwitch
                        isSelected={dx11}
                        onValueChange={handleToggleDx11}
                      >
                        <GlassSwitch.Control>
                          <GlassSwitch.Thumb />
                        </GlassSwitch.Control>
                      </GlassSwitch>
                    </div>
                  </aside>

                  <div className="min-w-0 flex-1 divide-y divide-separator/40">
                    <section className="flex items-start gap-3 pb-4">
                      <TerminalIcon size={18} className="mt-0.5 shrink-0 text-muted" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <p className={sectionTitle}>
                          {t("settings.game_launch.launch_command")}
                        </p>
                        <div className="flex items-center gap-2 rounded-lg border border-separator/40 bg-default-100/30 p-2.5">
                          <code className="min-w-0 flex-1 truncate text-xs text-foreground">
                            {launchCommand || t("settings.game_launch.command_loading")}
                          </code>
                          <button
                            type="button"
                            onClick={handleCopyCommand}
                            disabled={!launchCommand}
                            aria-label={t("settings.game_launch.copy_command")}
                            title={t("settings.game_launch.copy_command")}
                            className="shrink-0 rounded-md border border-separator/40 p-1.5 text-muted transition-colors hover:bg-default-100/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <MorphIcon
                              icon={copied ? Check : Copy}
                              size={14}
                            />
                          </button>
                        </div>
                      </div>
                    </section>

                    <section className="flex items-start gap-3 py-4">
                      <ExternalLinkIcon size={18} className="mt-0.5 shrink-0 text-muted" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <p className={sectionTitle}>
                          {t("settings.game_launch.shortcut_title")}
                        </p>
                        <p className={sectionHint}>
                          {t("settings.game_launch.shortcut_hint")}
                        </p>
                        {supportsWindows && (
                          <GlassButton
                            variant="secondary"
                            onPress={handleCreateShortcut}
                            isDisabled={creatingShortcut}
                          >
                            <span className="inline-flex items-center gap-2">
                              <ExternalLinkIcon size={14} />
                              {creatingShortcut
                                ? t("settings.game_launch.shortcut_creating")
                                : t("settings.game_launch.create_shortcut")}
                            </span>
                          </GlassButton>
                        )}
                      </div>
                    </section>

                    <section className="flex items-start gap-3 pt-4">
                      <GamepadIcon size={18} className="mt-0.5 shrink-0 text-muted" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <p className={sectionTitle}>
                          {t("settings.game_launch.steam_title")}
                        </p>
                        <p className={sectionHint}>
                          {t("settings.game_launch.steam_hint")}
                        </p>
                        {supportsWindows && (
                          <GlassButton
                            variant="secondary"
                            onPress={() => setSteamOpen(true)}
                          >
                            <span className="inline-flex items-center gap-2">
                              <GamepadIcon size={14} />
                              {t("settings.game_launch.add_to_steam")}
                            </span>
                          </GlassButton>
                        )}
                      </div>
                    </section>
                  </div>
                </div>
              </div>
            </GlassModal.Body>
          </GlassModal.Dialog>
        </GlassModal.Container>
      </GlassModal.Backdrop>
      {steamOpen && <SteamShortcutModal onClose={() => setSteamOpen(false)} />}
    </GlassModal>
  );
}

/** 图标预览：.ico 由后端读取后转成 blob URL；读取失败时显示占位图标。 */
function IconPreview({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setUrl(null);
    if (!path) return;
    void (async () => {
      try {
        const bytes = await invoke<number[]>("read_image_file", { path });
        const blob = new Blob([new Uint8Array(bytes)], { type: "image/x-icon" });
        objectUrl = URL.createObjectURL(blob);
        if (active) setUrl(objectUrl);
      } catch {
        if (active) setUrl(null);
      }
    })();
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-separator/50 bg-default-100/40">
      {url ? (
        <img src={url} alt="" className="h-full w-full object-contain" />
      ) : (
        <GamepadIcon size={16} className="text-muted" />
      )}
    </span>
  );
}

/**
 * Steam 第三方游戏条目参数弹窗。
 *
 * 名字默认「明日方舟：终末地」，图标默认从游戏 `Endfield.exe` 提取（失败时回退 exe 自身），
 * 启动选项固定为 `--silent --launch-game`，并按 DX11 开关附加 `--dx11`。
 * Steam Overlay 需要 Steam 与游戏同权限，因此底部提供「创建管理员 Steam 快捷方式」
 * 与「把开始菜单里的 Steam 提升为管理员运行」两个选项。
 */
export function SteamShortcutModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [iconPath, setIconPath] = useState("");
  const [iconExtracted, setIconExtracted] = useState(false);
  const [gameExeFound, setGameExeFound] = useState(false);
  const [dx11, setDx11] = useState(readDx11);
  const [createAdminShortcut, setCreateAdminShortcut] = useState(false);
  const [elevateStartMenu, setElevateStartMenu] = useState(false);
  const [startMenuCount, setStartMenuCount] = useState(0);
  const [isElevated, setIsElevated] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // 外层 QuickLaunchModal 也监听 window 的 Escape；跳过顶层交互，避免一次按键关掉两层弹窗。
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") event.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await syncSilentLaunchConfig();
        const defaults = await getSteamShortcutDefaults();
        if (!active) return;
        setName(defaults.name);
        setIconPath(defaults.icon_path);
        setIconExtracted(defaults.icon_extracted);
        setGameExeFound(defaults.game_exe_found);
        setDx11(defaults.dx11);
        setCreateAdminShortcut(defaults.create_admin_shortcut);
        setElevateStartMenu(defaults.elevate_start_menu);
        setStartMenuCount(defaults.start_menu_shortcut_count);
        setIsElevated(defaults.is_elevated);
      } catch (error) {
        if (active) {
          addMessage({
            type: "warn",
            title: t("settings.game_launch.steam_error"),
            body: String(error),
            tag: "quick-launch-steam",
          });
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [t]);

  const handlePickIcon = async () => {
    try {
      const picked = await pickSteamIcon();
      if (picked) {
        setIconPath(picked);
        setIconExtracted(false);
      }
    } catch (error) {
      logError("Failed to pick a Steam icon", error);
    }
  };

  const handleExtractIcon = async () => {
    try {
      const picked = await pickSteamIconSource();
      if (!picked) return;
      const extracted = await extractSteamIcon(picked);
      setIconPath(extracted);
      setIconExtracted(true);
    } catch (error) {
      addMessage({
        type: "warn",
        title: t("settings.game_launch.steam_icon_extract_error"),
        body: String(error),
        tag: "quick-launch-steam",
      });
    }
  };

  const handleSubmit = async () => {
    setBusy(true);
    try {
      await syncSilentLaunchConfig();
      const result = await addSteamShortcut({
        name: name.trim(),
        iconPath: iconPath.trim() || null,
        dx11,
        createAdminShortcut,
        elevateStartMenu,
      });
      addMessage({
        type: "info",
        title: t("settings.game_launch.steam_created_title"),
        body: t("settings.game_launch.steam_created_body", {
          name: name.trim(),
        }),
        tag: "quick-launch-steam",
        actions: result.admin_shortcut
          ? [
              {
                label: t("settings.game_launch.open_folder"),
                variant: "secondary",
                onClick: async () => {
                  try {
                    await revealItemInDir(result.admin_shortcut as string);
                  } catch (error) {
                    logError("Failed to reveal the Steam shortcut", error);
                  }
                },
              },
            ]
          : undefined,
      });
      onClose();
    } catch (error) {
      addMessage({
        type: "warn",
        title: t("settings.game_launch.steam_error"),
        body: String(error),
        tag: "quick-launch-steam",
      });
    } finally {
      setBusy(false);
    }
  };

  const fieldLabel = "text-xs font-medium text-muted";

  return (
    <GlassModal isOpen onOpenChange={(open) => !open && onClose()}>
      <GlassModal.Backdrop isDismissable className="z-[320] backdrop-blur-md">
        <GlassModal.Container size="md">
          <GlassModal.Dialog className="flex max-h-[calc(100vh-3rem)] flex-col overflow-hidden glass-surface-strong border border-separator/70 shadow-2xl">
            <GlassModal.Header className="shrink-0">
              <div className="flex items-center justify-between px-5 py-4 border-b border-separator/50">
                <GlassModal.Heading className="text-sm">
                  {t("settings.game_launch.steam_modal_title")}
                </GlassModal.Heading>
                <GlassModal.CloseTrigger />
              </div>
            </GlassModal.Header>
            <GlassModal.Body className="min-h-0 flex-1">
              <div className="flex flex-col gap-4 px-5 py-4">
                <div className="space-y-1.5">
                  <label className={fieldLabel} htmlFor="steam-shortcut-name">
                    {t("settings.game_launch.steam_name")}
                  </label>
                  <GlassInput
                    id="steam-shortcut-name"
                    value={name}
                    onValueChange={setName}
                    isDisabled={loading || busy}
                    placeholder={t("settings.game_launch.steam_name")}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className={fieldLabel}>
                    {t("settings.game_launch.steam_icon")}
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <IconPreview path={iconPath} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs text-foreground">
                        {iconPath || t("settings.game_launch.steam_icon_none")}
                      </p>
                      <p className="text-[11px] text-muted">
                        {iconExtracted
                          ? t("settings.game_launch.steam_icon_extracted")
                          : gameExeFound
                            ? t("settings.game_launch.steam_icon_fallback")
                            : t("settings.game_launch.steam_icon_missing_game")}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <GlassButton
                        variant="tertiary"
                        size="sm"
                        onPress={handlePickIcon}
                        isDisabled={loading || busy}
                      >
                        {t("settings.game_launch.steam_icon_choose")}
                      </GlassButton>
                      <GlassButton
                        variant="tertiary"
                        size="sm"
                        onPress={handleExtractIcon}
                        isDisabled={loading || busy}
                      >
                        {t("settings.game_launch.steam_icon_extract")}
                      </GlassButton>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4 rounded-xl border border-separator/40 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {t("settings.game_launch.dx11")}
                    </p>
                    <p className="text-xs text-muted mt-0.5">
                      {t("settings.game_launch.steam_dx11_desc")}
                    </p>
                  </div>
                  <GlassSwitch
                    isSelected={dx11}
                    onValueChange={(value) => {
                      setDx11(value);
                      setDx11Setting(value);
                    }}
                  >
                    <GlassSwitch.Control>
                      <GlassSwitch.Thumb />
                    </GlassSwitch.Control>
                  </GlassSwitch>
                </div>

                <SettingsDivider />

                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    {t("settings.game_launch.steam_overlay_title")}
                  </p>
                  <p className="text-xs text-warning">
                    {isElevated
                      ? t("settings.game_launch.steam_overlay_hint_elevated")
                      : t("settings.game_launch.steam_overlay_hint")}
                  </p>
                </div>

                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={createAdminShortcut}
                    onChange={(event) =>
                      setCreateAdminShortcut(event.currentTarget.checked)
                    }
                    disabled={loading || busy}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm text-foreground">
                      {t("settings.game_launch.steam_admin_shortcut")}
                    </span>
                    <span className="block text-xs text-muted mt-0.5">
                      {t("settings.game_launch.steam_admin_shortcut_desc")}
                    </span>
                  </span>
                </label>

                <label
                  className={`flex items-start gap-3 ${
                    startMenuCount > 0
                      ? "cursor-pointer"
                      : "cursor-not-allowed opacity-60"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={elevateStartMenu && startMenuCount > 0}
                    onChange={(event) =>
                      setElevateStartMenu(event.currentTarget.checked)
                    }
                    disabled={loading || busy || startMenuCount === 0}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm text-foreground">
                      {t("settings.game_launch.steam_elevate_start_menu")}
                    </span>
                    <span className="block text-xs text-muted mt-0.5">
                      {startMenuCount > 0
                        ? t(
                            "settings.game_launch.steam_elevate_start_menu_found",
                            { count: startMenuCount },
                          )
                        : t(
                            "settings.game_launch.steam_elevate_start_menu_none",
                          )}
                    </span>
                  </span>
                </label>
              </div>
            </GlassModal.Body>
            <GlassModal.Footer className="shrink-0">
              <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-separator/50">
                <GlassButton
                  variant="tertiary"
                  onPress={onClose}
                  isDisabled={busy}
                >
                  {t("common.cancel")}
                </GlassButton>
                <GlassButton
                  variant="primary"
                  onPress={handleSubmit}
                  isDisabled={loading || busy || !name.trim()}
                  isLoading={busy}
                >
                  {t("settings.game_launch.steam_add_confirm")}
                </GlassButton>
              </div>
            </GlassModal.Footer>
          </GlassModal.Dialog>
        </GlassModal.Container>
      </GlassModal.Backdrop>
    </GlassModal>
  );
}
