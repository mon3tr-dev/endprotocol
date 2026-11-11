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
import { resolveServerLabel } from "@/types";
import { AccountNameLine } from "@/components/ui/game-badge";
import { detectSignedToday, resolveSlotIndices } from "@/utils/attendanceHelpers";
import {
  fetchAttendanceRaw,
  signInWithFeedback,
} from "@/utils/attendanceService";

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
  /**
   * 该格自己的奖励数量。
   *
   * ⚠️ 明日方舟同一个 `resourceId` 在不同格的数量是**不一样**的
   * （实测 `4001` 龙门币在 30 格里 500/1000 混排），所以数量必须逐格携带，
   * 不能按 id 去 `resourceInfoMap` 里查或累加 —— 早期版本按 id 累加，
   * 界面上每一格都显示「整个月的总量」，是错的。
   */
  count: number;
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
  /** 今天是否已签到 */
  hasToday: boolean;
  /** 今日 / 明日奖励在 `calendar` 里的下标（越界为 null） */
  todayIndex: number | null;
  tomorrowIndex: number | null;
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
 *   日历项键名是 `resourceId`（`count` 直接在日历项上），物品图标接口**不下发**，
 *   后端已按 `resourceId` 补成
 *   `https://web.hycdn.cn/arknights/game/assets/item/{id}.png`；
 *   `first` 可能为 null；`hasToday` / `todayIndex` / `tomorrowIndex` 由后端算好。
 *
 * ⚠️ 明日方舟的 `calendar` 是「累计 30 格领取轨道」，下标与「几号」无关。
 * 数量必须逐格取（同 id 不同格数量不同），判定与下标见
 * `@/utils/attendanceHelpers`。
 */
export function parseAttendanceData(json: any): AttendanceData | null {
  try {
    // 兼容两种形状：森空岛外壳 `{code, message, data}`（终末地原始响应、明日方舟
    // 也包成同一形状）与「后端直接把 data 本身返回」。少了这层兼容，一旦某个命令
    // 忘了包 `data`，界面只会显示「获取签到数据失败」，排查成本极高。
    const data =
      json?.data && typeof json.data === "object" && !Array.isArray(json.data)
        ? json.data
        : json;
    const rawCalendar = data?.calendar;
    const rawResourceMap = data?.resourceInfoMap;
    if (!Array.isArray(rawCalendar) || !rawResourceMap) return null;

    const isArknights = Array.isArray(rawCalendar)
      ? rawCalendar.some((e: any) => e?.resourceId !== undefined)
      : false;

    const calendar: CalendarEntry[] = isArknights
      ? rawCalendar.map((e: any) => ({
          awardId: String(e.resourceId ?? ""),
          available: Boolean(e.available),
          done: Boolean(e.done),
          // 逐格携带数量：同一 resourceId 在不同格的数量不同
          count: Number(e.count ?? 0),
        }))
      : rawCalendar;

    const resourceInfoMap: Record<string, ResourceInfo> = {};
    for (const [id, entry] of Object.entries<any>(rawResourceMap)) {
      resourceInfoMap[id] = {
        id,
        // 终末地 count 在 map 里；明日方舟 count 在日历项上（这里只做兜底）
        count: Number(entry?.count ?? 0),
        name: String(entry?.name ?? ""),
        // 明日方舟后端已补好 icon；缺失时按同一条规则兜底
        icon:
          entry?.icon ??
          (isArknights
            ? `https://web.hycdn.cn/arknights/game/assets/item/${id}.png`
            : ""),
      };
    }

    // 「今天是否已签到」：明日方舟没有 `hasToday` 字段的旧响应要靠本地推
    const hasToday = isArknights
      ? detectSignedToday(rawCalendar, data)
      : Boolean(data?.hasToday);

    // 今日 / 明日奖励下标
    const { todayIndex, tomorrowIndex } = isArknights
      ? resolveSlotIndices(rawCalendar, data)
      : resolveSlotIndices(rawCalendar, null);

    // first（首签奖励）：终末地是数组，明日方舟实测为 null
    const rawFirst = Array.isArray(data?.first) ? data.first : [];

    return {
      currentTs: String(data?.currentTs ?? ""),
      calendar,
      first: rawFirst,
      resourceInfoMap,
      hasToday,
      todayIndex,
      tomorrowIndex,
    };
  } catch {
    return null;
  }
}

/** 取某一格奖励的展示信息（数量取该格自己的 `count`） */
export function rewardAt(
  data: AttendanceData | null,
  index: number | null,
): ResourceInfo | null {
  if (!data || index === null) return null;
  const entry = data.calendar[index];
  if (!entry) return null;
  const info = data.resourceInfoMap[entry.awardId];
  if (!info) return null;
  // 数量优先用日历格自己的（明日方舟）；终末地没有逐格 count 时退回 map 里的
  return { ...info, count: entry.count || info.count };
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
      // 按角色的游戏分流（明日方舟 / 终末地），逻辑收敛在 attendanceService
      const result = await trackStartupTask(
        fetchAttendanceRaw(rid, gameOfRole(rid)),
      );
      const parsed = parseAttendanceData(result);
      if (!parsed) {
        // 解析失败时把「后端到底给了什么」记进日志，否则只显示一句通用错误，
        // 排查时无从下手（历史上就踩过「后端少包一层 data」这个坑）。
        logError(
          "[Attendance] parseAttendanceData returned null; raw response keys:",
          JSON.stringify({
            topLevel: result && typeof result === "object" ? Object.keys(result) : typeof result,
            dataKeys:
              result?.data && typeof result.data === "object"
                ? Object.keys(result.data)
                : typeof result?.data,
            code: result?.code,
            message: result?.message,
          }),
        );
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
    // 分流 + 幂等判定 + 提示文案都收敛在 attendanceService（与签到页面共用）
    const ok = await signInWithFeedback(rid, gameOfRole(rid), t);
    if (ok) {
      completeSignIn();
    } else {
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
      } else if (detail?.cardId === cardId && detail?.action === "refresh") {
        void fetchAttendance();
      }
    };
    window.addEventListener("cardAction", handler);
    return () => window.removeEventListener("cardAction", handler);
  }, [cardId, openSettings, fetchAttendance]);

  const handleSaveSettings = useCallback(
    async (newRoleId: string | undefined, autoSign: boolean) => {
      try {
        const oldRoleId = settings.selectedRoleId;

        await CardConfigService.updateCardSetting(cardId, "selectedRoleId", newRoleId);
        setSettings({ selectedRoleId: newRoleId });
        setAutoSignEnabled(autoSign);
        setFirstTimePrompt(false);

        await CardStartupService.updateUserMapping(cardId, newRoleId);

        // 自动签到是**按角色的全局开关**（`card_auto_sign_users`），与卡片实例无关：
        // - 换角色时，旧角色是否还要保留自动签到，由批量签到弹窗/其他卡片决定，
        //   这里不再用「兄弟卡片数量」去猜，避免误关其他卡片的开关；
        // - 直接 `setAutoSign` 写目标值并广播，保证弹窗、其他卡片的开关同步刷新
        //   （`add/removeAutoSignUser` 在值未变化时不广播，会造成多处显示不一致）。
        if (newRoleId) {
          await CardStartupService.setAutoSign(newRoleId, autoSign);
        }
        // 旧角色若已无任何卡片引用，也保留其自动签到设置 —— 这是用户显式开过的
        // 全局选项，不该因为卡片换绑而被静默关闭。
        void oldRoleId;
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

  const todayReward = useMemo(
    () => rewardAt(attendanceData, attendanceData?.todayIndex ?? null),
    [attendanceData],
  );

  const todayClaimed = useMemo(() => {
    if (!attendanceData || attendanceData.todayIndex === null) return false;
    return Boolean(attendanceData.calendar[attendanceData.todayIndex]?.done);
  }, [attendanceData]);

  const tomorrowReward = useMemo(
    () => rewardAt(attendanceData, attendanceData?.tomorrowIndex ?? null),
    [attendanceData],
  );

  const tomorrowClaimed = useMemo(() => {
    if (!attendanceData || attendanceData.tomorrowIndex === null) return false;
    return Boolean(attendanceData.calendar[attendanceData.tomorrowIndex]?.done);
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
