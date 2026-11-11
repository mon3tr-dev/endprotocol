import { getConfig, setConfig } from "@/utils/configService";
import { logInfo, logError } from "@/utils/logger";

type StartupHandler = (roleId: string) => Promise<void>;
type StatusListener = (status: { status: "pending" | "running" | "done" | "error"; error?: string }) => void;
type AutoSignListener = (roleId: string, enabled: boolean) => void;

const AUTO_SIGN_KEY = "card_auto_sign_users";
const MAPPING_KEY = "card_user_mapping";

const handlers = new Map<string, StartupHandler>();
const taskStatuses = new Map<string, { status: "pending" | "running" | "done" | "error"; error?: string }>();
const statusListeners = new Map<string, Set<StatusListener>>();
const autoSignListeners = new Set<AutoSignListener>();

function notifyStatusChange(roleId: string) {
  const status = taskStatuses.get(roleId);
  if (!status) return;
  const listeners = statusListeners.get(roleId);
  if (listeners) {
    listeners.forEach((fn) => fn(status));
  }
}

export const CardStartupService = {
  register(cardType: string, handler: StartupHandler) {
    handlers.set(cardType, handler);
    logInfo(`[Startup] Registered handler for card type: ${cardType}`, undefined, "StartupService");
  },

  /**
   * 是否已注册某类启动任务
   *
   * `runAll` 依赖它判断能否执行 —— 卡片注册表未加载时（无卡片场景）会走到内置兜底。
   */
  hasHandler(cardType: string): boolean {
    return handlers.has(cardType);
  },

  async getAutoSignUsers(): Promise<string[]> {
    try {
      const list = await getConfig<string[]>(AUTO_SIGN_KEY);
      return list ?? [];
    } catch {
      return [];
    }
  },

  async isAutoSignEnabled(roleId: string): Promise<boolean> {
    const list = await this.getAutoSignUsers();
    return list.includes(roleId);
  },

  async addAutoSignUser(roleId: string) {
    const list = await this.getAutoSignUsers();
    if (list.includes(roleId)) return;
    list.push(roleId);
    await setConfig(AUTO_SIGN_KEY, list);
    autoSignListeners.forEach((fn) => fn(roleId, true));
    logInfo(`[Startup] Added auto-sign user: ${roleId}`, undefined, "StartupService");
  },

  async removeAutoSignUser(roleId: string) {
    const list = await this.getAutoSignUsers();
    const filtered = list.filter((id) => id !== roleId);
    if (filtered.length === list.length) return;
    await setConfig(AUTO_SIGN_KEY, filtered);
    autoSignListeners.forEach((fn) => fn(roleId, false));
    logInfo(`[Startup] Removed auto-sign user: ${roleId}`, undefined, "StartupService");
  },

  /**
   * 直接设置某角色是否自动签到
   *
   * 与 `addAutoSignUser` / `removeAutoSignUser` 的区别：**幂等且会无条件广播**。
   * 批量签到弹窗需要「改完就同步」—— 即便目标值与原值相同，也要让所有正在监听的
   * 签到卡片刷新 UI，否则卡片上的开关会和页面不一致。
   */
  async setAutoSign(roleId: string, enabled: boolean): Promise<void> {
    const list = await this.getAutoSignUsers();
    const has = list.includes(roleId);
    if (enabled && !has) {
      list.push(roleId);
      await setConfig(AUTO_SIGN_KEY, list);
    } else if (!enabled && has) {
      await setConfig(AUTO_SIGN_KEY, list.filter((id) => id !== roleId));
    }
    // 无论是否发生写入都广播：这是「单一真值」同步的关键
    autoSignListeners.forEach((fn) => fn(roleId, enabled));
    logInfo(
      `[Startup] setAutoSign(${roleId}) = ${enabled}`,
      undefined,
      "StartupService",
    );
  },

  onAutoSignChanged(listener: AutoSignListener): () => void {
    autoSignListeners.add(listener);
    return () => { autoSignListeners.delete(listener); };
  },

  async updateUserMapping(cardId: string, newRoleId: string | undefined) {
    const mapping = await getConfig<Record<string, string[]>>(MAPPING_KEY) ?? {};
    for (const roleId of Object.keys(mapping)) {
      mapping[roleId] = mapping[roleId].filter((id) => id !== cardId);
      if (mapping[roleId].length === 0) delete mapping[roleId];
    }
    if (newRoleId) {
      if (!mapping[newRoleId]) mapping[newRoleId] = [];
      if (!mapping[newRoleId].includes(cardId)) {
        mapping[newRoleId].push(cardId);
      }
    }
    await setConfig(MAPPING_KEY, mapping);
  },

  async removeCardFromMapping(cardId: string) {
    const mapping = await getConfig<Record<string, string[]>>(MAPPING_KEY) ?? {};
    for (const roleId of Object.keys(mapping)) {
      mapping[roleId] = mapping[roleId].filter((id) => id !== cardId);
      if (mapping[roleId].length === 0) delete mapping[roleId];
    }
    await setConfig(MAPPING_KEY, mapping);
  },

  async getCardIdsByUser(roleId: string): Promise<string[]> {
    const mapping = await getConfig<Record<string, string[]>>(MAPPING_KEY) ?? {};
    return mapping[roleId] ?? [];
  },

  /**
   * 启动时对 `card_auto_sign_users` 里的所有角色执行签到
   *
   * ⚠️ **不依赖任何卡片实例存在**：`card_auto_sign_users` 按 roleId 记录，
   * handler 由卡片注册表在应用启动时全局注册一次（`registry/loader.ts`）。
   * 所以只要 roleId 在列表里，即使该账号没有添加签到卡片，也会自动签到 ——
   * 这正是「批量签到弹窗可给无卡片账号开自动签到」能生效的原因。
   *
   * 若注册表尚未加载（handler 缺失），退回内置实现，避免无卡片场景下静默跳过。
   */
  async runAll() {
    logInfo("[Startup] Running all startup tasks...", undefined, "StartupService");
    const roleIds = await this.getAutoSignUsers();
    if (roleIds.length === 0) {
      logInfo("[Startup] No auto-sign users found", undefined, "StartupService");
      return;
    }

    // 内置兜底：注册表没加载时也要能签（dynamic import 避免循环依赖）
    let handler = handlers.get("attendance");
    if (!handler) {
      try {
        const [{ getAccounts }, { resolveAttendanceGame, performAttendanceSignIn }] =
          await Promise.all([
            import("@/utils/accountService"),
            import("@/utils/attendanceService"),
          ]);
        const accounts = await getAccounts();
        handler = async (roleId: string) => {
          const game = resolveAttendanceGame(accounts, roleId);
          await performAttendanceSignIn(roleId, game);
        };
        logInfo(
          "[Startup] No registered attendance handler; using built-in fallback",
          undefined,
          "StartupService",
        );
      } catch (e) {
        logError("[Startup] Failed to build fallback attendance handler", e, "StartupService");
      }
    }

    if (!handler) {
      logError("[Startup] No handler available for attendance", undefined, "StartupService");
      for (const roleId of roleIds) {
        taskStatuses.set(roleId, { status: "error", error: "No handler for attendance" });
        notifyStatusChange(roleId);
      }
      return;
    }

    const taskHandler: StartupHandler = handler;
    await Promise.all(
      roleIds.map(async (roleId) => {
        taskStatuses.set(roleId, { status: "running" });
        notifyStatusChange(roleId);
        try {
          await taskHandler(roleId);
          taskStatuses.set(roleId, { status: "done" });
          logInfo(`[Startup] Attendance done for user: ${roleId}`, undefined, "StartupService");
        } catch (e: any) {
          taskStatuses.set(roleId, { status: "error", error: String(e) });
          logError(`[Startup] Attendance failed for user: ${roleId}`, e, "StartupService");
        }
        notifyStatusChange(roleId);
      }),
    );
    logInfo("[Startup] All startup tasks finished", undefined, "StartupService");
  },

  getTaskStatus(roleId: string): { status: "pending" | "running" | "done" | "error"; error?: string } | undefined {
    return taskStatuses.get(roleId);
  },

  subscribe(roleId: string, listener: StatusListener): () => void {
    if (!statusListeners.has(roleId)) {
      statusListeners.set(roleId, new Set());
    }
    statusListeners.get(roleId)!.add(listener);
    return () => {
      statusListeners.get(roleId)?.delete(listener);
    };
  },
};
