import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Img } from "@/utils/imageLoader";
import {
  CustomModal,
  CustomModalHeader,
  CustomModalBody,
  CustomModalFooter,
} from "@/components/custom-modal";
import { GlassButton, GlassInput, GlassSpinner } from "@/components/ui/glass";
import {
  addAccount,
  addAccountByCode,
  addAccountByScan,
  authorizeRoleU8Token,
  genScanLogin,
  getAccounts,
  getSelectedAccount,
  getSklandAccountRoles,
  getSklandUserInfoByCred,
  revokeRoleU8Token,
  saveSelectedRoles,
  saveSklandAccount,
  scanStatus,
  sendVerificationCode,
  setSelectedAccount,
  type LoginResult,
  type RoleDisplayInfo,
  type SklandUserInfo,
} from "@/utils/accountService";
import { AccountAvatar } from "@/components/ui/account-avatar";
import { GameBadge } from "@/components/ui/game-badge";
import logger from "@/utils/logger";

/**
 * 快捷添加账户弹窗（窄屏「我的」页用）。
 *
 * ## 为什么单独写一个而不复用 `pages/account.tsx` 里那个
 *
 * 那个弹窗和账户管理页的二十多个状态耦合（父账户确认、角色绑定、U8 授权、
 * 重登录、设备认证…），抽出来要么接受一堆外部 props、要么复制状态，两条路
 * 都比另写一个更糟。这里只做**添加账户**这一件事，但把流程走完整。
 *
 * ## 流程（与桌面账户页一致）
 *
 * 密码 / 验证码 / 扫码登录 → 后端返回 `LoginResult`：
 * - `success` 且已带 `account`：直接完成（已绑定过的账户再次登录）。
 * - `success` 且带 `availableRoles`：已有账户、要重新挑角色 —— 进角色选择。
 * - `success` 且只有 `cred/token/userId`：**这是后端登录接口的唯一返回形态**
 *   （`complete_login_from_token` 明确不返回 account / availableRoles），
 *   森空岛父账户已认证，但游戏角色还没拉。必须走「确认账户 → 保存 →
 *   拉角色 → 选角色 → 落盘」，否则就是「登录成功但账户没出现」。
 * - 失败：显示后端错误。
 *
 * ## 确认页为什么自己拉资料
 *
 * 确认页要展示头像/昵称，但此时账户**尚未保存**，`get_skland_user_info`
 * （按 userId 读本地配置）读不到东西。必须用刚登录得到的 cred/token 直接
 * 请求 `get_skland_user_info_by_cred`。之前这一步漏了：`userId` 是空字符串
 * 时 `getSklandUserInfoByCred` 直接失败，确认页只剩下一个空头像框。
 */

type Method = "password" | "sms" | "qrcode";

/** 弹窗内的阶段：选方式 → 填凭据 → 确认森空岛账户 → 选角色 → 授权抽卡 */
type Stage = "method" | "credentials" | "confirm" | "roles" | "auth";

export default function AddAccountModal({
  isOpen,
  onClose,
  onAdded,
}: {
  isOpen: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { t } = useTranslation();
  const [stage, setStage] = useState<Stage>("method");
  const [method, setMethod] = useState<Method>("password");

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // 扫码
  const [scanUrl, setScanUrl] = useState("");
  const [scanWaiting, setScanWaiting] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // 确认页 / 角色选择
  const [roles, setRoles] = useState<RoleDisplayInfo[]>([]);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [cred, setCred] = useState("");
  const [token, setToken] = useState("");
  const [userId, setUserId] = useState("");
  const [profile, setProfile] = useState<SklandUserInfo | null>(null);
  const [profileFailed, setProfileFailed] = useState(false);
  /**
   * 保存账户之后角色检测的独立真值。
   *
   * 不能借用 `busy`：保存账户与拉角色是两段网络请求，`busy` 一回落界面就会
   * 给出「暂无角色」这种**结论式**空态，用户看到的是「流程结束了」而不是
   * 「还在检测」。
   */
  const [checkingRoles, setCheckingRoles] = useState(false);

  /** 授权抽卡步骤：待授权的角色与其状态 */
  const [authRoles, setAuthRoles] = useState<RoleDisplayInfo[]>([]);
  const [authStatuses, setAuthStatuses] = useState<
    Record<string, "idle" | "authorized" | "failed">
  >({});
  const [busyRoleId, setBusyRoleId] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStage("method");
    setMethod("password");
    setPhone("");
    setPassword("");
    setCode("");
    setError("");
    setBusy(false);
    setCountdown(0);
    setScanUrl("");
    setScanWaiting(true);
    setRoles([]);
    setSelectedRoleIds([]);
    setCred("");
    setToken("");
    setUserId("");
    setProfile(null);
    setProfileFailed(false);
    setCheckingRoles(false);
    setAuthRoles([]);
    setAuthStatuses({});
    setBusyRoleId(null);
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isOpen) reset();
  }, [isOpen, reset]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // 倒计时
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  /**
   * 用刚登录得到的 cred/token 拉森空岛用户资料（确认页的头像/昵称）。
   *
   * 失败**不阻断**流程：确认页退化成只显示 userId，用户照样能继续。
   */
  const loadProfile = useCallback(async (nextCred: string, nextToken: string) => {
    setProfile(null);
    setProfileFailed(false);
    if (!nextCred || !nextToken) {
      setProfileFailed(true);
      return;
    }
    const info = await getSklandUserInfoByCred(nextCred, nextToken);
    if (!mountedRef.current) return;
    if (info) setProfile(info);
    else setProfileFailed(true);
  }, []);

  /**
   * 登录结果分派。
   *
   * 三条出路，缺一不可：
   * - 已有账户（`result.account`）：完成。
   * - 已有角色（`result.availableRoles`）：进角色选择页。
   * - 只有 cred/token（后端的默认形态）：进森空岛账户确认页。
   */
  const handleLoginResult = useCallback(
    async (result: LoginResult) => {
      if (!result.success) {
        setError(result.errorMessage || t("settings.account.login_failed"));
        return;
      }
      if (result.account) {
        // 已经绑定过的账户：直接完成
        onAdded();
        return;
      }
      const nextCred = result.cred || "";
      const nextToken = result.token || "";
      setCred(nextCred);
      setToken(nextToken);
      setUserId(result.userId || "");

      if (result.availableRoles && result.availableRoles.length > 0) {
        setRoles(result.availableRoles);
        // 默认全选：绝大多数情况用户就是想把这个森空岛账户下的角色都绑上
        setSelectedRoleIds(result.availableRoles.map((r) => r.roleId));
        setStage("roles");
        return;
      }

      setStage("confirm");
      void loadProfile(nextCred, nextToken);
    },
    [loadProfile, onAdded, t],
  );

  /** 扫码登录：生成二维码并轮询状态。 */
  const startQr = useCallback(async () => {
    setError("");
    setBusy(true);
    try {
      const info = await genScanLogin();
      if (!info) {
        setError(t("settings.account.qr_gen_failed"));
        return;
      }
      setScanUrl(info.scanUrl);
      setScanWaiting(true);

      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        const status = await scanStatus(info.scanId);
        if (!status) return;
        // status=1 已扫码待确认；status=2 已确认并带回 scanCode
        // （后端注释写的是 101/0，实际接口历史上两种都出现过，这里两种都认）
        if (status.status === 1 || status.status === 101) {
          setScanWaiting(false);
        }
        const confirmed =
          (status.status === 2 || status.status === 0) && !!status.scanCode;
        if (confirmed) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          const result = await addAccountByScan(status.scanCode as string);
          await handleLoginResult(result);
        }
      }, 2000);
    } finally {
      setBusy(false);
    }
  }, [handleLoginResult, t]);

  const handleSendCode = async () => {
    if (!phone.trim() || isSending || countdown > 0) return;
    setIsSending(true);
    setError("");
    try {
      const ok = await sendVerificationCode({ phone: phone.trim(), type: 0 });
      if (ok) setCountdown(60);
      else setError(t("settings.account.send_code_failed"));
    } finally {
      setIsSending(false);
    }
  };

  const handleSubmit = async () => {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const result =
        method === "password"
          ? await addAccount({ phone: phone.trim(), password })
          : await addAccountByCode({ phone: phone.trim(), code: code.trim() });
      await handleLoginResult(result);
    } catch (e) {
      logger.error("Add account failed: " + e, "AddAccountModal");
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * 确认森空岛账户：保存父账户 → 拉游戏角色 → 进角色选择。
   *
   * 这是「确认」按钮之前**完全缺失**的一步：只调 `onAdded()` 关弹窗，
   * 后端一个命令都没发，账户自然没被创建。
   */
  const handleConfirmSkland = async () => {
    if (busy) return;
    setBusy(true);
    setCheckingRoles(true);
    setError("");
    try {
      const saved = await saveSklandAccount(cred, token, userId);
      if (!saved) throw new Error(t("settings.account.save_failed"));

      const result = await getSklandAccountRoles(userId);
      if (!result.success || !result.cred || !result.token) {
        throw new Error(
          result.errorMessage || t("settings.account.roles_check_failed"),
        );
      }
      setCred(result.cred);
      setToken(result.token);

      const available = result.availableRoles ?? [];
      if (available.length === 0) {
        // 账户已保存、只是暂时拉不到角色：给结论式空态 + 就地重试
        setRoles([]);
        setSelectedRoleIds([]);
        setStage("roles");
        return;
      }

      setRoles(available);
      setSelectedRoleIds(available.map((r) => r.roleId));
      setStage("roles");
    } catch (e) {
      logger.error("Failed to confirm Skland account: " + e, "AddAccountModal");
      setError(String(e));
    } finally {
      setCheckingRoles(false);
      setBusy(false);
    }
  };

  /** 角色选择确认：把选中的游戏角色落盘成账户，然后进入授权抽卡步骤。 */
  const handleConfirmRoles = async () => {
    if (selectedRoleIds.length === 0) {
      setError(t("settings.account.select_at_least_one_role"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const selected = roles.filter((r) => selectedRoleIds.includes(r.roleId));
      await saveSelectedRoles(cred, token, userId, selected);
      await selectPreferredAccount(userId);

      /**
       * 绑定完成后**先问一句「要不要授权抽卡」**，与桌面端一致。
       *
       * 抽卡同步需要每个角色单独授权（`authorize_role_u8token`）；不授权就同步，
       * 只会得到「该角色还没有授权抽卡数据访问」。在这里顺手给一次入口，
       * 比让用户事后自己去账户管理里找要好得多。
       *
       * 授权是可选步骤：跳过直接完成，之后仍可在「账户管理」里补。
       */
      setAuthRoles(selected);
      setAuthStatuses(
        Object.fromEntries(
          selected.map((r) => [
            r.roleId,
            r.u8Authorized ? "authorized" : "idle",
          ]),
        ),
      );
      setStage("auth");
    } catch (e) {
      logger.error("Failed to save selected roles: " + e, "AddAccountModal");
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  /** 授权 / 取消授权某个角色的抽卡数据。 */
  const runAuthorizeRole = async (role: RoleDisplayInfo) => {
    setBusyRoleId(role.roleId);
    setError("");
    try {
      if (authStatuses[role.roleId] === "authorized") {
        const ok = await revokeRoleU8Token(role.roleId);
        if (!ok) throw new Error(t("settings.account.u8_revoke_failed"));
        setAuthStatuses((prev) => ({ ...prev, [role.roleId]: "idle" }));
      } else {
        const result = await authorizeRoleU8Token(role.roleId);
        if (result.status !== "authorized") {
          throw new Error(
            result.message || t("settings.account.u8_authorize_failed"),
          );
        }
        setAuthStatuses((prev) => ({
          ...prev,
          [role.roleId]: "authorized",
        }));
      }
    } catch (e) {
      logger.error("Failed to toggle u8 authorization: " + e, "AddAccountModal");
      setError(String(e));
    } finally {
      setBusyRoleId(null);
    }
  };

  /**
   * 绑定完成后自动选中新账户。
   *
   * 优先终末地角色：明日方舟角色的数据接口与现有卡片不兼容，自动切成它会让
   * 仪表盘立刻全线报错（与 `pages/account.tsx` 的规则一致）。
   */
  const selectPreferredAccount = async (ownerUserId: string) => {
    try {
      const [list, current] = await Promise.all([
        getAccounts(),
        getSelectedAccount(),
      ]);
      if (current && list.some((a) => a.id === current)) return;
      const sameUser = list.filter((a) => a.userId === ownerUserId);
      const preferred =
        sameUser.find((a) => a.game !== "arknights") ??
        sameUser[0] ??
        list.find((a) => a.game !== "arknights") ??
        list[0];
      if (preferred) await setSelectedAccount(preferred.id);
      window.dispatchEvent(new CustomEvent("accountChanged"));
    } catch (e) {
      // 选号失败不影响绑定结果，只是启动页还要用户手动切一次
      logger.error("Failed to select preferred account: " + e, "AddAccountModal");
    }
  };

  const title =
    stage === "roles"
      ? t("settings.account.select_game_roles")
      : stage === "auth"
        ? t("settings.account.u8_auth_title")
        : stage === "confirm"
          ? t("settings.account.confirm_skland_binding")
          : t("settings.account.add_account");

  return (
    <CustomModal isOpen={isOpen} onClose={onClose} size="sm">
      <CustomModalHeader onClose={onClose}>{title}</CustomModalHeader>
      <CustomModalBody className="space-y-4">
        {/* ---- 阶段 1：选择登录方式 ---- */}
        {stage === "method" && (
          <>
            <p className="text-center text-sm text-muted">
              {t("settings.account.select_login_method")}
            </p>
            <div className="space-y-2">
              {(
                [
                  {
                    key: "password" as Method,
                    label: t("settings.account.password_login"),
                  },
                  {
                    key: "sms" as Method,
                    label: t("settings.account.sms_login"),
                  },
                  {
                    key: "qrcode" as Method,
                    label: t("settings.account.qr_login"),
                  },
                ]
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => {
                    setMethod(opt.key);
                    setStage("credentials");
                    if (opt.key === "qrcode") void startQr();
                  }}
                  className="lg-control flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left transition-colors active:bg-foreground/[0.04] touch-target"
                >
                  <span className="flex-1 text-sm font-medium text-foreground">
                    {opt.label}
                  </span>
                  <svg
                    className="h-4 w-4 shrink-0 text-muted"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </button>
              ))}
            </div>
          </>
        )}

        {/* ---- 阶段 2：填写凭据 ---- */}
        {stage === "credentials" && method !== "qrcode" && (
          <div className="space-y-3">
            <label className="block space-y-1.5">
              <span className="text-xs text-muted">
                {t("settings.account.phone")}
              </span>
              <GlassInput
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t("settings.account.phone_placeholder")}
              />
            </label>

            {method === "password" ? (
              <label className="block space-y-1.5">
                <span className="text-xs text-muted">
                  {t("settings.account.password")}
                </span>
                <GlassInput
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("settings.account.password_placeholder")}
                />
              </label>
            ) : (
              <label className="block space-y-1.5">
                <span className="text-xs text-muted">
                  {t("settings.account.verification_code")}
                </span>
                <div className="flex gap-2">
                  <GlassInput
                    type="text"
                    inputMode="numeric"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="000000"
                    className="flex-1"
                  />
                  <GlassButton
                    variant="secondary"
                    size="sm"
                    isDisabled={!phone.trim() || countdown > 0 || isSending}
                    onPress={() => void handleSendCode()}
                    className="shrink-0"
                  >
                    {countdown > 0
                      ? `${countdown}s`
                      : t("settings.account.send_code")}
                  </GlassButton>
                </div>
              </label>
            )}

            {error && <p className="text-xs text-danger-text">{error}</p>}
          </div>
        )}

        {/* ---- 阶段 2b：扫码 ---- */}
        {stage === "credentials" && method === "qrcode" && (
          <div className="flex flex-col items-center gap-3 py-2">
            {busy && !scanUrl ? (
              <GlassSpinner color="primary" />
            ) : scanUrl ? (
              <>
                <div className="rounded-xl bg-white p-3">
                  <Img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(scanUrl)}`}
                    alt="QR"
                    className="h-[180px] w-[180px]"
                  />
                </div>
                <p className="text-center text-xs text-muted">
                  {scanWaiting
                    ? t("settings.account.scan_waiting")
                    : t("settings.account.scan_confirm")}
                </p>
              </>
            ) : (
              <GlassSpinner color="primary" />
            )}
            {error && <p className="text-xs text-danger-text">{error}</p>}
          </div>
        )}

        {/* ---- 阶段 3：确认森空岛账户 ---- */}
        {stage === "confirm" && (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              {t("settings.account.confirm_skland_binding_desc")}
            </p>

            <div className="lg-material-sub rounded-lg border border-separator p-4">
              <div className="flex items-center gap-3">
                {/* 用刚拿到的 cred/token 拉头像与昵称（后端还没缓存该账户） */}
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full border border-separator/60 bg-content2/30">
                  {profile?.avatar ? (
                    <Img
                      src={profile.avatar}
                      alt={
                        profile.nickname ||
                        userId ||
                        t("settings.account.skland_account")
                      }
                      className="h-full w-full object-cover"
                    />
                  ) : profileFailed ? (
                    <div className="flex h-full w-full items-center justify-center text-lg font-semibold text-muted">
                      {(profile?.nickname || userId || "?").charAt(0)}
                    </div>
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <GlassSpinner color="primary" size="sm" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted">
                    {t("settings.account.skland_account")}
                  </p>
                  <p className="mt-0.5 truncate text-sm font-medium text-foreground">
                    {profile?.nickname || userId}
                  </p>
                  <p className="mt-0.5 break-all font-mono text-xs text-muted">
                    {userId}
                  </p>
                </div>
              </div>
              {profileFailed && (
                <p className="mt-2 text-xs text-muted">
                  {t("settings.account.skland_profile_failed")}
                </p>
              )}
            </div>

            {error && <p className="text-xs text-danger-text">{error}</p>}
          </div>
        )}

        {/* ---- 阶段 4：选择游戏角色 ---- */}
        {stage === "roles" && (
          <div className="space-y-3">
            <p className="text-xs text-muted">
              {checkingRoles
                ? t("settings.account.roles_checking")
                : t("settings.account.select_roles_for_skland", {
                    userId,
                  })}
            </p>

            {checkingRoles ? (
              <div className="flex flex-col items-center justify-center gap-2 py-8">
                <GlassSpinner color="primary" />
                <p className="text-center text-xs text-muted/70">
                  {t("settings.account.roles_checking_scope")}
                </p>
              </div>
            ) : roles.length === 0 ? (
              <div className="space-y-3 py-6 text-center">
                <p className="text-sm text-muted">
                  {t("settings.account.no_game_roles")}
                </p>
                <GlassButton
                  size="sm"
                  variant="outline"
                  onPress={() => void handleConfirmSkland()}
                >
                  {t("settings.account.retry_later")}
                </GlassButton>
              </div>
            ) : (
              <div className="space-y-2">
                {roles.map((role) => {
                  const checked = selectedRoleIds.includes(role.roleId);
                  return (
                    <button
                      key={role.roleId}
                      type="button"
                      onClick={() =>
                        setSelectedRoleIds((prev) =>
                          checked
                            ? prev.filter((id) => id !== role.roleId)
                            : [...prev, role.roleId],
                        )
                      }
                      className="lg-control flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors active:bg-foreground/[0.04] touch-target"
                    >
                      <span
                        className={
                          checked
                            ? "flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground"
                            : "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-separator"
                        }
                      >
                        {checked && (
                          <svg
                            className="h-3.5 w-3.5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            strokeWidth={3}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        )}
                      </span>
                      <AccountAvatar
                        src={role.avatarUrl}
                        alt={role.nickname}
                        size="sm"
                        className="!rounded-full"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium text-foreground">
                            {role.nickname}
                          </span>
                          <GameBadge game={role.game} variant="icon" size="sm" />
                        </span>
                        <span className="block text-xs text-muted">
                          Lv.{role.level}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {error && <p className="text-xs text-danger-text">{error}</p>}
          </div>
        )}

        {/* ---- 阶段 5：授权抽卡数据（与桌面端一致，可选） ---- */}
        {stage === "auth" && (
          <div className="space-y-3">
            <p className="text-xs text-muted">
              {t("settings.account.u8_auth_desc")}
            </p>

            <div className="space-y-2">
              {authRoles.map((role) => {
                const status = authStatuses[role.roleId] ?? "idle";
                const authorized = status === "authorized";
                const roleBusy = busyRoleId === role.roleId;
                return (
                  <div
                    key={role.roleId}
                    className="lg-control flex items-center gap-3 rounded-xl px-3 py-2.5"
                  >
                    <AccountAvatar
                      src={role.avatarUrl}
                      alt={role.nickname}
                      size="sm"
                      className="!rounded-full"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-foreground">
                          {role.nickname}
                        </span>
                        <GameBadge game={role.game} variant="icon" size="sm" />
                      </span>
                      <span className="block text-xs text-muted">
                        {authorized
                          ? t("settings.account.u8_authorized_btn")
                          : `Lv.${role.level}`}
                      </span>
                    </span>
                    <GlassButton
                      size="sm"
                      variant={authorized ? "outline" : "primary"}
                      isDisabled={roleBusy}
                      onPress={() => void runAuthorizeRole(role)}
                      className="shrink-0"
                    >
                      {roleBusy
                        ? t("settings.account.loading")
                        : authorized
                          ? t("settings.account.u8_authorized_btn")
                          : t("settings.account.u8_authorize")}
                    </GlassButton>
                  </div>
                );
              })}
            </div>

            {error && <p className="text-xs text-danger-text">{error}</p>}
          </div>
        )}
      </CustomModalBody>

      <CustomModalFooter>
        {stage === "method" ? (
          <GlassButton variant="secondary" onPress={onClose} className="w-full">
            {t("common.cancel")}
          </GlassButton>
        ) : stage === "confirm" ? (
          <div className="flex w-full gap-2">
            <GlassButton
              variant="secondary"
              isDisabled={busy}
              onPress={() => {
                setStage("credentials");
                setError("");
              }}
              className="flex-1"
            >
              {t("common.back")}
            </GlassButton>
            <GlassButton
              variant="primary"
              isDisabled={busy}
              onPress={() => void handleConfirmSkland()}
              className="flex-1"
            >
              {busy
                ? t("settings.account.logging_in")
                : t("common.confirm")}
            </GlassButton>
          </div>
        ) : stage === "roles" ? (
          roles.length === 0 && !checkingRoles ? (
            <GlassButton variant="secondary" onPress={onAdded} className="w-full">
              {t("settings.account.close")}
            </GlassButton>
          ) : (
            <div className="flex w-full gap-2">
              <GlassButton
                variant="secondary"
                isDisabled={busy}
                onPress={() => {
                  setStage("confirm");
                  setError("");
                }}
                className="flex-1"
              >
                {t("common.back")}
              </GlassButton>
              <GlassButton
                variant="primary"
                isDisabled={busy || checkingRoles || selectedRoleIds.length === 0}
                onPress={() => void handleConfirmRoles()}
                className="flex-1"
              >
                {busy || checkingRoles
                  ? t("settings.account.logging_in")
                  : t("settings.account.confirm_roles")}
              </GlassButton>
            </div>
          )
        ) : stage === "auth" ? (
          /*
           * 授权是**可选**收尾：跳过直接完成，之后仍可在「账户管理」里补。
           * 不给「返回」——角色已经落盘，退回去重选没有意义。
           */
          <div className="flex w-full gap-2">
            <GlassButton
              variant="secondary"
              isDisabled={busyRoleId !== null}
              onPress={onAdded}
              className="flex-1"
            >
              {t("settings.account.u8_skip")}
            </GlassButton>
            <GlassButton
              variant="primary"
              isDisabled={busyRoleId !== null}
              onPress={onAdded}
              className="flex-1"
            >
              {t("settings.account.u8_done")}
            </GlassButton>
          </div>
        ) : (
          <div className="flex w-full gap-2">
            <GlassButton
              variant="secondary"
              onPress={() => {
                setStage("method");
                setError("");
              }}
              className="flex-1"
            >
              {t("common.back")}
            </GlassButton>
            {method !== "qrcode" && (
              <GlassButton
                variant="primary"
                isDisabled={busy || !phone.trim()}
                onPress={() => void handleSubmit()}
                className="flex-1"
              >
                {busy
                  ? t("settings.account.logging_in")
                  : t("settings.account.login")}
              </GlassButton>
            )}
          </div>
        )}
      </CustomModalFooter>
    </CustomModal>
  );
}
