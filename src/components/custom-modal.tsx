import { forwardRef } from "react";
import { GlassModal } from "@/components/ui/modal";
import { CloseIcon } from "@/components/ui/app-icon";
import { useIsBelowSm } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";

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
  const isNarrow = useIsBelowSm();
  // 高度上限用 `dvh`（动态视口高度）：移动端浏览器地址栏收起/展开时
  // `vh` 不会变，弹窗会超出实际可见区域；`dvh` 跟着变。
  const dialogHeightClass =
    height === "fixed"
      ? "!h-[85dvh] sm:!h-[90vh] !max-h-[85dvh] sm:!max-h-[90vh]"
      : "!max-h-[85dvh] sm:!max-h-[90vh]";

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
          {/* 窄屏：底部抽屉贴底（去掉 my-auto 的居中倾向）；
              宽屏：保持 my-auto 让卡片在容器内垂直居中。 */}
          <div className="relative w-full sm:my-auto">
            <GlassModal.Dialog
              className={`!p-0 ${config.widthClass} ${dialogHeightClass} flex flex-col`}
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
  const isNarrow = useIsBelowSm();
  return (
    <GlassModal.Header
      className={`relative flex flex-col shrink-0 ${
        // 窄屏：内边距收紧（抽屉本身贴边，再留 24px 会显得内容被夹在中间），
        // 标题字号降一档，避免长标题把关闭按钮挤出屏幕。
        isNarrow ? "px-4 py-3" : "px-6 py-3.5"
      } border-b border-separator/60 ${className ?? ""}`}
    >
      {/*
       * 窄屏：抽屉顶部的抓手，**独占一行**。
       *
       * 之前它和标题并排在同一个 flex 行里，于是那条短横线紧贴在标题左边
       * （看着像标题前面多了个破折号）。抓手必须是「单独一行、居中」的
       * 装饰条 —— `.mobile-sheet-grip` 自带 `margin: 0.5rem auto 0` 的居中，
       * 但只有在独占一行时才生效。
       */}
      {isNarrow && <span className="mobile-sheet-grip" aria-hidden="true" />}
      <div
        className={cn(
          "flex items-center justify-between w-full",
          isNarrow && "mt-1",
        )}
      >
        <div
          className={
            isNarrow
              ? "flex-1 min-w-0 text-base font-semibold text-foreground truncate"
              : "text-lg font-semibold text-foreground"
          }
        >
          {children}
        </div>
        <div className="flex items-center gap-2 shrink-0">{rightContent}</div>
      </div>
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-1/2 right-3 -translate-y-1/2 p-2 rounded-xl bg-default-50 lg-hoverable transition-all duration-200 text-muted hover:text-foreground active:scale-95"
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
    const isNarrow = useIsBelowSm();
    return (
      <GlassModal.Body
        ref={ref}
        onScroll={onScroll}
        className={`flex-1 min-h-0 overflow-y-auto scroll-touch ${
          isNarrow ? "px-4 py-3" : "px-6 py-4"
        } ${className ?? ""}`}
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
  const isNarrow = useIsBelowSm();
  return (
    <GlassModal.Footer
      className={`flex gap-2 border-t border-separator shrink-0 ${
        // 窄屏：按钮纵向铺满（拇指可达 + 44px 命中区），并吃掉底部安全区，
        // 免得按钮被 Android 手势条压住。
        isNarrow
          ? "flex-col-reverse [&>*]:w-full px-4 pt-3 pb-[calc(0.75rem+var(--safe-area-bottom))]"
          : "items-center justify-end px-6 py-4"
      } ${className ?? ""}`}
    >
      {children}
    </GlassModal.Footer>
  );
};
