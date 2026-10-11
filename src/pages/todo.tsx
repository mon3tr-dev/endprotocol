import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { GlassButton, GlassCard, GlassInput, GlassSwitch } from "@/components/ui/glass";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import {
  CustomModal,
  CustomModalBody,
  CustomModalFooter,
  CustomModalHeader,
} from "@/components/custom-modal";
import {
  createTodoList,
  deleteTodoList,
  duplicateTodoList,
  isOverdue,
  reorderTodoLists,
  useTodoLists,
} from "@/stores/todoStore";
import { getTodoDefaults } from "@/utils/todoDefaults";
import { listToJson, listToMarkdown, parseJsonList, parseMarkdownList } from "@/utils/todoImportExport";
import { TODO_TEMPLATES } from "@/types/todo";
import type { TodoList } from "@/types/todo";
import { TodoDetail } from "@/components/cards/todo/todo-detail";
import { TodoListSettingsModal } from "@/components/cards/todo/list-settings-modal";
import { TodoIcon } from "@/components/cards/todo/todo-icon";
import { MorphIcon } from "morphicons/react";
import { Copy, Settings, Trash2 } from "lucide";

export default function TodoPage() {
  const { t, i18n } = useTranslation();
  const { lists, loaded } = useTodoLists();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [isNewOpen, setIsNewOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newTemplate, setNewTemplate] = useState(TODO_TEMPLATES[0].id);
  const [settingsListId, setSettingsListId] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState(false);
  const dragIndexRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeListId = searchParams.get("list");
  const activeList = lists.find((l) => l.id === activeListId) ?? null;

  // Clear stale selections without choosing another list implicitly.
  useEffect(() => {
    if (loaded && activeListId && !lists.some((l) => l.id === activeListId)) {
      setSearchParams({}, { replace: true });
    }
  }, [activeListId, lists, loaded, setSearchParams]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return lists;
    return lists.filter(
      (l) =>
        l.title.toLowerCase().includes(query) ||
        (l.description ?? "").toLowerCase().includes(query) ||
        l.items.some((item) => item.content.toLowerCase().includes(query)),
    );
  }, [lists, search]);

  const grouped = useMemo(() => {
    if (!groupBy) return [{ group: "", lists: filtered }];
    const map = new Map<string, TodoList[]>();
    filtered.forEach((list) => {
      const key = list.group?.trim() || t("todo_page.ungrouped");
      map.set(key, [...(map.get(key) ?? []), list]);
    });
    return [...map.entries()].map(([group, groupLists]) => ({
      group,
      lists: groupLists,
    }));
  }, [filtered, groupBy, t]);

  const handleCreate = async () => {
    const template = TODO_TEMPLATES.find((tpl) => tpl.id === newTemplate) ?? TODO_TEMPLATES[0];
    const defaults = await getTodoDefaults();
    const title = newTitle.trim() || t(`card:${template.titleKey}`);
    const created = await createTodoList(
      {
        title,
        icon: template.icon,
        color: template.color,
        items: template.items.map((key, index) => ({
          id: crypto.randomUUID(),
          content: t(`card:${key}`),
          done: false,
          priority: 0,
          tags: [],
          subtasks: [],
          createdAt: Date.now(),
          order: index,
        })),
      },
      defaults,
    );
    setSearchParams({ list: created.id });
    setIsNewOpen(false);
    setNewTitle("");
    setNewTemplate(TODO_TEMPLATES[0].id);
  };

  const handleImport = async (file: File) => {
    const text = await file.text();
    const defaults = await getTodoDefaults();
    let parsed: Partial<TodoList> | null;
    if (file.name.toLowerCase().endsWith(".json")) {
      parsed = parseJsonList(text);
    } else {
      const md = parseMarkdownList(text);
      parsed = {
        title: md.title,
        description: md.description,
        items: md.items.map((item, index) => ({
          id: crypto.randomUUID(),
          content: item.content,
          done: item.done,
          priority: item.priority,
          due: item.due,
          tags: item.tags,
          subtasks: [],
          createdAt: Date.now(),
          order: index,
        })),
      };
    }
    if (!parsed) return;
    const created = await createTodoList(
      {
        title: parsed.title || file.name.replace(/\.[^.]+$/, ""),
        description: parsed.description,
        color: parsed.color,
        icon: parsed.icon,
        items: parsed.items,
      },
      defaults,
    );
    setSearchParams({ list: created.id });
  };

  const handleExport = (list: TodoList, format: "md" | "json") => {
    const content = format === "md" ? listToMarkdown(list) : listToJson(list);
    const blob = new Blob([content], {
      type: format === "md" ? "text/markdown" : "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${list.title || "todo"}.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        id="todo-header"
        title={t("todo_page.title")}
        description={t("todo_page.description")}
        actions={
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.txt,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImport(file);
                e.target.value = "";
              }}
            />
            <GlassButton
              size="sm"
              variant="secondary"
              onPress={() => fileInputRef.current?.click()}
            >
              {t("todo_page.import")}
            </GlassButton>
            {activeList && (
              <>
                <GlassButton
                  size="sm"
                  variant="secondary"
                  onPress={() => handleExport(activeList, "md")}
                >
                  {t("todo_page.export_md")}
                </GlassButton>
                <GlassButton
                  size="sm"
                  variant="secondary"
                  onPress={() => handleExport(activeList, "json")}
                >
                  {t("todo_page.export_json")}
                </GlassButton>
              </>
            )}
            <GlassButton size="sm" variant="primary" onPress={() => setIsNewOpen(true)}>
              + {t("todo_page.new_list")}
            </GlassButton>
          </>
        }
      />

      <div className="flex flex-col lg:flex-row gap-4 min-h-[70vh]">
        {/* 左侧：列表 */}
        <GlassCard className="lg:w-72 shrink-0 glass-surface border border-separator/90 p-3 flex flex-col gap-2 lg:max-h-[78vh]">
          <GlassInput
            size="sm"
            value={search}
            placeholder={t("todo_page.search_lists")}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">
              {t("todo_page.list_count", { n: lists.length })}
            </span>
            <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
              {t("todo_page.group_by")}
              <GlassSwitch isSelected={groupBy} onValueChange={setGroupBy}>
                <GlassSwitch.Control>
                  <GlassSwitch.Thumb />
                </GlassSwitch.Control>
              </GlassSwitch>
            </label>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
            {filtered.length === 0 ? (
              <p className="text-xs text-muted text-center py-6">
                {t("todo_page.no_lists")}
              </p>
            ) : (
              grouped.map((section) => (
                <div key={section.group || "__all"}>
                  {groupBy && (
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted/70 px-2 py-1">
                      {section.group}
                    </div>
                  )}
                  {section.lists.map((list) => {
                    const index = lists.findIndex((l) => l.id === list.id);
                    const active = list.id === activeListId;
                    const overdue = list.items.filter(isOverdue).length;
                    const done = list.items.filter((i) => i.done).length;
                    return (
                      <div
                        key={list.id}
                        draggable
                        onDragStart={() => (dragIndexRef.current = index)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (dragIndexRef.current != null && dragIndexRef.current !== index) {
                            void reorderTodoLists(dragIndexRef.current, index);
                          }
                          dragIndexRef.current = null;
                        }}
                        className={`group flex items-center gap-2 px-2 py-2 rounded-xl cursor-pointer transition-all ${
                          active
                            ? "bg-primary/10 border border-primary/40"
                            : "hover:bg-default-100/60 border border-transparent"
                        }`}
                        onClick={() => setSearchParams({ list: list.id })}
                      >
                        <span className="flex shrink-0 text-primary">
                          <TodoIcon icon={list.icon} size={16} />
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm truncate">
                            {list.title || t("card:todo_untitled")}
                          </div>
                          <div className="text-[10px] text-muted">
                            {done}/{list.items.length}
                            {overdue > 0 && (
                              <span className="text-danger"> · {overdue} {i18n.language === "zh" ? "逾期" : "overdue"}</span>
                            )}
                          </div>
                        </div>
                        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
                          <button
                            type="button"
                            className="w-5 h-5 rounded text-muted hover:text-foreground text-[10px]"
                            title={t("todo_page.settings")}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSettingsListId(list.id);
                            }}
                          >
                            <MorphIcon icon={Settings} size={14} aria-hidden />
                          </button>
                          <button
                            type="button"
                            className="w-5 h-5 rounded text-muted hover:text-foreground text-[10px]"
                            title={t("todo_page.duplicate")}
                            onClick={(e) => {
                              e.stopPropagation();
                              void duplicateTodoList(list.id);
                            }}
                          >
                            <MorphIcon icon={Copy} size={14} aria-hidden />
                          </button>
                          <button
                            type="button"
                            className="w-5 h-5 rounded text-muted hover:text-danger text-[10px]"
                            title={t("common.delete")}
                            onClick={(e) => {
                              e.stopPropagation();
                              void confirmDialog({
                                title: t("card:todo_delete_list"),
                                body: t("card:todo_delete_list_confirm"),
                                confirmText: t("common.delete"),
                                cancelText: t("common.cancel"),
                                tone: "danger",
                              }).then((ok) => {
                                if (ok) void deleteTodoList(list.id);
                              });
                            }}
                          >
                            <MorphIcon icon={Trash2} size={14} aria-hidden />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </GlassCard>

        {/* 右侧：详情 */}
        <GlassCard className="flex-1 min-w-0 glass-surface border border-separator/90 p-4 flex flex-col lg:max-h-[78vh]">
          {activeList ? (
            <TodoDetail listId={activeList.id} className="h-full" />
          ) : (
            <EmptyState
              icon={<TodoIcon icon="file" size={56} />}
              title={t("todo_page.empty_title")}
              description={t("todo_page.empty_desc")}
              action={
                <GlassButton variant="primary" onPress={() => setIsNewOpen(true)}>
                  + {t("todo_page.new_list")}
                </GlassButton>
              }
            />
          )}
        </GlassCard>
      </div>

      {/* 新建列表 */}
      <CustomModal isOpen={isNewOpen} onClose={() => setIsNewOpen(false)} size="md">
        <CustomModalHeader onClose={() => setIsNewOpen(false)}>
          {t("todo_page.new_list")}
        </CustomModalHeader>
        <CustomModalBody>
          <div className="space-y-4">
            <GlassInput
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={t("card:todo_list_title")}
              autoFocus
            />
            <div>
              <p className="text-xs text-muted mb-2">{t("todo_page.templates")}</p>
              <div className="grid grid-cols-2 gap-2">
                {TODO_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => setNewTemplate(tpl.id)}
                    className={`flex items-center gap-2 p-2.5 rounded-xl border text-left transition-all ${
                      newTemplate === tpl.id
                        ? "border-primary bg-primary/10"
                        : "border-separator hover:border-primary/50"
                    }`}
                  >
                    <TodoIcon icon={tpl.icon} size={18} className="shrink-0 text-primary" />
                    <span className="text-sm truncate">
                      {t(`card:${tpl.labelKey}`)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </CustomModalBody>
        <CustomModalFooter>
          <GlassButton variant="secondary" onPress={() => setIsNewOpen(false)}>
            {t("common.cancel")}
          </GlassButton>
          <GlassButton variant="primary" onPress={() => void handleCreate()}>
            {t("common.confirm")}
          </GlassButton>
        </CustomModalFooter>
      </CustomModal>

      <TodoListSettingsModal
        isOpen={settingsListId !== null}
        listId={settingsListId}
        onClose={() => setSettingsListId(null)}
      />
    </div>
  );
}
