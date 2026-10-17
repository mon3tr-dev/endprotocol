import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { GlassButton } from "@/components/ui/glass";
import { Slider } from "@/components/ui/slider";
import { SettingsDivider } from "@/components/ui/settings-row";
import { GlassModalCompound as GlassModal } from "@/components/ui/modal";
import {
  createGameShortcut,
  getGameLaunchCommand,
  syncSilentLaunchConfig,
} from "@/utils/launcherService";
import { isWindowsPlatform } from "@/utils/platform";
import {
  getGameBgMode,
  setGameBgMode,
  type GameBgMode,
} from "@/stores/launcherMode";

const CANCEL_BEHAVIOR_KEY = "launcher_cancel_behavior";
const VERIFY_THREADS_KEY = "launcher_verify_threads";
const SYNC_EVENT = "game-launch-settings-sync";

const readCancelBehavior = (): string => {
  try {
    return localStorage.getItem(CANCEL_BEHAVIOR_KEY) || "ask";
  } catch {
    return "ask";
  }
};

const readVerifyThreads = (): number => {
  try {
    const parsed = parseInt(localStorage.getItem(VERIFY_THREADS_KEY) || "12", 10);
    return Number.isFinite(parsed) ? Math.min(32, Math.max(1, parsed)) : 12;
  } catch {
    return 12;
  }
};

const persist = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
  window.dispatchEvent(new Event(SYNC_EVENT));
};

/**
 * 游戏启动设置项（取消下载行为 / 校验线程数 / 界面背景）。
 * 与数据模式设置页共用同一份存储，任意一处修改立即同步到另一处。
 */
export function GameLaunchSettings() {
  const { t } = useTranslation();
  const [cancelBehavior, setCancelBehavior] = useState(readCancelBehavior);
  const [verifyThreads, setVerifyThreads] = useState(readVerifyThreads);
  const [bgMediaMode, setBgMediaMode] = useState<GameBgMode>(getGameBgMode);
  const [quickLaunchOpen, setQuickLaunchOpen] = useState(false);

  useEffect(() => {
    const sync = () => {
      setCancelBehavior(readCancelBehavior());
      setVerifyThreads(readVerifyThreads());
      setBgMediaMode(getGameBgMode());
    };
    window.addEventListener(SYNC_EVENT, sync);
    return () => window.removeEventListener(SYNC_EVENT, sync);
  }, []);

  const handleCancelChange = (value: string) => {
    setCancelBehavior(value);
    persist(CANCEL_BEHAVIOR_KEY, value);
  };

  const handleThreadsChange = (value: number) => {
    setVerifyThreads(value);
    persist(VERIFY_THREADS_KEY, String(value));
  };

  const handleBgMediaChange = (value: GameBgMode) => {
    if (value === getGameBgMode()) return;
    setBgMediaMode(value);
    setGameBgMode(value);
    window.dispatchEvent(new Event(SYNC_EVENT));
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
          <div className="flex gap-2">
            {[
              { value: "ask", label: t("launcher.cancel_behavior_ask") },
              { value: "keep", label: t("launcher.cancel_behavior_keep") },
              { value: "delete", label: t("launcher.cancel_behavior_delete") },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`px-3 py-1.5 rounded-lg text-sm border transition-all cursor-pointer ${
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
          <div className="flex items-center gap-3 sm:w-56">
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
          <div className="flex gap-2">
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
                className={`px-3 py-1.5 rounded-lg text-sm border transition-all cursor-pointer ${
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
  const [launchCommand, setLaunchCommand] = useState("");
  const [launchMessage, setLaunchMessage] = useState("");
  const [launchError, setLaunchError] = useState(false);
  const [creatingShortcut, setCreatingShortcut] = useState(false);
  const supportsWindows = isWindowsPlatform();

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await syncSilentLaunchConfig();
        const command = await getGameLaunchCommand();
        if (active) setLaunchCommand(command);
      } catch (error) {
        if (active) {
          setLaunchError(true);
          setLaunchMessage(
            `${t("settings.game_launch.command_error")}: ${String(error)}`,
          );
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [t]);

  const handleCopyCommand = async () => {
    try {
      await navigator.clipboard.writeText(launchCommand);
      setLaunchError(false);
      setLaunchMessage(t("settings.game_launch.command_copied"));
    } catch (error) {
      setLaunchError(true);
      setLaunchMessage(
        `${t("settings.game_launch.command_copy_error")}: ${String(error)}`,
      );
    }
  };

  const handleCreateShortcut = async () => {
    setCreatingShortcut(true);
    setLaunchMessage("");
    try {
      await syncSilentLaunchConfig();
      const shortcutPath = await createGameShortcut();
      if (shortcutPath) {
        setLaunchError(false);
        setLaunchMessage(
          `${t("settings.game_launch.shortcut_created")}: ${shortcutPath}`,
        );
      }
    } catch (error) {
      setLaunchError(true);
      setLaunchMessage(
        `${t("settings.game_launch.shortcut_error")}: ${String(error)} ${t("settings.game_launch.command_fallback")}`,
      );
    } finally {
      setCreatingShortcut(false);
    }
  };

  return (
    <GlassModal isOpen onOpenChange={(open) => !open && onClose()}>
      <GlassModal.Backdrop isDismissable className="z-[300] backdrop-blur-md">
        <GlassModal.Container size="md">
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
              <div className="px-5 py-4 space-y-3">
                <p className="text-sm text-muted">
                  {t("settings.game_launch.silent_launch_desc")}
                </p>
                <div className="rounded-lg border border-separator/40 bg-default-100/30 p-3">
                  <code className="block break-all text-xs text-foreground">
                    {launchCommand || t("settings.game_launch.command_loading")}
                  </code>
                </div>
                <div className="flex flex-wrap gap-2">
                  <GlassButton
                    variant="secondary"
                    onPress={handleCopyCommand}
                    isDisabled={!launchCommand}
                  >
                    {t("settings.game_launch.copy_command")}
                  </GlassButton>
                  {supportsWindows && (
                    <GlassButton
                      variant="secondary"
                      onPress={handleCreateShortcut}
                      isDisabled={creatingShortcut}
                    >
                      {creatingShortcut
                        ? t("settings.game_launch.shortcut_creating")
                        : t("settings.game_launch.create_shortcut")}
                    </GlassButton>
                  )}
                </div>
                {launchMessage && (
                  <p
                    role="status"
                    className={`text-sm ${launchError ? "text-danger" : "text-success"}`}
                  >
                    {launchMessage}
                  </p>
                )}
              </div>
            </GlassModal.Body>
          </GlassModal.Dialog>
        </GlassModal.Container>
      </GlassModal.Backdrop>
    </GlassModal>
  );
}
