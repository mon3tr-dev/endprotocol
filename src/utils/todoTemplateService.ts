import type { TFunction } from "i18next";
import { TODO_TEMPLATES } from "@/types/todo";
import { createTodoList } from "@/stores/todoStore";
import { getTodoDefaults } from "@/utils/todoDefaults";

export async function createTodoListFromTemplate(
  templateId: string,
  translate: TFunction,
) {
  const template =
    TODO_TEMPLATES.find((candidate) => candidate.id === templateId) ??
    TODO_TEMPLATES[0];
  const defaults = await getTodoDefaults();

  return createTodoList(
    {
      title: translate(`card:${template.titleKey}`),
      icon: template.icon,
      color: template.color,
      items: template.items.map((key, index) => ({
        id: crypto.randomUUID(),
        content: translate(`card:${key}`),
        done: false,
        priority: 0,
        tags: [],
        subtasks: [],
        createdAt: Date.now(),
        order: index,
      })),
      sortMode: defaults.sortMode,
      hideCompleted: defaults.hideCompleted,
    },
    defaults,
  );
}
