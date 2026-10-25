import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface ElapsedTimeProps {
  /** 权威总秒数（来自后端快照：已累计总数 + 当前会话） */
  totalSeconds: number;
  /** 是否正在运行；为 true 时按真实流逝时间平滑推进 */
  running: boolean;
  className?: string;
}

/** 各数字位的取值（时 / 分 / 十秒位 / 秒个位） */
interface TimeParts {
  hours: string;
  minutes: string;
  tens: string;
  ones: string;
}

function toParts(wholeSeconds: number): TimeParts {
  const seconds = Math.max(0, Math.floor(wholeSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return {
    hours: String(hours),
    minutes: String(minutes).padStart(2, "0"),
    tens: String(Math.floor((seconds % 60) / 10)),
    ones: String(seconds % 10),
  };
}

/**
 * 平滑递增的时长显示（`h:mm:ss`）。
 *
 * 后端每 5 秒给一次快照；两次快照之间由 `requestAnimationFrame` 按真实流逝时间
 * 推算秒数，仅在跨越整秒时更新 state，避免每帧重渲染。数字按位渲染，某一位变化时
 * 该位单独播放上滑淡入，因此每一秒是「一位平滑滚动」而不是整串数字硬跳；快照刷新
 * 时以已展示值为下限重新锚定，数字只会前进，不会在轮询处回退。
 */
export function ElapsedTime({
  totalSeconds,
  running,
  className,
}: ElapsedTimeProps) {
  const [parts, setParts] = useState<TimeParts>(() => toParts(totalSeconds));
  /** 已展示到的秒数（整秒），作为不回退的下限 */
  const shownRef = useRef(Math.max(0, Math.floor(totalSeconds)));
  /** 补间基准：锚定秒数 + 锚定时刻 */
  const baseRef = useRef({
    value: Math.max(0, totalSeconds),
    at: Date.now(),
  });

  // 快照或运行状态变化时重新锚定（运行中只允许前进）
  useEffect(() => {
    const value = Math.max(0, totalSeconds);
    const anchor = running ? Math.max(value, shownRef.current) : value;
    baseRef.current = { value: anchor, at: Date.now() };
    const whole = Math.floor(anchor);
    if (whole !== shownRef.current) {
      shownRef.current = whole;
      setParts(toParts(whole));
    }
  }, [totalSeconds, running]);

  // 运行中：每帧按真实经过时间推进，仅在整秒变化时更新
  useEffect(() => {
    if (!running) return;
    let frame = 0;
    const tick = () => {
      const base = baseRef.current;
      const whole = Math.floor(base.value + (Date.now() - base.at) / 1000);
      if (whole !== shownRef.current) {
        shownRef.current = whole;
        setParts(toParts(whole));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running]);

  const hourChars = parts.hours.split("");
  const minuteChars = parts.minutes.split("");

  return (
    <span
      className={cn("inline-flex items-center leading-none tabular-nums", className)}
    >
      <span className="sr-only">
        {`${parts.hours}:${parts.minutes}:${parts.tens}${parts.ones}`}
      </span>
      <span aria-hidden="true" className="inline-flex items-center">
        {hourChars.map((char, index) => (
          <span key={`h-${index}-${char}`} className="elapsed-digit">
            {char}
          </span>
        ))}
        <span className="elapsed-sep">:</span>
        {minuteChars.map((char, index) => (
          <span key={`m-${index}-${char}`} className="elapsed-digit">
            {char}
          </span>
        ))}
        <span className="elapsed-sep">:</span>
        <span key={`t-${parts.tens}`} className="elapsed-digit">
          {parts.tens}
        </span>
        <span key={`o-${parts.ones}`} className="elapsed-digit">
          {parts.ones}
        </span>
      </span>
    </span>
  );
}
