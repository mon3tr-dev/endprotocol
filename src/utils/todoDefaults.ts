import { getConfig, setConfig } from "@/utils/configService";
import { logError, logWarn } from "@/utils/logger";
import type { TodoDefaults } from "@/types/todo";
import { DEFAULT_TODO_DEFAULTS, normalizeTodoIcon } from "@/types/todo";

const CONFIG_KEY = "todo_defaults";

/** 读取全局「To-Do 默认值」。 */
export async function getTodoDefaults(): Promise<TodoDefaults> {
  try {
    const stored = await getConfig<Partial<TodoDefaults>>(CONFIG_KEY);
    const defaults = { ...DEFAULT_TODO_DEFAULTS, ...(stored ?? {}) };
    const normalized = { ...defaults, icon: normalizeTodoIcon(defaults.icon) };
    if (stored?.icon && stored.icon !== normalized.icon) {
      try {
        await setConfig(CONFIG_KEY, normalized);
      } catch (error) {
        logWarn("Failed to migrate todo default icon: " + error, "TodoDefaults");
      }
    }
    return normalized;
  } catch (error) {
    logWarn("Failed to load todo defaults: " + error, "TodoDefaults");
    return DEFAULT_TODO_DEFAULTS;
  }
}

/** 保存全局「To-Do 默认值」（合并更新）。 */
export async function setTodoDefaults(patch: Partial<TodoDefaults>): Promise<void> {
  try {
    const current = await getTodoDefaults();
    const next = { ...current, ...patch };
    await setConfig(CONFIG_KEY, {
      ...next,
      icon: normalizeTodoIcon(next.icon),
    });
  } catch (error) {
    logError("Failed to save todo defaults:", error);
  }
}
