import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy } from "lucide";
import { MorphIcon } from "morphicons/react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { GlassButton, GlassSwitch } from "@/components/ui/glass";
import { Slider } from "@/components/ui/slider";
import { SettingsDivider } from "@/components/ui/settings-row";
import { GlassModalCompound as GlassModal } from "@/components/ui/modal";
import {
  ExternalLinkIcon,
  FileCodeIcon,
  TerminalIcon,
} from "@/components/icons";
import {
  createGameShortcut,
  createLaunchBat,
  getGameLaunchCommand,
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

export const CLOSE_AFTER_LAUNCH_KEY = "launcher_close_after_launch";
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
 * 静默启动游戏独立弹窗：展示启动命令、复制命令，并可创建 Windows 快捷方式。
 */
export function QuickLaunchModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [baseCommand, setBaseCommand] = useState("");
  const [closeAfterLaunch, setCloseAfterLaunch] = useState(
    () => localStorage.getItem(CLOSE_AFTER_LAUNCH_KEY) === "true",
  );
  const [dx11, setDx11] = useState(readDx11);
  const [copied, setCopied] = useState(false);
  const [creatingShortcut, setCreatingShortcut] = useState(false);
  const [savingBat, setSavingBat] = useState(false);
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

  const launchCommand = [
    baseCommand,
    dx11 ? "--dx11" : "",
    closeAfterLaunch ? "--close-after-launch" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const handleToggleCloseAfterLaunch = (value: boolean) => {
    setCloseAfterLaunch(value);
    localStorage.setItem(CLOSE_AFTER_LAUNCH_KEY, String(value));
  };

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

  const runExport = async (
    run: () => Promise<string | null>,
    saving: (busy: boolean) => void,
    createdKey: string,
    errorKey: string,
    successTag: string,
  ) => {
    saving(true);
    try {
      await syncSilentLaunchConfig();
      const savedPath = await run();
      if (savedPath) {
        addMessage({
          type: "info",
          title: t(createdKey),
          body: savedPath,
          tag: successTag,
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
        title: t(errorKey),
        body: `${String(error)} ${t("settings.game_launch.command_fallback")}`,
        tag: successTag,
      });
    } finally {
      saving(false);
    }
  };

  const handleCreateShortcut = () =>
    runExport(
      () => createGameShortcut({ closeAfterLaunch, dx11 }),
      setCreatingShortcut,
      "settings.game_launch.shortcut_created",
      "settings.game_launch.shortcut_error",
      "quick-launch-shortcut",
    );

  const handleSaveBat = () =>
    runExport(
      () => createLaunchBat({ closeAfterLaunch, dx11 }),
      setSavingBat,
      "settings.game_launch.bat_created",
      "settings.game_launch.bat_error",
      "quick-launch-bat",
    );

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
                    <div className="flex flex-col items-center gap-2">
                      <p className={`${sectionTitle} whitespace-nowrap`}>
                        {t("settings.game_launch.close_after_launch")}
                      </p>
                      <p className={sectionHint}>
                        {t("settings.game_launch.close_after_launch_desc")}
                      </p>
                      <GlassSwitch
                        isSelected={closeAfterLaunch}
                        onValueChange={handleToggleCloseAfterLaunch}
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
                      <FileCodeIcon size={18} className="mt-0.5 shrink-0 text-muted" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <p className={sectionTitle}>
                          {t("settings.game_launch.bat_title")}
                        </p>
                        <p className={sectionHint}>
                          {t("settings.game_launch.bat_hint")}
                        </p>
                        {supportsWindows && (
                          <GlassButton
                            variant="secondary"
                            onPress={handleSaveBat}
                            isDisabled={savingBat}
                          >
                            <span className="inline-flex items-center gap-2">
                              <FileCodeIcon size={14} />
                              {savingBat
                                ? t("settings.game_launch.bat_saving")
                                : t("settings.game_launch.save_bat")}
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
    </GlassModal>
  );
}
