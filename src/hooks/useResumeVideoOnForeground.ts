import { useEffect, type RefObject } from "react";

/**
 * 让背景 `<video>` 在被系统/引擎暂停后自动恢复播放。
 *
 * 为什么需要它：应用失去焦点、或被其它窗口完全遮挡一段时间后，WebView2（Chromium）
 * 会把窗口判为「后台/被遮挡」，随之暂停媒体播放与渲染。等用户切回来时，
 * **播放器不会自己接着播** —— `paused` 就一直停在 true，画面上剩一张冻结的
 * 最后一帧，看起来就像「视频卡住了」。
 *
 * 关键点：`autoPlay` 只在元素**首次**挂载时生效，它管不了「后来被暂停」这种情况
 * （属性没变，浏览器不会重新评估）。所以必须显式 `play()`。
 *
 * 三条触发路径，缺一不可：
 *   - `visibilitychange` → 页面从隐藏回到可见
 *   - `focus` / `pageshow` → 窗口重新获得焦点。部分后台化只触发这俩而
 *     `visibilityState` 始终是 `visible`，光靠 visibilitychange 会漏
 *   - `<video>` 自身的 `pause` → 兜住「引擎直接暂停、但没发任何页面事件」的情形；
 *     此刻若已在**前台**就立刻拉起，在后台则留给上面两个信号
 *
 * `play()` 返回的 Promise 必须 catch：恢复瞬间可能还没拿到可播放数据
 * （`NotAllowedError` / `AbortError`），静默忽略即可 —— 下次信号会再试。
 */
export function useResumeVideoOnForeground(
  videoRef: RefObject<HTMLVideoElement | null>,
  /** 视频地址；变化时重新绑定（换游戏会换 src） */
  src?: string | null,
): void {
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const resume = () => {
      if (!video.paused) return;
      if (document.visibilityState === "hidden") return;
      void video.play().catch(() => {});
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") resume();
    };
    const onForeground = () => resume();
    // 引擎暂停媒体不一定伴随页面事件：暂停发生时若已在可见状态，说明不是
    // 「用户切走了」，立刻拉回来；否则等前面两个前台信号。
    const onPause = () => {
      if (document.visibilityState === "visible") resume();
    };

    video.addEventListener("pause", onPause);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onForeground);
    window.addEventListener("pageshow", onForeground);

    // 挂载时若已经处于暂停（例如窗口在后台完成加载），尝试一次
    resume();

    return () => {
      video.removeEventListener("pause", onPause);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onForeground);
      window.removeEventListener("pageshow", onForeground);
    };
  }, [videoRef, src]);
}