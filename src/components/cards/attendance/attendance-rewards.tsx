import { useTranslation } from "react-i18next";
import { Img } from "@/utils/imageLoader";
import type { AttendanceData, ResourceInfo } from "./index";

export function AttendanceRewards({
  attendanceData,
}: {
  attendanceData: AttendanceData | null;
}) {
  const { t } = useTranslation();

  if (!attendanceData) return null;

  function renderRewardIcon(entry: { awardId: string; done: boolean }, size?: string) {
    const reward: ResourceInfo | undefined = attendanceData!.resourceInfoMap[entry.awardId];
    const s = size ?? "w-[60px] h-[60px]";
    return (
      <div className={`relative ${s} shrink-0`}>
        {reward ? (
          <>
            <Img
              src={reward.icon}
              alt={reward.name}
              className={`w-full h-full object-contain rounded ${entry.done ? "opacity-40" : ""}`}
            />
            {entry.done && (
              <div className="absolute inset-0 flex items-center justify-center">
                <svg className="w-9 h-9 text-default-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            )}
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center lg-inset rounded">
            <span className="text-[10px] text-muted">--</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* first-time rewards */}
      {attendanceData.first.length > 0 && (
        <div>
          <p className="text-xs text-muted font-medium mb-2.5">
            {t("card:attendance_first_rewards")}
          </p>
          <div className="flex gap-2 flex-wrap">
            {attendanceData.first.map((entry, idx) => {
              const reward: ResourceInfo | undefined = attendanceData.resourceInfoMap[entry.awardId];
              if (!reward) return null;
              return (
                <div
                  key={idx}
                  className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border w-[84px] ${
                    entry.done ? "opacity-45" : "border-separator"
                  }`}
                >
                  {renderRewardIcon(entry, "w-[60px] h-[60px]")}
                  <span className="text-[11px] text-muted text-center truncate w-full">{reward.name}</span>
                  <span className="text-[11px] font-medium">x{reward.count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* monthly calendar rewards */}
      <div>
        <p className="text-xs text-muted font-medium mb-2.5">
          {t("card:attendance_monthly_rewards")}
        </p>
        <div className="grid grid-cols-7 gap-1">
          {attendanceData.calendar.map((entry, idx) => {
            const reward: ResourceInfo | undefined = attendanceData.resourceInfoMap[entry.awardId];
            return (
              <div
                key={idx}
                className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border ${
                  entry.done ? "border-default-200 bg-default-50 opacity-45" : "border-separator"
                }`}
              >
                <span className="text-[11px] text-muted font-medium">
                  {t("card:attendance_day", { day: idx + 1 })}
                </span>
                {renderRewardIcon(entry)}
                {reward && (
                  <>
                    <span className="text-[11px] text-muted truncate w-full text-center">
                      {reward.name}
                    </span>
                    <span className="text-[11px] font-medium">x{reward.count}</span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
