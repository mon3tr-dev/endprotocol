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
import { AccountNameLine } from "@/components/ui/game-badge";
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

        {/* List
         *
         * 这里要同时满足两件事：卡片的 hover 缩放动画不能被裁掉，列表本身
         * 也不能因为溢出而多出滚动条。
         *
         * GlassCard 自带 hover:-translate-y-1 hover:scale-[1.02]。缩放会让
         * 卡片在水平方向多出约 1% 宽度（卡片近 950px → 每侧 ~10px），这一圈
         * 溢出原本直接顶到滚动容器的裁切边缘：卡片左右两角的圆角与描边被切
         * 掉，同时 overflow-x 变成 auto → 底部多出一条几乎占满宽度的横向
         * 滚动条（`overflow-y:auto` 会把 `visible` 的另一轴计算成 `auto`）。
         *
         * 做法是给滚动容器留出内边距当「缩放余量」：padding 在裁切边缘
         * 之内，缩放出去的那一圈落进 padding 里，既不被裁掉，也不算溢出
         * （溢出只统计超出 padding box 的部分）→ 不产生横向滚动条。
         * `-mx-3` 把这段 padding 抵消回容器自身，让卡片宽度与原先一致。
         * 纵向同理：py-1.5 容纳 -4px 的上浮与 1.02 缩放多出来的高度。
         *
         * 高度上限跟视口走（min(60vh, 520px)）而不是写死 400px：400px 恰好
         * 只够放下 4 张卡（每张 ~72px + 8px 间距 = 80px），第 5 张正好被切在
         * 裁切边缘上。取 60vh 是为了和弹窗自身的 !max-h-[90vh] 留出余量：
         * 列表 + 搜索框 + 头部 + 底部统计必须小于 90vh，否则外层 Body 会
         * 冒出第二条纵向滚动条（滚动条套滚动条）。
         */}
        <div className="space-y-2 -mx-3 max-h-[min(60vh,520px)] overflow-y-auto overflow-x-hidden px-3 py-1.5">
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
                    {/* 选中态由行尾的 ACTIVE 徽章表达，头像不再叠绿色小圆点 */}
                    <AccountAvatar
                      src={account.avatar}
                      alt={account.nickname}
                      size="md"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {/* 徽标紧跟名字、与名字垂直居中；行尾留给 ACTIVE 标示 */}
                        <p className="text-sm font-semibold text-foreground min-w-0">
                          <AccountNameLine game={account.game}>
                            {account.nickname}
                          </AccountNameLine>
                        </p>
                        {isSelected && (
                          <span className="ml-auto shrink-0 px-2 py-0.5 text-[10px] font-bold text-success-text bg-success/10 rounded">
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
