import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { GlassButton, GlassChip, GlassInput, GlassProgressCircle } from "@/components/ui/glass";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { CardConfigService } from "@/utils/cardConfigService";
import type { BaseCardProps } from "../registry/types";
import type { TodoCardSettings } from "@/types/card-settings";
import {
  addTodoItem,
  clearCompleted,
  deleteTodoItem,
  duplicateTodoList,
  deleteTodoList,
  isOverdue,
  toggleTodoItem,
  undoLastDelete,
  updateTodoList,
  useTodoLists,
} from "@/stores/todoStore";
import { formatDueDate, parseQuickAdd } from "./quick-add";
import { TodoModal } from "./todo-modal";
import { TodoListSettingsModal } from "./list-settings-modal";
import { TodoIcon } from "./todo-icon";
import { MorphIcon } from "morphicons/react";
import { X } from "lucide";
import { TodoAddModal, type TodoAddChoice } from "./add-modal";
import { createTodoListFromTemplate } from "@/utils/todoTemplateService";
import { logError } from "@/utils/logger";

export default function TodoCard({ cardId, settings }: BaseCardProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { lists } = useTodoLists();
  const [listId, setListId] = useState<string | null>(
    (settings as TodoCardSettings | undefined)?.listId ?? null,
  );
  const [draft, setDraft] = useState("");
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isListPickerOpen, setIsListPickerOpen] = useState(false);
  const [undoVisible, setUndoVisible] = useState(false);

  const list = useMemo(
    () => lists.find((l) => l.id === listId) ?? null,
    [lists, listId],
  );

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { cardId: string; action: string }
        | undefined;
      if (detail?.cardId !== cardId) return;
      switch (detail.action) {
        case "todo-edit":
          setIsEditOpen(true);
          break;
        case "todo-open-page":
          if (list) navigate(`/todo?list=${listId}`);
          else setIsListPickerOpen(true);
          break;
        case "todo-rename":
        case "todo-color-icon":
        case "todo-sort":
          setIsSettingsOpen(true);
          break;
        case "todo-duplicate":
          if (listId) void duplicateTodoList(listId);
          break;
        case "todo-hide-completed":
          if (list) void updateTodoList(list.id, { hideCompleted: !list.hideCompleted });
          break;
        case "todo-clear-completed":
          if (list) {
            void clearCompleted(list.id).then((count) => {
              if (count > 0) flashUndo();
            });
          }
          break;
        case "todo-delete-list":
          if (list) {
            void confirmDialog({
              title: t("card:todo_delete_list"),
              body: t("card:todo_delete_list_confirm"),
              confirmText: t("common.delete"),
              cancelText: t("common.cancel"),
              tone: "danger",
            }).then((ok) => {
              if (ok) void deleteTodoList(list.id);
            });
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener("cardAction", handler);
    return () => window.removeEventListener("cardAction", handler);
  }, [cardId, listId, list, navigate, t]);

  const flashUndo = () => {
    setUndoVisible(true);
    window.setTimeout(() => setUndoVisible(false), 8000);
  };

  const handleListChoice = async (choice: TodoAddChoice) => {
    try {
      const nextListId =
        choice.type === "existing"
          ? choice.listId
          : (await createTodoListFromTemplate(choice.templateId, t)).id;
      await CardConfigService.saveCardSettings(cardId, { listId: nextListId });
      setListId(nextListId);
      setIsListPickerOpen(false);
    } catch (error) {
      logError("Failed to bind todo card to list:", error);
    }
  };

  const handleAdd = async () => {
    if (!list) return;
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

  if (!list) {
    return (
      <>
        <div className="glass-surface border border-separator/90 h-full w-full rounded-[10px] flex flex-col items-center justify-center gap-2 p-3 text-center">
          <TodoIcon icon="file" size={28} className="text-muted" />
          <span className="text-xs text-muted">{t("card:todo_no_list")}</span>
          <GlassButton
            size="sm"
            variant="secondary"
            onPress={() => setIsListPickerOpen(true)}
          >
            {t("card:todo_choose_or_create_list")}
          </GlassButton>
        </div>
        <TodoAddModal
          isOpen={isListPickerOpen}
          onClose={() => setIsListPickerOpen(false)}
          onConfirm={(choice) => void handleListChoice(choice)}
        />
      </>
    );
  }

  const total = list.items.length;
  const done = list.items.filter((i) => i.done).length;
  const progress = total === 0 ? 0 : Math.round((done / total) * 100);
  const overdueCount = list.items.filter(isOverdue).length;
  const visible = list.items
    .filter((item) => !(list.hideCompleted && item.done))
    .slice()
    .sort((a, b) => Number(a.done) - Number(b.done));

  return (
    <>
      <div className="glass-surface border border-separator/90 h-full w-full select-none rounded-[10px] overflow-hidden flex flex-col">
        <div className="flex items-center gap-2 px-2.5 pt-2.5 pb-1.5 shrink-0">
          <TodoIcon icon={list.icon} size={18} className="shrink-0 text-primary" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold truncate">
                {list.title || t("card:todo_untitled")}
              </span>
              {overdueCount > 0 && (
                <GlassChip color="danger" size="sm">
                  {overdueCount}
                </GlassChip>
              )}
            </div>
            <span className="text-[10px] text-muted">
              {done}/{total}
            </span>
          </div>
          <div className="relative shrink-0" style={{ color: list.color ?? "#6366f1" }}>
            <GlassProgressCircle value={progress} size={32} aria-label="progress">
              <GlassProgressCircle.Track>
                <GlassProgressCircle.TrackCircle />
                <GlassProgressCircle.FillCircle />
              </GlassProgressCircle.Track>
            </GlassProgressCircle>
            <span className="absolute inset-0 flex items-center justify-center text-[9px] font-semibold text-foreground">
              {progress}%
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIsEditOpen(true)}
            className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-muted hover:text-foreground hover:bg-default-100 transition-colors"
            aria-label={t("card:todo_edit_modal")}
            title={t("card:todo_edit_modal")}
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
            </svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-2 space-y-0.5">
          {visible.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <span className="text-[11px] text-muted">
                {t("card:todo_card_empty")}
              </span>
            </div>
          ) : (
            visible.map((item) => (
              <div key={item.id} className="group flex items-center gap-1.5 py-0.5">
                <button
                  type="button"
                  onClick={() => void toggleTodoItem(list.id, item.id)}
                  className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-all ${
                    item.done
                      ? "bg-primary border-primary text-white"
                      : "border-default-400 hover:border-primary"
                  }`}
                  aria-label={item.done ? t("card:todo_undo_done") : t("card:todo_mark_done")}
                >
                  {item.done && (
                    <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                      <path d="M2.5 6.2 5 8.7l4.5-5.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  )}
                </button>
                <span
                  className={`flex-1 min-w-0 text-xs truncate ${
                    item.done ? "line-through text-muted" : "text-foreground"
                  }`}
                  title={item.content}
                >
                  {item.content}
                </span>
                {item.due && (
                  <span
                    className={`text-[9px] shrink-0 ${
                      isOverdue(item) ? "text-danger" : "text-muted"
                    }`}
                  >
                    {formatDueDate(item.due, i18n.language)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    void deleteTodoItem(list.id, item.id).then(flashUndo);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-muted hover:text-danger text-[10px] shrink-0"
                  aria-label={t("common.delete")}
                >
                  <MorphIcon icon={X} size={12} aria-hidden />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="px-2 pb-2 pt-1 shrink-0">
          <GlassInput
            size="sm"
            value={draft}
            placeholder={t("card:todo_card_quick_add")}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleAdd();
              }
            }}
          />
          <div className="flex items-center justify-between mt-1">
            <button
              type="button"
              onClick={() => navigate(`/todo?list=${list.id}`)}
              className="text-[10px] text-primary hover:underline"
            >
              {t("card:todo_open_page")}
            </button>
            {undoVisible && (
              <button
                type="button"
                onClick={() => void undoLastDelete().then(() => setUndoVisible(false))}
                className="text-[10px] text-primary hover:underline"
              >
                {t("card:todo_undo")}
              </button>
            )}
          </div>
        </div>
      </div>

      <TodoModal
        isOpen={isEditOpen}
        listId={list.id}
        onClose={() => setIsEditOpen(false)}
      />
      <TodoListSettingsModal
        isOpen={isSettingsOpen}
        listId={list.id}
        onClose={() => setIsSettingsOpen(false)}
      />
    </>
  );
}
