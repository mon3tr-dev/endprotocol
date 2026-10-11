import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  GlassButton,
  GlassCheckbox,
  GlassInput,
  GlassSelect,
  GlassSwitch,
} from "@/components/ui/glass";
import {
  CustomModal,
  CustomModalBody,
  CustomModalFooter,
  CustomModalHeader,
} from "@/components/custom-modal";
import type {
  ByteUnitSystem,
  MetricPrecision,
  ResourceMetricConfig,
  ResourceMetricId,
  SystemResourceCardSettings,
  SystemSnapshot,
} from "@/types/system-resource";
import {
  METRIC_CATALOG,
  METRIC_ORDER,
  REFRESH_PRESETS,
  createMetricConfig,
  sizeTier,
} from "@/types/system-resource";
import { SystemResourceColorPicker } from "./color-picker";
import { MorphIcon } from "morphicons/react";
import { ChevronUp, X } from "lucide";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: SystemResourceCardSettings;
  snapshot: SystemSnapshot | null;
  /** 当前卡片网格尺寸 */
  size: { w: number; h: number };
  onSave: (next: SystemResourceCardSettings) => void;
}

export function SystemResourceSettingsModal({
  isOpen,
  onClose,
  settings,
  snapshot,
  size,
  onSave,
}: SettingsModalProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<SystemResourceCardSettings>(settings);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [customRefresh, setCustomRefresh] = useState("");

  useEffect(() => {
    if (isOpen) {
      setDraft(settings);
      setCustomRefresh(
        REFRESH_PRESETS.includes(settings.refreshMs)
          ? ""
          : String(settings.refreshMs),
      );
    }
  }, [isOpen, settings]);

  const deviceOptions = useMemo(() => {
    return {
      gpu:
        snapshot?.gpus.map((g) => ({
          value: String(g.index),
          label: `#${g.index} ${g.name}`,
        })) ?? [],
      disk:
        snapshot?.disks.map((d) => ({
          value: d.id,
          label: d.mountPoint ? `${d.mountPoint} (${d.name})` : d.name,
        })) ?? [],
      network:
        snapshot?.networks.map((n) => ({ value: n.id, label: n.name })) ?? [],
    };
  }, [snapshot]);

  const patchDraft = (patch: Partial<SystemResourceCardSettings>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const patchMetric = (id: ResourceMetricId, patch: Partial<ResourceMetricConfig>) => {
    setDraft((prev) => ({
      ...prev,
      metrics: prev.metrics.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    }));
  };

  const addMetric = (id: ResourceMetricId) => {
    setDraft((prev) => ({
      ...prev,
      metrics: [...prev.metrics, createMetricConfig(id, prev)],
    }));
    setExpandedId(id);
  };

  const removeMetric = (id: ResourceMetricId) => {
    setDraft((prev) => ({
      ...prev,
      metrics: prev.metrics.filter((m) => m.id !== id),
    }));
  };

  const moveMetric = (id: ResourceMetricId, direction: -1 | 1) => {
    setDraft((prev) => {
      const index = prev.metrics.findIndex((m) => m.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.metrics.length) return prev;
      const next = [...prev.metrics];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return { ...prev, metrics: next };
    });
  };

  const unusedMetrics = METRIC_ORDER.filter(
    (id) => !draft.metrics.some((m) => m.id === id),
  );

  const isSmall = sizeTier(size.w, size.h) === "small";

  const precisionOptions = [0, 1, 2, 3].map((p) => ({
    value: String(p),
    label: `${p}`,
  }));

  return (
    <CustomModal isOpen={isOpen} onClose={onClose} size="lg" height="fixed">
      <CustomModalHeader onClose={onClose}>
        {t("card:system_resource_settings")}
      </CustomModalHeader>
      <CustomModalBody>
        <div className="space-y-5">
          {/* ---------- 卡片整体层 ---------- */}
          <section className="space-y-3">
            <SectionTitle>{t("card:system_resource_section_general")}</SectionTitle>

            <FieldRow label={t("card:system_resource_field_title")}>
              <GlassInput
                size="sm"
                className="w-44"
                value={draft.title ?? ""}
                placeholder={t("card:system_resource_title")}
                onChange={(e) => patchDraft({ title: e.target.value })}
              />
            </FieldRow>

            <FieldRow label={t("card:system_resource_field_refresh")}>
              <GlassSelect
                value={String(draft.refreshMs)}
                options={[
                  ...REFRESH_PRESETS.map((ms) => ({
                    value: String(ms),
                    label: `${ms} ms`,
                  })),
                  ...(REFRESH_PRESETS.includes(draft.refreshMs)
                    ? []
                    : [{ value: String(draft.refreshMs), label: t("card:system_resource_custom") }]),
                ]}
                onChange={(value) => patchDraft({ refreshMs: Number(value) })}
              />
              <GlassInput
                size="sm"
                className="w-24"
                type="number"
                placeholder={t("card:system_resource_custom_ms")}
                value={customRefresh}
                onChange={(e) => {
                  setCustomRefresh(e.target.value);
                  const ms = Number(e.target.value);
                  if (ms >= 200 && ms <= 60000) patchDraft({ refreshMs: ms });
                }}
              />
            </FieldRow>

            <FieldRow label={t("card:system_resource_field_accent")}>
              <SystemResourceColorPicker
                value={draft.accent ?? "#6366f1"}
                onChange={(color) => patchDraft({ accent: color })}
                label={t("card:system_resource_field_accent")}
              />
            </FieldRow>

            <FieldRow label={t("card:system_resource_field_rotate")}>
              <GlassSelect
                value={String(draft.rotateMs ?? 0)}
                options={[
                  { value: "0", label: t("card:system_resource_rotate_off") },
                  ...[3, 5, 10, 30].map((s) => ({
                    value: String(s * 1000),
                    label: `${s}s`,
                  })),
                ]}
                onChange={(value) => patchDraft({ rotateMs: Number(value) })}
              />
            </FieldRow>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              <ToggleRow
                label={t("card:system_resource_field_show_title")}
                checked={draft.showTitleBar}
                onChange={(v) => patchDraft({ showTitleBar: v })}
              />
              <ToggleRow
                label={t("card:system_resource_field_show_labels")}
                checked={draft.showLabels}
                onChange={(v) => patchDraft({ showLabels: v })}
              />
              <ToggleRow
                label={t("card:system_resource_field_show_sparklines")}
                checked={draft.showSparklines}
                onChange={(v) => patchDraft({ showSparklines: v })}
              />
              <ToggleRow
                label={t("card:system_resource_field_show_peak_avg")}
                checked={draft.showPeakAvg}
                onChange={(v) => patchDraft({ showPeakAvg: v })}
              />
            </div>

            <FieldRow label={t("card:system_resource_field_history_window")}>
              <GlassSelect
                value={String(draft.historyWindowSec)}
                options={[30, 60, 120, 300].map((s) => ({
                  value: String(s),
                  label: `${s}s`,
                }))}
                onChange={(value) => patchDraft({ historyWindowSec: Number(value) })}
              />
            </FieldRow>

            <FieldRow label={t("card:system_resource_field_thresholds")}>
              <div className="flex items-center gap-2">
                <NumberBadge
                  label={t("card:system_resource_warn")}
                  value={draft.warnThreshold ?? 80}
                  onChange={(v) => patchDraft({ warnThreshold: v })}
                />
                <NumberBadge
                  label={t("card:system_resource_critical")}
                  value={draft.criticalThreshold ?? 95}
                  onChange={(v) => patchDraft({ criticalThreshold: v })}
                />
              </div>
            </FieldRow>
          </section>

          <Divider />

          {/* ---------- 指标层 ---------- */}
          <section className="space-y-2">
            <SectionTitle>{t("card:system_resource_section_metrics")}</SectionTitle>

            {/* 小卡：仅允许 1 个数据类型（单选） */}
            {isSmall && (
              <>
                <p className="text-[11px] text-muted">
                  {t("card:system_resource_small_single_hint")}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {METRIC_ORDER.map((id) => {
                    const active = draft.metrics[0]?.id === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() =>
                          setDraft((prev) => ({
                            ...prev,
                            metrics: [
                              prev.metrics.find((m) => m.id === id) ??
                                createMetricConfig(id, prev),
                            ],
                          }))
                        }
                        className={`px-2.5 py-1 text-xs rounded-full border transition-all cursor-pointer ${
                          active
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-separator text-muted hover:border-primary/50"
                        }`}
                      >
                        {t(`card:${METRIC_CATALOG[id].labelKey}`)}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {!isSmall && (
              <>
            {draft.metrics.map((metric) => {
              const definition = METRIC_CATALOG[metric.id];
              const expanded = expandedId === metric.id;
              return (
                <div
                  key={metric.id}
                  className="rounded-xl border border-separator/70 bg-default-50/40"
                >
                  <div className="flex items-center gap-2 px-3 py-2">
                    <GlassCheckbox
                      isSelected={metric.visible}
                      onValueChange={(v) => patchMetric(metric.id, { visible: v })}
                      aria-label={t(`card:${definition.labelKey}`)}
                    />
                    <button
                      type="button"
                      className="flex-1 text-left text-sm text-foreground truncate"
                      onClick={() => setExpandedId(expanded ? null : metric.id)}
                    >
                      {t(`card:${definition.labelKey}`)}
                    </button>
                    <div className="flex items-center gap-0.5">
                      <IconBtn label="up" onClick={() => moveMetric(metric.id, -1)}>
                        <MorphIcon icon={ChevronUp} size={13} aria-hidden />
                      </IconBtn>
                      <IconBtn label="down" onClick={() => moveMetric(metric.id, 1)}>
                        <MorphIcon
                          icon={ChevronUp}
                          size={13}
                          className="rotate-180"
                          aria-hidden
                        />
                      </IconBtn>
                      <IconBtn label="remove" onClick={() => removeMetric(metric.id)}>
                        <MorphIcon icon={X} size={12} aria-hidden />
                      </IconBtn>
                    </div>
                  </div>

                  {expanded && (
                    <div className="px-3 pb-3 space-y-2 border-t border-separator/60 pt-3">
                      {(definition.kind === "bytes" ||
                        definition.kind === "bytesRate") && (
                        <FieldRow label={t("card:system_resource_field_unit")}>
                          <GlassSelect
                            value={metric.unit ?? "auto"}
                            options={[
                              { value: "auto", label: t("card:system_resource_unit_auto") },
                              { value: "binary", label: t("card:system_resource_unit_binary") },
                              { value: "decimal", label: t("card:system_resource_unit_decimal") },
                              {
                                value: "bit",
                                label: t(
                                  definition.kind === "bytesRate"
                                    ? "card:system_resource_unit_bit_rate"
                                    : "card:system_resource_unit_bit",
                                ),
                              },
                            ]}
                            onChange={(value) =>
                              patchMetric(metric.id, { unit: value as ByteUnitSystem })
                            }
                          />
                        </FieldRow>
                      )}

                      <FieldRow label={t("card:system_resource_field_precision")}>
                        <GlassSelect
                          value={String(metric.precision)}
                          options={precisionOptions}
                          onChange={(value) =>
                            patchMetric(metric.id, {
                              precision: Number(value) as MetricPrecision,
                            })
                          }
                        />
                      </FieldRow>

                      <FieldRow label={t("card:system_resource_field_color")}>
                        <SystemResourceColorPicker
                          value={metric.color ?? draft.accent ?? "#6366f1"}
                          onChange={(color) =>
                            patchMetric(metric.id, { color })
                          }
                          label={t("card:system_resource_field_color")}
                        />
                      </FieldRow>

                      {definition.deviceScope === "gpu" && deviceOptions.gpu.length > 0 && (
                        <FieldRow label={t("card:system_resource_field_device")}>
                          <GlassSelect
                            value={metric.scope ?? String(deviceOptions.gpu[0].value)}
                            options={deviceOptions.gpu}
                            onChange={(value) => patchMetric(metric.id, { scope: value })}
                          />
                        </FieldRow>
                      )}
                      {definition.deviceScope === "disk" && deviceOptions.disk.length > 0 && (
                        <FieldRow label={t("card:system_resource_field_device")}>
                          <GlassSelect
                            value={metric.scope ?? String(deviceOptions.disk[0].value)}
                            options={deviceOptions.disk}
                            onChange={(value) => patchMetric(metric.id, { scope: value })}
                          />
                        </FieldRow>
                      )}
                      {definition.deviceScope === "network" &&
                        deviceOptions.network.length > 0 && (
                          <FieldRow label={t("card:system_resource_field_device")}>
                            <GlassSelect
                              value={metric.scope ?? String(deviceOptions.network[0].value)}
                              options={deviceOptions.network}
                              onChange={(value) => patchMetric(metric.id, { scope: value })}
                            />
                          </FieldRow>
                        )}

                      {definition.percentual && (
                        <FieldRow label={t("card:system_resource_field_metric_thresholds")}>
                          <div className="flex items-center gap-2">
                            <NumberBadge
                              label={t("card:system_resource_warn")}
                              value={metric.warn ?? draft.warnThreshold ?? 80}
                              onChange={(v) => patchMetric(metric.id, { warn: v })}
                            />
                            <NumberBadge
                              label={t("card:system_resource_critical")}
                              value={metric.critical ?? draft.criticalThreshold ?? 95}
                              onChange={(v) => patchMetric(metric.id, { critical: v })}
                            />
                          </div>
                        </FieldRow>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {unusedMetrics.length > 0 && (
              <div className="pt-1">
                <p className="text-xs text-muted mb-1.5">
                  {t("card:system_resource_add_metric")}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {unusedMetrics.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => addMetric(id)}
                      className="px-2.5 py-1 text-xs rounded-full border border-separator text-muted hover:border-primary hover:text-primary transition-all cursor-pointer hover:scale-105 active:scale-95"
                    >
                      + {t(`card:${METRIC_CATALOG[id].labelKey}`)}
                    </button>
                  ))}
                </div>
              </div>
            )}
              </>
            )}
          </section>
        </div>
      </CustomModalBody>
      <CustomModalFooter>
        <GlassButton variant="secondary" onPress={onClose}>
          {t("common.cancel")}
        </GlassButton>
        <GlassButton
          variant="primary"
          onPress={() => {
            onSave({
              ...draft,
              metrics: isSmall ? draft.metrics.slice(0, 1) : draft.metrics,
            });
            onClose();
          }}
        >
          {t("common.save")}
        </GlassButton>
      </CustomModalFooter>
    </CustomModal>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
      {children}
    </h3>
  );
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-foreground/90">{label}</span>
      <div className="flex items-center gap-2 shrink-0">{children}</div>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-foreground/90">{label}</span>
      <GlassSwitch isSelected={checked} onValueChange={onChange}>
        <GlassSwitch.Control>
          <GlassSwitch.Thumb />
        </GlassSwitch.Control>
      </GlassSwitch>
    </div>
  );
}

function NumberBadge({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-1 text-xs text-muted">
      <span>{label}</span>
      <GlassInput
        size="sm"
        type="number"
        className="w-16"
        value={String(value)}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (!Number.isNaN(next)) onChange(next);
        }}
      />
    </label>
  );
}

function IconBtn({
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
      className="w-6 h-6 flex items-center justify-center rounded-md text-muted hover:text-foreground hover:bg-default-100 transition-colors text-xs"
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="h-px bg-separator/60" />;
}
