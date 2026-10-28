/**
 * in-app browser 原生 Webview 的后端导航服务。
 *
 * JS 侧 `@tauri-apps/api/webview` 的 `Webview` 类只有生命周期与布局方法，
 * 没有 back/forward/reload/navigate/url（@tauri-apps/api 2.12.1），这些能力
 * 由 `src-tauri/src/commands/browser.rs` 以 app command 暴露，在这里统一包装：
 * 带类型、失败显式返回（不抛到 UI 层）。
 */

import { invoke } from "@tauri-apps/api/core";
import logger from "@/utils/logger";

/** 后退 / 前进 / 刷新失败时的显式结果 */
export interface BrowserActionResult {
  ok: boolean;
  error?: string;
}

function toError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function run(
  command: string,
  args: Record<string, unknown>,
): Promise<BrowserActionResult> {
  try {
    await invoke(command, args);
    return { ok: true };
  } catch (error) {
    const message = toError(error);
    logger.warn(`[browser] ${command} failed: ${message}`);
    return { ok: false, error: message };
  }
}

/** history.back()（webview 内同源历史，不受宿主跨域限制） */
export function browserGoBack(label: string): Promise<BrowserActionResult> {
  return run("browser_go_back", { webviewLabel: label });
}

/** history.forward() */
export function browserGoForward(label: string): Promise<BrowserActionResult> {
  return run("browser_go_forward", { webviewLabel: label });
}

/** 重新加载当前页面 */
export function browserReload(label: string): Promise<BrowserActionResult> {
  return run("browser_reload", { webviewLabel: label });
}

/** 就地导航（保留实例与浏览历史）；失败时调用方应销毁重建 */
export function browserNavigate(
  label: string,
  url: string,
): Promise<BrowserActionResult> {
  return run("browser_navigate", { webviewLabel: label, url });
}

/** 当前实际地址（用于地址栏与页面内跳转同步）；失败返回 null */
export async function browserCurrentUrl(label: string): Promise<string | null> {
  try {
    return await invoke<string>("browser_current_url", {
      webviewLabel: label,
    });
  } catch (error) {
    logger.warn(`[browser] browser_current_url failed: ${toError(error)}`);
    return null;
  }
}

/** `browser://page-load` 事件负载（后端 lib.rs on_page_load 桥接发出） */
export interface BrowserPageLoadPayload {
  label: string;
  url: string;
  event: "started" | "finished";
}
