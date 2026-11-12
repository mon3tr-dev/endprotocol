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
import {
  RefreshIcon,
  ChevronDownIcon,
  CheckIcon,
} from "@/components/ui/app-icon";
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
import { RemoteThumb } from "@/components/ui/remote-thumb";
import type {
  ArknightsActivityProgress,
  ArknightsPlayerInfo,
} from "@/types/arknights";

/** 页面内独立记住的游戏账户（未设置时跟随全局选中账户） */
const ROLE_CONFIG_KEY = "gamedata_page_role_id";

/** 各区块折叠状态（sectionKey → 是否折叠），持久化到 ConfigService */
const FOLD_CONFIG_KEY = "gamedata_page_folded";

/** 活动类别 → i18n 键与展示顺序（SIDESTORY 别传 / MINISTORY 故事集 / BRANCHLINE 插曲 / 其他活动） */
const CHAPTER_GROUP_ORDER = [
  "sidestory",
  "ministory",
  "branchline",
  "other",
] as const;
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

/** act6bossrush → 6；无法解析返回 null（名称回退原始 id） */
function parseBossRushNum(id: string): number | null {
  const m = /^act(\d+)bossrush$/.exec(id);
  return m ? Number.parseInt(m[1], 10) : null;
}

/** 章节期数 → 「#06」样式编号（两位补零） */
function bossRushBadgeLabel(num: number): string {
  return `#${String(num).padStart(2, "0")}`;
}

/** 图片行容器：固定行高 + 相对定位，缩略图绝对定位铺在左侧（不占布局） */
const IMAGE_ROW_CLASS =
  "relative flex h-14 items-center overflow-hidden rounded-lg border border-separator/60 bg-default-50/40 min-w-0";

/** 行内横幅缩略图：占满行高、保持 1002:180 原比例不裁剪；绝对定位在行左缘，
 *  右端用 mask 提前渐隐到卡片背景，使压在左侧 1/3 处的文字始终清晰可读 */
const IMAGE_THUMB_CLASS =
  "pointer-events-none absolute inset-y-0 left-0 h-full w-auto max-w-none shrink-0 [mask-image:linear-gradient(to_right,black_15%,transparent_58%)] [-webkit-mask-image:linear-gradient(to_right,black_15%,transparent_58%)]";

/** 图片行内的文字块：有图时 `pl-[33%]` 落在行的左侧 1/3 处并压在图上，无图时常规内边距 */
const IMAGE_TEXT_CLASS = "relative z-10 min-w-0 flex-1 py-1 pr-3";

/** 一个章节（活动）聚合后的展示行 */
interface ChapterRow {
  actId: string;
  name: string;
  group: ChapterGroup;
  /** 复刻（actReplicaId 非空） */
  isReplica: boolean;
  /** 章节封面（activityInfoMap.picUrl；实测约 57% 有值，空则渲染紧凑行不显示封面） */
  cover: string;
  cleared: number;
  total: number;
  startTime: number;
}

/** 章节行右侧的状态 + 进度块（内联语义色，有封面行与无封面紧凑行共用） */
function ChapterStatus({
  done,
  cleared,
  total,
  pct,
  doneText,
  ongoingText,
}: {
  done: boolean;
  cleared: number;
  total: number;
  pct: number;
  doneText: string;
  ongoingText: string;
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span
          className={clsx(
            "flex items-center gap-1.5 text-[11px] font-medium shrink-0",
            done ? "text-foreground" : "text-muted",
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
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8 12.5l3 3 5-6"
              />
            </svg>
          )}
          {done ? doneText : ongoingText}
        </span>
        <span className="text-xs font-mono shrink-0 text-foreground">
          {cleared}/{total}
        </span>
      </div>
      <div className="h-1 rounded-full bg-default-200 overflow-hidden">
        <div
          className="h-full rounded-full bg-foreground transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </>
  );
}

/** 可折叠区块卡片：点击标题行折叠/展开。
 *
 * 动画沿用账户页的 `grid-template-rows: 0fr ↔ 1fr` 方案（见 pages/account.tsx）：
 * 不需要测量内容高度，内容高度不一的卡片也能平滑过渡；内层 `min-h-0 overflow-hidden`
 * 是必需项，否则 grid 的 `0fr` 不会真正裁掉内容。折叠后内容仍留在 DOM，
 * 用 `aria-hidden` / `inert` 屏蔽交互与可访问性树。
 */
function CollapsibleCard({
  sectionKey,
  title,
  badge,
  folded,
  onToggle,
  children,
}: {
  sectionKey: string;
  title: string;
  badge?: React.ReactNode;
  folded: boolean;
  onToggle: (key: string) => void;
  children: React.ReactNode;
}) {
  return (
    <GlassCard className="border border-separator/90 overflow-hidden">
      <button
        type="button"
        onClick={() => onToggle(sectionKey)}
        aria-expanded={!folded}
        className="w-full flex items-center justify-between gap-2 px-4 pt-4 pb-3 select-none text-left transition-colors duration-200 hover:bg-default-100/40"
      >
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className="flex items-center gap-2 shrink-0">
          {badge}
          <ChevronDownIcon
            size={14}
            className={clsx(
              "text-muted transition-transform duration-300 ease-out",
              folded && "-rotate-90",
            )}
          />
        </span>
      </button>
      {/* 展开区域：grid-template-rows 过渡，实现平滑的高度动画 */}
      <div
        aria-hidden={folded}
        inert={folded}
        className={clsx(
          "grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-out",
          folded ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className={clsx(
              "px-4 pb-4 transition-[transform,opacity] duration-300 ease-out",
              folded ? "-translate-y-1 opacity-0" : "translate-y-0 opacity-100",
            )}
          >
            {children}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

export default function GameDataPage() {
  const { t } = useTranslation();
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
      if (
        roleMenuRef.current &&
        !roleMenuRef.current.contains(e.target as Node)
      ) {
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
    return stage
      ? { key, code: stage.code || key, name: stage.name }
      : { key, code: key, name: "" };
  }, [info]);

  /** 章节进度行：按类别分组，组内按活动开始时间倒序 */
  const chapterGroups = useMemo(() => {
    const activities: ArknightsActivityProgress[] = Array.isArray(
      info?.activity,
    )
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
      list.sort(
        (a, b) => b.startTime - a.startTime || a.actId.localeCompare(b.actId),
      );
    }
    return groups;
  }, [info]);

  /** 剿灭据点（名称/封面/阵营来自 campaignInfoMap + campaignZoneInfoMap） */
  const campaigns = useMemo(() => {
    const records = info?.campaign?.records ?? [];
    return records.map((r) => {
      const meta = info?.campaignInfoMap?.[r.campaignId];
      return {
        campaignId: r.campaignId,
        name: meta?.name || r.campaignId,
        cover: meta?.picUrl || "",
        /** 阵营名（哥伦比亚/谢拉格/维多利亚…）；接口缺表时为空 */
        zone: info?.campaignZoneInfoMap?.[meta?.campaignZoneId ?? ""]?.name || "",
        maxKills: r.maxKills ?? 0,
      };
    });
  }, [info]);

  /** 集成战略（按 rogueInfoMap.sort **降序** = 官方顺序：最新主题在上，如 #6 沉沦者的黑流树海在最前） */
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
        bank: r.bank ?? { current: 0, record: 0 },
      }))
      .sort((a, b) => b.sort - a.sort || b.rogueId.localeCompare(a.rogueId));
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
  /** 引航者试炼（Trials for Navigator）：解析期数并按期数倒序（#06 在前，对齐官方排序） */
  const bossRushList = useMemo(
    () =>
      (info?.bossRush ?? [])
        .map((b) => ({ ...b, num: parseBossRushNum(b.id) }))
        .sort((a, b) => (b.num ?? -1) - (a.num ?? -1)),
    [info],
  );

  /** 各区块折叠状态：首次进入读取一次，之后每次变更写回配置 */
  const [foldedSections, setFoldedSections] = useState<Record<string, boolean>>(
    {},
  );
  const foldedLoadedRef = useRef(false);

  useEffect(() => {
    void (async () => {
      try {
        const saved = await getConfig<Record<string, boolean>>(FOLD_CONFIG_KEY);
        if (saved && typeof saved === "object") setFoldedSections(saved);
      } catch (error) {
        logError("Failed to load fold state:", error);
      } finally {
        foldedLoadedRef.current = true;
      }
    })();
  }, []);

  useEffect(() => {
    if (!foldedLoadedRef.current) return;
    void setConfig(FOLD_CONFIG_KEY, foldedSections).catch((error) =>
      logError("Failed to save fold state:", error),
    );
  }, [foldedSections]);

  const toggleSection = useCallback((key: string) => {
    setFoldedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

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
          <CollapsibleCard
            sectionKey="main"
            title={t("gamedata_page.main_progress")}
            folded={Boolean(foldedSections.main)}
            onToggle={toggleSection}
          >
            {mainStage ? (
              <div className="flex items-baseline gap-3 min-w-0">
                <span className="text-2xl font-bold font-mono text-primary-text leading-none">
                  {mainStage.code}
                </span>
                {mainStage.name && (
                  <span className="text-xs text-muted truncate">
                    {mainStage.name}
                  </span>
                )}
              </div>
            ) : (
              <div className="text-xs text-muted">
                {t("gamedata_page.main_progress_empty")}
              </div>
            )}
          </CollapsibleCard>

          {/* 章节进度：按类别拆分为独立可折叠卡片 */}
          {CHAPTER_GROUP_ORDER.map((group) => {
            const rows = chapterGroups.get(group) ?? [];
            if (rows.length === 0) return null;
            return (
              <CollapsibleCard
                key={group}
                sectionKey={`chapters_${group}`}
                title={`${t("gamedata_page.section_chapters")} · ${t(CHAPTER_GROUP_TITLE_KEY[group])}`}
                badge={
                  <span className="text-[10px] font-mono text-muted">
                    {rows.length}
                  </span>
                }
                folded={Boolean(foldedSections[`chapters_${group}`])}
                onToggle={toggleSection}
              >
                <div className="space-y-2.5">
                  {rows.map((row) => {
                    const pct =
                      row.total > 0 ? (row.cleared / row.total) * 100 : 0;
                    const done = row.cleared >= row.total;
                    const status = (
                      <ChapterStatus
                        done={done}
                        cleared={row.cleared}
                        total={row.total}
                        pct={pct}
                        doneText={t("gamedata_page.state_done")}
                        ongoingText={t("gamedata_page.state_ongoing")}
                      />
                    );
                    if (!row.cover) {
                      /* 无封面的活动：不渲染占位封面，紧凑行 + 内联进度 */
                      return (
                        <div
                          key={`${row.group}-${row.actId}`}
                          className="w-full rounded-lg overflow-hidden border border-separator/60 bg-default-100/60 select-none flex items-center gap-3 px-3 py-2.5"
                          title={row.name}
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            {row.isReplica && (
                              <span className="px-1.5 py-0.5 rounded-md text-[9px] font-medium text-white/90 bg-black/50 shrink-0">
                                {t("gamedata_page.replica_badge")}
                              </span>
                            )}
                            <span className="text-xs text-foreground truncate">
                              {row.name}
                            </span>
                          </div>
                          <div className="w-[46%] flex flex-col justify-center gap-1.5 shrink-0">
                            {status}
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div
                        key={`${row.group}-${row.actId}`}
                        className="relative w-full flex items-center overflow-hidden rounded-lg border border-separator/60 bg-default-100/60 select-none"
                        title={row.name}
                      >
                        {/* 封面按原比例整幅显示，宽度缩小到行的 1/3 */}
                        <RemoteThumb
                          src={row.cover}
                          alt={row.name}
                          className="w-1/3 aspect-[1002/180] shrink-0"
                        />
                        {row.isReplica && (
                          <span className="absolute left-2 top-2 px-1.5 py-0.5 rounded-md text-[9px] font-medium text-white/90 bg-black/50">
                            {t("gamedata_page.replica_badge")}
                          </span>
                        )}
                        {/* 右侧状态（内联，与无封面行一致） */}
                        <div className="ml-auto w-[46%] flex flex-col justify-center gap-1.5 px-3 py-2 shrink-0">
                          {status}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CollapsibleCard>
            );
          })}

          {/* 剿灭作战 */}
          <CollapsibleCard
            sectionKey="campaign"
            title={t("gamedata_page.section_campaign")}
            folded={Boolean(foldedSections.campaign)}
            onToggle={toggleSection}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {campaigns.map((c) => (
                <div
                  key={c.campaignId}
                  className="relative flex h-16 items-center justify-between gap-2 overflow-hidden rounded-lg border border-separator/60 bg-default-50/40 px-3 min-w-0"
                  title={c.zone ? `${c.name} · ${c.zone}` : c.name}
                >
                  {/* 据点封面作为整行背景（1002×180 横幅），右侧渐隐避免压住文字 */}
                  {c.cover && (
                    <RemoteThumb
                      src={c.cover}
                      alt={c.name}
                      className="pointer-events-none absolute inset-0 h-full w-full [mask-image:linear-gradient(to_right,black_8%,transparent_72%)] [-webkit-mask-image:linear-gradient(to_right,black_8%,transparent_72%)]"
                    />
                  )}
                  {/* 左侧：据点名 + 阵营徽标 */}
                  <div className="relative z-10 flex flex-col justify-center gap-1 min-w-0">
                    <span className="text-xs font-medium text-foreground truncate">
                      {c.name}
                    </span>
                    {c.zone && (
                      <span className="inline-flex w-fit items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[9px] text-white/90 max-w-full">
                        <span className="truncate">{c.zone}</span>
                      </span>
                    )}
                  </div>
                  {/* 右侧：最高剿灭数 */}
                  <span
                    className={clsx(
                      "relative z-10 shrink-0 text-[11px] font-mono",
                      c.maxKills > 0 ? "text-foreground" : "text-muted/60",
                    )}
                  >
                    {t("gamedata_page.max_kills", { kills: c.maxKills })}
                  </span>
                </div>
              ))}
            </div>
          </CollapsibleCard>

          {/* 集成战略 + 保全派驻 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            <CollapsibleCard
              sectionKey="rogue"
              title={t("gamedata_page.section_rogue")}
              folded={Boolean(foldedSections.rogue)}
              onToggle={toggleSection}
            >
              <div className="space-y-2">
                {rogueRecords.map((r) => (
                  <div key={r.rogueId} className={IMAGE_ROW_CLASS}>
                    {r.cover && (
                      <RemoteThumb
                        src={r.cover}
                        alt={r.name}
                        className={IMAGE_THUMB_CLASS}
                      />
                    )}
                    <div
                      className={clsx(IMAGE_TEXT_CLASS, r.cover && "pl-[33%]")}
                    >
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <span
                          className="text-xs text-foreground truncate"
                          title={r.name}
                        >
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
                        {/* 官方「集成战略」页展示的是投资系统（bank.current）与解锁道具（relicCnt）；
                            ⚠️ bpLevel 是通票等级，不在官方该页展示；clearTime 实测是 0/2/6 这类小整数
                            而非时间戳，不能按日期格式化（曾因此渲染成「01-01 08:00 首通」） */}
                        <span>{t("gamedata_page.bank_invest", { count: r.bank.current })}</span>
                        <span>{t("gamedata_page.relics", { count: r.relicCnt })}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CollapsibleCard>

            <CollapsibleCard
              sectionKey="tower"
              title={t("gamedata_page.section_tower")}
              folded={Boolean(foldedSections.tower)}
              onToggle={toggleSection}
            >
              <div className="space-y-2">
                {towerRecords.map((r) => (
                  <div key={r.towerId} className={IMAGE_ROW_CLASS}>
                    {r.cover && (
                      <RemoteThumb
                        src={r.cover}
                        alt={r.name}
                        className={IMAGE_THUMB_CLASS}
                      />
                    )}
                    <div
                      className={clsx(IMAGE_TEXT_CLASS, r.cover && "pl-[20%]")}
                    >
                      <div className="text-xs text-foreground truncate">
                        {r.name}
                      </div>
                      {r.subName && (
                        <div className="text-[10px] text-muted truncate">
                          {r.subName}
                        </div>
                      )}
                    </div>
                    <span className="shrink-0 text-[11px] font-mono text-foreground pr-3">
                      {t("gamedata_page.best_floor", { floor: r.best })}
                    </span>
                  </div>
                ))}
              </div>
            </CollapsibleCard>
          </div>

          {/* 生息演算 + 引航者试炼 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            <CollapsibleCard
              sectionKey="sandbox"
              title={t("gamedata_page.section_sandbox")}
              folded={Boolean(foldedSections.sandbox)}
              onToggle={toggleSection}
            >
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
                        <span className="text-xs text-foreground truncate">
                          {s.name || s.id}
                        </span>
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
            </CollapsibleCard>

            <CollapsibleCard
              sectionKey="bossrush"
              title={t("gamedata_page.section_bossrush")}
              folded={Boolean(foldedSections.bossrush)}
              onToggle={toggleSection}
            >
              <div className="space-y-2">
                {bossRushList.map((b) => {
                  const label =
                    b.num != null ? bossRushBadgeLabel(b.num) : b.id;
                  return (
                    <div key={b.id} className={IMAGE_ROW_CLASS}>
                      {b.picUrl && (
                        <RemoteThumb
                          src={b.picUrl}
                          alt={label}
                          className={IMAGE_THUMB_CLASS}
                        />
                      )}
                      <div
                        className={clsx(
                          IMAGE_TEXT_CLASS,
                          b.picUrl && "pl-[15%]",
                        )}
                      >
                        <div
                          className="text-xs text-foreground truncate"
                          title={
                            b.num != null
                              ? t("gamedata_page.bossrush_season", { n: b.num })
                              : b.id
                          }
                        >
                          {b.num != null
                            ? t("gamedata_page.bossrush_season", { n: b.num })
                            : b.id}
                        </div>
                        {b.num != null && (
                          <span className="mt-0.5 inline-block px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold bg-amber-400/90 text-black">
                            {label}
                          </span>
                        )}
                      </div>
                      <span
                        className={clsx(
                          "shrink-0 text-[10px] pr-3",
                          b.record?.played
                            ? "text-success-text font-medium"
                            : "text-muted",
                        )}
                      >
                        {b.record?.played
                          ? `${t("gamedata_page.played")}${
                              b.record?.difficulty
                                ? ` · ${b.record.difficulty}`
                                : ""
                            }`
                          : t("gamedata_page.not_played")}
                      </span>
                    </div>
                  );
                })}
              </div>
            </CollapsibleCard>
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
        <CardIcon
          iconKey="chart"
          size={28}
          className="text-primary-text shrink-0"
        />
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
              <AccountNameLine
                game={currentAccount.game}
                className="max-w-full"
              >
                {currentAccount.nickname}
              </AccountNameLine>
            ) : (
              <span className="truncate">
                {t("gamedata_page.switch_account")}
              </span>
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
                          {resolveServerLabel(acc.server, i18n.language)} · Lv.
                          {acc.level}
                        </p>
                      </div>
                      {isSelected && (
                        <CheckIcon
                          size={14}
                          className="text-primary-text shrink-0"
                        />
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
            <RefreshIcon
              size={20}
              className={isRefreshing ? "animate-spin" : ""}
            />
          </GlassButton>
          <GlassTooltip.Content>{t("common.refresh")}</GlassTooltip.Content>
        </GlassTooltip>
      </div>
    </div>
  );
}
