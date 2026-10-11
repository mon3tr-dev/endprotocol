// 单指标整页视图：一次只显示一个指标（大号数值 + 占据整卡高度的历史折线图）。
//
// 折线图为「任务管理器」风格：
// - 横轴固定为 historyWindowSec 的时间跨度，最新采样在最左（x=0），旧数据向右排列，
//   移出右边界后不再显示；采样不足时右侧留空。
// - 纵轴放到最大：百分比指标固定 0–100（图表顶部 = 100%），其余 0 → 窗口内最大值。
// - 折线下方整块区域用颜色填充。

import { useTranslation } from "react-i18next";
import type {
  ResourceMetricConfig,
  SystemResourceCardSettings,
} from "@/types/system-resource";
import { METRIC_CATALOG } from "@/types/system-resource";
import type { ResolvedMetric } from "./metrics";
import { formatAxisValue, formatMetricValue, toneColor } from "./metrics";

export interface MetricHistoryStats {
  peak: number | null;
  average: number | null;
}

interface MetricViewProps {
  config: ResourceMetricConfig;
  resolved: ResolvedMetric;
  settings: SystemResourceCardSettings;
  /** 历史采样：索引 0 为最新 */
  history?: number[];
  /** 时间窗口对应的采样点总数（横轴固定跨度） */
  capacity?: number;
  accent: string;
}

export function metricLabel(config: ResourceMetricConfig): string {
  const definition = METRIC_CATALOG[config.id];
  return definition ? definition.labelKey : config.id;
}

export function MetricView({
  config,
  resolved,
  settings,
  history,
  capacity,
  accent,
}: MetricViewProps) {
  const { t } = useTranslation();
  const color = toneColor(resolved.tone, config.color || accent);
  const label = t(`card:${metricLabel(config)}`);
  const valueText = resolved.available
    ? `${resolved.text}${resolved.unit ? ` ${resolved.unit}` : ""}`
    : t("card:system_resource_unavailable");

  const stats = settings.showPeakAvg ? historyStats(history) : null;

  return (
    <div className="h-full min-h-0 flex flex-col gap-1">
      {/* 顶部：指标名 + 大号数值 */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 shrink-0">
        {settings.showLabels && (
          <span className="flex items-center gap-1.5 min-w-0">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: color }}
              aria-hidden
            />
            <span className="text-xs text-muted whitespace-nowrap">{label}</span>
          </span>
        )}
        <span
          className={`font-semibold tabular-nums whitespace-nowrap text-xl leading-none ${toneClass(
            resolved.tone,
          )}`}
        >
          {valueText}
        </span>
      </div>

      {stats && stats.peak != null && stats.average != null && (
        <div className="flex flex-wrap items-center gap-x-3 text-[10px] text-muted shrink-0">
          <span className="whitespace-nowrap">
            {t("card:system_resource_peak")}:{" "}
            {formatMetricValue(stats.peak, config)}
          </span>
          <span className="whitespace-nowrap">
            {t("card:system_resource_average")}:{" "}
            {formatMetricValue(stats.average, config)}
          </span>
        </div>
      )}

      <HistoryChart
        history={history}
        color={color}
        capacity={capacity}
        percentual={METRIC_CATALOG[config.id]?.percentual ?? false}
        available={resolved.available}
        formatValue={(value) => formatAxisValue(value, config)}
        nowLabel={t("card:system_resource_axis_now")}
        windowLabel={t("card:system_resource_axis_window", {
          s: settings.historyWindowSec,
        })}
        emptyLabel={t("card:system_resource_unavailable")}
      />
    </div>
  );
}

interface HistoryChartProps {
  history?: number[];
  color: string;
  capacity?: number;
  percentual: boolean;
  available: boolean;
  formatValue: (value: number) => string;
  nowLabel: string;
  windowLabel: string;
  emptyLabel: string;
}

/**
 * 占满剩余高度的历史折线图。
 * 纵轴放到最大：百分比指标 0–100（顶部 = 100%），其余 0 → 窗口最大值。
 */
export function HistoryChart({
  history,
  color,
  capacity,
  percentual,
  available,
  formatValue,
  nowLabel,
  windowLabel,
  emptyLabel,
}: HistoryChartProps) {
  const total = Math.max(2, capacity ?? history?.length ?? 2);
  const samples = available && history ? history.slice(0, total) : [];
  const hasLine = samples.length >= 2;

  const max = samples.length > 0 ? Math.max(...samples) : 0;
  // 纵轴上限：百分比固定 100，其余取窗口内最大值（含少量余量）
  const hi = percentual ? 100 : Math.max(max * 1.05, 1e-6);
  const lo = 0;
  const range = hi - lo || 1;

  // 映射到 1–99，避免描边被裁切
  const toY = (value: number) => {
    const clamped = Math.max(lo, Math.min(hi, value));
    return 1 + (1 - (clamped - lo) / range) * 98;
  };

  const coords = samples.map((value, index) => ({
    x: (index / (total - 1)) * 100,
    y: toY(value),
  }));
  const line = coords.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  const area =
    coords.length >= 2
      ? `${coords[0].x.toFixed(2)},100 ${line} ${coords[coords.length - 1].x.toFixed(2)},100`
      : "";

  return (
    <div className="flex-1 min-h-0 flex gap-1.5">
      {/* 纵轴刻度 */}
      <div
        className="flex flex-col justify-between shrink-0 text-[9px] leading-none text-muted/80 tabular-nums text-right"
        aria-hidden
      >
        <span className="whitespace-nowrap">{hasLine ? formatValue(hi) : emptyLabel}</span>
        <span className="whitespace-nowrap">{hasLine ? formatValue((hi + lo) / 2) : ""}</span>
        <span className="whitespace-nowrap">{hasLine ? formatValue(lo) : ""}</span>
      </div>

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="relative flex-1 min-h-0">
          <svg
            className="absolute inset-0 w-full h-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden
          >
            {/* 网格线 + 左轴 */}
            <g
              stroke="currentColor"
              strokeWidth={1}
              opacity={0.25}
              vectorEffect="non-scaling-stroke"
            >
              <line x1="0" y1="1" x2="100" y2="1" vectorEffect="non-scaling-stroke" />
              <line x1="0" y1="50" x2="100" y2="50" vectorEffect="non-scaling-stroke" />
              <line x1="0" y1="99" x2="100" y2="99" vectorEffect="non-scaling-stroke" />
              <line
                x1="0.5"
                y1="0"
                x2="0.5"
                y2="100"
                strokeWidth={1.2}
                vectorEffect="non-scaling-stroke"
              />
            </g>

            {hasLine ? (
              <>
                {/* 线下方整体填充 */}
                <polygon points={area} fill={color} opacity={0.35} />
                <polyline
                  points={line}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </>
            ) : (
              <line
                x1="1"
                y1="50"
                x2="100"
                y2="50"
                stroke={color}
                strokeWidth={1}
                strokeDasharray="3 3"
                opacity={0.5}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
        </div>

        {/* 横轴刻度：左=现在，右=窗口起点 */}
        <div
          className="flex justify-between text-[9px] leading-none text-muted/80 mt-0.5 shrink-0"
          aria-hidden
        >
          <span className="whitespace-nowrap">{nowLabel}</span>
          <span className="whitespace-nowrap">{windowLabel}</span>
        </div>
      </div>
    </div>
  );
}

export function historyStats(history?: number[]): MetricHistoryStats {
  if (!history || history.length === 0) return { peak: null, average: null };
  const peak = Math.max(...history);
  const average = history.reduce((sum, v) => sum + v, 0) / history.length;
  return { peak, average };
}

function toneClass(tone: ResolvedMetric["tone"]): string {
  if (tone === "critical") return "text-danger";
  if (tone === "warn") return "text-warning";
  return "text-foreground";
}
