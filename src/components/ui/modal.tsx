import { createContext, forwardRef, useContext, useEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/* ======================================================
 * GlassModal — Liquid Glass 模态（功能层 regular + clear 遮罩）
 *
 * HIG 依据：模态属于功能层，用 regular 变体（模糊 + 提亮保证正文
 * 可读）；遮罩用 clear 语义的轻模糊 + 35% 暗化，让内容隐约可感而不
 * 抢焦点。出入场：Dialog 位移 + 淡入 + 阴影扩散同步渐进
 * （--lg-dur-slow 280ms / --lg-ease-emphasized）。
 *
 * Usage (compound API, same as before):
 * <GlassModal isOpen onOpenChange>
 *   <GlassModal.Backdrop isDismissable className="z-[100]">
 *     <GlassModal.Container size="md" placement="center" scroll="inside">
 *       <GlassModal.Dialog className="...">
 *         <GlassModal.Header>...</GlassModal.Header>
 *         <GlassModal.Body>...</GlassModal.Body>
 *         <GlassModal.Footer>...</GlassModal.Footer>
 *       </GlassModal.Dialog>
 *     </GlassModal.Container>
 *   </GlassModal.Backdrop>
 * </GlassModal>
 * ====================================================== */

interface ModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  children?: React.ReactNode;
}

interface ModalBackdropProps {
  isDismissable?: boolean;
  variant?: string;
  className?: string;
  children?: React.ReactNode;
}

interface ModalContainerProps {
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "full";
  placement?: "center" | "top" | "bottom";
  scroll?: "inside" | "outside";
  className?: string;
  children?: React.ReactNode;
}

const ModalCtx = createContext<{ close: () => void }>({ close: () => {} });

const CONTAINER_SIZES: Record<NonNullable<ModalContainerProps["size"]>, string> = {
  xs: "max-w-[360px]",
  sm: "max-w-[400px]",
  md: "max-w-[560px]",
  lg: "max-w-[720px]",
  xl: "max-w-[1100px]",
  "2xl": "max-w-[1000px]",
  full: "max-w-[calc(100vw-2rem)]",
};

function GlassModal({ isOpen, onOpenChange, children }: ModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [isOpen, onOpenChange]);

  if (!isOpen) return null;

  return createPortal(
    <ModalCtx.Provider value={{ close: () => onOpenChange(false) }}>{children}</ModalCtx.Provider>,
    document.body,
  );
}

function Backdrop({ isDismissable = true, className, children }: ModalBackdropProps) {
  const { close } = useContext(ModalCtx);
  return (
    <div
      className={cn(
        // lg-scrim：35% 暗化 + 8px 轻模糊（clear 语义），渐入渐出对称
        "lg-scrim fixed inset-0 z-[100] flex items-center justify-center",
        "[animation:lg-fade-in_var(--lg-dur-slow)_var(--lg-ease-emphasized)]",
        className,
      )}
      onMouseDown={(e) => {
        if (isDismissable && e.target === e.currentTarget) close();
      }}
    >
      {children}
    </div>
  );
}

function Container({
  size = "md",
  placement = "center",
  className,
  children,
}: ModalContainerProps) {
  return (
    <div
      className={cn(
        "flex w-full px-4 py-6",
        placement === "center" && "items-center justify-center",
        placement === "top" && "items-start justify-center",
        placement === "bottom" && "items-end justify-center",
        className,
      )}
    >
      <div className={cn("w-full", CONTAINER_SIZES[size])}>{children}</div>
    </div>
  );
}

function Dialog({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className={cn(
        // lg-float-in：translateY(24px)+scale(.96) → 1，阴影同步扩散；
        // 玻璃模糊经 ::before 淡入，无「先硬边后补模糊」的割裂感
        "lg-float-in lg-regular rounded-2xl border border-separator/60",
        className,
      )}
    >
      {children}
    </div>
  );
}

function Header({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <div className={className}>{children}</div>;
}

function Heading({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <h2 className={cn("text-lg font-semibold text-foreground", className)}>{children}</h2>;
}

const Body = forwardRef<HTMLDivElement, { className?: string; children?: React.ReactNode; onScroll?: React.UIEventHandler<HTMLDivElement> }>(
  ({ className, children, onScroll }, ref) => {
    return (
      <div ref={ref} onScroll={onScroll} className={cn("overflow-y-auto", className)}>
        {children}
      </div>
    );
  },
);
Body.displayName = "GlassModalBody";

function Footer({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <div className={className}>{children}</div>;
}

function CloseTrigger({ className }: { className?: string }) {
  const { close } = useContext(ModalCtx);
  return (
    <button
      type="button"
      aria-label="Close"
      onClick={close}
      className={cn(
        "lg-control flex h-8 w-8 items-center justify-center rounded-xl text-muted",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        "[transition:transform_var(--lg-dur-press)_var(--lg-ease-spring),translate_var(--lg-dur-press)_var(--lg-ease-spring),scale_var(--lg-dur-press)_var(--lg-ease-spring),color_var(--lg-dur-fast)_var(--lg-ease-standard)]",
        "hover:text-foreground hover:-translate-y-px active:scale-90",
        className,
      )}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M2 2l10 10M12 2 2 12" />
      </svg>
    </button>
  );
}

const GlassModalWithSub = GlassModal as typeof GlassModal & {
  Backdrop: typeof Backdrop;
  Container: typeof Container;
  Dialog: typeof Dialog;
  Header: typeof Header;
  Heading: typeof Heading;
  Body: typeof Body;
  Footer: typeof Footer;
  CloseTrigger: typeof CloseTrigger;
};

GlassModalWithSub.Backdrop = Backdrop;
GlassModalWithSub.Container = Container;
GlassModalWithSub.Dialog = Dialog;
GlassModalWithSub.Header = Header;
GlassModalWithSub.Heading = Heading;
GlassModalWithSub.Body = Body;
GlassModalWithSub.Footer = Footer;
GlassModalWithSub.CloseTrigger = CloseTrigger;

export { GlassModal, GlassModalWithSub as GlassModalCompound };
export type { ModalProps as GlassModalProps };

/* ======================================================
 * GlassAlertDialog — Alert/confirm dialog（同一玻璃语言）
 * ====================================================== */

interface AlertDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  children?: React.ReactNode;
}

const AlertDialogCtx = createContext<{ close: () => void }>({ close: () => {} });

function GlassAlertDialog({ isOpen, onOpenChange, children }: AlertDialogProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [isOpen, onOpenChange]);

  if (!isOpen) return null;

  return createPortal(
    <AlertDialogCtx.Provider value={{ close: () => onOpenChange(false) }}>
      {children}
    </AlertDialogCtx.Provider>,
    document.body,
  );
}

function AlertDialogBackdrop({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <div
      className={cn(
        "lg-scrim fixed inset-0 z-[100] flex items-center justify-center p-4",
        "[animation:lg-fade-in_var(--lg-dur-slow)_var(--lg-ease-emphasized)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

function AlertDialogContainer({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <div className={cn("w-full max-w-[400px]", className)}>{children}</div>;
}

function AlertDialogDialog({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      className={cn(
        "lg-float-in lg-regular rounded-2xl border border-separator/60 p-5",
        className,
      )}
    >
      {children}
    </div>
  );
}

const ICON_TONES: Record<string, string> = {
  success: "bg-success text-white",
  warning: "bg-warning text-white",
  danger: "bg-danger text-white",
  // primary 是用户可自定义的主题色，前景取 --primary-foreground（按亮度自动选）
  info: "bg-primary text-primary-foreground",
  default: "bg-default-400 text-white",
};

function AlertDialogIcon({ status = "info", className }: { status?: string; className?: string }) {
  return (
    <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", ICON_TONES[status] ?? ICON_TONES.info, className)}>
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7.5 4.5v4M7.5 10.5h.01" />
        <circle cx="7.5" cy="7.5" r="6.2" />
      </svg>
    </span>
  );
}

function AlertDialogHeader({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <div className={cn("flex items-center gap-3", className)}>{children}</div>;
}

function AlertDialogHeading({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <h2 className={cn("text-lg font-semibold text-foreground", className)}>{children}</h2>;
}

function AlertDialogBody({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <div className={cn("mt-3 text-sm text-muted", className)}>{children}</div>;
}

function AlertDialogFooter({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <div className={cn("mt-5 flex items-center justify-end gap-2", className)}>{children}</div>;
}

function AlertDialogCloseTrigger({ className }: { className?: string }) {
  const { close } = useContext(AlertDialogCtx);
  return (
    <button
      type="button"
      aria-label="Close"
      onClick={close}
      className={cn(
        "lg-control absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-xl text-muted",
        "[transition:transform_var(--lg-dur-press)_var(--lg-ease-spring),translate_var(--lg-dur-press)_var(--lg-ease-spring),scale_var(--lg-dur-press)_var(--lg-ease-spring),color_var(--lg-dur-fast)_var(--lg-ease-standard)]",
        "hover:text-foreground hover:-translate-y-px active:scale-90",
        className,
      )}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M2 2l10 10M12 2 2 12" />
      </svg>
    </button>
  );
}

const GlassAlertDialogWithSub = GlassAlertDialog as typeof GlassAlertDialog & {
  Backdrop: typeof AlertDialogBackdrop;
  Container: typeof AlertDialogContainer;
  Dialog: typeof AlertDialogDialog;
  Icon: typeof AlertDialogIcon;
  Header: typeof AlertDialogHeader;
  Heading: typeof AlertDialogHeading;
  Body: typeof AlertDialogBody;
  Footer: typeof AlertDialogFooter;
  CloseTrigger: typeof AlertDialogCloseTrigger;
};

GlassAlertDialogWithSub.Backdrop = AlertDialogBackdrop;
GlassAlertDialogWithSub.Container = AlertDialogContainer;
GlassAlertDialogWithSub.Dialog = AlertDialogDialog;
GlassAlertDialogWithSub.Icon = AlertDialogIcon;
GlassAlertDialogWithSub.Header = AlertDialogHeader;
GlassAlertDialogWithSub.Heading = AlertDialogHeading;
GlassAlertDialogWithSub.Body = AlertDialogBody;
GlassAlertDialogWithSub.Footer = AlertDialogFooter;
GlassAlertDialogWithSub.CloseTrigger = AlertDialogCloseTrigger;

export { GlassAlertDialog, GlassAlertDialogWithSub as GlassAlertDialogCompound };
export type { AlertDialogProps as GlassAlertDialogProps };
