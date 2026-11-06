import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { GlassCard, GlassInput, GlassSpinner } from "@/components/ui/glass";
import {
  CustomModal,
  CustomModalHeader,
  CustomModalBody,
} from "@/components/custom-modal";
import { SearchIcon } from "@/components/icons";
import { AccountAvatar } from "@/components/ui/account-avatar";
import { EmptyState, EmptyStateUserIcon } from "@/components/ui/empty-state";
import { SkeletonList } from "@/components/ui/loading-block";
import { resolveServerLabel } from "@/types";
import {
  getAccounts,
  setSelectedAccount as apiSetSelectedAccount,
  type Account,
} from "@/utils/accountService";
import logger from "@/utils/logger";

interface AccountSwitchModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentAccountId?: string | null;
}

export default function AccountSwitchModal({
  isOpen,
  onClose,
  currentAccountId,
}: AccountSwitchModalProps) {
  const { t, i18n } = useTranslation();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [expectedAccountCount, setExpectedAccountCount] = useState(3);

  useEffect(() => {
    if (isOpen) loadAccounts();
    const handleManualRefresh = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      setExpectedAccountCount(Math.min(detail?.count || 3, 5));
    };
    window.addEventListener("manualRefresh", handleManualRefresh);
    return () =>
      window.removeEventListener("manualRefresh", handleManualRefresh);
  }, [isOpen]);

  const loadAccounts = async () => {
    setIsLoading(true);
    try {
      const data = await getAccounts();
      setAccounts(data || []);
    } catch (error) {
      logger.error("Failed to load accounts: " + error, "AccountSwitch");
    } finally {
      setIsLoading(false);
    }
  };

  const filteredAccounts = useMemo(() => {
    let list = [...accounts];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (a) =>
          a.nickname.toLowerCase().includes(q) ||
          a.id.toLowerCase().includes(q) ||
          a.server.toLowerCase().includes(q) ||
          a.userId?.toLowerCase().includes(q),
      );
    }
    list.sort((a, b) => {
      if (a.id === currentAccountId) return -1;
      if (b.id === currentAccountId) return 1;
      return a.nickname.localeCompare(b.nickname);
    });
    return list;
  }, [accounts, searchQuery, currentAccountId]);

  const handleSwitchAccount = async (accountId: string) => {
    if (accountId === currentAccountId) {
      onClose();
      return;
    }
    setSwitchingId(accountId);
    try {
      const success = await apiSetSelectedAccount(accountId);
      if (success) {
        window.dispatchEvent(new CustomEvent("accountChanged"));
        onClose();
      }
    } catch (error) {
      logger.error("Failed to switch account: " + error, "AccountSwitch");
    } finally {
      setSwitchingId(null);
    }
  };

  return (
    <CustomModal isOpen={isOpen} onClose={onClose} size="2xl">
      <CustomModalHeader onClose={onClose}>
        {t("account_switch.title")}
      </CustomModalHeader>
      <CustomModalBody>
        {/* Search */}
        <div className="mb-4">
          <GlassInput
            type="search"
            placeholder={t("account_switch.search_placeholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-10"
            startContent={
              <SearchIcon className="text-base text-muted pointer-events-none flex-shrink-0" />
            }
          />
        </div>

        {/* List */}
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {isLoading ? (
            <SkeletonList count={expectedAccountCount} rowHeight={68} />
          ) : filteredAccounts.length === 0 ? (
            <EmptyState
              icon={<EmptyStateUserIcon />}
              title={t("account_switch.no_accounts_found")}
            />
          ) : (
            filteredAccounts.map((account) => {
              const isSelected = account.id === currentAccountId;
              const isSwitching = switchingId === account.id;
              return (
                <GlassCard
                  key={account.id}
                  className={`p-3 cursor-pointer transition-all hover:shadow-md ${
                    isSelected
                      ? "border-2 border-primary bg-primary-50 dark:bg-primary-900/20"
                      : "border border-separator hover:border-content3/50"
                  }`}
                  isPressable
                  onPress={() =>
                    !isSwitching && handleSwitchAccount(account.id)
                  }
                >
                  <div className="flex items-center gap-3">
                    <AccountAvatar
                      src={account.avatar}
                      alt={account.nickname}
                      size="md"
                      showActiveIndicator={isSelected}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-foreground truncate">
                          {account.nickname}
                        </p>
                        {isSelected && (
                          <span className="px-2 py-0.5 text-[10px] font-bold text-success-text bg-success/10 rounded">
                            ACTIVE
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted mt-0.5">
                        Lv.{account.level} •{" "}
                        {resolveServerLabel(account.server, i18n.language)}
                      </p>
                      {account.userId && (
                        <p className="text-[11px] text-muted/70 mt-0.5 truncate">
                          {t("settings.account.skland_account")}:{" "}
                          {account.userId}
                        </p>
                      )}
                    </div>
                    {isSwitching && <GlassSpinner size={20} color="primary" />}
                  </div>
                </GlassCard>
              );
            })
          )}
        </div>

        {!isLoading && filteredAccounts.length > 0 && (
          <div className="mt-4 pt-3 border-t border-separator text-xs text-muted text-center">
            {t("account_switch.accounts_total", {
              count: filteredAccounts.length,
            })}
          </div>
        )}
      </CustomModalBody>
    </CustomModal>
  );
}
