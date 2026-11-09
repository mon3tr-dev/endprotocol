import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { LineChart, PieChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";
import { GlassCard } from "@/components/ui/glass";
import type { GachaCategory, GachaPoolKind, GachaRecord } from "@/types/gacha";
import { calculateGachaSixStarIntervals, type GachaSixStarInterval } from "@/utils/gachaIntervals";

echarts.use([
  LineChart,
  PieChart,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
  CanvasRenderer,
]);

/** 六星期望抽数：武器 25 抽/个，角色 35.5 抽/个 */
const SIX_STAR_EXPECTATION = 35.5;
const WEAPON_SIX_STAR_EXPECTATION = 25;

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * 坐标轴刻度间隔：压缩间隔以塞进尽可能多的刻度，最多 11 个（含首尾）。
 * ECharts 刻度从 min 起步进 k，且当 max 非 k 整数倍时会额外补一个 max 刻度，
 * 故按 span/10 取 ceil（而非 /11）才能保证 ≤ 11 个。
 */
function tickIntervalFor(min: number, max: number): number {
  return Math.max(1, Math.ceil((max - min) / 10));
}

/** 初始化并管理一个 echarts 实例：主题变化时重建，卸载时销毁 */
function useEchart(ref: React.RefObject<HTMLDivElement | null>) {
  const [themeTick, setThemeTick] = useState(0);
  useEffect(() => {
    const handler = () => setThemeTick((t) => t + 1);
    window.addEventListener("themeChange", handler);
    return () => window.removeEventListener("themeChange", handler);
  }, []);

  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chartRef.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, themeTick]);

  const setOption = useCallback((option: EChartsOption) => {
    const chart = chartRef.current;
    if (chart) chart.setOption(option, true);
  }, []);

  // 返回值必须是稳定引用：它进了三个图表的 useEffect 依赖数组，若每次渲染都返回新对象，
  // 任何一次重渲染都会重新执行 notMerge 的 setOption，把整张图的入场动画从头重播一遍
  // （标线反复从 0 生长 = 肉眼看到的闪烁）。themeTick 留在依赖里，保证主题切换
  // 重建实例后调用方会重新下发 option。
  return useMemo(() => ({ setOption, themeTick }), [setOption, themeTick]);
}

/** 按时间从旧到新排列当前分类的全部抽卡记录 */
function useChronoRecords(
  records: GachaRecord[],
  pools: Record<string, { poolType?: string }>,
  category: GachaCategory,
): GachaRecord[] {
  return useMemo(() => {
    const list = records.filter((r) => {
      if (r.kind !== "draw") return false;
      if (category === "weapon" || category === "all") return true;
      return poolKindOf(r, pools) === category;
    });
    list.sort((a, b) => Number(a.gachaTs) - Number(b.gachaTs));
    return list;
  }, [records, pools, category]);
}

/** 记录所属卡池类型：优先用 pools 元信息，缺失时按 poolId 前缀推断 */
function poolKindOf(rec: GachaRecord, pools: Record<string, { poolType?: string }>): GachaPoolKind {
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

/** 星级分布：各稀有度数量与占比 */
function useStarDistribution(chrono: GachaRecord[]) {
  return useMemo(() => {
    const counts = new Map<number, number>();
    for (const r of chrono) {
      const rarity = r.rarity ?? 0;
      counts.set(rarity, (counts.get(rarity) ?? 0) + 1);
    }
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    const sorted = [...counts.entries()].sort((a, b) => b[0] - a[0]);
    return { total, series: sorted };
  }, [chrono]);
}

/** HTML-escape server-provided pool names before interpolating them into ECharts tooltips. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]!);
}

/** 六星间隔累积曲线：x=间隔抽数（升序），y=间隔≤x 的六星个数 */
function useCumulativeSix(intervals: GachaSixStarInterval[]) {
  return useMemo(() => {
    const sorted = intervals.map(({ count }) => count).sort((a, b) => a - b);
    const points: [number, number][] = [[0, 0]];
    sorted.forEach((n, i) => points.push([n, i + 1]));
    return {
      points,
      total: sorted.length,
      maxInterval: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
    };
  }, [intervals]);
}

/**
 * 稀有度配色：浅色/深色主题各一套。
 * 金色 #ffd700 在白卡上只有 1.4:1，画在饼图/图例里同样读不清，
 * 因此浅色档用同色相的深色版本（对比度见注释），深色档保留亮色。
 */
const RARITY_COLORS: Record<number, string> = {
  6: "#ef4444",
  5: "#a16207",
  4: "#6d28d9",
  3: "#94a3b8",
};
const RARITY_COLORS_DARK: Record<number, string> = {
  6: "#ef4444",
  5: "#ffd700",
  4: "#a855f7",
  3: "#94a3b8",
};

export default function GachaStatCharts({
  records,
  pools,
  category,
  isWeapon,
  isZh,
}: {
  records: GachaRecord[];
  pools: Record<string, { poolType?: string; poolName?: string }>;
  category: GachaCategory;
  isWeapon: boolean;
  isZh: boolean;
}) {
  const expectation = isWeapon ? WEAPON_SIX_STAR_EXPECTATION : SIX_STAR_EXPECTATION;
  const chrono = useChronoRecords(records, pools, category);
  const starDist = useStarDistribution(chrono);
  const intervals = useMemo(
    () => calculateGachaSixStarIntervals(chrono, pools),
    [chrono, pools],
  );
  const cumulative = useCumulativeSix(intervals);

  const pieRef = useRef<HTMLDivElement>(null);
  const histRef = useRef<HTMLDivElement>(null);
  const cumRef = useRef<HTMLDivElement>(null);

  // 主题切换时父组件不会重渲染（只有 useEchart 内部重建实例），
  // 因此这里必须自己订阅 themeChange，否则文字色会停留在旧主题的取值上
  // ——深色主题下坐标轴字用浅色底算出的 #4a4a52，几乎看不见。
  const [themeTick, setThemeTick] = useState(0);
  useEffect(() => {
    const handler = () => setThemeTick((t) => t + 1);
    window.addEventListener("themeChange", handler);
    return () => window.removeEventListener("themeChange", handler);
  }, []);

  const primary = useMemo(() => cssVar("--primary", "#6366f1"), [themeTick]);
  const muted = useMemo(() => cssVar("--muted", "#71717a"), [themeTick]);
  const separator = useMemo(() => cssVar("--separator", "#e4e4e7"), [themeTick]);
  // 稀有度取色同样依赖主题（浅色档/深色档两套），一并跟随 themeTick 重算
  const rarityPalette = useMemo(() => {
    const isDark = document.documentElement.classList.contains("dark");
    return isDark ? RARITY_COLORS_DARK : RARITY_COLORS;
  }, [themeTick]);
  const lineColors = [primary, "#14b8a6", "#f97316", "#ec4899", "#0ea5e9", "#a855f7", "#84cc16"];
  const poolsById = useMemo(() => {
    const grouped = new Map<string, GachaSixStarInterval[]>();
    for (const interval of intervals) {
      const poolIntervals = grouped.get(interval.poolId) ?? [];
      poolIntervals.push(interval);
      grouped.set(interval.poolId, poolIntervals);
    }
    return grouped;
  }, [intervals]);
  const poolColors = useMemo(
    () => new Map(
      [...poolsById.keys()].map((poolId, index) => [
        poolId,
        lineColors[index % lineColors.length],
      ]),
    ),
    [poolsById, primary],
  );

  const pie = useEchart(pieRef);
  const hist = useEchart(histRef);
  const cum = useEchart(cumRef);

  const baseText = { color: muted, fontSize: 11 };

  useEffect(() => {
    const pieOption: EChartsOption = {
      color: starDist.series.map(([r]) => rarityPalette[r] ?? rarityPalette[3]),
      tooltip: {
        trigger: "item",
        backgroundColor: "transparent",
        borderColor: "transparent",
        className: "lg-regular rounded-xl",
        extraCssText: "border:1px solid var(--separator);border-radius:12px;",
        padding: [8, 12],
        textStyle: { color: "var(--foreground)", fontSize: 12 },
        formatter: (p: any) => {
          const item = p.data as { name: string; value: number; percent: number };
          return `<div style="font-weight:600">${item.name}</div><div>${item.value} (${item.percent}%)</div>`;
        },
      },
      legend: {
        bottom: 0,
        textStyle: baseText,
        itemWidth: 10,
        itemHeight: 10,
        data: starDist.series.map(([r]) => `${r}★`),
      },
      series: [
        {
          type: "pie",
          radius: ["45%", "72%"],
          center: ["50%", "44%"],
          avoidLabelOverlap: true,
          label: {
            show: true,
            formatter: "{c} ({d}%)",
            color: "var(--foreground)",
            fontSize: 11,
          },
          labelLine: { show: true, length: 8, length2: 6 },
          emphasis: {
            label: { show: true, fontWeight: 700, color: "var(--foreground)" },
          },
          data: starDist.series.map(([r, c]) => ({
            name: `${r}★`,
            value: c,
            percent: starDist.total > 0 ? Math.round((c / starDist.total) * 1000) / 10 : 0,
          })),
        },
      ],
    };
    pie.setOption(pieOption);
  }, [pie, starDist, rarityPalette]);

  useEffect(() => {
    const expLabel = `${isZh ? "期望" : "Expected"} ${expectation}${isZh ? " 抽" : ""}`;
    const maxY = Math.max(expectation, ...intervals.map(({ count }) => count), 1);
    const maxIndex = Math.max(1, intervals.length);
    const histOption: EChartsOption = {
      grid: { left: 8, right: 20, top: 30, bottom: 40, containLabel: true },
      tooltip: {
        trigger: "item",
        backgroundColor: "transparent",
        borderColor: "transparent",
        className: "lg-regular rounded-xl",
        extraCssText: "border:1px solid var(--separator);border-radius:12px;",
        padding: [8, 12],
        textStyle: { color: "var(--foreground)", fontSize: 12 },
        axisPointer: { type: "line" },
        formatter: (params: any) => {
          const interval = intervals[params.dataIndex];
          if (!interval) return "";
          return `<div style="font-weight:600">${escapeHtml(interval.poolName)}</div><div>${isZh ? `第 ${interval.sixStarIndex} 个六星` : `Pool 6★ #${interval.sixStarIndex}`}</div><div>${isZh ? `间隔 ${interval.count} 抽` : `${interval.count} pulls`}</div>`;
        },
      },
      xAxis: {
        type: "value",
        min: 1,
        max: maxIndex,
        interval: tickIntervalFor(1, maxIndex),
        minInterval: 1,
        splitLine: { show: false },
        axisLabel: { color: muted, fontSize: 10 },
        name: isZh ? "六星事件序号" : "6★ event #",
        nameTextStyle: { color: muted, fontSize: 10 },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: maxY + 4,
        minInterval: 1,
        splitLine: { lineStyle: { color: separator, opacity: 0.5 } },
        axisLabel: { color: muted, fontSize: 10 },
        name: isZh ? "间隔抽数" : "pulls",
        nameTextStyle: { color: muted, fontSize: 10 },
      },
      series: [
        {
          name: isZh ? "六星间隔" : "6★ interval",
          type: "line",
          data: intervals.map((interval, index) => ({
            value: [index + 1, interval.count],
            itemStyle: { color: poolColors.get(interval.poolId) ?? primary },
          })),
          showSymbol: true,
          symbolSize: 7,
          smooth: true,
          lineStyle: { color: primary, width: 2 },
          markLine: {
            symbol: "none",
            silent: true,
            // 标线保留入场生长动画（shape.percent 0→1）；文字不能挂在它的 label 上：
            // Line#beforeUpdate 每帧按生长比例把 label 重定位到"当前生长端"（水平线表现为
            // 文字沿线滑动；垂直于 x 轴的标线还会因 toPos[0] < fromPos[0] 的浮点噪声
            // 把 rotation 额外加 π，文字在中心对称的两处之间逐帧跳变 = 闪烁 + 一份更浅的
            // 镜像副本，apache/echarts#20834，v6.1.0 未修）。文字改由静止的 markPoint 承载。
            label: { show: false },
            lineStyle: { color: "#ef4444", type: "dashed", width: 1 },
            data: [{ yAxis: expectation }],
          },
          markPoint: {
            silent: true,
            animation: false,
            symbol: "circle",
            symbolSize: 1,
            itemStyle: { color: "transparent" },
            label: {
              formatter: expLabel,
              color: "#ef4444",
              fontSize: 10,
              position: "top",
              distance: 4,
              align: "right",
              offset: [-5, -2],
            },
            data: [{ name: "expectation", coord: [maxIndex, expectation] }],
          },
        },
      ],
    };
    hist.setOption(histOption);
  }, [hist, intervals, poolsById, poolColors, expectation, primary, muted, separator, isZh]);

  useEffect(() => {
    const maxX = Math.max(1, cumulative.maxInterval);
    const maxY = Math.max(1, cumulative.total);
    const expLabel = `${isZh ? "期望" : "Expected"} ${expectation}${isZh ? " 抽" : " pulls"}`;
    const cumOption: EChartsOption = {
      grid: { left: 8, right: 24, top: 30, bottom: 24, containLabel: true },
      tooltip: {
        trigger: "axis",
        backgroundColor: "transparent",
        borderColor: "transparent",
        className: "lg-regular rounded-xl",
        extraCssText: "border:1px solid var(--separator);border-radius:12px;",
        padding: [8, 12],
        textStyle: { color: "var(--foreground)", fontSize: 12 },
        axisPointer: { type: "line" },
        formatter: (params: any) => {
          const p = params[0];
          return `<div style="font-weight:600">${isZh ? `${p.axisValue} 抽内` : `Within ${p.axisValue} pulls`}</div><div>${isZh ? "六星" : "6★"}: ${p.value}</div>`;
        },
      },
      xAxis: {
        type: "value",
        min: 0,
        max: maxX,
        minInterval: 1,
        splitLine: { lineStyle: { color: separator, opacity: 0.4 } },
        axisLabel: { color: muted, fontSize: 10 },
        name: isZh ? "六星间隔（抽）" : "6★ interval (pulls)",
        nameTextStyle: { color: muted, fontSize: 10 },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: maxY,
        interval: tickIntervalFor(0, maxY),
        minInterval: 1,
        splitLine: { lineStyle: { color: separator, opacity: 0.5 } },
        axisLabel: { color: muted, fontSize: 10 },
        name: isZh ? "累计六星" : "Cumulative 6★",
        nameTextStyle: { color: muted, fontSize: 10 },
      },
      series: [
        {
          name: isZh ? "累计六星" : "Cumulative 6★",
          type: "line",
          data: cumulative.points,
          showSymbol: false,
          step: "end",
          lineStyle: { color: primary, width: 2 },
          itemStyle: { color: primary },
          areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: primary + "40" }, { offset: 1, color: primary + "05" }]) },
          markLine: {
            symbol: "none",
            silent: true,
            // 同上一张图：标线保留生长动画，文字改由静止的 markPoint 承载，
            // 否则 label 会被 Line#beforeUpdate 逐帧拖到生长端并在浮点噪声下翻转。
            label: { show: false },
            lineStyle: { color: "#ef4444", type: "dashed", width: 1 },
            data: [{ xAxis: expectation }],
          },
          markPoint: {
            silent: true,
            animation: false,
            symbol: "circle",
            symbolSize: 1,
            itemStyle: { color: "transparent" },
            label: {
              formatter: expLabel,
              color: "#ef4444",
              fontSize: 10,
              position: "top",
              distance: 4,
            },
            data: [{ name: "expectation", coord: [expectation, maxY] }],
          },
        },
      ],
    };
    cum.setOption(cumOption);
  }, [cum, cumulative, expectation, primary, muted, separator, isZh]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <GlassCard className="p-4  border border-separator/90">
        <h3 className="text-sm font-semibold text-muted mb-2">
          {isZh ? "星级分布" : "Rarity Distribution"}
        </h3>
        <div ref={pieRef} style={{ height: 220 }} />
      </GlassCard>
      <GlassCard className="p-4  border border-separator/90">
        <h3 className="text-sm font-semibold text-muted mb-2">
          {isZh ? `各卡池六星间隔（期望 ${expectation} 抽）` : `6★ Intervals by Pool (expected ${expectation})`}
        </h3>
        <div className="relative">
          <div ref={histRef} style={{ height: 190 }} />
          <div className="flex h-[26px] items-center gap-x-3 overflow-x-auto text-[9px] text-muted">
            {[...poolsById.entries()].map(([poolId, poolIntervals]) => (
              <span key={poolId} className="inline-flex shrink-0 items-center gap-1">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: poolColors.get(poolId) ?? primary }}
                />
                {poolIntervals[0].poolName}
              </span>
            ))}
          </div>
          {intervals.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-muted">
              {isZh ? "暂无六星记录" : "No 6★ yet"}
            </div>
          )}
        </div>
      </GlassCard>
      <GlassCard className="p-4  border border-separator/90">
        <h3 className="text-sm font-semibold text-muted mb-2">
          {isZh ? "六星累计（按间隔）" : "Cumulative 6★ (by interval)"}
        </h3>
        <div className="relative">
          <div ref={cumRef} style={{ height: 220 }} />
          {intervals.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-muted">
              {isZh ? "暂无六星记录" : "No 6★ yet"}
            </div>
          )}
        </div>
      </GlassCard>
    </div>
  );
}