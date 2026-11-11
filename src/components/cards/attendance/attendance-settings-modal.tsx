import { useState, useEffect, useMemo } from "react";
import { GlassButton, GlassProgressCircle, GlassSwitch } from "@/components/ui/glass";
import {
  CustomModal,
  CustomModalHeader,
  CustomModalBody,
  CustomModalFooter,
} from "@/components/custom-modal";
import { useTranslation } from "react-i18next";
import { getAccounts, type Account } from "@/utils/accountService";
import { Img } from "@/utils/imageLoader";
import { resolveServerLabel } from "@/types";
import { AccountNameLine } from "@/components/ui/game-badge";
import { logError } from "@/utils/logger";

interface AttendanceSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedRoleId: string | undefined;
  autoSign: boolean;
  showAutoSign?: boolean;
  onSave: (selectedRoleId: string | undefined, autoSign: boolean) => void;
}

export function AttendanceSettingsModal({
  isOpen,
  onClose,
  selectedRoleId,
  autoSign,
  showAutoSign = true,
  onSave,
}: AttendanceSettingsModalProps) {
  const { t, i18n } = useTranslation();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [localSelectedRoleId, setLocalSelectedRoleId] = useState<string | undefined>(selectedRoleId);
  const [localAutoSign, setLocalAutoSign] = useState(autoSign);

  useEffect(() => {
    if (!isOpen) return;
    setLocalSelectedRoleId(selectedRoleId);
    setLocalAutoSign(autoSign);
    setLoading(true);

    getAccounts()
      .then((accs) => {
        const valid = accs.filter((a) => a.status === "online" || a.status === "offline");
        setAccounts(valid);

        if (!localSelectedRoleId && valid.length > 0) {
          setLocalSelectedRoleId(valid[0].id);
        }
      })
      .catch((e) => {
        logError("[AttendanceSettings] Failed to load accounts:", e);
        setAccounts([]);
      })
      .finally(() => setLoading(false));
  }, [isOpen]);

  const sortedAccounts = useMemo(() => {
    const sorted = [...accounts];
    if (localSelectedRoleId) {
      const idx = sorted.findIndex((a) => a.id === localSelectedRoleId);
      if (idx > 0) {
        const [item] = sorted.splice(idx, 1);
        sorted.unshift(item);
      }
    }
    return sorted;
  }, [accounts, localSelectedRoleId]);

  const handleConfirm = () => {
    onSave(localSelectedRoleId, localAutoSign);
    onClose();
  };

  const handleClose = () => {
    onClose();
  };

  const lang = i18n.language;

  return (
    <CustomModal isOpen={isOpen} onClose={handleClose} size="sm">
      <CustomModalHeader onClose={handleClose}>
        {t("card:attendance_settings")}
      </CustomModalHeader>
      <CustomModalBody>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <GlassProgressCircle isIndeterminate size="md" aria-label="Loading" className="text-primary">
              <GlassProgressCircle.Track>
                <GlassProgressCircle.TrackCircle />
                <GlassProgressCircle.FillCircle />
              </GlassProgressCircle.Track>
            </GlassProgressCircle>
          </div>
        ) : accounts.length === 0 ? (
          <div className="text-center py-6">
            <svg className="w-12 h-12 text-muted mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <p className="text-muted text-sm">{t("common.no_data")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {showAutoSign && (
              <div className="flex items-center justify-between pb-2 border-b border-separator">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{t("card:attendance_auto_sign")}</p>
                  <p className="text-xs text-muted">{t("card:attendance_auto_sign_desc")}</p>
                </div>
                <GlassSwitch
                  isSelected={localAutoSign}
                  onValueChange={setLocalAutoSign}
                >
                  <GlassSwitch.Control>
                    <GlassSwitch.Thumb />
                  </GlassSwitch.Control>
                </GlassSwitch>
              </div>
            )}

            <div>
              <p className="text-xs text-muted mb-2 font-medium">
                {t("card:attendance_select_account")}
              </p>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {sortedAccounts.map((acc) => {
                  const isSelected = localSelectedRoleId === acc.id;
                  return (
                    <div
                      key={acc.id}
                      className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all border-2 ${
                        isSelected
                          ? "border-primary bg-primary-50 dark:bg-primary-900/40 shadow-sm"
                          : "border-separator hover:border-primary/50 lg-hoverable-soft"
                      }`}
                      onClick={() => setLocalSelectedRoleId(acc.id)}
                    >
                      <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0">
                        {acc.avatar ? (
                          <Img
                            src={acc.avatar}
                            alt={acc.nickname}
                            className="w-full h-full avatar-feather"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-muted text-sm font-semibold">
                            {acc.nickname.charAt(0)}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        {/* 徽标紧跟名字、垂直居中；行尾留给选中勾 */}
                        <div className="flex items-center gap-1.5 min-w-0">
                          <div className="text-sm font-medium min-w-0">
                            <AccountNameLine game={acc.game}>{acc.nickname}</AccountNameLine>
                          </div>
                          {isSelected && (
                            <svg className="ml-auto w-4 h-4 text-primary-text shrink-0" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                            </svg>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted">
                          <span>{resolveServerLabel(acc.server, lang)}</span>
                          <span>Lv.{acc.level}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </CustomModalBody>
      <CustomModalFooter>
        <GlassButton variant="secondary" onPress={handleClose}>
          {t("common.cancel")}
        </GlassButton>
        <GlassButton
          variant="primary"
          isDisabled={!localSelectedRoleId}
          onPress={handleConfirm}
        >
          {t("common.confirm")}
        </GlassButton>
      </CustomModalFooter>
    </CustomModal>
  );
}
