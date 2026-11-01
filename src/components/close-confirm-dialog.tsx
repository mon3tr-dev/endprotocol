import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GlassAlertDialog, GlassButton } from "@/components/ui/glass";
import { setConfig } from "@/utils/configService";

interface CloseConfirmDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (action: "close" | "minimize_to_tray") => void;
  /**
   * 系统托盘不可用时传 false，隐藏「最小化到托盘」。
   * 没有托盘时隐藏窗口会让用户既看不到窗口也退不掉进程。
   */
  allowMinimize?: boolean;
}

export function CloseConfirmDialog({
  isOpen,
  onOpenChange,
  onConfirm,
  allowMinimize = true,
}: CloseConfirmDialogProps) {
  const { i18n } = useTranslation();
  const [rememberChoice, setRememberChoice] = useState(false);

  const handleAction = async (action: "close" | "minimize_to_tray") => {
    if (rememberChoice) {
      await setConfig("close_action", action);
    }
    onConfirm(action);
    onOpenChange(false);
    setRememberChoice(false);
  };

  return (
    <GlassAlertDialog isOpen={isOpen} onOpenChange={onOpenChange}>
      <GlassAlertDialog.Backdrop>
        <GlassAlertDialog.Container>
          <GlassAlertDialog.Dialog className="sm:max-w-[400px]">
            <GlassAlertDialog.CloseTrigger />
            <GlassAlertDialog.Header>
              <GlassAlertDialog.Icon status="warning" />
              <GlassAlertDialog.Heading>
                {i18n.language === "zh" ? "关闭窗口" : "Close Window"}
              </GlassAlertDialog.Heading>
            </GlassAlertDialog.Header>
            <GlassAlertDialog.Body>
              <p>
                {i18n.language === "zh"
                  ? "请选择关闭方式："
                  : "Choose how to close:"}
              </p>
            </GlassAlertDialog.Body>
            <GlassAlertDialog.Footer>
              <div className="flex flex-col gap-2 w-full">
                <div className="flex gap-2">
                  {allowMinimize && (
                    <GlassButton
                      variant="primary"
                      className="flex-1"
                      onPress={() => handleAction("minimize_to_tray")}
                      startContent={
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                        </svg>
                      }
                    >
                      {i18n.language === "zh" ? "最小化到托盘" : "Minimize to Tray"}
                    </GlassButton>
                  )}
                  <GlassButton
                    variant="danger"
                    className="flex-1"
                    onPress={() => handleAction("close")}
                    startContent={
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    }
                  >
                    {i18n.language === "zh" ? "关闭程序" : "Close Program"}
                  </GlassButton>
                </div>
                <label className="flex items-center gap-2 cursor-pointer text-sm text-muted">
                  <input
                    type="checkbox"
                    checked={rememberChoice}
                    onChange={(e) => setRememberChoice(e.target.checked)}
                    className="rounded border-separator"
                  />
                  {i18n.language === "zh" ? "记住此选择" : "Remember this choice"}
                </label>
              </div>
            </GlassAlertDialog.Footer>
          </GlassAlertDialog.Dialog>
        </GlassAlertDialog.Container>
      </GlassAlertDialog.Backdrop>
    </GlassAlertDialog>
  );
}
