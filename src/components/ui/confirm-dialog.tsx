import { useState, useCallback, useEffect } from "react";
import { GlassAlertDialog, GlassButton, GlassModal } from "@/components/ui/glass";

type ConfirmTone = "primary" | "danger" | "warning";

interface ConfirmOptions {
  title: string;
  body?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  tone?: ConfirmTone;
}

let externalHandler: ((opts: ConfirmOptions) => Promise<boolean>) | null = null;

/** 编程式触发确认弹窗(替代 window.confirm) */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return externalHandler ? externalHandler(opts) : Promise.resolve(false);
}

/** 挂载的 Host 组件 */
export function ConfirmDialogHost() {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [resolveFn, setResolveFn] = useState<((v: boolean) => void) | null>(
    null,
  );

  const handler = useCallback(
    (o: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setOpts(o);
        setOpen(true);
        setResolveFn(() => resolve);
      }),
    [],
  );

  useEffect(() => {
    externalHandler = handler;
    return () => {
      if (externalHandler === handler) externalHandler = null;
    };
  }, [handler]);

  const close = (value: boolean) => {
    setOpen(false);
    resolveFn?.(value);
    setResolveFn(null);
  };

  if (!opts) return null;

  const variant = opts.tone === "danger" ? "danger" : "primary";

  return (
    <GlassModal
      isOpen={open}
      onOpenChange={(o) => !o && close(false)}
    >
      <GlassModal.Backdrop variant="blur" className="z-[100]">
        <GlassModal.Container size="sm" placement="center" scroll="outside">
          <GlassModal.Dialog className="border border-separator/60 p-0">
            <GlassModal.Header className="px-6 pt-4 pb-2">
              <GlassModal.Heading>{opts.title}</GlassModal.Heading>
            </GlassModal.Header>
            <GlassModal.Body className="px-6 py-2 pb-4">{opts.body}</GlassModal.Body>
            <GlassModal.Footer className="flex items-center justify-end gap-2 px-6 py-3.5 border-t border-separator">
              <GlassButton variant="tertiary" onPress={() => close(false)}>
                {opts.cancelText ?? "Cancel"}
              </GlassButton>
              <GlassButton variant={variant} onPress={() => close(true)}>
                {opts.confirmText ?? "Confirm"}
              </GlassButton>
            </GlassModal.Footer>
          </GlassModal.Dialog>
        </GlassModal.Container>
      </GlassModal.Backdrop>
    </GlassModal>
  );
}

/** 开发者模式警告 - 复用 AlertDialog 风格 */
interface DevWarningDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  title: string;
  body: string;
  confirmText: string;
  cancelText: string;
}

export function DevWarningDialog({
  isOpen,
  onOpenChange,
  onConfirm,
  title,
  body,
  confirmText,
  cancelText,
}: DevWarningDialogProps) {
  return (
    <GlassAlertDialog isOpen={isOpen} onOpenChange={onOpenChange}>
      <GlassAlertDialog.Backdrop>
        <GlassAlertDialog.Container>
          <GlassAlertDialog.Dialog className="sm:max-w-[400px]">
            <GlassAlertDialog.CloseTrigger />
            <GlassAlertDialog.Header>
              <GlassAlertDialog.Icon status="warning" />
              <GlassAlertDialog.Heading>{title}</GlassAlertDialog.Heading>
            </GlassAlertDialog.Header>
            <GlassAlertDialog.Body>
              <p>{body}</p>
            </GlassAlertDialog.Body>
            <GlassAlertDialog.Footer>
              <GlassButton
                variant="tertiary"
                onPress={() => onOpenChange(false)}
              >
                {cancelText}
              </GlassButton>
              <GlassButton
                variant="primary"
                onPress={() => {
                  onConfirm();
                  onOpenChange(false);
                }}
              >
                {confirmText}
              </GlassButton>
            </GlassAlertDialog.Footer>
          </GlassAlertDialog.Dialog>
        </GlassAlertDialog.Container>
      </GlassAlertDialog.Backdrop>
    </GlassAlertDialog>
  );
}
