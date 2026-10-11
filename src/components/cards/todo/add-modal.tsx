import { useTranslation } from "react-i18next";
import { GlassCard } from "@/components/ui/glass";
import {
  CustomModal,
  CustomModalBody,
  CustomModalHeader,
} from "@/components/custom-modal";
import { TODO_TEMPLATES } from "@/types/todo";
import { TodoIcon } from "./todo-icon";
import { useTodoLists } from "@/stores/todoStore";

export type TodoAddChoice =
  | { type: "existing"; listId: string }
  | { type: "create"; templateId: string };
interface TodoAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (choice: TodoAddChoice) => void;
}

/**
 * 添加 To-Do 卡片时选择已有列表，或从模板创建新列表。
 */
export function TodoAddModal({ isOpen, onClose, onConfirm }: TodoAddModalProps) {
  const { t } = useTranslation();
  const { lists } = useTodoLists();

  return (
    <CustomModal isOpen={isOpen} onClose={onClose} size="md" height="fixed">
      <CustomModalHeader onClose={onClose}>
        {t("card:todo_new_from_template")}
      </CustomModalHeader>
      <CustomModalBody>
        <div className="space-y-5">
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
              {t("card:todo_choose_existing")}
            </h3>
            {lists.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {lists.map((list) => (
                  <GlassCard
                    key={list.id}
                    isPressable
                    onPress={() => onConfirm({ type: "existing", listId: list.id })}
                    className="p-3 cursor-pointer border-2 border-transparent hover:border-primary/50 transition-all"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="flex shrink-0 text-primary">
                        <TodoIcon icon={list.icon} size={20} />
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">
                          {list.title || t("card:todo_untitled")}
                        </div>
                        <div className="text-[11px] text-muted truncate">
                          {t("card:todo_item_count", { count: list.items.length })}
                        </div>
                      </div>
                    </div>
                  </GlassCard>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted">
                {t("card:todo_no_existing_lists")}
              </p>
            )}
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
              {t("card:todo_create_new")}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {TODO_TEMPLATES.map((tpl) => (
                <GlassCard
                  key={tpl.id}
                  isPressable
                  onPress={() => onConfirm({ type: "create", templateId: tpl.id })}
                  className="p-3 cursor-pointer border-2 border-transparent hover:border-primary/50 transition-all"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="flex shrink-0 text-primary">
                      <TodoIcon icon={tpl.icon} size={20} />
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {t(`card:${tpl.labelKey}`)}
                      </div>
                      <div className="text-[11px] text-muted truncate">
                        {tpl.items.length > 0
                          ? tpl.items
                              .slice(0, 2)
                              .map((key) => t(`card:${key}`))
                              .join(" · ")
                          : t("card:todo_template_blank_desc")}
                      </div>
                    </div>
                  </div>
                </GlassCard>
              ))}
            </div>
          </section>
        </div>
      </CustomModalBody>
    </CustomModal>
  );
}
