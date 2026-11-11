import { useTranslation } from "react-i18next";
import { Img } from "@/utils/imageLoader";
import type { AttendanceData, CalendarEntry, ResourceInfo } from "./index";

export function AttendanceRewards({
  attendanceData,
}: {
  attendanceData: AttendanceData | null;
}) {
  const { t } = useTranslation();

  if (!attendanceData) return null;

  /** 取某一格的物品静态信息（图标/名称） */
  function infoOf(entry: CalendarEntry): ResourceInfo | undefined {
    return attendanceData!.resourceInfoMap[entry.awardId];
  }

  /**
   * 该格实际发放的数量。
   *
   * ⚠️ 必须逐格取（明日方舟同 id 不同格数量不同：`4001` 是 500/1000 混排）；
   * 只有该格没带 count 时才退回 map 里的值（终末地）。
   */
  function countOf(entry: CalendarEntry): number {
    return entry.count || infoOf(entry)?.count || 0;
  }

  function renderRewardIcon(entry: CalendarEntry, size?: string) {
    const reward = infoOf(entry);
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
              const reward = infoOf(entry);
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
                  <span className="text-[11px] font-medium">x{countOf(entry)}</span>
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
            const reward = infoOf(entry);
            // 今日/明日格子高亮，方便一眼看到「现在在哪一格」
            const isToday = attendanceData.todayIndex === idx;
            const isTomorrow = attendanceData.tomorrowIndex === idx;
            return (
              <div
                key={idx}
                className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border ${
                  entry.done
                    ? "border-default-200 bg-default-50 opacity-45"
                    : isToday
                      ? "border-warning ring-1 ring-warning/40"
                      : isTomorrow
                        ? "border-separator border-dashed"
                        : "border-separator"
                }`}
              >
                <span className={`text-[11px] font-medium ${isToday ? "text-warning-text" : "text-muted"}`}>
                  {t("card:attendance_day", { day: idx + 1 })}
                </span>
                {renderRewardIcon(entry)}
                {reward && (
                  <>
                    <span className="text-[11px] text-muted truncate w-full text-center">
                      {reward.name}
                    </span>
                    <span className="text-[11px] font-medium">x{countOf(entry)}</span>
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
