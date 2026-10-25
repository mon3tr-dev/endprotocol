import { useTranslation } from "react-i18next";
import { Img } from "@/utils/imageLoader";
import QRCode from "qrcode";
import {
  GlassAlert,
  GlassButton,
  GlassCard,
  GlassCheckbox,
  GlassInputOTP,
  GlassLabel,
  GlassLink,
  GlassSkeleton,
  GlassSpinner,
} from "@/components/ui/glass";
import { SimplePagination } from "@/components/simple-pagination";
import { CONTAINER_HEIGHT } from "@/components/cards/card-container";
import { StatusDot, type StatusDotTone } from "@/components/ui/status-dot";
import {
  StatusBadge,
  SYNC_STATUS_META,
  type StatusConfig,
} from "@/components/ui/status-badge";
import { useState, useEffect, useRef, type ReactNode } from "react";
import {
  ChevronDownIcon,
  InfoIcon,
  LinkIcon,
  UnlinkIcon,
} from "@/components/ui/app-icon";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  CustomModal,
  CustomModalHeader,
  CustomModalBody,
  CustomModalFooter,
} from "@/components/custom-modal";
import {
  getAccounts,
  getSklandAccounts,
  saveSklandAccount,
  getSklandAccountRoles,
  getSklandUserInfo,
  getSklandGames,
  getSelectedAccount,
  refreshAccountData,
  logoutAccount as apiLogoutAccount,
  addAccount,
  sendVerificationCode,
  addAccountByCode,
  addAccountByScan,
  genScanLogin,
  scanStatus,
  saveSelectedRoles,
  setSelectedAccount as apiSetSelectedAccount,
  getSklandUserInfoByCred,
  applyApiHealthSnapshot,
  Account,
  LoginResult,
  RoleDisplayInfo,
  SklandAccount,
  SklandGameInfo,
  SklandUserInfo,
} from "@/utils/accountService";
import { invoke } from "@tauri-apps/api/core";
import {
  clearAccountUnavailable,
  getAccountAvailability,
  loadAccountAvailability,
  subscribeAccountAvailability,
  type AccountAvailability,
} from "@/utils/accountAvailability";
import type { ApiHealthSnapshot } from "@/utils/crashReporting";
import { roleDetailService } from "@/utils/roleDetailService";
import logger, { logDebug, logError } from "../utils/logger";
import { getConfig } from "@/utils/configService";
import { addMessage } from "@/utils/messageStore";
import { resolveServerLabel } from "@/types";

function RoleGroup({
  title,
  count,
  emptyLabel,
  children,
}: {
  title: string;
  count: number;
  emptyLabel: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase text-muted">{title}</h3>
        <span className="text-xs tabular-nums text-muted">{count}</span>
      </div>
      {count === 0 ? (
        <p className="rounded-lg border border-dashed border-separator/70 px-3 py-5 text-center text-xs text-muted">
          {emptyLabel}
        </p>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </section>
  );
}

function GameRoleRow({
  role,
  isBound,
  isActive,
  actionLabel,
  isBusy,
  isDisabled,
  onSetActive,
  onAction,
}: {
  role: RoleDisplayInfo;
  isBound: boolean;
  isActive: boolean;
  actionLabel: string;
  isBusy: boolean;
  isDisabled: boolean;
  onSetActive?: () => void;
  onAction: () => void;
}) {
  const { i18n } = useTranslation();

  return (
    <div className="account-glass-row flex min-w-0 items-center gap-3 rounded-lg border border-separator/60 p-2.5">
      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md border border-separator/50 bg-content2/30">
        {role.avatarUrl ? (
          <Img
            src={role.avatarUrl}
            alt={role.nickname}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm font-semibold text-muted">
            {role.nickname.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {role.nickname}
        </p>
        <p className="truncate text-xs text-muted">
          Lv.{role.level} · {resolveServerLabel(role.serverId, i18n.language)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {isBound &&
          (isActive ? (
            <span className="rounded-full bg-success/15 px-2 py-1 text-[10px] font-semibold text-success">
              {i18n.language === "zh" ? "当前" : "ACTIVE"}
            </span>
          ) : (
            <GlassButton
              size="sm"
              variant="ghost"
              isDisabled={isDisabled}
              onPress={onSetActive}
              aria-label={
                i18n.language === "zh"
                  ? "设为当前游戏账户"
                  : "Set as active game account"
              }
            >
              {i18n.language === "zh" ? "设为当前" : "Set active"}
            </GlassButton>
          ))}
        <GlassButton
          size="sm"
          variant={isBound ? "outline" : "primary"}
          isDisabled={isDisabled}
          isLoading={isBusy}
          startContent={
            isBound ? <UnlinkIcon size={14} /> : <LinkIcon size={14} />
          }
          onPress={onAction}
          aria-label={actionLabel}
        >
          {actionLabel}
        </GlassButton>
      </div>
    </div>
  );
}

/**
 * 森空岛用户资料详情（Modal 内容，数据来自 GET /web/v1/user）
 */
function SklandProfileDetails({
  userInfo,
  gameList,
  isLoading,
  errorMessage,
  onRetry,
}: {
  userInfo?: SklandUserInfo;
  gameList: SklandGameInfo[];
  isLoading: boolean;
  errorMessage?: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();

  if (!userInfo) {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center gap-3 py-10 text-sm text-muted">
          <GlassSpinner color="primary" size="sm" />
          {t("settings.account.loading")}
        </div>
      );
    }
    return (
      <div className="space-y-3 py-8 text-center">
        <p className="text-sm text-danger">
          {t("settings.account.skland_profile_failed")}
        </p>
        {errorMessage && (
          <p className="break-all text-xs text-muted">{errorMessage}</p>
        )}
        <GlassButton variant="outline" size="sm" onPress={onRetry}>
          {t("settings.account.retry")}
        </GlassButton>
      </div>
    );
  }

  // level 为 0 的游戏不展示
  const games = userInfo.scoreInfoList.filter((score) => score.level > 0);
  // gameId → 游戏图标（来自 GET /web/v1/game，等级接口返回的是等级图标）
  const gameIcons = new Map(
    gameList.map((game) => [game.gameId, game.iconUrl] as const),
  );
  const stats = userInfo.stats
    ? [
        {
          key: "follow",
          label: t("settings.account.skland_follow"),
          value: userInfo.stats.follow,
        },
        {
          key: "fans",
          label: t("settings.account.skland_fans"),
          value: userInfo.stats.fans,
        },
        {
          key: "liked",
          label: t("settings.account.skland_liked"),
          value: userInfo.stats.liked,
        },
        {
          key: "collect",
          label: t("settings.account.skland_collect"),
          value: userInfo.stats.collect,
        },
        {
          key: "comment",
          label: t("settings.account.skland_comment"),
          value: userInfo.stats.comment,
        },
        {
          key: "pub",
          label: t("settings.account.skland_publish"),
          value: userInfo.stats.pub,
        },
      ]
    : [];

  return (
    <div className="space-y-5">
      {/* 基本资料 */}
      <div className="flex items-center gap-4">
        {/* 挂件的透明开孔约为整图的 61%，102–104px 时正好套住 64px 头像 */}
        <div
          className={`relative flex shrink-0 items-center justify-center ${
            userInfo.pendant?.iconUrl ? "h-[104px] w-[104px]" : "h-16 w-16"
          }`}
        >
          <div className="h-16 w-16 overflow-hidden rounded-full border border-separator/60 bg-content2/30">
            {userInfo.avatar ? (
              <Img
                src={userInfo.avatar}
                alt={userInfo.nickname}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-lg font-semibold text-muted">
                S
              </div>
            )}
          </div>
          {/* 头像框（挂件）套在头像外侧；max-w-none 覆盖 img 的 max-width:100% 限制 */}
          {userInfo.pendant?.iconUrl && (
            <Img
              src={userInfo.pendant.iconUrl}
              alt={userInfo.pendant.title || ""}
              title={userInfo.pendant.title}
              transparentPlaceholder
              className="pointer-events-none absolute inset-0 h-full w-full max-w-none object-contain"
            />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-base font-semibold text-foreground">
            {userInfo.nickname || t("settings.account.skland_account")}
          </p>
          <p className="truncate font-mono text-xs text-muted">
            {userInfo.showId || userInfo.id}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            {userInfo.latestIpLocation && (
              <span>
                {t("settings.account.skland_ip_location")}:{" "}
                {userInfo.latestIpLocation}
              </span>
            )}
            {userInfo.isCreator && (
              <span className="text-primary">
                {t("settings.account.skland_creator")}
              </span>
            )}
          </div>
        </div>
      </div>

      {userInfo.profile && (
        <div className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase text-muted">
            {t("settings.account.skland_bio")}
          </h3>
          <p className="whitespace-pre-wrap break-words text-sm text-foreground/85">
            {userInfo.profile}
          </p>
        </div>
      )}

      {/* 游戏等级（level 为 0 的游戏不显示） */}
      {games.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase text-muted">
            {t("settings.account.skland_game_levels")}
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {games.map((game) => {
              const iconUrl = gameIcons.get(game.gameId) || "";
              return (
                <div
                  key={game.gameId}
                  className="account-glass-row flex items-center gap-3 rounded-lg border border-separator/60 p-2.5"
                >
                  <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md border border-separator/50 bg-content2/30">
                    {iconUrl ? (
                      <Img
                        src={iconUrl}
                        alt={game.gameName}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs font-semibold text-muted">
                        {game.gameName.charAt(0)}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {game.gameName}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {t("settings.account.skland_score")} {game.score}
                      {game.checkedDays > 0
                        ? ` · ${t("settings.account.skland_checked_days")} ${game.checkedDays}`
                        : ""}
                    </p>
                  </div>
                  {/* 等级用等级图标（scoreInfoList[].iconUrl）展示，替代 "Lv.x" 文字 */}
                  {game.iconUrl ? (
                    <Img
                      src={game.iconUrl}
                      alt={`Lv.${game.level}`}
                      title={`Lv.${game.level}`}
                      transparentPlaceholder
                      className="h-7 w-auto max-w-none shrink-0 object-contain"
                    />
                  ) : (
                    <span className="shrink-0 text-xs font-medium text-muted">
                      Lv.{game.level}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 社区数据 */}
      {stats.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase text-muted">
            {t("settings.account.skland_stats")}
          </h3>
          <div className="grid grid-cols-3 gap-2">
            {stats.map((item) => (
              <div
                key={item.key}
                className="rounded-lg border border-separator/60 bg-content2/20 px-2 py-2 text-center"
              >
                <p className="text-sm font-semibold tabular-nums text-foreground">
                  {item.value}
                </p>
                <p className="truncate text-[11px] text-muted">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// 二维码图片组件（使用 qrcode 库生成 dataURL）
function QRCodeImage({ value, size = 200 }: { value: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState("");
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDataUrl("");
    setHasError(false);
    QRCode.toDataURL(value, {
      width: size,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setHasError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (hasError) {
    return (
      <div
        className="w-[200px] h-[200px] flex items-center justify-center text-sm text-muted"
        style={{ width: size, height: size }}
      >
        QR Error
      </div>
    );
  }
  if (!dataUrl) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        <GlassSpinner color="primary" size="md" />
      </div>
    );
  }
  return (
    <img
      src={dataUrl}
      alt="QR Code"
      className="rounded-xl"
      width={size}
      height={size}
    />
  );
}

export default function AccountPage() {
  const { t, i18n } = useTranslation();

  // 状态管理
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [sklandAccounts, setSklandAccounts] = useState<SklandAccount[]>([]);
  // 森空岛用户资料（GET /web/v1/user），按 userId 索引
  const [sklandUserInfos, setSklandUserInfos] = useState<
    Record<string, SklandUserInfo>
  >({});
  // 资料获取失败信息，按 userId 索引
  const [sklandUserInfoErrors, setSklandUserInfoErrors] = useState<
    Record<string, string>
  >({});
  // 森空岛游戏列表（GET /web/v1/game），用于展示游戏图标
  const [sklandGames, setSklandGames] = useState<SklandGameInfo[]>([]);
  // 当前打开资料的森空岛账户
  const [profileSklandId, setProfileSklandId] = useState<string | null>(null);
  const sklandUserInfoRequestsRef = useRef<Set<string>>(new Set());
  const sklandGamesLoadingRef = useRef(false);
  const [expandedSklandId, setExpandedSklandId] = useState<string | null>(null);
  const [sklandRoleSets, setSklandRoleSets] = useState<
    Record<string, { roles: RoleDisplayInfo[]; cred: string; token: string }>
  >({});
  const [loadingSklandId, setLoadingSklandId] = useState<string | null>(null);
  const [roleLoadErrors, setRoleLoadErrors] = useState<Record<string, string>>(
    {},
  );
  const [savingRoleKey, setSavingRoleKey] = useState<string | null>(null);
  const [currentAccountId, setCurrentAccountId] = useState<string | null>(null); // 当前选中的账户ID
  const [previousAccountId, setPreviousAccountId] = useState<string | null>(
    null,
  ); // 上一个选中的账户ID
  const [isAnimating, setIsAnimating] = useState(false); // 是否正在播放动画
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [showSklandConfirmation, setShowSklandConfirmation] = useState(false);
  const [isRoleSelectionOpen, setIsRoleSelectionOpen] = useState(false);
  const [isManagingSklandRoles, setIsManagingSklandRoles] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expectedAccountCount, setExpectedAccountCount] = useState<number>(0); // 预期的账户数量

  // 添加账户相关状态
  type LoginMethod = "phone" | "sms" | "qrcode" | null;
  const [loginMethod, setLoginMethod] = useState<LoginMethod>(null);
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string>("");
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [codeSentSuccess, setCodeSentSuccess] = useState(false);
  const [showOtpInput, setShowOtpInput] = useState(false); // 是否显示 OTP 输入界面
  const [isOtpInvalid, setIsOtpInvalid] = useState(false); // OTP 是否无效

  // 扫码登录相关状态
  const [scanId, setScanId] = useState("");
  const [scanUrl, setScanUrl] = useState("");
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);
  const [isPollingScan, setIsPollingScan] = useState(false);
  const [scanWaiting, setScanWaiting] = useState(true); // true=等待扫码, false=已扫码待确认
  const [qrGenFailed, setQrGenFailed] = useState(false); // 二维码自动生成失败
  const qrPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);

  // 新设备验证（密码登录触发验证码登录获取 device token）
  const [isNewDeviceVerify, setIsNewDeviceVerify] = useState(false);

  // 账户数据不可用状态（凭证失效 / 数美设备指纹失败 / 网络持续失败）
  const [accountAvailability, setAccountAvailabilityState] =
    useState<AccountAvailability | null>(() => getAccountAvailability());
  // 重新登录的目标森空岛账户（null 表示当前是「添加账户」流程）
  const [reloginTarget, setReloginTarget] = useState<SklandAccount | null>(null);
  // 扫码授权后账户不匹配时展示的实际账户 userId
  const [reloginMismatchUserId, setReloginMismatchUserId] = useState<string>("");
  // 森空岛账户确认页的头像/昵称（用登录得到的 cred/token 直接拉取）
  const [reloginProfile, setReloginProfile] = useState<SklandUserInfo | null>(
    null,
  );

  // 登出确认（选择是否保留设备认证）
  const [logoutTarget, setLogoutTarget] = useState<Account | null>(null);
  const [keepDeviceAuth, setKeepDeviceAuth] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // 组件卸载时清理扫码轮询
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (qrPollTimerRef.current) {
        clearInterval(qrPollTimerRef.current);
        qrPollTimerRef.current = null;
      }
    };
  }, []);

  // 同步账户可用状态：全局状态存储 + 启动时兜底查询后端 API 熔断快照
  useEffect(() => {
    const unsubscribe = subscribeAccountAvailability(() => {
      if (isMountedRef.current) {
        setAccountAvailabilityState(getAccountAvailability());
      }
    });
    void loadAccountAvailability().then(() => {
      if (isMountedRef.current) {
        setAccountAvailabilityState(getAccountAvailability());
      }
    });
    void (async () => {
      try {
        // 用后端熔断快照校正状态（已解除时清除「账号不可用」）
        const snapshot = await invoke<ApiHealthSnapshot>("get_api_health");
        applyApiHealthSnapshot(snapshot);
        if (isMountedRef.current) {
          setAccountAvailabilityState(getAccountAvailability());
        }
      } catch (error) {
        logDebug("[Account] Failed to query API health: " + error);
      }
    })();
    return unsubscribe;
  }, []);

  // 进入扫码登录界面时自动生成二维码
  useEffect(() => {
    if (
      isAddModalOpen &&
      loginMethod === "qrcode" &&
      !scanUrl &&
      !isGeneratingQr &&
      !isLoggingIn &&
      !qrGenFailed
    ) {
      handleStartQrLogin();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isAddModalOpen,
    loginMethod,
    scanUrl,
    isGeneratingQr,
    isLoggingIn,
    qrGenFailed,
  ]);

  // 角色选择状态
  const [availableRoles, setAvailableRoles] = useState<RoleDisplayInfo[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [loginCred, setLoginCred] = useState("");
  const [loginToken, setLoginToken] = useState("");
  const [loginUserId, setLoginUserId] = useState("");

  // 全局 Alert 状态（在主页面显示）
  const [globalAlert, setGlobalAlert] = useState<{
    type: "success" | "danger";
    message: string;
  } | null>(null);

  // 从 C# 端获取账户数据
  useEffect(() => {
    const loadAccounts = async () => {
      setIsLoading(true);

      try {
        // 直接从后端获取账户数据（后端会处理缓存）
        logDebug("[Account] Fetching accounts from backend...");
        const [accounts, parents, selectedId] = await Promise.all([
          getAccounts(),
          getSklandAccounts(),
          getSelectedAccount(),
        ]);

        logDebug(
          "[Account] Fetched accounts from backend, count:",
          accounts?.length || 0,
        );

        // 直接使用后端返回的数据（无论是否为空）
        logDebug(
          "[Account] Setting accounts state, count:",
          accounts?.length || 0,
        );
        setAccounts(accounts || []);
        setSklandAccounts(parents);

        // 为尚未缓存昵称/头像的森空岛账户补齐用户资料
        for (const parent of parents) {
          if (!parent.nickname || !parent.avatar) {
            void ensureSklandUserInfo(parent.userId);
          }
        }

        const activeId = accounts.some((account) => account.id === selectedId)
          ? selectedId
          : null;
        setCurrentAccountId(activeId);

        setLastRefreshTime(new Date());
      } catch (error) {
        logError("Failed to load accounts:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadAccounts();

    // 监听后端自动刷新事件，替代前端定时轮询
    let unlisten: UnlistenFn | undefined;
    (async () => {
      unlisten = await listen(
        "accounts-refreshed",
        (event: {
          payload: { success: boolean; accounts?: any[]; refreshTime: string };
        }) => {
          logDebug("[Account] Data refreshed via backend event");
          if (event.payload.success && event.payload.accounts) {
            setAccounts(event.payload.accounts);
            setLastRefreshTime(new Date(event.payload.refreshTime));
          }
        },
      );
    })();

    return () => {
      if (unlisten) unlisten();
    };
  }, []); // 只在组件挂载时执行一次

  // 当账户数据加载完成后，重新计算 itemsPerPage
  useEffect(() => {
    if (accounts.length > 0 && containerRef.current) {
      logger.info("Accounts loaded, recalculating itemsPerPage", "Account");
      // 延迟一下确保 DOM 已渲染
      setTimeout(() => {
        const calculateItemsPerPage = () => {
          if (!containerRef.current) return;

          // 使用窗口高度减去固定的顶部区域
          // 估算：顶部标题栏(~60px) + 页面标题和按钮(~120px) + 刷新时间(~30px) + 上下边距(~40px) = ~250px
          const topOffset = 250;
          const windowHeight = window.innerHeight;
          const availableHeight = windowHeight - topOffset;

          logger.info(
            "Window height: " +
              windowHeight +
              " Available height: " +
              availableHeight,
            "Account",
          );

          if (availableHeight <= 0) {
            setItemsPerPage(1);
            return;
          }

          // 分页组件高度约 60px
          const paginationHeight = 60;
          const contentAvailableHeight = availableHeight - paginationHeight;

          if (contentAvailableHeight <= 0) {
            setItemsPerPage(1);
            return;
          }

          let count = 0;
          let usedHeight = 0;

          while (count < 100) {
            const cardHeight = CARD_HEIGHT + (count > 0 ? GAP_SIZE : 0);
            if (usedHeight + cardHeight > contentAvailableHeight) {
              break;
            }
            usedHeight += cardHeight;
            count++;
          }

          const newCount = Math.max(1, count);
          logger.info("Recalculated items per page: " + newCount, "Account");
          setItemsPerPage(newCount);
        };

        calculateItemsPerPage();
      }, 200);
    }
  }, [accounts.length]);

  // 监听账户切换事件（从侧边栏切换时触发）
  useEffect(() => {
    const handleAccountChanged = async () => {
      logDebug("[Account] Received accountChanged event");

      // 重新加载账户数据
      setIsLoading(true);
      try {
        // 并行获取配置和新的选中账户ID
        const [shouldRefresh, selectedId] = await Promise.all([
          getConfig<boolean>("refresh_on_account_switch"),
          getSelectedAccount(),
        ]);
        logger.info(
          "Should refresh on switch (from sidebar): " + shouldRefresh,
          "Account",
        );
        logDebug("[Account] New selected account ID:", selectedId);

        let accountsData;
        if (shouldRefresh) {
          // 如果需要刷新，调用API获取最新数据
          logger.info(
            "Refreshing account data from API (sidebar)...",
            "Account",
          );
          const result = await refreshAccountData();
          if (result.success && result.accounts) {
            accountsData = result.accounts;
          }
        } else {
          // 如果不需要刷新，直接从后端获取（后端会处理缓存）
          logDebug("[Account] Fetching account data from backend (sidebar)");
          accountsData = await getAccounts();
        }

        setAccounts(accountsData || []);

        // 只更新当前选中的账户，不修改 previousAccountId
        // previousAccountId 应该由 handleSelectAccount 设置
        setCurrentAccountId(selectedId);

        // 通知后端当前激活的角色ID(用于懒加载)
        if (selectedId) {
          await roleDetailService.setCurrentRoleId(selectedId);
        }

        setIsAnimating(true);

        setTimeout(() => {
          setIsAnimating(false);
          setPreviousAccountId(null);
        }, 300);
      } catch (error) {
        logError("Failed to reload accounts:", error);
      } finally {
        setIsLoading(false);
      }
    };

    window.addEventListener("accountChanged", handleAccountChanged);
    return () => {
      window.removeEventListener("accountChanged", handleAccountChanged);
    };
  }, []); // 移除 currentAccountId 依赖，避免循环

  // 获取预期的账户数量（从配置中读取）
  const getExpectedAccountCount = async (): Promise<number> => {
    try {
      // 获取 account_list
      const accountList = await getConfig<string[]>("account_list");
      if (accountList && Array.isArray(accountList)) {
        // 最多显示5个骨架屏
        return Math.min(accountList.length, 5);
      }

      // 如果 account_list 不存在，直接从后端获取
      const accounts = await getAccounts();
      if (accounts && accounts.length > 0) {
        return Math.min(accounts.length, 5);
      }

      // 默认显示3个
      return 3;
    } catch (error) {
      logger.error("Failed to get expected account count: " + error, "Account");
      return 3; // 出错时默认显示3个
    }
  };

  // 刷新数据函数
  const refreshData = async () => {
    setIsRefreshing(true);

    // 先获取预期的账户数量
    const count = await getExpectedAccountCount();
    setExpectedAccountCount(count);

    // 通知侧边栏显示骨架屏
    window.dispatchEvent(
      new CustomEvent("manualRefresh", { detail: { count } }),
    );

    try {
      // 用户主动重试：先解除后端 API 熔断守卫，否则刷新请求仍会被直接拒绝
      try {
        await invoke("reset_api_health");
      } catch (error) {
        logDebug("[Account] Failed to reset API health on manual refresh: " + error);
      }

      const result = await refreshAccountData();

      if (result.success && result.accounts) {
        setAccounts(result.accounts);
        setLastRefreshTime(new Date(result.refreshTime));
      }
      const parents = await getSklandAccounts();
      setSklandAccounts(parents);
      // 手动刷新成功且确实拿到了账户数据：账户已恢复可用
      if (result.success && result.accounts.length > 0) {
        clearAccountUnavailable();
      }
      // 手动刷新时同步更新森空岛用户资料（昵称/头像/游戏等级）
      for (const parent of parents) {
        void ensureSklandUserInfo(parent.userId, { force: true });
      }
      // 以及游戏图标列表
      if (parents[0]) {
        void ensureSklandGames(parents[0].userId, { force: true });
      }
    } catch (error) {
      logError("Failed to refresh data:", error);
    } finally {
      setIsRefreshing(false);
      setExpectedAccountCount(0);
    }
  };

  // 重试同步失败的账户
  const retrySyncAccount = async (accountId: string) => {
    logDebug("[Account] Retrying sync for account:", accountId);

    // 重新加载所有账户数据（这会触发后端的自动重试机制）
    await refreshData();

    // 如果当前选中的是失败的账户，确保它仍然被选中
    if (currentAccountId === accountId) {
      setCurrentAccountId(accountId);
    }
  };

  // 处理登出（先询问是否保留设备认证）
  const handleLogout = (account: Account) => {
    setLogoutTarget(account);
    setKeepDeviceAuth(true);
  };

  // 确认登出
  const handleConfirmLogout = async () => {
    if (!logoutTarget) return;
    setIsLoggingOut(true);
    try {
      const success = await apiLogoutAccount(logoutTarget.id, keepDeviceAuth);

      if (success) {
        // 从列表中移除
        setAccounts((prev) => {
          const next = prev.filter((acc) => acc.id !== logoutTarget!.id);
          // 如果登出的是当前选中的账户，自动选中下一个
          if (logoutTarget!.id === currentAccountId && next.length > 0) {
            setCurrentAccountId(next[0].id);
          } else if (logoutTarget!.id === currentAccountId) {
            setCurrentAccountId(null);
          }
          return next;
        });

        // 显示成功提示
        setGlobalAlert({
          type: "success",
          message: i18n.language === "zh" ? "登出成功" : "Logout successful",
        });
        addMessage({
          type: "info",
          title: i18n.language === "zh" ? "登出成功" : "Logout Successful",
          tag: "account",
        });
        setTimeout(() => setGlobalAlert(null), 3000);
      } else {
        setGlobalAlert({
          type: "danger",
          message: i18n.language === "zh" ? "登出失败" : "Logout failed",
        });
        addMessage({
          type: "urgent",
          title: i18n.language === "zh" ? "登出失败" : "Logout Failed",
          tag: "account",
        });
        setTimeout(() => setGlobalAlert(null), 3000);
      }
    } catch (error) {
      logError("Failed to logout:", error);
      setGlobalAlert({
        type: "danger",
        message:
          i18n.language === "zh"
            ? `登出错误: ${error}`
            : `Logout error: ${error}`,
      });
      addMessage({
        type: "urgent",
        title: i18n.language === "zh" ? "登出错误" : "Logout Error",
        body: String(error),
        tag: "account",
      });
      setTimeout(() => setGlobalAlert(null), 3000);
    } finally {
      setIsLoggingOut(false);
      setLogoutTarget(null);
    }
  };

  // 查看详情
  const handleViewDetails = (account: Account) => {
    setSelectedAccount(account);
    setIsDetailsModalOpen(true);
  };

  // 打开添加账户 Modal
  const handleOpenAddModal = () => {
    stopQrPolling();
    setLoginMethod(null);
    setPhone("");
    setPassword("");
    setVerificationCode("");
    setLoginError("");
    setCodeSentSuccess(false);
    setCountdown(0);
    setShowOtpInput(false);
    setIsOtpInvalid(false);
    setScanId("");
    setScanUrl("");
    setScanWaiting(true);
    setQrGenFailed(false);
    setIsNewDeviceVerify(false);
    setShowSklandConfirmation(false);
    setIsRoleSelectionOpen(false);
    setIsManagingSklandRoles(false);
    setReloginTarget(null);
    setReloginMismatchUserId("");
    setReloginProfile(null);
    setIsAddModalOpen(true);
  };

  // 关闭添加账户 Modal
  const handleCloseAddModal = () => {
    stopQrPolling();
    setLoginMethod(null);
    setPhone("");
    setPassword("");
    setVerificationCode("");
    setLoginError("");
    setCodeSentSuccess(false);
    setCountdown(0);
    setShowOtpInput(false);
    setIsOtpInvalid(false);
    setScanId("");
    setScanUrl("");
    setScanWaiting(true);
    setQrGenFailed(false);
    setIsNewDeviceVerify(false);
    setShowSklandConfirmation(false);
    setIsRoleSelectionOpen(false);
    setIsManagingSklandRoles(false);
    setReloginTarget(null);
    setReloginMismatchUserId("");
    setReloginProfile(null);
    // 清除角色选择状态 - 放弃这次登录
    setAvailableRoles([]);
    setSelectedRoles([]);
    setLoginCred("");
    setLoginToken("");
    setLoginUserId("");
    setIsAddModalOpen(false);
  };

  /**
   * 打开「重新登录」流程：不要求输入手机号，只需选择登录方式。
   *
   * 短信/密码方式会带出首次登录时记录的手机号（后端 `account_token_{userId}.phone`），
   * 扫码方式在授权成功后由后端校验是否为目标账户，不一致则整单拦截。
   */
  const handleOpenRelogin = (target: SklandAccount) => {
    stopQrPolling();
    setLoginMethod(null);
    setPhone(target.phone ?? "");
    setPassword("");
    setVerificationCode("");
    setLoginError("");
    setCodeSentSuccess(false);
    setCountdown(0);
    setShowOtpInput(false);
    setIsOtpInvalid(false);
    setScanId("");
    setScanUrl("");
    setScanWaiting(true);
    setQrGenFailed(false);
    setIsNewDeviceVerify(false);
    setShowSklandConfirmation(false);
    setIsRoleSelectionOpen(false);
    setIsManagingSklandRoles(false);
    setReloginMismatchUserId("");
    setReloginProfile(null);
    setReloginTarget(target);
    setIsAddModalOpen(true);
  };

  // 发送验证码并进入 OTP 输入页面
  const handleSendCodeAndShowOtp = async () => {
    if (!phone) {
      setPhoneError(
        i18n.language === "zh" ? "请输入手机号" : "Please enter phone number",
      );
      return;
    }

    // 校验手机号格式（11位数字）
    const phoneRegex = /^1[3-9]\d{9}$/;
    if (!phoneRegex.test(phone)) {
      setPhoneError(
        i18n.language === "zh"
          ? "请输入有效的11位手机号"
          : "Please enter a valid 11-digit phone number",
      );
      return;
    }

    setPhoneError(""); // 清除错误
    setIsSendingCode(true);
    setLoginError("");
    setCodeSentSuccess(false);

    try {
      const success = await sendVerificationCode({ phone, type: 2 });

      if (success) {
        // 开始倒计时
        setCountdown(60);
        const timer = setInterval(() => {
          setCountdown((prev) => {
            if (prev <= 1) {
              clearInterval(timer);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);

        // 显示成功提示
        logDebug("验证码发送成功，设置 codeSentSuccess 为 true");
        setCodeSentSuccess(true);

        // 进入 OTP 输入页面
        setShowOtpInput(true);
        setVerificationCode("");
        setIsOtpInvalid(false);
      } else {
        setLoginError(
          i18n.language === "zh"
            ? "发送验证码失败，请重试"
            : "Failed to send verification code",
        );
      }
    } catch (error) {
      logError("Send code error:", error);
      setLoginError(
        i18n.language === "zh" ? "发送验证码出错" : "Error sending code",
      );
    } finally {
      setIsSendingCode(false);
    }
  };

  // 新设备验证 - 选择用验证码登录（直接套用验证码登录流程）
  const handleVerifyWithCode = async () => {
    setIsNewDeviceVerify(false);
    setLoginMethod("sms");
    setShowOtpInput(false);
    setVerificationCode("");
    setIsOtpInvalid(false);
    await handleSendCodeAndShowOtp();
  };

  // 新设备验证 - 选择用扫码登录（直接套用扫码登录流程）
  const handleVerifyWithScan = () => {
    setIsNewDeviceVerify(false);
    setLoginMethod("qrcode");
  };

  // 处理登录
  const handleLogin = async () => {
    if (loginMethod === "phone") {
      // 密码登录
      if (!phone || !password) {
        if (!phone) {
          setPhoneError(
            i18n.language === "zh"
              ? "请输入手机号"
              : "Please enter phone number",
          );
        }
        setLoginError(
          i18n.language === "zh"
            ? "请输入手机号和密码"
            : "Please enter phone and password",
        );
        return;
      }

      // 校验手机号格式（11位数字）
      const phoneRegex = /^1[3-9]\d{9}$/;
      if (!phoneRegex.test(phone)) {
        setPhoneError(
          i18n.language === "zh"
            ? "请输入有效的11位手机号"
            : "Please enter a valid 11-digit phone number",
        );
        return;
      }
    } else if (loginMethod === "sms") {
      // 验证码登录 - 检查是否有验证码
      if (!phone) {
        setPhoneError(
          i18n.language === "zh" ? "请输入手机号" : "Please enter phone number",
        );
        return;
      }

      // 校验手机号格式（11位数字）
      const phoneRegex = /^1[3-9]\d{9}$/;
      if (!phoneRegex.test(phone)) {
        setPhoneError(
          i18n.language === "zh"
            ? "请输入有效的11位手机号"
            : "Please enter a valid 11-digit phone number",
        );
        return;
      }

      // 如果还没有显示 OTP 输入框，先发送验证码
      if (!showOtpInput) {
        await handleSendCodeAndShowOtp();
        return;
      }

      // 如果有 OTP 输入框，检查验证码
      if (!verificationCode) {
        setLoginError(
          i18n.language === "zh"
            ? "请输入验证码"
            : "Please enter verification code",
        );
        return;
      }
    }

    setPhoneError(""); // 清除错误
    setIsLoggingIn(true);
    setLoginError("");
    setReloginMismatchUserId("");

    try {
      let result: LoginResult;

      // 重新登录时把目标 userId 传给后端：登录到别的账户会被拦截
      const expectedUserId = reloginTarget?.userId;

      if (loginMethod === "phone") {
        // 密码登录
        result = await addAccount({
          phone,
          password,
          expectedUserId,
        });
      } else {
        // 验证码登录
        result = await addAccountByCode({
          phone,
          code: verificationCode,
          expectedUserId,
        });
      }

      // 调试：打印完整结果
      logger.info("Login result: " + JSON.stringify(result), "Account");

      await processLoginResult(result);
    } catch (error) {
      logger.error("Login error: " + error, "Account");
      setLoginError(
        i18n.language === "zh" ? "登录过程中发生错误" : "Error during login",
      );
    } finally {
      setIsLoggingIn(false);
    }
  };

  // 处理登录结果（成功 / 选择角色 / 失败）
  const processLoginResult = async (result: LoginResult) => {
    // 重新登录：拿到的是父级森空岛凭证（cred/token/userId），直接更新该账户凭证，
    // 保留原有角色绑定，不需要重新走一遍「确认绑定 → 选择角色」。
    if (
      reloginTarget &&
      result.success &&
      result.cred &&
      result.token &&
      result.userId
    ) {
      await finishRelogin(result.cred, result.token, result.userId);
      return;
    }

    if (result.success && result.account) {
      // 登录成功：先解除后端 API 熔断守卫（否则随后的刷新仍会被拦截）
      clearAccountUnavailable();
      try {
        await invoke("reset_api_health");
      } catch (error) {
        logDebug("[Account] Failed to reset API health: " + error);
      }

      // 刷新账户列表
      const accounts = await getAccounts();
      setAccounts(accounts || []);

      // 自动选中新登录的账户
      await apiSetSelectedAccount(result.account.id);
      setCurrentAccountId(result.account.id);

      // 通知侧边栏更新
      window.dispatchEvent(new CustomEvent("accountChanged"));

      // 关闭 Modal
      handleCloseAddModal();

      // 显示全局成功提示
      setGlobalAlert({
        type: "success",
        message:
          i18n.language === "zh"
            ? `登录成功！欢迎，${result.account.nickname}`
            : `Login successful! Welcome, ${result.account.nickname}`,
      });
      addMessage({
        type: "info",
        title: i18n.language === "zh" ? "登录成功" : "Login Successful",
        body:
          i18n.language === "zh"
            ? `欢迎，${result.account.nickname}`
            : `Welcome, ${result.account.nickname}`,
        tag: "account",
      });

      // 5秒后自动清除 Alert
      setTimeout(() => {
        setGlobalAlert(null);
      }, 5000);
    } else if (result.success && result.cred && result.token && result.userId) {
      setLoginCred(result.cred);
      setLoginToken(result.token);
      setLoginUserId(result.userId);
      setAvailableRoles(result.availableRoles || []);
      setSelectedRoles(
        accounts
          .filter((account) => account.userId === result.userId)
          .map((account) => account.id),
      );
      setIsManagingSklandRoles(false);
      setShowSklandConfirmation(true);
      // 确认页展示头像/昵称：用刚登录得到的 cred/token 拉一次森空岛用户资料
      void loadReloginProfile(result.cred, result.token);
    } else if (
      result.success &&
      result.availableRoles &&
      result.availableRoles.length > 0
    ) {
      if (result.availableRoles.length === 1) {
        // 仅一个角色，无需选择，直接绑定
        await saveRoles(
          result.availableRoles,
          result.cred || "",
          result.token || "",
          result.userId || "",
        );
        return;
      }
      // 需要选择角色 - 直接在当前 Modal 中显示
      setAvailableRoles(result.availableRoles);
      setLoginCred(result.cred || "");
      setLoginToken(result.token || "");
      setLoginUserId(result.userId || "");
      setSelectedRoles([]); // 重置选择
    } else {
      // 重新登录时授权到了别的森空岛账户：后端整单拦截，未保存任何凭证
      const mismatchMatch = result.errorMessage?.match(
        /^ACCOUNT_MISMATCH(?::(.*))?$/,
      );
      if (mismatchMatch) {
        const actualUserId = mismatchMatch[1] || "";
        setReloginMismatchUserId(actualUserId);
        setLoginError(
          t("settings.account.relogin_mismatch", {
            actual: actualUserId || "unknown",
          }),
        );
        // 清掉不可用的登录结果，避免继续用错误账户的授权信息
        setLoginCred("");
        setLoginToken("");
        setLoginUserId("");
        setAvailableRoles([]);
        setSelectedRoles([]);
        setScanId("");
        setScanUrl("");
        setScanWaiting(true);
        setIsOtpInvalid(false);
        setIsNewDeviceVerify(false);
        setShowOtpInput(false);
        setVerificationCode("");
        // 回到「方式选择」，让用户直接换一种方式或换账号重试
        setLoginMethod(null);
        return;
      }

      // 登录失败
      if (
        loginMethod === "phone" &&
        result.errorMessage === "NEW_DEVICE_VERIFICATION_REQUIRED"
      ) {
        // 新设备需要验证 - 让用户选择验证码登录或扫码登录
        setIsNewDeviceVerify(true);
        setVerificationCode("");
        setIsOtpInvalid(false);
        setLoginError("");
        return;
      }
      if (loginMethod === "sms" || isNewDeviceVerify) {
        setIsOtpInvalid(true);
        setLoginError(
          result.errorMessage ||
            (i18n.language === "zh"
              ? "验证码错误，请重试"
              : "Invalid verification code, please try again"),
        );
      } else {
        setLoginError(
          result.errorMessage ||
            (i18n.language === "zh"
              ? "登录失败，请重试"
              : "Login failed, please try again"),
        );
      }
    }
  };

  // 停止扫码轮询
  const stopQrPolling = () => {
    if (qrPollTimerRef.current) {
      clearInterval(qrPollTimerRef.current);
      qrPollTimerRef.current = null;
    }
    setIsPollingScan(false);
  };

  // 生成扫码登录二维码并开始轮询
  const handleStartQrLogin = async () => {
    setIsGeneratingQr(true);
    setLoginError("");
    setScanWaiting(true);
    setQrGenFailed(false);
    try {
      const info = await genScanLogin();
      if (!info || !info.scanId || !info.scanUrl) {
        setQrGenFailed(true);
        setLoginError(t("settings.account.qr_fetch_failed"));
        return;
      }
      setScanId(info.scanId);
      setScanUrl(info.scanUrl);
      startQrPolling(info.scanId);
    } catch (error) {
      logError("Generate scan login error:", error);
      setQrGenFailed(true);
      setLoginError(t("settings.account.qr_gen_error"));
    } finally {
      setIsGeneratingQr(false);
    }
  };

  // 轮询扫码状态
  const startQrPolling = (id: string) => {
    stopQrPolling();
    setIsPollingScan(true);
    qrPollTimerRef.current = setInterval(async () => {
      const result = await scanStatus(id);
      if (!result) return; // 查询失败，继续轮询
      if (result.status === 0 && result.scanCode) {
        // 手机端确认成功
        stopQrPolling();
        if (!isMountedRef.current) return;
        await handleScanSuccess(result.scanCode);
      } else if (result.status !== 100) {
        // 已扫码（或其它中间状态），等待手机端确认
        if (isMountedRef.current) setScanWaiting(false);
      } else {
        // 等待扫码
        if (isMountedRef.current) setScanWaiting(true);
      }
      // 其他状态：继续轮询
    }, 1000);
  };

  // 扫码成功后用 scanCode 换取账户
  const handleScanSuccess = async (scanCode: string) => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    setLoginError("");
    try {
      // 重新登录时把目标 userId 传给后端：扫到别的账户会被拦截（不保存凭证）
      const result = await addAccountByScan(scanCode, reloginTarget?.userId);
      logger.info("Scan login result: " + JSON.stringify(result), "Account");
      await processLoginResult(result);
    } catch (error) {
      logger.error("Scan login error: " + error, "Account");
      setLoginError(t("settings.account.scan_login_error"));
    } finally {
      setIsLoggingIn(false);
    }
  };

  // 处理角色选择成功
  const handleConfirmRoles = async () => {
    if (availableRoles.length === 0) {
      handleCloseAddModal();
      return;
    }
    if (
      selectedRoles.length === 0 &&
      availableRoles.length > 0 &&
      !isManagingSklandRoles
    ) {
      setLoginError(
        i18n.language === "zh"
          ? "请至少选择一个角色"
          : "Please select at least one role",
      );
      return;
    }

    // 获取选中角色的完整信息
    const selectedRoleDetails = availableRoles.filter((role) =>
      selectedRoles.includes(role.roleId),
    );

    await saveRoles(selectedRoleDetails, loginCred, loginToken, loginUserId);
  };

  /**
   * 确认森空岛账户页面加载头像/昵称。
   *
   * 此时账户尚未保存，不能用 `get_skland_user_info`（按 userId 读本地配置），
   * 因此用刚登录得到的 cred/token 直接请求；失败不影响确认流程。
   */
  const loadReloginProfile = async (cred?: string, token?: string) => {
    const finalCred = cred || loginCred;
    const finalToken = token || loginToken;
    if (!finalCred || !finalToken) return;
    setReloginProfile(null);
    try {
      const info = await getSklandUserInfoByCred(finalCred, finalToken);
      if (isMountedRef.current && info) setReloginProfile(info);
    } catch (error) {
      logDebug("[Account] Failed to load Skland profile for confirmation: " + error);
    }
  };

  /**
   * 重新登录完成：写回该森空岛账户的凭证（保留已绑定的游戏角色）。
   *
   * `save_skland_account` 只更新 `cred`/`token`/`skland_account_bound`，
   * 不会动 `roles`/`hytoken` 等已有字段，因此角色绑定不会丢失。
   */
  const finishRelogin = async (cred: string, token: string, userId: string) => {
    setIsLoading(true);
    try {
      const saved = await saveSklandAccount(cred, token, userId);
      if (!saved) throw new Error("Failed to save Skland account");
      clearAccountUnavailable();
      setReloginMismatchUserId("");
      handleCloseAddModal();
      // refreshData 内部会先 reset_api_health 解除熔断，再拉取账户数据
      await refreshData();
      setGlobalAlert({
        type: "success",
        message: t("settings.account.relogin_success"),
      });
      addMessage({
        type: "info",
        title: t("settings.account.relogin"),
        body: t("settings.account.relogin_success"),
        tag: "account",
      });
      setTimeout(() => setGlobalAlert(null), 5000);
    } catch (error) {
      logError("Failed to finish re-login:", error);
      setLoginError(String(error));
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmSklandAccount = async () => {
    setIsLoading(true);
    setLoginError("");
    try {
      const saved = await saveSklandAccount(loginCred, loginToken, loginUserId);
      if (!saved) throw new Error("Failed to save Skland account");
      setSklandAccounts(await getSklandAccounts());
      const result = await getSklandAccountRoles(loginUserId);
      if (!result.success || !result.cred || !result.token) {
        throw new Error(result.errorMessage || "Failed to load game roles");
      }
      setLoginCred(result.cred);
      setLoginToken(result.token);
      setAvailableRoles(result.availableRoles || []);
      setSelectedRoles(
        accounts
          .filter((account) => account.userId === loginUserId)
          .map((account) => account.id),
      );
      setShowSklandConfirmation(false);
      setIsRoleSelectionOpen(true);
    } catch (error) {
      setLoginError(String(error));
    } finally {
      setIsLoading(false);
    }
  };

  // 保存角色绑定并刷新账户列表
  const saveRoles = async (
    roleDetails: RoleDisplayInfo[],
    cred: string,
    token: string,
    userId: string,
  ) => {
    setIsLoading(true);
    try {
      // 调用后端保存
      await saveSelectedRoles(cred, token, userId, roleDetails);

      // 刷新账户列表
      const accounts = await getAccounts();
      setAccounts(accounts || []);
      setSklandAccounts(await getSklandAccounts());

      const preferredAccount = isManagingSklandRoles
        ? accounts.find((account) => account.id === currentAccountId) ||
          accounts[0]
        : accounts.find((account) => account.userId === userId) || accounts[0];
      if (preferredAccount) {
        await apiSetSelectedAccount(preferredAccount.id);
        setCurrentAccountId(preferredAccount.id);
        window.dispatchEvent(new CustomEvent("accountChanged"));
      } else if (currentAccountId) {
        await apiSetSelectedAccount("");
        setCurrentAccountId(null);
        window.dispatchEvent(new CustomEvent("accountChanged"));
      }

      // 关闭模态并清空表单
      handleCloseAddModal();

      // 登录/绑定完成：清除账户不可用状态（refreshData 会同时解除后端 API 熔断守卫）
      clearAccountUnavailable();
      await refreshData();

      setGlobalAlert({
        type: "success",
        message:
          i18n.language === "zh" ? "角色绑定成功" : "Roles bound successfully",
      });
      setTimeout(() => setGlobalAlert(null), 5000);
    } catch (error) {
      logger.error("Failed to save roles: " + error, "Account");
      setLoginError(
        i18n.language === "zh" ? `保存失败: ${error}` : `Save failed: ${error}`,
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleManageSklandRoles = async (userId: string) => {
    setIsLoading(true);
    try {
      const result = await getSklandAccountRoles(userId);
      if (!result.success || !result.cred || !result.token) {
        throw new Error(result.errorMessage || "Failed to load game roles");
      }
      setLoginCred(result.cred);
      setLoginToken(result.token);
      setLoginUserId(userId);
      setAvailableRoles(result.availableRoles || []);
      setSelectedRoles(
        accounts
          .filter((account) => account.userId === userId)
          .map((account) => account.id),
      );
      setIsManagingSklandRoles(true);
      setShowSklandConfirmation(false);
      setIsRoleSelectionOpen(true);
      setLoginError("");
      setIsAddModalOpen(true);
    } catch (error) {
      setGlobalAlert({ type: "danger", message: String(error) });
      setTimeout(() => setGlobalAlert(null), 5000);
    } finally {
      setIsLoading(false);
    }
  };

  // 读取森空岛用户资料（昵称、头像、游戏等级等），后端会同时写入本地缓存
  const ensureSklandUserInfo = async (
    userId: string,
    options?: { force?: boolean },
  ) => {
    if (!options?.force && sklandUserInfos[userId]) return;
    if (sklandUserInfoRequestsRef.current.has(userId)) return;

    sklandUserInfoRequestsRef.current.add(userId);
    // 重新请求前清掉上一次的错误，让弹窗回到加载态
    setSklandUserInfoErrors((previous) => {
      if (!(userId in previous)) return previous;
      const next = { ...previous };
      delete next[userId];
      return next;
    });
    try {
      const info = await getSklandUserInfo(userId);
      if (isMountedRef.current) {
        setSklandUserInfos((previous) => ({ ...previous, [userId]: info }));
      }
    } catch (error) {
      // 资料获取失败不影响账户列表与角色绑定
      logError(`Failed to load Skland user info for ${userId}:`, error);
      if (isMountedRef.current) {
        setSklandUserInfoErrors((previous) => ({
          ...previous,
          [userId]: String(error),
        }));
      }
    } finally {
      sklandUserInfoRequestsRef.current.delete(userId);
    }
  };

  // 读取森空岛游戏列表（游戏图标），后端带 12 小时缓存
  const ensureSklandGames = async (userId: string, options?: { force?: boolean }) => {
    if (!options?.force && sklandGames.length > 0) return;
    if (sklandGamesLoadingRef.current) return;

    sklandGamesLoadingRef.current = true;
    try {
      const games = await getSklandGames(userId, options?.force ?? false);
      if (isMountedRef.current) setSklandGames(games);
    } catch (error) {
      // 图标属于附加信息，失败时降级为文字占位
      logError("Failed to load Skland game list:", error);
    } finally {
      sklandGamesLoadingRef.current = false;
    }
  };

  // 打开森空岛资料 Modal（未加载过时按需拉取资料与游戏列表）
  const handleOpenSklandProfile = (userId: string) => {
    setProfileSklandId(userId);
    void ensureSklandUserInfo(userId);
    void ensureSklandGames(userId);
  };

  const handleExpandSklandAccount = async (userId: string) => {
    if (expandedSklandId === userId) {
      setExpandedSklandId(null);
      return;
    }
    setExpandedSklandId(userId);
    // 展开时按需拉取森空岛用户资料（已获取过则直接使用缓存）
    void ensureSklandUserInfo(userId);
    if (sklandRoleSets[userId]) return;

    setLoadingSklandId(userId);
    setRoleLoadErrors((previous) => ({ ...previous, [userId]: "" }));
    try {
      const result = await getSklandAccountRoles(userId);
      if (!result.success || !result.cred || !result.token) {
        throw new Error(result.errorMessage || "Failed to load game roles");
      }
      setSklandRoleSets((previous) => ({
        ...previous,
        [userId]: {
          roles: result.availableRoles || [],
          cred: result.cred!,
          token: result.token!,
        },
      }));
    } catch (error) {
      setRoleLoadErrors((previous) => ({
        ...previous,
        [userId]: String(error),
      }));
    } finally {
      setLoadingSklandId(null);
    }
  };

  const handleToggleGameRole = async (
    userId: string,
    role: RoleDisplayInfo,
    currentlyBound: boolean,
  ) => {
    const roleSet = sklandRoleSets[userId];
    if (!roleSet) return;

    const key = `${userId}:${role.serverId}:${role.roleId}`;
    setSavingRoleKey(key);
    try {
      const existingBoundRoles = accounts
        .filter((account) => account.userId === userId)
        .map((account) => account.id);
      const selectedIds = new Set(existingBoundRoles);
      if (currentlyBound) selectedIds.delete(role.roleId);
      else selectedIds.add(role.roleId);

      const selectedRoles = roleSet.roles.filter((candidate) =>
        selectedIds.has(candidate.roleId),
      );
      await saveSelectedRoles(
        roleSet.cred,
        roleSet.token,
        userId,
        selectedRoles,
      );

      const updatedAccounts = await getAccounts();
      setAccounts(updatedAccounts);
      setSklandAccounts(await getSklandAccounts());

      if (
        currentAccountId &&
        !updatedAccounts.some((account) => account.id === currentAccountId)
      ) {
        const nextAccount = updatedAccounts[0];
        if (nextAccount) {
          await apiSetSelectedAccount(nextAccount.id);
          setCurrentAccountId(nextAccount.id);
        } else {
          await apiSetSelectedAccount("");
          setCurrentAccountId(null);
        }
        window.dispatchEvent(new CustomEvent("accountChanged"));
      }
    } catch (error) {
      setGlobalAlert({ type: "danger", message: String(error) });
      setTimeout(() => setGlobalAlert(null), 5000);
    } finally {
      setSavingRoleKey(null);
    }
  };

  // 切换角色选择
  const handleRoleToggle = (roleId: string) => {
    setSelectedRoles((prev) =>
      prev.includes(roleId)
        ? prev.filter((id) => id !== roleId)
        : [...prev, roleId],
    );
  };

  // 选中账户
  const handleSelectAccount = async (accountId: string) => {
    if (accountId === currentAccountId) return; // 如果点击的是当前选中的，不做任何操作

    logger.info("Selecting account: " + accountId, "Account");
    setPreviousAccountId(currentAccountId); // 记录上一个选中的账户
    setIsAnimating(true); // 开始动画
    setCurrentAccountId(accountId);

    // 调用API保存选中的账户，同时获取配置
    try {
      const [success, shouldRefresh] = await Promise.all([
        apiSetSelectedAccount(accountId),
        getConfig<boolean>("refresh_on_account_switch"),
      ]);
      logger.info("Set selected account result: " + success, "Account");
      logger.info("Should refresh on switch: " + shouldRefresh, "Account");

      if (!success) {
        logger.error("Failed to set selected account in backend", "Account");
        return;
      }

      if (shouldRefresh) {
        // 如果需要刷新，调用API获取最新数据
        logger.info("Refreshing account data from API...", "Account");
        const result = await refreshAccountData();
        if (result.success && result.accounts) {
          setAccounts(result.accounts);
        }
      } else {
        // 如果不需要刷新，直接从后端获取
        logger.info("Fetching account data from backend", "Account");
        const accountsData = await getAccounts();
        if (accountsData && accountsData.length > 0) {
          setAccounts(accountsData);
        }
      }

      // 确保后端保存成功后，再触发自定义事件通知侧边栏更新
      logger.info("Dispatching accountChanged event", "Account");
      window.dispatchEvent(new CustomEvent("accountChanged"));
    } catch (error) {
      logger.error("Failed to set selected account: " + error, "Account");
    }

    // 动画结束后重置状态
    setTimeout(() => {
      setIsAnimating(false);
      setPreviousAccountId(null);
    }, 300); // 与动画时长一致
  };

  // 获取排序后的账户列表（选中的置顶，EXPIRED 排第二，其余按字典序）
  const getSortedAccounts = (): Account[] => {
    const sorted = [...accounts];

    // 按优先级排序：ACTIVE (isSelected) > EXPIRED > 其他
    const activeAccounts: Account[] = [];
    const expiredAccounts: Account[] = [];
    const normalAccounts: Account[] = [];

    sorted.forEach((acc) => {
      if (acc.id === currentAccountId) {
        activeAccounts.push(acc);
      } else if (acc.syncStatus === "HYTOKEN_EXPIRED") {
        expiredAccounts.push(acc);
      } else {
        normalAccounts.push(acc);
      }
    });

    // 对各类别内的账户按 nickname 字典序排序
    activeAccounts.sort((a, b) => a.nickname.localeCompare(b.nickname));
    expiredAccounts.sort((a, b) => a.nickname.localeCompare(b.nickname));
    normalAccounts.sort((a, b) => a.nickname.localeCompare(b.nickname));

    return [...activeAccounts, ...expiredAccounts, ...normalAccounts];
  };

  const sortedAccounts = getSortedAccounts();

  // 分页相关状态
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(1); // 初始为1，等待计算
  const CARD_HEIGHT = 80; // 固定卡片高度（像素）
  const GAP_SIZE = 5; // 卡片间距（像素）
  const containerRef = useRef<HTMLDivElement | null>(null);

  // 使用 ResizeObserver 动态计算每页能显示的账户数量
  useEffect(() => {
    const calculateItemsPerPage = () => {
      if (!containerRef.current) {
        logger.info("containerRef not ready", "Account");
        return;
      }

      // 使用窗口高度减去固定的顶部区域
      const topOffset = 250;
      const windowHeight = window.innerHeight;
      const availableHeight = windowHeight - topOffset;

      logger.info(
        "Window height: " +
          windowHeight +
          " Available height: " +
          availableHeight,
        "Account",
      );

      if (availableHeight <= 0) {
        logger.info("Available height is 0 or negative", "Account");
        return;
      }

      // 分页组件高度约 60px
      const paginationHeight = 60;
      const contentAvailableHeight = availableHeight - paginationHeight;

      logger.info(
        "Content available height: " + contentAvailableHeight,
        "Account",
      );

      if (contentAvailableHeight <= 0) {
        logger.info(
          "Content available height is 0 or negative, setting to 1",
          "Account",
        );
        setItemsPerPage(1);
        return;
      }

      // 计算能容纳的卡片数量
      let count = 0;
      let usedHeight = 0;

      while (count < 100) {
        const cardHeight = CARD_HEIGHT + (count > 0 ? GAP_SIZE : 0);
        if (usedHeight + cardHeight > contentAvailableHeight) {
          logger.info(
            "Break at count: " +
              count +
              " usedHeight: " +
              usedHeight +
              " cardHeight: " +
              cardHeight,
            "Account",
          );
          break;
        }
        usedHeight += cardHeight;
        count++;
      }

      // 至少显示1个
      const newCount = Math.max(1, count);
      logger.info(
        "Calculated items per page: " + newCount + " current: " + itemsPerPage,
        "Account",
      );

      if (newCount !== itemsPerPage) {
        setItemsPerPage(newCount);
      }
    };

    // 初始计算（延迟一下确保 DOM 已渲染）
    const timer = setTimeout(calculateItemsPerPage, 100);

    // 监听窗口大小变化
    window.addEventListener("resize", calculateItemsPerPage);

    // 使用 ResizeObserver 监听父容器大小变化
    let resizeObserver: ResizeObserver | null = null;
    if (containerRef.current?.parentElement) {
      resizeObserver = new ResizeObserver(() => {
        calculateItemsPerPage();
      });
      resizeObserver.observe(containerRef.current.parentElement);
    }

    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", calculateItemsPerPage);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, []); // 移除 itemsPerPage 依赖，避免循环

  // 获取当前页的账户
  const getCurrentPageAccounts = (): Account[] => {
    logger.info(
      "getCurrentPageAccounts - total: " +
        accounts.length +
        " sorted: " +
        sortedAccounts.length +
        " currentPage: " +
        currentPage +
        " itemsPerPage: " +
        itemsPerPage,
      "Account",
    );
    if (accounts.length === 0) return [];
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const result = sortedAccounts.slice(startIndex, endIndex);
    logger.info(
      "getCurrentPageAccounts - returning: " + result.length + " accounts",
      "Account",
    );
    return result;
  };

  const totalPages = Math.ceil(accounts.length / itemsPerPage);
  const currentPageAccounts = getCurrentPageAccounts();

  // 当账户列表或每页数量变化时，重置到第一页
  useEffect(() => {
    setCurrentPage(1);
  }, [accounts.length, itemsPerPage]);

  // 使用 ResizeObserver 动态计算每页显示数量

  // 渲染骨架屏
  const renderSkeleton = () => {
    // 如果在刷新状态且有预期数量，使用预期数量；否则使用当前计算的每页数量
    const skeletonCount =
      isRefreshing && expectedAccountCount > 0
        ? Math.min(expectedAccountCount, itemsPerPage)
        : itemsPerPage;

    return (
      <div className="space-y-[5px]">
        {[...Array(skeletonCount)].map((_, index) => (
          <GlassCard
            key={index}
            className="p-4 glass-surface border border-separator/90"
            style={{ height: `${CARD_HEIGHT}px` }}
          >
            <div className="flex items-center gap-4 h-full">
              <GlassSkeleton className="w-12 h-12 rounded-full" />
              <div className="flex-1 space-y-2">
                <GlassSkeleton className="w-32 h-4 rounded-lg bg-gradient-to-r from-default-200 to-default-100 animate-pulse" />
                <GlassSkeleton className="w-24 h-3 rounded-lg bg-gradient-to-r from-default-200 to-default-100 animate-pulse" />
              </div>
              <div className="flex gap-2">
                <GlassSkeleton className="w-20 h-8 rounded-lg bg-gradient-to-r from-default-200 to-default-100 animate-pulse" />
                <GlassSkeleton className="w-20 h-8 rounded-lg bg-gradient-to-r from-default-200 to-default-100 animate-pulse" />
              </div>
            </div>
          </GlassCard>
        ))}
      </div>
    );
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-12 relative">
      {/* 全局 Alert - 浮动覆盖 */}
      {globalAlert && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 animate-slide-down">
          <GlassAlert
            status={globalAlert.type}
            className="shadow-lg min-w-[300px] max-w-[500px] rounded-xl"
          >
            <GlassAlert.Indicator />
            <GlassAlert.Content>
              <GlassAlert.Description>
                {globalAlert.message}
              </GlassAlert.Description>
            </GlassAlert.Content>
          </GlassAlert>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-foreground tracking-tight">
            {t("settings.account.title")}
          </h1>
          <p className="text-foreground/70 mt-1.5">
            {t("settings.account.subtitle")}
          </p>
        </div>

        <div className="flex gap-2">
          <GlassButton
            variant="ghost"
            onPress={refreshData}
            isDisabled={isRefreshing}
            className="glass-surface border border-separator/70"
          >
            {isRefreshing
              ? t("settings.account.refreshing")
              : t("settings.account.refresh_data")}
          </GlassButton>
          <GlassButton variant="primary" onPress={handleOpenAddModal}>
            {t("settings.account.add_account")}
          </GlassButton>
        </div>
      </div>

      {/* Last refresh time */}
      {lastRefreshTime && (
        <div className="text-sm text-muted/60">
          {t("settings.account.last_refresh")}:{" "}
          {lastRefreshTime.toLocaleString(
            i18n.language === "zh" ? "zh-CN" : "en-US",
          )}
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">
            {t("settings.account.skland_accounts")}
          </h2>
          <span className="text-xs text-muted">{sklandAccounts.length}</span>
        </div>

        {isLoading ? (
          <GlassCard className="account-glass-panel p-5">
            <div className="flex items-center gap-3 text-sm text-muted">
              <GlassSpinner color="primary" size="sm" />
              {t("settings.account.loading")}
            </div>
          </GlassCard>
        ) : sklandAccounts.length === 0 ? (
          <GlassCard className="account-glass-panel p-6 space-y-3">
            {accountAvailability ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm font-semibold text-danger">
                      {t("settings.account.account_unavailable_title")}
                    </p>
                    <p className="text-xs leading-relaxed text-foreground/75">
                      {t(
                        `settings.account.account_unavailable_${accountAvailability.reason}`,
                      )}
                    </p>
                    {accountAvailability.message && (
                      <p className="break-all text-[11px] text-muted">
                        {t("settings.account.account_unavailable_detail")}:{" "}
                        {accountAvailability.message}
                      </p>
                    )}
                  </div>
                  <GlassButton
                    size="sm"
                    variant="outline"
                    onPress={refreshData}
                    isDisabled={isRefreshing}
                    className="shrink-0"
                  >
                    {isRefreshing
                      ? t("settings.account.refreshing")
                      : t("settings.account.retry_later")}
                  </GlassButton>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted">
                {t("settings.account.no_accounts")}
              </p>
            )}
          </GlassCard>
        ) : (
          <div className="space-y-3">
            {sklandAccounts.map((sklandAccount) => {
              const isExpanded = expandedSklandId === sklandAccount.userId;
              const roleSet = sklandRoleSets[sklandAccount.userId];
              const userInfo = sklandUserInfos[sklandAccount.userId];
              const accountAvatar = userInfo?.avatar || sklandAccount.avatar;
              const accountNickname =
                userInfo?.nickname || sklandAccount.nickname;
              const boundRoles = accounts.filter(
                (account) => account.userId === sklandAccount.userId,
              );
              const boundRoleIds = new Set(boundRoles.map((role) => role.id));
              const allRoles = roleSet?.roles || [];
              const boundRoleDetails = allRoles.filter((role) =>
                boundRoleIds.has(role.roleId),
              );
              const unboundRoleDetails = allRoles.filter(
                (role) => !boundRoleIds.has(role.roleId),
              );
              // 账户数据不可用：
              // 1) 全局可用状态（凭证失效 / 数美指纹接口异常 / 网络故障）
              // 2) 该账户下所有游戏角色都是 HYTOKEN_EXPIRED（凭证已失效，需要重新登录）
              const hasExpiredRoles =
                boundRoles.length > 0 &&
                boundRoles.every((role) => role.syncStatus === "HYTOKEN_EXPIRED");
              const unavailable: AccountAvailability | null = hasExpiredRoles
                ? {
                    reason: "auth",
                    message: "",
                    since: accountAvailability?.since ?? new Date().toISOString(),
                  }
                : accountAvailability;

              return (
                <article
                  key={sklandAccount.userId}
                  className={`account-glass-panel overflow-hidden rounded-xl border shadow-sm ${
                    unavailable
                      ? "border-danger/40"
                      : "border-separator/70"
                  }`}
                >
                  {unavailable && (
                    <div className="border-b border-danger/25 bg-danger/5 px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="text-sm font-semibold text-danger">
                            {t("settings.account.account_unavailable_title")}
                          </p>
                          <p className="text-xs leading-relaxed text-foreground/75">
                            {t(
                              `settings.account.account_unavailable_${unavailable.reason}`,
                            )}
                          </p>
                          {unavailable.message && (
                            <p className="break-all text-[11px] text-muted">
                              {t("settings.account.account_unavailable_detail")}:{" "}
                              {unavailable.message}
                            </p>
                          )}
                        </div>
                        <GlassButton
                          size="sm"
                          variant="primary"
                          onPress={() => handleOpenRelogin(sklandAccount)}
                          className="shrink-0"
                        >
                          {t("settings.account.relogin")}
                        </GlassButton>
                      </div>
                    </div>
                  )}
                  <div className="flex w-full items-center gap-2 p-4 transition-colors hover:bg-white/10">
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      onClick={() =>
                        handleExpandSklandAccount(sklandAccount.userId)
                      }
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-primary/30 bg-primary/10 text-sm font-semibold text-primary">
                        {accountAvatar ? (
                          <Img
                            src={accountAvatar}
                            alt={accountNickname || sklandAccount.userId}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          "S"
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {accountNickname ||
                            t("settings.account.skland_account")}
                        </p>
                        <p className="truncate text-xs text-muted">
                          {sklandAccount.userId}
                        </p>
                      </div>
                      <span className="hidden shrink-0 text-xs text-muted sm:block">
                        {t("settings.account.bound_role_count", {
                          count: boundRoles.length,
                        })}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleOpenSklandProfile(sklandAccount.userId)
                      }
                      aria-label={t("settings.account.skland_profile")}
                      title={t("settings.account.skland_profile")}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-separator/60 text-muted transition-colors hover:bg-white/10 hover:text-foreground active:scale-95"
                    >
                      <InfoIcon size={16} />
                    </button>
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      onClick={() =>
                        handleExpandSklandAccount(sklandAccount.userId)
                      }
                      aria-label={t("settings.account.manage_game_roles")}
                      title={t("settings.account.manage_game_roles")}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-white/10 hover:text-foreground"
                    >
                      <ChevronDownIcon
                        size={18}
                        className={`transition-transform duration-300 ease-out ${isExpanded ? "rotate-180" : ""}`}
                      />
                    </button>
                  </div>

                  {/* 展开区域：grid-template-rows 过渡，实现平滑的高度动画 */}
                  <div
                    aria-hidden={!isExpanded}
                    inert={!isExpanded}
                    className={`account-glass-inner grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-out ${
                      isExpanded
                        ? "grid-rows-[1fr] border-t border-separator/60 opacity-100"
                        : "grid-rows-[0fr] border-t-0 opacity-0"
                    }`}
                  >
                    <div className="min-h-0 overflow-hidden">
                      <div
                        className={`p-4 transition-transform duration-300 ease-out sm:p-5 ${
                          isExpanded ? "translate-y-0" : "-translate-y-2"
                        }`}
                      >
                        {loadingSklandId === sklandAccount.userId ? (
                          <div className="flex items-center justify-center gap-3 py-8 text-sm text-muted">
                            <GlassSpinner color="primary" size="sm" />
                            {t("settings.account.loading_game_roles")}
                          </div>
                        ) : roleLoadErrors[sklandAccount.userId] ? (
                          <p className="py-5 text-center text-sm text-danger">
                            {roleLoadErrors[sklandAccount.userId]}
                          </p>
                        ) : roleSet ? (
                          <div className="grid gap-5 lg:grid-cols-2">
                            <RoleGroup
                              title={t("settings.account.bound_game_roles")}
                              count={boundRoleDetails.length}
                              emptyLabel={t(
                                "settings.account.no_bound_game_roles",
                              )}
                            >
                              {boundRoleDetails.map((role) => {
                                const key = `${sklandAccount.userId}:${role.serverId}:${role.roleId}`;
                                return (
                                  <GameRoleRow
                                    key={key}
                                    role={role}
                                    isBound={true}
                                    isActive={currentAccountId === role.roleId}
                                    actionLabel={t(
                                      "settings.account.unbind_role",
                                    )}
                                    isBusy={savingRoleKey === key}
                                    isDisabled={savingRoleKey !== null}
                                    onSetActive={() =>
                                      handleSelectAccount(role.roleId)
                                    }
                                    onAction={() =>
                                      handleToggleGameRole(
                                        sklandAccount.userId,
                                        role,
                                        true,
                                      )
                                    }
                                  />
                                );
                              })}
                            </RoleGroup>
                            <RoleGroup
                              title={t("settings.account.unbound_game_roles")}
                              count={unboundRoleDetails.length}
                              emptyLabel={t(
                                "settings.account.no_unbound_game_roles",
                              )}
                            >
                              {unboundRoleDetails.map((role) => {
                                const key = `${sklandAccount.userId}:${role.serverId}:${role.roleId}`;
                                return (
                                  <GameRoleRow
                                    key={key}
                                    role={role}
                                    isBound={false}
                                    isActive={false}
                                    actionLabel={t("settings.account.bind_role")}
                                    isBusy={savingRoleKey === key}
                                    isDisabled={savingRoleKey !== null}
                                    onAction={() =>
                                      handleToggleGameRole(
                                        sklandAccount.userId,
                                        role,
                                        false,
                                      )
                                    }
                                  />
                                );
                              })}
                            </RoleGroup>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Accounts List */}
      {false && (
        <>
          {isLoading || isRefreshing ? (
            <div className="flex flex-col flex-1">
              <GlassCard className="border border-separator/80 p-0 flex flex-col">
                <div
                  ref={containerRef}
                  className="relative px-[15px] py-[15px] space-y-[5px]"
                >
                  {renderSkeleton()}
                </div>

                {/* Card footer: pagination (disabled during refresh) */}
                <div className="border-t border-separator/60 px-3 py-3 w-full">
                  <div className="flex items-center justify-center w-full gap-3">
                    <GlassButton
                      size="sm"
                      variant="outline"
                      isDisabled={true}
                      className="flex items-center gap-2"
                    >
                      <svg
                        className="w-4 h-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M15 19l-7-7 7-7"
                        />
                      </svg>
                      {t("common.pagination.previous")}
                    </GlassButton>

                    <div className="flex items-center">
                      <SimplePagination
                        total={Math.max(
                          1,
                          Math.ceil(expectedAccountCount / itemsPerPage) || 1,
                        )}
                        page={1}
                        onChange={() => {}}
                        showControls={false}
                      />
                      {/* keep pagination for screen reader compatibility (visually hidden) */}
                      <div className="sr-only" aria-hidden="true">
                        <span>
                          {totalPages} {i18n.language === "zh" ? "页" : "pages"}
                        </span>
                      </div>
                    </div>

                    <GlassButton
                      size="sm"
                      variant="outline"
                      isDisabled={true}
                      className="flex items-center gap-2"
                    >
                      {t("common.pagination.next")}
                      <svg
                        className="w-4 h-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                    </GlassButton>
                  </div>
                </div>
              </GlassCard>
            </div>
          ) : accounts.length === 0 ? (
            <GlassCard
              className="p-12 glass-surface border border-separator/90"
              style={{ minHeight: `${CONTAINER_HEIGHT}px` }}
            >
              <div className="text-center">
                <svg
                  className="w-16 h-16 mx-auto mb-4 opacity-50 text-muted"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                  />
                </svg>
                <p className="text-lg font-medium text-foreground">
                  {sklandAccounts.length > 0
                    ? t("settings.account.no_game_roles")
                    : t("settings.account.no_accounts")}
                </p>
                <p className="text-sm text-muted mt-2">
                  {sklandAccounts.length > 0
                    ? t("settings.account.manage_game_roles")
                    : i18n.language === "zh"
                      ? "点击右上角添加账户开始使用"
                      : "Click the button above to add an account"}
                </p>
              </div>
            </GlassCard>
          ) : (
            <div className="flex flex-col flex-1">
              {/* 账户卡片区域 - 带外框 */}
              <GlassCard className="shadow-sm border-2 border-separator p-0 flex flex-col">
                <div
                  ref={containerRef}
                  className="relative px-[15px] py-[15px] space-y-[5px]"
                >
                  {currentPageAccounts.map((account) => {
                    const isSelected = account.id === currentAccountId;
                    const isPreviousActive = account.id === previousAccountId;

                    // 判断账户是否有错误状态
                    const hasErrorStatus =
                      account.syncStatus === "HYTOKEN_EXPIRED" ||
                      account.syncStatus === "FAILED";

                    // 计算动画类型
                    let animationClass = "";
                    let zIndex = 0;

                    if (isAnimating) {
                      if (isSelected) {
                        animationClass = "animate-fade-in";
                        zIndex = 30;
                      } else if (isPreviousActive) {
                        animationClass = "animate-fade-out";
                        zIndex = 20;
                      }
                    } else {
                      animationClass = "animate-fade-in";
                    }

                    // 根据状态决定边框颜色
                    let borderColorClass =
                      "border-separator hover:border-content3/50";
                    let shadowClass = "shadow-md hover:shadow-lg";
                    let statusDotTone: StatusDotTone | null = null;
                    if (isSelected && !hasErrorStatus) {
                      borderColorClass = "border-success";
                      shadowClass = "shadow-xl";
                      statusDotTone = "success";
                    } else if (isSelected && hasErrorStatus) {
                      statusDotTone =
                        account.syncStatus === "HYTOKEN_EXPIRED"
                          ? "danger"
                          : "warning";
                      borderColorClass =
                        account.syncStatus === "HYTOKEN_EXPIRED"
                          ? "border-danger"
                          : "border-warning";
                      shadowClass = "shadow-xl";
                    } else if (!isSelected && !hasErrorStatus) {
                      statusDotTone = "default";
                    }

                    // 状态徽章 - 错误状态优先级高于 ACTIVE/AVAILABLE
                    const statusBadgeConfig: StatusConfig | null =
                      account.syncStatus === "HYTOKEN_EXPIRED"
                        ? SYNC_STATUS_META.HYTOKEN_EXPIRED
                        : account.syncStatus === "FAILED"
                          ? SYNC_STATUS_META.FAILED
                          : isSelected
                            ? { tone: "success", label: "ACTIVE" }
                            : { tone: "default", label: "AVAILABLE" };

                    return (
                      <GlassCard
                        key={account.id}
                        data-account-card="true"
                        className={`cursor-pointer transition-all duration-300 ease-in-out ${borderColorClass} ${shadowClass} border-2 box-border ${animationClass}`}
                        style={{
                          height: `${CARD_HEIGHT}px`,
                          position: isAnimating ? "relative" : "static",
                          zIndex,
                        }}
                        isPressable
                        onPress={() => handleSelectAccount(account.id)}
                      >
                        <div className="flex items-center h-full px-3">
                          <div className="flex items-center justify-between w-full">
                            <div className="flex items-center gap-3 flex-1">
                              {/* LED 指示灯 - 根据状态显示不同颜色 */}
                              {statusDotTone && (
                                <StatusDot
                                  tone={statusDotTone}
                                  ping={isSelected}
                                />
                              )}

                              {/* Avatar */}
                              <div className="w-10 h-10 rounded-lg flex items-center justify-center text-base font-bold text-primary flex-shrink-0 overflow-hidden">
                                {account.avatar ? (
                                  <Img
                                    src={account.avatar}
                                    alt={account.nickname}
                                    className="w-full h-full avatar-feather"
                                    onError={(e) => {
                                      (
                                        e.target as HTMLImageElement
                                      ).style.display = "none";
                                      const parent = (
                                        e.target as HTMLImageElement
                                      ).parentElement;
                                      if (parent) {
                                        parent.textContent = account.nickname
                                          .charAt(0)
                                          .toUpperCase();
                                      }
                                    }}
                                  />
                                ) : (
                                  account.nickname.charAt(0).toUpperCase()
                                )}
                              </div>

                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-foreground truncate">
                                  {account.nickname}
                                </p>
                                <p className="text-xs text-muted">
                                  {i18n.language === "zh" ? "等级" : "Level"}:{" "}
                                  {account.level} •{" "}
                                  {account.server === "1"
                                    ? i18n.language === "zh"
                                      ? "官服"
                                      : "Official"
                                    : account.server === "2"
                                      ? i18n.language === "zh"
                                        ? "BiliBili服"
                                        : "BiliBili"
                                      : account.server}
                                </p>
                                {account.userId && (
                                  <p className="text-[11px] text-muted/70 truncate">
                                    {t("settings.account.skland_account")}:{" "}
                                    {account.userId}
                                  </p>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-2 flex-shrink-0">
                              {statusBadgeConfig && (
                                <StatusBadge config={statusBadgeConfig} />
                              )}

                              <GlassButton
                                size="sm"
                                variant="outline"
                                onPress={() => handleViewDetails(account)}
                                className="!h-7 !px-2 text-xs"
                              >
                                {t("settings.account.view_details")}
                              </GlassButton>
                              <GlassButton
                                size="sm"
                                variant="outline"
                                onPress={() => handleLogout(account)}
                                className="text-danger border-danger hover:bg-danger-50 !h-7 !px-2 text-xs"
                              >
                                {t("settings.account.logout")}
                              </GlassButton>
                            </div>
                          </div>
                        </div>
                      </GlassCard>
                    );
                  })}
                </div>

                {/* Card footer: pagination */}
                <div className="border-t border-separator px-3 py-3 w-full">
                  <div className="flex items-center justify-center w-full gap-3">
                    <GlassButton
                      size="sm"
                      variant="outline"
                      isDisabled={currentPage === 1}
                      onPress={() =>
                        setCurrentPage(Math.max(1, currentPage - 1))
                      }
                      className="flex items-center gap-2"
                    >
                      <svg
                        className="w-4 h-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M15 19l-7-7 7-7"
                        />
                      </svg>
                      {t("common.pagination.previous")}
                    </GlassButton>

                    <div className="flex items-center">
                      <SimplePagination
                        total={Math.max(1, totalPages)}
                        page={currentPage}
                        onChange={setCurrentPage}
                        showControls={false}
                      />
                      {/* keep pagination for screen reader compatibility (visually hidden) */}
                      <div className="sr-only" aria-hidden="true">
                        <span>
                          {totalPages} {i18n.language === "zh" ? "页" : "pages"}
                        </span>
                      </div>
                    </div>

                    <GlassButton
                      size="sm"
                      variant="outline"
                      isDisabled={currentPage >= totalPages}
                      onPress={() =>
                        setCurrentPage(Math.min(totalPages, currentPage + 1))
                      }
                      className="flex items-center gap-2"
                    >
                      {t("common.pagination.next")}
                      <svg
                        className="w-4 h-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                    </GlassButton>
                  </div>
                </div>
              </GlassCard>
            </div>
          )}
        </>
      )}

      {/* Account Details Modal */}
      <CustomModal
        isOpen={isDetailsModalOpen}
        onClose={() => setIsDetailsModalOpen(false)}
        size="md"
      >
        <CustomModalHeader onClose={() => setIsDetailsModalOpen(false)}>
          {t("settings.account.account_details")}
        </CustomModalHeader>
        <CustomModalBody>
          {selectedAccount && (
            <div className="space-y-4">
              {/* 凭证失效警告 - 只显示红色警告框 */}
              {selectedAccount.syncStatus === "HYTOKEN_EXPIRED" ? (
                <div className="text-center py-8 border-2 border-danger rounded-lg bg-danger/10 dark:bg-danger/20">
                  <p className="text-5xl font-black text-danger tracking-wider mb-4">
                    EXPIRED
                  </p>
                  <div className="space-y-2 text-left px-4">
                    <div>
                      <p className="text-xs italic text-muted mb-1">Hytoken:</p>
                      <p className="text-xs font-mono text-danger break-all">
                        {selectedAccount.token || "N/A"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs italic text-muted mb-1">Cred:</p>
                      <p className="text-xs font-mono text-danger break-all">
                        {selectedAccount.cred || "N/A"}
                      </p>
                    </div>
                  </div>
                  <div className="text-left px-4 mt-2">
                    <p className="text-xs italic text-muted">
                      *{" "}
                      {i18n.language === "zh"
                        ? "Hytoken过期，我们无法刷新令牌，请重新登录。"
                        : "Hytoken expired, we cannot refresh the token. Please log in again."}
                    </p>
                  </div>
                </div>
              ) : selectedAccount.syncStatus === "FAILED" ? (
                <div className="text-center py-8 border-2 border-warning rounded-lg bg-warning/10 dark:bg-warning/20">
                  <p className="text-5xl font-black text-warning tracking-wider mb-4">
                    SYNC FAILED
                  </p>
                  <div className="text-left px-4 mt-2">
                    <p className="text-xs italic text-muted">
                      *{" "}
                      {i18n.language === "zh"
                        ? "我们未能同步角色信息，请检查网络连接后重试"
                        : "We failed to sync role information, please check your network connection and try again"}
                    </p>
                  </div>
                  {/* 重试按钮 */}
                  <GlassButton
                    variant="secondary"
                    onPress={() => retrySyncAccount(selectedAccount.id)}
                    isDisabled={isRefreshing}
                    className="mt-4 text-warning"
                  >
                    {isRefreshing ? (
                      <>
                        <GlassSpinner size="sm" color="current" />
                        {i18n.language === "zh" ? "重试中..." : "Retrying..."}
                      </>
                    ) : (
                      <>
                        ↻ {i18n.language === "zh" ? "重试同步" : "Retry Sync"}
                      </>
                    )}
                  </GlassButton>
                </div>
              ) : (
                /* 正常账户信息 */
                <>
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-lg flex items-center justify-center text-2xl font-bold text-primary overflow-hidden">
                      {selectedAccount.avatar ? (
                        <Img
                          src={selectedAccount.avatar}
                          alt={selectedAccount.nickname}
                          className="w-full h-full avatar-feather"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display =
                              "none";
                            const parent = (e.target as HTMLImageElement)
                              .parentElement;
                            if (parent) {
                              parent.textContent = selectedAccount.nickname
                                .charAt(0)
                                .toUpperCase();
                            }
                          }}
                        />
                      ) : (
                        selectedAccount.nickname.charAt(0).toUpperCase()
                      )}
                    </div>
                    <div>
                      <p className="text-xl font-semibold text-foreground">
                        {selectedAccount.nickname}
                      </p>
                      <p className="text-sm text-muted">
                        ID: {selectedAccount.id}
                      </p>
                    </div>
                  </div>

                  <div className="border-t border-separator my-4" />

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted mb-1">
                        {i18n.language === "zh" ? "等级" : "Level"}
                      </p>
                      <p className="text-base font-medium text-foreground">
                        Lv.{selectedAccount.level}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted mb-1">
                        {i18n.language === "zh" ? "服务器" : "Server"}
                      </p>
                      <p className="text-base font-medium text-foreground">
                        {selectedAccount.server === "1"
                          ? i18n.language === "zh"
                            ? "官服"
                            : "Official"
                          : selectedAccount.server === "2"
                            ? i18n.language === "zh"
                              ? "BiliBili服"
                              : "BiliBili"
                            : selectedAccount.server}
                      </p>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </CustomModalBody>
        <CustomModalFooter>
          <GlassButton
            variant="outline"
            onPress={() => setIsDetailsModalOpen(false)}
          >
            {t("settings.account.close")}
          </GlassButton>
        </CustomModalFooter>
      </CustomModal>

      {/* Logout Confirm Modal（是否保留设备认证） */}
      <CustomModal
        isOpen={!!logoutTarget}
        onClose={() => setLogoutTarget(null)}
        size="sm"
      >
        <CustomModalHeader onClose={() => setLogoutTarget(null)}>
          {t("settings.account.confirm_logout")}
        </CustomModalHeader>
        <CustomModalBody>
          <div className="space-y-4">
            <p className="text-sm text-foreground/80">
              {i18n.language === "zh"
                ? `确定要登出账户「${logoutTarget?.nickname || ""}」吗？`
                : `Logout account "${logoutTarget?.nickname || ""}"?`}
            </p>

            <label className="flex items-start gap-3 cursor-pointer rounded-lg border-2 border-separator p-3 hover:border-primary/50 transition-colors">
              <GlassCheckbox
                isSelected={keepDeviceAuth}
                onChange={() => setKeepDeviceAuth((prev) => !prev)}
              />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t("settings.account.logout_keep_device")}
                </p>
                <p className="text-xs text-muted mt-0.5">
                  {t("settings.account.logout_keep_device_desc")}
                </p>
              </div>
            </label>

            {!keepDeviceAuth && (
              <p className="text-xs text-danger">
                {t("settings.account.logout_delete_device_warn")}
              </p>
            )}
          </div>
        </CustomModalBody>
        <CustomModalFooter>
          <GlassButton
            variant="outline"
            onPress={() => setLogoutTarget(null)}
            isDisabled={isLoggingOut}
          >
            {t("settings.account.cancel")}
          </GlassButton>
          <GlassButton
            variant="danger"
            onPress={handleConfirmLogout}
            isDisabled={isLoggingOut}
          >
            {isLoggingOut
              ? t("settings.account.loading")
              : t("settings.account.logout")}
          </GlassButton>
        </CustomModalFooter>
      </CustomModal>

      {/* Skland Profile Modal（森空岛用户资料详情） */}
      <CustomModal
        isOpen={!!profileSklandId}
        onClose={() => setProfileSklandId(null)}
        size="md"
      >
        <CustomModalHeader onClose={() => setProfileSklandId(null)}>
          {sklandUserInfos[profileSklandId || ""]?.nickname ||
            sklandAccounts.find(
              (account) => account.userId === profileSklandId,
            )?.nickname ||
            t("settings.account.skland_profile")}
        </CustomModalHeader>
        <CustomModalBody>
          {profileSklandId && (
            <SklandProfileDetails
              userInfo={sklandUserInfos[profileSklandId]}
              gameList={sklandGames}
              isLoading={
                !sklandUserInfos[profileSklandId] &&
                !sklandUserInfoErrors[profileSklandId]
              }
              errorMessage={sklandUserInfoErrors[profileSklandId]}
              onRetry={() =>
                void ensureSklandUserInfo(profileSklandId, { force: true })
              }
            />
          )}
        </CustomModalBody>
        <CustomModalFooter>
          <GlassButton
            variant="outline"
            onPress={() => setProfileSklandId(null)}
          >
            {t("settings.account.close")}
          </GlassButton>
        </CustomModalFooter>
      </CustomModal>

      {/* Add Account Modal */}
      <CustomModal
        isOpen={isAddModalOpen}
        onClose={handleCloseAddModal}
        size="lg"
        height={
          isRoleSelectionOpen && availableRoles.length > 3 ? "fixed" : "auto"
        }
        disableBackdropClick={
          showSklandConfirmation ||
          (isRoleSelectionOpen && availableRoles.length > 0)
        }
      >
        <CustomModalHeader onClose={handleCloseAddModal}>
          {showSklandConfirmation
            ? t("settings.account.confirm_skland_binding")
            : isManagingSklandRoles
              ? t("settings.account.manage_game_roles")
              : reloginTarget
                ? t("settings.account.relogin_title", {
                    account:
                      reloginTarget.nickname ||
                      reloginTarget.userId,
                  })
                : t("settings.account.add_account")}
        </CustomModalHeader>
        <CustomModalBody
          className={
            loginMethod === "sms" && showOtpInput ? "overflow-hidden" : ""
          }
        >
          {showSklandConfirmation ? (
            <div className="space-y-4">
              <p className="text-sm text-muted">
                {t("settings.account.confirm_skland_binding_desc")}
              </p>
              <div className="rounded-lg border border-separator p-4">
                <div className="flex items-center gap-3">
                  {/* 用刚拿到的 cred/token 拉取头像与昵称（后端未缓存该账户） */}
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full border border-separator/60 bg-content2/30">
                    {reloginProfile?.avatar ? (
                      <Img
                        src={reloginProfile.avatar}
                        alt={
                          reloginProfile.nickname ||
                          loginUserId ||
                          t("settings.account.skland_account")
                        }
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-lg font-semibold text-muted">
                        <GlassSpinner color="primary" size="sm" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted">
                      {t("settings.account.skland_account")}
                    </p>
                    <p className="mt-0.5 truncate text-sm font-medium text-foreground">
                      {reloginProfile?.nickname ||
                        t("settings.account.skland_account")}
                    </p>
                    <p className="mt-0.5 text-xs font-mono text-muted break-all">
                      {loginUserId}
                    </p>
                  </div>
                </div>
              </div>
              {loginError && (
                <p className="text-sm text-danger" role="alert">
                  {loginError}
                </p>
              )}
            </div>
          ) : isRoleSelectionOpen && availableRoles.length > 0 ? (
            // 角色选择界面
            <div className="space-y-4">
              <p className="text-sm text-muted text-center mb-4">
                {t("settings.account.select_roles_for_skland", {
                  userId: loginUserId,
                })}
              </p>

              {/*
                滚动容器与卡片高亮：
                - `px-2 py-2` 给卡片描边留出绘制空间（同时避免相邻卡片贴边）。
                - `GlassCard` 自带 `overflow-hidden`，会裁掉画在元素外的 `ring`/`shadow`，
                  因此选中态用 `border-success` + 内阴影描边实现，
                  hover 也只改边框与背景色，不再缩放/放大阴影。
              */}
              <div className="max-h-[500px] space-y-3 overflow-y-auto px-2 py-2">
                {availableRoles.map((role) => {
                  // 头像已经是 base64 格式，直接使用
                  const avatarSrc = role.avatarUrl;
                  const isSelected = selectedRoles.includes(role.roleId);

                  return (
                    <GlassCard
                      key={role.roleId}
                      className={`w-full cursor-pointer border-2 transition-colors duration-200 hover:translate-y-0 hover:scale-100 hover:shadow-none ${
                        isSelected
                          ? "border-success bg-success/10 dark:bg-success/20"
                          : "border-separator hover:border-success/60 hover:bg-success/5"
                      }`}
                      style={
                        isSelected
                          ? {
                              boxShadow:
                                "inset 0 0 0 2px color-mix(in oklab, var(--success) 55%, transparent)",
                            }
                          : undefined
                      }
                      isPressable
                      onPress={() => handleRoleToggle(role.roleId)}
                    >
                      <div className="p-4">
                        <div className="flex items-center gap-4">
                          <GlassCheckbox
                            isSelected={selectedRoles.includes(role.roleId)}
                            onChange={() => handleRoleToggle(role.roleId)}
                          />
                          <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0">
                            {avatarSrc ? (
                              <Img
                                src={avatarSrc}
                                alt={role.nickname}
                                className="w-full h-full avatar-feather"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display =
                                    "none";
                                  const parent = (e.target as HTMLImageElement)
                                    .parentElement;
                                  if (parent) {
                                    parent.textContent = role.nickname
                                      .charAt(0)
                                      .toUpperCase();
                                    parent.className =
                                      "w-16 h-16 rounded-lg flex items-center justify-center text-lg font-bold text-primary";
                                  }
                                }}
                              />
                            ) : (
                              <div className="w-16 h-16 rounded-lg flex items-center justify-center text-lg font-bold text-primary">
                                {role.nickname.charAt(0).toUpperCase()}
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-lg truncate">
                              {role.nickname || "未知角色"}
                            </h3>
                            <p className="text-sm text-muted">
                              {i18n.language === "zh" ? "等级" : "Level"}:{" "}
                              {role.level}
                            </p>
                            <p className="text-xs text-muted/70">
                              {i18n.language === "zh" ? "服务器" : "Server"}:{" "}
                              {resolveServerLabel(role.serverId, i18n.language)}
                            </p>
                          </div>
                        </div>
                      </div>
                    </GlassCard>
                  );
                })}
              </div>
            </div>
          ) : isRoleSelectionOpen ? (
            <div className="py-8 text-center">
              <p className="text-sm text-muted">
                {t("settings.account.no_game_roles")}
              </p>
            </div>
          ) : !loginMethod ? (
            // 登录方式选择（重新登录时也走这里：只需选择方式，不必输入手机号）
            <div className="space-y-4">
              {reloginMismatchUserId && (
                <GlassAlert status="danger">
                  <GlassAlert.Indicator />
                  <GlassAlert.Content>
                    <GlassAlert.Description>
                      {t("settings.account.relogin_mismatch", {
                        actual: reloginMismatchUserId,
                      })}
                    </GlassAlert.Description>
                  </GlassAlert.Content>
                </GlassAlert>
              )}

              {reloginTarget && (
                <GlassAlert status="warning">
                  <GlassAlert.Indicator />
                  <GlassAlert.Content>
                    <GlassAlert.Description>
                      {t("settings.account.relogin_desc")}
                    </GlassAlert.Description>
                  </GlassAlert.Content>
                </GlassAlert>
              )}

              {reloginTarget && (
                <p className="text-xs text-muted">
                  {reloginTarget.phone
                    ? t("settings.account.relogin_fill_phone_hint")
                    : t("settings.account.relogin_no_phone_hint")}
                </p>
              )}

              <p className="text-sm text-muted text-center mb-6">
                {t("settings.account.select_login_method")}
              </p>

              <div className="grid grid-cols-3 gap-4">
                {/* 密码登录 */}
                <button
                  onClick={() => setLoginMethod("phone")}
                  className="glass-surface flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-separator hover:border-primary hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-all cursor-pointer group"
                >
                  <div className="w-16 h-16 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <svg
                      className="w-8 h-8 text-primary"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                      />
                    </svg>
                  </div>
                  <span className="text-sm font-medium text-foreground">
                    {t("settings.account.phone_login")}
                  </span>
                </button>

                {/* 验证码登录 */}
                <button
                  onClick={() => setLoginMethod("sms")}
                  className="glass-surface flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-separator hover:border-primary hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-all cursor-pointer group"
                >
                  <div className="w-16 h-16 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <svg
                      className="w-8 h-8 text-primary"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                      />
                    </svg>
                  </div>
                  <span className="text-sm font-medium text-foreground">
                    {t("settings.account.sms_login")}
                  </span>
                </button>

                {/* 扫码登录 */}
                <button
                  onClick={() => setLoginMethod("qrcode")}
                  className="glass-surface flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-separator hover:border-primary hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-all cursor-pointer group"
                >
                  <div className="w-16 h-16 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <svg
                      className="w-8 h-8 text-primary"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 3h7v7H3V3zM14 3h7v7h-7V3zM3 14h7v7H3v-7zM14 14h2v2h-2v-2zM17 14h4v4h-4v-4zM14 17h2v4h-2v-4zM20 20h1v1h-1v-1z"
                      />
                    </svg>
                  </div>
                  <span className="text-sm font-medium text-foreground">
                    {t("settings.account.scan_login")}
                  </span>
                </button>
              </div>
            </div>
          ) : loginMethod === "phone" ? (
            // 手机号登录表单
            <div className="space-y-4">
              {/* 返回按钮 */}
              <button
                onClick={() => {
                  setLoginMethod(null);
                  setIsNewDeviceVerify(false);
                  setShowOtpInput(false);
                  setIsOtpInvalid(false);
                  setVerificationCode("");
                }}
                className="flex items-center gap-2 text-sm text-muted hover:text-foreground transition-colors mb-4"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
                {t("settings.account.back")}
              </button>

              {/* 错误提示 */}
              {loginError && (
                <GlassAlert status="danger">
                  <GlassAlert.Indicator />
                  <GlassAlert.Content>
                    <GlassAlert.Description>
                      {loginError}
                    </GlassAlert.Description>
                  </GlassAlert.Content>
                </GlassAlert>
              )}

              {/* 发送验证码成功提示 */}
              {codeSentSuccess && (
                <GlassAlert status="success">
                  <GlassAlert.Indicator />
                  <GlassAlert.Content>
                    <GlassAlert.Description>
                      {i18n.language === "zh"
                        ? "验证码已发送，请注意查收"
                        : "Verification code sent"}
                    </GlassAlert.Description>
                  </GlassAlert.Content>
                </GlassAlert>
              )}

              {/* 新设备验证提示 */}
              {isNewDeviceVerify && (
                <GlassAlert status="warning">
                  <GlassAlert.Indicator />
                  <GlassAlert.Content>
                    <GlassAlert.Description>
                      {t("settings.account.new_device_verify_hint")}
                    </GlassAlert.Description>
                  </GlassAlert.Content>
                </GlassAlert>
              )}

              {isNewDeviceVerify ? (
                // 新设备验证方式选择
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-[auto_1fr] items-center gap-y-4 gap-x-3">
                    <label className="text-sm font-medium text-foreground whitespace-nowrap justify-self-end">
                      {t("settings.account.phone_number")}
                    </label>
                    <div className="flex flex-col gap-1">
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => {
                          setPhone(e.target.value);
                          setCodeSentSuccess(false);
                          if (phoneError) setPhoneError("");
                        }}
                        placeholder={t("settings.account.enter_phone")}
                        maxLength={11}
                        disabled={isLoggingIn || isSendingCode}
                        className="w-full px-4 py-2.5 bg-default-100 border border-separator rounded-lg text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                      />
                      {phoneError && (
                        <p className="text-xs text-danger">{phoneError}</p>
                      )}
                      {reloginTarget?.phone && (
                        <p className="text-xs text-muted">
                          {t("settings.account.relogin_using_target_phone", {
                            phone: reloginTarget.phone,
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                  <GlassButton
                    variant="primary"
                    onPress={handleVerifyWithCode}
                    isDisabled={isSendingCode}
                    className="w-full mt-2"
                  >
                    {isSendingCode ? (
                      <>
                        <GlassSpinner color="current" size="sm" />
                        {t("settings.account.sending")}
                      </>
                    ) : (
                      t("settings.account.verify_with_code")
                    )}
                  </GlassButton>
                  <GlassButton
                    variant="outline"
                    onPress={handleVerifyWithScan}
                    className="w-full"
                  >
                    {t("settings.account.verify_with_scan")}
                  </GlassButton>
                </div>
              ) : (
                <>
                  {/* 手机号和密码输入 */}
                  <div className="grid grid-cols-[auto_1fr] items-center gap-y-4 gap-x-3">
                    {/* 手机号输入行 */}
                    <label className="text-sm font-medium text-foreground whitespace-nowrap justify-self-end">
                      {t("settings.account.phone_number")}
                    </label>
                    <div className="flex flex-col gap-1">
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => {
                          setPhone(e.target.value);
                          setCodeSentSuccess(false);
                          if (phoneError) setPhoneError(""); // 输入时清除错误
                        }}
                        placeholder={t("settings.account.enter_phone")}
                        maxLength={11}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !isLoggingIn) {
                            handleLogin();
                          }
                        }}
                        className="w-full px-4 py-2.5 bg-default-100 border border-separator rounded-lg text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                      />
                      {phoneError && (
                        <p className="text-xs text-danger">{phoneError}</p>
                      )}
                      {reloginTarget?.phone && (
                        <p className="text-xs text-muted">
                          {t("settings.account.relogin_using_target_phone", {
                            phone: reloginTarget.phone,
                          })}
                        </p>
                      )}
                    </div>

                    {/* 密码输入行 */}
                    <label className="text-sm font-medium text-foreground whitespace-nowrap justify-self-end">
                      {t("settings.account.password")}
                    </label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t("settings.account.enter_password")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !isLoggingIn) {
                          handleLogin();
                        }
                      }}
                      className="w-full px-4 py-2.5 bg-default-100 border border-separator rounded-lg text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                    />
                  </div>
                </>
              )}
            </div>
          ) : loginMethod === "sms" ? (
            // 验证码登录表单
            <div className="space-y-4">
              <button
                onClick={() => {
                  setLoginMethod(null);
                  setShowOtpInput(false);
                  setIsOtpInvalid(false);
                }}
                className="flex items-center gap-2 text-sm text-muted hover:text-foreground transition-colors mb-4"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
                {t("settings.account.back")}
              </button>

              {/* 错误提示 */}
              {loginError && (
                <GlassAlert status="danger">
                  <GlassAlert.Indicator />
                  <GlassAlert.Content>
                    <GlassAlert.Description>
                      {loginError}
                    </GlassAlert.Description>
                  </GlassAlert.Content>
                </GlassAlert>
              )}

              {!showOtpInput ? (
                // 第一步：输入手机号
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-[auto_1fr] items-center gap-y-4 gap-x-3">
                    <label className="text-sm font-medium text-foreground whitespace-nowrap justify-self-end">
                      {t("settings.account.phone_number")}
                    </label>
                    <div className="flex flex-col gap-1">
                      <input
                        type="tel"
                        placeholder={
                          i18n.language === "zh"
                            ? "请输入手机号"
                            : "Enter phone number"
                        }
                        value={phone}
                        onChange={(e) => {
                          setPhone(e.target.value);
                          setCodeSentSuccess(false);
                          if (phoneError) setPhoneError("");
                        }}
                        disabled={isLoggingIn || isSendingCode}
                        maxLength={11}
                        onKeyDown={(e) => {
                          if (
                            e.key === "Enter" &&
                            !isLoggingIn &&
                            !isSendingCode
                          ) {
                            handleSendCodeAndShowOtp();
                          }
                        }}
                        className="w-full px-4 py-2.5 bg-default-100 border border-separator rounded-lg text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                      />
                      {phoneError && (
                        <p className="text-xs text-danger">{phoneError}</p>
                      )}
                      {reloginTarget?.phone && (
                        <p className="text-xs text-muted">
                          {t("settings.account.relogin_using_target_phone", {
                            phone: reloginTarget.phone,
                          })}
                        </p>
                      )}
                    </div>
                  </div>

                  <GlassButton
                    variant="primary"
                    onPress={handleSendCodeAndShowOtp}
                    isDisabled={isSendingCode || !phone}
                    className="w-full mt-2"
                  >
                    {isSendingCode ? (
                      <>
                        <GlassSpinner color="current" size="sm" />
                        {t("settings.account.sending")}
                      </>
                    ) : (
                      t("settings.account.confirm")
                    )}
                  </GlassButton>
                </div>
              ) : (
                // 第二步：输入验证码
                <div className="flex w-full flex-col gap-2">
                  <div className="flex flex-col gap-1">
                    <GlassLabel>
                      {i18n.language === "zh" ? "验证账户" : "Verify account"}
                    </GlassLabel>
                    <p className="text-sm text-muted">
                      {i18n.language === "zh"
                        ? `我们已向 ${phone} 发送验证码`
                        : `We've sent a code to ${phone}`}
                    </p>
                  </div>

                  <GlassInputOTP
                    aria-describedby={isOtpInvalid ? "code-error" : undefined}
                    isInvalid={isOtpInvalid}
                    maxLength={6}
                    value={verificationCode}
                    onComplete={async (code) => {
                      logger.info("Code complete: " + code, "Account");
                      // 自动提交验证码
                      await handleLogin();
                    }}
                    onChange={(val) => {
                      setVerificationCode(val);
                      setIsOtpInvalid(false);
                      // 当用户输入验证码时，清除发送成功的提示
                      if (codeSentSuccess) {
                        setCodeSentSuccess(false);
                      }
                    }}
                  >
                    <GlassInputOTP.Group>
                      <GlassInputOTP.Slot index={0} />
                      <GlassInputOTP.Slot index={1} />
                      <GlassInputOTP.Slot index={2} />
                    </GlassInputOTP.Group>
                    <GlassInputOTP.Separator />
                    <GlassInputOTP.Group>
                      <GlassInputOTP.Slot index={3} />
                      <GlassInputOTP.Slot index={4} />
                      <GlassInputOTP.Slot index={5} />
                    </GlassInputOTP.Group>
                  </GlassInputOTP>

                  {isOtpInvalid && (
                    <span
                      className="field-error"
                      data-visible={isOtpInvalid}
                      id="code-error"
                    >
                      {i18n.language === "zh"
                        ? "验证码无效，请重试"
                        : "Invalid code. Please try again."}
                    </span>
                  )}

                  <div className="flex items-center justify-between px-1 pt-1">
                    <div className="flex items-center gap-[5px]">
                      <p className="text-sm text-muted">
                        {i18n.language === "zh"
                          ? "没收到验证码？"
                          : "Didn't receive a code?"}
                      </p>
                      <GlassLink
                        className="text-foreground underline cursor-pointer"
                        onClick={async () => {
                          if (countdown > 0) {
                            alert(
                              i18n.language === "zh"
                                ? `请等待 ${countdown} 秒`
                                : `Wait ${countdown}s`,
                            );
                            return;
                          }

                          // 重新发送验证码
                          try {
                            const success = await sendVerificationCode({
                              phone,
                              type: 2,
                            });
                            if (success) {
                              alert(
                                i18n.language === "zh"
                                  ? "已重新发送"
                                  : "Resent",
                              );
                              // 重置倒计时
                              setCountdown(60);
                              const timer = setInterval(() => {
                                setCountdown((prev) => {
                                  if (prev <= 1) {
                                    clearInterval(timer);
                                    return 0;
                                  }
                                  return prev - 1;
                                });
                              }, 1000);
                            } else {
                              alert(
                                i18n.language === "zh" ? "发送失败" : "Failed",
                              );
                            }
                          } catch (error) {
                            alert(
                              i18n.language === "zh" ? "发送出错" : "Error",
                            );
                          }
                        }}
                      >
                        {i18n.language === "zh" ? "重新发送" : "Resend"}
                      </GlassLink>
                    </div>

                    {/* 返回手机号输入按钮 */}
                    <button
                      onClick={() => {
                        setShowOtpInput(false);
                        setVerificationCode("");
                        setIsOtpInvalid(false);
                      }}
                      className="text-sm text-muted hover:text-foreground transition-colors underline"
                    >
                      {i18n.language === "zh" ? "修改手机号" : "Change phone"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            // 扫码登录界面
            <div className="space-y-4">
              {reloginTarget && (
                <GlassAlert status="warning">
                  <GlassAlert.Indicator />
                  <GlassAlert.Content>
                    <GlassAlert.Description>
                      {t("settings.account.relogin_desc")}
                    </GlassAlert.Description>
                  </GlassAlert.Content>
                </GlassAlert>
              )}

              {/* 错误提示 */}
              {loginError && (
                <GlassAlert status="danger">
                  <GlassAlert.Indicator />
                  <GlassAlert.Content>
                    <GlassAlert.Description>
                      {loginError}
                    </GlassAlert.Description>
                  </GlassAlert.Content>
                </GlassAlert>
              )}

              {isLoggingIn ? (
                <div className="flex flex-col items-center justify-center gap-4 py-10">
                  <GlassSpinner color="primary" size="lg" />
                  <p className="text-sm text-muted">
                    {t("settings.account.logging_in")}
                  </p>
                </div>
              ) : !scanUrl ? (
                // 生成二维码
                <div className="flex flex-col items-center gap-4 py-8">
                  <div className="w-24 h-24 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center">
                    <svg
                      className="w-12 h-12 text-primary"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 3h7v7H3V3zM14 3h7v7h-7V3zM3 14h7v7H3v-7zM14 14h2v2h-2v-2zM17 14h4v4h-4v-4zM14 17h2v4h-2v-4zM20 20h1v1h-1v-1z"
                      />
                    </svg>
                  </div>
                  <p className="text-sm text-muted text-center">
                    {t("settings.account.qr_open_hint")}
                  </p>
                  <GlassButton
                    variant="primary"
                    onPress={handleStartQrLogin}
                    isDisabled={isGeneratingQr}
                  >
                    {isGeneratingQr ? (
                      <>
                        <GlassSpinner color="current" size="sm" />
                        {t("settings.account.generating")}
                      </>
                    ) : (
                      t("settings.account.gen_qrcode")
                    )}
                  </GlassButton>
                </div>
              ) : (
                // 显示二维码
                <div className="flex flex-col items-center gap-4">
                  <div className="relative p-3 bg-white rounded-xl shadow-sm">
                    <QRCodeImage value={scanUrl} size={200} />
                    {!scanWaiting && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/80 rounded-xl">
                        <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center">
                          <svg
                            className="w-6 h-6 text-success"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        </div>
                        <p className="text-sm font-medium text-foreground">
                          {t("settings.account.scanned")}
                        </p>
                      </div>
                    )}
                  </div>
                  <p className="text-sm text-muted text-center">
                    {scanWaiting
                      ? t("settings.account.scan_tip")
                      : t("settings.account.scanned_tip")}
                  </p>

                  <div className="flex items-center gap-2">
                    <GlassButton
                      variant="outline"
                      size="sm"
                      onPress={handleStartQrLogin}
                      isDisabled={isGeneratingQr}
                    >
                      {t("settings.account.refresh_qrcode")}
                    </GlassButton>
                  </div>
                </div>
              )}
            </div>
          )}
        </CustomModalBody>
        <CustomModalFooter>
          {showSklandConfirmation ? (
            <>
              <GlassButton
                variant="outline"
                onPress={handleCloseAddModal}
                isDisabled={isLoading}
              >
                {t("settings.account.cancel")}
              </GlassButton>
              <GlassButton
                variant="primary"
                onPress={handleConfirmSklandAccount}
                isDisabled={isLoading}
              >
                {isLoading
                  ? t("settings.account.loading")
                  : t("settings.account.confirm")}
              </GlassButton>
            </>
          ) : isRoleSelectionOpen ? (
            <>
              <GlassButton
                variant="outline"
                onPress={handleCloseAddModal}
                isDisabled={isLoading}
              >
                {t("settings.account.cancel")}
              </GlassButton>
              <GlassButton
                variant="primary"
                onPress={handleConfirmRoles}
                isDisabled={
                  isLoading ||
                  (availableRoles.length > 0 &&
                    selectedRoles.length === 0 &&
                    !isManagingSklandRoles)
                }
              >
                {isLoading
                  ? t("settings.account.loading")
                  : availableRoles.length === 0
                    ? t("settings.account.close")
                    : `${t("settings.account.confirm")} (${selectedRoles.length})`}
              </GlassButton>
            </>
          ) : loginMethod === "phone" ? (
            // 密码登录显示确认按钮
            <>
              <GlassButton
                variant="outline"
                onPress={() => {
                  if (isNewDeviceVerify) {
                    // 返回密码输入，重新走密码登录
                    setIsNewDeviceVerify(false);
                    setShowOtpInput(false);
                    setIsOtpInvalid(false);
                    setVerificationCode("");
                  } else {
                    setLoginMethod(null);
                  }
                }}
              >
                {t("settings.account.back")}
              </GlassButton>
              {!isNewDeviceVerify && (
                <GlassButton
                  variant="primary"
                  onPress={handleLogin}
                  isDisabled={isLoggingIn || !phone || !password}
                >
                  {isLoggingIn
                    ? t("settings.account.loading")
                    : t("settings.account.login")}
                </GlassButton>
              )}
            </>
          ) : loginMethod === "sms" ? (
            // 验证码登录显示返回按钮
            <>
              <GlassButton
                variant="outline"
                onPress={() => {
                  if (showOtpInput) {
                    // 如果在 OTP 输入阶段，返回手机号输入
                    setShowOtpInput(false);
                    setVerificationCode("");
                    setIsOtpInvalid(false);
                  } else {
                    // 否则返回登录方式选择
                    setLoginMethod(null);
                  }
                }}
              >
                {t("settings.account.back")}
              </GlassButton>
            </>
          ) : loginMethod === "qrcode" ? (
            // 扫码登录显示返回按钮
            <>
              <GlassButton
                variant="outline"
                onPress={() => {
                  // 返回登录方式选择
                  stopQrPolling();
                  setLoginMethod(null);
                  setScanUrl("");
                  setScanId("");
                }}
              >
                {t("settings.account.back")}
              </GlassButton>
            </>
          ) : null}
        </CustomModalFooter>
      </CustomModal>
    </div>
  );
}
