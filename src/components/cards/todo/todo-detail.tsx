import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { GlassButton, GlassChip, GlassInput, GlassProgressCircle, GlassSelect } from "@/components/ui/glass";
import {
  addTodoItem,
  clearCompleted,
  deleteTodoItem,
  deleteTodoItems,
  filterTodoItems,
  getTodayStats,
  isOverdue,
  reorderTodoItems,
  sortTodoItems,
  toggleTodoItem,
  undoLastDelete,
  updateTodoItem,
  updateTodoList,
  useTodoLists,
} from "@/stores/todoStore";
import type {
  TodoFilter,
  TodoItem,
  TodoPriority,
  TodoSortMode,
} from "@/types/todo";
import {
  FILTER_OPTIONS,
  PRIORITY_COLORS,
  SORT_MODE_OPTIONS,
} from "@/types/todo";
import { formatDueDate, parseQuickAdd } from "./quick-add";
import { TodoListSettingsModal } from "./list-settings-modal";
import { getTodoDefaults } from "@/utils/todoDefaults";
import type { TodoDefaults } from "@/types/todo";
import { DEFAULT_TODO_DEFAULTS } from "@/types/todo";
import { TodoIcon } from "./todo-icon";
import { MorphIcon } from "morphicons/react";
import { Check, X } from "lucide";

interface TodoDetailProps {
  listId: string;
  className?: string;
  onRequestClose?: () => void;
}

export function TodoDetail({ listId, className, onRequestClose }: TodoDetailProps) {
  const { t, i18n } = useTranslation();
  const { lists } = useTodoLists();
  const list = lists.find((l) => l.id === listId) ?? null;

  const [filter, setFilter] = useState<TodoFilter>("all");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [undoVisible, setUndoVisible] = useState(false);
  const [defaults, setDefaults] = useState<TodoDefaults>(DEFAULT_TODO_DEFAULTS);
  const undoTimerRef = useRef<number | null>(null);
  const dragIndexRef = useRef<number | null>(null);

  useEffect(() => {
    void getTodoDefaults().then(setDefaults);
    return () => {
      if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    };
  }, []);

  const sorted = useMemo(
    () => (list ? sortTodoItems(list.items, list.sortMode) : []),
    [list],
  );

  if (!list) {
    return (
      <div className={className}>
        <div className="text-sm text-muted text-center py-12">
          {t("card:todo_list_missing")}
        </div>
      </div>
    );
  }

  const visibleItems = filterTodoItems(sorted, filter, search).filter(
    (item) => !(list.hideCompleted && item.done),
  );
  const total = list.items.length;
  const done = list.items.filter((i) => i.done).length;
  const progress = total === 0 ? 0 : Math.round((done / total) * 100);
  const stats = getTodayStats(list);
  const overdueCount = list.items.filter(isOverdue).length;
  const canManualSort = list.sortMode === "manual" && filter === "all" && !search;

  const flashUndo = () => {
    setUndoVisible(true);
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = window.setTimeout(() => setUndoVisible(false), 8000);
  };

  const handleAdd = async () => {
    const parsed = parseQuickAdd(draft);
    if (!parsed.content) return;
    await addTodoItem(list.id, {
      content: parsed.content,
      priority: parsed.priority,
      due: parsed.due,
      tags: parsed.tags,
    });
    setDraft("");
  };

  const handleDelete = async (itemId: string) => {
    await deleteTodoItem(list.id, itemId);
    flashUndo();
  };

  const toggleSelected = (itemId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const runBatch = async (action: "complete" | "delete") => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (action === "complete") {
      for (const id of ids) {
        const item = list.items.find((i) => i.id === id);
        if (item && !item.done) await toggleTodoItem(list.id, id);
      }
    } else {
      await deleteTodoItems(list.id, ids);
      flashUndo();
    }
    setSelected(new Set());
    setSelectMode(false);
  };

  return (
    <div className={`flex flex-col min-h-0 ${className ?? ""}`}>
      {/* Header */}
      <div className="flex items-center gap-3 pb-3 shrink-0">
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 transition-transform hover:scale-105"
          style={{ backgroundColor: `${list.color ?? "#6366f1"}22` }}
          aria-label={t("card:todo_list_settings")}
        >
          <TodoIcon icon={list.icon} size={22} />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground truncate">
              {list.title || t("card:todo_untitled")}
            </h2>
            {overdueCount > 0 && (
              <GlassChip color="danger" size="sm">
                {t("card:todo_overdue_count", { n: overdueCount })}
              </GlassChip>
            )}
          </div>
          <p className="text-xs text-muted truncate">
            {list.description || t("card:todo_progress", { done, total })}
          </p>
        </div>

        <div className="relative shrink-0" style={{ color: list.color ?? "#6366f1" }}>
          <GlassProgressCircle value={progress} size={42} aria-label="progress">
            <GlassProgressCircle.Track>
              <GlassProgressCircle.TrackCircle />
              <GlassProgressCircle.FillCircle />
            </GlassProgressCircle.Track>
          </GlassProgressCircle>
          <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-foreground">
            {progress}%
          </span>
        </div>

        {onRequestClose && (
          <button
            type="button"
            onClick={onRequestClose}
            className="w-8 h-8 rounded-lg text-muted hover:text-foreground hover:bg-default-100 transition-colors"
            aria-label={t("common.cancel")}
          >
            <MorphIcon icon={X} size={14} aria-hidden />
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 text-[11px] text-muted pb-2 shrink-0">
        <span>
          {t("card:todo_today_completed")}: <b className="text-foreground">{stats.completed}</b>
        </span>
        <span>
          {t("card:todo_today_added")}: <b className="text-foreground">{stats.added}</b>
        </span>
        <span>
          {t("card:todo_remaining")}: <b className="text-foreground">{total - done}</b>
        </span>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 pb-2 shrink-0">
        <div className="flex items-center gap-1 flex-wrap">
          {FILTER_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setFilter(option.value)}
              className={`px-2.5 py-1 text-xs rounded-full border transition-all cursor-pointer ${
                filter === option.value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-separator text-muted hover:border-primary/50"
              }`}
            >
              {t(`card:${option.labelKey}`)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <GlassInput
            size="sm"
            className="w-40"
            value={search}
            placeholder={t("common.search")}
            onChange={(e) => setSearch(e.target.value)}
          />
          <GlassSelect
            value={list.sortMode}
            options={SORT_MODE_OPTIONS.map((o) => ({
              value: o.value,
              label: t(`card:${o.labelKey}`),
            }))}
            onChange={(v) => void updateTodoList(list.id, { sortMode: v as TodoSortMode })}
          />
          <GlassButton
            size="sm"
            variant={selectMode ? "primary" : "secondary"}
            onPress={() => {
              setSelectMode((v) => !v);
              setSelected(new Set());
            }}
          >
            {t("card:todo_select")}
          </GlassButton>
        </div>
      </div>

      {/* Quick add */}
      <div className="pb-2 shrink-0">
        <GlassInput
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleAdd();
            }
          }}
          placeholder={t("card:todo_quick_add_placeholder")}
          startContent={<span className="text-muted">＋</span>}
        />
        <p className="text-[10px] text-muted/70 mt-1">
          {t("card:todo_quick_add_hint")}
        </p>
      </div>

      {/* Items */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-1">
        {visibleItems.length === 0 ? (
          <EmptyState onPick={(text) => setDraft(text)} />
        ) : (
          visibleItems.map((item, index) => (
            <TodoItemRow
              key={item.id}
              item={item}
              listId={list.id}
              locale={i18n.language}
              expanded={expandedId === item.id}
              editing={editingId === item.id}
              selectMode={selectMode}
              selected={selected.has(item.id)}
              draggable={canManualSort}
              showPriority={defaults.priorityEnabled}
              showDue={defaults.dueEnabled}
              onToggleSelect={() => toggleSelected(item.id)}
              onToggleExpand={() =>
                setExpandedId((prev) => (prev === item.id ? null : item.id))
              }
              onStartEdit={() => setEditingId(item.id)}
              onStopEdit={() => setEditingId(null)}
              onDelete={() => void handleDelete(item.id)}
              onDragStart={() => (dragIndexRef.current = index)}
              onDrop={() => {
                if (dragIndexRef.current != null && dragIndexRef.current !== index) {
                  void reorderTodoItems(list.id, dragIndexRef.current, index);
                }
                dragIndexRef.current = null;
              }}
            />
          ))
        )}
      </div>

      {/* Batch bar */}
      {selectMode && (
        <div className="flex items-center gap-2 pt-2 shrink-0 border-t border-separator/60 mt-2">
          <span className="text-xs text-muted flex-1">
            {t("card:todo_selected_count", { n: selected.size })}
          </span>
          <GlassButton size="sm" variant="secondary" onPress={() => void runBatch("complete")}>
            {t("card:todo_mark_done")}
          </GlassButton>
          <GlassButton size="sm" variant="danger" onPress={() => void runBatch("delete")}>
            {t("common.delete")}
          </GlassButton>
        </div>
      )}

      {/* Footer actions */}
      <div className="flex items-center gap-2 pt-2 shrink-0">
        <GlassButton size="sm" variant="ghost" onPress={() => setSettingsOpen(true)}>
          {t("card:todo_list_settings")}
        </GlassButton>
        {done > 0 && (
          <GlassButton
            size="sm"
            variant="ghost"
            onPress={() => {
              void clearCompleted(list.id).then((count) => {
                if (count > 0) flashUndo();
              });
            }}
          >
            {t("card:todo_clear_completed")}
          </GlassButton>
        )}
        {undoVisible && (
          <button
            type="button"
            onClick={() => {
              void undoLastDelete().then(() => setUndoVisible(false));
            }}
            className="ml-auto text-xs text-primary hover:underline"
          >
            {t("card:todo_undo")}
          </button>
        )}
      </div>

      <TodoListSettingsModal
        isOpen={settingsOpen}
        listId={list.id}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}

interface TodoItemRowProps {
  item: TodoItem;
  listId: string;
  locale: string;
  expanded: boolean;
  editing: boolean;
  selectMode: boolean;
  selected: boolean;
  draggable: boolean;
  showPriority: boolean;
  showDue: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDrop: () => void;
}

function TodoItemRow({
  item,
  listId,
  locale,
  expanded,
  editing,
  selectMode,
  selected,
  draggable,
  showPriority,
  showDue,
  onToggleSelect,
  onToggleExpand,
  onStartEdit,
  onStopEdit,
  onDelete,
  onDragStart,
  onDrop,
}: TodoItemRowProps) {
  const { t } = useTranslation();
  const [editValue, setEditValue] = useState(item.content);
  const [subtaskDraft, setSubtaskDraft] = useState("");
  const overdue = isOverdue(item);

  useEffect(() => {
    setEditValue(item.content);
  }, [item.content, editing]);

  const commitEdit = async () => {
    const content = editValue.trim();
    if (content && content !== item.content) {
      await updateTodoItem(listId, item.id, { content });
    }
    onStopEdit();
  };

  const cyclePriority = async () => {
    const next = ((item.priority + 1) % 4) as TodoPriority;
    await updateTodoItem(listId, item.id, { priority: next });
  };

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className={`group rounded-xl border px-2.5 py-2 transition-colors ${
        selected
          ? "border-primary/60 bg-primary/5"
          : "border-separator/60 hover:border-separator bg-default-50/30"
      }`}
    >
      <div className="flex items-start gap-2">
        {selectMode && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            className="mt-1 accent-primary"
            aria-label={t("card:todo_select")}
          />
        )}
        {draggable && (
          <span className="mt-0.5 text-muted/50 cursor-grab select-none" aria-hidden>
            ⋮⋮
          </span>
        )}

        <button
          type="button"
          onClick={() => void toggleTodoItem(listId, item.id)}
          className={`mt-0.5 w-[18px] h-[18px] rounded-md border flex items-center justify-center shrink-0 transition-all ${
            item.done
              ? "bg-primary border-primary text-white"
              : "border-default-400 hover:border-primary"
          }`}
          aria-label={item.done ? t("card:todo_undo_done") : t("card:todo_mark_done")}
        >
          {item.done && (
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
              <path
                d="M2.5 6.2 5 8.7l4.5-5.4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>

        <div className="flex-1 min-w-0">
          {editing ? (
            <GlassInput
              size="sm"
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => void commitEdit()}
              onKeyDown={(e) => {
                if (e.key === "Enter") void commitEdit();
                if (e.key === "Escape") onStopEdit();
              }}
            />
          ) : (
            <button
              type="button"
              onClick={onToggleExpand}
              onDoubleClick={onStartEdit}
              className={`text-left text-sm w-full break-words ${
                item.done ? "line-through text-muted" : "text-foreground"
              }`}
            >
              {item.content}
            </button>
          )}

          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            {showPriority && item.priority > 0 && (
              <button
                type="button"
                onClick={() => void cyclePriority()}
                className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                style={{
                  color: PRIORITY_COLORS[item.priority as 1 | 2 | 3],
                  backgroundColor: `${PRIORITY_COLORS[item.priority as 1 | 2 | 3]}1a`,
                }}
              >
                {t(`card:${item.priority === 1 ? "todo_priority_low" : item.priority === 2 ? "todo_priority_medium" : "todo_priority_high"}`)}
              </button>
            )}
            {item.due && (
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  overdue ? "bg-danger/10 text-danger" : "bg-default-100 text-muted"
                }`}
              >
                {formatDueDate(item.due, locale)}
              </span>
            )}
            {item.tags.map((tag) => (
              <span key={tag} className="text-[10px] text-primary">
                #{tag}
              </span>
            ))}
            {item.subtasks.length > 0 && (
              <span className="text-[10px] text-muted">
                {item.subtasks.filter((s) => s.done).length}/{item.subtasks.length}
              </span>
            )}
          </div>

          {expanded && (
            <div className="mt-2 space-y-2 border-t border-separator/50 pt-2">
              {/* 截止时间 */}
              {showDue && (
              <div className="flex items-center gap-2 text-xs text-muted">
                <span>{t("card:todo_due_date")}</span>
                <input
                  type="date"
                  className="bg-field border border-separator rounded-lg px-2 py-1 text-xs text-foreground"
                  value={item.due ? toDateInput(item.due) : ""}
                  onChange={(e) => {
                    const value = e.target.value;
                    void updateTodoItem(listId, item.id, {
                      due: value ? new Date(`${value}T23:59:59`).getTime() : undefined,
                    });
                  }}
                />
                {item.due && (
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => void updateTodoItem(listId, item.id, { due: undefined })}
                  >
                    {t("common.clear")}
                  </button>
                )}
                {showPriority && (
                  <button
                    type="button"
                    className="ml-auto text-primary hover:underline"
                    onClick={() => void cyclePriority()}
                  >
                    {t("card:todo_change_priority")}
                  </button>
                )}
              </div>
              )}

              {/* 子事项 */}
              <div className="space-y-1">
                {item.subtasks.map((sub) => (
                  <div key={sub.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={sub.done}
                      className="accent-primary"
                      onChange={() =>
                        void updateTodoItem(listId, item.id, {
                          subtasks: item.subtasks.map((s) =>
                            s.id === sub.id ? { ...s, done: !s.done } : s,
                          ),
                        })
                      }
                    />
                    <span className={`text-xs flex-1 ${sub.done ? "line-through text-muted" : ""}`}>
                      {sub.content}
                    </span>
                    <button
                      type="button"
                      className="text-muted hover:text-danger text-xs"
                      onClick={() =>
                        void updateTodoItem(listId, item.id, {
                          subtasks: item.subtasks.filter((s) => s.id !== sub.id),
                        })
                      }
                    >
                      <MorphIcon icon={X} size={12} aria-hidden />
                    </button>
                  </div>
                ))}
                <GlassInput
                  size="sm"
                  value={subtaskDraft}
                  placeholder={t("card:todo_add_subtask")}
                  onChange={(e) => setSubtaskDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && subtaskDraft.trim()) {
                      void updateTodoItem(listId, item.id, {
                        subtasks: [
                          ...item.subtasks,
                          {
                            id: crypto.randomUUID(),
                            content: subtaskDraft.trim(),
                            done: false,
                          },
                        ],
                      });
                      setSubtaskDraft("");
                    }
                  }}
                />
              </div>

              {/* 备注 */}
              <textarea
                rows={2}
                value={item.note ?? ""}
                placeholder={t("card:todo_note_placeholder")}
                onChange={(e) =>
                  void updateTodoItem(listId, item.id, { note: e.target.value })
                }
                className="w-full rounded-lg border border-separator bg-field px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
              />
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded-md text-muted hover:text-danger hover:bg-danger/10 transition-all text-xs shrink-0"
          aria-label={t("common.delete")}
        >
          <MorphIcon icon={X} size={12} aria-hidden />
        </button>
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  const { t } = useTranslation();
  const samples = [
    t("card:todo_empty_sample_1"),
    t("card:todo_empty_sample_2"),
    t("card:todo_empty_sample_3"),
  ];
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
      <MorphIcon icon={Check} size={28} className="text-success" aria-hidden />
      <p className="text-sm text-muted">{t("card:todo_empty_title")}</p>
      <p className="text-xs text-muted/70 max-w-xs">{t("card:todo_empty_hint")}</p>
      <div className="flex flex-wrap gap-1.5 justify-center mt-1">
        {samples.map((sample) => (
          <button
            key={sample}
            type="button"
            onClick={() => onPick(sample)}
            className="px-2.5 py-1 text-xs rounded-full border border-separator text-muted hover:border-primary hover:text-primary transition-all"
          >
            {sample}
          </button>
        ))}
      </div>
    </div>
  );
}

function toDateInput(timestamp: number): string {
  const d = new Date(timestamp);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}
