import { useRef } from "react";
import { useResumeVideoOnForeground } from "@/hooks/useResumeVideoOnForeground";

export interface GameBackgroundVideoProps {
  /** 视频地址（后端 `get_background_image` 下发的 `video_url`） */
  src: string;
}

/**
 * 游戏界面的全屏背景视频。
 *
 * 单独抽成组件（而不是在 `layouts/dashboard.tsx` 的 `pages.map` 里直接写 `<video>`）
 * 只为一件事：**能挂 hook**。恢复播放要拿到真实的元素引用，
 * 而 `pages.map` 是每次渲染现算的 JSX 片段，没有地方放 `useRef` / `useEffect`。
 *
 * `muted` + `playsInline` 是自动播放的前提（有声音的自动播放在任何现代浏览器里
 * 都会被拦），`loop` 让 8 秒左右的过场循环成持续背景。
 */
export function GameBackgroundVideo({ src }: GameBackgroundVideoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useResumeVideoOnForeground(videoRef, src);

  return (
    <video
      ref={videoRef}
      src={src}
      autoPlay
      loop
      muted
      playsInline
      className="w-full h-full object-cover"
    />
  );
}

export default GameBackgroundVideo;