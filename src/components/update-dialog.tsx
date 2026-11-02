import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { GlassButton } from "@/components/ui/button";
import { GlassModalCompound as GlassModal } from "@/components/ui/modal";
import { GlassSkeleton } from "@/components/ui/skeleton";
import {
  checkForUpdate,
  cancelDownload,
  downloadUpdate,
  getChannel,
  getCurrentUpdateInfo,
  getIsDownloading,
  type UpdateCheckResult,
  type ChangelogStatus,
  type UpdateChannel,
} from "@/utils/updateService";

interface UpdateDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UpdateDialog({ isOpen, onOpenChange }: UpdateDialogProps) {
  const { t } = useTranslation();

  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [changelogStatus, setChangelogStatus] =
    useState<ChangelogStatus>("idle");
  const [changelog, setChangelog] = useState<string | null>(null);
  const [channel, setChannel] = useState<UpdateChannel>("stable");

  // When dialog opens, check for update or restore state during download
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    // If already downloading, restore state
    if (getIsDownloading()) {
      setIsDownloading(true);
      const cached = getCurrentUpdateInfo();
      if (cached) {
        setResult({
          available: true,
          update: cached,
          changelog: null,
          changelogStatus: "loading",
          status: "available",
        });
        setChannel(getChannel());
        (async () => {
          const res = await checkForUpdate();
          if (res.changelog) setChangelog(res.changelog);
          if (res.changelogStatus) setChangelogStatus(res.changelogStatus);
        })();
      }
      return;
    }

    let cancelled = false;

    const check = async () => {
      setIsChecking(true);
      setChannel(getChannel());
      const res = await checkForUpdate();
      if (!cancelled) {
        setResult(res);
        setChangelog(res.changelog);
        setChangelogStatus(res.changelogStatus);
        setIsChecking(false);
      }
    };

    check();

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const handleDownload = useCallback(async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      await downloadUpdate();
    } finally {
      setIsDownloading(false);
    }
  }, [isDownloading]);

  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const handleStopDownload = useCallback(() => {
    cancelDownload();
    onOpenChange(false);
  }, [onOpenChange]);

  const renderChangelog = () => {
    if (changelogStatus === "loading") {
      return (
        <div className="space-y-2">
          <GlassSkeleton className="w-24 h-4 rounded-lg" />
          <GlassSkeleton className="w-full h-3 rounded-lg" />
          <GlassSkeleton className="w-5/6 h-3 rounded-lg" />
          <GlassSkeleton className="w-4/6 h-3 rounded-lg" />
        </div>
      );
    }

    if (changelogStatus === "failed" || changelogStatus === "unavailable") {
      return (
        <div className="py-4 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-warning/10 border border-warning/20">
            <svg
              className="w-4 h-4 text-warning-text"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <span className="text-sm text-warning-text">
              {t("settings.update.changelog_failed")}
            </span>
          </div>
        </div>
      );
    }

    if (changelogStatus === "success" && changelog) {
      return (
        <div className="max-h-80 overflow-y-auto pr-1 space-y-2">
          {changelog.split("\n").map((line, i) => {
            if (line.startsWith("# ")) {
              return (
                <h3 key={i} className="text-sm font-bold text-foreground mt-2">
                  {line.replace(/^# /, "")}
                </h3>
              );
            }
            if (line.startsWith("## ")) {
              return (
                <h4
                  key={i}
                  className="text-xs font-semibold text-foreground/80 mt-2"
                >
                  {line.replace(/^## /, "")}
                </h4>
              );
            }
            if (line.startsWith("- ")) {
              return (
                <p key={i} className="text-xs text-muted pl-2">
                  {line}
                </p>
              );
            }
            if (line.trim() === "") {
              return <div key={i} className="h-1" />;
            }
            return (
              <p key={i} className="text-xs text-muted">
                {line}
              </p>
            );
          })}
        </div>
      );
    }

    return null;
  };

  const renderVersionInfo = () => {
    if (isChecking && !result) {
      return (
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 rounded-xl lg-material-sub border border-separator/40">
            <GlassSkeleton className="w-16 h-3 rounded-lg" />
            <GlassSkeleton className="w-20 h-4 rounded-lg" />
          </div>
          <div className="flex items-center justify-between p-3 rounded-xl lg-material-sub border border-separator/40">
            <GlassSkeleton className="w-16 h-3 rounded-lg" />
            <GlassSkeleton className="w-20 h-4 rounded-lg" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center justify-between p-2 rounded-lg bg-muted/5">
              <GlassSkeleton className="w-10 h-3 rounded-lg" />
              <GlassSkeleton className="w-14 h-3 rounded-lg" />
            </div>
            <div className="flex items-center justify-between p-2 rounded-lg bg-muted/5">
              <GlassSkeleton className="w-12 h-3 rounded-lg" />
              <GlassSkeleton className="w-16 h-3 rounded-lg" />
            </div>
          </div>
        </div>
      );
    }

    if (!result?.update) return null;

    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center justify-between p-3 rounded-xl lg-material-sub border border-separator/40">
            <span className="text-xs text-muted">
              {t("settings.update.current_version")}
            </span>
            <span className="text-sm font-semibold text-foreground">
              v{result.update.currentVersion}
            </span>
          </div>
          <div className="flex items-center justify-between p-3 rounded-xl lg-material-sub border border-primary/20">
            <span className="text-xs text-muted">
              {t("settings.update.latest_version")}
            </span>
            <span className="text-sm font-semibold text-primary-text">
              v{result.update.newVersion}
            </span>
          </div>
          <div className="flex items-center justify-between p-2 rounded-lg bg-muted/5">
            <span className="text-[11px] text-muted">
              {t("settings.update.channel")}
            </span>
            <span className="text-[11px] font-medium text-foreground capitalize">
              {channel === "stable"
                ? t("settings.update_channel.stable")
                : t("settings.update_channel.preview")}
            </span>
          </div>
          {result.update.date && (
            <div className="flex items-center justify-between p-2 rounded-lg bg-muted/5">
              <span className="text-[11px] text-muted">
                {t("settings.update.release_date")}
              </span>
              <span className="text-[11px] font-medium text-foreground">
                {new Date(result.update.date).toLocaleDateString()}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <GlassModal isOpen={isOpen} onOpenChange={(o) => {
      // Allow closing during download (download continues in background)
      onOpenChange(o);
    }}>
      <GlassModal.Backdrop variant="blur" className="z-[100]">
        <GlassModal.Container size="xl" placement="center" scroll="outside">
          <GlassModal.Dialog className="border border-separator/60 p-0">
            <GlassModal.Header className="relative px-8 pt-5 pb-3">
              <GlassModal.CloseTrigger className="absolute right-3 top-3" />
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center ring-1 ring-primary/20">
                  <svg
                    className="w-5 h-5 text-primary-text"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth="2"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                    />
                  </svg>
                </div>
                <div>
                  <GlassModal.Heading>
                    {t("settings.update.update_available")}
                  </GlassModal.Heading>
                  {isChecking ? (
                    <GlassSkeleton className="w-40 h-3 rounded-lg mt-1" />
                  ) : result?.update ? (
                    <p className="text-xs text-muted mt-0.5">
                      v{result.update.currentVersion} → v{result.update.newVersion}
                    </p>
                  ) : (
                    <p className="text-xs text-muted mt-0.5">
                      {t("settings.update.checking")}
                    </p>
                  )}
                </div>
              </div>
            </GlassModal.Header>

            <GlassModal.Body className="px-8 py-5 space-y-5">
              {/* Version Info */}
              {renderVersionInfo()}

              {/* Download Progress */}
              {isDownloading && (
                <div className="flex items-center gap-3 py-2">
                  <svg width="20" height="20" viewBox="0 0 20 20" className="animate-spin text-primary-text shrink-0">
                    <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="36" strokeDashoffset="10" strokeLinecap="round" />
                  </svg>
                  <span className="text-sm text-muted">
                    {t("settings.update.downloading_install")}
                  </span>
                </div>
              )}

              {/* Changelog */}
              {renderChangelog()}
            </GlassModal.Body>

            <GlassModal.Footer className="flex items-center justify-end gap-3 px-8 py-4 border-t border-separator">
              {isDownloading ? (
                <>
                  <GlassButton variant="danger" onPress={handleStopDownload}>
                    {t("settings.update.stop_download")}
                  </GlassButton>
                </>
              ) : (
                <>
                  <GlassButton variant="tertiary" onPress={handleClose}>
                    {t("settings.update.later")}
                  </GlassButton>
                  <GlassButton
                    variant="primary"
                    onPress={handleDownload}
                    isLoading={isChecking}
                    isDisabled={!result?.update || isChecking}
                  >
                    {t("settings.update.download_update")}
                  </GlassButton>
                </>
              )}
            </GlassModal.Footer>
          </GlassModal.Dialog>
        </GlassModal.Container>
      </GlassModal.Backdrop>
    </GlassModal>
  );
}
