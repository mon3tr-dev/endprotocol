import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { GlassButton, GlassCard, GlassProgressCircle } from "@/components/ui/glass";
import { useTranslation } from "react-i18next";
import { BaseCardProps } from "../registry/types";
import { trackStartupTask } from "@/utils/startupProgress";
import { CardConfigService } from "@/utils/cardConfigService";
import { CardStartupService } from "@/cards/startup-service";
import type { AttendanceCardSettings } from "@/types/card-settings";
import { AttendanceSettingsModal } from "./attendance-settings-modal";
import { AttendanceRewardsModal } from "./attendance-rewards-modal";
import { getAccounts, type Account } from "@/utils/accountService";
import { Img } from "@/utils/imageLoader";
import { invoke } from "@tauri-apps/api/core";
import { logError } from "@/utils/logger";
import { addMessage } from "@/utils/messageStore";
import { resolveServerLabel } from "@/types";
import { AccountNameLine } from "@/components/ui/game-badge";
import { detectSignedToday } from "@/utils/attendanceHelpers";

const signedInRoleIds = new Set<string>();

/**
 * 启动时自动签到。
 *
 * 两个游戏的签到接口完全不同（终末地靠 `sk-game-role` 头寻址，明日方舟把
 * gameId+uid 放 body），命令也不同，因此这里先查账户的游戏再选命令。
 */
export async function startup(roleId: string) {
  if (!roleId || signedInRoleIds.has(roleId)) return;
  signedInRoleIds.add(roleId);
  try {
    const accounts = await getAccounts();
    const isArknights =
      accounts.find((a) => a.id === roleId)?.game === "arknights";
    await invoke<any>(
      isArknights ? "do_arknights_attendance" : "do_attendance",
      { roleId },
    );
  } catch (e) {
    logError("[Attendance] Startup sign-in failed:", e);
    throw e;
  }
}

export interface CalendarEntry {
  awardId: string;
  available: boolean;
  done: boolean;
}

export interface ResourceInfo {
  id: string;
  count: number;
  name: string;
  icon: string;
}

export interface AttendanceData {
  currentTs: string;
  calendar: CalendarEntry[];
  first: CalendarEntry[];
  resourceInfoMap: Record<string, ResourceInfo>;
  hasToday: boolean;
}

type AttendanceState = "loading" | "signed" | "unsigned" | "error";
type SignPhase = "idle" | "spinning" | "completing" | "done";

/**
 * 解析签到响应 —— 同时兼容两个游戏的返回：
 *
 * - 终末地 `get_attendance`（/web/v1/game/endfield/attendance）：
 *   日历项键名是 `awardId`，`resourceInfoMap[].icon` 是后端已下载好的本地路径，
 *   且自带 `hasToday`。
 * - 明日方舟 `get_arknights_attendance`（/api/v1/game/attendance）：
 *   日历项键名是 `resourceId`（count 直接在日历项上），物品图标后端不下发，
 *   `first` 可能为 null，也没有 `hasToday` —— 由前端按「当天项是否 done」推导。
 *
 * 图标统一走 Arknights CDN（`web.hycdn.cn/arknights/game/assets/item/{id}.png`，
 * 已实测 200），经 Img/cacheManager 自动下载缓存。
 */
export function parseAttendanceData(json: any): AttendanceData | null {
  try {
    const data = json?.data;
    const rawCalendar = data?.calendar;
    const rawResourceMap = data?.resourceInfoMap;
    if (!rawCalendar || !rawResourceMap) return null;

    const isArknights = Array.isArray(rawCalendar)
      ? rawCalendar.some((e: any) => e?.resourceId !== undefined)
      : false;

    const calendar: CalendarEntry[] = isArknights
      ? rawCalendar.map((e: any) => ({
          awardId: String(e.resourceId ?? ""),
          available: Boolean(e.available),
          done: Boolean(e.done),
        }))
      : rawCalendar;

    // 「今天是否已签到」
    //
    // 终末地直接给 `hasToday`；明日方舟没有这个字段，需要自己推。两条路：
    // 1. 当天的日历项 —— calendar 是本月日历，第 N 天就是第 N 格，`done` 即答案；
    // 2. 签到记录 —— `records[].ts` 是签到时刻，落在 currentTs 所在自然日即已签。
    //
    // ⚠️ 不用 `available` 判定：实测明日方舟的日历项里 `available` 恒为 false
    // （它不是终末地那个「今天可领取」的语义），拿它判断会永远判成未签。
    let hasToday = Boolean(data?.hasToday);
    if (isArknights) {
      hasToday = detectSignedToday(rawCalendar, data);
    }

    const resourceInfoMap: Record<string, ResourceInfo> = {};
    for (const [id, entry] of Object.entries<any>(rawResourceMap)) {
      resourceInfoMap[id] = {
        id,
        // 终末地 count 在 map 里；明日方舟 count 在日历项上，这里只做展示兜底
        count: Number(entry?.count ?? 0),
        name: String(entry?.name ?? ""),
        icon:
          entry?.icon ??
          (isArknights
            ? `https://web.hycdn.cn/arknights/game/assets/item/${id}.png`
            : ""),
      };
    }

    // 明日方舟的月度累计奖励：resourceInfoMap 里同 id 出现多次时 count 累加
    if (isArknights) {
      const countById = new Map<string, number>();
      for (const e of rawCalendar) {
        const id = String(e?.resourceId ?? "");
        countById.set(id, (countById.get(id) ?? 0) + Number(e?.count ?? 0));
      }
      for (const [id, total] of countById) {
        if (resourceInfoMap[id]) resourceInfoMap[id].count = total;
      }
    }

    // first（首充/首签奖励）：终末地是数组，明日方舟实测为 null
    const rawFirst = Array.isArray(data?.first) ? data.first : [];

    return {
      currentTs: String(data?.currentTs ?? ""),
      calendar,
      first: rawFirst,
      resourceInfoMap,
      hasToday,
    };
  } catch {
    return null;
  }
}

function findTodayEntry(calendar: CalendarEntry[]): { index: number; entry: CalendarEntry } | null {
  const unsignedIdx = calendar.findIndex((e) => e.available && !e.done);
  if (unsignedIdx >= 0) return { index: unsignedIdx, entry: calendar[unsignedIdx] };
  const doneIdx = findLastIndex(calendar, (e) => e.done);
  if (doneIdx >= 0) return { index: doneIdx, entry: calendar[doneIdx] };
  if (calendar.length > 0) return { index: 0, entry: calendar[0] };
  return null;
}

function findLastIndex<T>(arr: T[], predicate: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) return i;
  }
  return -1;
}

export default function AttendanceCard({
  roleId: _roleId,
  cardId,
}: BaseCardProps) {
  const { t, i18n } = useTranslation();
  const [settings, setSettings] = useState<AttendanceCardSettings>({});
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [isFirstTimeSetup, setIsFirstTimeSetup] = useState(false);
  const [firstTimePrompt, setFirstTimePrompt] = useState(true);
  const [autoSignEnabled, setAutoSignEnabled] = useState(false);
  const [showRewardsModal, setShowRewardsModal] = useState(false);

  const [attendanceData, setAttendanceData] = useState<AttendanceData | null>(null);
  const [attendanceState, setAttendanceState] = useState<AttendanceState>("loading");
  const [signPhase, setSignPhase] = useState<SignPhase>("idle");
  const [_signError, setSignError] = useState<string | null>(null);

  const [accountCache, setAccountCache] = useState<Account[]>([]);
  /**
   * 账户列表的 ref 镜像。
   *
   * 分流（明日方舟走哪个命令）要读角色的 `game` 字段，但 `fetchAttendance` 若把
   * `accountCache` 放进依赖数组，就会与「加载账户」的 effect 互相触发、无限重拉。
   * 因此用 ref 读取最新值，依赖数组保持稳定。
   */
  const accountCacheRef = useRef<Account[]>([]);
  const completionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /** 该角色属于哪个游戏（缓存缺失时按终末地，与后端默认一致）。 */
  const gameOfRole = useCallback((roleId: string) => {
    const found = accountCacheRef.current.find((a) => a.id === roleId);
    return found?.game === "arknights" ? "arknights" : "endfield";
  }, []);

  const lang = i18n.language;

  const checkAutoSign = useCallback(async (roleId: string | undefined) => {
    if (roleId) {
      const enabled = await CardStartupService.isAutoSignEnabled(roleId);
      setAutoSignEnabled(enabled);
    } else {
      setAutoSignEnabled(false);
    }
  }, []);

  const openFirstTimePrompt = useCallback(() => {
    setIsFirstTimeSetup(true);
    setShowSettingsModal(true);
  }, []);

  const openSettings = useCallback(() => {
    setIsFirstTimeSetup(false);
    setShowSettingsModal(true);
    checkAutoSign(settings.selectedRoleId);
  }, [settings.selectedRoleId, checkAutoSign]);

  const openRewardsModal = useCallback(() => {
    if (!attendanceData) return;
    setShowRewardsModal(true);
  }, [attendanceData]);

  const loadSettings = useCallback(async () => {
    try {
      const s = await CardConfigService.getCardSettings<AttendanceCardSettings>(cardId);
      setSettings(s);
      setSettingsLoaded(true);
      checkAutoSign(s.selectedRoleId);
      if (!s.selectedRoleId && firstTimePrompt) {
        openFirstTimePrompt();
      }
    } catch (e) {
      logError("[Attendance] Failed to load settings:", e);
      setSettingsLoaded(true);
    }
  }, [cardId, firstTimePrompt, checkAutoSign, openFirstTimePrompt]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const fetchAttendance = useCallback(async () => {
    const rid = settings.selectedRoleId;
    if (!rid) return;
    setAttendanceState("loading");
    setSignError(null);
    try {
      // 按角色的游戏分流：明日方舟走 /api/v1/game/attendance，终末地走 /web/v1/...
      const isArknights = gameOfRole(rid) === "arknights";
      const result = await trackStartupTask(
        invoke<any>(
          isArknights ? "get_arknights_attendance" : "get_attendance",
          { roleId: rid },
        ),
      );
      const parsed = parseAttendanceData(result);
      if (!parsed) {
        setAttendanceState("error");
        setSignError(t("card:attendance_error"));
        return;
      }
      setAttendanceData(parsed);
      setAttendanceState(parsed.hasToday ? "signed" : "unsigned");
    } catch (e) {
      logError("[Attendance] GET failed:", e);
      setAttendanceState("error");
      setSignError(String(e));
    }
  }, [settings.selectedRoleId, gameOfRole, t]);

  const loadAccounts = useCallback(async () => {
    try {
      const accs = await getAccounts();
      accountCacheRef.current = accs;
      setAccountCache(accs);
    } catch (e) {
      logError("[Attendance] Failed to get accounts:", e);
    }
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    if (!settings.selectedRoleId) {
      setAttendanceState("unsigned");
      return;
    }
    // 先拿账户列表再拉签到：分流要靠 accountCache 里该角色的 game 字段，
    // 顺序反了第一拉永远走终末地命令（对明日方舟角色必然报错）。
    void loadAccounts().then(() => fetchAttendance());
  }, [settingsLoaded, settings.selectedRoleId, fetchAttendance, loadAccounts]);

  const completeSignIn = useCallback(() => {
    setSignPhase("completing");
    completionTimer.current = setTimeout(() => {
      setSignPhase("done");
      setAttendanceState("signed");
      fetchAttendance();
    }, 600);
  }, [fetchAttendance]);

  const handleSignIn = useCallback(async () => {
    if (signPhase !== "idle" || attendanceState === "signed") return;
    const rid = settings.selectedRoleId;
    if (!rid) {
      openSettings();
      return;
    }
    setSignPhase("spinning");
    setSignError(null);
    try {
      // 与查询同一套分流：明日方舟签到把 gameId+uid 放 body（后端处理），命令不同
      const isArknights = gameOfRole(rid) === "arknights";
      const result = await invoke<any>(
        isArknights ? "do_arknights_attendance" : "do_attendance",
        { roleId: rid },
      );
      // 终末地把「请勿重复签到」(code 10001) 视为幂等成功；明日方舟非 0 时
      // 后端已折成空奖励数组（幂等成功），两种情况都走成功文案。
      const alreadySigned = result?.code === 10001;
      addMessage({
        type: "info",
        title: t(alreadySigned ? "card:attendance_already_signed" : "card:attendance_sign_success"),
        tag: "attendance",
      });
      completeSignIn();
    } catch (e) {
      logError("[Attendance] POST failed:", e);
      addMessage({ type: "urgent", title: t("card:attendance_sign_failed"), body: String(e), tag: "attendance" });
      setSignError(String(e));
      setSignPhase("idle");
    }
  }, [signPhase, attendanceState, settings.selectedRoleId, gameOfRole, completeSignIn, t]);

  useEffect(() => {
    return () => {
      if (completionTimer.current) clearTimeout(completionTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!settings.selectedRoleId) return;
    const roleId = settings.selectedRoleId;

    const status = CardStartupService.getTaskStatus(roleId);
    if (status?.status === "running") {
      setSignPhase("spinning");
    }

    const unsub1 = CardStartupService.subscribe(roleId, (newStatus) => {
      if (newStatus.status === "running") {
        setSignPhase("spinning");
      } else if (newStatus.status === "done" || newStatus.status === "error") {
        fetchAttendance();
      }
    });

    const unsub2 = CardStartupService.onAutoSignChanged((changedRoleId, enabled) => {
      if (changedRoleId === roleId) {
        setAutoSignEnabled(enabled);
      }
    });

    return () => { unsub1(); unsub2(); };
  }, [settings.selectedRoleId, fetchAttendance]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { cardId: string; action: string } | undefined;
      if (detail?.cardId === cardId && detail?.action === "settings") {
        openSettings();
      }
    };
    window.addEventListener("cardAction", handler);
    return () => window.removeEventListener("cardAction", handler);
  }, [cardId, openSettings]);

  const handleSaveSettings = useCallback(
    async (newRoleId: string | undefined, autoSign: boolean) => {
      try {
        const oldRoleId = settings.selectedRoleId;

        await CardConfigService.updateCardSetting(cardId, "selectedRoleId", newRoleId);
        setSettings({ selectedRoleId: newRoleId });
        setAutoSignEnabled(autoSign);
        setFirstTimePrompt(false);

        await CardStartupService.updateUserMapping(cardId, newRoleId);

        if (oldRoleId && oldRoleId !== newRoleId) {
          const siblingIds = await CardStartupService.getCardIdsByUser(oldRoleId);
          if (siblingIds.length <= 1) {
            await CardStartupService.removeAutoSignUser(oldRoleId);
          }
        }
        if (newRoleId) {
          if (autoSign) {
            await CardStartupService.addAutoSignUser(newRoleId);
          } else {
            const siblingIds = await CardStartupService.getCardIdsByUser(newRoleId);
            if (siblingIds.length <= 1) {
              await CardStartupService.removeAutoSignUser(newRoleId);
            }
          }
        }
      } catch (e) {
        logError("[Attendance] Failed to save settings:", e);
      }
    },
    [cardId, settings.selectedRoleId],
  );

  const selectedAccount = useMemo(
    () => accountCache.find((a) => a.id === settings.selectedRoleId),
    [accountCache, settings.selectedRoleId],
  );

  const todayReward = useMemo(() => {
    if (!attendanceData) return null;
    const today = findTodayEntry(attendanceData.calendar);
    if (!today) return null;
    return attendanceData.resourceInfoMap[today.entry.awardId] ?? null;
  }, [attendanceData]);

  const todayClaimed = useMemo(() => {
    if (!attendanceData) return false;
    const today = findTodayEntry(attendanceData.calendar);
    return today ? today.entry.done : false;
  }, [attendanceData]);

  const tomorrowReward = useMemo(() => {
    if (!attendanceData) return null;
    const today = findTodayEntry(attendanceData.calendar);
    if (!today) return null;
    const tomorrowEntry = attendanceData.calendar[today.index + 1];
    if (!tomorrowEntry) return null;
    return attendanceData.resourceInfoMap[tomorrowEntry.awardId] ?? null;
  }, [attendanceData]);

  const tomorrowClaimed = useMemo(() => {
    if (!attendanceData) return false;
    const today = findTodayEntry(attendanceData.calendar);
    if (!today) return false;
    const tomorrowEntry = attendanceData.calendar[today.index + 1];
    return tomorrowEntry ? tomorrowEntry.done : false;
  }, [attendanceData]);

  if (!settingsLoaded) {
    return (
      <GlassCard className="p-3  border border-separator/90 h-full w-full flex items-center justify-center">
        <GlassProgressCircle isIndeterminate size="sm" aria-label={t("a11y.loading")} className="text-primary">
          <GlassProgressCircle.Track>
            <GlassProgressCircle.TrackCircle />
            <GlassProgressCircle.FillCircle />
          </GlassProgressCircle.Track>
        </GlassProgressCircle>
      </GlassCard>
    );
  }

  const showSignButton = attendanceState === "unsigned" && signPhase === "idle";
  const isSpinning = signPhase === "spinning" || signPhase === "completing";
  const isDone = signPhase === "done" || attendanceState === "signed";

  const R = 22;
  const CIRCUMFERENCE = 2 * Math.PI * R;
  const circleProps = { cx: 26, cy: 26, r: R, fill: "none", strokeWidth: 3 };

  function renderRewardBox(
    label: string,
    reward: ResourceInfo | null,
    claimed: boolean,
  ) {
    return (
      <div className="flex-1 min-w-0">
        <p className="text-[9px] text-muted mb-1">{label}</p>
        {reward ? (
          <div className={`flex items-center gap-1.5 ${claimed ? "opacity-40" : ""}`}>
            <div className="relative w-6 h-6 shrink-0">
              <Img
                src={reward.icon}
                alt={reward.name}
                className="w-full h-full object-contain rounded"
              />
              {claimed && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <svg className="w-5 h-5 text-default-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </div>
            <div className="min-w-0 leading-tight">
              <p className="text-[10px] font-medium truncate">{reward.name}</p>
              <p className="text-[10px] text-muted">{reward.count}</p>
            </div>
          </div>
        ) : (
          <p className="text-[10px] text-muted">--</p>
        )}
      </div>
    );
  }

  return (
    <>
      <GlassCard className="p-0  border border-separator/90 h-full w-full select-none rounded-[10px] overflow-hidden flex flex-col">
        <div
          className="flex h-full p-2.5 gap-2.5 cursor-pointer"
          onClick={openRewardsModal}
        >
          <div className="flex items-center justify-center shrink-0 w-[68px]">
            {!settings.selectedRoleId ? (
              <div className="flex flex-col items-center gap-1.5">
                <svg className="w-6 h-6 text-muted opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                <GlassButton size="sm" variant="secondary" className="text-[9px] !h-5 !min-w-0 !px-1.5" onPress={openSettings}>
                  {t("card:attendance_select_account")}
                </GlassButton>
              </div>
            ) : attendanceState === "error" && signPhase === "idle" ? (
              <div className="flex flex-col items-center gap-1.5">
                <svg className="w-5 h-5 text-danger-text opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <GlassButton size="sm" variant="secondary" className="text-[9px] !h-5 !min-w-0 !px-1.5" onPress={fetchAttendance}>
                  {t("card:attendance_refresh")}
                </GlassButton>
              </div>
            ) : attendanceState === "loading" && signPhase === "idle" ? (
              <div className="relative w-[68px] h-[68px]">
                <svg className="w-[68px] h-[68px]" viewBox="0 0 52 52">
                  <circle
                    cx={26} cy={26} r={22}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={3}
                    className="text-warning/20"
                  />
                  <circle
                    cx={26} cy={26} r={22}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 22 * 0.25} ${2 * Math.PI * 22 * 0.75}`}
                    className="text-warning-text"
                    style={{
                      transformOrigin: "26px 26px",
                      transform: "rotate(-90deg)",
                      animation: "attendance-spin-arc 1s linear infinite",
                    }}
                  />
                </svg>
              </div>
            ) : showSignButton ? (
              <div
                className="flex flex-col items-center cursor-pointer hover:opacity-70 transition-opacity"
                onClick={(e) => { e.stopPropagation(); handleSignIn(); }}
              >
                <svg className="w-9 h-9 text-warning-text" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                </svg>
              </div>
            ) : (
              <div className="relative w-[68px] h-[68px]">
                <svg className="w-[68px] h-[68px]" viewBox="0 0 52 52">
                  {isSpinning && (
                    <circle
                      {...circleProps}
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeDasharray={`${CIRCUMFERENCE * 0.25} ${CIRCUMFERENCE * 0.75}`}
                      strokeDashoffset="0"
                      className="text-warning-text"
                      style={{
                        transformOrigin: "26px 26px",
                        transform: "rotate(-90deg)",
                        animation: "attendance-spin-arc 1s linear infinite",
                      }}
                    />
                  )}

                  {isDone && (
                    <>
                      <circle
                        {...circleProps}
                        stroke="currentColor"
                        className="text-success-text"
                        style={{
                          animation: "attendance-ring-in 0.35s ease-out forwards",
                          transformOrigin: "26px 26px",
                          transform: "scale(0)",
                          opacity: 0,
                        }}
                      />
                      <path
                        d="M18 26l5 5 11-11"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-success-text"
                        style={{
                          animation: "attendance-check-in 0.35s ease-out 0.25s forwards",
                          strokeDasharray: "20",
                          strokeDashoffset: "20",
                          opacity: 0,
                        }}
                      />
                    </>
                  )}
                </svg>
              </div>
            )}
          </div>

          <div className="flex-1 flex flex-col min-w-0 gap-1.5">
            {selectedAccount ? (
              <div
                className="flex items-center gap-1.5 cursor-pointer hover:opacity-70 transition-opacity"
                onClick={(e) => { e.stopPropagation(); openSettings(); }}
              >
                <div className="w-5 h-5 rounded overflow-hidden shrink-0">
                  {selectedAccount.avatar ? (
                    <Img
                      src={selectedAccount.avatar}
                      alt={selectedAccount.nickname}
                      className="w-full h-full avatar-feather"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[7px] text-muted font-semibold">
                      {selectedAccount.nickname.charAt(0)}
                    </div>
                  )}
                </div>
                <div className="min-w-0 leading-tight">
                  <p className="text-[11px] font-medium truncate">
                    <AccountNameLine game={selectedAccount.game}>
                      {selectedAccount.nickname}
                    </AccountNameLine>
                  </p>
                  <p className="text-[9px] text-muted truncate">
                    {resolveServerLabel(selectedAccount.server, lang)}
                    {settings.selectedRoleId && autoSignEnabled && (
                      <span className="ml-1 text-[8px] text-success-text">●</span>
                    )}
                  </p>
                </div>
              </div>
            ) : (
              <div
                className="flex items-center gap-1 cursor-pointer hover:opacity-70 transition-opacity"
                onClick={(e) => { e.stopPropagation(); openSettings(); }}
              >
                <svg className="w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                <span className="text-[10px] text-muted">{t("card:attendance_no_account")}</span>
              </div>
            )}

            <div className="flex gap-2 flex-1">
              {renderRewardBox(t("card:attendance_today"), todayReward, todayClaimed)}
              <div className="w-px bg-separator self-stretch" />
              {renderRewardBox(t("card:attendance_tomorrow"), tomorrowReward, tomorrowClaimed)}
            </div>
          </div>
        </div>
      </GlassCard>

      <AttendanceSettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        selectedRoleId={settings.selectedRoleId}
        autoSign={autoSignEnabled}
        showAutoSign={!isFirstTimeSetup}
        onSave={handleSaveSettings}
      />

      <AttendanceRewardsModal
        isOpen={showRewardsModal}
        onClose={() => setShowRewardsModal(false)}
        attendanceData={attendanceData}
      />

      <style>{`
        @keyframes attendance-spin-arc {
          from { transform: rotate(-90deg); }
          to { transform: rotate(270deg); }
        }
        @keyframes attendance-ring-in {
          from { transform: scale(0); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        @keyframes attendance-check-in {
          from { stroke-dashoffset: 20; opacity: 0; }
          to { stroke-dashoffset: 0; opacity: 1; }
        }
      `}</style>
    </>
  );
}
