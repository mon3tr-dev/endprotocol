import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import {
  CustomModal,
  CustomModalHeader,
  CustomModalBody,
  CustomModalFooter,
} from "@/components/custom-modal";
import { GlassButton, GlassSpinner } from "@/components/ui/glass";
import { AccountAvatar } from "@/components/ui/account-avatar";
import { GameBadge } from "@/components/ui/game-badge";
import { ChevronRightIcon } from "@/components/ui/app-icon";
import {
  authorizeRoleU8Token,
  deleteSklandAccount,
  getAccounts,
  getSklandAccountRoles,
  getSklandAccounts,
  revokeRoleU8Token,
  saveSelectedRoles,
  U8_AUTH_TIMEOUT_MESSAGE,
  U8_AUTH_TIMEOUT_SECONDS,
  type Account,
  type RoleDisplayInfo,
  type SklandAccount,
} from "@/utils/accountService";
import logger from "@/utils/logger";

/**
 * 窄屏「账户管理」抽屉 —— 与桌面 `pages/account.tsx` 的账户管理能力对齐。
 *
 * ## 为什么需要它
 *
 * Android 上底部导航的「Me」指向 `/account`，但窄屏走 `MePage` 这个简化的
 * 个人中心，只读账户数据。桌面页里那些**写操作**（绑/解绑游戏角色、
 * 授权/取消抽卡、删除森空岛账户）在窄屏完全没有入口 —— 用户看得见账户，
 * 却改不了它。这个抽屉补的就是这部分。
 *
 * ## 结构：森空岛账户 → 游戏角色 → 每个角色的操作
 *
 * 父账户（`account_token_*`）下面挂着 N 个游戏角色，二者是父子关系：
 * - 删除账户是**账户级**：父账户 + 全部角色 + 全部凭据一起删（不可逆）
 * - 绑定/解绑、授权/取消授权是**角色级**
 *
 * ## 为什么角色要按需拉取
 *
 * `get_skland_accounts` 只给「账户 + 角色数量」，角色详情（含 `u8Authorized`）
 * 要 `get_skland_account_roles(userId)` 走一次网络（通行证绑定列表 + 每个
 * 角色详情，十几秒是正常的）。所以展开哪个账户才拉哪个，且结果缓存在
 * 本组件内，重复展开不再请求。
 */

interface SklandRoleSet {
  roles: RoleDisplayInfo[];
  cred: string;
  token: string;
}

export interface AccountManagerDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  /** 任何写操作成功后回调，让父组件刷新账户列表 */
  onChanged: () => void;
}

export function AccountManagerDrawer({
  isOpen,
  onClose,
  onChanged,
}: AccountManagerDrawerProps) {
  const { t } = useTranslation();

  const [sklandAccounts, setSklandAccounts] = useState<SklandAccount[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [roleSets, setRoleSets] = useState<Record<string, SklandRoleSet>>({});
  const [loadingUserId, setLoadingUserId] = useState<string | null>(null);
  const [roleError, setRoleError] = useState("");

  /** 正在执行写操作的角色（禁用该行按钮，避免连点） */
  const [busyRoleKey, setBusyRoleKey] = useState<string | null>(null);
  /** 正在执行写操作的账户（删除） */
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  /** 删除确认 */
  const [deleteTarget, setDeleteTarget] = useState<SklandAccount | null>(null);

  /** 操作结果提示（就地显示，不打扰全局） */
  const [notice, setNotice] = useState<{ tone: "ok" | "danger"; text: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const [skland, plain] = await Promise.all([
        getSklandAccounts(),
        getAccounts(),
      ]);
      setSklandAccounts(skland ?? []);
      setAccounts(plain ?? []);
    } catch (e) {
      logger.error("Failed to load accounts for manager: " + e, "AccountManager");
      setError(String(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 每次打开都重新拉：账户可能在别处被改过
  useEffect(() => {
    if (!isOpen) return;
    setExpandedUserId(null);
    setRoleSets({});
    setNotice(null);
    setDeleteTarget(null);
    setRoleError("");
    void load();
  }, [isOpen, load]);

  /** 已绑定角色 = `accounts` 里属于该 userId 的那些（id 即 roleId）。 */
  const boundRoleIds = useCallback(
    (userId: string) =>
      new Set(
        accounts.filter((a) => a.userId === userId).map((a) => a.id),
      ),
    [accounts],
  );

  /** 按 userId 回溯 roleSet；展开账户时才拉。 */
  const toggleExpand = async (userId: string) => {
    if (expandedUserId === userId) {
      setExpandedUserId(null);
      return;
    }
    setExpandedUserId(userId);
    setRoleError("");
    if (roleSets[userId]) return;

    setLoadingUserId(userId);
    try {
      const result = await getSklandAccountRoles(userId);
      if (!result.success || !result.cred || !result.token) {
        throw new Error(
          result.errorMessage || t("settings.account.roles_check_failed"),
        );
      }
      setRoleSets((prev) => ({
        ...prev,
        [userId]: {
          roles: result.availableRoles ?? [],
          cred: result.cred as string,
          token: result.token as string,
        },
      }));
    } catch (e) {
      logger.error("Failed to load roles: " + e, "AccountManager");
      setRoleError(String(e));
    } finally {
      setLoadingUserId(null);
    }
  };

  /** 绑 / 解绑一个游戏角色（写的是整个账户的角色集合）。 */
  const toggleBind = async (
    userId: string,
    role: RoleDisplayInfo,
    currentlyBound: boolean,
  ) => {
    const roleSet = roleSets[userId];
    if (!roleSet) return;
    const key = `${userId}:${role.roleId}`;
    setBusyRoleKey(key);
    setNotice(null);
    try {
      const nextIds = boundRoleIds(userId);
      if (currentlyBound) nextIds.delete(role.roleId);
      else nextIds.add(role.roleId);

      const selected = roleSet.roles.filter((r) => nextIds.has(r.roleId));
      await saveSelectedRoles(roleSet.cred, roleSet.token, userId, selected);

      await load();
      onChanged();
      setNotice({
        tone: "ok",
        text: currentlyBound
          ? t("settings.account.unbind_ok", { defaultValue: "已解绑该角色" })
          : t("settings.account.bind_ok", { defaultValue: "已绑定该角色" }),
      });
    } catch (e) {
      logger.error("Failed to toggle role binding: " + e, "AccountManager");
      setNotice({ tone: "danger", text: String(e) });
    } finally {
      setBusyRoleKey(null);
    }
  };

  /** 授权 / 取消授权抽卡数据。 */
  const toggleU8 = async (
    userId: string,
    role: RoleDisplayInfo,
    authorized: boolean,
  ) => {
    const key = `${userId}:${role.roleId}`;
    setBusyRoleKey(key);
    setNotice(null);
    try {
      if (authorized) {
        const revoked = await revokeRoleU8Token(role.roleId);
        if (!revoked) throw new Error(t("settings.account.u8_revoke_failed"));
        setNotice({ tone: "ok", text: t("settings.account.u8_revoked_ok") });
      } else {
        const result = await authorizeRoleU8Token(role.roleId);
        if (result.status !== "authorized") {
          throw new Error(
            result.message
              ? describeU8Failure(result.message, t)
              : t("settings.account.u8_authorize_failed"),
          );
        }
        setNotice({ tone: "ok", text: t("settings.account.u8_authorized_ok") });
      }

      // 就地更新这一行的开关（不重新拉整份角色列表：那要十几秒）
      setRoleSets((prev) => {
        const entry = prev[userId];
        if (!entry) return prev;
        return {
          ...prev,
          [userId]: {
            ...entry,
            roles: entry.roles.map((r) =>
              r.roleId === role.roleId ? { ...r, u8Authorized: !authorized } : r,
            ),
          },
        };
      });
      onChanged();
    } catch (e) {
      logger.error("Failed to toggle u8 authorization: " + e, "AccountManager");
      setNotice({ tone: "danger", text: String(e) });
    } finally {
      setBusyRoleKey(null);
    }
  };

  /** 删除整个森空岛账户（父账户 + 全部角色 + 凭据）。 */
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const userId = deleteTarget.userId;
    setBusyUserId(userId);
    setNotice(null);
    try {
      const ok = await deleteSklandAccount(userId);
      if (!ok) throw new Error(t("settings.account.delete_account_failed", {
        defaultValue: "删除账户失败",
      }));

      setDeleteTarget(null);
      setExpandedUserId((prev) => (prev === userId ? null : prev));
      setRoleSets((prev) => {
        if (!(userId in prev)) return prev;
        const next = { ...prev };
        delete next[userId];
        return next;
      });
      await load();
      setNotice({
        tone: "ok",
        text: t("settings.account.delete_account_success", {
          defaultValue: "账户已删除",
        }),
      });
      onChanged();
    } catch (e) {
      logger.error("Failed to delete account: " + e, "AccountManager");
      setNotice({ tone: "danger", text: String(e) });
    } finally {
      setBusyUserId(null);
    }
  };

  const isEmpty = !isLoading && sklandAccounts.length === 0;

  return (
    <>
      <CustomModal isOpen={isOpen} onClose={onClose} size="md" height="fixed">
        <CustomModalHeader onClose={onClose}>
          {t("settings.account.manage_accounts", { defaultValue: "账户管理" })}
        </CustomModalHeader>

        <CustomModalBody className="space-y-3">
          {isLoading && sklandAccounts.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12">
              <GlassSpinner color="primary" />
              <p className="text-xs text-muted">{t("settings.account.loading")}</p>
            </div>
          ) : isEmpty ? (
            <div className="py-12 text-center">
              <p className="text-sm text-muted">
                {t("settings.account.no_accounts")}
              </p>
            </div>
          ) : (
            sklandAccounts.map((sa) => {
              const expanded = expandedUserId === sa.userId;
              const roleSet = roleSets[sa.userId];
              const bound = boundRoleIds(sa.userId);
              return (
                <div
                  key={sa.userId}
                  className="overflow-hidden rounded-xl border border-separator/60"
                >
                  {/* ---- 父账户行 ---- */}
                  <button
                    type="button"
                    onClick={() => void toggleExpand(sa.userId)}
                    className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors active:bg-foreground/[0.04] touch-target"
                  >
                    <AccountAvatar
                      src={sa.avatar}
                      alt={sa.nickname || sa.userId}
                      size="md"
                      className="!rounded-full"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {sa.nickname || sa.userId}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-muted">
                        {sa.userId}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-muted">
                        {t("settings.account.game_role_count", {
                          count: sa.gameRoleCount,
                        })}
                      </span>
                    </span>
                    <ChevronRightIcon
                      size={16}
                      className={clsx(
                        "shrink-0 text-muted transition-transform",
                        expanded && "rotate-90",
                      )}
                    />
                  </button>

                  {/* ---- 展开区：角色列表 ---- */}
                  {expanded && (
                    <div className="border-t border-separator/60 bg-foreground/[0.02] px-3 py-2">
                      {loadingUserId === sa.userId ? (
                        <div className="flex items-center justify-center gap-2 py-6">
                          <GlassSpinner color="primary" size="sm" />
                          <span className="text-xs text-muted">
                            {t("settings.account.roles_checking")}
                          </span>
                        </div>
                      ) : roleError && !roleSet ? (
                        <div className="space-y-2 py-4 text-center">
                          <p className="break-all text-xs text-danger-text">
                            {roleError}
                          </p>
                          <GlassButton
                            size="sm"
                            variant="outline"
                            onPress={() => void toggleExpand(sa.userId)}
                          >
                            {t("settings.account.retry")}
                          </GlassButton>
                        </div>
                      ) : roleSet && roleSet.roles.length === 0 ? (
                        <p className="py-4 text-center text-xs text-muted">
                          {t("settings.account.no_game_roles")}
                        </p>
                      ) : roleSet ? (
                        <div className="space-y-2 py-1">
                          {roleSet.roles.map((role) => {
                            const isBound = bound.has(role.roleId);
                            const key = `${sa.userId}:${role.roleId}`;
                            const busy = busyRoleKey === key;
                            return (
                              <div
                                key={role.roleId}
                                className="rounded-lg border border-separator/50 bg-background/40 p-2.5"
                              >
                                <div className="flex items-center gap-2.5">
                                  <AccountAvatar
                                    src={role.avatarUrl}
                                    alt={role.nickname}
                                    size="sm"
                                    className="!rounded-full"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                      <span className="truncate text-sm font-medium text-foreground">
                                        {role.nickname}
                                      </span>
                                      <GameBadge
                                        game={role.game}
                                        variant="icon"
                                        size="sm"
                                      />
                                    </div>
                                    <span className="block text-[11px] text-muted">
                                      Lv.{role.level}
                                    </span>
                                  </div>
                                </div>

                                {/* 两个开关：绑定 / 抽卡授权 */}
                                <div className="mt-2 flex gap-2">
                                  <GlassButton
                                    size="sm"
                                    variant={isBound ? "outline" : "primary"}
                                    isDisabled={busy}
                                    onPress={() =>
                                      void toggleBind(sa.userId, role, isBound)
                                    }
                                    className="flex-1"
                                  >
                                    {isBound
                                      ? t("settings.account.unbind_role")
                                      : t("settings.account.bind_role")}
                                  </GlassButton>
                                  <GlassButton
                                    size="sm"
                                    variant={
                                      role.u8Authorized ? "outline" : "secondary"
                                    }
                                    isDisabled={busy}
                                    onPress={() =>
                                      void toggleU8(
                                        sa.userId,
                                        role,
                                        !!role.u8Authorized,
                                      )
                                    }
                                    className="flex-1"
                                  >
                                    {role.u8Authorized
                                      ? t("settings.account.u8_authorized_btn")
                                      : t("settings.account.u8_authorize")}
                                  </GlassButton>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}

                      {/* 删除父账户：账户级、不可逆，单独放最下方 */}
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(sa)}
                        disabled={busyUserId === sa.userId}
                        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs text-danger-text transition-colors active:bg-danger/10 disabled:opacity-50 touch-target"
                      >
                        {busyUserId === sa.userId ? (
                          <GlassSpinner size="sm" color="primary" />
                        ) : null}
                        {t("settings.account.delete_account")}
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}

          {notice && (
            <p
              className={clsx(
                "text-xs",
                notice.tone === "ok" ? "text-success-text" : "text-danger-text",
              )}
              role="status"
            >
              {notice.text}
            </p>
          )}
          {error && <p className="text-xs text-danger-text">{error}</p>}
        </CustomModalBody>

        <CustomModalFooter>
          <GlassButton variant="secondary" onPress={onClose} className="w-full">
            {t("settings.account.close")}
          </GlassButton>
        </CustomModalFooter>
      </CustomModal>

      {/* 删除确认：账户级删除不可逆，必须二次确认 */}
      <CustomModal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        size="sm"
      >
        <CustomModalHeader onClose={() => setDeleteTarget(null)}>
          {t("settings.account.delete_account")}
        </CustomModalHeader>
        <CustomModalBody className="space-y-2">
          <p className="text-sm text-foreground">
            {deleteTarget?.nickname || deleteTarget?.userId}
          </p>
          <p className="text-xs text-danger-text">
            {t("settings.account.delete_account_warning")}
          </p>
          <p className="text-xs text-muted">
            {t("settings.account.delete_account_desc")}
          </p>
        </CustomModalBody>
        <CustomModalFooter>
          <div className="flex w-full gap-2">
            <GlassButton
              variant="secondary"
              onPress={() => setDeleteTarget(null)}
              isDisabled={busyUserId !== null}
              className="flex-1"
            >
              {t("common.cancel")}
            </GlassButton>
            <GlassButton
              variant="danger"
              onPress={() => void confirmDelete()}
              isDisabled={busyUserId !== null}
              className="flex-1"
            >
              {busyUserId !== null
                ? t("settings.account.loading")
                : t("settings.account.delete_account_confirm")}
            </GlassButton>
          </div>
        </CustomModalFooter>
      </CustomModal>
    </>
  );
}

/**
 * 把后端授权的失败原因转成可读文案。
 *
 * 与桌面 `pages/account.tsx` 的 `describeU8Failure` 同义；窄屏没有
 * `u8authorized` 那套状态机，所以这里只做文案映射。
 */
function describeU8Failure(
  message: string | undefined,
  t: (key: string) => string,
): string {
  if (!message) return t("settings.account.u8_authorize_failed");
  if (message === U8_AUTH_TIMEOUT_MESSAGE) {
    return t("settings.account.u8_authorize_timeout").replace(
      "{{seconds}}",
      String(U8_AUTH_TIMEOUT_SECONDS),
    );
  }
  return message;
}
