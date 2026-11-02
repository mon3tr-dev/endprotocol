import { useCallback, useEffect, useMemo, useState } from "react";
import { GlassButton, GlassCard, GlassProgressCircle } from "@/components/ui/glass";
import { useTranslation } from "react-i18next";
import { BaseCardProps } from "../registry/types";
import { useCardData } from "../base/use-card-data";
import { roleDataService } from "@/utils/roleDataService";
import { CardConfigService } from "@/utils/cardConfigService";
import { getAccounts } from "@/utils/accountService";
import { useImageRequest, usePinImages } from "@/utils/imageCacheManager";
import { AccountAvatar } from "@/components/ui/account-avatar";
import { logError } from "@/utils/logger";
import { resolveServerLabel } from "@/types";
import {
  CustomModal,
  CustomModalHeader,
  CustomModalBody,
  CustomModalFooter,
} from "@/components/custom-modal";
import type { Account } from "@/utils/accountService";
import type { AccountInfoCardSettings } from "@/types/card-settings";

export interface AccountBaseInfo {
  serverName?: string;
  roleId?: string;
  name?: string;
  createTime?: string;
  saveTime?: string;
  lastLoginTime?: string;
  exp?: number;
  level?: number;
  worldLevel?: number;
  gender?: number;
  avatarUrl?: string;
  mainMission?: { id: string; description: string };
  charNum?: number;
  weaponNum?: number;
  docNum?: number;
}

function formatDate(ts: string): string {
  if (!ts) return "";
  const num = parseInt(ts, 10);
  if (isNaN(num)) return ts;
  const d = new Date(num * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function AccountInfoCard({
  roleId: defaultRoleId,
  cardId,
  settings,
}: BaseCardProps) {
  const { t, i18n } = useTranslation();
  const [customRoleId, setCustomRoleId] = useState<string | undefined>(
    (settings as AccountInfoCardSettings)?.roleId,
  );
  const [isRoleSelectOpen, setIsRoleSelectOpen] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [copied, setCopied] = useState(false);

  const effectiveRoleId = customRoleId ?? defaultRoleId;

  const { data: base, isLoading } = useCardData<AccountBaseInfo>({
    fetchData: () => roleDataService.getBaseInfo(effectiveRoleId),
    reloadKey: effectiveRoleId,
  });

  const loadSettings = useCallback(async () => {
    try {
      const s = await CardConfigService.getCardSettings<AccountInfoCardSettings>(cardId);
      if (s.roleId) {
        setCustomRoleId(s.roleId);
      }
    } catch (error) {
      logError("Failed to load account info settings:", error);
    }
  }, [cardId]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const loadAccounts = useCallback(async () => {
    try {
      const accs = await getAccounts();
      setAccounts(accs);
    } catch (error) {
      logError("Failed to load accounts:", error);
    }
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts, effectiveRoleId]);

  const currentAccount = useMemo(
    () => accounts.find((a) => a.id === effectiveRoleId) ?? null,
    [accounts, effectiveRoleId],
  );

  const avatarSrc = currentAccount?.avatar || base?.avatarUrl || "";

  const avatarPaths = useMemo(() => {
    return avatarSrc ? [avatarSrc] : [];
  }, [avatarSrc]);
  useImageRequest(avatarPaths, [avatarPaths]);
  usePinImages(avatarPaths);

  const uid = base?.roleId || "";

  const handleCopyUid = useCallback(async () => {
    if (!uid) return;
    try {
      await navigator.clipboard.writeText(uid);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      logError("Failed to copy UID:", error);
    }
  }, [uid]);

  const openAccountSelect = useCallback(async () => {
    try {
      const accs = await getAccounts();
      setAccounts(accs);
      setIsRoleSelectOpen(true);
    } catch (err) {
      logError("Failed to load accounts:", err);
    }
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { cardId: string; action: string } | undefined;
      if (detail?.cardId === cardId && detail?.action === "change-role") {
        openAccountSelect();
      }
    };
    window.addEventListener("cardAction", handler);
    return () => window.removeEventListener("cardAction", handler);
  }, [cardId, openAccountSelect]);

  const handleRoleConfirm = async (newRoleId: string) => {
    setCustomRoleId(newRoleId);
    setIsRoleSelectOpen(false);
    try {
      await CardConfigService.saveCardSettings(cardId, {
        roleId: newRoleId,
      } as AccountInfoCardSettings);
    } catch (error) {
      logError("Failed to save roleId:", error);
    }
  };

  if (isLoading) {
    return (
      <GlassCard className="p-6  border border-separator/90 h-full w-full flex items-center justify-center">
        <GlassProgressCircle isIndeterminate size="md" aria-label="Loading" className="text-primary-text">
          <GlassProgressCircle.Track>
            <GlassProgressCircle.TrackCircle />
            <GlassProgressCircle.FillCircle />
          </GlassProgressCircle.Track>
        </GlassProgressCircle>
      </GlassCard>
    );
  }

  if (!base) {
    return (
      <GlassCard className="p-6  border border-separator/90 h-full w-full flex items-center justify-center">
        <p className="text-muted text-center text-sm">{t("card:no_data")}</p>
      </GlassCard>
    );
  }

  const stats = [
    { label: t("card:account_info_explore_level"), value: base.worldLevel },
    { label: t("card:account_info_char_num"), value: base.charNum },
    { label: t("card:account_info_weapon_num"), value: base.weaponNum },
    { label: t("card:account_info_doc_num"), value: base.docNum },
  ];

  return (
    <>
      <GlassCard
        className="p-2.5  border border-separator/90 h-full w-full select-none rounded-[10px] overflow-hidden flex flex-col"
      >
        <div className="flex items-start gap-2.5">
          <AccountAvatar
            src={avatarSrc}
            alt={base.name ?? ""}
            size="lg"
            className="rounded-lg border border-separator"
          />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1 min-w-0">
              <span className="text-sm font-semibold text-foreground truncate">
                {base.name || t("common.unknown")}
              </span>
              <button
                type="button"
                onClick={openAccountSelect}
                title={t("card:account_info_switch_account")}
                aria-label={t("card:account_info_switch_account")}
                className="shrink-0 w-5 h-5 flex items-center justify-center rounded-md text-muted hover:text-foreground lg-hoverable transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
                </svg>
              </button>
            </div>
            <div className="text-[10px] text-muted truncate">
              {t("card:account_info_awaken_day")}: {formatDate(base.createTime ?? "")}
            </div>
          </div>

          <div className="shrink-0 flex items-center gap-1 pt-0.5">
            <span className="text-xs text-foreground font-mono truncate max-w-[110px]">
              {uid}
            </span>
            <button
              type="button"
              onClick={handleCopyUid}
              title={t("card:account_info_copy")}
              className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-muted hover:text-foreground lg-hoverable transition-colors"
              aria-label={t("card:account_info_copy")}
            >
              {copied ? (
                <svg className="w-3.5 h-3.5 text-success-text" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                  <rect x="9" y="9" width="11" height="11" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </button>
          </div>
        </div>

        <div className="mt-2 flex-1 flex items-center justify-between gap-2 min-h-0">
          {base.mainMission?.description && (
            <div className="min-w-0 flex-1">
              <div className="text-[11px] text-default-500">
                {t("card:account_info_main_mission")}
              </div>
              <div className="text-[11px] font-medium text-foreground truncate">
                {base.mainMission.description}
              </div>
            </div>
          )}
          {base.level != null && (
            <div className="shrink-0 flex flex-col items-end gap-0.5">
              <span className="text-[11px] text-muted">
                {t("card:account_info_level")}
              </span>
              <span className="text-[11px] font-medium text-primary-text">
                LEVEL {base.level}
              </span>
            </div>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between gap-2 border-t border-separator/60 pt-1.5">
          {stats.map((s, idx) => (
            <div key={idx} className="flex-1 min-w-0 text-center">
              <div className="text-xs font-medium text-foreground truncate">
                {s.value ?? "--"}
              </div>
              <div className="text-[9px] text-muted truncate">{s.label}</div>
            </div>
          ))}
        </div>
      </GlassCard>

      <CustomModal
        isOpen={isRoleSelectOpen}
        onClose={() => setIsRoleSelectOpen(false)}
        size="md"
      >
        <CustomModalHeader onClose={() => setIsRoleSelectOpen(false)}>
          {t("card:select_role") || "Select Account"}
        </CustomModalHeader>
        <CustomModalBody>
          <div className="space-y-3">
            {accounts.length === 0 ? (
              <div className="text-center text-muted py-8">
                {t("card:no_accounts") || "No accounts available"}
              </div>
            ) : (
              accounts.map((account) => (
                <div
                  key={account.id}
                  className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all lg-hoverable border border-separator hover:border-primary/50"
                  onClick={() => handleRoleConfirm(account.id)}
                >
                  <AccountAvatar
                    src={account.avatar}
                    alt={account.nickname}
                    size="sm"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">
                      {account.nickname || t("common.unknown") || "Unknown"}
                    </div>
                    <div className="text-xs text-muted">
                      {resolveServerLabel(account.server, i18n.language)} · Lv.{account.level}
                    </div>
                  </div>
                  {effectiveRoleId === account.id && (
                    <div className="text-primary-text text-xs font-medium">
                      {t("card:current") || "Current"}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </CustomModalBody>
        <CustomModalFooter>
          <GlassButton variant="secondary" onPress={() => setIsRoleSelectOpen(false)}>
            {t("common.cancel") || "Cancel"}
          </GlassButton>
        </CustomModalFooter>
      </CustomModal>
    </>
  );
}
