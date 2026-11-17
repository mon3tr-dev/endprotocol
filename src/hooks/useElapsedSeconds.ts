import { useEffect, useRef, useState } from "react";

/**
 * 计时秒数：`active` 为 true 时从 0 开始每秒 +1，变回 false 时归零。
 *
 * 用途是给「只有转圈、没有进度」的等待加一个可见的时间刻度。
 * 交换 u8token 这一步要走两次鹰角通行证接口（OAuth → u8_token_by_uid），
 * 网络差的时候能到十几秒；界面上只有一个不停转的圆环时，用户无法判断
 * 是「还在跑」还是「已经卡死」，于是会去杀进程重来。
 *
 * 只依赖一个 1s 定时器，不触发额外渲染（每秒一次，且仅在 active 时运行）。
 */
export function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = useState(0);
  /** 本次 active 的起始时刻；用 Date.now 而不是累加，避免定时器漂移后越走越慢 */
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      startedAtRef.current = null;
      setSeconds(0);
      return;
    }

    startedAtRef.current = Date.now();
    setSeconds(0);

    const timer = window.setInterval(() => {
      const startedAt = startedAtRef.current;
      if (startedAt === null) return;
      setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [active]);

  return seconds;
}
