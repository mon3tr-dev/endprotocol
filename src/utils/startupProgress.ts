import i18n from "@/i18n";

const STARTUP_TIMEOUT_MS = 45_000;

let trackingStartup = false;
let startupComplete = false;
let progress = 8;
let pendingTasks = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
let readyStatus = "";
let failureActionsBound = false;

function renderProgress(status?: string) {
  const bar = document.getElementById("startup-splash-progress");
  const progressbar = bar?.parentElement;
  if (bar) bar.style.width = `${progress}%`;
  progressbar?.setAttribute("aria-valuenow", String(progress));

  if (status) {
    const statusElement = document.getElementById("startup-splash-status");
    if (statusElement) statusElement.textContent = status;
  }
}

function clearStartupTimers() {
  if (idleTimer) clearTimeout(idleTimer);
  if (timeoutTimer) clearTimeout(timeoutTimer);
  idleTimer = undefined;
  timeoutTimer = undefined;
}

function finishWhenIdle() {
  if (!trackingStartup || startupComplete || pendingTasks !== 0) return;

  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!trackingStartup || pendingTasks !== 0) return;

    startupComplete = true;
    clearStartupTimers();
    progress = 100;
    renderProgress(readyStatus);
    const splash = document.getElementById("startup-splash");
    splash?.classList.add("is-hiding");
    setTimeout(() => splash?.remove(), 450);
  }, 650);
}

function setFailureStatus(message: string) {
  const statusElement = document.getElementById(
    "startup-splash-error-status",
  );
  if (statusElement) statusElement.textContent = message;
}

function bindFailureActions() {
  if (failureActionsBound) return;
  failureActionsBound = true;

  const exportButton = document.getElementById("startup-splash-export");
  const openLogsButton = document.getElementById("startup-splash-open-logs");

  if (exportButton) exportButton.textContent = i18n.t("crash.action_export");
  if (openLogsButton)
    openLogsButton.textContent = i18n.t("crash.action_open_logs");

  exportButton?.addEventListener("click", async () => {
    setFailureStatus(i18n.t("crash.action_exporting"));
    try {
      const detail =
        document.getElementById("startup-splash-error-detail")?.textContent ??
        "Startup failure";
      const { exportDiagnostics, revealDiagnostics } = await import(
        "./diagnostics"
      );
      const path = await exportDiagnostics(`Startup failure: ${detail}`);
      await revealDiagnostics(path);
      setFailureStatus(`${i18n.t("crash.action_exported")}: ${path}`);
    } catch (error) {
      setFailureStatus(
        i18n.t("crash.export_failed", { error: String(error) }),
      );
    }
  });

  openLogsButton?.addEventListener("click", async () => {
    try {
      const { openLogDirectory } = await import("./diagnostics");
      await openLogDirectory();
    } catch (error) {
      setFailureStatus(i18n.t("crash.log_dir_failed", { error: String(error) }));
    }
  });
}

function showStartupFailure(detail?: string) {
  bindFailureActions();
  const panel = document.getElementById("startup-splash-error");
  if (panel) panel.hidden = false;
  if (detail) {
    const detailElement = document.getElementById(
      "startup-splash-error-detail",
    );
    if (detailElement) detailElement.textContent = detail;
  }
  setFailureStatus("");
}

/** 启动/重置 45 秒启动看门狗；也用于在配置初始化前覆盖「invoke 永不返回」的卡死场景。 */
export function armStartupTimeout() {
  if (timeoutTimer) clearTimeout(timeoutTimer);
  timeoutTimer = setTimeout(() => {
    if (startupComplete) return;

    trackingStartup = false;
    startupComplete = true;
    clearStartupTimers();
    renderProgress(i18n.t("crash.startup_timeout"));
    showStartupFailure(
      pendingTasks > 0
        ? i18n.t("crash.startup_timeout_detail", { count: pendingTasks })
        : i18n.t("crash.startup_timeout_hint"),
    );
  }, STARTUP_TIMEOUT_MS);
}

export function setStartupPhase(value: number, status: string) {
  if (startupComplete) return;
  progress = Math.max(progress, Math.min(94, value));
  renderProgress(status);
}

export function beginStartupTracking(status: string, ready: string) {
  trackingStartup = true;
  startupComplete = false;
  readyStatus = ready;
  setStartupPhase(34, status);
  armStartupTimeout();
  requestAnimationFrame(() => requestAnimationFrame(finishWhenIdle));
}

export function trackStartupTask<T>(task: Promise<T>): Promise<T> {
  if (!trackingStartup || startupComplete) return task;

  pendingTasks += 1;
  progress = Math.min(92, Math.max(progress, 40) + 5);
  renderProgress();
  if (idleTimer) clearTimeout(idleTimer);

  return task.finally(() => {
    pendingTasks = Math.max(0, pendingTasks - 1);
    progress = Math.min(96, progress + 3);
    renderProgress();
    finishWhenIdle();
  });
}

/** 启动失败：停止跟踪并在 Splash 上展示错误详情与导出/打开日志入口。 */
export function failStartup(status: string, detail?: string) {
  trackingStartup = false;
  startupComplete = true;
  clearStartupTimers();
  renderProgress(status);
  showStartupFailure(detail ?? status);
}

/** 启动被外部原因中止（如 API 熔断）：收起 Splash，交给 React 崩溃弹窗提示。 */
export function abortStartup(status: string) {
  trackingStartup = false;
  startupComplete = true;
  clearStartupTimers();
  renderProgress(status);
  const splash = document.getElementById("startup-splash");
  splash?.classList.add("is-hiding");
  setTimeout(() => splash?.remove(), 450);
}
