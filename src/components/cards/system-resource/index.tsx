import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { GlassCard } from "@/components/ui/glass";
import { CardConfigService } from "@/utils/cardConfigService";
import { logError } from "@/utils/logger";
import {
  SystemResourceService,
  getSystemResourceDefaults,
} from "@/utils/systemResourceService";
import type { BaseCardProps } from "../registry/types";
import type {
  ResourceMetricConfig,
  SystemResourceCardSettings,
  SystemResourceSizeTier,
  SystemSnapshot,
} from "@/types/system-resource";
import {
  DEFAULT_SYSTEM_RESOURCE_DEFAULTS,
  METRIC_CATALOG,
  buildDefaultCardSettings,
  createMetricConfig,
  sizeTier,
} from "@/types/system-resource";
import { MetricView, metricLabel } from "./metric-view";
import { resolveMetric } from "./metrics";
import { SystemResourceSettingsModal } from "./settings-modal";
import { MorphIcon } from "morphicons/react";
import { ChevronLeft, ChevronRight } from "lucide";

const DEFAULT_VISIBLE_METRICS: ResourceMetricConfig["id"][] = [
  "cpu_usage",
  "gpu_usage",
  "memory_percent",
];

/** 当前卡片配置结构版本 */
const SETTINGS_VERSION = 5;

/** 已移除的指标（核心数 / 显存占比 / 缓存） */
const REMOVED_METRICS = new Set(["cpu_cores", "gpu_memory_percent", "memory_cached"]);

/**
 * 一次性迁移旧卡片配置：
 * - v1 → v2：默认开启历史曲线、曲线窗口至少 120s；
 * - v2 → v3：过滤已删除的指标；
 * - v3 → v4：小卡仅保留 1 个指标、写入默认自动翻页间隔；
 * - v4 → v5：中/大卡不再按卡片尺寸裁剪指标。
 * 仅在旧版本配置上执行（写入 settingsVersion 后不再触发）。
 */
function migrateSettings(
  stored: SystemResourceCardSettings,
  tier: SystemResourceSizeTier,
): SystemResourceCardSettings {
  const version = stored.settingsVersion ?? 1;
  if (version >= SETTINGS_VERSION) {
    return stored;
  }

  let metrics = (stored.metrics ?? []).filter(
    (m) => !REMOVED_METRICS.has(m.id) && METRIC_CATALOG[m.id],
  );
  if (metrics.length === 0) {
    metrics = [createMetricConfig("cpu_usage")];
  }
  if (tier === "small") metrics = metrics.slice(0, 1);

  return {
    ...stored,
    showSparklines: true,
    rotateMs: stored.rotateMs ?? DEFAULT_SYSTEM_RESOURCE_DEFAULTS.rotateMs,
    historyWindowSec:
      stored.historyWindowSec && stored.historyWindowSec >= 120
        ? stored.historyWindowSec
        : 120,
    metrics,
    settingsVersion: SETTINGS_VERSION,
  };
}

export default function SystemResourceCard({
  cardId,
  settings,
  w,
  h,
}: BaseCardProps) {
  const { t } = useTranslation();
  const [cardSettings, setCardSettings] = useState<SystemResourceCardSettings | null>(
    null,
  );
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [liveSnapshot, setLiveSnapshot] = useState<SystemSnapshot | null>(null);
  const [collectionError, setCollectionError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  /** 手动翻页时自增，用于重置自动翻页计时 */
  const [navNonce, setNavNonce] = useState(0);
  const historyRef = useRef<Record<string, number[]>>({});
  const cardSize = { w: w ?? 3, h: h ?? 2 };

  // 初始化：优先读取已保存的卡片配置，否则用全局默认值 + 默认模板生成
  useEffect(() => {
    let active = true;
    const init = async () => {
      const defaults = await getSystemResourceDefaults();
      const stored = await CardConfigService.getCardSettings<
        Partial<SystemResourceCardSettings>
      >(cardId);
      const incoming = settings as Partial<SystemResourceCardSettings> | undefined;
      const width = w ?? 3;
      const height = h ?? 2;

      if (stored && stored.metrics && stored.metrics.length > 0) {
        const migrated = migrateSettings(
          stored as SystemResourceCardSettings,
          sizeTier(width, height),
        );
        if (active) setCardSettings(migrated);
        if (migrated !== stored) {
          await CardConfigService.saveCardSettings(cardId, migrated);
        }
        return;
      }
      if (incoming && incoming.metrics && incoming.metrics.length > 0) {
        if (active) setCardSettings(incoming as SystemResourceCardSettings);
        await CardConfigService.saveCardSettings(cardId, incoming);
        return;
      }
      // 首次使用：用全局默认模板（小卡只取第一个指标）
      const metricIds =
        defaults.template && defaults.template.length > 0
          ? defaults.template
          : DEFAULT_VISIBLE_METRICS;
      const tier = sizeTier(width, height);
      const selectedMetrics =
        tier === "small" ? metricIds.slice(0, 1) : metricIds;
      const built = buildDefaultCardSettings(
        selectedMetrics.length > 1 ? "group" : "atomic",
        selectedMetrics,
        defaults,
      );
      if (active) setCardSettings(built);
      await CardConfigService.saveCardSettings(cardId, built);
    };
    void init();
    return () => {
      active = false;
    };
  }, [cardId, settings, w, h]);

  const refreshMs = cardSettings?.refreshMs ?? DEFAULT_SYSTEM_RESOURCE_DEFAULTS.refreshMs;

  // 高频轮询
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const result = await SystemResourceService.getSnapshot();
      if (cancelled) return;
      setLoadedOnce(true);
      if (result.ok && result.data) {
        setLiveSnapshot(result.data);
        setCollectionError(null);
      } else {
        setCollectionError(result.error ?? "snapshot_failed");
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), Math.max(500, refreshMs));
    const onManualRefresh = () => void tick();
    window.addEventListener("manualRefresh", onManualRefresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("manualRefresh", onManualRefresh);
    };
  }, [refreshMs]);

  const current = liveSnapshot;

  // 时间窗口对应的采样点总数（横轴固定跨度）
  const historyCapacity = Math.max(
    10,
    Math.min(
      240,
      Math.round(((cardSettings?.historyWindowSec ?? 120) * 1000) / refreshMs),
    ),
  );

  // 记录历史曲线数据（对所有可见指标，翻页时立即可用）
  useEffect(() => {
    if (!cardSettings || !current) return;
    cardSettings.metrics
      .filter((m) => m.visible)
      .forEach((metric) => {
        const resolved = resolveMetric(current, metric, cardSettings);
        if (!resolved.available || resolved.value == null) return;
        const buffer = historyRef.current[metric.id] ?? [];
        // 最新数据放最左（索引 0），旧数据向右移动，超出窗口后从右侧丢弃
        buffer.unshift(resolved.value);
        if (buffer.length > historyCapacity) buffer.length = historyCapacity;
        historyRef.current[metric.id] = buffer;
      });
  }, [current, cardSettings, historyCapacity]);

  // 右键菜单动作
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { cardId: string; action: string }
        | undefined;
      if (detail?.cardId !== cardId) return;
      if (detail.action === "system-resource-settings") {
        setIsSettingsOpen(true);
      }
    };
    window.addEventListener("cardAction", handler);
    return () => window.removeEventListener("cardAction", handler);
  }, [cardId]);

  const handleSaveSettings = useCallback(
    async (next: SystemResourceCardSettings) => {
      setCardSettings(next);
      try {
        await CardConfigService.saveCardSettings(cardId, next);
      } catch (err) {
        logError("Failed to save system resource settings:", err);
      }
    },
    [cardId],
  );

  const accent = cardSettings?.accent || DEFAULT_SYSTEM_RESOURCE_DEFAULTS.accent;

  const pages = useMemo(() => {
    if (!cardSettings) return [];
    return cardSettings.metrics
      .filter((m) => m.visible && METRIC_CATALOG[m.id])
      .map((metric) => ({
        metric,
        resolved: resolveMetric(current, metric, cardSettings),
      }));
  }, [cardSettings, current]);

  const pageCount = pages.length;

  // 页数变化后修正当前页
  useEffect(() => {
    if (pageCount > 0 && pageIndex >= pageCount) setPageIndex(0);
  }, [pageCount, pageIndex]);

  // 自动翻页
  const rotateMs = cardSettings?.rotateMs ?? 0;
  useEffect(() => {
    if (rotateMs <= 0 || pageCount <= 1) return;
    const timer = window.setInterval(() => {
      setPageIndex((index) => (index + 1) % pageCount);
    }, Math.max(1000, rotateMs));
    return () => window.clearInterval(timer);
  }, [rotateMs, pageCount, navNonce]);

  const goToPage = (index: number) => {
    setPageIndex(index);
    setNavNonce((n) => n + 1);
  };

  if (!cardSettings) {
    return (
      <GlassCard className="p-4 glass-surface border border-separator/90 h-full w-full flex items-center justify-center">
        <span className="text-xs text-muted animate-pulse-soft">
          {t("card:system_resource_loading")}
        </span>
      </GlassCard>
    );
  }

  const title = cardSettings.title || t("card:system_resource_title");
  const failed = loadedOnce && !current && !!collectionError;
  const activePage = pages[Math.min(pageIndex, Math.max(0, pageCount - 1))];

  return (
    <>
      <GlassCard className="glass-surface border border-separator/90 h-full w-full select-none rounded-[10px] overflow-hidden flex flex-col">
        {cardSettings.showTitleBar && (
          <div className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-1 shrink-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: accent }}
                aria-hidden
              />
              <span className="text-xs font-semibold text-foreground truncate">
                {title}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-muted hover:text-foreground hover:bg-default-100 transition-colors"
              aria-label={t("card:system_resource_settings")}
              title={t("card:system_resource_settings")}
            >
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
              </svg>
            </button>
          </div>
        )}

        <div className="flex-1 min-h-0 px-3 pb-2 pt-0.5 flex flex-col">
          {!loadedOnce ? (
            <div className="flex-1 flex items-center justify-center">
              <span className="text-xs text-muted animate-pulse-soft">
                {t("card:system_resource_loading")}
              </span>
            </div>
          ) : failed ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-1">
              <span className="text-xs text-muted">
                {t("card:system_resource_collect_failed")}
              </span>
              <span className="text-[10px] text-muted/60">
                {t("card:system_resource_collect_failed_hint")}
              </span>
            </div>
          ) : !activePage ? (
            <div className="flex-1 flex items-center justify-center">
              <span className="text-xs text-muted">
                {t("card:system_resource_no_metrics")}
              </span>
            </div>
          ) : (
            <>
              <div className="flex-1 min-h-0">
                <div
                  key={activePage.metric.id}
                  className="h-full min-h-0 animate-resource-page"
                >
                  <MetricView
                    config={activePage.metric}
                    resolved={activePage.resolved}
                    settings={cardSettings}
                    history={historyRef.current[activePage.metric.id]}
                    capacity={historyCapacity}
                    accent={accent}
                  />
                </div>
              </div>

              {pageCount > 1 && (
                <div className="shrink-0 flex items-center justify-center gap-1 pt-1.5">
                  <NavButton
                    label={t("card:system_resource_prev")}
                    onClick={() =>
                      goToPage((pageIndex - 1 + pageCount) % pageCount)
                    }
                  >
                    <MorphIcon icon={ChevronLeft} size={14} aria-hidden />
                  </NavButton>

                  <div className="flex items-center gap-1 px-0.5">
                    {pages.map((page, index) => (
                      <button
                        key={page.metric.id}
                        type="button"
                        onClick={() => goToPage(index)}
                        aria-label={t(`card:${metricLabel(page.metric)}`)}
                        aria-current={index === pageIndex}
                        className={`rounded-full transition-all ${
                          index === pageIndex
                            ? "w-3 h-1.5 bg-primary"
                            : "w-1.5 h-1.5 bg-muted/40 hover:bg-muted"
                        }`}
                      />
                    ))}
                  </div>

                  <NavButton
                    label={t("card:system_resource_next")}
                    onClick={() => goToPage((pageIndex + 1) % pageCount)}
                  >
                    <MorphIcon icon={ChevronRight} size={14} aria-hidden />
                  </NavButton>
                </div>
              )}
            </>
          )}
        </div>
      </GlassCard>

      <SystemResourceSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={cardSettings}
        snapshot={current}
        size={cardSize}
        onSave={handleSaveSettings}
      />
    </>
  );
}

function NavButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="w-5 h-5 flex items-center justify-center rounded-md text-muted hover:text-foreground hover:bg-default-100 transition-colors text-sm leading-none"
    >
      {children}
    </button>
  );
}
