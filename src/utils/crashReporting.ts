import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import i18n from "@/i18n";
import logger from "./logger";
import { getPendingCrashReports } from "./diagnostics";

export type CrashSource =
  | "window"
  | "unhandled-rejection"
  | "react"
  | "api"
  | "backend-panic"
  | "startup";

export type ApiFailureKind =
  | "clock_skew"
  | "signature"
  | "auth"
  | "network"
  | "server"
  | "parse"
  | "device_fingerprint"
  | "unknown";

export interface ApiHealthSnapshot {
  blocked: boolean;
  consecutive_failures: number;
  kind: ApiFailureKind | null;
  message: string | null;
  clock_skew_seconds: number | null;
  last_failure_at: string | null;
}

export interface BackendCrashEvent {
  message: string;
  location?: string | null;
  thread: string;
  backtrace: string;
  report_path?: string | null;
  timestamp: string;
}

export interface CrashReport {
  id: number;
  title: string;
  message: string;
  detail?: string;
  stack?: string;
  source: CrashSource;
  timestamp: string;
  fatal: boolean;
  api?: ApiHealthSnapshot;
  crashPaths?: string[];
}

interface CrashInput {
  title: string;
  message: string;
  detail?: string;
  stack?: string;
  source: CrashSource;
  fatal?: boolean;
  api?: ApiHealthSnapshot;
  crashPaths?: string[];
}

export interface CrashDiagnosis {
  causeKey: string;
  suggestionKeys: string[];
}

let currentReport: CrashReport | null = null;
let reportCounter = 0;
let lastSignature = "";
let lastSignatureAt = 0;
let handlersInstalled = false;
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

export function subscribeCrashReports(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCurrentCrashReport(): CrashReport | null {
  return currentReport;
}

export function showCrashReport(input: CrashInput): CrashReport {
  const report: CrashReport = {
    id: ++reportCounter,
    title: input.title,
    message: input.message,
    detail: input.detail,
    stack: input.stack,
    source: input.source,
    timestamp: new Date().toISOString(),
    fatal: input.fatal ?? false,
    api: input.api,
    crashPaths: input.crashPaths,
  };
  currentReport = report;
  notifyListeners();
  return report;
}

export function dismissCrashReport() {
  currentReport = null;
  notifyListeners();
}

/** 记录并展示一个错误。相同错误 2 秒内只弹一次，避免级联报错刷屏。 */
export function reportCrash(input: CrashInput) {
  logger.error(
    `[Crash][${input.source}] ${input.title}: ${input.message}`,
    { detail: input.detail, stack: input.stack },
    "Crash",
  );

  const signature = `${input.source}|${input.message}`;
  const now = Date.now();
  if (signature === lastSignature && now - lastSignatureAt < 2000) {
    if (!currentReport) showCrashReport(input);
    return;
  }
  lastSignature = signature;
  lastSignatureAt = now;
  showCrashReport(input);
}

function handleApiBlocked(snapshot: ApiHealthSnapshot) {
  // 停止启动进度等待并收起 Splash，让应用可以「不获取任何账户数据也进入」。
  void import("./startupProgress").then(({ abortStartup }) => {
    abortStartup(i18n.t("crash.api_title"));
  });

  // 账户数据获取频繁失败：标记账户不可用，账户页展示「账号不可用 / 重新登录」。
  void import("./accountAvailability").then(({ reasonFromApiKind, setAccountUnavailable }) => {
    setAccountUnavailable(reasonFromApiKind(snapshot.kind), snapshot.message ?? "");
  });

  if (currentReport?.source === "api") return;

  const isFingerprint = snapshot.kind === "device_fingerprint";
  const body = isFingerprint
    ? i18n.t("crash.api_fingerprint_body", {
        count: snapshot.consecutive_failures,
      })
    : i18n.t("crash.api_body", { count: snapshot.consecutive_failures });
  // 非致命：用户可以直接关闭弹窗继续使用应用（只是没有账户数据）。
  showCrashReport({
    title: i18n.t("crash.api_title"),
    message: snapshot.message || body,
    detail: body,
    source: "api",
    fatal: false,
    api: snapshot,
  });
}

async function checkApiHealth() {
  try {
    const snapshot = await invoke<ApiHealthSnapshot>("get_api_health");
    if (snapshot.blocked) handleApiBlocked(snapshot);
  } catch (error) {
    logger.warn("Failed to query API health: " + error, "Crash");
  }
}

/** 安装全局 JS 错误、后端崩溃与 API 熔断事件监听。 */
export function installCrashHandlers() {
  if (handlersInstalled || typeof window === "undefined") return;
  handlersInstalled = true;

  window.addEventListener("error", (event) => {
    const error = event.error instanceof Error ? event.error : null;
    reportCrash({
      title: i18n.t("crash.title"),
      message: error?.message || event.message || "Unknown error",
      stack: error?.stack,
      detail: event.filename
        ? `${event.filename}:${event.lineno}:${event.colno}`
        : undefined,
      source: "window",
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const error = reason instanceof Error ? reason : null;
    reportCrash({
      title: i18n.t("crash.title"),
      message: error?.message || String(reason ?? "Unhandled promise rejection"),
      stack: error?.stack,
      source: "unhandled-rejection",
    });
  });

  void listen<ApiHealthSnapshot>("app:api-health", (event) => {
    if (event.payload?.blocked) handleApiBlocked(event.payload);
  }).catch((error) => {
    logger.warn("Failed to listen for API health events: " + error, "Crash");
  });

  void listen<BackendCrashEvent>("app:crash", (event) => {
    const payload = event.payload;
    reportCrash({
      title: i18n.t("crash.backend_crash"),
      message: payload.message,
      detail: payload.location ?? undefined,
      stack: payload.backtrace,
      source: "backend-panic",
      fatal: true,
      crashPaths: payload.report_path ? [payload.report_path] : undefined,
    });
  }).catch((error) => {
    logger.warn("Failed to listen for backend crash events: " + error, "Crash");
  });

  // 事件监听可能晚于后端失败，启动阶段额外轮询两次作为兜底。
  window.setTimeout(() => {
    void checkApiHealth();
  }, 1500);
  window.setTimeout(() => {
    void checkApiHealth();
  }, 6000);
}

/** 载入上次运行留下的未读崩溃报告。 */
export async function loadPendingCrashReports() {
  if (currentReport) return;
  try {
    const reports = await getPendingCrashReports();
    if (!reports.length || currentReport) return;
    const latest = reports[0];
    showCrashReport({
      title: i18n.t("crash.pending_crash"),
      message: latest.message,
      detail: i18n.t("crash.pending_crash_hint"),
      stack: latest.content,
      source: "backend-panic",
      fatal: false,
      crashPaths: reports.map((report) => report.path),
    });
  } catch (error) {
    logger.warn("Failed to load pending crash reports: " + error, "Crash");
  }
}

export function diagnoseCrash(report: CrashReport): CrashDiagnosis {
  const api = report.api;
  if (api) {
    if (api.kind === "device_fingerprint") {
      return {
        causeKey: "crash.cause_fingerprint",
        suggestionKeys: ["crash.suggestion_fingerprint"],
      };
    }
    if (
      api.kind === "clock_skew" ||
      (api.clock_skew_seconds != null &&
        Math.abs(api.clock_skew_seconds) >= 180)
    ) {
      return {
        causeKey: "crash.cause_clock",
        suggestionKeys: ["crash.suggestion_clock"],
      };
    }
    if (api.kind === "signature") {
      return {
        causeKey: "crash.cause_clock",
        suggestionKeys: ["crash.suggestion_clock", "crash.suggestion_network"],
      };
    }
    if (api.kind === "auth") {
      return {
        causeKey: "crash.cause_auth",
        suggestionKeys: ["crash.suggestion_auth"],
      };
    }
    if (api.kind === "network") {
      return {
        causeKey: "crash.cause_network",
        suggestionKeys: ["crash.suggestion_network"],
      };
    }
    if (api.kind === "parse") {
      return {
        causeKey: "crash.cause_data",
        suggestionKeys: ["crash.suggestion_data"],
      };
    }
    if (api.kind === "server" || api.kind === "unknown") {
      return {
        causeKey: "crash.cause_api",
        suggestionKeys: ["crash.suggestion_api"],
      };
    }
  }

  const text = `${report.message} ${report.detail ?? ""} ${report.stack ?? ""}`.toLowerCase();
  if (
    /signature|sign |timestamp|clock|time skew|时间|签名|请求过期|expired/.test(
      text,
    )
  ) {
    return {
      causeKey: "crash.cause_clock",
      suggestionKeys: ["crash.suggestion_clock"],
    };
  }
  if (
    /http request failed|timed out|timeout|connect|dns|network|econn|fetch failed|网络|连接/.test(
      text,
    )
  ) {
    return {
      causeKey: "crash.cause_network",
      suggestionKeys: ["crash.suggestion_network"],
    };
  }
  if (
    /cred|token|401|403|auth|unauthorized|登录|认证|凭证/.test(text)
  ) {
    return {
      causeKey: "crash.cause_auth",
      suggestionKeys: ["crash.suggestion_auth"],
    };
  }
  if (
    /access is denied|os error 5|permission|no space|拒绝访问|权限|磁盘/.test(
      text,
    )
  ) {
    return {
      causeKey: "crash.cause_permission",
      suggestionKeys: ["crash.suggestion_permission"],
    };
  }
  if (
    /failed to parse|parse json|serde|invalid data|corrupt|配置损坏|解析/.test(
      text,
    )
  ) {
    return {
      causeKey: "crash.cause_data",
      suggestionKeys: ["crash.suggestion_data"],
    };
  }
  if (/api error|code=|server|500|502|503|服务端/.test(text)) {
    return {
      causeKey: "crash.cause_api",
      suggestionKeys: ["crash.suggestion_api"],
    };
  }
  return {
    causeKey: "crash.cause_unknown",
    suggestionKeys: ["crash.suggestion_unknown"],
  };
}

export function formatCrashReport(report: CrashReport): string {
  const lines = [
    "EndProtocol crash report",
    `Time: ${report.timestamp}`,
    `Source: ${report.source}`,
    `Title: ${report.title}`,
    `Message: ${report.message}`,
  ];
  if (report.detail) lines.push(`Detail: ${report.detail}`);
  if (report.stack) lines.push("", "Stack / raw details:", report.stack);
  if (report.api) {
    lines.push("", "API health:", JSON.stringify(report.api, null, 2));
  }
  if (report.crashPaths?.length) {
    lines.push("", `Crash files: ${report.crashPaths.join(", ")}`);
  }
  return lines.join("\n");
}
