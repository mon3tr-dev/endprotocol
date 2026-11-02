import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { GlassCard, GlassProgressCircle } from "@/components/ui/glass";
import { getSelectedAccount } from "@/utils/accountService";
import { roleDataService } from "@/utils/roleDataService";
import { MedalBrowser } from "@/components/cards/achievement/medal-browser";
import type { AchieveMedal } from "@/types/charDetail";
import { logError } from "@/utils/logger";

export default function MedalsPage() {
  const { t } = useTranslation();
  const [medals, setMedals] = useState<AchieveMedal[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      const id = await getSelectedAccount();
      if (!id) {
        setIsLoading(false);
        return;
      }
      const detail = await roleDataService.getFullCharDetail(id);
      if (detail?.achieve?.achieveMedals) {
        setMedals(detail.achieve.achieveMedals);
      } else {
        setMedals([]);
      }
    } catch (error) {
      logError("Failed to load medal data:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const handleAccountChange = () => loadData();
    window.addEventListener("accountChanged", handleAccountChange);
    return () => window.removeEventListener("accountChanged", handleAccountChange);
  }, [loadData]);

  return (
    <div className="max-w-6xl mx-auto h-full flex flex-col pb-4">
      <div className="mb-4 shrink-0">
        <h1 className="text-2xl lg:text-3xl font-bold text-foreground tracking-tight">
          {t("sidebar.medals")}
        </h1>
        {medals.length > 0 && (
          <p className="text-foreground/70 mt-1.5 text-sm">
            {medals.length} {t("sidebar.medals")}
          </p>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <GlassProgressCircle isIndeterminate size="lg" aria-label="Loading" className="text-primary-text">
            <GlassProgressCircle.Track>
              <GlassProgressCircle.TrackCircle />
              <GlassProgressCircle.FillCircle />
            </GlassProgressCircle.Track>
          </GlassProgressCircle>
        </div>
      ) : medals.length === 0 ? (
        <GlassCard className="p-16  border border-separator/90">
          <div className="text-center text-muted">
            <p>{t("card:ach_no_medals")}</p>
          </div>
        </GlassCard>
      ) : (
        <div className="flex-1 min-h-0">
          <MedalBrowser medals={medals} />
        </div>
      )}
    </div>
  );
}
