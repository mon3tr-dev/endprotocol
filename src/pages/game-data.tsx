import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import {
  GlassButton,
  GlassCard,
  GlassProgressCircle,
  GlassTooltip,
} from "@/components/ui/glass";
import { Img } from "@/utils/imageLoader";
import { RefreshIcon, ChevronDownIcon, CheckIcon } from "@/components/ui/app-icon";
import { CardIcon } from "@/components/icons";
import {
  getAccounts,
  getSelectedAccount,
  refreshAccountData,
  type Account,
} from "@/utils/accountService";
import { fetchArknightsPlayerInfo } from "@/utils/arknightsDataService";
import { getConfig, setConfig } from "@/utils/configService";
import { resolveServerLabel } from "@/types";
import { AccountNameLine } from "@/components/ui/game-badge";
import { filterAccountsForPage } from "@/config/gameSupport";
import { logError } from "@/utils/logger";
import { formatShortDateTime } from "@/components/cards/recruitment/recruit-shared";
import { RemoteThumb } from "@/components/ui/remote-thumb";
import type {
  ArknightsActivityProgress,
  ArknightsPlayerInfo,
} from "@/types/arknights";

/** 页面内独立记住的游戏账户（未设置时跟随全局选中账户） */
const ROLE_CONFIG_KEY = "gamedata_page_role_id";

/** 活动类别 → i18n 键与展示顺序（SIDESTORY 别传 / MINISTORY 插曲 / BRANCHLINE 支线 / 其他活动） */
const CHAPTER_GROUP_ORDER = ["sidestory", "ministory", "branchline", "other"] as const;
type ChapterGroup = (typeof CHAPTER_GROUP_ORDER)[number];

function chapterGroupOf(type: string | undefined): ChapterGroup {
  switch ((type ?? "").toUpperCase()) {
    case "SIDESTORY":
      return "sidestory";
    case "MINISTORY":
      return "ministory";
    case "BRANCHLINE":
      return "branchline";
    default:
      return "other";
  }
}

const CHAPTER_GROUP_TITLE_KEY: Record<ChapterGroup, string> = {
  sidestory: "gamedata_page.chapter_type_sidestory",
  ministory: "gamedata_page.chapter_type_ministory",
  branchline: "gamedata_page.chapter_type_branchline",
  other: "gamedata_page.chapter_type_other",
};

/** 一个章节（活动）聚合后的展示行 */
interface ChapterRow {
  actId: string;
  name: string;
  group: ChapterGroup;
  /** 复刻（actReplicaId 非空） */
  isReplica: boolean;
  /** 章节封面（activityInfoMap.picUrl；实测约 57% 有值，空则回退字母占位） */
  cover: string;
  cleared: number;
  total: number;
  startTime: number;
}

export default function GameDataPage() {
  const { t, i18n } = useTranslation();
  const [roleId, setRoleId] = useState<string | null>(null);
  const [info, setInfo] = useState<ArknightsPlayerInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showRoleMenu, setShowRoleMenu] = useState(false);
  const roleMenuRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async (targetRoleId?: string | null) => {
    try {
      setIsLoading(true);
      const id =
        targetRoleId !== undefined
          ? targetRoleId
          : await getConfig<string>(ROLE_CONFIG_KEY).then(
              (saved) => saved || getSelectedAccount(),
            );
      setRoleId(id);
      if (!id) {
        setInfo(null);
        return;
      }
      const result = await fetchArknightsPlayerInfo({ roleId: id });
      setInfo(result);
    } catch (error) {
      logError("Failed to load game data:", error);
      setInfo(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    void (async () => {
      try {
        setAccounts(await getAccounts());
      } catch (error) {
        logError("Failed to load accounts:", error);
      }
    })();
  }, [loadData]);

  // 账户切换 / 全局手动刷新时重新加载
  useEffect(() => {
    const handleAccountChanged = () => void loadData(null);
    const handleManualRefresh = () => void loadData();
    window.addEventListener("accountChanged", handleAccountChanged);
    window.addEventListener("manualRefresh", handleManualRefresh);
    return () => {
      window.removeEventListener("accountChanged", handleAccountChanged);
      window.removeEventListener("manualRefresh", handleManualRefresh);
    };
  }, [loadData]);

  // 点击外部关闭账户下拉
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

  const handleRefresh = useCallback(async () => {
    try {
      setIsRefreshing(true);
      await refreshAccountData();
      await loadData();
    } catch (error) {
      logError("Failed to refresh game data:", error);
    } finally {
      setIsRefreshing(false);
    }
  }, [loadData]);

  const handleSelectRole = useCallback(
    async (newRoleId: string) => {
      setShowRoleMenu(false);
      await setConfig(ROLE_CONFIG_KEY, newRoleId);
      await loadData(newRoleId);
    },
    [loadData],
  );

  const pageAccounts = useMemo(
    () => filterAccountsForPage(accounts, "gamedata"),
    [accounts],
  );

  const currentAccount = useMemo(
    () => pageAccounts.find((a) => a.id === roleId) ?? null,
    [pageAccounts, roleId],
  );

  /** 主线当前关卡（mainStageProgress → stageInfoMap 的展示信息） */
  const mainStage = useMemo(() => {
    const key = info?.status?.mainStageProgress ?? "";
    if (!key) return null;
    const stage = info?.stageInfoMap?.[key];
    return stage ? { key, code: stage.code || key, name: stage.name } : { key, code: key, name: "" };
  }, [info]);

  /** 章节进度行：按类别分组，组内按活动开始时间倒序 */
  const chapterGroups = useMemo(() => {
    const activities: ArknightsActivityProgress[] = Array.isArray(info?.activity)
      ? info.activity
      : [];
    const rows: ChapterRow[] = [];
    for (const act of activities) {
      const zones = Array.isArray(act.zones) ? act.zones : [];
      const cleared = zones.reduce((acc, z) => acc + (z.clearedStage ?? 0), 0);
      const total = zones.reduce((acc, z) => acc + (z.totalStage ?? 0), 0);
      // 没有任何关卡内容（total=0，如未开放的活动）不展示
      if (total <= 0) continue;
      const meta = info?.activityInfoMap?.[act.actId];
      rows.push({
        actId: act.actId,
        name: meta?.name || act.actId,
        group: chapterGroupOf(meta?.type),
        isReplica: Boolean(act.actReplicaId),
        cover: meta?.picUrl || "",
        cleared,
        total,
        startTime: meta?.startTime ?? 0,
      });
    }
    const groups = new Map<ChapterGroup, ChapterRow[]>();
    for (const group of CHAPTER_GROUP_ORDER) groups.set(group, []);
    for (const row of rows) groups.get(row.group)?.push(row);
    for (const list of groups.values()) {
      list.sort((a, b) => b.startTime - a.startTime || a.actId.localeCompare(b.actId));
    }
    return groups;
  }, [info]);

  /** 剿灭据点（名称来自 campaignInfoMap） */
  const campaigns = useMemo(() => {
    const records = info?.campaign?.records ?? [];
    return records.map((r) => ({
      campaignId: r.campaignId,
      name: info?.campaignInfoMap?.[r.campaignId]?.name || r.campaignId,
      maxKills: r.maxKills ?? 0,
    }));
  }, [info]);

  /** 集成战略（按 rogueInfoMap.sort 排序） */
  const rogueRecords = useMemo(() => {
    const records = info?.rogue?.records ?? [];
    return records
      .map((r) => ({
        rogueId: r.rogueId,
        name: info?.rogueInfoMap?.[r.rogueId]?.name || r.rogueId,
        cover: info?.rogueInfoMap?.[r.rogueId]?.picUrl || "",
        sort: info?.rogueInfoMap?.[r.rogueId]?.sort ?? 0,
        bpLevel: r.bpLevel ?? 0,
        clearTime: r.clearTime ?? 0,
        medal: r.medal ?? { current: 0, total: 0 },
        relicCnt: r.relicCnt ?? 0,
      }))
      .sort((a, b) => a.sort - b.sort || a.rogueId.localeCompare(b.rogueId));
  }, [info]);

  /** 保全派驻（名称来自 towerInfoMap） */
  const towerRecords = useMemo(() => {
    const records = info?.tower?.records ?? [];
    return records.map((r) => ({
      towerId: r.towerId,
      name: info?.towerInfoMap?.[r.towerId]?.name || r.towerId,
      subName: info?.towerInfoMap?.[r.towerId]?.subName || "",
      cover: info?.towerInfoMap?.[r.towerId]?.picUrl || "",
      best: r.best ?? 0,
    }));
  }, [info]);

  const sandboxList = useMemo(() => info?.sandbox ?? [], [info]);
  const bossRushList = useMemo(() => info?.bossRush ?? [], [info]);

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto pb-6">
        <PageHeader
          accounts={pageAccounts}
          currentAccount={currentAccount}
          roleId={roleId}
          showRoleMenu={showRoleMenu}
          roleMenuRef={roleMenuRef}
          onToggleMenu={() => setShowRoleMenu((v) => !v)}
          onSelectRole={handleSelectRole}
          onRefresh={handleRefresh}
          isRefreshing={isRefreshing}
        />
        <div className="flex items-center justify-center py-24">
          <GlassProgressCircle
            isIndeterminate
            size="lg"
            aria-label="Loading"
            className="text-primary"
          >
            <GlassProgressCircle.Track>
              <GlassProgressCircle.TrackCircle />
              <GlassProgressCircle.FillCircle />
            </GlassProgressCircle.Track>
          </GlassProgressCircle>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto pb-6">
      <PageHeader
        accounts={pageAccounts}
        currentAccount={currentAccount}
        roleId={roleId}
        showRoleMenu={showRoleMenu}
        roleMenuRef={roleMenuRef}
        onToggleMenu={() => setShowRoleMenu((v) => !v)}
        onSelectRole={handleSelectRole}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
      />

      {!info ? (
        <GlassCard className="p-16 border border-separator/90">
          <div className="text-center text-muted">
            <p className="text-sm">{t("gamedata_page.empty")}</p>
          </div>
        </GlassCard>
      ) : (
        <div className="space-y-4">
          {/* 主线进度 */}
          <GlassCard className="p-4 border border-separator/90">
            <div className="text-sm font-semibold text-foreground">
              {t("gamedata_page.main_progress")}
            </div>
            {mainStage ? (
              <div className="mt-2 flex items-baseline gap-3 min-w-0">
                <span className="text-2xl font-bold font-mono text-primary-text leading-none">
                  {mainStage.code}
                </span>
                {mainStage.name && (
                  <span className="text-xs text-muted truncate">{mainStage.name}</span>
                )}
              </div>
            ) : (
              <div className="mt-2 text-xs text-muted">
                {t("gamedata_page.main_progress_empty")}
              </div>
            )}
          </GlassCard>

          {/* 章节进度 */}
          <GlassCard className="p-4 border border-separator/90">
            <div className="text-sm font-semibold text-foreground mb-3">
              {t("gamedata_page.section_chapters")}
            </div>
            <div className="space-y-4">
              {CHAPTER_GROUP_ORDER.map((group) => {
                const rows = chapterGroups.get(group) ?? [];
                if (rows.length === 0) return null;
                return (
                  <div key={group}>
                    <div className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-2">
                      {t(CHAPTER_GROUP_TITLE_KEY[group])}
                    </div>
                    <div className="space-y-2.5">
                      {rows.map((row) => {
                        const pct = row.total > 0 ? (row.cleared / row.total) * 100 : 0;
                        const done = row.cleared >= row.total;
                        return (
                          <div
                            key={`${row.group}-${row.actId}`}
                            className="relative w-full rounded-lg overflow-hidden border border-separator/60 bg-default-100/60 select-none"
                            title={row.name}
                          >
                            {row.cover ? (
                              /* 封面按原比例整幅显示（统一 1002×180 横幅），不裁切 */
                              <RemoteThumb
                                src={row.cover}
                                alt={row.name}
                                className="w-full aspect-[1002/180]"
                              />
                            ) : (
                              /* 无封面的活动：等比例深色底 + 名称 */
                              <div className="w-full aspect-[1002/180] bg-default-200/40 flex items-center px-3">
                                <span className="text-xs text-muted truncate">{row.name}</span>
                              </div>
                            )}
                            {row.isReplica && (
                              <span className="absolute left-2 top-2 px-1.5 py-0.5 rounded-md text-[9px] font-medium text-white/90 bg-black/50">
                                {t("gamedata_page.replica_badge")}
                              </span>
                            )}
                            {/* 右侧信息浮层（对齐官方展示） */}
                            <div className="absolute inset-y-0 right-0 w-[46%] bg-black/60 flex flex-col justify-center gap-1.5 px-3">
                              <div className="flex items-center justify-between gap-2 min-w-0">
                                <span
                                  className={clsx(
                                    "flex items-center gap-1.5 text-[11px] font-medium shrink-0",
                                    done ? "text-white" : "text-white/80",
                                  )}
                                >
                                  {done && (
                                    <svg
                                      className="w-3.5 h-3.5 shrink-0"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                    >
                                      <rect x="3" y="3" width="18" height="18" rx="3" />
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12.5l3 3 5-6" />
                                    </svg>
                                  )}
                                  {done
                                    ? t("gamedata_page.state_done")
                                    : t("gamedata_page.state_ongoing")}
                                </span>
                                <span
                                  className={clsx(
                                    "text-xs font-mono shrink-0",
                                    done ? "text-white" : "text-white/90",
                                  )}
                                >
                                  {row.cleared}/{row.total}
                                </span>
                              </div>
                              <div className="h-1 rounded-full bg-white/25 overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-white transition-all duration-500"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </GlassCard>

          {/* 剿灭作战 */}
          <GlassCard className="p-4 border border-separator/90">
            <div className="text-sm font-semibold text-foreground mb-3">
              {t("gamedata_page.section_campaign")}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {campaigns.map((c) => (
                <div
                  key={c.campaignId}
                  className="flex items-center justify-between gap-2 rounded-lg border border-separator/60 bg-default-50/40 px-3 py-2 min-w-0"
                >
                  <span className="text-xs text-foreground truncate" title={c.name}>
                    {c.name}
                  </span>
                  <span
                    className={clsx(
                      "shrink-0 text-[11px] font-mono",
                      c.maxKills > 0 ? "text-foreground" : "text-muted/60",
                    )}
                  >
                    {t("gamedata_page.max_kills", { kills: c.maxKills })}
                  </span>
                </div>
              ))}
            </div>
          </GlassCard>

          {/* 集成战略 + 保全派驻 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <GlassCard className="p-4 border border-separator/90">
              <div className="text-sm font-semibold text-foreground mb-3">
                {t("gamedata_page.section_rogue")}
              </div>
              <div className="space-y-2">
                {rogueRecords.map((r) => (
                  <div
                    key={r.rogueId}
                    className="flex items-center gap-3 rounded-lg border border-separator/60 bg-default-50/40 px-3 py-2 min-w-0"
                  >
                    <RemoteThumb
                      src={r.cover}
                      alt={r.name}
                      className="w-36 aspect-[1002/180] rounded-md border border-separator shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <span className="text-xs text-foreground truncate" title={r.name}>
                          {r.name}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted font-mono">
                          {t("gamedata_page.medal_progress", {
                            current: r.medal.current,
                            total: r.medal.total,
                          })}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-x-3 text-[10px] text-muted flex-wrap">
                        <span>{t("gamedata_page.bp_level", { level: r.bpLevel })}</span>
                        <span>{t("gamedata_page.relics", { count: r.relicCnt })}</span>
                        <span>
                          {r.clearTime > 0
                            ? t("gamedata_page.cleared_at", {
                                time: formatShortDateTime(r.clearTime),
                              })
                            : t("gamedata_page.not_cleared")}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>

            <GlassCard className="p-4 border border-separator/90">
              <div className="text-sm font-semibold text-foreground mb-3">
                {t("gamedata_page.section_tower")}
              </div>
              <div className="space-y-2">
                {towerRecords.map((r) => (
                  <div
                    key={r.towerId}
                    className="flex items-center gap-3 rounded-lg border border-separator/60 bg-default-50/40 px-3 py-2 min-w-0"
                  >
                    <RemoteThumb
                      src={r.cover}
                      alt={r.name}
                      className="w-36 aspect-[1002/180] rounded-md border border-separator shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-foreground truncate">{r.name}</div>
                      {r.subName && (
                        <div className="text-[10px] text-muted truncate">{r.subName}</div>
                      )}
                    </div>
                    <span className="shrink-0 text-[11px] font-mono text-foreground">
                      {t("gamedata_page.best_floor", { floor: r.best })}
                    </span>
                  </div>
                ))}
              </div>
            </GlassCard>
          </div>

          {/* 沙中之地 + 历险签约 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <GlassCard className="p-4 border border-separator/90">
              <div className="text-sm font-semibold text-foreground mb-3">
                {t("gamedata_page.section_sandbox")}
              </div>
              {sandboxList.length === 0 ? (
                <div className="text-xs text-muted/70">—</div>
              ) : (
                <div className="space-y-2">
                  {sandboxList.map((s) => (
                    <div
                      key={s.id}
                      className="rounded-lg border border-separator/60 bg-default-50/40 px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <span className="text-xs text-foreground truncate">{s.name || s.id}</span>
                        <span className="shrink-0 text-[10px] text-muted font-mono">
                          {t("building_page.level", { level: s.baseLv ?? 0 })}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-x-3 text-[10px] text-muted flex-wrap">
                        {Array.isArray(s.fixRift) && s.fixRift.length >= 2 && (
                          <span>
                            {s.fixRift[0]}/{s.fixRift[1]}
                          </span>
                        )}
                        <span>max {s.maxDay ?? 0}d</span>
                        <span>
                          {(s.subQuest ?? []).filter((q) => q.done).length}/
                          {(s.subQuest ?? []).length}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </GlassCard>

            <GlassCard className="p-4 border border-separator/90">
              <div className="text-sm font-semibold text-foreground mb-3">
                {t("gamedata_page.section_bossrush")}
              </div>
              <div className="space-y-2">
                {bossRushList.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center gap-3 rounded-lg border border-separator/60 bg-default-50/40 px-3 py-2 min-w-0"
                  >
                    <RemoteThumb
                      src={b.picUrl}
                      alt={b.id}
                      className="w-36 aspect-[1002/180] rounded-md border border-separator shrink-0"
                    />
                    <span className="flex-1 text-xs text-foreground truncate font-mono">{b.id}</span>
                    <span
                      className={clsx(
                        "shrink-0 text-[10px]",
                        b.record?.played ? "text-success-text font-medium" : "text-muted",
                      )}
                    >
                      {b.record?.played
                        ? `${t("gamedata_page.played")}${
                            b.record?.difficulty ? ` · ${b.record.difficulty}` : ""
                          }`
                        : t("gamedata_page.not_played")}
                    </span>
                  </div>
                ))}
              </div>
            </GlassCard>
          </div>
        </div>
      )}
    </div>
  );
}

/** 页头（账户切换 + 刷新），加载态与正常态共用 */
function PageHeader({
  accounts,
  currentAccount,
  roleId,
  showRoleMenu,
  roleMenuRef,
  onToggleMenu,
  onSelectRole,
  onRefresh,
  isRefreshing,
}: {
  accounts: Account[];
  currentAccount: Account | null;
  roleId: string | null;
  showRoleMenu: boolean;
  roleMenuRef: React.RefObject<HTMLDivElement | null>;
  onToggleMenu: () => void;
  onSelectRole: (roleId: string) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  const { t, i18n } = useTranslation();
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
      <div className="flex items-center gap-3 min-w-0">
        <CardIcon iconKey="chart" size={28} className="text-primary-text shrink-0" />
        <div className="min-w-0">
          <h1 className="text-2xl lg:text-3xl font-bold text-foreground tracking-tight">
            {t("sidebar.gamedata")}
          </h1>
          <p className="text-foreground/70 mt-1 text-sm truncate">
            {t("gamedata_page.subtitle")}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <div className="relative" ref={roleMenuRef}>
          <GlassButton
            variant="ghost"
            isDisabled={accounts.length === 0}
            onPress={onToggleMenu}
            endContent={<ChevronDownIcon size={14} />}
            className="lg-material border border-separator/70 max-w-48"
          >
            {currentAccount ? (
              <AccountNameLine game={currentAccount.game} className="max-w-full">
                {currentAccount.nickname}
              </AccountNameLine>
            ) : (
              <span className="truncate">{t("gamedata_page.switch_account")}</span>
            )}
          </GlassButton>

          {showRoleMenu && (
            <div className="lg-regular absolute right-0 top-full mt-2 z-50 w-64 rounded-xl border border-separator/60 overflow-hidden animate-scale-in">
              <div className="max-h-72 overflow-y-auto">
                {accounts.map((acc) => {
                  const isSelected = acc.id === roleId;
                  return (
                    <button
                      key={acc.id}
                      type="button"
                      onClick={() => onSelectRole(acc.id)}
                      className={clsx(
                        "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors duration-200",
                        isSelected ? "bg-primary/15" : "lg-hoverable",
                      )}
                    >
                      <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 lg-inset flex items-center justify-center">
                        {acc.avatar ? (
                          <Img
                            src={acc.avatar}
                            alt={acc.nickname}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-muted text-xs font-semibold">
                            {(acc.nickname ?? "?").charAt(0)}
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">
                          <AccountNameLine game={acc.game}>
                            {acc.nickname || t("common.unknown")}
                          </AccountNameLine>
                        </p>
                        <p className="text-xs text-muted truncate">
                          {resolveServerLabel(acc.server, i18n.language)} · Lv.{acc.level}
                        </p>
                      </div>
                      {isSelected && (
                        <CheckIcon size={14} className="text-primary-text shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <GlassTooltip>
          <GlassButton
            isIconOnly
            variant="ghost"
            size="sm"
            onPress={onRefresh}
            isDisabled={isRefreshing}
            className="text-muted hover:text-foreground lg-hoverable rounded-xl"
            aria-label={t("common.refresh")}
          >
            <RefreshIcon size={20} className={isRefreshing ? "animate-spin" : ""} />
          </GlassButton>
          <GlassTooltip.Content>{t("common.refresh")}</GlassTooltip.Content>
        </GlassTooltip>
      </div>
    </div>
  );
}
