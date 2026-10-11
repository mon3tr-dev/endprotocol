// To-Do 单一数据源：卡片 / 页面 / Modal 共用同一份内存状态，持久化到 app_config.json。
//
// 任何变更都会：1) 生成新的 lists 数组（触发 React 重渲染）；2) 通知订阅者；
// 3) 通过 window 事件 `todoChanged` 广播；4) 落盘到配置键 `todo_lists`。

import { useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { getConfig, setConfig } from "@/utils/configService";
import { logDebug, logError } from "@/utils/logger";
import type {
  TodoDefaults,
  TodoFilter,
  TodoItem,
  TodoList,
  TodoPriority,
  TodoSortMode,
  TodoSubtask,
} from "@/types/todo";
import { DEFAULT_TODO_DEFAULTS, normalizeTodoIcon } from "@/types/todo";

const CONFIG_KEY = "todo_lists";
const UNDO_TIMEOUT_MS = 8000;
const DAILY_RESET_CHECK_INTERVAL_MS = 15_000;
const DEFAULT_DAILY_RESET_TIME = "00:00";

let lists: TodoList[] = [];
let loaded = false;
let loadingPromise: Promise<TodoList[]> | null = null;
let dailyResetTimer: ReturnType<typeof setInterval> | null = null;
let dailyResetInProgress = false;
const listeners = new Set<() => void>();

interface UndoEntry {
  listId: string;
  items: TodoItem[];
}
let undoEntry: UndoEntry | null = null;
let undoTimer: ReturnType<typeof setTimeout> | null = null;

/* ------------------------------------------------------------------ */
/* 订阅与持久化                                                        */
/* ------------------------------------------------------------------ */

function notify() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      logError("todoStore listener failed:", error);
    }
  });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("todoChanged"));
  }
}

export function subscribeTodo(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function persist() {
  try {
    await setConfig(CONFIG_KEY, lists);
  } catch (error) {
    logError("Failed to persist todo lists:", error);
  }
}

function normalizeItem(raw: Partial<TodoItem> | undefined, index: number): TodoItem {
  const tags = Array.isArray(raw?.tags) ? (raw?.tags as string[]) : [];
  const subtasks = Array.isArray(raw?.subtasks) ? (raw?.subtasks as TodoSubtask[]) : [];
  return {
    id: raw?.id ?? uuidv4(),
    content: raw?.content ?? "",
    done: raw?.done ?? false,
    priority: (raw?.priority ?? 0) as TodoPriority,
    due: raw?.due,
    tags,
    subtasks: subtasks.map((s) => ({
          id: s.id ?? uuidv4(),
          content: s.content ?? "",
          done: s.done ?? false,
        })),
    note: raw?.note,
    createdAt: raw?.createdAt ?? Date.now(),
    completedAt: raw?.completedAt,
    order: typeof raw?.order === "number" ? (raw?.order as number) : index,
  };
}

function normalizeList(raw: Partial<TodoList>): TodoList {
  const now = Date.now();
  return {
    id: raw.id ?? uuidv4(),
    title: raw.title ?? "",
    description: raw.description,
    color: raw.color ?? DEFAULT_TODO_DEFAULTS.color,
    icon: normalizeTodoIcon(raw.icon ?? DEFAULT_TODO_DEFAULTS.icon),
    group: raw.group,
    dailyResetEnabled: raw.dailyResetEnabled ?? false,
    dailyResetTime: isValidDailyResetTime(raw.dailyResetTime)
      ? raw.dailyResetTime
      : DEFAULT_DAILY_RESET_TIME,
    lastDailyResetDate: raw.lastDailyResetDate,
    items: Array.isArray(raw.items)
      ? raw.items.map((item, i) => normalizeItem(item, i))
      : [],
    sortMode: (raw.sortMode ?? DEFAULT_TODO_DEFAULTS.sortMode) as TodoSortMode,
    hideCompleted: raw.hideCompleted ?? DEFAULT_TODO_DEFAULTS.hideCompleted,
    createdAt: raw.createdAt ?? now,
    updatedAt: raw.updatedAt ?? now,
  };
}

/** 确保数据已从配置加载（幂等）。 */
export async function ensureTodoLoaded(force = false): Promise<TodoList[]> {
  if (loaded && !force) return lists;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      const raw = await getConfig<TodoList[]>(CONFIG_KEY);
      lists = Array.isArray(raw) ? raw.map((l) => normalizeList(l)) : [];
      if (
        Array.isArray(raw) &&
        raw.some((list, index) => list.icon !== lists[index]?.icon)
      ) {
        await persist();
      }
      loaded = true;
      logDebug(`[todoStore] loaded ${lists.length} lists`);
    } catch (error) {
      logError("Failed to load todo lists:", error);
      lists = [];
      loaded = true;
    } finally {
      loadingPromise = null;
    }
    startDailyResetScheduler();
    notify();
    return lists;
  })();

  return loadingPromise;
}

export function getTodoLists(): TodoList[] {
  return lists;
}

export function isTodoLoaded(): boolean {
  return loaded;
}

/* ------------------------------------------------------------------ */
/* 排序 / 过滤                                                         */
/* ------------------------------------------------------------------ */

export function sortTodoItems(
  items: TodoItem[],
  mode: TodoSortMode,
): TodoItem[] {
  const copy = [...items];
  switch (mode) {
    case "priority":
      copy.sort((a, b) => b.priority - a.priority || a.order - b.order);
      break;
    case "due":
      copy.sort((a, b) => {
        if (a.due && b.due) return a.due - b.due;
        if (a.due) return -1;
        if (b.due) return 1;
        return a.order - b.order;
      });
      break;
    case "created":
      copy.sort((a, b) => b.createdAt - a.createdAt);
      break;
    case "manual":
    default:
      copy.sort((a, b) => a.order - b.order);
      break;
  }
  // 已完成项始终沉底
  copy.sort((a, b) => Number(a.done) - Number(b.done));
  return copy;
}

export function isOverdue(item: TodoItem): boolean {
  return !!item.due && !item.done && item.due < startOfToday();
}

export function isDueToday(item: TodoItem): boolean {
  if (!item.due) return false;
  const start = startOfToday();
  const end = start + 24 * 60 * 60 * 1000;
  return item.due >= start && item.due < end;
}

export function filterTodoItems(
  items: TodoItem[],
  filter: TodoFilter,
  search = "",
): TodoItem[] {
  const query = search.trim().toLowerCase();
  return items.filter((item) => {
    if (filter === "active" && item.done) return false;
    if (filter === "completed" && !item.done) return false;
    if (filter === "due_today" && !isDueToday(item)) return false;
    if (filter === "overdue" && !isOverdue(item)) return false;
    if (query) {
      const haystack = [item.content, ...item.tags, item.note ?? ""]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function getLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isValidDailyResetTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function startDailyResetScheduler() {
  if (dailyResetTimer || typeof window === "undefined") return;

  const check = () => {
    void resetDueDailyLists();
  };
  check();
  dailyResetTimer = window.setInterval(check, DAILY_RESET_CHECK_INTERVAL_MS);
  window.addEventListener("focus", check);
}

async function resetDueDailyLists(now = new Date()): Promise<void> {
  if (!loaded || dailyResetInProgress) return;

  const today = getLocalDateKey(now);
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes(),
  ).padStart(2, "0")}`;
  const dueListIds = new Set(
    lists
      .filter(
        (list) =>
          list.dailyResetEnabled &&
          isValidDailyResetTime(list.dailyResetTime) &&
          list.dailyResetTime <= currentTime &&
          list.lastDailyResetDate !== today,
      )
      .map((list) => list.id),
  );
  if (dueListIds.size === 0) return;

  dailyResetInProgress = true;
  try {
    lists = lists.map((list) => {
      if (!dueListIds.has(list.id)) return list;
      return {
        ...list,
        items: list.items.map((item) => ({
          ...item,
          done: false,
          completedAt: undefined,
          subtasks: item.subtasks.map((subtask) => ({
            ...subtask,
            done: false,
          })),
        })),
        lastDailyResetDate: today,
        updatedAt: now.getTime(),
      };
    });
    await persist();
    notify();
  } finally {
    dailyResetInProgress = false;
  }
}

/* ------------------------------------------------------------------ */
/* 列表级操作                                                          */
/* ------------------------------------------------------------------ */

export async function createTodoList(
  partial: Partial<TodoList> = {},
  defaults: TodoDefaults = DEFAULT_TODO_DEFAULTS,
): Promise<TodoList> {
  await ensureTodoLoaded();
  const now = Date.now();
  const list: TodoList = {
    id: uuidv4(),
    title: partial.title ?? "",
    description: partial.description,
    color: partial.color ?? defaults.color,
    icon: normalizeTodoIcon(partial.icon ?? defaults.icon),
    group: partial.group,
    dailyResetEnabled: partial.dailyResetEnabled ?? false,
    dailyResetTime: isValidDailyResetTime(partial.dailyResetTime)
      ? partial.dailyResetTime
      : DEFAULT_DAILY_RESET_TIME,
    lastDailyResetDate: partial.lastDailyResetDate,
    items: (partial.items ?? []).map((item, i) => normalizeItem(item, i)),
    sortMode: partial.sortMode ?? defaults.sortMode,
    hideCompleted: partial.hideCompleted ?? defaults.hideCompleted,
    createdAt: now,
    updatedAt: now,
  };
  lists = [...lists, list];
  await persist();
  notify();
  return list;
}

export async function updateTodoList(
  listId: string,
  patch: Partial<Omit<TodoList, "id" | "items">>,
): Promise<void> {
  await ensureTodoLoaded();
  lists = lists.map((list) =>
    list.id === listId
      ? { ...list, ...patch, updatedAt: Date.now() }
      : list,
  );
  await persist();
  notify();
}

export async function deleteTodoList(listId: string): Promise<void> {
  await ensureTodoLoaded();
  lists = lists.filter((list) => list.id !== listId);
  await persist();
  notify();
}

export async function duplicateTodoList(listId: string): Promise<TodoList | null> {
  await ensureTodoLoaded();
  const source = lists.find((list) => list.id === listId);
  if (!source) return null;
  const now = Date.now();
  const copy: TodoList = {
    ...source,
    id: uuidv4(),
    title: `${source.title}`,
    items: source.items.map((item, i) => ({
      ...item,
      id: uuidv4(),
      order: i,
      subtasks: item.subtasks.map((s) => ({ ...s, id: uuidv4() })),
    })),
    createdAt: now,
    updatedAt: now,
  };
  const index = lists.findIndex((list) => list.id === listId);
  lists = [...lists.slice(0, index + 1), copy, ...lists.slice(index + 1)];
  await persist();
  notify();
  return copy;
}

export async function reorderTodoLists(from: number, to: number): Promise<void> {
  await ensureTodoLoaded();
  if (from === to || from < 0 || to < 0 || from >= lists.length || to >= lists.length) {
    return;
  }
  const next = [...lists];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  lists = next;
  await persist();
  notify();
}

/* ------------------------------------------------------------------ */
/* 事项级操作                                                          */
/* ------------------------------------------------------------------ */

export interface NewTodoItem {
  content: string;
  priority?: TodoPriority;
  due?: number;
  tags?: string[];
}

export async function addTodoItem(
  listId: string,
  input: NewTodoItem,
): Promise<TodoItem | null> {
  await ensureTodoLoaded();
  const content = input.content.trim();
  if (!content) return null;

  const created: TodoItem = {
    id: uuidv4(),
    content,
    done: false,
    priority: input.priority ?? 0,
    due: input.due,
    tags: input.tags ?? [],
    subtasks: [],
    createdAt: Date.now(),
    order: 0,
  };

  lists = lists.map((list) => {
    if (list.id !== listId) return list;
    const maxOrder = list.items.reduce((max, item) => Math.max(max, item.order), -1);
    const item = { ...created, order: maxOrder + 1 };
    return { ...list, items: [...list.items, item], updatedAt: Date.now() };
  });
  await persist();
  notify();
  return created;
}

export async function updateTodoItem(
  listId: string,
  itemId: string,
  patch: Partial<Omit<TodoItem, "id" | "subtasks">> & {
    subtasks?: TodoSubtask[];
  },
): Promise<void> {
  await ensureTodoLoaded();
  lists = lists.map((list) => {
    if (list.id !== listId) return list;
    return {
      ...list,
      items: list.items.map((item) =>
        item.id === itemId ? { ...item, ...patch } : item,
      ),
      updatedAt: Date.now(),
    };
  });
  await persist();
  notify();
}

export async function toggleTodoItem(listId: string, itemId: string): Promise<void> {
  await ensureTodoLoaded();
  lists = lists.map((list) => {
    if (list.id !== listId) return list;
    return {
      ...list,
      items: list.items.map((item) =>
        item.id === itemId
          ? {
              ...item,
              done: !item.done,
              completedAt: !item.done ? Date.now() : undefined,
            }
          : item,
      ),
      updatedAt: Date.now(),
    };
  });
  await persist();
  notify();
}

export async function deleteTodoItem(listId: string, itemId: string): Promise<void> {
  await ensureTodoLoaded();
  const list = lists.find((l) => l.id === listId);
  const removed = list?.items.find((item) => item.id === itemId);
  if (removed) {
    undoEntry = { listId, items: [removed] };
    scheduleUndoExpiry();
  }
  lists = lists.map((l) =>
    l.id === listId
      ? { ...l, items: l.items.filter((item) => item.id !== itemId), updatedAt: Date.now() }
      : l,
  );
  await persist();
  notify();
}

export async function deleteTodoItems(listId: string, itemIds: string[]): Promise<void> {
  await ensureTodoLoaded();
  const idSet = new Set(itemIds);
  const list = lists.find((l) => l.id === listId);
  const removed = list?.items.filter((item) => idSet.has(item.id)) ?? [];
  if (removed.length > 0) {
    undoEntry = { listId, items: removed };
    scheduleUndoExpiry();
  }
  lists = lists.map((l) =>
    l.id === listId
      ? { ...l, items: l.items.filter((item) => !idSet.has(item.id)), updatedAt: Date.now() }
      : l,
  );
  await persist();
  notify();
}

export async function clearCompleted(listId: string): Promise<number> {
  await ensureTodoLoaded();
  const list = lists.find((l) => l.id === listId);
  const removed = list?.items.filter((item) => item.done) ?? [];
  if (removed.length === 0) return 0;
  undoEntry = { listId, items: removed };
  scheduleUndoExpiry();
  lists = lists.map((l) =>
    l.id === listId
      ? { ...l, items: l.items.filter((item) => !item.done), updatedAt: Date.now() }
      : l,
  );
  await persist();
  notify();
  return removed.length;
}

export async function reorderTodoItems(
  listId: string,
  from: number,
  to: number,
): Promise<void> {
  await ensureTodoLoaded();
  lists = lists.map((list) => {
    if (list.id !== listId) return list;
    const sorted = sortTodoItems(list.items, list.sortMode);
    if (from === to || from < 0 || to < 0 || from >= sorted.length || to >= sorted.length) {
      return list;
    }
    const [moved] = sorted.splice(from, 1);
    sorted.splice(to, 0, moved);
    const reordered = sorted.map((item, index) => ({ ...item, order: index }));
    return { ...list, items: reordered, updatedAt: Date.now() };
  });
  await persist();
  notify();
}

/* ------------------------------------------------------------------ */
/* 撤销                                                                */
/* ------------------------------------------------------------------ */

function scheduleUndoExpiry() {
  if (undoTimer) clearTimeout(undoTimer);
  undoTimer = setTimeout(() => {
    undoEntry = null;
    undoTimer = null;
    notify();
  }, UNDO_TIMEOUT_MS);
}

export function canUndo(): boolean {
  return undoEntry !== null;
}

export function undoLastDelete(): Promise<boolean> {
  return (async () => {
    if (!undoEntry) return false;
    const entry = undoEntry;
    undoEntry = null;
    if (undoTimer) {
      clearTimeout(undoTimer);
      undoTimer = null;
    }
    lists = lists.map((list) =>
      list.id === entry.listId
        ? { ...list, items: [...list.items, ...entry.items], updatedAt: Date.now() }
        : list,
    );
    await persist();
    notify();
    return true;
  })();
}

/* ------------------------------------------------------------------ */
/* 统计                                                                */
/* ------------------------------------------------------------------ */

export function getTodayStats(list?: TodoList): { completed: number; added: number } {
  const start = startOfToday();
  const source = list ? list.items : lists.flatMap((l) => l.items);
  let completed = 0;
  let added = 0;
  source.forEach((item) => {
    if (item.completedAt && item.completedAt >= start) completed += 1;
    if (item.createdAt >= start) added += 1;
  });
  return { completed, added };
}

/* ------------------------------------------------------------------ */
/* React Hook                                                          */
/* ------------------------------------------------------------------ */

export function useTodoLists() {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeTodo(() => {
      if (active) forceUpdate((v) => v + 1);
    });
    void ensureTodoLoaded().then(() => {
      if (active) forceUpdate((v) => v + 1);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return { lists, loaded, isLoaded: loaded };
}
