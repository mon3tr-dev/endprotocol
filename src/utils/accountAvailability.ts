import { logDebug, logError } from "./logger";

/**
 * 账户数据不可用的原因：
 * - `auth`：登录凭证失效（hytoken 过期等），需要重新登录该森空岛账户
 * - `fingerprint`：数美设备指纹接口连续失败，需要重启电脑并同步时区
 * - `network`：网络 / 服务端持续异常
 * - `unknown`：其它反复失败的账户数据请求
 */
export type AccountUnavailableReason = "auth" | "network" | "fingerprint" | "unknown";

export interface AccountAvailability {
  reason: AccountUnavailableReason;
  /** 最近一次失败详情（展示在账户页的提示里） */
  message: string;
  /** 记录时间（ISO 字符串） */
  since: string;
}

const STORAGE_KEY = "account_unavailable_state";

let state: AccountAvailability | null = null;
let loaded = false;
let loadPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function persist() {
  try {
    if (state) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch (error) {
    // sessionStorage 不可用时仅保留内存态
    logDebug("[AccountAvailability] Failed to persist state: " + error);
  }
}

function normalizeReason(value: unknown): AccountUnavailableReason {
  switch (value) {
    case "auth":
    case "network":
    case "fingerprint":
      return value;
    default:
      return "unknown";
  }
}

function restore() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<AccountAvailability>;
    if (!parsed || typeof parsed !== "object") return;
    state = {
      reason: normalizeReason(parsed.reason),
      message: typeof parsed.message === "string" ? parsed.message : "",
      since:
        typeof parsed.since === "string" && parsed.since
          ? parsed.since
          : new Date().toISOString(),
    };
  } catch (error) {
    logError("[AccountAvailability] Failed to restore state:", error);
    state = null;
  }
}

/** 同步读取当前状态（首次调用会从 sessionStorage 恢复） */
export function getAccountAvailability(): AccountAvailability | null {
  restore();
  return state;
}

/** 读取已持久化的状态（供启动流程在渲染前 await） */
export function loadAccountAvailability(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (!loadPromise) {
    loadPromise = Promise.resolve().then(() => {
      restore();
      notify();
    });
  }
  return loadPromise;
}

/** 标记账户数据不可用；相同原因+详情不重复通知 */
export function setAccountUnavailable(
  reason: AccountUnavailableReason,
  message?: string,
): void {
  restore();
  const next: AccountAvailability = {
    reason,
    message: message ?? "",
    since: state?.since ?? new Date().toISOString(),
  };
  if (state && state.reason === next.reason && state.message === next.message) {
    return;
  }
  state = next;
  persist();
  logDebug(
    `[AccountAvailability] marked unavailable: reason=${reason}${
      message ? `, message=${message}` : ""
    }`,
  );
  notify();
}

/** 账户数据恢复可用（重新登录成功 / 刷新成功 / 用户修复后重试） */
export function clearAccountUnavailable(): void {
  restore();
  if (!state) return;
  state = null;
  persist();
  logDebug("[AccountAvailability] cleared");
  notify();
}

/** 订阅状态变化，返回取消订阅函数 */
export function subscribeAccountAvailability(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 把后端 API 熔断快照的 `kind` 映射为账户不可用原因。
 * 数美设备指纹失败优先，其次网络/服务端，最后兜底 unknown。
 */
export function reasonFromApiKind(kind: string | null | undefined): AccountUnavailableReason {
  switch (kind) {
    case "clock_skew":
    case "signature":
    case "device_fingerprint":
      return "fingerprint";
    case "auth":
      return "auth";
    case "network":
    case "server":
    case "parse":
      return "network";
    default:
      return "unknown";
  }
}
