// 快捷添加语法解析：
//   !        → 高优先级；!1 / !2 / !3 → 低 / 中 / 高
//   @today / @tomorrow / @YYYY-MM-DD → 截止日期
//   #tag     → 标签（可多个）

import type { TodoPriority } from "@/types/todo";

export interface ParsedQuickAdd {
  content: string;
  priority: TodoPriority;
  due?: number;
  tags: string[];
}

export function parseQuickAdd(raw: string): ParsedQuickAdd {
  const tags: string[] = [];
  let priority: TodoPriority = 0;
  let due: number | undefined;

  // 标签
  const withoutTags = raw.replace(/#([^\s#]+)/g, (_match, tag: string) => {
    tags.push(tag);
    return "";
  });

  // 优先级
  const withoutPriority = withoutTags.replace(/!([1-3])?\b/g, (_match, level?: string) => {
    if (level) {
      priority = Number(level) as TodoPriority;
    } else {
      priority = 3;
    }
    return "";
  });

  // 截止时间
  const withoutDue = withoutPriority.replace(/@([^\s@]+)/g, (_match, token: string) => {
    const parsed = parseDueToken(token);
    if (parsed != null) {
      due = parsed;
      return "";
    }
    return `@${token}`;
  });

  return {
    content: withoutDue.replace(/\s+/g, " ").trim(),
    priority,
    due,
    tags,
  };
}

function parseDueToken(token: string): number | null {
  const lower = token.toLowerCase();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (lower === "today" || token === "今天") {
    return endOfDay(today.getTime());
  }
  if (lower === "tomorrow" || token === "明天") {
    return endOfDay(today.getTime() + 24 * 60 * 60 * 1000);
  }
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(token);
  if (match) {
    const date = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      23,
      59,
      59,
    );
    if (!Number.isNaN(date.getTime())) return date.getTime();
  }
  return null;
}

function endOfDay(timestamp: number): number {
  const d = new Date(timestamp);
  d.setHours(23, 59, 59, 0);
  return d.getTime();
}

/** 把时间戳格式化为本地日期文本。 */
export function formatDueDate(timestamp: number, locale: string): string {
  const d = new Date(timestamp);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  const diffDays = Math.round((start.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

  if (diffDays === 0) return locale === "zh" ? "今天" : "Today";
  if (diffDays === 1) return locale === "zh" ? "明天" : "Tomorrow";
  if (diffDays === -1) return locale === "zh" ? "昨天" : "Yesterday";
  const month = d.getMonth() + 1;
  const day = d.getDate();
  return locale === "zh" ? `${month}月${day}日` : `${month}/${day}`;
}
