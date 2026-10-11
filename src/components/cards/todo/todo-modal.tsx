import {
  CustomModal,
  CustomModalBody,
  CustomModalHeader,
} from "@/components/custom-modal";
import { useTodoLists } from "@/stores/todoStore";
import { TodoDetail } from "./todo-detail";
import { TodoIcon } from "./todo-icon";

interface TodoModalProps {
  isOpen: boolean;
  listId: string | null;
  onClose: () => void;
}

export function TodoModal({ isOpen, listId, onClose }: TodoModalProps) {
  const { lists } = useTodoLists();
  const list = lists.find((l) => l.id === listId) ?? null;
  if (!listId) return null;
  return (
    <CustomModal isOpen={isOpen} onClose={onClose} size="xl" height="fixed">
      <CustomModalHeader onClose={onClose}>
        {list ? (
          <span className="flex items-center gap-2">
            <TodoIcon icon={list.icon} size={18} />
            <span>{list.title}</span>
          </span>
        ) : (
          "To-Do"
        )}
      </CustomModalHeader>
      <CustomModalBody className="!px-4 !py-3">
        <TodoDetail listId={listId} className="h-full" />
      </CustomModalBody>
    </CustomModal>
  );
}
