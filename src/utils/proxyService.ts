import { invoke } from "@tauri-apps/api/core";
import logger from "@/utils/logger";

/** 代理协议类型 */
export type ProxyType = "http" | "socks5";

/** 代理配置：`enabled` 关闭时其余字段仅作草稿保留。 */
export interface ProxyConfig {
  enabled: boolean;
  type: ProxyType;
  host: string;
  port: number;
  /** HTTP 与 SOCKS5 都可选（SOCKS5 认证用）。 */
  username?: string;
  /** SOCKS5 认证密码；HTTP 代理的密码同样可选。 */
  password?: string;
  /** 仅 SOCKS5：把域名交给代理解析（`socks5h://`），避免 DNS 污染。 */
  remoteDns?: boolean;
  /** 代理排除列表：逗号分隔的主机名，匹配这些主机的请求直连不走代理。 */
  exclude?: string;
}

/** 系统代理读取结果 */
export interface SystemProxyInfo {
  enabled: boolean;
  proxy_type: ProxyType;
  host: string;
  port: number;
  username: string;
  password: string;
  /** Windows PAC / 自动配置地址，可能为空。 */
  pac_url: string;
  /** 是否来自环境变量而非系统设置。 */
  from_env: boolean;
}

/** 代理连通性测试结果 */
export interface ProxyTestResult {
  status: number;
  duration_ms: number;
}

export const DEFAULT_PROXY_CONFIG: ProxyConfig = {
  enabled: false,
  type: "http",
  host: "",
  port: 8080,
};

export const DEFAULT_PROXY_PORT: Record<ProxyType, number> = {
  http: 8080,
  socks5: 1080,
};

/** 代理配置的显式失败返回：`ok` 为 false 时 `error` 一定有值。 */
export type ProxyResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function fail<T>(error: unknown): ProxyResult<T> {
  const message = error instanceof Error ? error.message : String(error);
  logger.warn(`[proxyService] ${message}`, "ProxyService");
  return { ok: false, error: message };
}

/** 把任意输入收敛成合法的 [`ProxyConfig`]。 */
export function normalizeProxyConfig(input: unknown): ProxyConfig {
  const raw = (input ?? {}) as Partial<ProxyConfig> & Record<string, unknown>;
  const type: ProxyType = raw.type === "socks5" ? "socks5" : "http";
  const port = Number(raw.port);

  return {
    enabled: Boolean(raw.enabled),
    type,
    host: typeof raw.host === "string" ? raw.host.trim() : "",
    port: Number.isFinite(port) && port > 0 && port <= 65535 ? Math.trunc(port) : DEFAULT_PROXY_PORT[type],
    username: typeof raw.username === "string" ? raw.username : "",
    password: typeof raw.password === "string" ? raw.password : "",
    // HTTP 代理没有这个概念，统一收敛成 false，避免切回 SOCKS5 时意外继承。
    remoteDns: type === "socks5" && Boolean(raw.remoteDns),
    /** 排除列表：逗号分隔，空值兜底为空字符串。 */
    exclude: typeof raw.exclude === "string" ? raw.exclude.trim() : "",
  };
}

/** 读取已保存的代理配置。 */
export async function getProxySettings(): Promise<ProxyResult<ProxyConfig>> {
  try {
    const value = await invoke<unknown>("get_proxy_settings");
    return { ok: true, value: normalizeProxyConfig(value) };
  } catch (error) {
    return fail(error);
  }
}

/** 保存代理配置（后端会立即刷新全局代理）。 */
export async function saveProxySettings(
  config: ProxyConfig,
): Promise<ProxyResult<ProxyConfig>> {
  try {
    const value = await invoke<unknown>("save_proxy_settings", {
      config,
    });
    return { ok: true, value: normalizeProxyConfig(value) };
  } catch (error) {
    return fail(error);
  }
}

/** 清除代理配置，恢复「不使用代理」。 */
export async function clearProxySettings(): Promise<ProxyResult<boolean>> {
  try {
    const removed = await invoke<boolean>("clear_proxy_settings");
    return { ok: true, value: removed };
  } catch (error) {
    return fail(error);
  }
}

/** 读取系统代理（Windows 注册表优先，其次环境变量）。 */
export async function readSystemProxy(): Promise<ProxyResult<SystemProxyInfo>> {
  try {
    const info = await invoke<SystemProxyInfo>("read_system_proxy");
    return {
      ok: true,
      value: {
        ...info,
        proxy_type: info.proxy_type === "socks5" ? "socks5" : "http",
        username: info.username ?? "",
        password: info.password ?? "",
        pac_url: info.pac_url ?? "",
      },
    };
  } catch (error) {
    return fail(error);
  }
}

/** 测试代理连通性；不传 `config` 时后端使用已保存的配置。 */
export async function testProxyConnection(
  config?: ProxyConfig,
  url?: string,
): Promise<ProxyResult<ProxyTestResult>> {
  try {
    const value = await invoke<ProxyTestResult>("test_proxy_connection", {
      config: config ?? null,
      url: url ?? null,
    });
    return { ok: true, value };
  } catch (error) {
    return fail(error);
  }
}

/** 自动嗅探本地常用代理端口，返回可用的配置（包括协议与端口）。 */
export async function autoDetectProxy(): Promise<ProxyResult<ProxyConfig>> {
  try {
    const value = await invoke<ProxyConfig>("auto_detect_proxy");
    return { ok: true, value: normalizeProxyConfig(value) };
  } catch (error) {
    return fail(error);
  }
}
