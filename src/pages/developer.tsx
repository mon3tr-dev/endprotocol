import { useTranslation } from "react-i18next";
import {
  GlassButton,
  GlassCard,
  GlassLabel,
  GlassMeter,
  GlassNumberField,
  GlassSelect,
  GlassSkeleton,
  GlassSwitch,
  GlassTable,
} from "@/components/ui/glass";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { getConfig, setConfig } from "@/utils/configService";
import { cacheManager, CacheMode } from "@/utils/imageCacheManager";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import logger, { LogEntry, LogLevel, logLevelToConfigValue, parseLogLevel } from "@/utils/logger";
import { setLogLevel as applyLogLevel } from "@/utils/logSettings";
import { invoke } from "@tauri-apps/api/core";
import { logError } from "@/utils/logger";
import { exportDiagnostics, revealDiagnostics } from "@/utils/diagnostics";
import { pushGlobalAlert } from "@/components/ui/global-alert";
import { MorphIcon } from "morphicons/react";
import { FileText, Settings } from "lucide";

interface CaptureBody {
  encoding: string;
  size: number;
  truncated: boolean;
  data: string;
}

interface CaptureEntry {
  index: number;
  timestamp: string;
  method: string;
  url: string;
  request_headers: [string, string][];
  request_body: CaptureBody | null;
  status: number | null;
  response_headers: [string, string][] | null;
  response_body: CaptureBody | null;
  duration_ms: number;
  error: string | null;
  note: string | null;
}

interface CaptureSession {
  id: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  count: number;
  size_bytes: number;
  path: string;
}

interface CaptureStatusInfo {
  recording: boolean;
  session_id: string | null;
  started_at: string | null;
  count: number;
  size_bytes: number;
}

interface CapturePage {
  total: number;
  entries: CaptureEntry[];
}

const CAPTURE_PAGE_SIZE = 100;
const MAX_BODY_VIEW = 50000;

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const formatBodyText = (body: CaptureBody | null, note: string | null): string => {
  if (note && !body) return `[${note}]`;
  if (!body) return "";
  if (body.encoding === "base64") {
    return `[binary] ${formatBytes(body.size)}`;
  }
  let text = body.data;
  try {
    text = JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    text = body.data;
  }
  if (text.length > MAX_BODY_VIEW) {
    text = `${text.slice(0, MAX_BODY_VIEW)}\n… (${formatBytes(body.size)})`;
  }
  if (body.truncated) {
    text = `${text}\n… (truncated)`;
  }
  return text;
};

const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: "DEBUG",
  [LogLevel.INFO]: "INFO",
  [LogLevel.WARN]: "WARN",
  [LogLevel.ERROR]: "ERROR",
};

const LEVEL_BADGE_BG: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: "bg-secondary",
  [LogLevel.INFO]: "bg-success",
  [LogLevel.WARN]: "bg-warning",
  [LogLevel.ERROR]: "bg-danger",
};

const LEVEL_TEXT: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: "text-secondary",
  [LogLevel.INFO]: "text-success",
  [LogLevel.WARN]: "text-warning",
  [LogLevel.ERROR]: "text-danger",
};

const LEVEL_BG_SOFT: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: "bg-secondary/15",
  [LogLevel.INFO]: "bg-success/15",
  [LogLevel.WARN]: "bg-warning/15",
  [LogLevel.ERROR]: "bg-danger/15",
};

const LEVEL_BORDER: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: "border-secondary",
  [LogLevel.INFO]: "border-success",
  [LogLevel.WARN]: "border-warning",
  [LogLevel.ERROR]: "border-danger",
};

const MAX_VISIBLE_LOGS = 500;
const MAX_MESSAGE_LENGTH = 300;

type LogFilter = "all" | "frontend" | "backend";
type LogLevelFilter = LogLevel | "all";

export default function DeveloperPage() {
  const { t, i18n } = useTranslation();
  const zh = i18n.language === "zh";

  const [cacheMode, setCacheMode] = useState<CacheMode>("smart");
  const [cacheMaxEntries, setCacheMaxEntries] = useState(200);
  const [cacheMaxSizeMB, setCacheMaxSizeMB] = useState(100);
  const [cacheStats, setCacheStats] = useState(cacheManager.getStats());
  const [showCacheTable, setShowCacheTable] = useState(false);

  const [logSourceFilter, setLogSourceFilter] = useState<LogFilter>("all");
  const [logLevelFilter, setLogLevelFilter] = useState<LogLevelFilter>("all");
  const [logLevel, setLogLevelState] = useState<LogLevel>(LogLevel.DEBUG);
  const [isExportingDiagnostics, setIsExportingDiagnostics] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const backendLogsRef = useRef<LogEntry[]>([]);
  const knownTimestampsRef = useRef<Set<string>>(new Set());
  const [displayKey, setDisplayKey] = useState(0);

  const cacheEntries = useMemo(() => cacheManager.getEntries(), [cacheStats]);

  const [isConfigLoading, setIsConfigLoading] = useState(true);

  const [captureStatus, setCaptureStatus] = useState<CaptureStatusInfo | null>(null);
  const [captureSessions, setCaptureSessions] = useState<CaptureSession[]>([]);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [autoStartCapture, setAutoStartCapture] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [captureEntries, setCaptureEntries] = useState<CaptureEntry[]>([]);
  const [captureTotal, setCaptureTotal] = useState(0);
  const [selectedEntry, setSelectedEntry] = useState<CaptureEntry | null>(null);

  const refreshCapture = useCallback(async () => {
    try {
      const [statusInfo, sessionList] = await Promise.all([
        invoke<CaptureStatusInfo>("capture_status"),
        invoke<CaptureSession[]>("capture_list_sessions"),
      ]);
      setCaptureStatus(statusInfo);
      setCaptureSessions(sessionList);
    } catch {
      // Tauri not available
    }
  }, []);

  const loadCaptureEntries = useCallback(
    async (id: string, from: number, replace: boolean) => {
      try {
        const page = await invoke<CapturePage>("capture_read_entries", {
          id,
          offset: from,
          limit: CAPTURE_PAGE_SIZE,
        });
        setCaptureTotal(page.total);
        setCaptureEntries((prev) =>
          replace ? page.entries : [...prev, ...page.entries]
        );
      } catch (e) {
        logError("[Developer] capture read failed:", e);
        setCaptureError(String(e));
      }
    },
    []
  );

  const handleCaptureStart = async () => {
    setCaptureBusy(true);
    setCaptureError(null);
    try {
      setCaptureStatus(await invoke<CaptureStatusInfo>("capture_start"));
      await refreshCapture();
    } catch (e) {
      logError("[Developer] capture start failed:", e);
      setCaptureError(String(e));
    } finally {
      setCaptureBusy(false);
    }
  };

  const handleCaptureStop = async () => {
    setCaptureBusy(true);
    setCaptureError(null);
    try {
      setCaptureStatus(await invoke<CaptureStatusInfo>("capture_stop"));
      await refreshCapture();
      if (viewingId) {
        await loadCaptureEntries(viewingId, 0, true);
      }
    } catch (e) {
      logError("[Developer] capture stop failed:", e);
      setCaptureError(String(e));
    } finally {
      setCaptureBusy(false);
    }
  };

  const handleViewSession = async (id: string) => {
    setViewingId(id);
    setSelectedEntry(null);
    setCaptureEntries([]);
    setCaptureTotal(0);
    await loadCaptureEntries(id, 0, true);
  };

  const handleCloseSession = () => {
    setViewingId(null);
    setSelectedEntry(null);
    setCaptureEntries([]);
    setCaptureTotal(0);
  };

  const handleDeleteSession = async (id: string) => {
    setCaptureError(null);
    try {
      await invoke("capture_delete_session", { id });
      if (viewingId === id) {
        handleCloseSession();
      }
      await refreshCapture();
    } catch (e) {
      logError("[Developer] capture delete failed:", e);
      setCaptureError(String(e));
    }
  };

  const handleOpenCaptureDir = async () => {
    try {
      const dir = await invoke<string>("capture_dir");
      await revealItemInDir(dir);
    } catch (e) {
      logError("[Developer] capture dir failed:", e);
      setCaptureError(String(e));
    }
  };

  const handleAutoStartChange = async (value: boolean) => {
    setAutoStartCapture(value);
    try {
      await setConfig("capture_autostart", value);
    } catch (e) {
      logError("[Developer] save capture_autostart failed:", e);
      setCaptureError(String(e));
    }
  };

  useEffect(() => {
    refreshCapture();
    getConfig<boolean>("capture_autostart")
      .then((v) => setAutoStartCapture(v ?? false))
      .catch((e) => logError("[Developer] load capture_autostart failed:", e));
  }, [refreshCapture]);

  useEffect(() => {
    if (!captureStatus?.recording) return;
    const timer = setInterval(refreshCapture, 2000);
    return () => clearInterval(timer);
  }, [captureStatus?.recording, refreshCapture]);

  useEffect(() => {
    const loadConfig = async () => {
      setIsConfigLoading(true);
      const [mode, maxEntries, maxSizeMB, savedLogLevel] = await Promise.all([
        getConfig<CacheMode>("cache_mode"),
        getConfig<number>("cache_max_entries"),
        getConfig<number>("cache_max_size_mb"),
        getConfig<string>("log_level"),
      ]);
      const resolvedMode = mode ?? "smart";
      const resolvedEntries = maxEntries ?? 200;
      const resolvedSize = maxSizeMB ?? 100;
      setCacheMode(resolvedMode);
      setCacheMaxEntries(resolvedEntries);
      setCacheMaxSizeMB(resolvedSize);
      setLogLevelState(parseLogLevel(savedLogLevel, LogLevel.DEBUG));
      cacheManager.configure({
        mode: resolvedMode,
        maxEntries: resolvedEntries,
        maxSizeMB: resolvedSize,
      });
      setCacheStats(cacheManager.getStats());
      setIsConfigLoading(false);
    };
    loadConfig();
  }, []);

  const fetchBackendLogs = useCallback(async () => {
    try {
      const raw = await invoke<unknown[]>("get_backend_logs");
      const levelMap: Record<string, LogLevel> = {
        Debug: LogLevel.DEBUG,
        Info: LogLevel.INFO,
        Warn: LogLevel.WARN,
        Error: LogLevel.ERROR,
      };
      const newEntries: LogEntry[] = [];
      for (const r of raw as Record<string, unknown>[]) {
        const ts = r.timestamp as string;
        if (!knownTimestampsRef.current.has(ts)) {
          knownTimestampsRef.current.add(ts);
          newEntries.push({
            timestamp: ts,
            level: levelMap[r.level as string] ?? LogLevel.INFO,
            message: r.message as string,
            module: r.module as string,
            source: "backend" as const,
          });
        }
      }
      if (newEntries.length > 0) {
        const existing = backendLogsRef.current;
        backendLogsRef.current = [...existing, ...newEntries];
        if (backendLogsRef.current.length > MAX_VISIBLE_LOGS * 2) {
          backendLogsRef.current = backendLogsRef.current.slice(-MAX_VISIBLE_LOGS);
          knownTimestampsRef.current = new Set(
            backendLogsRef.current.map((e) => e.timestamp)
          );
        }
        setDisplayKey((k) => k + 1);
      }
    } catch {
      // Tauri not available
    }
  }, []);

  useEffect(() => {
    fetchBackendLogs();
    const interval = setInterval(fetchBackendLogs, 3000);
    return () => clearInterval(interval);
  }, [fetchBackendLogs]);

  useEffect(() => {
    if (logContainerRef.current) {
      const el = logContainerRef.current;
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      if (isNearBottom) {
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight;
        });
      }
    }
  }, [displayKey]);

  const filteredLogs = useMemo(() => {
    const frontendLogs = logger.getLogs();
    const backendLogs = backendLogsRef.current;

    const source =
      logSourceFilter === "all"
        ? [...backendLogs, ...frontendLogs]
        : logSourceFilter === "frontend"
          ? frontendLogs
          : backendLogs;

    const filtered =
      logLevelFilter === "all"
        ? source
        : source.filter((e) => e.level === logLevelFilter);

    filtered.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return filtered.slice(-MAX_VISIBLE_LOGS);
  }, [logSourceFilter, logLevelFilter, displayKey]);

  const handleCacheModeChange = async (value: CacheMode) => {
    setCacheMode(value);
    cacheManager.configure({ mode: value });
    await setConfig("cache_mode", value);
    setCacheStats(cacheManager.getStats());
  };

  const handleCacheMaxEntriesChange = async (value: number) => {
    const clamped = Math.max(10, Math.min(5000, value));
    setCacheMaxEntries(clamped);
    cacheManager.configure({ maxEntries: clamped });
    await setConfig("cache_max_entries", clamped);
    setCacheStats(cacheManager.getStats());
  };

  const handleCacheMaxSizeMBChange = async (value: number) => {
    const clamped = Math.max(10, Math.min(10000, value));
    setCacheMaxSizeMB(clamped);
    cacheManager.configure({ maxSizeMB: clamped });
    await setConfig("cache_max_size_mb", clamped);
    setCacheStats(cacheManager.getStats());
  };

  const refreshCacheStats = () => {
    setCacheStats(cacheManager.getStats());
  };

  const cleanInactive = () => {
    cacheManager.evictInactive();
    setCacheStats(cacheManager.getStats());
  };

  const clearLogs = () => {
    logger.clearLogs();
    backendLogsRef.current = [];
    knownTimestampsRef.current = new Set();
    setDisplayKey((k) => k + 1);
  };

  const handleLogLevelChange = async (value: string) => {
    const level = parseLogLevel(value, LogLevel.DEBUG);
    setLogLevelState(level);
    await applyLogLevel(level);
    setDisplayKey((k) => k + 1);
  };

  const handleExportDiagnostics = async () => {
    setIsExportingDiagnostics(true);
    try {
      const path = await exportDiagnostics("Developer log export");
      await revealDiagnostics(path);
      pushGlobalAlert(
        "success",
        `${t("crash.action_exported")}: ${path}`,
        5000,
      );
    } catch (error) {
      logError("Failed to export diagnostics:", error);
      pushGlobalAlert(
        "danger",
        t("crash.export_failed", { error: String(error) }),
        6000,
      );
    } finally {
      setIsExportingDiagnostics(false);
    }
  };

  const truncateMessage = (msg: string): string => {
    if (msg.length > MAX_MESSAGE_LENGTH) {
      return msg.slice(0, MAX_MESSAGE_LENGTH) + "...";
    }
    return msg;
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12">
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold text-foreground tracking-tight">
          {t("settings.developer.title")}
        </h1>
        <p className="text-foreground/70 mt-1.5">{t("settings.developer.enable_desc")}</p>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {/* Image Cache Settings */}
        <GlassCard id="developer-cache" className="p-6 glass-surface border border-separator/90 overflow-hidden">
          <h2 className="text-lg font-semibold mb-6 flex items-center gap-2">
            <span className="w-1 h-5 bg-primary rounded-full" />
            {t("settings.cache.title")}
          </h2>
          {isConfigLoading ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <GlassSkeleton className="w-32 h-4 rounded-lg" />
                  <GlassSkeleton className="w-48 h-3 rounded-lg" />
                </div>
                <GlassSkeleton className="w-12 h-6 rounded-full" />
              </div>
            </div>
          ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground">
                  {t("settings.cache.mode")}
                </p>
                <p className="text-sm text-muted mt-0.5">
                  {cacheMode === "smart"
                    ? t("settings.cache.mode_smart_desc")
                    : t("settings.cache.mode_manual_desc")}
                </p>
              </div>
              <GlassSwitch
                isSelected={cacheMode === "smart"}
                onValueChange={(v) => handleCacheModeChange(v ? "smart" : "manual")}
                className="shrink-0"
              >
                <GlassSwitch.Control>
                  <GlassSwitch.Thumb />
                </GlassSwitch.Control>
              </GlassSwitch>
            </div>

            {cacheMode === "manual" && (
              <>
                <div className="h-px bg-separator w-full" />

                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground">
                      {t("settings.cache.max_entries")}
                    </p>
                    <p className="text-sm text-muted mt-0.5">
                      {t("settings.cache.max_entries_desc")}
                    </p>
                  </div>
                    <GlassNumberField
                      value={cacheMaxEntries}
                      onChange={(v) => handleCacheMaxEntriesChange(v)}
                      minValue={10}
                      maxValue={5000}
                      aria-label={t("settings.cache.max_entries")}
                      className="shrink-0"
                    >
                      <GlassNumberField.Group className="text-foreground">
                        <GlassNumberField.DecrementButton aria-label="Decrease" className="text-foreground" />
                        <GlassNumberField.Input className="w-[120px]" />
                        <GlassNumberField.IncrementButton aria-label="Increase" className="text-foreground" />
                      </GlassNumberField.Group>
                    </GlassNumberField>
                </div>

                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground">
                      {t("settings.cache.max_size_mb")}
                    </p>
                    <p className="text-sm text-muted mt-0.5">
                      {t("settings.cache.max_size_mb_desc")}
                    </p>
                  </div>
                    <GlassNumberField
                      value={cacheMaxSizeMB}
                      onChange={(v) => handleCacheMaxSizeMBChange(v)}
                      minValue={10}
                      maxValue={10000}
                      aria-label={t("settings.cache.max_size_mb")}
                      className="shrink-0"
                    >
                      <GlassNumberField.Group className="text-foreground">
                        <GlassNumberField.DecrementButton aria-label="Decrease" className="text-foreground" />
                        <GlassNumberField.Input className="w-[120px]" />
                        <GlassNumberField.IncrementButton aria-label="Increase" className="text-foreground" />
                      </GlassNumberField.Group>
                    </GlassNumberField>
                </div>
              </>
            )}

            {cacheMode === "manual" && (
              <>
                <div className="h-px bg-separator w-full" />

                <div className="space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-foreground">
                        {t("settings.cache.current_cache")}
                      </p>
                      <div className="flex items-center gap-2">
                        <GlassButton variant="outline" size="sm" onPress={cleanInactive}>
                          {t("settings.cache.clean_inactive")}
                        </GlassButton>
                        <GlassButton variant="outline" size="sm" onPress={refreshCacheStats} className="shrink-0">
                          {t("common.refresh")}
                        </GlassButton>
                      </div>
                    </div>

                  <GlassMeter aria-label="entries-usage" value={Math.round((cacheStats.entries / Math.max(cacheStats.maxEntries, 1)) * 100)} className="w-full">
                    <GlassLabel>
                      {t("settings.cache.entries_count")}: {cacheStats.entries} / {cacheStats.maxEntries}
                    </GlassLabel>
                    <GlassMeter.Output />
                    <GlassMeter.Track>
                      <GlassMeter.Fill />
                    </GlassMeter.Track>
                  </GlassMeter>

                  <GlassMeter aria-label="size-usage" value={cacheStats.maxSizeMB > 0 ? Math.round((cacheStats.totalSizeMB / cacheStats.maxSizeMB) * 100) : 0} className="w-full">
                    <GlassLabel>
                      {t("settings.cache.size_usage")}: {cacheStats.totalSizeMB} MB / {cacheStats.maxSizeMB} MB
                    </GlassLabel>
                    <GlassMeter.Output />
                    <GlassMeter.Track>
                      <GlassMeter.Fill />
                    </GlassMeter.Track>
                  </GlassMeter>
                </div>

                <div className="space-y-2">
                  <button
                    className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors"
                    onClick={() => setShowCacheTable(!showCacheTable)}
                  >
                    <svg
                      className={`w-4 h-4 transition-transform ${showCacheTable ? "rotate-90" : ""}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    {t("settings.cache.cached_resources")} ({cacheEntries.length})
                  </button>

                  {showCacheTable && cacheEntries.length > 0 && (
                    <GlassTable>
                      <GlassTable.ScrollContainer>
                        <GlassTable.Content aria-label="Cached images" className="min-w-[400px]">
                          <GlassTable.Header>
                            <GlassTable.Column isRowHeader>{t("settings.cache.filename")}</GlassTable.Column>
                            <GlassTable.Column>{t("settings.cache.size")}</GlassTable.Column>
                            <GlassTable.Column>{t("settings.cache.status")}</GlassTable.Column>
                          </GlassTable.Header>
                          <GlassTable.Body>
                            {cacheEntries.map((entry) => (
                              <GlassTable.Row key={entry.path}>
                                <GlassTable.Cell className="font-mono text-xs truncate max-w-[200px]">
                                  <button
                                    className="hover:text-primary transition-colors truncate block w-full text-left"
                                    onClick={() => revealItemInDir(entry.path)}
                                    title={t("settings.cache.open_file_location")}
                                  >
                                    {entry.path.split(/[\\/]/).pop()}
                                  </button>
                                </GlassTable.Cell>
                                <GlassTable.Cell>{entry.sizeKB} KB</GlassTable.Cell>
                                <GlassTable.Cell>
                                  {entry.pinned
                                    ? t("settings.cache.status_pinned")
                                    : entry.refCount > 0
                                      ? t("settings.cache.status_active")
                                      : t("settings.cache.status_inactive")}
                                </GlassTable.Cell>
                              </GlassTable.Row>
                            ))}
                          </GlassTable.Body>
                        </GlassTable.Content>
                      </GlassTable.ScrollContainer>
                    </GlassTable>
                  )}

                  {showCacheTable && cacheEntries.length === 0 && (
                    <p className="text-sm text-muted">{t("settings.cache.no_cached")}</p>
                  )}
                </div>
              </>
            )}
          </div>
          )}
        </GlassCard>

        {/* 网络请求录制 */}
        <GlassCard id="developer-capture" className="p-6 glass-surface border border-separator/90 overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span
                className={`w-1 h-5 rounded-full ${
                  captureStatus?.recording ? "bg-danger" : "bg-primary"
                }`}
              />
              {zh ? "网络请求录制" : "Network Recording"}
              <span
                className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                  captureStatus?.recording
                    ? "bg-danger/10 text-danger"
                    : "bg-default-100 text-muted"
                }`}
              >
                {captureStatus?.recording
                  ? zh
                    ? "录制中"
                    : "Recording"
                  : zh
                    ? "未录制"
                    : "Idle"}
              </span>
            </h2>
            <div className="flex items-center gap-2">
              {!captureStatus?.recording ? (
                <GlassButton
                  variant="primary"
                  size="sm"
                  isDisabled={captureBusy}
                  onPress={handleCaptureStart}
                >
                  {captureBusy
                    ? zh
                      ? "处理中…"
                      : "Working…"
                    : zh
                      ? "开始录制"
                      : "Start Recording"}
                </GlassButton>
              ) : (
                <GlassButton
                  variant="danger"
                  size="sm"
                  isDisabled={captureBusy}
                  onPress={handleCaptureStop}
                >
                  {captureBusy
                    ? zh
                      ? "处理中…"
                      : "Working…"
                    : zh
                      ? "停止录制"
                      : "Stop Recording"}
                </GlassButton>
              )}
              <GlassButton variant="outline" size="sm" onPress={handleOpenCaptureDir}>
                {zh ? "打开目录" : "Open Folder"}
              </GlassButton>
              <GlassButton variant="outline" size="sm" onPress={refreshCapture}>
                {t("common.refresh")}
              </GlassButton>
            </div>
          </div>

          <p className="text-sm text-muted mb-4">
            {zh
              ? "开始录制后，应用发出的所有网络请求及其返回内容会逐条保存到本地 network_capture 目录，直到点击停止录制；可在下方浏览每个会话的请求头、请求体与完整响应。流式下载的大型文件仅记录请求与状态，不保存响应体。"
              : "While recording, every network request sent by the app and its response content is saved to the local network_capture folder until you stop. Browse request headers, request bodies and full responses of each session below. Large streaming downloads only record the request and status."}
          </p>

          <div className="flex items-center justify-between gap-4 mb-4">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-foreground">
                {zh ? "启动时自动录制" : "Auto-record on launch"}
              </p>
              <p className="text-sm text-muted mt-0.5">
                {zh
                  ? "下次启动应用时，在发出任何 API 请求之前自动开始录制；不影响当前录制会话，打开后下次启动状态会直接显示为「录制中」。"
                  : "Start recording automatically on the next launch, before any API request is sent. Does not affect the current session; on the next launch the status shows Recording right away."}
              </p>
            </div>
            <GlassSwitch
              isSelected={autoStartCapture}
              onValueChange={handleAutoStartChange}
              isDisabled={captureBusy}
              aria-label={zh ? "启动时自动录制" : "Auto-record on launch"}
              className="shrink-0"
            >
              <GlassSwitch.Control>
                <GlassSwitch.Thumb />
              </GlassSwitch.Control>
            </GlassSwitch>
          </div>

          {captureError && (
            <p className="text-sm text-danger mb-3 break-all">{captureError}</p>
          )}

          <div className="flex flex-wrap items-center gap-3 mb-4 text-xs text-muted font-mono">
            {captureStatus?.recording && captureStatus.session_id ? (
              <>
                <span className="text-danger font-semibold">
                  ● {captureStatus.session_id}
                </span>
                <span>
                  {captureStatus.count} {zh ? "条请求" : "requests"}
                </span>
                <span>{formatBytes(captureStatus.size_bytes)}</span>
              </>
            ) : (
              <span>{zh ? "当前未在录制" : "Not recording"}</span>
            )}
            <span className="ml-auto">
              {captureSessions.length} {zh ? "个会话" : "sessions"}
            </span>
          </div>

          {captureSessions.length === 0 ? (
            <p className="text-sm text-muted">
              {zh ? "暂无录制会话" : "No recording sessions yet"}
            </p>
          ) : (
            <GlassTable>
              <GlassTable.ScrollContainer>
                <GlassTable.Content aria-label="Capture sessions" className="min-w-[620px]">
                  <GlassTable.Header>
                    <GlassTable.Column isRowHeader>
                      {zh ? "开始时间" : "Started"}
                    </GlassTable.Column>
                    <GlassTable.Column>{zh ? "结束时间" : "Ended"}</GlassTable.Column>
                    <GlassTable.Column>{zh ? "请求数" : "Requests"}</GlassTable.Column>
                    <GlassTable.Column>{zh ? "大小" : "Size"}</GlassTable.Column>
                    <GlassTable.Column>{zh ? "状态" : "Status"}</GlassTable.Column>
                    <GlassTable.Column>{zh ? "操作" : "Actions"}</GlassTable.Column>
                  </GlassTable.Header>
                  <GlassTable.Body>
                    {captureSessions.map((session) => (
                      <GlassTable.Row key={session.id}>
                        <GlassTable.Cell className="font-mono text-xs">
                          {session.started_at}
                        </GlassTable.Cell>
                        <GlassTable.Cell className="font-mono text-xs">
                          {session.ended_at ?? "—"}
                        </GlassTable.Cell>
                        <GlassTable.Cell>{session.count}</GlassTable.Cell>
                        <GlassTable.Cell>{formatBytes(session.size_bytes)}</GlassTable.Cell>
                        <GlassTable.Cell>
                          <span
                            className={
                              session.status === "recording"
                                ? "text-danger font-semibold"
                                : "text-success"
                            }
                          >
                            {session.status === "recording"
                              ? zh
                                ? "录制中"
                                : "Recording"
                              : zh
                                ? "已完成"
                                : "Done"}
                          </span>
                        </GlassTable.Cell>
                        <GlassTable.Cell>
                          <div className="flex items-center gap-3 text-xs">
                            <button
                              className="text-primary hover:underline"
                              onClick={() => handleViewSession(session.id)}
                            >
                              {zh ? "浏览" : "Browse"}
                            </button>
                            <button
                              className="text-primary hover:underline"
                              onClick={() => revealItemInDir(session.path)}
                            >
                              {zh ? "目录" : "Folder"}
                            </button>
                            <button
                              className="text-danger hover:underline"
                              onClick={() => handleDeleteSession(session.id)}
                            >
                              {zh ? "删除" : "Delete"}
                            </button>
                          </div>
                        </GlassTable.Cell>
                      </GlassTable.Row>
                    ))}
                  </GlassTable.Body>
                </GlassTable.Content>
              </GlassTable.ScrollContainer>
            </GlassTable>
          )}

          {viewingId && (
            <div className="mt-6 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-mono text-xs text-foreground break-all">
                  {viewingId} · {captureEntries.length} / {captureTotal}
                </p>
                <div className="flex items-center gap-2">
                  {captureEntries.length < captureTotal && (
                    <GlassButton
                      variant="outline"
                      size="sm"
                      onPress={() => loadCaptureEntries(viewingId, captureEntries.length, false)}
                    >
                      {zh ? "加载更多" : "Load more"}
                    </GlassButton>
                  )}
                  <GlassButton variant="outline" size="sm" onPress={handleCloseSession}>
                    {zh ? "关闭" : "Close"}
                  </GlassButton>
                </div>
              </div>

              {captureEntries.length === 0 ? (
                <p className="text-sm text-muted">
                  {zh ? "该会话没有记录" : "No entries in this session"}
                </p>
              ) : (
                <GlassTable>
                  <GlassTable.ScrollContainer>
                    <GlassTable.Content aria-label="Capture entries" className="min-w-[620px]">
                      <GlassTable.Header>
                        <GlassTable.Column isRowHeader>#</GlassTable.Column>
                        <GlassTable.Column>{zh ? "方法" : "Method"}</GlassTable.Column>
                        <GlassTable.Column>{zh ? "状态" : "Status"}</GlassTable.Column>
                        <GlassTable.Column>{zh ? "耗时" : "Time"}</GlassTable.Column>
                        <GlassTable.Column>URL</GlassTable.Column>
                      </GlassTable.Header>
                      <GlassTable.Body>
                        {captureEntries.map((entry) => (
                          <GlassTable.Row key={`${entry.index}-${entry.timestamp}`}>
                            <GlassTable.Cell className="font-mono text-xs">
                              {entry.index}
                            </GlassTable.Cell>
                            <GlassTable.Cell className="font-mono text-xs font-semibold">
                              {entry.method}
                            </GlassTable.Cell>
                            <GlassTable.Cell>
                              <span
                                className={
                                  entry.error
                                    ? "text-danger font-semibold"
                                    : (entry.status ?? 0) < 400
                                      ? "text-success font-semibold"
                                      : "text-warning font-semibold"
                                }
                              >
                                {entry.error ? "ERR" : entry.status ?? "—"}
                              </span>
                            </GlassTable.Cell>
                            <GlassTable.Cell className="font-mono text-xs">
                              {entry.duration_ms} ms
                            </GlassTable.Cell>
                            <GlassTable.Cell className="max-w-[320px]">
                              <button
                                className={`text-left text-xs font-mono truncate block w-full hover:text-primary transition-colors ${
                                  selectedEntry?.index === entry.index
                                    ? "text-primary font-semibold"
                                    : "text-foreground/80"
                                }`}
                                onClick={() => setSelectedEntry(entry)}
                                title={entry.url}
                              >
                                {entry.url}
                              </button>
                            </GlassTable.Cell>
                          </GlassTable.Row>
                        ))}
                      </GlassTable.Body>
                    </GlassTable.Content>
                  </GlassTable.ScrollContainer>
                </GlassTable>
              )}

              {selectedEntry && (
                <div className="glass-surface rounded-xl border border-separator/80 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-mono text-xs break-all text-foreground flex-1">
                      <span className="font-bold text-primary">{selectedEntry.method}</span>{" "}
                      {selectedEntry.url}
                    </p>
                    <GlassButton
                      variant="outline"
                      size="sm"
                      onPress={() => setSelectedEntry(null)}
                    >
                      {zh ? "关闭详情" : "Close"}
                    </GlassButton>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono text-muted">
                    <span>
                      {zh ? "时间" : "Time"}: {selectedEntry.timestamp}
                    </span>
                    <span>
                      {zh ? "状态" : "Status"}:{" "}
                      <span
                        className={
                          selectedEntry.error
                            ? "text-danger"
                            : (selectedEntry.status ?? 0) < 400
                              ? "text-success"
                              : "text-warning"
                        }
                      >
                        {selectedEntry.error ?? selectedEntry.status ?? "—"}
                      </span>
                    </span>
                    <span>
                      {zh ? "耗时" : "Duration"}: {selectedEntry.duration_ms} ms
                    </span>
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-foreground mb-1">
                      {zh ? "请求头" : "Request Headers"}
                    </p>
                    <pre className="text-[11px] font-mono text-muted bg-default-100/60 rounded-lg p-2.5 overflow-auto max-h-40 whitespace-pre-wrap break-all">
                      {selectedEntry.request_headers
                        .map(([key, value]) => `${key}: ${value}`)
                        .join("\n") || "—"}
                    </pre>
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-foreground mb-1">
                      {zh ? "请求体" : "Request Body"}
                    </p>
                    <pre className="text-[11px] font-mono text-muted bg-default-100/60 rounded-lg p-2.5 overflow-auto max-h-60 whitespace-pre-wrap break-all">
                      {formatBodyText(selectedEntry.request_body, null) || "—"}
                    </pre>
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-foreground mb-1">
                      {zh ? "响应头" : "Response Headers"}
                    </p>
                    <pre className="text-[11px] font-mono text-muted bg-default-100/60 rounded-lg p-2.5 overflow-auto max-h-40 whitespace-pre-wrap break-all">
                      {(selectedEntry.response_headers ?? [])
                        .map(([key, value]) => `${key}: ${value}`)
                        .join("\n") || "—"}
                    </pre>
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-foreground mb-1">
                      {zh ? "响应体" : "Response Body"}
                      {selectedEntry.response_body ? (
                        <span className="text-muted font-normal">
                          {" "}
                          ({formatBytes(selectedEntry.response_body.size)})
                        </span>
                      ) : null}
                    </p>
                    <pre className="text-[11px] font-mono text-muted bg-default-100/60 rounded-lg p-2.5 overflow-auto max-h-[420px] whitespace-pre-wrap break-all">
                      {formatBodyText(selectedEntry.response_body, selectedEntry.note) || "—"}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          )}
        </GlassCard>

        {/* Log Viewer */}
        <GlassCard id="developer-logs" className="p-6 glass-surface border border-separator/90 overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span className="w-1 h-5 bg-secondary rounded-full" />
              {t("settings.logs.title")}
            </h2>
            <div className="flex items-center gap-2">
              <GlassButton
                variant="outline"
                size="sm"
                onPress={handleExportDiagnostics}
                isDisabled={isExportingDiagnostics}
                isLoading={isExportingDiagnostics}
              >
                {isExportingDiagnostics
                  ? t("crash.action_exporting")
                  : t("crash.action_export")}
              </GlassButton>
              <GlassButton variant="outline" size="sm" onPress={fetchBackendLogs}>
                {t("common.refresh")}
              </GlassButton>
              <GlassButton variant="outline" size="sm" onPress={clearLogs}>
                {i18n.language === "zh" ? "清除" : "Clear"}
              </GlassButton>
            </div>
          </div>

          {/* Log level setting */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3 p-3 rounded-xl bg-default-100/40 border border-separator/50">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {t("settings.logs.level_setting")}
              </p>
              <p className="text-xs text-muted mt-0.5">
                {t("settings.logs.level_setting_desc")}
              </p>
            </div>
            <GlassSelect
              value={logLevelToConfigValue(logLevel)}
              options={(
                [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR] as const
              ).map((level) => ({
                value: logLevelToConfigValue(level),
                label: LOG_LEVEL_NAMES[level],
              }))}
              onChange={handleLogLevelChange}
            />
          </div>

          {/* Source tabs */}
          <div className="flex gap-1 mb-3 bg-default-100/60 p-1 rounded-xl">
            {(["all", "frontend", "backend"] as LogFilter[]).map((f) => {
              const isActive = logSourceFilter === f;
              return (
                <button
                  key={f}
                  onClick={() => setLogSourceFilter(f)}
                  className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-1 ${
                    isActive
                      ? "glass-surface text-foreground shadow-sm border border-separator/80"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {f === "frontend" && <MorphIcon icon={FileText} size={12} />}
                  {f === "backend" && <MorphIcon icon={Settings} size={12} />}
                  {f === "all"
                    ? (i18n.language === "zh" ? "所有日志" : "All Logs")
                    : f === "frontend"
                      ? (i18n.language === "zh" ? "前端" : "Frontend")
                      : (i18n.language === "zh" ? "后端" : "Backend")}
                </button>
              );
            })}
          </div>

          {/* Level filter */}
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            {(["all" as const, LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR] as const).map((l) => {
              const isActive = logLevelFilter === l;
              return (
                <button
                  key={String(l)}
                  onClick={() => setLogLevelFilter(l)}
                  className={`px-2.5 py-1 text-xs rounded-lg border transition-all duration-200 font-medium ${
                    isActive && l !== "all"
                      ? `${LEVEL_TEXT[l]} ${LEVEL_BG_SOFT[l]} ${LEVEL_BORDER[l]} bg-background`
                      : "border-separator/60 text-muted hover:text-foreground hover:bg-default-50"
                  }`}
                >
                  {l === "all"
                    ? (i18n.language === "zh" ? "全部级别" : "All Levels")
                    : LOG_LEVEL_NAMES[l]}
                </button>
              );
            })}
            <span className="text-xs text-muted ml-auto">
              {filteredLogs.length} {i18n.language === "zh" ? "条" : "entries"}
            </span>
          </div>

          {/* Log entries */}
          <div
            ref={logContainerRef}
            className="glass-surface rounded-xl border border-separator/80 overflow-y-auto font-mono text-xs"
            style={{ maxHeight: "480px" }}
          >
            {filteredLogs.length === 0 ? (
              <div className="flex items-center justify-center h-24 text-muted/60">
                {i18n.language === "zh" ? "暂无日志" : "No logs"}
              </div>
            ) : (
              <div className="p-1 space-y-px">
                {filteredLogs.map((entry, idx) => {
                  const levelName = LOG_LEVEL_NAMES[entry.level];
                  return (
                    <div
                      key={`${entry.timestamp}-${idx}`}
                      className={`flex items-start gap-1.5 px-2 py-1 rounded transition-colors ${
                        entry.source === "backend"
                          ? "hover:bg-secondary/5"
                          : "hover:bg-success/5"
                      }`}
                    >
                      <span
                        className={`shrink-0 font-bold text-[10px] leading-5 px-1.5 rounded text-white text-center min-w-[44px] ${LEVEL_BADGE_BG[entry.level]}`}
                      >
                        {levelName}
                      </span>
                      <span className="shrink-0 text-muted/70 leading-5 whitespace-nowrap font-normal">
                        {entry.timestamp}
                      </span>
                      <span
                        className={`shrink-0 leading-5 font-semibold ${entry.source === "backend" ? "text-secondary" : "text-success"}`}
                      >
                        {entry.source === "backend" ? "Backend" : "Frontend"}
                      </span>
                      <span className="shrink-0 leading-5 text-muted/50 font-normal max-w-[100px] truncate">
                        {entry.module}
                      </span>
                      <span
                        className={`leading-5 break-all flex-1 min-w-0 font-normal ${LEVEL_TEXT[entry.level]}`}
                        title={entry.message.length > MAX_MESSAGE_LENGTH ? entry.message : undefined}
                      >
                        {truncateMessage(entry.message)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
