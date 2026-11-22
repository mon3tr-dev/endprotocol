import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import {
  HomeIcon,
  UsersIcon,
  MedalIcon,
  MapIcon,
  SatelliteIcon,
  ClockIcon,
  FactoryIcon,
  ChartIcon,
  CalendarIcon,
  GachaIcon,
  BookmarkIcon,
  SettingsIcon,
  AccountIcon,
  PlusIcon,
} from "@/components/icons";
import { ChevronRightIcon, RefreshIcon } from "@/components/ui/app-icon";
import {
  getAccounts,
  getSelectedAccount,
  setSelectedAccount as apiSetSelectedAccount,
  type Account,
} from "@/utils/accountService";
import {
  getAccountAvailability,
  subscribeAccountAvailability,
  type AccountAvailability,
} from "@/utils/accountAvailability";
import { isNavVisible } from "@/config/gameSupport";
import { AccountAvatar } from "@/components/ui/account-avatar";
import { GameBadge } from "@/components/ui/game-badge";
import { resolveServerLabel } from "@/types";
import { getAppVersion } from "@/utils/appInfoService";
import { runDashboardLeaveHandler } from "@/utils/tabSnapshotService";
import AddAccountModal from "@/components/add-account-modal";
import { AccountManagerDrawer } from "@/components/account-manager-drawer";
import AccountSwitchModal from "@/components/account-switch-modal";
import { SwipeCarousel } from "@/components/ui/swipe-carousel";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { SYNC_STATUS_META } from "@/components/ui/status-badge";
import logger from "@/utils/logger";

/**
 * Android / 窄屏专属的「我的」页面。
 *
 * 形态对齐一般应用的个人中心：头像 + 昵称 + ID + 等级，下面是功能矩阵与
 * 账户维护。几处与桌面账户页不同的关键设计：
 *
 * - **头像可左右滑动切号**：两侧露出缩小/降亮度的候选头像（`SwipeCarousel`），
 *   支持循环。不再单独放「切换账户」按钮 —— 手势本身就是入口。
 * - **下拉刷新**：不再放刷新按钮。下拉是移动端最常见的刷新方式，
 *   且省掉一个常驻控件（`usePullToRefresh`）。
 * - **快捷添加账户**：直接弹 `AddAccountModal`，不跳转账户管理页。
 *
 * 为什么单独一个组件而不改造 `pages/account.tsx`：后者有 4800+ 行，承载
 * 森空岛父账户 / 角色绑定 / 扫码登录 / 设备认证 / U8 授权等桌面工作流。
 * 在同一个组件里按断点切结构，会让每条流程都多一套「窄屏怎么办」的分支，
 * 回归面比新增一个页面大得多。
 */

/** 页面入口（顺序即矩阵顺序）。`me` 不在其中 —— 它就是本页自身。 */
const ME_GRID: Array<{
  key: string;
  path: string;
  labelKey: string;
  Icon: typeof HomeIcon;
}> = [
  { key: "dashboard", path: "/", labelKey: "sidebar.dashboard", Icon: HomeIcon },
  { key: "attendance", path: "/attendance", labelKey: "sidebar.attendance", Icon: CalendarIcon },
  { key: "gacha", path: "/gacha", labelKey: "sidebar.gacha", Icon: GachaIcon },
  { key: "todo", path: "/todo", labelKey: "sidebar.todo", Icon: BookmarkIcon },
  { key: "characters", path: "/characters", labelKey: "sidebar.characters", Icon: UsersIcon },
  { key: "medals", path: "/medals", labelKey: "sidebar.medals", Icon: MedalIcon },
  { key: "domain", path: "/domain", labelKey: "sidebar.domain", Icon: MapIcon },
  { key: "spaceship", path: "/spaceship", labelKey: "sidebar.spaceship", Icon: SatelliteIcon },
  { key: "recruitment", path: "/recruitment", labelKey: "sidebar.recruitment", Icon: ClockIcon },
  { key: "building", path: "/building", labelKey: "sidebar.building", Icon: FactoryIcon },
  { key: "gamedata", path: "/game-data", labelKey: "sidebar.gamedata", Icon: ChartIcon },
];

export function MePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSwitchOpen, setIsSwitchOpen] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isManageOpen, setIsManageOpen] = useState(false);
  const [version, setVersion] = useState("");
  const [availability, setAvailability] = useState<AccountAvailability | null>(
    () => getAccountAvailability(),
  );

  /** 拉账户列表与当前选中项。 */
  const loadAccounts = useCallback(async () => {
    try {
      const [selectedId, list] = await Promise.all([
        getSelectedAccount(),
        getAccounts(),
      ]);
      setAccounts(list ?? []);
      setCurrentId(selectedId ?? null);
    } catch (error) {
      logger.error("Failed to load accounts: " + error, "MePage");
      setAccounts([]);
      setCurrentId(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    const sync = () => void loadAccounts();
    window.addEventListener("accountChanged", sync);
    window.addEventListener("manualRefresh", sync);
    return () => {
      window.removeEventListener("accountChanged", sync);
      window.removeEventListener("manualRefresh", sync);
    };
  }, [loadAccounts]);

  useEffect(() => {
    return subscribeAccountAvailability(() => {
      setAvailability(getAccountAvailability());
    });
  }, []);

  useEffect(() => {
    void getAppVersion().then(setVersion);
  }, []);

  /** 下拉刷新：重新拉账户数据（移动端主要刷新方式，不设刷新按钮）。 */
  const { pull, isRefreshing, armed, handlers } = usePullToRefresh({
    onRefresh: async () => {
      await loadAccounts();
    },
  });

  const currentIndex = Math.max(
    0,
    accounts.findIndex((a) => a.id === currentId),
  );
  const account = accounts[currentIndex] ?? null;

  /** 滑动或点头像切换到指定账户。 */
  const switchTo = async (index: number) => {
    const target = accounts[index];
    if (!target || target.id === currentId) return;
    setCurrentId(target.id);
    try {
      const ok = await apiSetSelectedAccount(target.id);
      if (ok) {
        window.dispatchEvent(new CustomEvent("accountChanged"));
      } else {
        setCurrentId(currentId); // 失败回滚
      }
    } catch (error) {
      logger.error("Failed to switch account: " + error, "MePage");
      setCurrentId(currentId);
    }
  };

  const handleNavigate = async (path: string) => {
    await runDashboardLeaveHandler();
    navigate(path);
  };

  /** 按当前账户的游戏过滤入口（与侧栏/底部导航同一张真值表）。 */
  const visibleGrid = useMemo(
    () => ME_GRID.filter((entry) => isNavVisible(entry.key, account?.game)),
    [account?.game],
  );

  const syncMeta = account?.syncStatus
    ? SYNC_STATUS_META[account.syncStatus]
    : null;

  const isActive = (path: string) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);

  return (
    <div
      className="relative mx-auto w-full max-w-2xl space-y-4 pb-4"
      style={{ touchAction: "pan-y" }}
      {...handlers}
    >
      {/* 下拉刷新指示器：跟手位移，达阈值后转圈 */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-center"
        style={{
          height: pull,
          transition: pull === 0 ? "height 260ms var(--lg-ease-emphasized)" : "none",
        }}
      >
        {pull > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted">
            <RefreshIcon
              size={14}
              className={clsx(
                isRefreshing && "animate-spin",
                !isRefreshing && armed && "text-primary-text",
              )}
              style={
                !isRefreshing
                  ? { transform: `rotate(${pull * 3}deg)` }
                  : undefined
              }
            />
            <span>
              {isRefreshing
                ? t("common.refreshing", { defaultValue: "刷新中…" })
                : armed
                  ? t("common.release_to_refresh", { defaultValue: "松开刷新" })
                  : t("common.pull_to_refresh", { defaultValue: "下拉刷新" })}
            </span>
          </div>
        )}
      </div>

      {/* ===== 头部：滑动头像 + 昵称 + ID + 等级，右上角设置 ===== */}
      <section className="lg-regular relative overflow-hidden rounded-2xl border border-separator/60">
        <div className="absolute right-2 top-2 z-10">
          <button
            type="button"
            onClick={() => void handleNavigate("/settings")}
            aria-label={t("sidebar.settings", { defaultValue: "设置" })}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors active:text-foreground"
          >
            <SettingsIcon className="h-[18px] w-[18px]" />
          </button>
        </div>

        <div className="flex flex-col items-center px-4 pb-5 pt-6">
          {/*
           * 头像轮播：左右滑动切号，两侧露出缩小/降亮度的候选。
           * 只有一个账户时退化成一个静态头像，点击可打开添加账户。
           */}
          {isLoading ? (
            <div className="h-20 w-20 animate-pulse rounded-full bg-foreground/10" />
          ) : accounts.length > 1 ? (
            <SwipeCarousel
              items={accounts}
              index={currentIndex}
              onIndexChange={(next) => void switchTo(next)}
              renderItem={(acc, active) => (
                <span
                  className={clsx(
                    "block rounded-full transition-shadow",
                    active && "ring-2 ring-separator/60",
                  )}
                >
                  <AccountAvatar
                    src={acc.avatar}
                    alt={acc.nickname}
                    size={active ? "xl" : "lg"}
                    className="!rounded-full"
                  />
                </span>
              )}
            />
          ) : account ? (
            <AccountAvatar
              src={account.avatar}
              alt={account.nickname}
              size="xl"
              className="!rounded-full ring-2 ring-separator/50"
            />
          ) : (
            /* 无账户：给一个中性占位，点击直接添加账户 */
            <button
              type="button"
              onClick={() => setIsSwitchOpen(true)}
              className="flex h-20 w-20 items-center justify-center rounded-full bg-foreground/[0.07] text-muted ring-2 ring-separator/50"
              aria-label={t("me.add_account", { defaultValue: "添加账户" })}
            >
              <AccountIcon className="h-9 w-9" />
            </button>
          )}

          {/* 昵称 + 游戏徽标 */}
          <div className="mt-3 flex max-w-full items-center gap-1.5">
            <span className="truncate text-lg font-semibold text-foreground">
              {isLoading
                ? "…"
                : account?.nickname ||
                  t("settings.account.no_accounts", { defaultValue: "未选择账户" })}
            </span>
            {account?.game && <GameBadge game={account.game} variant="icon" />}
          </div>

          {/* ID：点击复制 */}
          {account?.userId && (
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(account.userId!);
              }}
              className="mt-1 flex items-center gap-1 text-xs text-muted"
            >
              <span className="truncate">
                {t("me.uid", { defaultValue: "ID" })}: {account.userId}
              </span>
            </button>
          )}

          {/* 基础信息：等级 / 服务器 / 同步状态 */}
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-muted">
            {account && <span>Lv.{account.level}</span>}
            {account?.server && (
              <span>{resolveServerLabel(account.server, i18n.language)}</span>
            )}
            {syncMeta && (
              <span className={clsx(syncMeta.tone === "danger" && "text-danger-text")}>
                {syncMeta.label}
              </span>
            )}
            {availability && (
              <span className="text-danger-text">
                {t("settings.account.account_unavailable_title", {
                  defaultValue: "账号不可用",
                })}
              </span>
            )}
          </div>

          {/* 多账户时给一句滑动提示 —— 手势本身不可见，需要文字暗示 */}
          {accounts.length > 1 && (
            <p className="mt-2 text-[10px] text-muted/60">
              {t("me.swipe_hint", { defaultValue: "左右滑动头像切换账户" })}
            </p>
          )}
        </div>
      </section>

      {/* ===== 页面入口矩阵 ===== */}
      <section className="lg-regular overflow-hidden rounded-2xl border border-separator/60">
        <div className="grid grid-cols-4 gap-1 p-2">
          {visibleGrid.map((entry) => {
            const Icon = entry.Icon;
            const active = isActive(entry.path);
            return (
              <button
                key={entry.key}
                type="button"
                onClick={() => void handleNavigate(entry.path)}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "flex flex-col items-center gap-1.5 rounded-xl py-3 transition-colors touch-target",
                  active
                    ? "lg-control lg-solid bg-primary text-primary-foreground"
                    : "text-foreground active:bg-foreground/[0.06]",
                )}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span className="max-w-full truncate px-1 text-[10px] leading-tight">
                  {t(entry.labelKey)}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ===== 账户维护 + 版本 ===== */}
      <section className="lg-regular overflow-hidden rounded-2xl border border-separator/60">
        {/* 账户管理：绑/解绑角色、授权/取消抽卡、删除账户（与桌面能力对齐） */}
        <button
          type="button"
          onClick={() => setIsManageOpen(true)}
          className="flex w-full items-center gap-3 border-b border-separator/40 px-4 py-3.5 text-left transition-colors active:bg-foreground/[0.04] touch-target"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground/[0.07] text-foreground">
            <UsersIcon size={16} />
          </span>
          <span className="flex-1 text-sm font-medium text-foreground">
            {t("settings.account.manage_accounts", { defaultValue: "账户管理" })}
          </span>
          <ChevronRightIcon size={16} className="text-muted" />
        </button>

        {/* 添加账户：直接弹登录 Modal，不跳转账户管理页 */}
        <button
          type="button"
          onClick={() => setIsAddOpen(true)}
          className="flex w-full items-center gap-3 border-b border-separator/40 px-4 py-3.5 text-left transition-colors active:bg-foreground/[0.04] touch-target"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary-text">
            <PlusIcon size={16} />
          </span>
          <span className="flex-1 text-sm font-medium text-foreground">
            {t("me.add_account", { defaultValue: "添加账户" })}
          </span>
          <ChevronRightIcon size={16} className="text-muted" />
        </button>

        <button
          type="button"
          onClick={() => void handleNavigate("/settings")}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-foreground/[0.04] touch-target"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground/[0.07] text-foreground">
            <SettingsIcon size={16} />
          </span>
          <span className="flex-1 text-sm font-medium text-foreground">
            {t("sidebar.settings", { defaultValue: "设置" })}
          </span>
          <ChevronRightIcon size={16} className="text-muted" />
        </button>
      </section>

      <p className="pb-2 text-center text-[11px] text-muted/70">
        EndProtocol
        {version ? ` v${version}` : ""}
      </p>

      {/* 快捷添加账户：弹 Modal，不跳转账户管理页 */}
      <AddAccountModal
        isOpen={isAddOpen}
        onClose={() => {
          setIsAddOpen(false);
          void loadAccounts();
        }}
        onAdded={() => {
          setIsAddOpen(false);
          void loadAccounts();
        }}
      />

      {/* 账户管理：绑/解绑角色、授权/取消抽卡、删除账户 */}
      <AccountManagerDrawer
        isOpen={isManageOpen}
        onClose={() => setIsManageOpen(false)}
        onChanged={() => void loadAccounts()}
      />

      {/* 切换账户：列表弹窗（多账户时） */}
      <AccountSwitchModal
        isOpen={isSwitchOpen}
        onClose={() => setIsSwitchOpen(false)}
        currentAccountId={currentId}
      />
    </div>
  );
}