import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { Img } from "@/utils/imageLoader";
import logger from "@/utils/logger";
import { loadTheme } from "@/utils/theme";
import { MorphIcon } from "morphicons/react";
import type { IconInput } from "morphicons";
import {
  ArrowUpRight,
  CalendarDays,
  CircleUserRound,
  Power,
  Ticket,
  Trophy,
  Zap,
} from "lucide";

interface TrayUserInfo {
  roleId?: string;
  nickname?: string;
  avatar?: string;
  curStamina?: number;
  maxStamina?: number;
  maxTs?: number;
  dailyActivation?: number;
  maxDailyActivation?: number;
  weeklyScore?: number;
  weeklyTotal?: number;
  bpCurLevel?: number;
  bpMaxLevel?: number;
}

/** 理智自然回复间隔（秒）：每 6 分钟 1 点，与 account-progress 卡片保持一致 */
const STAMINA_REFILL_SECONDS = 432;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** 秒数 → HH:MM:SS 倒计时 */
function formatCountdown(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

function clampPercent(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(100, Math.max(0, (value / max) * 100));
}

/**
 * 托盘面板中的一行进度指标：图标 + 标签 + 数值 + 细进度条。
 * 排版语言与主界面的 account-progress 卡片保持一致。
 */
function MetricRow({
  icon: Icon,
  label,
  current,
  max,
  hint,
  valueText,
}: {
  icon: IconInput;
  label: string;
  current: number;
  max: number;
  hint?: string;
  valueText?: string;
}) {
  const percent = clampPercent(current, max);
  const filled = percent >= 100;

  return (
    <div className="rounded-xl px-2.5 py-1.5 transition-colors duration-200 hover:bg-default-100/60">
      <div className="flex items-center gap-2">
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-colors duration-200 ${
            filled ? "bg-success/15 text-success" : "bg-primary/15 text-primary"
          }`}
        >
          <MorphIcon icon={Icon} size={13} />
        </span>

        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
          {label}
        </span>

        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-foreground">
          {valueText ?? `${current}/${max}`}
        </span>
      </div>

      <div className="mt-1 flex items-center gap-2 pl-8">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-default-200/70">
          <div
            className={`h-full rounded-full transition-all duration-500 ease-out ${
              filled ? "bg-success" : "bg-gradient-to-r from-primary/70 to-primary"
            }`}
            style={{ width: `${percent}%` }}
          />
        </div>
        {hint && (
          <span className="shrink-0 text-[9px] tabular-nums text-muted">
            {hint}
          </span>
        )}
      </div>
    </div>
  );
}

/** 头像：圆角 + 首字母回退，图片加载失败时降级而不留空洞 */
function Avatar({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const letter = (alt.charAt(0) || "?").toUpperCase();
  const showImage = Boolean(src) && !failed;

  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden rounded-lg bg-primary/15 text-xs font-bold text-primary ${className ?? ""}`}
    >
      {showImage ? (
        <Img
          src={src}
          alt={alt}
          className="h-full w-full object-cover avatar-feather"
          onError={() => setFailed(true)}
        />
      ) : (
        letter
      )}
    </div>
  );
}

export function TrayPanel() {
  const { t } = useTranslation();
  const [userInfo, setUserInfo] = useState<TrayUserInfo>({});
  const [now, setNow] = useState(() => Date.now());

  const loadUserInfo = useCallback(async () => {
    try {
      const info = await invoke<TrayUserInfo>("get_tray_user_info");
      setUserInfo(info ?? {});
    } catch (error) {
      logger.warn("Failed to load tray user info: " + error, null, "TrayPanel");
    }
  }, []);

  useEffect(() => {
    void loadUserInfo();

    const unlistenUpdate = listen<TrayUserInfo>(
      "tray-user-info-updated",
      (event) => {
        setUserInfo(event.payload ?? {});
      },
    );

    const win = getCurrentWindow();
    // 面板每次被弹出时刷新时间基准、重新拉取数据并重读主题
    //（设置页拖动「毛玻璃清晰度」只写配置、不发事件，聚焦时重读才能跟上）
    const unlistenFocus = win.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        setNow(Date.now());
        void loadUserInfo();
        void loadTheme().catch(() => {
          // 主题重读失败时保持现有观感，不影响数据展示
        });
      } else {
        void win.hide();
      }
    });

    const timer = window.setInterval(() => setNow(Date.now()), 1000);

    return () => {
      void unlistenUpdate.then((fn) => fn());
      void unlistenFocus.then((fn) => fn());
      window.clearInterval(timer);
    };
  }, [loadUserInfo]);

  const hasUser = Boolean(userInfo.roleId);
  const nickname = userInfo.nickname ?? "";
  const maxStamina = userInfo.maxStamina ?? 0;
  const maxTs = userInfo.maxTs ?? 0;

  /**
   * 按 maxTs 与自然回复速率推算当前理智，使面板与主界面显示一致，
   * 而不是停留在上次同步时的静态值。
   */
  const stamina = useMemo(() => {
    const stored = userInfo.curStamina ?? 0;
    if (maxStamina <= 0 || maxTs <= 0) {
      return {
        current: stored,
        fullInSeconds: 0,
        nextRefillSeconds: 0,
        isFull: maxStamina > 0 && stored >= maxStamina,
        hasTimer: false,
      };
    }

    const nowSec = now / 1000;
    const unitsBelowMax = (maxTs - nowSec) / STAMINA_REFILL_SECONDS;
    const live = Math.min(
      Math.max(Math.floor(maxStamina - unitsBelowMax), 0),
      maxStamina,
    );

    if (live >= maxStamina) {
      return {
        current: maxStamina,
        fullInSeconds: 0,
        nextRefillSeconds: 0,
        isFull: true,
        hasTimer: true,
      };
    }

    const nextRefillTs =
      maxTs - (maxStamina - live - 1) * STAMINA_REFILL_SECONDS;

    return {
      current: live,
      fullInSeconds: Math.max(0, maxTs - nowSec),
      nextRefillSeconds: Math.max(0, nextRefillTs - nowSec),
      isFull: false,
      hasTimer: true,
    };
  }, [userInfo.curStamina, maxStamina, maxTs, now]);

  const dailyCurrent = userInfo.dailyActivation ?? 0;
  const dailyMax = userInfo.maxDailyActivation ?? 0;
  const weeklyCurrent = userInfo.weeklyScore ?? 0;
  const weeklyMax = userInfo.weeklyTotal ?? 0;
  const bpCurrent = userInfo.bpCurLevel ?? 0;
  const bpMax = userInfo.bpMaxLevel ?? 0;

  const handleShowMain = async () => {
    try {
      await invoke("show_main_window");
    } catch (error) {
      logger.error("Failed to show main window: " + error, null, "TrayPanel");
      try {
        await getCurrentWindow().hide();
      } catch {
        // 面板窗口已不可用，忽略
      }
    }
  };

  const handleQuit = async () => {
    try {
      await invoke("app_quit");
    } catch (error) {
      logger.error("Failed to quit application: " + error, null, "TrayPanel");
    }
  };

  return (
    <div className="flex h-full w-full select-none flex-col overflow-hidden rounded-[10px] glass-native text-foreground animate-scale-in">
      {/* 顶部品牌区 — 与标题栏一致：主题色圆点 + 全大写字距标题 */}
      <header className="flex shrink-0 items-center justify-between gap-2 px-3 pb-2 pt-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60"
            aria-hidden="true"
          />
          <span className="truncate text-[10px] font-bold tracking-widest">
            {t("tray.title")}
          </span>
        </div>
        {hasUser && (
          <span className="shrink-0 rounded-full bg-default-100/80 px-1.5 py-0.5 text-[9px] font-medium text-muted">
            {t("tray.level")} {bpCurrent}
          </span>
        )}
      </header>

      {/* 用户概览 */}
      {hasUser ? (
        <>
          <div className="shrink-0 px-3 pb-2">
            <div className="flex items-center gap-2.5 rounded-xl bg-default-100/50 p-2">
              <Avatar
                src={userInfo.avatar ?? ""}
                alt={nickname}
                className="h-9 w-9 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-semibold text-foreground">
                  {nickname || t("tray.no_user")}
                </p>
                <p className="truncate text-[9px] text-muted">
                  {stamina.hasTimer && !stamina.isFull
                    ? `${t("tray.next_refill")} ${formatCountdown(stamina.nextRefillSeconds)}`
                    : `${t("tray.stamina")} · ${t("tray.full")}`}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <span className="font-mono text-base font-bold leading-none tabular-nums text-foreground">
                  {stamina.current}
                </span>
                <span className="text-[9px] font-normal text-muted">
                  /{maxStamina}
                </span>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5">
            <MetricRow
              icon={Zap}
              label={t("tray.stamina")}
              current={stamina.current}
              max={maxStamina}
              hint={
                stamina.isFull
                  ? t("tray.full")
                  : stamina.hasTimer
                    ? `${t("tray.recover_in")} ${formatCountdown(stamina.fullInSeconds)}`
                    : undefined
              }
            />
            <MetricRow
              icon={CalendarDays}
              label={t("tray.daily_activity")}
              current={dailyCurrent}
              max={dailyMax}
            />
            <MetricRow
              icon={Trophy}
              label={t("tray.weekly")}
              current={weeklyCurrent}
              max={weeklyMax}
            />
            <MetricRow
              icon={Ticket}
              label={t("tray.battle_pass")}
              current={bpCurrent}
              max={bpMax}
            />
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-default-100/70 text-muted">
            <MorphIcon icon={CircleUserRound} size={20} />
          </span>
          <p className="text-[11px] font-medium text-foreground">
            {t("tray.no_user")}
          </p>
          <p className="text-[9px] leading-relaxed text-muted">
            {t("tray.no_user_hint")}
          </p>
        </div>
      )}

      {/* 操作区 */}
      <footer className="shrink-0 space-y-0.5 border-t border-separator/60 p-1.5">
        <button
          type="button"
          onClick={handleShowMain}
          className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-foreground/85 transition-all duration-200 hover:bg-primary/10 hover:text-primary active:scale-[0.98]"
        >
          <MorphIcon icon={ArrowUpRight} size={13} />
          <span className="flex-1 text-left">{t("tray.show_window")}</span>
        </button>
        <button
          type="button"
          onClick={handleQuit}
          className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-danger/80 transition-all duration-200 hover:bg-danger/10 hover:text-danger active:scale-[0.98]"
        >
          <MorphIcon icon={Power} size={13} />
          <span className="flex-1 text-left">{t("tray.quit")}</span>
        </button>
      </footer>
    </div>
  );
}
