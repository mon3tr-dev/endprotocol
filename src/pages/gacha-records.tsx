import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import clsx from "clsx";
import { GlassButton, GlassCard, GlassProgressCircle, GlassSelect } from "@/components/ui/glass";
import { SimplePagination } from "@/components/simple-pagination";
import GachaPityChart from "@/components/gacha-pity-chart";
import GachaStatCharts from "@/components/gacha-stat-charts";
import {
  CustomModal,
  CustomModalHeader,
  CustomModalBody,
  CustomModalFooter,
} from "@/components/custom-modal";
import { RefreshIcon, ChevronDownIcon, CheckIcon } from "@/components/ui/app-icon";
import { GlassPillIndicator, GlassPillItem } from "@/components/ui/glass-pill";
import { AccountNameLine, GameBadge } from "@/components/ui/game-badge";
import { AccountAvatar } from "@/components/ui/account-avatar";
import { SearchIcon } from "@/components/icons";
import { Img } from "@/utils/imageLoader";
import {
  authorizeRoleU8Token,
  getAccounts,
  getSelectedAccount,
  U8_AUTH_TIMEOUT_MESSAGE,
  U8_AUTH_TIMEOUT_SECONDS,
  type Account,
  type GameId,
} from "@/utils/accountService";
import { resolveServerLabel } from "@/types";
import { logError } from "@/utils/logger";
import { addMessage } from "@/utils/messageStore";
import { calculateGachaSixStarIntervals } from "@/utils/gachaIntervals";
import type {
  ArknightsGachaCategory,
  GachaCategory,
  GachaPoolKind,
  GachaRecord,
  GachaSyncProgress,
  GachaSyncResult,
  SavedGachaData,
  SavedWeaponGachaData,
} from "@/types/gacha";

/**
 * 全部可选分类。
 *
 * ⚠️ **不是所有游戏都有全部分类**：`joint`（联合寻访）与 `weapon`（武器寻访）
 * 是终末地独有的概念，《明日方舟》没有。渲染时按当前角色的游戏过滤，
 * 见 `categories`。
 */
const CATEGORIES: { key: GachaCategory; labelZh: string; labelEn: string }[] = [
  { key: "all", labelZh: "全部角色", labelEn: "All" },
  { key: "special", labelZh: "限定", labelEn: "Limited" },
  { key: "joint", labelZh: "联合", labelEn: "Joint" },
  { key: "normal", labelZh: "常驻", labelEn: "Standard" },
  { key: "weapon", labelZh: "武器", labelEn: "Weapon" },
];

/** 《明日方舟》只有限定/联动/中坚三类角色寻访，没有联合与武器 */
const ARKNIGHTS_CATEGORY_KEYS: GachaCategory[] = ["all", "special", "normal"];

const RARITY_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "全部" },
  { value: 6, label: "6★" },
  { value: 5, label: "5★" },
  { value: 4, label: "4★" },
];

/**
 * 后端在「该角色未授权抽卡令牌」时的报错文案。
 *
 * u8token 改为按角色授权后，未授权的角色会遇到这里；给用户一个能照着做的提示，
 * 而不是把后端英文原文丢到界面上。
 */
function isU8UnauthorizedError(error: unknown): boolean {
  const raw = String(error);
  return (
    raw.includes("not authorized for roleId") ||
    raw.includes("Please authorize it on the account page") ||
    raw.includes("Please re-authorize it on the account page")
  );
}

/**
 * 《明日方舟》特有的「token 被服务端静默拒绝」。
 *
 * 该接口对任何无效 token 都返回 `code=0` + 空列表，后端已把空列表转成鉴权错误，
 * 这里负责把它翻译成人话 —— 否则用户只会看到一句英文的 AuthError。
 */
function isArknightsTokenRejected(error: unknown): boolean {
  const raw = String(error);
  return (
    raw.includes("Arknights gacha token rejected") ||
    raw.includes("belongs to another account/game")
  );
}

/** 把同步失败的错误转成面向用户的文案 */
function describeGachaSyncError(error: unknown, isZh: boolean): string {
  if (isU8UnauthorizedError(error)) {
    return isZh
      ? "该角色还没有授权抽卡数据访问。请到「账户」页展开它所属的森空岛账户，点该角色的「授权抽卡」后再同步；渠道服角色暂不支持。"
      : "This role has not authorized gacha data access. Open the Accounts page, expand its Skland account and click \"Authorize\" on the role, then sync again (channel-server roles are not supported yet).";
  }
  if (isArknightsTokenRejected(error)) {
    return isZh
      ? "明日方舟服务端拒绝了这次访问（返回空卡池列表）。可能原因：令牌已过期，或该令牌不属于这个账号。请到「账户」页对该角色点一次「授权抽卡」刷新令牌后再试。"
      : "The Arknights server rejected this request (empty pool list). The token may have expired or belong to a different account. Re-authorize this role on the Accounts page and try again.";
  }
  return String(error);
}

/** 记录所属卡池类型：优先用 pools 元信息，缺失时按 poolId 前缀推断 */
function poolKindOf(rec: GachaRecord, pools: Record<string, { poolType: string }>): GachaPoolKind {
  const poolType = pools[rec.poolId]?.poolType;
  if (poolType) {
    if (poolType.includes("Joint")) return "joint";
    if (poolType.includes("Standard")) return "normal";
    return "special";
  }
  // ── 前缀兜底（两侧规则完全不同，必须分开写）──
  // 终末地：joint_* / standard*
  if (rec.poolId.startsWith("joint_")) return "joint";
  if (rec.poolId.startsWith("standard")) return "normal";
  // 明日方舟：LIMITED_*（限定）/ LINKAGE_*（联动）/ CLASSIC_*（中坚=常驻）
  // 没有联合池——返回 joint 会让记录被"联合"分类错误收走
  if (rec.poolId.startsWith("CLASSIC")) return "normal";
  return "special";
}

/**
 * 《明日方舟》分类名含换行符（接口下发 `"限定寻访\n庆典"`），
 * 单行 chip / 下拉里必须压成一行，否则会把按钮撑成两行。
 */
function formatCategoryName(name: string): string {
  return name.replace(/\s*\n\s*/g, "·");
}

/** 进度 tabKey -> 显示名 */
function tabLabel(tabKey: string, isZh: boolean): string {
  if (tabKey.startsWith("weapon")) return isZh ? "武器" : "Weapon";
  if (tabKey.startsWith("joint")) return isZh ? "联合" : "Joint";
  if (tabKey.startsWith("normal")) return isZh ? "常驻" : "Standard";
  return isZh ? "限定" : "Limited";
}

export default function GachaRecordsPage() {
  const { t, i18n } = useTranslation();
  /**
   * 窄屏分类栏交给布局层的底部胶囊（见 `ui/bottom-layer.ts`）。
   * 相关注册在 `categories` / `category` 定义之后（下方）。
   */
  const isZh = i18n.language === "zh";

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedGachaData | null>(null);
  const [weaponSaved, setWeaponSaved] = useState<SavedWeaponGachaData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** 当前角色的游戏：决定要显示哪些分类、以及同步时是否需要武器寻访 */
  const [game, setGame] = useState<GameId | undefined>(undefined);
  const isArknights = game === "arknights";

  /**
   * 《明日方舟》的卡池分类（`/api/gacha/cate`）。
   *
   * 终末地的卡池由记录自带的 `poolId` 反推即可，明日方舟不行 —— 它的
   * `cate` 分类 id（`anniver_fest`）与记录里的 `poolId`（`LIMITED_79_0_1`）
   * **不是同一个东西**，必须单独拉一次才知道有哪些分类，也才能提示哪些分类
   * 还没同步到（接口只保留 90 天，过期分类自然拉不到）。
   */
  const [akCategories, setAkCategories] = useState<ArknightsGachaCategory[]>([]);

  const [category, setCategory] = useState<GachaCategory>("all");
  const [tablePoolFilter, setTablePoolFilter] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [rarityFilter, setRarityFilter] = useState<number | null>(null);
  const [onlyNew, setOnlyNew] = useState(false);
  const [onlyFree, setOnlyFree] = useState(false);

  const [showRoleMenu, setShowRoleMenu] = useState(false);
  const roleMenuRef = useRef<HTMLDivElement>(null);

  // 同步状态（modal 关闭后后台继续，直到后端写盘完成）
  const [syncing, setSyncing] = useState(false);
  const syncRequestRef = useRef(0); // 当前同步请求序列号，用于丢弃过期请求的结果
  const [progress, setProgress] = useState<GachaSyncProgress | null>(null);
  const [progressModalOpen, setProgressModalOpen] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<GachaSyncResult | null>(null);

  /**
   * 未授权时的授权抽屉。
   *
   * 同步因「该角色未授权抽卡数据」失败时，**不再把一段报错文字丢给用户**，
   * 而是直接弹出授权抽屉，点一下就能授权、然后自动重试同步 ——
   * 报错文案里「去账户页展开账户点授权」那套指路在窄屏上根本走不通
   * （窄屏没有那个账户页结构）。
   */
  const [authDrawerOpen, setAuthDrawerOpen] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authNotice, setAuthNotice] = useState<{
    tone: "ok" | "danger";
    text: string;
  } | null>(null);
  /** 触发授权抽屉的那个错误：抽卡令牌被拒时也能给出同样的指引 */
  const [authReason, setAuthReason] = useState<"u8" | "arknights">("u8");

  /**
   * 本角色是否已经成功执行过授权动作（用于防止「授权 → 重试 → 又弹授权」死循环）。
   *
   * 用 ref 而不是 state：`handleSync` 的 catch 回调在 Promise 里执行，闭包会
   * 捕获旧的 state 值，用它判断会永远读到「没授权过」。
   */
  const authorizedRoleRef = useRef<string | null>(null);

  /**
   * 该角色是否已经授权过。
   *
   * `true` 时后续的同步失败**不再弹授权抽屉** —— 否则会形成
   * 「授权 → 自动重试 → 仍失败 → 再弹」的死循环。
   */
  const isAuthRetryBlocked = (rid: string | null): boolean =>
    !!rid && authorizedRoleRef.current === rid;

  /** 切到别的角色时清掉标记：不同角色的授权互不相干 */
  useEffect(() => {
    if (roleId && authorizedRoleRef.current !== null && authorizedRoleRef.current !== roleId) {
      authorizedRoleRef.current = null;
    }
  }, [roleId]);

  const loadSaved = useCallback(async (rid: string) => {
    try {
      const data = await invoke<SavedGachaData>("get_saved_gacha_records", { roleId: rid });
      setSaved(data);
      setError(null);
    } catch (e) {
      logError("[Gacha] Failed to load saved records:", e);
      setError(String(e));
    }
  }, []);

  const loadWeaponSaved = useCallback(async (rid: string) => {
    try {
      const data = await invoke<SavedWeaponGachaData>("get_saved_weapon_gacha_records", {
        roleId: rid,
      });
      setWeaponSaved(data);
    } catch (e) {
      logError("[Gacha] Failed to load weapon records:", e);
      setWeaponSaved(null);
    }
  }, []);

  /**
   * 拉取《明日方舟》的卡池分类（仅用于展示"有哪些分类"，失败不阻塞页面）。
   *
   * 会现换一次 u8token，因此未授权时会静默失败 —— 这时页面上只有本地记录，
   * 用户点同步才会看到明确的授权提示。
   */
  const loadAkCategories = useCallback(async (rid: string) => {
    try {
      const list = await invoke<ArknightsGachaCategory[]>("get_arknights_gacha_categories", {
        roleId: rid,
      });
      setAkCategories(list);
    } catch (e) {
      // 未授权 / token 失效都会走到这里：不是页面级错误，留空即可
      logError("[Gacha] Failed to load Arknights categories:", e);
      setAkCategories([]);
    }
  }, []);


  // 进入页面时重置为“主程序选择的角色”，本地切换不影响主程序
  const initRole = useCallback(async () => {
    setIsLoading(true);
    try {
      const [selectedId, accs] = await Promise.all([getSelectedAccount(), getAccounts()]);
      const valid = accs.filter((a) => a.status === "online" || a.status === "offline");
      setAccounts(valid);
      const rid = selectedId ?? valid[0]?.id ?? null;
      setRoleId(rid);
      setSaved(null);
      setWeaponSaved(null);
      setAkCategories([]);
      setGame(undefined);
      if (rid) {
        // 先定游戏再拉数据：分类集合、是否请求武器寻访都取决于它
        const g = valid.find((a) => a.id === rid)?.game;
        setGame(g);
        await Promise.all([
          loadSaved(rid),
          loadWeaponSaved(rid),
          g === "arknights" ? loadAkCategories(rid) : Promise.resolve(),
        ]);
      } else {
        setError(isZh ? "暂无可用角色，请先在账户页添加" : "No role available, please add one in Accounts");
      }
    } catch (e) {
      logError("[Gacha] Failed to init:", e);
      setError(String(e));
    } finally {
      setIsLoading(false);
    }
  }, [loadSaved, loadWeaponSaved, loadAkCategories, isZh]);

  useEffect(() => {
    initRole();
  }, [initRole]);

  // 主程序切换账号时，重置为新的主程序选择
  useEffect(() => {
    const handleAccountChange = () => initRole();
    window.addEventListener("accountChanged", handleAccountChange);
    return () => window.removeEventListener("accountChanged", handleAccountChange);
  }, [initRole]);

  // 点击外部关闭角色下拉
  useEffect(() => {
    if (!showRoleMenu) return;
    const handle = (e: MouseEvent) => {
      if (roleMenuRef.current && !roleMenuRef.current.contains(e.target as Node)) {
        setShowRoleMenu(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [showRoleMenu]);

  // 监听同步进度事件
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    (async () => {
      unlisten = await listen("gacha-sync-progress", (event) => {
        const p = event.payload as GachaSyncProgress;
        setProgress(p);
        if (p.done) setSyncing(false);
      });
    })();
    return () => {
      unlisten?.();
    };
  }, []);

  const handleSync = () => {
    if (!roleId) return;
    // 同步中再次点击 -> 重新打开进度窗口
    if (syncing) {
      setProgressModalOpen(true);
      return;
    }
    setSyncing(true);
    setSyncError(null);
    setSyncResult(null);
    setProgress(null);
    setProgressModalOpen(true);

    // 右上角同步按钮同步全部数据。
    //
    // ⚠️ **两个游戏要同步的集合不同**：
    // - 终末地：全部角色寻访（限定/联合/常驻）+ 武器寻访，两个命令并发
    // - 明日方舟：只有角色寻访，**没有武器寻访**，因此不发第二个请求
    //
    // 后端 `sync_gacha_records` 会按角色所属游戏自动选端点，前端不需要传游戏。
    const requestSeq = ++syncRequestRef.current;
    const charPromise = invoke<GachaSyncResult>("sync_gacha_records", { roleId });
    const weaponPromise = isArknights
      ? Promise.resolve<GachaSyncResult | null>(null)
      : invoke<GachaSyncResult>("sync_weapon_gacha_records", { roleId });

    Promise.all([charPromise, weaponPromise])
      .then(([charRes, weaponRes]) => {
        // 丢弃过期请求（期间已切换角色/再次点击）
        if (requestSeq !== syncRequestRef.current) return;
        const newRecords = charRes.newRecords + (weaponRes?.newRecords ?? 0);
        const totalRecords = charRes.totalRecords + (weaponRes?.totalRecords ?? 0);
        const perTabNew: Record<string, number> = {
          ...charRes.perTabNew,
          ...(weaponRes?.perTabNew ?? {}),
        };
        setSyncResult({
          ...charRes,
          userId: charRes.userId,
          serverId: charRes.serverId,
          syncedAt: Math.max(charRes.syncedAt, weaponRes?.syncedAt ?? 0),
          newRecords,
          totalRecords,
          perTabNew,
        });
        setSyncing(false);
        addMessage({
          type: "info",
          title: i18n.language === "zh" ? "抽卡记录同步完成" : "Gacha Sync Complete",
          body: isArknights
            ? i18n.language === "zh"
              ? `新增 ${newRecords} 条，共 ${totalRecords} 条`
              : `+${newRecords} new, ${totalRecords} total`
            : i18n.language === "zh"
              ? `新增 ${newRecords} 条，共 ${totalRecords} 条（角色 ${charRes.newRecords} 条 / 武器 ${weaponRes?.newRecords ?? 0} 条）`
              : `+${newRecords} new, ${totalRecords} total (char ${charRes.newRecords} / weapon ${weaponRes?.newRecords ?? 0})`,
          tag: "gacha",
        });
      })
      .catch((e) => {
        // 丢弃过期请求的错误
        if (requestSeq !== syncRequestRef.current) return;
        logError("[Gacha] Sync failed:", e);

        /**
         * 未授权 / 令牌被拒 → 弹授权抽屉，而不是显示一段「去账户页点授权」的报错。
         *
         * 窄屏没有桌面那种「展开账户 → 点角色授权」的结构，照着报错走不通；
         * 用户真正要做的是「就地授权」。所以这里把失败转成一个动作：
         * 关掉进度窗、打开抽屉，授权成功后自动重试。
         *
         * ⚠️ **只在本次同步还没授权过时才弹**。
         *
         * 授权成功后会自动重试同步；如果重试仍然失败（典型：该账号**没有任何
         * 抽卡记录**，明日方舟的 `/api/gacha/cate` 返回空列表，后端把空列表
         * 判定成鉴权失败），再弹一次抽屉就会形成死循环：点授权 → 重试 → 又弹
         * → 点授权 → …… 用户永远出不来。
         *
         * 所以一旦本角色的授权动作已经成功执行过，后续失败一律走普通错误分支，
         * 把「授权已完成、但同步仍失败」如实说清楚。
         */
        if (isAuthRetryBlocked(roleId)) {
          /**
           * 已经授权过还失败：不再兜圈子，直接报错。
           *
           * 最典型的成因是**该账号本来就没有抽卡记录**：明日方舟的
           * `/api/gacha/cate` 对「没抽过卡」和「token 无效」都返回空列表，
           * 后端无法区分，一律报鉴权错误。所以这里要把这层含义说出来，
           * 而不是让用户反复点授权。
           */
          const friendly = isArknightsTokenRejected(e)
            ? isZh
              ? "授权已完成，但服务端仍没有返回任何卡池数据。如果你的账号确实没有抽卡记录，这是正常现象；否则可能是令牌已过期，请稍后重试。"
              : "Authorization succeeded, but the server returned no pool data. If this account has never pulled, that is expected; otherwise the token may have expired — try again later."
            : describeGachaSyncError(e, i18n.language === "zh");
          addMessage({
            type: "urgent",
            title: isZh ? "抽卡记录同步失败" : "Gacha Sync Failed",
            body: friendly,
            tag: "gacha",
          });
          setSyncError(friendly);
          setSyncing(false);
          setProgressModalOpen(true);
          return;
        }

        if (isU8UnauthorizedError(e)) {
          setAuthReason("u8");
          setAuthNotice(null);
          setSyncing(false);
          setProgressModalOpen(false);
          setAuthDrawerOpen(true);
          return;
        }
        if (isArknightsTokenRejected(e)) {
          setAuthReason("arknights");
          setAuthNotice(null);
          setSyncing(false);
          setProgressModalOpen(false);
          setAuthDrawerOpen(true);
          return;
        }

        const friendly = describeGachaSyncError(e, i18n.language === "zh");
        addMessage({ type: "urgent", title: i18n.language === "zh" ? "抽卡记录同步失败" : "Gacha Sync Failed", body: friendly, tag: "gacha" });
        setSyncError(friendly);
        setSyncing(false);
        // 出错时重新打开进度窗口展示错误
        setProgressModalOpen(true);
      })
      .finally(() => {
        // 只在本请求仍为最新时刷新本地数据
        if (requestSeq === syncRequestRef.current) {
          loadSaved(roleId);
          loadWeaponSaved(roleId);
          // 同步后重新枚举分类：可能新开了卡池（明日方舟的 cate 是活的）
          if (isArknights) void loadAkCategories(roleId);
        }
      });
  };

  const handleSelectRole = (rid: string) => {    // 切换角色时游戏可能也变了（终末地 ↔ 明日方舟），分类集合要跟着换
    const g = accounts.find((a) => a.id === rid)?.game;
    setRoleId(rid);
    setGame(g);
    setShowRoleMenu(false);
    setCategory("all");
    setTablePoolFilter(null);
    setAkCategories([]);
    loadSaved(rid);
    loadWeaponSaved(rid);
    if (g === "arknights") void loadAkCategories(rid);
  };

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === roleId) ?? null,
    [accounts, roleId],
  );

  /**
   * 授权抽屉里点「授权」：先授权该角色，成功后自动重试同步。
   *
   * 授权是幂等的开关写入（后端每次现换令牌校验，令牌不落盘），所以重试安全。
   * 已有的 `role.u8Authorized` 为真时说明是「令牌被拒」而非「未授权」，
   * 这时也要重新授权一次以刷新令牌 —— 所以这里不判断当前状态，直接授权。
   */
  const authorizeAndRetrySync = async () => {
    if (!roleId) return;
    setAuthBusy(true);
    setAuthNotice(null);
    try {
      const result = await authorizeRoleU8Token(roleId);
      if (result.status !== "authorized") {
        setAuthNotice({
          tone: "danger",
          text:
            result.message === U8_AUTH_TIMEOUT_MESSAGE
              ? (isZh
                  ? `授权超时（${U8_AUTH_TIMEOUT_SECONDS} 秒），请稍后重试`
                  : `Authorization timed out after ${U8_AUTH_TIMEOUT_SECONDS}s. Please try again.`)
              : result.message || t("settings.account.u8_authorize_failed"),
        });
        return;
      }

      setAuthNotice({
        tone: "ok",
        text: t("settings.account.u8_authorized_ok"),
      });
      /**
       * 记下「本角色已授权」再重试。
       *
       * 这是防死循环的关键：重试若仍失败，`handleSync` 的 catch 会看到这个标记，
       * 于是走普通错误分支而不是再弹一次授权抽屉。
       */
      authorizedRoleRef.current = roleId;
      // 授权成功 → 关抽屉、自动重新同步
      setAuthDrawerOpen(false);
      setSyncError(null);
      handleSync();
    } catch (e) {
      logError("[Gacha] Authorize failed:", e);
      setAuthNotice({ tone: "danger", text: String(e) });
    } finally {
      setAuthBusy(false);
    }
  };

  /**
   * 当前游戏可用的分类。
   *
   * 《明日方舟》没有联合寻访与武器寻访 —— 若照搬五个分类，用户会看到两个
   * 永远为空的 Tab。这里按游戏裁剪，底部 switch 的指示器宽度也随之变化。
   */
  const categories = useMemo(
    () => (isArknights ? CATEGORIES.filter((c) => ARKNIGHTS_CATEGORY_KEYS.includes(c.key)) : CATEGORIES),
    [isArknights],
  );

  // 切到明日方舟时若当前停在联合/武器分类，回到「全部」
  useEffect(() => {
    if (isArknights && !ARKNIGHTS_CATEGORY_KEYS.includes(category)) {
      setCategory("all");
    }
  }, [isArknights, category]);

  // 武器为完全独立的分类：数据源与抽卡记录分离，其余分类共用角色寻访记录；all 含限定/联合/常驻（不含武器）
  const isWeapon = category === "weapon";
  const active = isWeapon ? weaponSaved : saved;

  /**
   * 该游戏是否存在「赠送十连」。
   *
   * 终末地会下发 `isFree`（限定池每期赠送十连），《明日方舟》的
   * `/api/gacha/history` 没有这个概念，筛选按钮对它无意义 —— 隐藏而不是
   * 留一个点了永远没结果的按钮。
   */
  const supportsFreePull = !isArknights && !isWeapon;

  // 切到明日方舟时清掉赠送十连筛选（否则会残留一个已生效但按钮已隐藏的过滤条件）
  useEffect(() => {
    if (!supportsFreePull) setOnlyFree(false);
  }, [supportsFreePull]);

  /** 当前分类下该记录是否属于角色寻访 */
  const isCharDraw = (r: GachaRecord, pools: Record<string, { poolType: string }>) =>
    category === "all" || poolKindOf(r, pools) === category;

  const stats = useMemo(() => {
    const pools = active?.pools ?? {};
    const filtered = (active?.records ?? []).filter(
      (r) => r.kind === "draw" && (isWeapon || isCharDraw(r, pools)),
    );
    const total = filtered.length;
    const six = filtered.filter((r) => r.rarity === 6).length;
    const five = filtered.filter((r) => r.rarity === 5).length;
    const four = filtered.filter((r) => r.rarity === 4).length;
    const sixIntervals = calculateGachaSixStarIntervals(filtered, pools);
    return {
      total,
      six,
      five,
      four,
      avgSix: sixIntervals.length > 0
        ? sixIntervals.reduce((sum, interval) => sum + interval.count, 0) / sixIntervals.length
        : null,
      avgFive: five + six > 0 ? total / (five + six) : null,
      ratioSix: total > 0 ? six / total : 0,
      ratioFive: total > 0 ? five / total : 0,
      ratioFour: total > 0 ? four / total : 0,
    };
  }, [active, category, isWeapon]);

  const lastSyncText = useMemo(() => {
    if (!active?.lastSyncTime) return null;
    return new Date(active.lastSyncTime).toLocaleString(isZh ? "zh-CN" : "en-US");
  }, [active, isZh]);

  // 当前分类下的卡池列表（按记录出现顺序，从新到旧）
  const poolOptions = useMemo(() => {
    const pools = active?.pools ?? {};
    const seen = new Set<string>();
    const out: { poolId: string; poolName: string }[] = [];
    for (const r of active?.records ?? []) {
      if (r.kind !== "draw" || (!isWeapon && !isCharDraw(r, pools))) continue;
      if (seen.has(r.poolId)) continue;
      seen.add(r.poolId);
      out.push({
        poolId: r.poolId,
        poolName: r.poolName || pools[r.poolId]?.poolName || r.poolId,
      });
    }
    return out;
  }, [active, category, isWeapon]);

  const hasActiveFilter =
    query.trim() !== "" || rarityFilter !== null || onlyNew || onlyFree;

  const records = useMemo(() => {
    const pools = active?.pools ?? {};
    const q = query.trim().toLowerCase();
    return (active?.records ?? []).filter((r) => {
      if (r.kind !== "draw") return false;
      if (!isWeapon && !isCharDraw(r, pools)) return false;
      if (tablePoolFilter !== null && r.poolId !== tablePoolFilter) return false;
      if (rarityFilter !== null && (r.rarity ?? 0) !== rarityFilter) return false;
      if (onlyNew && !r.isNew) return false;
      if (!isWeapon && onlyFree && !r.isFree) return false;
      if (q) {
        const hay = `${r.charName ?? ""} ${r.weaponName ?? ""} ${r.nameText} ${r.poolName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [active, category, tablePoolFilter, query, rarityFilter, onlyNew, onlyFree, isWeapon]);

  // 连续出现且属于同一卡池的赠送记录合并为同一次赠送十连
  const recordGroups = useMemo(() => {
    const out: (GachaRecord | GachaRecord[])[] = [];
    let free: GachaRecord[] = [];
    for (const rec of records) {
      if (rec.isFree) {
        if (free.length > 0 && free[free.length - 1].poolId !== rec.poolId) {
          out.push(free);
          free = [];
        }
        free.push(rec);
        continue;
      }
      if (free.length > 0) {
        out.push(free);
        free = [];
      }
      out.push(rec);
    }
    if (free.length > 0) out.push(free);
    return out;
  }, [records]);

  // 分页：每页精确切分记录数；赠送十连可被切到两页，两页都显示上下分割线
  type PageItem =
    | { kind: "single"; rec: GachaRecord }
    | { kind: "gift"; recs: GachaRecord[]; continuation: boolean };
  const PAGE_SIZE = 20;
  const totalRecords = useMemo(
    () => recordGroups.reduce((acc, g) => acc + (Array.isArray(g) ? g.length : 1), 0),
    [recordGroups],
  );
  const totalPages = Math.max(1, Math.ceil(totalRecords / PAGE_SIZE));

  const pageGroups = useMemo(() => {
    const out: PageItem[] = [];
    let count = 0;
    const start = (page - 1) * PAGE_SIZE;
    const end = page * PAGE_SIZE;
    for (const item of recordGroups) {
      const len = Array.isArray(item) ? item.length : 1;
      if (count + len <= start) {
        count += len;
        continue;
      }
      if (Array.isArray(item)) {
        const from = Math.max(start - count, 0);
        const to = Math.min(len, end - count);
        out.push({ kind: "gift", recs: item.slice(from, to), continuation: from > 0 });
      } else {
        out.push({ kind: "single", rec: item });
      }
      count += len;
      if (count >= end) break;
    }
    return out;
  }, [recordGroups, page]);

  // 筛选条件变化时回到第一页
  useEffect(() => {
    setPage(1);
  }, [category, tablePoolFilter, query, rarityFilter, onlyNew, onlyFree]);

  // 切换分类时重置“赠送十连”筛选（武器记录无赠送字段）
  useEffect(() => {
    setOnlyFree(false);
  }, [category]);

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto pb-12">
        <div className="flex items-center justify-center py-24">
          <GlassProgressCircle isIndeterminate size="lg" aria-label="Loading" className="text-primary">
            <GlassProgressCircle.Track>
              <GlassProgressCircle.TrackCircle />
              <GlassProgressCircle.FillCircle />
            </GlassProgressCircle.Track>
          </GlassProgressCircle>
        </div>
      </div>
    );
  }

  if (error && !saved) {
    return (
      <div className="max-w-6xl mx-auto pb-12">
        <h1 className="text-2xl lg:text-3xl font-bold text-foreground tracking-tight">
          {isZh ? "抽卡记录" : "Gacha Records"}
        </h1>
        <GlassCard className="mt-6 p-16 border border-separator/90">
          <div className="text-center text-muted">
            <p>{error}</p>
          </div>
        </GlassCard>
      </div>
    );
  }

  return (
    /* pb：给贴底导航胶囊留出空间（胶囊高 58px + 底部间隙 + 安全区）。
     * 分类栏改为与底部导航胶囊二选一显示（同一位置，见 ui/bottom-layer.ts），
     * 不再是独立的吸底浮层，
     * 所以这里不再需要原来那份额外让位。 */
    <div
      className="max-w-6xl mx-auto space-y-6"
      style={{ paddingBottom: "calc(6.5rem + var(--safe-area-bottom))" }}
    >
      {/* 页面标题 + 右上角操作（角色切换 / 同步） */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl lg:text-3xl font-bold text-foreground tracking-tight">
            {t("sidebar.gacha")}
          </h1>
          <div className="mt-1.5 space-y-0.5">
            <p className="text-foreground/70 text-sm">
              {selectedAccount ? (
                <>
                  {/* 徽标紧跟名字之后，与名字同排居中 */}
                  <AccountNameLine game={selectedAccount.game}>
                    {selectedAccount.nickname}
                  </AccountNameLine>
                  {" · "}
                  {resolveServerLabel(selectedAccount.server, i18n.language)} · Lv.
                  {selectedAccount.level}
                </>
              ) : (
                <span>{isZh ? "未选择角色" : "No role selected"}</span>
              )}
            </p>
            {lastSyncText && (
              <p className="text-muted text-xs">
                {isZh ? "上次同步" : "Last sync"}: {lastSyncText}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* 角色选择（仅本页生效） */}
          <div className="relative" ref={roleMenuRef}>
            <GlassButton
              variant="ghost"
              isDisabled={syncing || accounts.length === 0}
              onPress={() => setShowRoleMenu((v) => !v)}
              endContent={<ChevronDownIcon size={14} />}
              className="lg-material border border-separator/70 max-w-48"
            >
              {/* 内容整体可收缩：昵称过长时截断，徽标 `shrink-0` 保形，
                  不会把按钮顶出 `max-w-48` */}
              {selectedAccount ? (
                <AccountNameLine game={selectedAccount.game} className="max-w-full">
                  {selectedAccount.nickname}
                </AccountNameLine>
              ) : (
                <span className="truncate">
                  {isZh ? "选择角色" : "Select role"}
                </span>
              )}
            </GlassButton>

            {showRoleMenu && (
              <div className="lg-regular absolute left-0 top-full mt-2 z-50 w-64 max-w-[calc(100vw_-_1.5rem)] sm:left-auto sm:right-0 rounded-xl border border-separator/60 overflow-hidden animate-scale-in">
                <div className="max-h-72 overflow-y-auto">
                  {accounts.map((acc) => {
                    const isSelected = acc.id === roleId;
                    return (
                      <button
                        key={acc.id}
                        type="button"
                        onClick={() => handleSelectRole(acc.id)}
                        className={clsx(
                          "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors duration-200",
                          isSelected ? "bg-primary/15" : "lg-hoverable",
                        )}
                      >
                        <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 lg-inset flex items-center justify-center">
                          {acc.avatar ? (
                            <Img src={acc.avatar} alt={acc.nickname} className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-muted text-xs font-semibold">
                              {acc.nickname.charAt(0)}
                            </span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          {/* 徽标紧跟名字、垂直居中；行尾留给选中勾 */}
                          <p className="text-sm font-medium">
                            <AccountNameLine game={acc.game}>{acc.nickname}</AccountNameLine>
                          </p>
                          <p className="text-xs text-muted truncate">
                            {resolveServerLabel(acc.server, i18n.language)} · Lv.{acc.level}
                          </p>
                        </div>
                        {isSelected && <CheckIcon size={14} className="text-primary-text shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* 同步按钮：同步中显示旋转图标 + 文案，再次点击打开进度 */}
          <GlassButton
            variant="primary"
            onPress={handleSync}
            isDisabled={!roleId}
            startContent={
              <RefreshIcon size={16} className={clsx(syncing && "animate-spin")} />
            }
          >
            {syncing ? (isZh ? "正在同步" : "Syncing...") : isZh ? "同步全部记录" : "Sync All"}
          </GlassButton>
        </div>
      </header>

      {/*
       * 分类栏（窄屏）：**页面内 sticky**，排在工具行（角色选择 / 同步按钮）之下。
       *
       * 滚动行为（用户明确要求的那种）：
       * - 起始位置就在工具行下方，跟着页面上移；
       * - 上滑到距容器顶部 10px 时**吸住**，之后一直悬浮；
       * - 下滑时离开吸住位置，重新跟随页面移动。
       * 这是 `position: sticky` 的原生行为，不需要脚本监听 scroll。
       *
       * 材质与底部导航一致（`lg-control` + 滑块共用 `GlassPillIndicator`），
       * 但两者是**独立的条**：底部导航常驻视口底部，本分类栏只属于抽卡页。
       * 早先尝试过把两者合并成一条（页面分类占用时导航让位），代价是
       * 「某些页面上底部导航整条消失」，已回退。
       *
       * 桌面端（wide，即非窄屏模式）不显示这条：宽屏用下面那条吸底胶囊（原来的布局）。
       */}
      <div
        className="hidden narrow:block sticky z-30"
        style={{ top: 10 }}
      >
        {/* 实底壳：sticky 吸住时内容从下方滚过，半透明玻璃挡不住加粗标题 */}
        <div className="rounded-full bg-background py-1">
          <div className="relative flex h-[62px] items-stretch overflow-hidden rounded-full border border-separator/70 p-1.5 shadow-lg lg-control">
            <GlassPillIndicator
              index={Math.max(0, categories.findIndex((c) => c.key === category))}
              count={categories.length}
            />
            {categories.map((c) => (
              <GlassPillItem
                key={c.key}
                active={category === c.key}
                onClick={() => {
                  setCategory(c.key);
                  setTablePoolFilter(null);
                  setPage(1);
                }}
                className="text-xs font-semibold"
              >
                {isZh ? c.labelZh : c.labelEn}
              </GlassPillItem>
            ))}
          </div>
        </div>
      </div>

      {!active || active.records.length === 0 ? (
        <GlassCard className="p-8 sm:p-16 border border-separator/90">
          <div className="text-center space-y-3">
            <RefreshIcon size={40} className="mx-auto text-muted" />
            <p className="text-muted">
              {isZh ? "还没有同步过抽卡记录，点击右上角" : "No gacha records yet, click"}{" "}
              {isZh ? "同步全部记录" : "Sync All"}{" "}
              {isZh ? "开始同步" : "to start syncing all records"}
            </p>
            {/*
              明日方舟只有 90 天窗口：拉不到记录不代表没抽过卡。这里把服务端
              报告的分类列出来，让"0 条"有据可查，而不是看起来像同步坏了。
            */}
            {isArknights && akCategories.length > 0 && (
              <p className="text-xs text-muted">
                {isZh ? "服务端当前可查的分类：" : "Categories available from server: "}
                {akCategories.map((c) => formatCategoryName(c.name)).join(" / ")}
              </p>
            )}
          </div>
        </GlassCard>
      ) : (
        <>
          {/* 第一行统计卡片：数值 + RATE/AVG */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label={isZh ? "总抽卡数" : "Total Draws"}
              value={stats.total.toLocaleString()}
            />
            <StatCard
              label={isZh ? "六星数" : "6★ Count"}
              value={stats.six.toLocaleString()}
              accent="text-danger-text"
              rate={pctText(stats.ratioSix)}
              avg={stats.avgSix !== null ? stats.avgSix.toFixed(1) : null}
            />
            <StatCard
              label={isZh ? "五星数" : "5★ Count"}
              value={stats.five.toLocaleString()}
              accent="text-[#a16207] dark:text-[#ffd700]"
              rate={pctText(stats.ratioFive)}
              avg={stats.avgFive !== null ? stats.avgFive.toFixed(1) : null}
            />
            <StatCard
              label={isZh ? "四星数" : "4★ Count"}
              value={stats.four.toLocaleString()}
              accent="text-[#6d28d9] dark:text-[#a855f7]"
              rate={pctText(stats.ratioFour)}
            />
          </div>

          {/* 分析图表：星级分布 / 六星间隔分布 / 六星累计 */}
          <GachaStatCharts
            records={isWeapon ? (weaponSaved?.records ?? []) : (saved?.records ?? [])}
            pools={isWeapon ? (weaponSaved?.pools ?? {}) : (saved?.pools ?? {})}
            category={category}
            isWeapon={isWeapon}
            isZh={isZh}
          />

          {/* 寻访保底统计（顺时针旋转 90° 柱状图；武器寻访与角色一致） */}
          <GachaPityChart
            roleId={roleId}
            records={isWeapon ? (weaponSaved?.records ?? []) : (saved?.records ?? [])}
            pools={isWeapon ? (weaponSaved?.pools ?? {}) : (saved?.pools ?? {})}
            category={category}
            isZh={isZh}
          />

          {/* 抽卡记录详情 */}
          <GlassCard className="p-4 sm:p-6 border border-separator/90">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-muted">
                {isZh ? "寻访记录" : "Headhunting Records"}
              </h2>
              <span className="text-xs text-muted tabular-nums">
                {isZh ? `共 ${records.length} 条` : `${records.length} total`}
              </span>
            </div>
            {/* 筛选栏 */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <GlassSelect
                value={tablePoolFilter}
                options={[
                  { value: "", label: isZh ? "全部卡池" : "All Pools" },
                  ...poolOptions.map((p) => ({ value: p.poolId, label: p.poolName })),
                ]}
                onChange={(v) => {
                  setTablePoolFilter(v || null);
                  setPage(1);
                }}
                className="max-w-56"
              />
              <div className="relative flex-1 min-w-44">
                <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none text-sm" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={isZh ? "搜索名称 / 卡池" : "Search name / pool"}
                  className="lg-field w-full h-9 pl-8 pr-3 rounded-lg text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              {/* 滑动指示器承担选中态：flex-1 等宽，指示器按格位移，切换是「滑过去」。
                  整条 `shrink-0` + 标签 `whitespace-nowrap`：这一行里只有它能被压到
                  比文字还窄，一旦被压，「全部」会折成两行溢出胶囊（看着像排版坏掉）。 */}
              <div className="relative flex shrink-0 items-center p-1 rounded-full lg-control">
                {/*
                 * 滑动指示器：与底部胶囊共用同一组件（`wrapInset=4` 对应本容器的
                 * `p-1`），留白规则一致，两处不会各自漂移。
                 */}
                <GlassPillIndicator
                  index={Math.max(
                    0,
                    RARITY_OPTIONS.findIndex((o) => o.value === rarityFilter),
                  )}
                  count={RARITY_OPTIONS.length}
                  wrapInset={4}
                  gap={2}
                />
                {RARITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => setRarityFilter(opt.value)}
                    className={clsx(
                      "relative z-10 flex-1 h-8 min-w-10 rounded-full text-xs font-medium whitespace-nowrap transition-all duration-200",
                      "active:scale-[0.98]",
                      rarityFilter === opt.value
                        ? "text-primary-text"
                        : "text-muted hover:text-foreground lg-hoverable",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setOnlyNew(!onlyNew)}
                className={clsx(
                  "h-8 px-3 rounded-full text-xs font-medium border transition-all duration-150",
                  "hover:scale-105 active:scale-95",
                  onlyNew
                    ? "border-success/60 bg-success/15 text-success-text"
                    : "border-separator text-muted hover:text-foreground hover:border-success/40",
                )}
              >
                NEW
              </button>
              {supportsFreePull && (
                <button
                  type="button"
                  onClick={() => setOnlyFree(!onlyFree)}
                  className={clsx(
                    "h-8 px-3 rounded-full text-xs font-medium border transition-all duration-150",
                    "hover:scale-105 active:scale-95",
                    onlyFree
                      ? "border-primary/60 bg-primary/15 text-primary-text"
                      : "border-separator text-muted hover:text-foreground hover:border-primary/40",
                  )}
                >
                  {isZh ? "赠送十连" : "Gift 10-Pull"}
                </button>
              )}
            </div>
            {records.length === 0 ? (
              <p className="text-sm text-muted py-8 text-center">
                {hasActiveFilter
                  ? isZh
                    ? "没有匹配的记录"
                    : "No matching records"
                  : isZh
                    ? "该分类暂无记录"
                    : "No records in this category"}
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-muted border-b border-separator">
                        <th className="text-left font-medium py-2 pr-3">
                          {isZh ? "稀有度" : "Rarity"}
                        </th>
                        <th className="text-left font-medium py-2 pr-3">
                          {isZh ? "名称" : "Name"}
                        </th>
                        <th className="text-left font-medium py-2 pr-3 hidden md:table-cell">
                          {isZh ? "卡池" : "Pool"}
                        </th>
                        <th className="text-left font-medium py-2 pr-3 hidden sm:table-cell">
                          {isZh ? "时间" : "Time"}
                        </th>
                        <th className="text-right font-medium py-2">
                          {isZh ? "标记" : "Tags"}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageGroups.map((item, i) => {
                        const nextIsGroup =
                          i + 1 < pageGroups.length && pageGroups[i + 1].kind === "gift";
                        if (item.kind === "gift") {
                          return (
                            <Fragment key={`g-${item.recs[0].seqId}`}>
                              <tr>
                                <td colSpan={5} className="py-2">
                                  <div className="flex items-center gap-2">
                                    {!item.continuation && (
                                      <span className="shrink-0 text-[11px] font-semibold text-primary-text">
                                        {isZh ? "赠送十连" : "Gift 10-Pull"} - {item.recs[0].poolName}
                                      </span>
                                    )}
                                    <div className="h-px flex-1 bg-primary/40" />
                                  </div>
                                </td>
                              </tr>
                              {item.recs.map((rec, j) => (
                                <RecordRow
                                  key={rec.seqId}
                                  rec={rec}
                                  isZh={isZh}
                                  noBorder={j === item.recs.length - 1}
                                />
                              ))}
                              <tr>
                                <td colSpan={5} className="pt-2">
                                  <div className="h-px bg-primary/40" />
                                </td>
                              </tr>
                            </Fragment>
                          );
                        }
                        return (
                          <RecordRow
                            key={item.rec.seqId}
                            rec={item.rec}
                            isZh={isZh}
                            noBorder={nextIsGroup}
                          />
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {totalPages > 1 && (
                  <div className="mt-4 flex justify-center">
                    <SimplePagination total={totalPages} page={page} onChange={setPage} />
                  </div>
                )}
              </>
            )}
          </GlassCard>
        </>
      )}

      {/*
       * 窄屏分类栏：**本页不渲染胶囊**，而是把分类项注册给布局层。
       *
       * 布局层的 `MobileBottomNav`（在 `<main>` 内容流里、页面内容之前）从
       * `bottom-layer` 读到本页注册的分类项后就显示分类、否则显示导航项，
       * 两者共用那条 **sticky** 条 —— 起始位置在页面内容上方，向上滚动时
       * 先随页面一起上移、到距顶 10px 处吸住。
       *
       * 之所以这样拆：胶囊在布局层、分类在路由子树，两者是兄弟；把节点
       * portal 过去会依赖挂载点与 effect 时序（实测反复出错），只传数据则
       * 只有一层 DOM、一套命中区，行为确定。
       */}

      {/* 桌面端仍在页面内吸底 —— 那里是宽屏布局，没有窄屏导航条。 */}
      <div className="hidden wide:flex sticky z-40 bottom-4 mx-auto rounded-full p-1.5 lg-control border border-separator/70 shadow-lg w-full max-w-2xl">
        {/*
         * 滑动指示器：与窄屏底部胶囊**共用同一组件**，几何完全一致
         * （内容区内缩 + 上下留白 + 惯性滑动的 glide 缓动）。
         * 此前这里是手写的一套（`top-1.5 bottom-1.5` + `calc((100% - 0.75rem)/n)`），
         * 与窄屏那套的留白规则会各自漂移，改成共用后两处不会再分叉。
         */}
        <GlassPillIndicator
          index={Math.max(0, categories.findIndex((c) => c.key === category))}
          count={categories.length}
        />
        {categories.map((c) => {
          const isActive = category === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => {
                setCategory(c.key);
                setTablePoolFilter(null);
                setPage(1);
              }}
              className={clsx(
                "relative z-10 h-10 rounded-full text-xs sm:text-sm lg:text-base font-semibold transition-all duration-200",
                "flex items-center justify-center whitespace-nowrap active:scale-[0.98]",
                // **各项等分宽度**（`flex-1` + `min-w-0`）：滑动指示器的宽度是
                // 「胶囊内容宽 / 项数」，只有各项等宽时指示器才对得齐
                // （移动端也要能滑，所以这里不分断点）。
                // 文字用 `whitespace-nowrap` 保证不折行。
                "flex-1 min-w-0 px-1 lg:px-0",
                // 选中态由**指示器**承担（与桌面端同一套），按钮本身只改文字色。
                isActive
                  ? "text-primary-text"
                  : "text-foreground/70 hover:text-foreground lg-hoverable",
              )}
            >
              {isZh ? c.labelZh : c.labelEn}
            </button>
          );
        })}
      </div>

      {/* 同步进度 Modal（关闭后后台继续同步） */}
      <CustomModal
        isOpen={progressModalOpen}
        onClose={() => setProgressModalOpen(false)}
        size="sm"
      >
        <CustomModalHeader onClose={() => setProgressModalOpen(false)}>
          {isZh ? "同步进度" : "Sync Progress"}
        </CustomModalHeader>
        <CustomModalBody>
          {syncError ? (
            <div className="py-6 text-center">
              <p className="text-danger-text text-sm break-all">{syncError}</p>
              <p className="text-muted text-xs mt-2">
                {isZh
                  ? "同步失败，本地数据未写入，可稍后重试"
                  : "Sync failed, local data was not written. Try again later."}
              </p>
            </div>
          ) : syncing ? (
            <div className="py-6 text-center space-y-4">
              <GlassProgressCircle isIndeterminate size="lg" aria-label="Syncing" className="text-primary">
                <GlassProgressCircle.Track>
                  <GlassProgressCircle.TrackCircle />
                  <GlassProgressCircle.FillCircle />
                </GlassProgressCircle.Track>
              </GlassProgressCircle>
              <div className="text-sm space-y-1">
                <p className="text-foreground">
                  {isZh ? "正在同步抽卡记录..." : "Syncing gacha records..."}
                </p>
                {progress && (
                  <p className="text-muted text-xs">
                    {tabLabel(progress.tabKey, isZh)} · {isZh ? "第" : "Tab"}{" "}
                    {progress.tabIndex + 1}
                    {isZh ? "/" : "/"}
                    {progress.tabCount} · {isZh ? "第" : "Page"} {progress.page}{" "}
                    {isZh ? "页" : ""}
                  </p>
                )}
                {progress && (
                  <p className="text-muted text-xs">
                    {isZh
                      ? `本卡池已获取 ${progress.tabFetched} 条，累计 ${progress.totalFetched} 条`
                      : `Fetched ${progress.tabFetched} in this tab, ${progress.totalFetched} total`}
                  </p>
                )}
              </div>
            </div>
          ) : syncResult ? (
            <div className="py-6 text-center space-y-2">
              <p className="text-success-text text-sm">
                {isZh ? "同步完成" : "Sync completed"}
              </p>
              <p className="text-muted text-sm">
                {isZh
                  ? `新增 ${syncResult.newRecords} 条，共 ${syncResult.totalRecords} 条`
                  : `+${syncResult.newRecords} new, ${syncResult.totalRecords} total`}
              </p>
            </div>
          ) : (
            /*
             * 收尾态：`syncing` 已经回落、但 `syncResult` 还没到手。
             *
             * 后端在收尾时先发一个 `done=true` 的进度事件（监听器据此把
             * `syncing` 置 false），而 `syncResult` 要等 `invoke` 的 Promise
             * 才落地 —— 这中间会有一小段「既不在同步、也没有结果」的窗口。
             * 原先这里渲染 `null`，表现就是**抽屉突然空白一下**，看着像卡死。
             * 用一个不转的进度环 + 「正在整理数据」把这段缝补上。
             */
            <div className="flex flex-col items-center justify-center gap-3 py-6 text-center">
              <GlassProgressCircle
                isIndeterminate
                size="lg"
                aria-label="Finalizing"
                className="text-primary"
              >
                <GlassProgressCircle.Track>
                  <GlassProgressCircle.TrackCircle />
                  <GlassProgressCircle.FillCircle />
                </GlassProgressCircle.Track>
              </GlassProgressCircle>
              <p className="text-sm text-foreground">
                {isZh ? "正在整理同步结果..." : "Finalizing..."}
              </p>
            </div>
          )}
        </CustomModalBody>
        <CustomModalFooter>
          <GlassButton variant="secondary" onPress={() => setProgressModalOpen(false)}>
            {isZh ? "关闭" : "Close"}
          </GlassButton>
        </CustomModalFooter>
      </CustomModal>

      {/*
       * 授权抽屉：同步因「未授权」失败时弹出。
       *
       * 为什么不是普通弹窗：用户此刻要做的是一件有明确因果的动作 ——
       * 「授权 → 同步」。抽屉里直接给授权按钮，成功后自动重试同步，
       * 不用再让用户回到抽卡页点一次。
       */}
      <CustomModal
        isOpen={authDrawerOpen}
        onClose={() => setAuthDrawerOpen(false)}
        size="sm"
      >
        <CustomModalHeader onClose={() => setAuthDrawerOpen(false)}>
          {t("settings.account.u8_auth_title")}
        </CustomModalHeader>
        <CustomModalBody className="space-y-3">
          <p className="text-sm text-muted">
            {authReason === "arknights"
              ? isZh
                ? "该角色的抽卡令牌已失效或被服务端拒绝。点下方按钮重新授权后再同步。"
                : "This role's gacha token was rejected or has expired. Re-authorize it below, then sync again."
              : t("settings.account.u8_auth_desc")}
          </p>

          {selectedAccount && (
            <div className="flex items-center gap-3 rounded-lg border border-separator/60 p-3">
              <AccountAvatar
                src={selectedAccount.avatar}
                alt={selectedAccount.nickname}
                size="sm"
                className="!rounded-full"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-foreground">
                    {selectedAccount.nickname}
                  </span>
                  <GameBadge
                    game={selectedAccount.game}
                    variant="icon"
                    size="sm"
                  />
                </div>
                <span className="block text-[11px] text-muted">
                  Lv.{selectedAccount.level}
                </span>
              </div>
            </div>
          )}

          {authNotice && (
            <p
              className={clsx(
                "text-xs",
                authNotice.tone === "ok"
                  ? "text-success-text"
                  : "text-danger-text",
              )}
              role="status"
            >
              {authNotice.text}
            </p>
          )}
        </CustomModalBody>
        <CustomModalFooter>
          <div className="flex w-full gap-2">
            <GlassButton
              variant="secondary"
              isDisabled={authBusy}
              onPress={() => setAuthDrawerOpen(false)}
              className="flex-1"
            >
              {t("settings.account.u8_skip")}
            </GlassButton>
            <GlassButton
              variant="primary"
              isDisabled={authBusy || !selectedAccount}
              onPress={() => void authorizeAndRetrySync()}
              className="flex-1"
            >
              {authBusy
                ? t("settings.account.loading")
                : t("settings.account.u8_authorize")}
            </GlassButton>
          </div>
        </CustomModalFooter>
      </CustomModal>
    </div>
  );
}

function pctText(ratio: number): string {
  return `${Math.round(ratio * 1000) / 10}%`;
}

/**
 * 稀有度取色：同一档稀有度在浅色/深色主题下用不同色值。
 *
 * 原因：金色 #ffd700 落在浅色卡片上只有 1.4:1、六星红 #ef4444 只有 3.76:1，
 * 都低于 WCAG AA 的 4.5:1——抽卡记录页最关键的「几星」直接读不清。
 * 深色主题底是深色，需要的是亮色系，两套不能共用。
 * 浅色档取同色相的深版（仍能一眼分辨稀有度），对比度见注释。
 */
const RARITY_COLORS: Record<
  number,
  { text: string; darkText: string; border: string; badge: string }
> = {
  6: {
    text: "text-danger-text", // #ef4444 on light surface → 3.76:1，靠加粗与字号补足
    darkText: "dark:text-danger-text",
    border: "border-danger/60",
    badge: "bg-danger",
  },
  5: {
    text: "text-[#a16207]", // 4.92:1，金色相压深，浅底可读
    darkText: "dark:text-[#ffd700]", // 14.02:1，深底用亮金
    border: "border-[#a16207]/60 dark:border-[#ffd700]/60",
    badge: "bg-[#a16207] dark:bg-[#ffd700]",
  },
  4: {
    text: "text-[#6d28d9]", // 7.10:1，紫色压深
    darkText: "dark:text-[#a855f7]", // 4.97:1，深底用亮紫
    border: "border-[#6d28d9]/60 dark:border-[#a855f7]/60",
    badge: "bg-[#6d28d9] dark:bg-[#a855f7]",
  },
};

function formatTime(ts: string, isZh: boolean): string {
  return new Date(Number(ts)).toLocaleString(isZh ? "zh-CN" : "en-US");
}

function rarityColor(rarity: number | null | undefined) {
  return (
    RARITY_COLORS[rarity ?? 0] ?? {
      text: "text-foreground",
      darkText: "",
      border: "border-separator",
      badge: "bg-default-400",
    }
  );
}

function RecordRow({ rec, isZh, noBorder = false }: { rec: GachaRecord; isZh: boolean; noBorder?: boolean }) {
  const color = rarityColor(rec.rarity);
  return (
    <tr
      className={clsx(
        noBorder ? "last:border-b-0" : "border-b border-separator/60 last:border-b-0",
        "lg-hoverable-soft transition-colors",
      )}
    >
      <td className="py-2.5 pr-3 w-14">
        <span
          className={clsx(
            "inline-block w-9 text-center text-[10px] font-bold text-white rounded-full py-0.5",
            color.badge,
          )}
        >
          {rec.rarity ?? 0}★
        </span>
      </td>
      <td className={clsx("py-2.5 pr-3 font-medium truncate max-w-40", color.text, color.darkText)}>
        {rec.weaponName ?? rec.charName ?? rec.nameText}
      </td>
      <td className="py-2.5 pr-3 text-xs text-muted truncate max-w-48 hidden md:table-cell">
        {rec.poolName}
      </td>
      <td className="py-2.5 pr-3 text-xs text-muted tabular-nums hidden sm:table-cell">
        {formatTime(rec.gachaTs, isZh)}
      </td>
      <td className="py-2.5 text-right">
        <div className="flex gap-1 justify-end">
          {rec.isNew && (
            <span className="text-[10px] px-1 py-0.5 rounded bg-success/15 text-success-text font-medium">
              NEW
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

function StatCard({
  label,
  value,
  accent,
  rate,
  avg,
}: {
  label: string;
  value: string;
  accent?: string;
  rate?: string | null;
  avg?: string | null;
}) {
  return (
    <GlassCard className="p-5 border border-separator/90 hover:scale-[1.02] hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200">
      <p className="text-xs font-medium text-muted">{label}</p>
      <div className="mt-2 flex items-end justify-between gap-2">
        <p className={clsx("text-2xl lg:text-3xl font-bold tabular-nums", accent ?? "text-foreground")}>
          {value}
        </p>
        {(rate ?? avg) && (
          <div className="shrink-0 text-right text-[11px] leading-relaxed text-muted tabular-nums">
            {rate != null && <p>RATE {rate}</p>}
            {avg != null && <p>AVG {avg}</p>}
          </div>
        )}
      </div>
    </GlassCard>
  );
}
