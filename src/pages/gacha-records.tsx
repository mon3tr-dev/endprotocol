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
import { SearchIcon } from "@/components/icons";
import { Img } from "@/utils/imageLoader";
import { getSelectedAccount, getAccounts, type Account } from "@/utils/accountService";
import { resolveServerLabel } from "@/types";
import { logError } from "@/utils/logger";
import { addMessage } from "@/utils/messageStore";
import { calculateGachaSixStarIntervals } from "@/utils/gachaIntervals";
import type {
  GachaCategory,
  GachaPoolKind,
  GachaRecord,
  GachaSyncProgress,
  GachaSyncResult,
  SavedGachaData,
  SavedWeaponGachaData,
} from "@/types/gacha";

const CATEGORIES: { key: GachaCategory; labelZh: string; labelEn: string }[] = [
  { key: "all", labelZh: "全部角色", labelEn: "All" },
  { key: "special", labelZh: "限定", labelEn: "Limited" },
  { key: "joint", labelZh: "联合", labelEn: "Joint" },
  { key: "normal", labelZh: "常驻", labelEn: "Standard" },
  { key: "weapon", labelZh: "武器", labelEn: "Weapon" },
];

const RARITY_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "全部" },
  { value: 6, label: "6★" },
  { value: 5, label: "5★" },
  { value: 4, label: "4★" },
];

/** 记录所属卡池类型：优先用 pools 元信息，缺失时按 poolId 前缀推断 */
function poolKindOf(rec: GachaRecord, pools: Record<string, { poolType: string }>): GachaPoolKind {
  const poolType = pools[rec.poolId]?.poolType;
  if (poolType) {
    if (poolType.includes("Joint")) return "joint";
    if (poolType.includes("Standard")) return "normal";
    return "special";
  }
  if (rec.poolId.startsWith("joint_")) return "joint";
  if (rec.poolId.startsWith("standard")) return "normal";
  return "special";
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
  const isZh = i18n.language === "zh";

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedGachaData | null>(null);
  const [weaponSaved, setWeaponSaved] = useState<SavedWeaponGachaData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      if (rid) {
        await Promise.all([loadSaved(rid), loadWeaponSaved(rid)]);
      } else {
        setError(isZh ? "暂无可用角色，请先在账户页添加" : "No role available, please add one in Accounts");
      }
    } catch (e) {
      logError("[Gacha] Failed to init:", e);
      setError(String(e));
    } finally {
      setIsLoading(false);
    }
  }, [loadSaved, loadWeaponSaved, isZh]);

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

    // 右上角同步按钮同步全部数据：全部角色寻访（限定/联合/常驻）+ 武器寻访，
    // 并发调用两个命令，合并结果后统一提示。
    const requestSeq = ++syncRequestRef.current;
    const charPromise = invoke<GachaSyncResult>("sync_gacha_records", { roleId });
    const weaponPromise = invoke<GachaSyncResult>("sync_weapon_gacha_records", {
      roleId,
    });

    Promise.all([charPromise, weaponPromise])
      .then(([charRes, weaponRes]) => {
        // 丢弃过期请求（期间已切换角色/再次点击）
        if (requestSeq !== syncRequestRef.current) return;
        const newRecords = charRes.newRecords + weaponRes.newRecords;
        const totalRecords = charRes.totalRecords + weaponRes.totalRecords;
        const perTabNew: Record<string, number> = {
          ...charRes.perTabNew,
          ...weaponRes.perTabNew,
        };
        setSyncResult({
          ...charRes,
          userId: charRes.userId,
          serverId: charRes.serverId,
          syncedAt: Math.max(charRes.syncedAt, weaponRes.syncedAt),
          newRecords,
          totalRecords,
          perTabNew,
        });
        setSyncing(false);
        addMessage({
          type: "info",
          title: i18n.language === "zh" ? "抽卡记录同步完成" : "Gacha Sync Complete",
          body: i18n.language === "zh"
            ? `新增 ${newRecords} 条，共 ${totalRecords} 条（角色 ${charRes.newRecords} 条 / 武器 ${weaponRes.newRecords} 条）`
            : `+${newRecords} new, ${totalRecords} total (char ${charRes.newRecords} / weapon ${weaponRes.newRecords})`,
          tag: "gacha",
        });
      })
      .catch((e) => {
        // 丢弃过期请求的错误
        if (requestSeq !== syncRequestRef.current) return;
        logError("[Gacha] Sync failed:", e);
        addMessage({ type: "urgent", title: i18n.language === "zh" ? "抽卡记录同步失败" : "Gacha Sync Failed", body: String(e), tag: "gacha" });
        setSyncError(String(e));
        setSyncing(false);
        // 出错时重新打开进度窗口展示错误
        setProgressModalOpen(true);
      })
      .finally(() => {
        // 只在本请求仍为最新时刷新本地数据
        if (requestSeq === syncRequestRef.current) {
          loadSaved(roleId);
          loadWeaponSaved(roleId);
        }
      });
  };

  const handleSelectRole = (rid: string) => {
    setRoleId(rid);
    setShowRoleMenu(false);
    loadSaved(rid);
    loadWeaponSaved(rid);
  };

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === roleId) ?? null,
    [accounts, roleId],
  );

  // 武器为完全独立的分类：数据源与抽卡记录分离，其余分类共用角色寻访记录；all 含限定/联合/常驻（不含武器）
  const isWeapon = category === "weapon";
  const active = isWeapon ? weaponSaved : saved;

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
        <GlassCard className="mt-6 p-16 glass-surface border border-separator/90">
          <div className="text-center text-muted">
            <p>{error}</p>
          </div>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-28">
      {/* 页面标题 + 右上角操作（角色切换 / 同步） */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl lg:text-3xl font-bold text-foreground tracking-tight">
            {t("sidebar.gacha")}
          </h1>
          <p className="text-foreground/70 mt-1.5 text-sm">
            {selectedAccount ? (
              <>
                {selectedAccount.nickname} ·{" "}
                {resolveServerLabel(selectedAccount.server, i18n.language)} · Lv.
                {selectedAccount.level}
              </>
            ) : (
              isZh ? "未选择角色" : "No role selected"
            )}
            {lastSyncText && (
              <>
                {" · "}
                {isZh ? "上次同步" : "Last sync"}: {lastSyncText}
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* 角色选择（仅本页生效） */}
          <div className="relative" ref={roleMenuRef}>
            <GlassButton
              variant="ghost"
              isDisabled={syncing || accounts.length === 0}
              onPress={() => setShowRoleMenu((v) => !v)}
              endContent={<ChevronDownIcon size={14} />}
              className="glass-surface border border-separator/70 max-w-48"
            >
              <span className="truncate">
                {selectedAccount?.nickname ?? (isZh ? "选择角色" : "Select role")}
              </span>
            </GlassButton>

            {showRoleMenu && (
              <div className="absolute right-0 top-full mt-2 z-50 w-64 glass-surface-strong rounded-xl border border-separator/70 shadow-xl overflow-hidden">
                <div className="max-h-72 overflow-y-auto">
                  {accounts.map((acc) => {
                    const isSelected = acc.id === roleId;
                    return (
                      <button
                        key={acc.id}
                        type="button"
                        onClick={() => handleSelectRole(acc.id)}
                        className={clsx(
                          "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-all duration-150",
                          "hover:translate-x-1 active:translate-x-0.5",
                          isSelected ? "bg-primary/15" : "hover:bg-default-100",
                        )}
                      >
                        <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-default-100 flex items-center justify-center">
                          {acc.avatar ? (
                            <Img src={acc.avatar} alt={acc.nickname} className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-muted text-xs font-semibold">
                              {acc.nickname.charAt(0)}
                            </span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{acc.nickname}</p>
                          <p className="text-xs text-muted truncate">
                            {resolveServerLabel(acc.server, i18n.language)} · Lv.{acc.level}
                          </p>
                        </div>
                        {isSelected && <CheckIcon size={14} className="text-primary shrink-0" />}
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

      {!active || active.records.length === 0 ? (
        <GlassCard className="p-16 glass-surface border border-separator/90">
          <div className="text-center space-y-3">
            <RefreshIcon size={40} className="mx-auto text-muted" />
            <p className="text-muted">
              {isZh ? "还没有同步过抽卡记录，点击右上角" : "No gacha records yet, click"}{" "}
              {isZh ? "同步全部记录" : "Sync All"}{" "}
              {isZh ? "开始同步" : "to start syncing all records"}
            </p>
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
              accent="text-danger"
              rate={pctText(stats.ratioSix)}
              avg={stats.avgSix !== null ? stats.avgSix.toFixed(1) : null}
            />
            <StatCard
              label={isZh ? "五星数" : "5★ Count"}
              value={stats.five.toLocaleString()}
              accent="text-[#ffd700]"
              rate={pctText(stats.ratioFive)}
              avg={stats.avgFive !== null ? stats.avgFive.toFixed(1) : null}
            />
            <StatCard
              label={isZh ? "四星数" : "4★ Count"}
              value={stats.four.toLocaleString()}
              accent="text-[#a855f7]"
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
          <GlassCard className="p-6 glass-surface border border-separator/90">
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
                  className="glass-field w-full h-9 pl-8 pr-3 rounded-lg text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <div className="flex items-center gap-1 p-1 rounded-full glass-surface">
                {RARITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => setRarityFilter(opt.value)}
                    className={clsx(
                      "h-8 px-3 rounded-full text-xs font-medium transition-all duration-150",
                      "hover:scale-105 active:scale-95",
                      rarityFilter === opt.value
                        ? "glass-surface-strong border border-primary/50 text-primary"
                        : "border border-transparent text-muted hover:text-foreground",
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
                    ? "border-success/60 bg-success/15 text-success"
                    : "border-separator text-muted hover:text-foreground hover:border-success/40",
                )}
              >
                NEW
              </button>
              {!isWeapon && (
                <button
                  type="button"
                  onClick={() => setOnlyFree(!onlyFree)}
                  className={clsx(
                    "h-8 px-3 rounded-full text-xs font-medium border transition-all duration-150",
                    "hover:scale-105 active:scale-95",
                    onlyFree
                      ? "border-primary/60 bg-primary/15 text-primary"
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
                                      <span className="shrink-0 text-[11px] font-semibold text-primary">
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

      {/* 分类选择（悬浮于内容区底部的多项 switch） */}
      <div className="sticky bottom-4 z-40 mx-auto w-full max-w-2xl rounded-full p-1.5 flex gap-1.5 bg-surface/40 backdrop-blur-md border border-separator/70 shadow-lg">
        {CATEGORIES.map((c) => {
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
                "flex-1 h-10 rounded-full text-sm lg:text-base font-semibold transition-all duration-200",
                "flex items-center justify-center",
                "hover:scale-105 active:scale-95",
                isActive
                  ? "glass-surface-strong border border-primary/50 text-primary"
                  : "border border-transparent text-foreground/70 hover:text-foreground hover:bg-default-100",
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
              <p className="text-danger text-sm break-all">{syncError}</p>
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
              <p className="text-success text-sm">
                {isZh ? "同步完成" : "Sync completed"}
              </p>
              <p className="text-muted text-sm">
                {isZh
                  ? `新增 ${syncResult.newRecords} 条，共 ${syncResult.totalRecords} 条`
                  : `+${syncResult.newRecords} new, ${syncResult.totalRecords} total`}
              </p>
            </div>
          ) : null}
        </CustomModalBody>
        <CustomModalFooter>
          <GlassButton variant="secondary" onPress={() => setProgressModalOpen(false)}>
            {isZh ? "关闭" : "Close"}
          </GlassButton>
        </CustomModalFooter>
      </CustomModal>
    </div>
  );
}

function pctText(ratio: number): string {
  return `${Math.round(ratio * 1000) / 10}%`;
}

const RARITY_COLORS: Record<
  number,
  { text: string; border: string; badge: string }
> = {
  6: { text: "text-danger", border: "border-danger/60", badge: "bg-danger" },
  5: { text: "text-[#ffd700]", border: "border-[#ffd700]/60", badge: "bg-[#ffd700]" },
  4: { text: "text-[#a855f7]", border: "border-[#a855f7]/60", badge: "bg-[#a855f7]" },
};

function formatTime(ts: string, isZh: boolean): string {
  return new Date(Number(ts)).toLocaleString(isZh ? "zh-CN" : "en-US");
}

function rarityColor(rarity: number | null | undefined) {
  return (
    RARITY_COLORS[rarity ?? 0] ?? {
      text: "text-foreground",
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
        "hover:bg-default-50 transition-colors",
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
      <td className={clsx("py-2.5 pr-3 font-medium truncate max-w-40", color.text)}>
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
            <span className="text-[10px] px-1 py-0.5 rounded bg-success/15 text-success font-medium">
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
    <GlassCard className="p-5 glass-surface border border-separator/90 hover:scale-[1.02] hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200">
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
