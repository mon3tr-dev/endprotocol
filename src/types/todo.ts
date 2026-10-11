// To-Do 卡片 / 页面数据模型与默认值

export type TodoPriority = 0 | 1 | 2 | 3;

export type TodoSortMode = "manual" | "priority" | "due" | "created";

export type TodoFilter =
  | "all"
  | "active"
  | "completed"
  | "due_today"
  | "overdue";

export type TodoIconId =
  | "file"
  | "check"
  | "cart"
  | "calendar"
  | "bug"
  | "idea"
  | "pin"
  | "target"
  | "book"
  | "home"
  | "work"
  | "game"
  | "swords"
  | "gem";

export const TODO_ICONS: TodoIconId[] = [
  "file",
  "check",
  "cart",
  "calendar",
  "bug",
  "idea",
  "pin",
  "target",
  "book",
  "home",
  "work",
  "game",
  "swords",
  "gem",
];

const LEGACY_TODO_ICON_IDS: Record<string, TodoIconId> = {
  "\u{1f4dd}": "file",
  "\u2705": "check",
  "\u{1f6d2}": "cart",
  "\u{1f4c5}": "calendar",
  "\u{1f41e}": "bug",
  "\u{1f4a1}": "idea",
  "\u{1f4cc}": "pin",
  "\u{1f3af}": "target",
  "\u{1f4da}": "book",
  "\u{1f3e0}": "home",
  "\u{1f4bc}": "work",
  "\u{1f3ae}": "game",
  "\u{1f305}": "calendar",
  "\u2694\ufe0f": "swords",
  "\u{1f48e}": "gem",
};

export function normalizeTodoIcon(icon?: string | null): TodoIconId {
  if (icon && TODO_ICONS.some((id) => id === icon)) return icon as TodoIconId;
  return (icon && LEGACY_TODO_ICON_IDS[icon]) || "file";
}

export interface TodoSubtask {
  id: string;
  content: string;
  done: boolean;
}

export interface TodoItem {
  id: string;
  content: string;
  done: boolean;
  priority: TodoPriority;
  /** 截止时间（毫秒时间戳） */
  due?: number;
  tags: string[];
  subtasks: TodoSubtask[];
  note?: string;
  createdAt: number;
  completedAt?: number;
  /** 手动排序序号 */
  order: number;
}

export interface TodoList {
  id: string;
  title: string;
  description?: string;
  /** 卡片/列表强调色 */
  color?: string;
  /** 图标标识 */
  icon?: string;
  /** 分组名（可选） */
  group?: string;
  /** 是否按设备本地时间每日清空已完成状态 */
  dailyResetEnabled: boolean;
  /** 每日清空时间，HH:mm */
  dailyResetTime: string;
  /** 最近一次完成每日重置的本地日期，YYYY-MM-DD */
  lastDailyResetDate?: string;
  items: TodoItem[];
  sortMode: TodoSortMode;
  hideCompleted: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TodoDefaults {
  sortMode: TodoSortMode;
  hideCompleted: boolean;
  /** 默认优先级体系（无 / 低中高） */
  priorityEnabled: boolean;
  /** 默认是否开启截止时间 */
  dueEnabled: boolean;
  color: string;
  icon: TodoIconId;
}

export const DEFAULT_TODO_DEFAULTS: TodoDefaults = {
  sortMode: "manual",
  hideCompleted: false,
  priorityEnabled: true,
  dueEnabled: false,
  color: "#6366f1",
  icon: "file",
};

export const TODO_COLORS = [
  "#6366f1",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#a855f7",
  "#ec4899",
  "#64748b",
];

export const PRIORITY_LABELS: Record<Exclude<TodoPriority, 0>, string> = {
  1: "todo_priority_low",
  2: "todo_priority_medium",
  3: "todo_priority_high",
};

export const PRIORITY_COLORS: Record<Exclude<TodoPriority, 0>, string> = {
  1: "#0ea5e9",
  2: "#f59e0b",
  3: "#ef4444",
};

export interface TodoTemplate {
  id: string;
  labelKey: string;
  titleKey: string;
  icon: TodoIconId;
  color: string;
  items: string[];
}

/** 预设模板（面向游戏日常/周常/活动/养成/资源规划）。 */
export const TODO_TEMPLATES: TodoTemplate[] = [
  {
    id: "blank",
    labelKey: "todo_template_blank",
    titleKey: "todo_template_blank_title",
    icon: "file",
    color: "#6366f1",
    items: [],
  },
  {
    id: "daily",
    labelKey: "todo_template_daily",
    titleKey: "todo_template_daily_title",
    icon: "calendar",
    color: "#0ea5e9",
    items: [
      "todo_template_daily_item_1",
      "todo_template_daily_item_2",
      "todo_template_daily_item_3",
      "todo_template_daily_item_4",
    ],
  },
  {
    id: "weekly",
    labelKey: "todo_template_weekly",
    titleKey: "todo_template_weekly_title",
    icon: "calendar",
    color: "#10b981",
    items: [
      "todo_template_weekly_item_1",
      "todo_template_weekly_item_2",
      "todo_template_weekly_item_3",
    ],
  },
  {
    id: "event",
    labelKey: "todo_template_event",
    titleKey: "todo_template_event_title",
    icon: "target",
    color: "#f59e0b",
    items: [
      "todo_template_event_item_1",
      "todo_template_event_item_2",
      "todo_template_event_item_3",
    ],
  },
  {
    id: "cultivation",
    labelKey: "todo_template_cultivation",
    titleKey: "todo_template_cultivation_title",
    icon: "swords",
    color: "#a855f7",
    items: [
      "todo_template_cultivation_item_1",
      "todo_template_cultivation_item_2",
      "todo_template_cultivation_item_3",
    ],
  },
  {
    id: "resource",
    labelKey: "todo_template_resource",
    titleKey: "todo_template_resource_title",
    icon: "gem",
    color: "#ec4899",
    items: [
      "todo_template_resource_item_1",
      "todo_template_resource_item_2",
      "todo_template_resource_item_3",
    ],
  },
];

export const SORT_MODE_OPTIONS: { value: TodoSortMode; labelKey: string }[] = [
  { value: "manual", labelKey: "todo_sort_manual" },
  { value: "priority", labelKey: "todo_sort_priority" },
  { value: "due", labelKey: "todo_sort_due" },
  { value: "created", labelKey: "todo_sort_created" },
];

export const FILTER_OPTIONS: { value: TodoFilter; labelKey: string }[] = [
  { value: "all", labelKey: "todo_filter_all" },
  { value: "active", labelKey: "todo_filter_active" },
  { value: "completed", labelKey: "todo_filter_completed" },
  { value: "due_today", labelKey: "todo_filter_due_today" },
  { value: "overdue", labelKey: "todo_filter_overdue" },
];
