import { forwardRef } from "react";
import { GlassModal } from "@/components/ui/modal";
import { CloseIcon } from "@/components/ui/app-icon";

type ModalSize = "xs" | "sm" | "md" | "lg" | "full" | "cover";

/**
 * 应用级 Modal 兼容层
 * 基于自定义 GlassModal（液态玻璃），保留向后兼容的 size 语义
 */
const SIZE_CONFIG: Record<
  string,
  { size: "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "full"; widthClass: string }
> = {
  sm: { size: "sm", widthClass: "w-full" },
  md: { size: "md", widthClass: "w-full" },
  lg: { size: "lg", widthClass: "w-full" },
  xl: { size: "xl", widthClass: "w-full" }, // 宽屏 — 角色详情/选人
  "2xl": { size: "2xl", widthClass: "w-full" }, // 宽屏 — 账户切换
  "3xl": { size: "2xl", widthClass: "w-full" },
  "4xl": { size: "2xl", widthClass: "w-full" },
  "5xl": { size: "2xl", widthClass: "w-full" },
};

interface CustomModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  size?: keyof typeof SIZE_CONFIG;
  /** 锁定点击背景关闭 */
  disableBackdropClick?: boolean;
  /** 是否使用固定高度（用于长内容） */
  height?: "auto" | "fixed";
}

export const CustomModal: React.FC<CustomModalProps> = ({
  isOpen,
  onClose,
  children,
  size = "md",
  disableBackdropClick = false,
  height = "auto",
}) => {
  const config = SIZE_CONFIG[size] ?? SIZE_CONFIG.md;
  const dialogHeightClass =
    height === "fixed"
      ? "!h-[90vh] !max-h-[90vh]"
      : "!max-h-[90vh]";

  return (
    <GlassModal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <GlassModal.Backdrop
        isDismissable={!disableBackdropClick}
        className="z-[100]"
      >
        <GlassModal.Container
          size={config.size}
          placement="center"
          scroll="inside"
        >
          <div className="relative w-full my-auto">
            <GlassModal.Dialog
              className={`rounded-2xl !p-0 ${config.widthClass} ${dialogHeightClass} flex flex-col`}
            >
              {children}
            </GlassModal.Dialog>
          </div>
        </GlassModal.Container>
      </GlassModal.Backdrop>
    </GlassModal>
  );
};

interface ModalHeaderProps {
  children: React.ReactNode;
  onClose?: () => void;
  rightContent?: React.ReactNode;
  className?: string;
}

export const CustomModalHeader: React.FC<ModalHeaderProps> = ({
  children,
  onClose,
  rightContent,
  className,
}) => {
  return (
    <GlassModal.Header
      className={`relative flex items-center justify-between border-b border-separator/60 px-6 py-3.5 shrink-0 ${className ?? ""}`}
    >
      <div className="text-lg font-semibold text-foreground">{children}</div>
      <div className="flex items-center gap-2">{rightContent}</div>
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-1/2 right-3 -translate-y-1/2 p-1.5 rounded-xl bg-default-50 lg-hoverable transition-all duration-200 text-muted hover:text-foreground hover:scale-105 active:scale-95"
          aria-label="Close"
        >
          <CloseIcon size={18} />
        </button>
      )}
    </GlassModal.Header>
  );
};

interface ModalBodyProps {
  children: React.ReactNode;
  className?: string;
  onScroll?: React.UIEventHandler<HTMLDivElement>;
}

export const CustomModalBody = forwardRef<HTMLDivElement, ModalBodyProps>(
  ({ children, className, onScroll }, ref) => {
    return (
      <GlassModal.Body
        ref={ref}
        onScroll={onScroll}
        className={`flex-1 min-h-0 px-6 py-4 overflow-y-auto ${className ?? ""}`}
      >
        {children}
      </GlassModal.Body>
    );
  },
);
CustomModalBody.displayName = "CustomModalBody";

interface ModalFooterProps {
  children: React.ReactNode;
  className?: string;
}

export const CustomModalFooter: React.FC<ModalFooterProps> = ({
  children,
  className,
}) => {
  return (
    <GlassModal.Footer
      className={`flex items-center justify-end gap-2 px-6 py-4 border-t border-separator shrink-0 ${className ?? ""}`}
    >
      {children}
    </GlassModal.Footer>
  );
};
