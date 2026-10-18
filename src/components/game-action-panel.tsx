import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  GlassAlertDialogCompound as GlassAlertDialog,
  GlassModalCompound as GlassModal,
} from "@/components/ui/modal";
import { GlassButton } from "@/components/ui/button";
import {
  type GameChannel,
  type GameStatus,
  type ActiveOperation,
  type DownloadProgress,
  type FileScanResult,
  type DiskSpace,
  type GamePlaytime,
  type LauncherResult,
  ALL_CHANNELS,
  checkGameStatus,
  installOrUpdate,
  verifyAndRepair,
  cancelDownload,
  resetDownloadCancel,
  hasDownloadCache,
  preloadDownload,
  installPreload,
  startGame,
  browseFolder,
  checkGameRunning,
  restoreLaunchConfig,
  killGame,
  getGamePlaytime,
  detectChannel,
  scanInstallDir,
  getDiskSpace,
  getProcessReadBytes,
  switchChannel,
  cancelSwitch,
  onLauncherProgress,
  onSwitchProgress,
  formatBytes,
  CHANNEL_LABELS,
  LAUNCH_TOKEN_KEYS,
  splitLaunchToken,
} from "@/utils/launcherService";
import { addMessage } from "@/utils/messageStore";
import { QuickLaunchModal } from "@/components/game-launch-settings";

const STORAGE_KEY_INSTALL_PATH = "launcher_install_path";
const STORAGE_KEY_CHANNEL = "launcher_channel";
const STORAGE_KEY_SKIP_STOP_CONFIRM = "launcher_skip_stop_confirm";
const STORAGE_KEY_CANCEL_BEHAVIOR = "launcher_cancel_behavior"; // "ask" | "keep" | "delete"

/** 游戏操作面板统一按钮风格（与预下载按钮一致） */
const PILL_BASE =
  "inline-flex items-center h-11 rounded-full whitespace-nowrap backdrop-blur-md border border-white/10 bg-black/40 shadow-lg transition-all duration-200 shrink-0";
const PILL_INTERACTIVE =
  "cursor-pointer hover:bg-black/55 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed";
const PILL_TEXT = "text-xs font-medium text-white/80";

/** 剩余时间秒数 → `m:ss` / `h:mm:ss` */
function formatEta(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

/** 运行时长秒数 → `h:mm:ss`（小时不补零，语言无关） */
function formatPlaytime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** 环绕按钮描边显示下载进度，从按钮正上方开始顺时针绘制 */
function ButtonProgressRing({ progress }: { progress: number }) {
  const percent = Math.max(0, Math.min(100, progress));

  return (
    <svg
      aria-hidden="true"
      className="absolute inset-0 z-20 h-full w-full pointer-events-none text-primary"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      <ellipse
        cx="50"
        cy="50"
        rx="48"
        ry="48"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.2"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
      <ellipse
        cx="50"
        cy="50"
        rx="48"
        ry="48"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
        pathLength="100"
        strokeDasharray="100"
        strokeDashoffset={100 - percent}
        transform="rotate(-90 50 50)"
        className="transition-[stroke-dashoffset] duration-300"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** 进度浮层外壳（固定 portal，安装/校验/预下载共用同一外观） */
function ProgressFlyout({
  pos,
  children,
}: {
  pos: { x: number; y: number };
  children: ReactNode;
}) {
  return createPortal(
    <div
      className="fixed z-[200] w-64 rounded-xl glass-surface-strong border border-separator/70 shadow-2xl px-4 py-3 pointer-events-none"
      style={{
        left: pos.x,
        top: pos.y,
        transform: pos.y < 200 ? "translate(-50%, 0)" : "translate(-50%, -100%)",
        animation: "switch-flyin 0.15s ease-out",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

/** 进度浮层里的下载型内容：已下载/总量 + 进度条 + 速度/剩余时间 + 当前文件 */
function DownloadProgressBody({
  downloaded,
  total,
  speed,
  currentFile,
  calculatingLabel,
}: {
  downloaded: number;
  total: number;
  speed: number;
  currentFile?: string | null;
  calculatingLabel: string;
}) {
  return (
    <>
      <div className="flex items-center justify-between text-xs text-white/50 mb-1.5">
        <span>{formatBytes(downloaded)}</span>
        <span>{formatBytes(total)}</span>
      </div>
      <div className="w-full h-1.5 rounded-full bg-white/10 mb-2 overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${total > 0 ? (downloaded / total) * 100 : 0}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-[10px] text-white/40">
        <span>{speed > 0 ? `${formatBytes(Math.round(speed))}/s` : "—"}</span>
        <span>
          {total > downloaded
            ? speed > 0
              ? formatEta(Math.round((total - downloaded) / speed))
              : calculatingLabel
            : ""}
        </span>
      </div>
      {currentFile && (
        <div className="mt-1.5 text-[10px] text-white/30 truncate" title={currentFile}>
          {currentFile.split("/").pop()}
        </div>
      )}
    </>
  );
}

/** 磁盘占用三色条（已用 / 需要下载 / 下载后剩余），安装确认与预下载确认共用 */
function DiskSpaceBar({
  diskSpace,
  needBytes,
  labels,
}: {
  diskSpace: DiskSpace;
  needBytes: number;
  labels: { used: string; need: string; free: string };
}) {
  const diskUsed = diskSpace.total - diskSpace.free;
  const freeAfter = diskSpace.free - needBytes;
  const totalSpace = diskSpace.total;
  const usedPct = totalSpace > 0 ? (diskUsed / totalSpace) * 100 : 0;
  const needPct = totalSpace > 0 ? (needBytes / totalSpace) * 100 : 0;
  const freePct = totalSpace > 0 ? (freeAfter / totalSpace) * 100 : 0;
  const insufficient = freeAfter < 0;

  return (
    <div className="space-y-2">
      <div className="w-full h-3 rounded-full bg-white/5 overflow-hidden flex">
        {usedPct > 0 && (
          <div
            className="h-full bg-blue-400/70 transition-all duration-300"
            style={{ width: `${Math.min(usedPct, 100)}%` }}
          />
        )}
        {needPct > 0 && (
          <div
            className={`h-full transition-all duration-300 ${insufficient ? "bg-red-400/70" : "bg-emerald-400/70"}`}
            style={{ width: `${Math.min(needPct, 100 - usedPct)}%` }}
          />
        )}
        {freePct > 0 && (
          <div
            className="h-full bg-white/10 transition-all duration-300"
            style={{ width: `${Math.min(freePct, 100 - usedPct - needPct)}%` }}
          />
        )}
      </div>
      <div className="flex items-center gap-4 text-[11px] text-muted">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-sm bg-blue-400/70" />
          <span>
            {labels.used}: {formatBytes(diskUsed)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className={`w-2 h-2 rounded-sm ${insufficient ? "bg-red-400/70" : "bg-emerald-400/70"}`}
          />
          <span>
            {labels.need}: {formatBytes(needBytes)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-sm bg-white/10" />
          <span>
            {labels.free}: {formatBytes(freeAfter > 0 ? freeAfter : 0)}
          </span>
        </div>
      </div>
    </div>
  );
}

export function GameActionPanel() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "zh" ? "zh" : "en";
  const [channel, setChannel] = useState<GameChannel>(() => {
    return (
      (localStorage.getItem(STORAGE_KEY_CHANNEL) as GameChannel) || "official"
    );
  });
  const [gameStatus, setGameStatus] = useState<GameStatus | null>(null);
  const [localActiveOp, setLocalActiveOp] = useState<ActiveOperation | null>(
    null,
  );
  const [installPath, setInstallPath] = useState(() => {
    return localStorage.getItem(STORAGE_KEY_INSTALL_PATH) || "";
  });
  const [detectedChannel, setDetectedChannel] = useState<GameChannel | null>(
    () => {
      const savedPath = localStorage.getItem(STORAGE_KEY_INSTALL_PATH);
      const savedChannel = localStorage.getItem(
        STORAGE_KEY_CHANNEL,
      ) as GameChannel | null;
      return savedPath ? savedChannel : null;
    },
  );
  const [detecting, setDetecting] = useState(false);
  const [statusReady, setStatusReady] = useState(false);
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const [hasTempFiles, setHasTempFiles] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quickLaunchOpen, setQuickLaunchOpen] = useState(false);
  const [gameRunning, setGameRunning] = useState(false);
  const [playtime, setPlaytime] = useState<GamePlaytime | null>(null);
  const [playtimeTick, setPlaytimeTick] = useState(0);
  const [btnHovered, setBtnHovered] = useState(false);
  const [btnLabelKey, setBtnLabelKey] = useState(0);
  const prevBtnLabelRef = useRef<string>("");
  /** 预下载进行中的进度（仅驱动预下载按钮，不占用主按钮） */
  const [preloadProgress, setPreloadProgress] = useState<DownloadProgress | null>(
    null,
  );
  const [preloadHovered, setPreloadHovered] = useState(false);
  const [preloadFlyoutPos, setPreloadFlyoutPos] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [preloadConfirmOpen, setPreloadConfirmOpen] = useState(false);
  const [preloadDiskSpace, setPreloadDiskSpace] = useState<DiskSpace | null>(
    null,
  );
  const [downloadSpeed, setDownloadSpeed] = useState(0);
  const [channelSelectOpen, setChannelSelectOpen] = useState(false);
  const [pendingInstallPath, setPendingInstallPath] = useState<string | null>(
    null,
  );
  const [scanResult, setScanResult] = useState<FileScanResult | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [diskSpace, setDiskSpace] = useState<DiskSpace | null>(null);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [switchConfirmTarget, setSwitchConfirmTarget] =
    useState<GameChannel | null>(null);
  const [verifySpeed, setVerifySpeed] = useState(0);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const preloadBtnRef = useRef<HTMLButtonElement>(null);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const [progressFlyoutPos, setProgressFlyoutPos] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [menuFlyoutPos, setMenuFlyoutPos] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const speedRef = useRef({ lastBytes: 0, lastTime: Date.now() });
  const verifySpeedRef = useRef({
    lastReadBytes: 0,
    lastTime: Date.now(),
    initialized: false,
  });
  const cancellingRef = useRef(false);
  const menuFlyoutRef = useRef<HTMLDivElement>(null);

  // Confirm dialog state
  const [confirmAction, setConfirmAction] = useState<
    | "cancel-download"
    | "stop-game"
    | "resume-install"
    | "delete-temp"
    | "verify-confirm"
    | null
  >(null);
  const [confirmCheckbox, setConfirmCheckbox] = useState(false);

  // Derived state: prefer localActiveOp (real-time from events) over gameStatus.active_operation (polled)
  const activeOp = localActiveOp ?? gameStatus?.active_operation ?? null;
  const progress =
    activeOp &&
    (activeOp.type === "installing" ||
      activeOp.type === "verifying" ||
      activeOp.type === "repairing")
      ? {
          downloaded: activeOp.downloaded ?? 0,
          total: activeOp.total ?? 0,
          stage: activeOp.stage ?? "",
          current_file: activeOp.current_file ?? null,
          file_index: activeOp.file_index ?? 0,
          file_count: activeOp.file_count ?? 0,
          verified_bytes: activeOp.verified_bytes ?? 0,
        }
      : null;
  const preparing =
    activeOp?.type === "installing" &&
    ["checking", "comparing"].includes(activeOp.stage ?? "");
  const switching = activeOp?.type === "switching";
  const switchProgress =
    activeOp && activeOp.type === "switching"
      ? {
          phase: activeOp.phase ?? "",
          downloaded: activeOp.downloaded ?? 0,
          total: activeOp.total ?? 0,
          current_file: activeOp.current_file ?? null,
          file_index: activeOp.file_index ?? 0,
          file_count: activeOp.file_count ?? 0,
          from_channel: activeOp.from_channel ?? "",
          to_channel: activeOp.to_channel ?? "",
        }
      : null;
  const switchTarget =
    (switchProgress?.to_channel as GameChannel | null) ?? null;

  // 总时长 = 后端累计总数 + 实时会话（后端会话 + 本地每秒补间）
  const playtimeSession = playtime
    ? playtime.session_seconds + (playtime.running ? playtimeTick : 0)
    : 0;
  const playtimeTotal = playtime ? playtime.total_seconds + playtimeSession : 0;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_CHANNEL, channel);
  }, [channel]);

  // 后端 config 才是启动游戏的真正依据（静默启动、快捷方式都直接读它）；
  // WebView 的 localStorage 可能因换构建产物或清缓存丢失，这里把后端值回灌一次，
  // 避免托盘打开完整版后游戏面板误显示「定位游戏」。
  useEffect(() => {
    let cancelled = false;
    void restoreLaunchConfig().then(() => {
      if (cancelled) return;
      const backendPath = localStorage.getItem(STORAGE_KEY_INSTALL_PATH);
      if (backendPath && backendPath !== installPath) {
        setInstallPath(backendPath);
      }
      const backendChannel = localStorage.getItem(STORAGE_KEY_CHANNEL);
      if (backendChannel && ALL_CHANNELS.includes(backendChannel as GameChannel)) {
        setChannel(backendChannel as GameChannel);
      }
    });
    return () => {
      cancelled = true;
    };
    // 仅挂载时回灌一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Check game status
  const checkStatus = useCallback(async () => {
    if (!installPath) {
      setGameStatus(null);
      setStatusReady(true);
      return;
    }
    console.log(
      "[checkStatus] Starting for channel:",
      channel,
      "path:",
      installPath,
    );
    try {
      const status = await checkGameStatus(channel, installPath);
      console.log("[checkStatus] Got status:", status);
      setGameStatus(status);
    } catch (e) {
      console.log("[checkStatus] FAILED:", e);
      setGameStatus(null);
    } finally {
      setStatusReady(true);
      console.log("[checkStatus] Done, statusReady=true");
    }
  }, [channel, installPath]);

  // Auto-detect channel from install path
  useEffect(() => {
    if (!installPath) {
      setDetectedChannel(null);
      return;
    }
    let cancelled = false;
    const cachedPath = localStorage.getItem(STORAGE_KEY_INSTALL_PATH);
    const cachedChannel = localStorage.getItem(
      STORAGE_KEY_CHANNEL,
    ) as GameChannel | null;
    const hasCachedDetection =
      cachedPath === installPath && cachedChannel !== null;
    if (hasCachedDetection) {
      setDetectedChannel(cachedChannel);
      setDetecting(false);
      return () => {
        cancelled = true;
      };
    }
    setDetectedChannel(null);
    setDetecting(true);
    detectChannel(installPath)
      .then((detected) => {
        if (cancelled) return;
        setDetectedChannel(detected);
        if (detected && detected !== channel) {
          setChannel(detected);
          localStorage.setItem(STORAGE_KEY_CHANNEL, detected);
        }
      })
      .catch(() => {
        if (!cancelled) setDetectedChannel(null);
      })
      .finally(() => {
        if (!cancelled) setDetecting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [installPath]);

  // Silent status refresh — used by progress listener
  const refreshStatus = useCallback(async () => {
    if (!installPath) {
      setGameStatus(null);
      return;
    }
    try {
      const status = await checkGameStatus(channel, installPath);
      setGameStatus(status);
    } catch {
      setGameStatus(null);
    }
  }, [channel, installPath]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  // Poll game running status
  const checkRunning = useCallback(async () => {
    try {
      const running = await checkGameRunning(channel);
      setGameRunning(running);
    } catch {
      setGameRunning(false);
    }
  }, [channel]);

  useEffect(() => {
    checkRunning();
    const timer = setInterval(checkRunning, 3000);
    return () => clearInterval(timer);
  }, [checkRunning]);

  // Poll accumulated playtime (tracked by the backend while EndProtocol runs)
  const refreshPlaytime = useCallback(async () => {
    try {
      setPlaytime(await getGamePlaytime());
    } catch {
      // 后端不可用时保留上一次快照
    } finally {
      setPlaytimeTick(0);
    }
  }, []);

  useEffect(() => {
    refreshPlaytime();
    const timer = setInterval(refreshPlaytime, 5000);
    return () => clearInterval(timer);
  }, [refreshPlaytime]);

  // While the game is running, tick the session timer locally between polls
  useEffect(() => {
    if (!playtime?.running) return;
    const timer = setInterval(() => setPlaytimeTick((v) => v + 1), 1000);
    return () => clearInterval(timer);
  }, [playtime?.running]);

  // Listen for progress events — update localActiveOp for real-time UI + calculate speed
  useEffect(() => {
    const unlisten = onLauncherProgress((p) => {
      // 预下载进度单独处理：只更新预下载按钮，不写入 localActiveOp（避免占用主按钮/进度浮层）
      if (p.stage === "preloading") {
        if (!cancellingRef.current) setPreloadProgress(p);
        // 预下载同样统计速度，供悬停浮层显示
        const now = Date.now();
        const ref = speedRef.current;
        const dt = (now - ref.lastTime) / 1000;
        if (dt > 0.3 && p.downloaded >= ref.lastBytes) {
          setDownloadSpeed((p.downloaded - ref.lastBytes) / dt);
          ref.lastBytes = p.downloaded;
          ref.lastTime = now;
        }
        return;
      }
      // 收到任何非预下载进度都表示预下载阶段已结束（后端操作串行，二者不会并发）
      setPreloadProgress(null);
      if (cancellingRef.current) return;

      // Update localActiveOp so UI renders immediately
      const opType = p.stage === "verifying" ? "verifying" : "installing";
      setLocalActiveOp({
        type: opType as any,
        stage: p.stage,
        downloaded: p.downloaded,
        total: p.total,
        current_file: p.current_file,
        file_index: p.file_index,
        file_count: p.file_count,
        verified_bytes: p.verified_bytes,
      });

      if (p.stage === "downloading" || p.stage === "repairing") {
        const now = Date.now();
        const ref = speedRef.current;
        const dt = (now - ref.lastTime) / 1000;
        if (dt > 0.3 && p.downloaded >= ref.lastBytes) {
          setDownloadSpeed((p.downloaded - ref.lastBytes) / dt);
          ref.lastBytes = p.downloaded;
          ref.lastTime = now;
        }
      } else if (p.stage === "verifying") {
        void getProcessReadBytes()
          .then((readBytes) => {
            const now = Date.now();
            const ref = verifySpeedRef.current;
            const dt = (now - ref.lastTime) / 1000;
            if (!ref.initialized) {
              ref.lastReadBytes = readBytes;
              ref.lastTime = now;
              ref.initialized = true;
            } else if (dt > 0.3 && readBytes >= ref.lastReadBytes) {
              setVerifySpeed((readBytes - ref.lastReadBytes) / dt);
              ref.lastReadBytes = readBytes;
              ref.lastTime = now;
            }
          })
          .catch(() => setVerifySpeed(0));
      } else {
        setDownloadSpeed(0);
        setVerifySpeed(0);
        speedRef.current = { lastBytes: 0, lastTime: Date.now() };
        verifySpeedRef.current = {
          lastReadBytes: 0,
          lastTime: Date.now(),
          initialized: false,
        };
      }
      if (p.stage === "completed" || p.stage === "error") {
        cancellingRef.current = false;
        setLocalActiveOp(null);
        setDownloadSpeed(0);
        setVerifySpeed(0);
        setTimeout(() => {
          refreshStatus();
        }, 500);
      }
    });

    const unlistenSwitch = onSwitchProgress((p: any) => {
      if (cancellingRef.current) return;

      // Update localActiveOp so UI renders immediately during switch
      setLocalActiveOp({
        type: "switching",
        phase: p.phase,
        downloaded: p.downloaded,
        total: p.total,
        current_file: p.current_file,
        file_index: p.file_index,
        file_count: p.file_count,
        from_channel: p.from_channel,
        to_channel: p.to_channel,
      });

      if (p.phase === "downloading") {
        const now = Date.now();
        const ref = speedRef.current;
        const dt = (now - ref.lastTime) / 1000;
        if (dt > 0.3 && p.downloaded >= ref.lastBytes) {
          setDownloadSpeed((p.downloaded - ref.lastBytes) / dt);
          ref.lastBytes = p.downloaded;
          ref.lastTime = now;
        }
      }
      if (p.phase === "completed" || p.phase === "error") {
        cancellingRef.current = false;
        setLocalActiveOp(null);
        setDownloadSpeed(0);
        setTimeout(() => {
          refreshStatus();
        }, 500);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
      unlistenSwitch.then((fn) => fn());
    };
  }, [refreshStatus]);

  // Close menu flyout on outside click
  useEffect(() => {
    if (!flyoutOpen) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        (flyoutRef.current && flyoutRef.current.contains(target)) ||
        document.querySelector("[data-flyout-menu]")?.contains(target)
      ) {
        return;
      }
      setFlyoutOpen(false);
      setMenuFlyoutPos(null);
    };
    const onScroll = () => {
      setFlyoutOpen(false);
      setMenuFlyoutPos(null);
    };
    document.addEventListener("mousedown", handleClick);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [flyoutOpen]);

  const handleLocate = useCallback(async () => {
    setFlyoutOpen(false);
    const selected = await browseFolder();
    if (selected) {
      setInstallPath(selected);
      localStorage.setItem(STORAGE_KEY_INSTALL_PATH, selected);
      setDetecting(true);
      try {
        const detected = await detectChannel(selected);
        if (detected) {
          setDetectedChannel(detected);
          setChannel(detected);
          localStorage.setItem(STORAGE_KEY_CHANNEL, detected);
        }
      } catch {
        // detection failed, leave channel as-is
      } finally {
        setDetecting(false);
      }
    }
  }, []);

  const startInstall = useCallback(
    async (cleanCache: boolean) => {
      if (!installPath) return;
      if (cleanCache) {
        await cancelDownload(installPath);
      }
      cancellingRef.current = false;
      await resetDownloadCancel();
      try {
        const result = await installOrUpdate(channel, installPath);
        // After successful install, run quick verify
        if (result.success) {
          await verifyAndRepair(channel, installPath, 4, true);
        }
      } catch {
        // error handled by progress
      }
    },
    [channel, installPath],
  );

  const handleInstall = useCallback(async () => {
    if (!installPath) {
      const selected = await browseFolder();
      if (selected) {
        setInstallPath(selected);
        localStorage.setItem(STORAGE_KEY_INSTALL_PATH, selected);
        setDetecting(true);
        try {
          const detected = await detectChannel(selected);
          if (detected) {
            setDetectedChannel(detected);
            setChannel(detected);
            localStorage.setItem(STORAGE_KEY_CHANNEL, detected);
            // Channel detected, check for cache and install
            const hasCache = await hasDownloadCache(selected);
            if (hasCache) {
              setConfirmAction("resume-install");
              setConfirmCheckbox(false);
            } else {
              startInstall(false);
            }
          } else {
            // No channel detected, show channel picker
            setPendingInstallPath(selected);
            setChannelSelectOpen(true);
          }
        } catch {
          setPendingInstallPath(selected);
          setChannelSelectOpen(true);
        } finally {
          setDetecting(false);
        }
      }
      return;
    }
    // Has install path but no channel detected
    if (!detectedChannel) {
      setPendingInstallPath(installPath);
      setChannelSelectOpen(true);
      return;
    }
    const hasCache = await hasDownloadCache(installPath);
    if (hasCache) {
      setConfirmAction("resume-install");
      setConfirmCheckbox(false);
    } else {
      startInstall(false);
    }
  }, [installPath, detectedChannel, startInstall]);

  const handleChannelSelected = useCallback(
    async (selectedChannel: GameChannel) => {
      setChannelSelectOpen(false);
      const path = pendingInstallPath || installPath;
      if (!path) return;

      setChannel(selectedChannel);
      setDetectedChannel(selectedChannel);
      localStorage.setItem(STORAGE_KEY_CHANNEL, selectedChannel);

      // Scan existing files before installing
      setScanning(true);
      try {
        const [result, ds] = await Promise.all([
          scanInstallDir(selectedChannel, path),
          getDiskSpace(path).catch(() => null),
        ]);
        setScanResult(result);
        setDiskSpace(ds);
        setScanOpen(true);
      } catch {
        // Scan failed, proceed directly
        const hasCache = await hasDownloadCache(path);
        if (hasCache) {
          setConfirmAction("resume-install");
          setConfirmCheckbox(false);
        } else {
          startInstall(false);
        }
      } finally {
        setScanning(false);
      }
    },
    [pendingInstallPath, installPath, startInstall],
  );

  const handleSwitchChannel = useCallback(
    async (targetChannel: GameChannel) => {
      if (!installPath || !detectedChannel || targetChannel === detectedChannel)
        return;
      setSwitchOpen(false);
      setSwitchConfirmTarget(targetChannel);
    },
    [installPath, detectedChannel],
  );

  const handleConfirmSwitch = useCallback(async () => {
    if (!installPath || !detectedChannel || !switchConfirmTarget) return;
    const targetChannel = switchConfirmTarget;
    setSwitchConfirmTarget(null);
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const fw = 256;
      const fh = 140;
      let x = r.left + r.width / 2;
      let y = r.top - 8;
      if (x - fw / 2 < 8) x = fw / 2 + 8;
      if (x + fw / 2 > window.innerWidth - 8)
        x = window.innerWidth - fw / 2 - 8;
      if (y - fh < 8) y = r.bottom + 8;
      setProgressFlyoutPos({ x, y });
    }
    console.log(
      "[switch] Starting switch:",
      detectedChannel,
      "->",
      targetChannel,
    );
    try {
      await switchChannel(detectedChannel, targetChannel, installPath);
      console.log("[switch] switchChannel completed OK");
      setChannel(targetChannel);
      setDetectedChannel(targetChannel);
      localStorage.setItem(STORAGE_KEY_CHANNEL, targetChannel);
      console.log("[switch] States reset, calling checkStatus...");
      checkStatus()
        .then(() => {
          console.log("[switch] checkStatus completed");
        })
        .catch((e) => {
          console.log("[switch] checkStatus failed:", e);
        });
    } catch (err) {
      console.log("[switch] switchChannel FAILED:", err);
      addMessage({
        type: "urgent",
        title: t("launcher.switch_failed"),
        body: String(err),
        tag: "switch-error",
      });
    }
  }, [installPath, detectedChannel, switchConfirmTarget, checkStatus, t]);

  const handleStart = useCallback(async () => {
    if (!installPath) {
      const selected = await browseFolder();
      if (selected) {
        setInstallPath(selected);
        localStorage.setItem(STORAGE_KEY_INSTALL_PATH, selected);
        setDetecting(true);
        try {
          const detected = await detectChannel(selected);
          if (detected) {
            setDetectedChannel(detected);
            setChannel(detected);
            localStorage.setItem(STORAGE_KEY_CHANNEL, detected);
          }
        } catch {
          // detection failed
        } finally {
          setDetecting(false);
        }
      }
      return;
    }

    try {
      const result = await startGame(installPath, channel);
      if (!result.success) {
        // 后端 message 是 `<token>: <detail>`：token 选文案，detail 是技术细节。
        const { token, detail } = splitLaunchToken(result.message);
        addMessage({
          type: "urgent",
          title: t("launcher.launch_failed_title"),
          body: t(LAUNCH_TOKEN_KEYS[token] ?? "launcher.launch_err_unknown", {
            detail,
          }),
          tag: "launch-error",
        });
      } else if (result.warning) {
        // 例如：没找到签名有效的官方启动器，已回退到直接启动。
        const { token, detail } = splitLaunchToken(result.warning);
        addMessage({
          type: "warn",
          title: t("launcher.launch_fallback_title"),
          body: t(LAUNCH_TOKEN_KEYS[token] ?? "launcher.launch_fallback_body", {
            detail,
          }),
          tag: "launch-warning",
        });
      }
    } catch (err) {
      addMessage({
        type: "urgent",
        title: t("launcher.launch_failed_title"),
        body: t("launcher.launch_err_unknown", { detail: String(err) }),
        tag: "launch-error",
      });
    }
  }, [installPath, channel, t]);

  // 解析校验结果 JSON，构建本地化消息
  const formatVerifyResult = useCallback(
    (msg: string): { type: "info" | "warn"; body: string } => {
      try {
        const data = JSON.parse(msg);
        const { ok, failed, repaired, files } = data as {
          ok: number;
          failed: number;
          repaired: number;
          files: string[];
        };
        if (failed > 0) {
          const lines = [
            t("launcher.verify_repair_summary", {
              total: ok + failed,
              ok,
              failed,
            }),
            t("launcher.verify_repair_detail", { repaired, failed }),
            ...files.map((f) => `  ${f}`),
          ];
          return { type: "warn", body: lines.join("\n") };
        }
        return {
          type: "info",
          body: t("launcher.verify_complete_body", { checked: ok, total: ok }),
        };
      } catch {
        return { type: "info", body: msg };
      }
    },
    [t],
  );

  const handleUpdate = useCallback(async () => {
    if (!installPath) return;
    cancellingRef.current = false;
    await resetDownloadCancel();
    let result: LauncherResult;
    try {
      result = gameStatus?.preload_installable
        ? await installPreload(channel, installPath)
        : await installOrUpdate(channel, installPath);
    } catch (error) {
      addMessage({
        type: "urgent",
        title: t("launcher.update_failed_title"),
        body: String(error),
        tag: "update-error",
      });
      refreshStatus();
      return;
    }
    if (!result.success) {
      addMessage({
        type: "urgent",
        title: t("launcher.update_failed_title"),
        body: result.message,
        tag: "update-error",
      });
      refreshStatus();
      return;
    }

    try {
      const threads = parseInt(
        localStorage.getItem("launcher_verify_threads") || "12",
        10,
      );
      const verification = await verifyAndRepair(
        channel,
        installPath,
        threads,
        true,
      );
      const { type, body } = formatVerifyResult(verification.message);
      addMessage({
        type,
        title: t("launcher.quick_verify_result_title"),
        body,
        tag: "verify-result",
      });
    } catch (error) {
      addMessage({
        type: "urgent",
        title: t("launcher.verify_failed_title"),
        body: `${t("launcher.verify_failed_body")} ${String(error)}`,
        tag: "verify-error",
      });
    } finally {
      refreshStatus();
    }
  }, [
    channel,
    formatVerifyResult,
    gameStatus?.preload_installable,
    installPath,
    refreshStatus,
    t,
  ]);

  const handleVerify = useCallback(async () => {
    if (!installPath) return;
    setFlyoutOpen(false);
    cancellingRef.current = false;
    await resetDownloadCancel();
    const threads = parseInt(
      localStorage.getItem("launcher_verify_threads") || "12",
      10,
    );
    try {
      const result = await verifyAndRepair(channel, installPath, threads);
      const { type, body } = formatVerifyResult(result.message);
      addMessage({
        type,
        title: t("launcher.verify_complete_title"),
        body,
        tag: "verify-result",
      });
    } catch {
      // error handled by progress
    } finally {
      checkStatus();
    }
  }, [channel, installPath, checkStatus, formatVerifyResult]);

  const handleQuickVerify = useCallback(async () => {
    if (!installPath) return;
    setFlyoutOpen(false);
    cancellingRef.current = false;
    await resetDownloadCancel();
    const threads = parseInt(
      localStorage.getItem("launcher_verify_threads") || "12",
      10,
    );
    try {
      const result = await verifyAndRepair(channel, installPath, threads, true);
      const { type, body } = formatVerifyResult(result.message);
      addMessage({
        type,
        title: t("launcher.verify_complete_title"),
        body,
        tag: "verify-result",
      });
    } catch {
      // error handled by progress
    } finally {
      checkStatus();
    }
  }, [channel, installPath, checkStatus]);

  const handleCancel = useCallback(async () => {
    cancellingRef.current = true;
    setLocalActiveOp(null);
    setDownloadSpeed(0);
    await cancelDownload(installPath);
    refreshStatus();
  }, [installPath, refreshStatus]);

  // 预下载体积（提前声明：handlePreload 的依赖数组需要在渲染期就能取到）
  const preloadTotalBytes = gameStatus?.preload_total_bytes ?? 0;

  const handlePreload = useCallback(async () => {
    if (!installPath) return;
    cancellingRef.current = false;
    await resetDownloadCancel();
    setPreloadProgress({
      downloaded: 0,
      total: preloadTotalBytes,
      stage: "preloading",
      current_file: null,
      file_index: 0,
      file_count: 0,
      verified_bytes: 0,
    });
    try {
      await preloadDownload(channel, installPath);
    } catch {
      // error handled by progress
    } finally {
      cancellingRef.current = false;
      setPreloadProgress(null);
      refreshStatus();
    }
  }, [channel, installPath, preloadTotalBytes, refreshStatus]);

  // 取消预下载（点预下载按钮触发）：只停预下载，不影响主按钮状态
  const handlePreloadCancel = useCallback(async () => {
    cancellingRef.current = true;
    setDownloadSpeed(0);
    // 沿用「取消下载行为」设置：keep 保留已下载分卷（下次可续传），其余情况连暂存一起删
    const behavior = localStorage.getItem(STORAGE_KEY_CANCEL_BEHAVIOR) || "ask";
    await cancelDownload(behavior === "keep" ? undefined : installPath);
    refreshStatus();
  }, [installPath, refreshStatus]);

  // 点预下载按钮：先弹确认框提示将占用的磁盘空间（与安装确认一致）
  const handlePreloadClick = useCallback(async () => {
    if (!installPath) return;
    setPreloadConfirmOpen(true);
    setPreloadDiskSpace(null);
    try {
      setPreloadDiskSpace(await getDiskSpace(installPath));
    } catch {
      setPreloadDiskSpace(null);
    }
  }, [installPath]);

  // 预下载进度浮层：与主按钮浮层同一套外观/定位逻辑
  const updatePreloadFlyoutPos = useCallback(() => {
    if (!preloadBtnRef.current) return;
    const r = preloadBtnRef.current.getBoundingClientRect();
    const fw = 256;
    const fh = 140;
    let x = r.left + r.width / 2;
    let y = r.top - 8;
    if (x - fw / 2 < 8) x = fw / 2 + 8;
    if (x + fw / 2 > window.innerWidth - 8)
      x = window.innerWidth - fw / 2 - 8;
    if (y - fh < 8) y = r.bottom + 8;
    setPreloadFlyoutPos({ x, y });
  }, []);

  const handleKill = useCallback(async () => {
    await killGame(channel);
    checkRunning();
    refreshPlaytime();
  }, [channel, checkRunning, refreshPlaytime]);

  const isInstalled = gameStatus?.is_installed ?? false;
  const hasUpdate = gameStatus?.has_update ?? false;
  const hasPreload = gameStatus?.has_preload ?? false;
  const preloadCompleted = gameStatus?.preload_completed ?? false;
  const preloadInstallable = gameStatus?.preload_installable ?? false;
  const preloading = preloadProgress !== null;
  const preloadPercent =
    preloadProgress && preloadProgress.total > 0
      ? Math.min(
          100,
          Math.floor((preloadProgress.downloaded / preloadProgress.total) * 100),
        )
      : 0;
  const downloadPercent =
    progress && progress.total > 0
      ? Math.min(100, (progress.downloaded / progress.total) * 100)
      : 0;
  const isDownloading = progress?.stage === "downloading";
  const isVerifying = progress?.stage === "verifying";
  const isChecking = progress?.stage === "checking";
  const isComparing = progress?.stage === "comparing";
  const isRepairing = progress?.stage === "repairing";
  const isApplying = progress?.stage === "applying";
  const isActionRunning =
    preparing ||
    isDownloading ||
    isApplying ||
    isVerifying ||
    isChecking ||
    isComparing ||
    isRepairing ||
    switching;
  /** 是否有后端操作正在占用下载/校验通道（预下载期间禁止再发起安装/校验/切服） */
  const busyWithDownload = isActionRunning || preloading;

  // Recalculate progress flyout position when button content changes (label width shift)
  useLayoutEffect(() => {
    if (!btnHovered || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const fw = 256;
    const fh = 140;
    let x = r.left + r.width / 2;
    let y = r.top - 8;
    if (x - fw / 2 < 8) x = fw / 2 + 8;
    if (x + fw / 2 > window.innerWidth - 8) x = window.innerWidth - fw / 2 - 8;
    if (y - fh < 8) y = r.bottom + 8;
    setProgressFlyoutPos({ x, y });
  }, [btnHovered]);

  // 预下载按钮悬停时同样重算浮层位置（「预下载中 N%」↔「取消预下载」宽度不同）
  useLayoutEffect(() => {
    if (!preloadHovered || !preloadBtnRef.current) return;
    updatePreloadFlyoutPos();
  }, [preloadHovered, preloadProgress, updatePreloadFlyoutPos]);

  // Adjust menu flyout position after render to place it above the hamburger
  useLayoutEffect(() => {
    if (
      !flyoutOpen ||
      !menuFlyoutPos ||
      !hamburgerRef.current ||
      !menuFlyoutRef.current
    )
      return;
    const hr = hamburgerRef.current.getBoundingClientRect();
    const fh = menuFlyoutRef.current.offsetHeight;
    const fw = 208;
    let x = hr.right - fw;
    let y = hr.top - fh - 8;
    if (x < 8) x = 8;
    if (x + fw > window.innerWidth - 8) x = window.innerWidth - fw - 8;
    if (y < 8) y = hr.bottom + 8;
    if (x !== menuFlyoutPos.x || y !== menuFlyoutPos.y) {
      setMenuFlyoutPos({ x, y });
    }
  }, [flyoutOpen, menuFlyoutPos]);

  const getButtonLabel = (): string => {
    if (switching)
      return btnHovered ? t("launcher.cancel_switch") : t("launcher.switching");
    if (gameRunning)
      return btnHovered ? t("launcher.stop") : t("launcher.running");
    if (!installPath) return t("launcher.locate_game");
    if (preparing)
      return btnHovered ? t("launcher.cancel_verify") : t("launcher.preparing");
    if (isChecking) return t("launcher.checking");
    if (isComparing) return t("launcher.checking");
    if (isVerifying)
      return btnHovered ? t("launcher.cancel_verify") : t("launcher.verifying");
    if (isRepairing)
      return btnHovered ? t("launcher.cancel_verify") : t("launcher.repairing");
    if (isDownloading)
      return btnHovered
        ? t("launcher.cancel_download")
        : t("launcher.installing");
    if (isApplying)
      return btnHovered
        ? t("launcher.cancel_download")
        : t("launcher.installing");
    if (!isInstalled) return t("launcher.install_game");
    if (hasUpdate) return t("launcher.update_game");
    return t("launcher.start_game");
  };

  // Trigger fade animation when button label changes
  const currentBtnLabel = getButtonLabel();
  if (prevBtnLabelRef.current !== currentBtnLabel) {
    prevBtnLabelRef.current = currentBtnLabel;
    setBtnLabelKey((k) => k + 1);
  }

  const getButtonIcon = () => {
    if (switching) {
      if (btnHovered) {
        return (
          <svg
            className="w-4 h-4 transition-transform duration-200 relative z-10"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        );
      }
      return (
        <svg
          className="w-4 h-4 animate-spin transition-transform duration-200 relative z-10"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      );
    }
    if (gameRunning) {
      if (btnHovered) {
        return (
          <svg
            className="w-4 h-4 transition-transform duration-200 relative z-10"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        );
      }
      return (
        <svg
          className="w-4 h-4 transition-transform duration-200 relative z-10"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 12a9 9 0 11-18 0 9 9 0 0118 0zM10 9v6m4-6v6"
          />
        </svg>
      );
    }
    if (isActionRunning) {
      if (btnHovered) {
        return (
          <svg
            className="w-4 h-4 transition-transform duration-200 relative z-10"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        );
      }
      return (
        <svg
          className="w-4 h-4 animate-spin transition-transform duration-200 relative z-10"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      );
    }
    if (!isInstalled) {
      return (
        <svg
          className="w-4 h-4 relative z-10"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
          />
        </svg>
      );
    }
    if (hasUpdate) {
      return (
        <svg
          className="w-4 h-4 relative z-10"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
      );
    }
    return (
      <svg
        className="w-4 h-4 relative z-10"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    );
  };

  const handleButtonClick = () => {
    if (switching) {
      cancellingRef.current = true;
      setLocalActiveOp(null);
      cancelSwitch();
      return;
    }
    if (gameRunning) {
      if (localStorage.getItem(STORAGE_KEY_SKIP_STOP_CONFIRM) === "1") {
        handleKill();
      } else {
        setConfirmAction("stop-game");
        setConfirmCheckbox(false);
      }
    } else if (
      preparing ||
      isVerifying ||
      isChecking ||
      isComparing ||
      isRepairing
    ) {
      handleCancel();
    } else if (isDownloading || isApplying) {
      const behavior =
        localStorage.getItem(STORAGE_KEY_CANCEL_BEHAVIOR) || "ask";
      if (behavior === "keep") {
        cancellingRef.current = true;
        setDownloadSpeed(0);
        cancelDownload(); // no path → keep files
        refreshStatus();
      } else if (behavior === "delete") {
        handleCancel();
      } else {
        setConfirmAction("cancel-download");
        setConfirmCheckbox(false);
      }
    } else if (!isInstalled) {
      handleInstall();
    } else if (hasUpdate) {
      handleUpdate();
    } else {
      handleStart();
    }
  };

  const handleConfirmAction = useCallback(
    (deleteFiles: boolean) => {
      if (confirmAction === "cancel-download") {
        cancellingRef.current = true;
        setDownloadSpeed(0);
        if (deleteFiles) {
          cancelDownload(installPath);
        } else {
          cancelDownload(); // no path → just set flag, no cleanup
        }
        checkStatus();
      } else if (confirmAction === "stop-game") {
        if (confirmCheckbox)
          localStorage.setItem(STORAGE_KEY_SKIP_STOP_CONFIRM, "1");
        handleKill();
      } else if (confirmAction === "resume-install") {
        startInstall(deleteFiles); // deleteFiles=true → clean cache → fresh; deleteFiles=false → resume
      } else if (confirmAction === "delete-temp") {
        if (installPath) {
          cancelDownload(installPath);
          checkStatus();
        }
      } else if (confirmAction === "verify-confirm") {
        handleVerify();
      }
      setConfirmAction(null);
      setConfirmCheckbox(false);
    },
    [
      confirmAction,
      confirmCheckbox,
      installPath,
      handleKill,
      checkStatus,
      startInstall,
      handleVerify,
    ],
  );

  return (
    <>
      {/* 右上角状态栏：服务器/渠道指示 */}
      {installPath && (isInstalled || (detecting && !detectedChannel)) && (
        <div className="absolute right-4 top-4 z-20 lg:right-8 lg:top-8 flex flex-col items-end gap-2">
          {/* 服务器/渠道指示（点击可切换渠道） */}
          {isInstalled && detectedChannel && (
            <button
              type="button"
              onClick={() => setSwitchOpen(true)}
              disabled={switching || busyWithDownload}
              className={`${PILL_BASE} ${PILL_INTERACTIVE} ${PILL_TEXT} gap-1.5 px-4`}
            >
              <div
                className={`w-1.5 h-1.5 rounded-full ${switching ? "bg-yellow-400/60 animate-pulse" : "bg-emerald-400/80"}`}
              />
              <span>
                {switching
                  ? t("launcher.switching")
                  : CHANNEL_LABELS[detectedChannel][lang]}
              </span>
            </button>
          )}

          {/* 识别渠道中的指示（未识别出渠道时显示） */}
          {detecting && !detectedChannel && (
            <div
              className={`${PILL_BASE} ${PILL_TEXT} gap-1.5 px-4 text-white/60`}
            >
              <div className="w-1.5 h-1.5 rounded-full bg-yellow-400/60 animate-pulse" />
              <span>{t("launcher.detecting_channel")}</span>
            </div>
          )}
        </div>
      )}

      <div className="relative inline-flex items-center gap-2" ref={flyoutRef}>
        {/* 累计游戏运行时长（后端在 EndProtocol 运行期间统计），位于开始游戏按钮左侧 */}
        {isInstalled && playtime && (
          <div
            className={`${PILL_BASE} ${PILL_TEXT} gap-1.5 px-4 tabular-nums`}
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span>{formatPlaytime(playtimeTotal)}</span>
          </div>
        )}

        {/* Preload button：未开始 → 预下载；进行中 → 预下载中（点击取消）；完成后 → 已预下载 */}
        {hasPreload && isInstalled && preloading && (
          <button
            ref={preloadBtnRef}
            type="button"
            onClick={handlePreloadCancel}
            onMouseEnter={() => {
              setPreloadHovered(true);
              updatePreloadFlyoutPos();
            }}
            onMouseLeave={() => {
              setPreloadHovered(false);
              setPreloadFlyoutPos(null);
            }}
            className={`${PILL_BASE} ${PILL_INTERACTIVE} ${PILL_TEXT} relative overflow-hidden px-4 gap-2`}
            title={
              preloadProgress && preloadProgress.total > 0
                ? `${t("launcher.preload_cancel")} · ${formatBytes(preloadProgress.downloaded)} / ${formatBytes(preloadProgress.total)}`
                : t("launcher.preload_cancel")
            }
          >
            <div
              className={`absolute inset-0 z-0 rounded-full bg-rose-400/20 transition-opacity duration-300 pointer-events-none ${
                preloadHovered ? "opacity-100" : "opacity-0"
              }`}
            />
            <svg
              className="relative z-10 w-4 h-4 animate-pulse"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10"
              />
            </svg>
            <span className="relative z-10 whitespace-nowrap">
              {preloadHovered
                ? t("launcher.preload_cancel")
                : `${t("launcher.preloading")} ${preloadPercent}%`}
            </span>
            <ButtonProgressRing progress={preloadPercent} />
          </button>
        )}

        {/* 预下载进度浮层：与安装/校验同一个 flyout 外观 */}
        {preloadHovered &&
          preloading &&
          preloadProgress &&
          preloadFlyoutPos &&
          !confirmAction &&
          !preloadConfirmOpen && (
            <ProgressFlyout pos={preloadFlyoutPos}>
              <div className="flex items-center justify-between text-xs text-white/60 mb-1.5">
                <span>{t("launcher.preloading")}</span>
                <span>{preloadPercent}%</span>
              </div>
              <DownloadProgressBody
                downloaded={preloadProgress.downloaded}
                total={preloadProgress.total}
                speed={downloadSpeed}
                currentFile={null}
                calculatingLabel={t("launcher.calculating")}
              />
              <div className="mt-2 text-[10px] text-white/40 text-center">
                {t("launcher.preload_cancel")}
              </div>
            </ProgressFlyout>
          )}

        {hasPreload && isInstalled && !preloading && !preloadCompleted && (
          <button
            type="button"
            onClick={handlePreloadClick}
            disabled={isActionRunning}
            className={`${PILL_BASE} ${PILL_INTERACTIVE} ${PILL_TEXT} px-4 gap-2`}
            title={
              preloadTotalBytes > 0
                ? `${t("launcher.preload_tooltip")} · ${formatBytes(preloadTotalBytes)}`
                : t("launcher.preload_tooltip")
            }
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10"
              />
            </svg>
            <span className="whitespace-nowrap">{t("launcher.preload")}</span>
          </button>
        )}

        {/* Preload completed indicator */}
        {hasPreload &&
          preloadCompleted &&
          !preloadInstallable &&
          isInstalled &&
          !preloading && (
          <div className={`${PILL_BASE} ${PILL_TEXT} gap-1.5 px-3 text-emerald-400/80`}>
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
            <span>{t("launcher.preloaded")}</span>
          </div>
        )}

        <button
          ref={btnRef}
          type="button"
          onClick={handleButtonClick}
          onMouseEnter={() => {
            setBtnHovered(true);
            if (btnRef.current) {
              const r = btnRef.current.getBoundingClientRect();
              const fw = 256;
              const fh = 140;
              let x = r.left + r.width / 2;
              let y = r.top - 8;
              if (x - fw / 2 < 8) x = fw / 2 + 8;
              if (x + fw / 2 > window.innerWidth - 8)
                x = window.innerWidth - fw / 2 - 8;
              if (y - fh < 8) {
                y = r.bottom + 8;
              }
              setProgressFlyoutPos({ x, y });
            }
          }}
          onMouseLeave={() => {
            setBtnHovered(false);
            setProgressFlyoutPos(null);
          }}
          disabled={!statusReady || (preloading && hasUpdate)}
          className={`${PILL_BASE} ${PILL_INTERACTIVE} relative min-w-[120px] px-5 gap-2.5 text-sm font-semibold text-white overflow-hidden active:scale-95 justify-center ${
              gameRunning || switching
                ? "!border-danger/60 !text-danger"
                : ""
            }`}
        >
          {/* Cancellation / stop warning overlay */}
          <div
            className={`absolute inset-0 z-0 rounded-full bg-rose-400/20 transition-opacity duration-300 pointer-events-none ${
              (gameRunning ||
                switching ||
                preparing ||
                isDownloading ||
                isApplying ||
                isVerifying ||
                isComparing ||
                isRepairing) &&
              btnHovered
                ? "opacity-100"
                : "opacity-0"
            }`}
          />
          {isDownloading && <ButtonProgressRing progress={downloadPercent} />}
          {getButtonIcon()}
          <span
            key={btnLabelKey}
            className="whitespace-nowrap animate-fade-in relative z-10"
          >
            {getButtonLabel()}
          </span>
        </button>

        {/* Progress flyout — fixed portal, auraglass styling */}
        {btnHovered &&
          isActionRunning &&
          (switching || preparing || progress) &&
          (switching ||
            preparing ||
            isDownloading ||
            isApplying ||
            isVerifying ||
            isComparing ||
            isRepairing) &&
          progressFlyoutPos &&
          !confirmAction &&
          (
            <ProgressFlyout pos={progressFlyoutPos}>
              {preparing && !progress && (
                <div className="flex items-center gap-2 text-xs text-white/50">
                  <svg
                    className="w-3 h-3 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  <span>{t("launcher.preparing")}</span>
                </div>
              )}
              {isDownloading && (
                <>
                  <div className="flex items-center justify-between text-xs text-white/50 mb-1.5">
                    <span>{formatBytes(progress.downloaded)}</span>
                    <span>{formatBytes(progress.total)}</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-white/10 mb-2 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300"
                      style={{
                        width: `${progress.total > 0 ? (progress.downloaded / progress.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-white/40">
                    <span>
                      {downloadSpeed > 0
                        ? `${formatBytes(Math.round(downloadSpeed))}/s`
                        : "—"}
                    </span>
                    <span>
                      {progress.total > progress.downloaded
                        ? downloadSpeed > 0
                          ? (() => {
                              const remaining = Math.round(
                                (progress.total - progress.downloaded) /
                                  downloadSpeed,
                              );
                              const h = Math.floor(remaining / 3600);
                              const m = Math.floor((remaining % 3600) / 60);
                              const s = remaining % 60;
                              return h > 0
                                ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
                                : `${m}:${String(s).padStart(2, "0")}`;
                            })()
                          : t("launcher.calculating")
                        : ""}
                    </span>
                  </div>
                  {progress.current_file && (
                    <div
                      className="mt-1.5 text-[10px] text-white/30 truncate"
                      title={progress.current_file}
                    >
                      {progress.current_file.split("/").pop()}
                    </div>
                  )}
                </>
              )}
              {isVerifying && (
                <>
                  <div className="flex items-center justify-between text-xs text-white/50 mb-1.5">
                    <span>{t("launcher.verifying")}</span>
                    <span>
                      {progress.total > 0
                        ? `${Math.round((progress.verified_bytes / progress.total) * 100)}%`
                        : ""}
                    </span>
                  </div>
                  {progress.total > 0 && (
                    <div className="w-full h-1.5 rounded-full bg-white/10 mb-2 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-300"
                        style={{
                          width: `${(progress.verified_bytes / progress.total) * 100}%`,
                        }}
                      />
                    </div>
                  )}
                  <div className="flex items-center justify-between text-[10px] text-white/40">
                    <span>
                      {verifySpeed > 0
                        ? `${(verifySpeed / 1048576).toFixed(1)} MB/s`
                        : "—"}
                    </span>
                    <span>
                      {progress.file_count > 0
                        ? `${progress.file_index + 1} / ${progress.file_count}`
                        : ""}
                    </span>
                  </div>
                </>
              )}
              {isComparing && (
                <div className="text-xs text-white/60 text-center py-1">
                  {t("launcher.checking")}
                </div>
              )}
              {isRepairing && (
                <>
                  <div className="flex items-center justify-between text-xs text-white/50 mb-1.5">
                    <span>{t("launcher.repairing")}</span>
                    <span>
                      {progress.total > 0
                        ? `${Math.round((progress.verified_bytes / progress.total) * 100)}%`
                        : ""}
                    </span>
                  </div>
                  {progress.total > 0 && (
                    <div className="w-full h-1.5 rounded-full bg-white/10 mb-2 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-300"
                        style={{
                          width: `${(progress.verified_bytes / progress.total) * 100}%`,
                        }}
                      />
                    </div>
                  )}
                  <div className="flex items-center justify-between text-[10px] text-white/40">
                    <span>
                      {downloadSpeed > 0
                        ? `${formatBytes(Math.round(downloadSpeed))}/s`
                        : "—"}
                    </span>
                    <span>
                      {progress.total > progress.verified_bytes
                        ? downloadSpeed > 0
                          ? (() => {
                              const remaining = Math.round(
                                (progress.total - progress.verified_bytes) /
                                  downloadSpeed,
                              );
                              const h = Math.floor(remaining / 3600);
                              const m = Math.floor((remaining % 3600) / 60);
                              const s = remaining % 60;
                              return h > 0
                                ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
                                : `${m}:${String(s).padStart(2, "0")}`;
                            })()
                          : t("launcher.calculating")
                        : ""}
                    </span>
                  </div>
                  {progress.current_file && (
                    <div
                      className="mt-1.5 text-[10px] text-white/30 truncate"
                      title={progress.current_file}
                    >
                      {progress.current_file.split("/").pop()}
                    </div>
                  )}
                </>
              )}
              {isApplying && (
                <div className="text-xs text-white/60 text-center py-1">
                  {t("launcher.applying")}
                </div>
              )}
              {switching && (
                <>
                  <div className="flex items-center gap-2 text-xs text-white/70 mb-2">
                    <svg
                      className="w-3 h-3 animate-spin"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    <span>
                      {switchProgress?.phase === "downloading"
                        ? t("launcher.switch_downloading")
                        : switchProgress?.phase === "comparing"
                          ? t("launcher.switch_replacing")
                          : switchProgress?.phase === "fetching_from"
                            ? t("launcher.fetching_source")
                            : switchProgress?.phase === "fetching_to"
                              ? t("launcher.fetching_target")
                              : switchProgress?.phase === "fetching_manifest"
                                ? t("launcher.fetching_manifest")
                                : t("launcher.switching")}
                      {switchTarget &&
                        ` → ${CHANNEL_LABELS[switchTarget]?.[lang]}`}
                    </span>
                  </div>
                  {switchProgress &&
                    switchProgress.phase === "downloading" &&
                    switchProgress.total > 0 && (
                      <>
                        <div className="flex items-center justify-between text-xs text-white/50 mb-1.5">
                          <span>{formatBytes(switchProgress.downloaded)}</span>
                          <span>{formatBytes(switchProgress.total)}</span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-white/10 mb-2 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all duration-300"
                            style={{
                              width: `${(switchProgress.downloaded / switchProgress.total) * 100}%`,
                            }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-white/40">
                          <span>
                            {downloadSpeed > 0
                              ? `${formatBytes(Math.round(downloadSpeed))}/s`
                              : "—"}
                          </span>
                          <span>
                            {switchProgress.total > switchProgress.downloaded
                              ? downloadSpeed > 0
                                ? (() => {
                                    const remaining = Math.round(
                                      (switchProgress.total -
                                        switchProgress.downloaded) /
                                        downloadSpeed,
                                    );
                                    const h = Math.floor(remaining / 3600);
                                    const m = Math.floor(
                                      (remaining % 3600) / 60,
                                    );
                                    const s = remaining % 60;
                                    return h > 0
                                      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
                                      : `${m}:${String(s).padStart(2, "0")}`;
                                  })()
                                : t("launcher.calculating")
                              : ""}
                          </span>
                        </div>
                        {switchProgress.current_file && (
                          <div
                            className="mt-1 text-[10px] text-white/30 truncate"
                            title={switchProgress.current_file}
                          >
                            {switchProgress.current_file.split("/").pop()}
                          </div>
                        )}
                      </>
                    )}
                  {!switchProgress && (
                    <div className="text-[10px] text-white/40 text-center py-1">
                      {t("launcher.checking")}
                    </div>
                  )}
                </>
              )}
            </ProgressFlyout>
          )}

        <button
          ref={hamburgerRef}
          type="button"
          onClick={() => {
            const next = !flyoutOpen;
            setFlyoutOpen(next);
            if (next && hamburgerRef.current) {
              const r = hamburgerRef.current.getBoundingClientRect();
              const fw = 208;
              let x = r.right - fw;
              let y = r.top - 8;
              if (x < 8) x = 8;
              if (x + fw > window.innerWidth - 8)
                x = window.innerWidth - fw - 8;
              setMenuFlyoutPos({ x, y });
              if (installPath) {
                hasDownloadCache(installPath).then(setHasTempFiles);
              }
            } else {
              setMenuFlyoutPos(null);
            }
          }}
          className={`${PILL_BASE} ${PILL_INTERACTIVE} ${PILL_TEXT} w-11 justify-center`}
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
        </button>

        {flyoutOpen &&
          menuFlyoutPos &&
          createPortal(
            <div
              ref={menuFlyoutRef}
              data-flyout-menu
              className="fixed z-[200] w-52 rounded-xl glass-surface-strong border border-separator/70 shadow-2xl animate-fade-in"
              style={{
                left: menuFlyoutPos.x,
                top: menuFlyoutPos.y,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setFlyoutOpen(false);
                  setMenuFlyoutPos(null);
                  setSettingsOpen(true);
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground/80 hover:bg-white/10 hover:text-foreground transition-colors cursor-pointer"
              >
                <svg
                  className="w-4 h-4 text-foreground/50"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
                {t("launcher.game_settings")}
              </button>

              <button
                type="button"
                onClick={() => {
                  setFlyoutOpen(false);
                  setMenuFlyoutPos(null);
                  setQuickLaunchOpen(true);
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground/80 hover:bg-white/10 hover:text-foreground transition-colors cursor-pointer"
              >
                <svg
                  className="w-4 h-4 text-foreground/50"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75"
                  />
                </svg>
                {t("launcher.launch_settings")}
              </button>

              <button
                type="button"
                onClick={() => {
                  setFlyoutOpen(false);
                  setMenuFlyoutPos(null);
                  setConfirmAction("verify-confirm");
                  setConfirmCheckbox(false);
                }}
                disabled={busyWithDownload}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground/80 hover:bg-white/10 hover:text-foreground transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg
                  className="w-4 h-4 text-foreground/50"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                  />
                </svg>
                {t("launcher.verify_integrity")}
              </button>

              <button
                type="button"
                onClick={() => {
                  setFlyoutOpen(false);
                  setMenuFlyoutPos(null);
                  handleQuickVerify();
                }}
                disabled={busyWithDownload}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground/80 hover:bg-white/10 hover:text-foreground transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg
                  className="w-4 h-4 text-foreground/50"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
                {t("launcher.quick_verify")}
              </button>

              <button
                type="button"
                onClick={() => {
                  setFlyoutOpen(false);
                  setMenuFlyoutPos(null);
                  setConfirmAction("delete-temp");
                  setConfirmCheckbox(false);
                }}
                disabled={
                  busyWithDownload || !installPath || !hasTempFiles
                }
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground/80 hover:bg-white/10 hover:text-foreground transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg
                  className="w-4 h-4 text-foreground/50"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
                {t("launcher.delete_temp_files")}
              </button>

              <button
                type="button"
                onClick={() => {
                  setFlyoutOpen(false);
                  setMenuFlyoutPos(null);
                  handleLocate();
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground/80 hover:bg-white/10 hover:text-foreground transition-colors cursor-pointer border-t border-separator/50"
              >
                <svg
                  className="w-4 h-4 text-foreground/50"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                  />
                </svg>
                {t("launcher.locate_game")}
              </button>
            </div>,
            document.body,
          )}
      </div>

      {quickLaunchOpen && (
        <QuickLaunchModal onClose={() => setQuickLaunchOpen(false)} />
      )}

      {settingsOpen && (
        <GameSettingsModal
          initialPath={installPath}
          onClose={() => setSettingsOpen(false)}
          onSave={(path) => {
            setInstallPath(path);
            localStorage.setItem(STORAGE_KEY_INSTALL_PATH, path);
            setSettingsOpen(false);
            checkStatus();
          }}
        />
      )}

      {/* Confirm dialog for cancel download / stop game / resume install / delete temp / verify */}
      <GlassAlertDialog
        isOpen={confirmAction !== null}
        onOpenChange={(o) => {
          if (!o) {
            setConfirmAction(null);
            setConfirmCheckbox(false);
          }
        }}
      >
        <GlassAlertDialog.Backdrop className="z-[300]">
          <GlassAlertDialog.Container>
            <GlassAlertDialog.Dialog className="sm:max-w-[380px]">
              <GlassAlertDialog.CloseTrigger />
              <GlassAlertDialog.Header>
                <GlassAlertDialog.Icon
                  status={
                    confirmAction === "verify-confirm" ? "warning" : "danger"
                  }
                />
                <GlassAlertDialog.Heading>
                  {confirmAction === "cancel-download"
                    ? t("launcher.cancel_download_confirm_title")
                    : confirmAction === "resume-install"
                      ? t("launcher.resume_install_title")
                      : confirmAction === "delete-temp"
                        ? t("launcher.delete_temp_confirm_title")
                        : confirmAction === "verify-confirm"
                          ? t("launcher.verify_confirm_title")
                          : t("launcher.stop_game_confirm_title")}
                </GlassAlertDialog.Heading>
              </GlassAlertDialog.Header>
              <GlassAlertDialog.Body>
                <p className="text-sm text-muted">
                  {confirmAction === "cancel-download"
                    ? t("launcher.cancel_download_confirm_body")
                    : confirmAction === "resume-install"
                      ? t("launcher.resume_install_body")
                      : confirmAction === "delete-temp"
                        ? t("launcher.delete_temp_confirm_body")
                        : confirmAction === "verify-confirm"
                          ? t("launcher.verify_confirm_body")
                          : t("launcher.stop_game_confirm_body")}
                </p>
                {confirmAction === "stop-game" && (
                  <label className="flex items-center gap-2 mt-4 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={confirmCheckbox}
                      onChange={(e) => setConfirmCheckbox(e.target.checked)}
                      className="w-4 h-4 rounded border-separator bg-background accent-primary cursor-pointer"
                    />
                    <span className="text-xs text-muted">
                      {t("launcher.dont_ask_again")}
                    </span>
                  </label>
                )}
              </GlassAlertDialog.Body>
              <GlassAlertDialog.Footer>
                {confirmAction === "cancel-download" ? (
                  <>
                    <GlassButton
                      variant="tertiary"
                      onPress={() => handleConfirmAction(false)}
                    >
                      {t("launcher.keep_files")}
                    </GlassButton>
                    <GlassButton
                      variant="danger"
                      onPress={() => handleConfirmAction(true)}
                    >
                      {t("launcher.delete_files")}
                    </GlassButton>
                  </>
                ) : confirmAction === "resume-install" ? (
                  <>
                    <GlassButton
                      variant="tertiary"
                      onPress={() => handleConfirmAction(true)}
                    >
                      {t("launcher.start_fresh")}
                    </GlassButton>
                    <GlassButton
                      variant="primary"
                      onPress={() => handleConfirmAction(false)}
                    >
                      {t("launcher.continue_download")}
                    </GlassButton>
                  </>
                ) : confirmAction === "delete-temp" ? (
                  <>
                    <GlassButton
                      variant="tertiary"
                      onPress={() => {
                        setConfirmAction(null);
                        setConfirmCheckbox(false);
                      }}
                    >
                      {t("launcher.cancel")}
                    </GlassButton>
                    <GlassButton
                      variant="danger"
                      onPress={() => handleConfirmAction(true)}
                    >
                      {t("launcher.delete_files")}
                    </GlassButton>
                  </>
                ) : confirmAction === "verify-confirm" ? (
                  <>
                    <GlassButton
                      variant="tertiary"
                      onPress={() => {
                        setConfirmAction(null);
                        setConfirmCheckbox(false);
                      }}
                    >
                      {t("launcher.cancel")}
                    </GlassButton>
                    <GlassButton
                      variant="primary"
                      onPress={() => handleConfirmAction(false)}
                    >
                      {t("launcher.confirm")}
                    </GlassButton>
                  </>
                ) : (
                  <>
                    <GlassButton
                      variant="tertiary"
                      onPress={() => {
                        setConfirmAction(null);
                        setConfirmCheckbox(false);
                      }}
                    >
                      {t("launcher.cancel")}
                    </GlassButton>
                    <GlassButton
                      variant="danger"
                      onPress={() => handleConfirmAction(false)}
                    >
                      {t("launcher.confirm_stop")}
                    </GlassButton>
                  </>
                )}
              </GlassAlertDialog.Footer>
            </GlassAlertDialog.Dialog>
          </GlassAlertDialog.Container>
        </GlassAlertDialog.Backdrop>
      </GlassAlertDialog>

      {/* Channel Selection Dialog */}
      {channelSelectOpen && (
        <GlassAlertDialog
          isOpen
          onOpenChange={(o) => {
            if (!o) {
              setChannelSelectOpen(false);
              setPendingInstallPath(null);
            }
          }}
        >
          <GlassAlertDialog.Backdrop className="z-[300]">
            <GlassAlertDialog.Container>
              <GlassAlertDialog.Dialog className="sm:max-w-[420px]">
                <GlassAlertDialog.CloseTrigger />
                <GlassAlertDialog.Header>
                  <GlassAlertDialog.Icon status="info" />
                  <GlassAlertDialog.Heading>
                    {t("launcher.select_channel_title")}
                  </GlassAlertDialog.Heading>
                </GlassAlertDialog.Header>
                <GlassAlertDialog.Body>
                  <p className="text-sm text-muted mb-4">
                    {t("launcher.select_channel_desc")}
                  </p>
                  <div className="flex flex-col gap-2">
                    {ALL_CHANNELS.map((ch) => (
                      <button
                        key={ch}
                        type="button"
                        onClick={() => handleChannelSelected(ch)}
                        disabled={scanning}
                        className="flex items-center gap-3 p-3 rounded-lg glass-surface border border-separator/50 hover:border-primary/50 hover:bg-primary/10 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                          <span className="text-sm font-bold text-primary">
                            {ch === "official"
                              ? "官"
                              : ch === "bilibili"
                                ? "B"
                                : ch === "global"
                                  ? "G"
                                  : "GP"}
                          </span>
                        </div>
                        <span className="text-sm font-medium text-foreground/80">
                          {CHANNEL_LABELS[ch]?.[lang] || ch}
                        </span>
                      </button>
                    ))}
                  </div>
                  {scanning && (
                    <div className="flex items-center gap-2 mt-4 text-xs text-muted">
                      <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                      <span>{t("launcher.scanning_files")}</span>
                    </div>
                  )}
                </GlassAlertDialog.Body>
                <GlassAlertDialog.Footer>
                  <GlassButton
                    variant="tertiary"
                    onPress={() => {
                      setChannelSelectOpen(false);
                      setPendingInstallPath(null);
                    }}
                  >
                    {t("launcher.cancel")}
                  </GlassButton>
                </GlassAlertDialog.Footer>
              </GlassAlertDialog.Dialog>
            </GlassAlertDialog.Container>
          </GlassAlertDialog.Backdrop>
        </GlassAlertDialog>
      )}

      {/* Scan Result Dialog */}
      {scanOpen && scanResult && (
        <GlassAlertDialog
          isOpen
          onOpenChange={(o) => {
            if (!o) {
              setScanOpen(false);
              setScanResult(null);
              setDiskSpace(null);
            }
          }}
        >
          <GlassAlertDialog.Backdrop className="z-[300]">
            <GlassAlertDialog.Container>
              <GlassAlertDialog.Dialog className="sm:max-w-[400px]">
                <GlassAlertDialog.CloseTrigger />
                <GlassAlertDialog.Header>
                  <GlassAlertDialog.Icon
                    status={
                      scanResult.download_bytes === 0
                        ? "success"
                        : diskSpace !== null &&
                            diskSpace.free < scanResult.download_bytes
                          ? "danger"
                          : "info"
                    }
                  />
                  <GlassAlertDialog.Heading>
                    {scanResult.download_bytes === 0
                      ? t("launcher.scan_result_all_valid")
                      : t("launcher.confirm_install")}
                  </GlassAlertDialog.Heading>
                </GlassAlertDialog.Header>
                <GlassAlertDialog.Body>
                  {scanResult.download_bytes === 0 ? (
                    <p className="text-sm text-muted">
                      {t("launcher.no_files_found")}
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {/* Disk space usage bar */}
                      {diskSpace !== null && (
                        <DiskSpaceBar
                          diskSpace={diskSpace}
                          needBytes={scanResult.download_bytes}
                          labels={{
                            used: t("launcher.disk_used"),
                            need: t("launcher.need_download"),
                            free: t("launcher.disk_free_space"),
                          }}
                        />
                      )}
                      {diskSpace === null && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted">
                            {t("launcher.need_download")}
                          </span>
                          <span className="font-medium text-foreground">
                            {scanResult.missing_files +
                              scanResult.corrupted_files}{" "}
                            {t("launcher.files_count")}，
                            {formatBytes(scanResult.download_bytes)}
                          </span>
                        </div>
                      )}
                      {diskSpace !== null &&
                        diskSpace.free < scanResult.download_bytes && (
                          <p className="text-xs text-red-400">
                            {t("launcher.disk_space_insufficient")}
                          </p>
                        )}
                    </div>
                  )}
                </GlassAlertDialog.Body>
                <GlassAlertDialog.Footer>
                  <GlassButton
                    variant="tertiary"
                    onPress={() => {
                      setScanOpen(false);
                      setScanResult(null);
                      setDiskSpace(null);
                    }}
                  >
                    {t("launcher.cancel")}
                  </GlassButton>
                  <GlassButton
                    variant="primary"
                    disabled={
                      scanResult.download_bytes > 0 &&
                      diskSpace !== null &&
                      diskSpace.free < scanResult.download_bytes
                    }
                    onPress={() => {
                      setScanOpen(false);
                      setScanResult(null);
                      setDiskSpace(null);
                      if (scanResult.download_bytes === 0) {
                        startInstall(false);
                      } else {
                        hasDownloadCache(installPath).then((has) => {
                          if (has) {
                            setConfirmAction("resume-install");
                            setConfirmCheckbox(false);
                          } else {
                            startInstall(false);
                          }
                        });
                      }
                    }}
                  >
                    {scanResult.download_bytes === 0
                      ? t("launcher.start_game")
                      : t("launcher.confirm_install_btn")}
                  </GlassButton>
                </GlassAlertDialog.Footer>
              </GlassAlertDialog.Dialog>
            </GlassAlertDialog.Container>
          </GlassAlertDialog.Backdrop>
        </GlassAlertDialog>
      )}

      {/* Preload confirm dialog — 提示将占用的磁盘空间（与安装确认同款三色条） */}
      {preloadConfirmOpen && (
        <GlassAlertDialog
          isOpen
          onOpenChange={(o) => {
            if (!o) {
              setPreloadConfirmOpen(false);
              setPreloadDiskSpace(null);
            }
          }}
        >
          <GlassAlertDialog.Backdrop className="z-[300]">
            <GlassAlertDialog.Container>
              <GlassAlertDialog.Dialog className="sm:max-w-[400px]">
                <GlassAlertDialog.CloseTrigger />
                <GlassAlertDialog.Header>
                  <GlassAlertDialog.Icon
                    status={
                      preloadDiskSpace !== null &&
                      preloadDiskSpace.free < preloadTotalBytes
                        ? "danger"
                        : "info"
                    }
                  />
                  <GlassAlertDialog.Heading>
                    {t("launcher.preload_confirm_title")}
                  </GlassAlertDialog.Heading>
                </GlassAlertDialog.Header>
                <GlassAlertDialog.Body>
                  <div className="space-y-4">
                    <p className="text-sm text-muted">
                      {t("launcher.preload_confirm_desc", {
                        size: formatBytes(preloadTotalBytes),
                      })}
                    </p>
                    {preloadDiskSpace !== null ? (
                      <DiskSpaceBar
                        diskSpace={preloadDiskSpace}
                        needBytes={preloadTotalBytes}
                        labels={{
                          used: t("launcher.disk_used"),
                          need: t("launcher.need_download"),
                          free: t("launcher.disk_free_space"),
                        }}
                      />
                    ) : (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted">
                          {t("launcher.need_download")}
                        </span>
                        <span className="font-medium text-foreground">
                          {formatBytes(preloadTotalBytes)}
                        </span>
                      </div>
                    )}
                    {preloadDiskSpace !== null &&
                      preloadDiskSpace.free < preloadTotalBytes && (
                        <p className="text-xs text-red-400">
                          {t("launcher.disk_space_insufficient")}
                        </p>
                      )}
                  </div>
                </GlassAlertDialog.Body>
                <GlassAlertDialog.Footer>
                  <GlassButton
                    variant="tertiary"
                    onPress={() => {
                      setPreloadConfirmOpen(false);
                      setPreloadDiskSpace(null);
                    }}
                  >
                    {t("launcher.cancel")}
                  </GlassButton>
                  <GlassButton
                    variant="primary"
                    disabled={
                      preloadDiskSpace !== null &&
                      preloadDiskSpace.free < preloadTotalBytes
                    }
                    onPress={() => {
                      setPreloadConfirmOpen(false);
                      setPreloadDiskSpace(null);
                      handlePreload();
                    }}
                  >
                    {t("launcher.confirm_preload_btn")}
                  </GlassButton>
                </GlassAlertDialog.Footer>
              </GlassAlertDialog.Dialog>
            </GlassAlertDialog.Container>
          </GlassAlertDialog.Backdrop>
        </GlassAlertDialog>
      )}

      {/* Channel Switch Dialog - Channel Picker */}
      {switchOpen && detectedChannel && (
        <GlassAlertDialog
          isOpen
          onOpenChange={(o) => {
            if (!o) setSwitchOpen(false);
          }}
        >
          <GlassAlertDialog.Backdrop className="z-[300]">
            <GlassAlertDialog.Container>
              <GlassAlertDialog.Dialog className="sm:max-w-[400px]">
                <GlassAlertDialog.CloseTrigger />
                <GlassAlertDialog.Header>
                  <GlassAlertDialog.Icon status="info" />
                  <GlassAlertDialog.Heading>
                    {t("launcher.switch_channel_title")}
                  </GlassAlertDialog.Heading>
                </GlassAlertDialog.Header>
                <GlassAlertDialog.Body>
                  <p className="text-sm text-muted mb-4">
                    {t("launcher.switch_channel_desc")}
                  </p>
                  <div className="flex flex-col gap-2">
                    {ALL_CHANNELS.map((ch) => (
                      <button
                        key={ch}
                        type="button"
                        onClick={() => handleSwitchChannel(ch)}
                        disabled={ch === detectedChannel}
                        className={`flex items-center gap-3 p-3 rounded-lg border transition-all cursor-pointer disabled:cursor-not-allowed ${
                          ch === detectedChannel
                            ? "glass-surface border-primary/50 bg-primary/10 opacity-60"
                            : "glass-surface border-separator/50 hover:border-primary/50 hover:bg-primary/10"
                        }`}
                      >
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                            ch === detectedChannel
                              ? "bg-primary/30"
                              : "bg-primary/20"
                          }`}
                        >
                          <span className="text-sm font-bold text-primary">
                            {ch === "official"
                              ? "官"
                              : ch === "bilibili"
                                ? "B"
                                : ch === "global"
                                  ? "G"
                                  : "GP"}
                          </span>
                        </div>
                        <div className="flex flex-col items-start">
                          <span className="text-sm font-medium text-foreground/80">
                            {CHANNEL_LABELS[ch]?.[lang] || ch}
                          </span>
                          {ch === detectedChannel && (
                            <span className="text-[11px] text-primary/70">
                              {t("launcher.current_channel")}
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </GlassAlertDialog.Body>
                <GlassAlertDialog.Footer>
                  <GlassButton
                    variant="tertiary"
                    onPress={() => setSwitchOpen(false)}
                  >
                    {t("launcher.cancel")}
                  </GlassButton>
                </GlassAlertDialog.Footer>
              </GlassAlertDialog.Dialog>
            </GlassAlertDialog.Container>
          </GlassAlertDialog.Backdrop>
        </GlassAlertDialog>
      )}

      {/* Channel Switch Confirmation Dialog */}
      {switchConfirmTarget && detectedChannel && (
        <GlassAlertDialog
          isOpen
          onOpenChange={(o) => {
            if (!o) setSwitchConfirmTarget(null);
          }}
        >
          <GlassAlertDialog.Backdrop className="z-[300]">
            <GlassAlertDialog.Container>
              <GlassAlertDialog.Dialog className="sm:max-w-[400px]">
                <GlassAlertDialog.CloseTrigger />
                <GlassAlertDialog.Header>
                  <GlassAlertDialog.Icon status="warning" />
                  <GlassAlertDialog.Heading>
                    {t("launcher.switch_confirm_title")}
                  </GlassAlertDialog.Heading>
                </GlassAlertDialog.Header>
                <GlassAlertDialog.Body>
                  <p className="text-sm text-muted">
                    {t("launcher.switch_confirm_desc", {
                      from: CHANNEL_LABELS[detectedChannel]?.[lang],
                      to: CHANNEL_LABELS[switchConfirmTarget]?.[lang],
                    })}
                  </p>
                </GlassAlertDialog.Body>
                <GlassAlertDialog.Footer>
                  <GlassButton
                    variant="tertiary"
                    onPress={() => setSwitchConfirmTarget(null)}
                  >
                    {t("launcher.cancel")}
                  </GlassButton>
                  <GlassButton variant="primary" onPress={handleConfirmSwitch}>
                    {t("launcher.switch_confirm_btn")}
                  </GlassButton>
                </GlassAlertDialog.Footer>
              </GlassAlertDialog.Dialog>
            </GlassAlertDialog.Container>
          </GlassAlertDialog.Backdrop>
        </GlassAlertDialog>
      )}
    </>
  );
}

// ========== Game Settings Modal ==========

interface GameSettingsModalProps {
  initialPath: string;
  onClose: () => void;
  onSave: (path: string) => void;
}

function GameSettingsModal({
  initialPath,
  onClose,
  onSave,
}: GameSettingsModalProps) {
  const { t } = useTranslation();
  const [path, setPath] = useState(initialPath);

  const handleBrowse = useCallback(async () => {
    const selected = await browseFolder();
    if (selected) setPath(selected);
  }, []);

  return (
    <GlassModal isOpen onOpenChange={(open) => !open && onClose()}>
      <GlassModal.Backdrop isDismissable>
        <GlassModal.Container size="sm">
          <GlassModal.Dialog>
            <GlassModal.Header>
              <div className="flex items-center justify-between px-5 py-4 border-b border-separator/50">
                <GlassModal.Heading className="text-sm">
                  {t("launcher.game_settings")}
                </GlassModal.Heading>
                <GlassModal.CloseTrigger />
              </div>
            </GlassModal.Header>
            <GlassModal.Body>
              <div className="px-5 py-4 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-muted mb-1.5">
                    {t("launcher.install_path")}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={path}
                      onChange={(e) => setPath(e.target.value)}
                      className="flex-1 h-9 px-3 rounded-lg glass-field border border-separator text-sm text-foreground outline-none placeholder:text-muted"
                      placeholder="C:\Games\Endfield"
                    />
                    <button
                      type="button"
                      onClick={handleBrowse}
                      className="h-9 px-3 rounded-lg glass-surface border border-primary/30 text-xs font-medium text-primary hover:bg-primary/20 transition-colors cursor-pointer shrink-0"
                    >
                      {t("launcher.browse")}
                    </button>
                  </div>
                </div>
              </div>
            </GlassModal.Body>
            <GlassModal.Footer>
              <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-separator/50">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-8 px-4 rounded-lg text-xs font-medium text-muted hover:text-foreground hover:bg-white/10 transition-colors cursor-pointer"
                >
                  {t("launcher.cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => onSave(path)}
                  className="h-8 px-4 rounded-lg text-xs font-medium text-white bg-primary hover:bg-primary/90 transition-colors cursor-pointer"
                >
                  OK
                </button>
              </div>
            </GlassModal.Footer>
          </GlassModal.Dialog>
        </GlassModal.Container>
      </GlassModal.Backdrop>
    </GlassModal>
  );
}
