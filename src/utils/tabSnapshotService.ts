import { invoke } from "@tauri-apps/api/core";
import { getConfig, setConfig } from "@/utils/configService";
import { isWindowsPlatform } from "@/utils/platform";
import { logDebug, logError } from "@/utils/logger";

/** 配置键：{ [tabId]: 快照 PNG 绝对路径 } */
const SNAPSHOT_CONFIG_KEY = "dashboard_tab_snapshots";

/** 截取的左上角区域尺寸（CSS 像素，实际按 devicePixelRatio 换算为物理像素） */
const SNAPSHOT_CSS_WIDTH = 640;
const SNAPSHOT_CSS_HEIGHT = 420;

/** 同一标签页的截图进行中去重，避免重复触发（如点击后连续事件） */
const inflight = new Map<string, Promise<void>>();

/**
 * 「离开仪表盘」处理器：由 DashboardPage 挂载时注册。
 * 侧栏任何导航点击前都 await 它，趁窗口画面仍是仪表盘时先截图，再跳转。
 */
let leaveHandler: (() => Promise<void>) | null = null;

export function registerDashboardLeaveHandler(
  fn: (() => Promise<void>) | null,
): void {
  leaveHandler = fn;
}

export async function runDashboardLeaveHandler(): Promise<void> {
  await leaveHandler?.();
}

let snapshotMap: Record<string, string> | null = null;

async function loadSnapshotMap(): Promise<Record<string, string>> {
  if (snapshotMap) return snapshotMap;
  const value = await getConfig<Record<string, string>>(SNAPSHOT_CONFIG_KEY);
  snapshotMap = value && typeof value === "object" ? value : {};
  return snapshotMap;
}

/**
 * 抓取主窗口左上角内容区快照。
 * 必须在 DOM 还是该标签页内容、且尚未切换视图时 await 调用，
 * PrintWindow 截到的才是“离开时的画面”。
 */
export function captureTabSnapshot(tabId: string | null | undefined): Promise<void> {
  if (!tabId || !isWindowsPlatform()) return Promise.resolve();
  const running = inflight.get(tabId);
  if (running) return running;

  const task = (async () => {
    try {
      const main = document.getElementById("dashboard-main");
      const container = main ?? document.body;

      // 截图前把内容区滚回顶部，保证截到的是左上角最完整的画面
      const scroller = container.closest("main") ?? container;
      let scrolled = false;
      if (scroller.scrollTop > 0) {
        scroller.scrollTop = 0;
        scrolled = true;
      }
      if (scrolled || window.scrollY > 0) {
        window.scrollTo(0, 0);
        // 等两帧让滚动与合成生效，再交给 PrintWindow
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }

      const rect = container.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;

      const dpr = window.devicePixelRatio || 1;
      const x = Math.max(0, Math.round(rect.left * dpr));
      const y = Math.max(0, Math.round(rect.top * dpr));
      const width = Math.round(Math.min(rect.width, SNAPSHOT_CSS_WIDTH) * dpr);
      const height = Math.round(Math.min(rect.height, SNAPSHOT_CSS_HEIGHT) * dpr);

      const path = await invoke<string>("save_tab_snapshot", {
        tabId,
        x,
        y,
        width,
        height,
      });

      const map = await loadSnapshotMap();
      map[tabId] = path;
      snapshotMap = map;
      await setConfig(SNAPSHOT_CONFIG_KEY, map);
      logDebug(`[tabSnapshot] captured ${tabId} -> ${path}`);
    } catch (error) {
      // 截图失败不影响任何业务流，只记日志（如窗口隐藏、最小化中）
      logError("[tabSnapshot] capture failed:", error);
    } finally {
      inflight.delete(tabId);
    }
  })();

  inflight.set(tabId, task);
  return task;
}

/** 读取全部标签页的快照路径映射（主界面渲染缩略图用）。 */
export async function getSnapshotPaths(): Promise<Record<string, string>> {
  return { ...(await loadSnapshotMap()) };
}

/** 删除标签页时清理其快照文件与映射。 */
export async function deleteTabSnapshotFile(tabId: string): Promise<void> {
  try {
    await invoke("delete_tab_snapshot", { tabId });
  } catch (error) {
    logError("[tabSnapshot] delete file failed:", error);
    return;
  }
  const map = await loadSnapshotMap();
  if (tabId in map) {
    delete map[tabId];
    snapshotMap = map;
    await setConfig(SNAPSHOT_CONFIG_KEY, map);
  }
}