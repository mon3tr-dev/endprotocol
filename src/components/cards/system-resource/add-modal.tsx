import { useTranslation } from "react-i18next";
import { GlassCard } from "@/components/ui/glass";
import {
  CustomModal,
  CustomModalBody,
  CustomModalHeader,
} from "@/components/custom-modal";
import type { ResourceMetricId, SystemResourceSizeTier } from "@/types/system-resource";
import {
  METRIC_CATALOG,
  METRIC_ORDER,
  RESOURCE_GROUP_TEMPLATES,
  SIZE_PRESETS,
} from "@/types/system-resource";

export interface SystemResourceAddPayload {
  mode: "atomic" | "group";
  metrics: ResourceMetricId[];
  size: { w: number; h: number };
  templateId?: string;
}

interface AddModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (payload: SystemResourceAddPayload) => void;
}

const TIER_ORDER: SystemResourceSizeTier[] = ["small", "medium", "large"];

/**
 * 新增系统资源卡片：三档固定尺寸（小 2×2 / 中 3×3 / 大 4×3）。
 * 小卡为单指标，其余为预设好的指标组；不再提供卡内排列方式。
 */
export function SystemResourceAddModal({
  isOpen,
  onClose,
  onConfirm,
}: AddModalProps) {
  const { t } = useTranslation();
  const presetOf = (tier: SystemResourceSizeTier) =>
    SIZE_PRESETS.find((p) => p.tier === tier) ?? SIZE_PRESETS[1];

  return (
    <CustomModal isOpen={isOpen} onClose={onClose} size="md" height="fixed">
      <CustomModalHeader onClose={onClose}>
        {t("card:system_resource_title")}
      </CustomModalHeader>
      <CustomModalBody>
        <div className="space-y-5">
          {TIER_ORDER.map((tier) => {
            const preset = presetOf(tier);
            const templates = RESOURCE_GROUP_TEMPLATES.filter((tpl) => tpl.tier === tier);
            return (
              <section key={tier}>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
                  {t(`card:${preset.labelKey}`)}
                </h3>

                {tier === "small" ? (
                  <div className="flex flex-wrap gap-1.5">
                    {METRIC_ORDER.map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() =>
                          onConfirm({
                            mode: "atomic",
                            metrics: [id],
                            size: { w: preset.w, h: preset.h },
                          })
                        }
                        className="px-3 py-1.5 text-xs rounded-full border border-separator text-foreground/90 hover:border-primary hover:text-primary transition-all cursor-pointer hover:scale-105 active:scale-95"
                      >
                        {t(`card:${METRIC_CATALOG[id].labelKey}`)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {templates.map((tpl) => (
                      <GlassCard
                        key={tpl.id}
                        isPressable
                        onPress={() =>
                          onConfirm({
                            mode: "group",
                            metrics: tpl.metrics,
                            size: { w: preset.w, h: preset.h },
                            templateId: tpl.id,
                          })
                        }
                        className="p-3 cursor-pointer border-2 border-transparent hover:border-primary/50 transition-all"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">
                            {t(`card:${tpl.labelKey}`)}
                          </div>
                          <div className="text-[11px] text-muted truncate">
                            {tpl.metrics
                              .map((id) => t(`card:${METRIC_CATALOG[id].labelKey}`))
                              .join(" · ")}
                          </div>
                        </div>
                      </GlassCard>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </CustomModalBody>
    </CustomModal>
  );
}
