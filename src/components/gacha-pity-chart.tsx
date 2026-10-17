import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { CustomChart } from "echarts/charts";
import {
  GraphicComponent,
  GridComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";
import { invoke } from "@tauri-apps/api/core";
import { GlassCard, GlassSelect } from "@/components/ui/glass";
import { cacheManager, usePinImages } from "@/utils/imageCacheManager";
import { calculateGachaSixStarIntervals } from "@/utils/gachaIntervals";
import { logError } from "@/utils/logger";
import type { GachaCategory, GachaPoolInfo, GachaPoolKind, GachaRecord } from "@/types/gacha";

echarts.use([
  CustomChart,
  GridComponent,
  TooltipComponent,
  GraphicComponent,
  CanvasRenderer,
]);

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

interface ChartRow {
  kind: "six" | "leftover";
  /** 角色/武器 id（用于图标映射） */
  id?: string | null;
  name: string;
  count: number;
  gachaTs?: string;
  inGift: boolean;
}

interface ChartSection {
  poolId: string;
  poolName: string;
  rows: ChartRow[];
}

/** 计算水平条形图数据：
 * 卡池按 poolId 合并（先抽 A、再抽 B、最后又回 A 时合并为一个卡池区间），区间内按时间顺序排列六星与余量；
 * 卡池排序以该卡池最先出现的第一个六星时间倒序，无六星的卡池按最近一条记录时间倒序 */
function computeSections(
  records: GachaRecord[],
  pools: Record<string, GachaPoolInfo>,
  category: GachaCategory,
): ChartSection[] {
  // 过滤并合并到 poolId（组内保持从新到旧）
  const byPool = new Map<string, { poolId: string; poolName: string; rows: GachaRecord[] }>();
  for (const rec of records) {
    if (rec.kind !== "draw") continue;
    if (category !== "weapon" && category !== "all" && poolKindOf(rec, pools) !== category) continue;
    let sec = byPool.get(rec.poolId);
    if (!sec) {
      sec = {
        poolId: rec.poolId,
        poolName: rec.poolName || pools[rec.poolId]?.poolName || rec.poolId,
        rows: [],
      };
      byPool.set(rec.poolId, sec);
    }
    sec.rows.push(rec);
  }

  const intervalBySeqId = new Map(
    calculateGachaSixStarIntervals(
      [...byPool.values()].flatMap((section) => section.rows),
      pools,
    ).map((interval) => [interval.record.seqId, interval]),
  );

  const sections: ChartSection[] = [];
  for (const section of byPool.values()) {
    const out: ChartRow[] = [];
    let n = 0; // 自上个六星以来的普通抽数，用于计算未出六星余量
    const rows = section.rows; // 从新到旧
    for (let i = rows.length - 1; i >= 0; i--) {
      const rec = rows[i];
      if (rec.isFree) {
        if ((rec.rarity ?? 0) === 6) {
          out.unshift({
            kind: "six",
            id: rec.charId ?? rec.weaponId,
            name: rec.weaponName ?? rec.charName ?? rec.nameText,
            count: intervalBySeqId.get(rec.seqId)!.count,
            gachaTs: rec.gachaTs,
            inGift: true,
          });
          n = 0;
        }
      } else {
        if ((rec.rarity ?? 0) === 6) {
          out.unshift({
            kind: "six",
            id: rec.charId ?? rec.weaponId,
            name: rec.weaponName ?? rec.charName ?? rec.nameText,
            count: intervalBySeqId.get(rec.seqId)!.count,
            gachaTs: rec.gachaTs,
            inGift: false,
          });
          n = 0;
        } else {
          n += 1;
        }
      }
    }
    if (n > 0) {
      out.unshift({
        kind: "leftover",
        name: "",
        count: n,
        inGift: false,
        gachaTs: rows[0]?.gachaTs,
      });
    }
    if (out.length > 0) {
      sections.push({ poolId: section.poolId, poolName: section.poolName, rows: out });
    }
  }

  // 卡池排序：以最先出现的第一个六星时间倒序；无六星卡池按最近记录时间倒序
  sections.sort((a, b) => firstSixTs(b) - firstSixTs(a));
  return sections;
}

/** 卡池排序键：最先出现的第一个六星时间（ms，区间内最旧的六星）；无六星时取最近一条记录时间 */
function firstSixTs(section: ChartSection): number {
  let key = 0;
  for (const r of section.rows) {
    if (r.kind === "six") {
      key = r.gachaTs ? Number(r.gachaTs) : 0;
    }
  }
  if (key > 0) return key;
  const leftover = section.rows.find((r) => r.kind === "leftover");
  return leftover?.gachaTs ? Number(leftover.gachaTs) : 0;
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** 将头像图片裁剪为圆形 dataURL */
function circleAvatar(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    cacheManager
      .load(src)
      .then((blobUrl) => {
        const img = new Image();
        img.onload = () => {
          try {
            const size = 96;
            const canvas = document.createElement("canvas");
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              reject(new Error("canvas 2d unavailable"));
              return;
            }
            ctx.beginPath();
            ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(img, 0, 0, size, size);
            resolve(canvas.toDataURL("image/png"));
          } catch (e) {
            reject(e);
          }
        };
        img.onerror = () => reject(new Error(`avatar load failed: ${src}`));
        img.src = blobUrl;
      })
      .catch(reject);
  });
}

const ROW_H = 44; // 每行高度（含卡池分组头）
const AVATAR_SIZE = 36; // 头像尺寸
const GRID_LEFT = 84; // 左侧留白：头像列 + 竖线 + 间距
const GRID_RIGHT = 64; // 右侧留白：计数标签
const BAR_GAP = 10; // 柱体上下留白
const BAR_START_GAP = 10; // 柱体与竖线的间距（竖线不动，柱体右移）
const CHART_BOTTOM_PAD = 14; // 画布底部留白（避免最后一行贴底被遮住）

const HEADER_FONT = "600 12px system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";

const _measureCtx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
function measureTextWidth(text: string, font: string): number {
  if (!_measureCtx) return text.length * 8;
  _measureCtx.font = font;
  return _measureCtx.measureText(text).width;
}

interface ChartProps {
  roleId: string | null;
  records: GachaRecord[];
  pools: Record<string, GachaPoolInfo>;
  category: GachaCategory;
  isZh: boolean;
}

export default function GachaPityChart({
  roleId,
  records,
  pools,
  category,
  isZh,
}: ChartProps) {
  // 当前分类下的卡池列表（按记录出现顺序，从新到旧）
  const poolOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: { poolId: string; poolName: string }[] = [];
    for (const r of records) {
      if (r.kind !== "draw") continue;
      if (category !== "weapon" && category !== "all" && poolKindOf(r, pools) !== category) continue;
      if (seen.has(r.poolId)) continue;
      seen.add(r.poolId);
      out.push({
        poolId: r.poolId,
        poolName: r.poolName || pools[r.poolId]?.poolName || r.poolId,
      });
    }
    return out;
  }, [records, pools, category]);

  const [poolFilter, setPoolFilter] = useState<string | null>(null);

  // 切换分类时重置卡池筛选
  useEffect(() => {
    setPoolFilter(null);
  }, [category]);

  const filteredRecords = useMemo(
    () => (poolFilter ? records.filter((r) => r.poolId === poolFilter) : records),
    [records, poolFilter],
  );
  const sections = useMemo(
    () => computeSections(filteredRecords, pools, category),
    [filteredRecords, pools, category],
  );

  // 需要的六星角色/武器 id
  const neededIds = useMemo(() => {
    const set = new Set<string>();
    for (const s of sections) {
      for (const r of s.rows) {
        if (r.kind === "six" && r.id) set.add(r.id);
      }
    }
    return [...set];
  }, [sections]);

  // 图标映射（映射文件优先，缺失时后端按名称在 total.json 中匹配补全）
  const [avatarMap, setAvatarMap] = useState<Record<string, string>>({});
  const avatarMapRef = useRef<Record<string, string>>({});
  const resolvingRef = useRef(false);

  useEffect(() => {
    if (!roleId) return;
    const missing = neededIds.filter((id) => !(id in avatarMapRef.current));
    if (missing.length === 0 || resolvingRef.current) return;
    resolvingRef.current = true;
    invoke<Record<string, string>>("resolve_gacha_avatar_map", { roleId })
      .then((map) => {
        avatarMapRef.current = { ...avatarMapRef.current, ...map };
        setAvatarMap(avatarMapRef.current);
      })
      .catch((e) => {
        logError("[GachaChart] resolve avatar map failed:", e);
      })
      .finally(() => {
        resolvingRef.current = false;
      });
  }, [roleId, neededIds]);

  // 图标 src -> 圆形 dataURL（缓存于组件状态）
  const [avatarImgs, setAvatarImgs] = useState<Record<string, string | null>>({});
  const neededSrcs = useMemo(
    () =>
      neededIds
        .map((id) => avatarMap[id])
        .filter((src): src is string => Boolean(src)),
    [neededIds, avatarMap],
  );
  usePinImages(neededSrcs);

  useEffect(() => {
    let cancelled = false;
    const ids = neededIds.filter((id) => avatarMap[id]);
    if (ids.length === 0) return;
    (async () => {
      const entries: Record<string, string | null> = {};
      await Promise.all(
        ids.map(async (id) => {
          try {
            const dataUrl = await circleAvatar(avatarMap[id]);
            if (!cancelled) entries[id] = dataUrl;
          } catch {
            if (!cancelled) entries[id] = null;
          }
        }),
      );
      if (!cancelled) setAvatarImgs((prev) => ({ ...prev, ...entries }));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [neededIds.join(","), avatarMap]);

  // 主题色（跟随 AuraGlass）
  const [themeTick, setThemeTick] = useState(0);
  useEffect(() => {
    const handler = () => setThemeTick((t) => t + 1);
    window.addEventListener("themeChange", handler);
    return () => window.removeEventListener("themeChange", handler);
  }, []);

  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<ReturnType<typeof echarts.init> | null>(null);

  // 行元数据（含卡池分组头行）
  const meta = useMemo(() => {
    const out: { kind: "header" | "six" | "leftover"; section: ChartSection; row?: ChartRow }[] = [];
    for (const section of sections) {
      out.push({ kind: "header", section });
      for (const row of section.rows) out.push({ kind: row.kind, section, row });
    }
    return out;
  }, [sections]);

  const hasRows = meta.length > 0;

  // 初始化图表实例 + 自适应（数据行存在时才挂载容器，行数变化时重建）
  useEffect(() => {
    if (!hasRows || !chartRef.current) return;
    const chart = echarts.init(chartRef.current);
    chartInstance.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(chartRef.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartInstance.current = null;
    };
  }, [hasRows]);

  const sixCount = useMemo(
    () => sections.reduce((acc, s) => acc + s.rows.filter((r) => r.kind === "six").length, 0),
    [sections],
  );

  // 渲染 ECharts 配置
  useEffect(() => {
    const chart = chartInstance.current;
    if (!chart || meta.length === 0) return;

    const primary = cssVar("--primary", "#6366f1");
    const muted = cssVar("--muted", "#71717a");
    const separator = cssVar("--separator", "#e4e4e7");
    const defaultColor = cssVar("--default-400", "#94a3b8");
    const danger = cssVar("--danger", "#ef4444");
    // 深色模式下卡池名用更亮的浅灰
    const isDark = document.documentElement.classList.contains("dark");
    const headerColor = isDark ? cssVar("--default-600", "#cbd5e1") : muted;

    const categories = meta.map((_, i) => `r${i}`);
    const maxCount = Math.max(10, ...meta.filter((m) => m.kind !== "header").map((m) => m.row!.count));

    const option: EChartsOption = {
      animationDuration: 500,
      animationEasing: "cubicOut",
      grid: { left: GRID_LEFT, right: GRID_RIGHT, top: 0, bottom: CHART_BOTTOM_PAD, containLabel: false },
      xAxis: {
        type: "value",
        min: 0,
        max: maxCount,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { show: false },
        splitLine: { show: false },
      },
      yAxis: {
        type: "category",
        data: categories,
        inverse: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { show: false },
      },
      tooltip: {
        trigger: "item",
        backgroundColor: "transparent",
        borderColor: "transparent",
        borderWidth: 0,
        className: "glass-surface-strong rounded-xl shadow-xl",
        extraCssText: "border:1px solid var(--separator);border-radius:12px;",
        padding: [8, 12],
        textStyle: { color: "var(--foreground)", fontSize: 12 },
        formatter: (params: any) => {
          const m = meta[params.dataIndex];
          if (!m) return "";
          if (m.kind === "header") {
            return `<div style="font-weight:600">${escapeHtml(m.section.poolName)}</div>`;
          }
          const row = m.row!;
          const lines: string[] = [];
          if (row.kind === "six") {
            lines.push(`<div style="font-weight:600;font-size:13px">${escapeHtml(row.name ?? "?")}</div>`);
            lines.push(escapeHtml(m.section.poolName));
            lines.push(isZh ? `距上个六星/该池首抽 ${row.count} 抽` : `${row.count} pulls since last 6★ / pool start`);
            if (row.inGift) lines.push(isZh ? "赠送抽出的六星" : "6★ from free pulls");
            if (row.gachaTs) lines.push(formatTime(row.gachaTs, isZh));
          } else {
            lines.push(`<div style="font-weight:600">${isZh ? "未出六星" : "No 6★"}: ${row.count}</div>`);
            lines.push(escapeHtml(m.section.poolName));
            lines.push(isZh ? "该卡池未出六星的抽数" : "Pulls without a 6★ in this pool");
          }
          return lines.map((l) => `<div>${l}</div>`).join("");
        },
      },
      graphic: {
        elements: [
          {
            type: "line",
            shape: {
              x1: GRID_LEFT,
              y1: 0,
              x2: GRID_LEFT,
              y2: meta.length * ROW_H,
            },
            style: { stroke: muted, lineWidth: 1.5, opacity: 0.6 },
          },
        ],
      },
      series: [
        {
          type: "custom",
          name: "pity",
          clip: false,
          data: meta.map((m) => ({
            value: m.kind === "header" ? 0 : m.row!.count,
            tooltip: { show: m.kind !== "header" },
          })),
          encode: { x: 0, y: 1 },
          renderItem: (params: any, api: any) => {
            const m = meta[params.dataIndex];
            if (!m) return null;
            const bandTop = api.coord([0, params.dataIndex])[1] as number;
            const centerY = bandTop + ROW_H / 2;

            if (m.kind === "header") {
              const name = m.section.poolName;
              const lineY = bandTop + ROW_H / 2;
              const nameX = GRID_LEFT + 24;
              const maxTextW = api.getWidth() - GRID_LEFT - GRID_RIGHT - 24;
              const nameW = Math.min(measureTextWidth(name, HEADER_FONT), maxTextW);
              return {
                type: "group",
                children: [
                  {
                    type: "rect",
                    shape: { x: 0, y: bandTop, width: api.getWidth(), height: ROW_H },
                    style: { fill: "rgba(127, 127, 140, 0.07)" },
                  },
                  {
                    type: "rect",
                    shape: { x: 0, y: lineY - 0.5, width: Math.max(nameX - 10, 0), height: 1 },
                    style: { fill: muted, opacity: 0.5 },
                  },
                  {
                    type: "rect",
                    shape: {
                      x: nameX + nameW + 10,
                      y: lineY - 0.5,
                      width: Math.max(api.getWidth() - (nameX + nameW + 10), 0),
                      height: 1,
                    },
                    style: { fill: muted, opacity: 0.5 },
                  },
                  {
                    type: "text",
                    style: {
                      text: name,
                      x: nameX,
                      y: lineY,
                      fill: headerColor,
                      font: HEADER_FONT,
                      maxWidth: maxTextW,
                      overflow: "truncate",
                      textVerticalAlign: "middle",
                      textAlign: "left",
                    },
                  },
                ],
              };
            }

            const row = m.row!;
            const x0 = api.coord([0, params.dataIndex])[0] as number;
            const x1 = api.coord([row.count, params.dataIndex])[0] as number;
            const barH = ROW_H - BAR_GAP * 2;
            const barY = bandTop + BAR_GAP;
            const isSix = row.kind === "six";
            const children: any[] = [];

            // 头像（仅六星行）
            if (isSix && row.id) {
              const img = avatarImgs[row.id];
              const ax = GRID_LEFT - 12 - AVATAR_SIZE;
              const ay = centerY - AVATAR_SIZE / 2;
              if (img) {
                children.push({
                  type: "image",
                  style: { image: img, x: ax, y: ay, width: AVATAR_SIZE, height: AVATAR_SIZE },
                });
              } else {
                children.push({
                  type: "circle",
                  shape: { cx: ax + AVATAR_SIZE / 2, cy: centerY, r: AVATAR_SIZE / 2 },
                  style: { fill: "rgba(127, 127, 140, 0.15)", stroke: separator, lineWidth: 1 },
                });
                const initial = (row.name ?? "?").slice(0, 1);
                children.push({
                  type: "text",
                  style: {
                    text: initial,
                    x: ax + AVATAR_SIZE / 2,
                    y: centerY,
                    fill: muted,
                    font: "600 14px system-ui, sans-serif",
                    textVerticalAlign: "middle",
                    textAlign: "center",
                  },
                });
              }
            }

            // 柱体
            children.push({
              type: "rect",
              shape: {
                x: x0 + BAR_START_GAP,
                y: barY,
                width: Math.max(x1 - x0 - BAR_START_GAP, 2),
                height: barH,
                r: [0, 10, 10, 0],
              },
              style: {
                fill: isSix
                  ? new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                      { offset: 0, color: hexWithAlpha(primary, 0.75) },
                      { offset: 1, color: hexWithAlpha(primary, 0.25) },
                    ])
                  : new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                      { offset: 0, color: hexWithAlpha(defaultColor, 0.55) },
                      { offset: 1, color: hexWithAlpha(defaultColor, 0.18) },
                    ]),
                stroke: isSix ? hexWithAlpha(primary, 0.9) : hexWithAlpha(defaultColor, 0.5),
                lineWidth: 1,
              },
            });

            // 计数标签
            children.push({
              type: "text",
              style: {
                text: `${row.count}`,
                x: x1 + 8,
                y: centerY,
                fill: isSix ? primary : muted,
                font: "600 12px system-ui, sans-serif",
                textVerticalAlign: "middle",
                textAlign: "left",
              },
            });

            // 赠送十连六星标记
            if (isSix && row.inGift) {
              children.push({
                type: "text",
                style: {
                  text: "赠",
                  x: x0 + BAR_START_GAP - 6,
                  y: centerY,
                  fill: danger,
                  font: "600 10px system-ui, sans-serif",
                  textVerticalAlign: "middle",
                  textAlign: "right",
                },
              });
            }

            return { type: "group", children };
          },
        },
      ],
    };

    chart.setOption(option, true);
  }, [meta, avatarImgs, themeTick, isZh]);

  if (sections.length === 0) {
    return (
      <GlassCard className="p-6 glass-surface border border-separator/90">
        <ChartHeader isZh={isZh} sixCount={0} poolOptions={poolOptions} poolFilter={poolFilter} onPoolChange={setPoolFilter} />
        <p className="text-sm text-muted py-8 text-center">
          {poolFilter
            ? isZh
              ? "该卡池暂无六星记录"
              : "No 6★ records in this pool"
            : isZh
              ? "该分类暂无六星记录"
              : "No 6★ records in this category"}
        </p>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="p-6 glass-surface border border-separator/90">
      <ChartHeader isZh={isZh} sixCount={sixCount} poolOptions={poolOptions} poolFilter={poolFilter} onPoolChange={setPoolFilter} />
      <div className="overflow-x-auto pb-3">
        <div
          ref={chartRef}
          className="w-full"
          style={{ height: `${meta.length * ROW_H + CHART_BOTTOM_PAD}px`, minWidth: 480 }}
        />
      </div>
    </GlassCard>
  );
}

function ChartHeader({
  isZh,
  sixCount,
  poolOptions,
  poolFilter,
  onPoolChange,
}: {
  isZh: boolean;
  sixCount: number;
  poolOptions: { poolId: string; poolName: string }[];
  poolFilter: string | null;
  onPoolChange: (poolId: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
      <h2 className="text-sm font-semibold text-muted">
        {isZh ? "寻访统计" : "Gacha Stats"}
      </h2>
      <div className="flex flex-wrap items-center gap-3">
        <GlassSelect
          value={poolFilter}
          options={[
            { value: "", label: isZh ? "全部卡池" : "All Pools" },
            ...poolOptions.map((p) => ({ value: p.poolId, label: p.poolName })),
          ]}
          onChange={(v) => onPoolChange(v || null)}
          className="max-w-64"
        />
        <div className="flex items-center gap-3 text-[11px] text-muted tabular-nums">
          <span className="flex items-center gap-1.5">
            <i className="w-2.5 h-2.5 rounded-sm bg-primary/70 inline-block" />
            {isZh ? "六星" : "6★"}
          </span>
          <span className="flex items-center gap-1.5">
            <i className="w-2.5 h-2.5 rounded-sm bg-default-400/60 inline-block" />
            {isZh ? "未出六星" : "No 6★"}
          </span>
          <span>
            {isZh ? `共 ${sixCount} 个六星` : `${sixCount} total 6★`}
          </span>
        </div>
      </div>
    </div>
  );
}

function hexWithAlpha(hex: string, alpha: number): string {
  const h = hex.trim().replace(/^#/, "");
  if (h.length === 3) {
    const r = h[0] + h[0];
    const g = h[1] + h[1];
    const b = h[2] + h[2];
    return `rgba(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)}, ${alpha})`;
  }
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return hex;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTime(ts: string, isZh: boolean): string {
  return new Date(Number(ts)).toLocaleString(isZh ? "zh-CN" : "en-US");
}