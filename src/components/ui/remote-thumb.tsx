import { useEffect, useState } from "react";
import clsx from "clsx";
import { cacheManager } from "@/utils/imageCacheManager";

interface RemoteThumbProps {
  /** 远程图片地址（http/https，经后端 download_image 下载到本地缓存后显示） */
  src?: string;
  /** 备用文案（占位字母 / aria-label） */
  alt: string;
  /** 尺寸与圆角等样式（同时作用于占位与图片） */
  className?: string;
  /** 占位块额外样式 */
  fallbackClassName?: string;
}

/**
 * 远程缩略图：显示前先经 `cacheManager` 下载到本地缓存（blob URL），
 * 加载失败或地址为空时回退为「首字母占位块」。
 *
 * 为什么不用 `<Img>`：`Img` 在下载失败时永远停留在 animate-pulse 占位，
 * 看起来像一直在加载；这里通过自己持有 `cacheManager.load` 的 Promise
 * 区分「加载中 / 失败」，失败立即换成字母占位。
 *
 * 引用计数：挂载期间 `request` 持有缓存引用防止 blob 被回收，卸载时 `release`。
 */
export function RemoteThumb({ src, alt, className, fallbackClassName }: RemoteThumbProps) {
  const [resolvedSrc, setResolvedSrc] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    setResolvedSrc("");
    setFailed(false);

    cacheManager.request([src]);
    cacheManager
      .load(src)
      .then((url) => {
        if (!cancelled) setResolvedSrc(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      cacheManager.release([src]);
    };
  }, [src]);

  if (!src || failed || !resolvedSrc) {
    return (
      <div
        aria-label={alt}
        role="img"
        className={clsx(
          "flex items-center justify-center bg-default-200/50 text-[10px] font-semibold text-muted overflow-hidden shrink-0",
          !failed && !resolvedSrc && src ? "animate-pulse" : "",
          className,
          fallbackClassName,
        )}
      >
        {failed || !src ? alt.charAt(0) || "?" : ""}
      </div>
    );
  }

  return <img src={resolvedSrc} alt={alt} className={clsx(className, "object-cover shrink-0")} />;
}
