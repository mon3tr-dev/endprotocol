// To-Do 列表的 Markdown / JSON 导入导出。

import type { TodoItem, TodoList } from "@/types/todo";

/** 导出为 Markdown：`- [ ] 内容 !2 @2026-10-04 #tag` */
export function listToMarkdown(list: TodoList): string {
  const lines: string[] = [`# ${list.title}`];
  if (list.description) lines.push("", list.description);
  lines.push("");
  list.items
    .slice()
    .sort((a, b) => a.order - b.order)
    .forEach((item) => {
      const checkbox = item.done ? "[x]" : "[ ]";
      const parts = [`- ${checkbox} ${item.content}`];
      if (item.priority > 0) parts.push(`!${item.priority}`);
      if (item.due) parts.push(`@${toDateString(item.due)}`);
      item.tags.forEach((tag) => parts.push(`#${tag}`));
      lines.push(parts.join(" "));
      item.subtasks.forEach((sub) => {
        lines.push(`  - ${sub.done ? "[x]" : "[ ]"} ${sub.content}`);
      });
      if (item.note) lines.push(`  > ${item.note}`);
    });
  return lines.join("\n");
}

export interface ParsedMarkdownList {
  title?: string;
  description?: string;
  items: Array<{
    content: string;
    done: boolean;
    priority: 0 | 1 | 2 | 3;
    due?: number;
    tags: string[];
  }>;
}

/** 解析 Markdown（支持标题、描述、`- [ ]` 事项、!优先级、@日期、#标签）。 */
export function parseMarkdownList(markdown: string): ParsedMarkdownList {
  const result: ParsedMarkdownList = { items: [] };
  const lines = markdown.split(/\r?\n/);
  let description: string[] = [];
  let sawItem = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;

    if (!sawItem && /^#\s+/.test(line)) {
      result.title = line.replace(/^#\s+/, "").trim();
      continue;
    }

    const itemMatch = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(line);
    if (itemMatch) {
      sawItem = true;
      const done = itemMatch[1].toLowerCase() === "x";
      const parsed = parseItemText(itemMatch[2]);
      result.items.push({ ...parsed, done });
      continue;
    }

    if (!sawItem) {
      description.push(line.trim());
    }
  }

  if (description.length > 0) result.description = description.join(" ");
  return result;
}

function parseItemText(text: string) {
  const tags: string[] = [];
  let priority: 0 | 1 | 2 | 3 = 0;
  let due: number | undefined;

  const withoutTags = text.replace(/#([^\s#]+)/g, (_m, tag: string) => {
    tags.push(tag);
    return "";
  });
  const withoutPriority = withoutTags.replace(/!([1-3])?\b/g, (_m, level?: string) => {
    priority = (level ? Number(level) : 3) as 0 | 1 | 2 | 3;
    return "";
  });
  const withoutDue = withoutPriority.replace(/@(\d{4}-\d{1,2}-\d{1,2})/g, (_m, date: string) => {
    const d = new Date(`${date}T23:59:59`);
    if (!Number.isNaN(d.getTime())) due = d.getTime();
    return "";
  });

  return {
    content: withoutDue.replace(/\s+/g, " ").trim(),
    priority,
    due,
    tags,
  };
}

/** 导出为 JSON（保留完整字段）。 */
export function listToJson(list: TodoList): string {
  return JSON.stringify(list, null, 2);
}

/** 解析 JSON 导入。 */
export function parseJsonList(json: string): Partial<TodoList> | null {
  try {
    const data = JSON.parse(json);
    if (!data || typeof data !== "object") return null;
    const items: TodoItem[] = Array.isArray(data.items)
      ? data.items.map((item: Partial<TodoItem>, index: number) => ({
          id: item.id ?? crypto.randomUUID(),
          content: String(item.content ?? ""),
          done: Boolean(item.done),
          priority: (item.priority ?? 0) as TodoItem["priority"],
          due: item.due,
          tags: Array.isArray(item.tags) ? item.tags : [],
          subtasks: Array.isArray(item.subtasks) ? item.subtasks : [],
          note: item.note,
          createdAt: item.createdAt ?? Date.now(),
          completedAt: item.completedAt,
          order: typeof item.order === "number" ? item.order : index,
        }))
      : [];
    return {
      title: typeof data.title === "string" ? data.title : undefined,
      description: typeof data.description === "string" ? data.description : undefined,
      color: typeof data.color === "string" ? data.color : undefined,
      icon: typeof data.icon === "string" ? data.icon : undefined,
      items,
    };
  } catch {
    return null;
  }
}

function toDateString(timestamp: number): string {
  const d = new Date(timestamp);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}
