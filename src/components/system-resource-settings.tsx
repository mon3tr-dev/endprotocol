import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { GlassInput, GlassSelect, GlassSwitch } from "@/components/ui/glass";
import { SettingsDivider } from "@/components/ui/settings-row";
import type {
  ByteUnitSystem,
  MetricPrecision,
  ResourceMetricId,
  SystemResourceDefaults,
} from "@/types/system-resource";
import {
  DEFAULT_SYSTEM_RESOURCE_DEFAULTS,
  METRIC_CATALOG,
  METRIC_ORDER,
  REFRESH_PRESETS,
} from "@/types/system-resource";
import { SystemResourceColorPicker } from "@/components/cards/system-resource/color-picker";
import {
  getSystemResourceDefaults,
  setSystemResourceDefaults,
} from "@/utils/systemResourceService";

/**
 * 全局设置页「系统资源卡片」分区：新增卡片/卡片组时优先读取这里的默认值。
 */
export function SystemResourceSettings() {
  const { t } = useTranslation();
  const [defaults, setDefaults] = useState<SystemResourceDefaults>(
    DEFAULT_SYSTEM_RESOURCE_DEFAULTS,
  );
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void getSystemResourceDefaults().then((value) => {
      setDefaults(value);
      setLoaded(true);
    });
  }, []);

  const update = (patch: Partial<SystemResourceDefaults>) => {
    const next = { ...defaults, ...patch };
    setDefaults(next);
    void setSystemResourceDefaults(patch);
  };

  const toggleTemplate = (id: ResourceMetricId) => {
    const exists = defaults.template.includes(id);
    const nextTemplate = exists
      ? defaults.template.filter((m) => m !== id)
      : [...defaults.template, id];
    update({ template: nextTemplate });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Label
          title={t("settings.system_resource.refresh")}
          desc={t("settings.system_resource.refresh_desc")}
        />
        <GlassSelect
          value={String(defaults.refreshMs)}
          options={REFRESH_PRESETS.map((ms) => ({
            value: String(ms),
            label: `${ms} ms`,
          }))}
          onChange={(v) => update({ refreshMs: Number(v) })}
        />
      </div>

      <SettingsDivider />

      <div className="flex items-center justify-between gap-4">
        <Label
          title={t("settings.system_resource.unit")}
          desc={t("settings.system_resource.unit_desc")}
        />
        <GlassSelect
          value={defaults.unitSystem}
          options={[
            { value: "auto", label: t("card:system_resource_unit_auto") },
            { value: "binary", label: t("card:system_resource_unit_binary") },
            { value: "decimal", label: t("card:system_resource_unit_decimal") },
            { value: "bit", label: t("card:system_resource_unit_bit") },
          ]}
          onChange={(v) => update({ unitSystem: v as ByteUnitSystem })}
        />
      </div>

      <SettingsDivider />

      <div className="flex items-center justify-between gap-4">
        <Label
          title={t("settings.system_resource.rotate")}
          desc={t("settings.system_resource.rotate_desc")}
        />
        <GlassSelect
          value={String(defaults.rotateMs)}
          options={[
            { value: "0", label: t("card:system_resource_rotate_off") },
            ...[3, 5, 10, 30].map((s) => ({
              value: String(s * 1000),
              label: `${s}s`,
            })),
          ]}
          onChange={(v) => update({ rotateMs: Number(v) })}
        />
      </div>

      <SettingsDivider />

      <div className="flex items-center justify-between gap-4">
        <Label
          title={t("settings.system_resource.precision")}
          desc={t("settings.system_resource.precision_desc")}
        />
        <GlassSelect
          value={String(defaults.precision)}
          options={[0, 1, 2, 3].map((p) => ({ value: String(p), label: `${p}` }))}
          onChange={(v) => update({ precision: Number(v) as MetricPrecision })}
        />
      </div>

      <SettingsDivider />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <Label
          title={t("settings.system_resource.thresholds")}
          desc={t("settings.system_resource.thresholds_desc")}
        />
        <div className="flex items-center gap-2">
          <GlassInput
            size="sm"
            type="number"
            className="w-20"
            value={String(defaults.warnThreshold)}
            onChange={(e) => update({ warnThreshold: Number(e.target.value) || 0 })}
          />
          <GlassInput
            size="sm"
            type="number"
            className="w-20"
            value={String(defaults.criticalThreshold)}
            onChange={(e) => update({ criticalThreshold: Number(e.target.value) || 0 })}
          />
        </div>
      </div>

      <SettingsDivider />

      <div className="flex items-center justify-between gap-4">
        <Label
          title={t("settings.system_resource.sparklines")}
          desc={t("settings.system_resource.sparklines_desc")}
        />
        <GlassSwitch
          isSelected={defaults.showSparklines}
          onValueChange={(v) => update({ showSparklines: v })}
        >
          <GlassSwitch.Control>
            <GlassSwitch.Thumb />
          </GlassSwitch.Control>
        </GlassSwitch>
      </div>

      <SettingsDivider />

      <div className="flex items-center justify-between gap-4">
        <Label
          title={t("settings.system_resource.accent")}
          desc={t("settings.system_resource.accent_desc")}
        />
        <SystemResourceColorPicker
          value={defaults.accent}
          onChange={(accent) => update({ accent })}
          label={t("settings.system_resource.accent")}
        />
      </div>

      <SettingsDivider />

      <div>
        <Label
          title={t("settings.system_resource.template")}
          desc={t("settings.system_resource.template_desc")}
        />
        <div className="flex flex-wrap gap-1.5 mt-2">
          {METRIC_ORDER.map((id) => {
            const active = defaults.template.includes(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggleTemplate(id)}
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
      </div>

      {!loaded && (
        <p className="text-xs text-muted">{t("settings.system_resource.loading")}</p>
      )}
    </div>
  );
}

function Label({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="min-w-0">
      <p className="font-medium text-foreground">{title}</p>
      {desc && <p className="text-sm text-muted mt-0.5">{desc}</p>}
    </div>
  );
}
