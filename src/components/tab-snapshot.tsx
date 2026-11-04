import { CardIcon } from "@/components/icons";
import { cacheManager } from "@/utils/imageCacheManager";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import { logError } from "@/utils/logger";

interface TabSnapshotProps {
  /** 快照 PNG 的本地路径；为空表示还没有快照 */
  path?: string | null;
  /** 卡片图标，用于占位与加载失败兜底 */
  iconKey: string;
  className?: string;
}

/** 固定缩略区尺寸，保证网格卡片对齐（CSS 像素） */
const FRAME_HEIGHT = 132;

/**
 * 仪表盘标签页快照：显示**上次离开该标签页时**截取的内容区左上角画面。
 * 截图由 `utils/tabSnapshotService` 在离开时经后端 `save_tab_snapshot` 落盘，
 * 这里只负责读取本地文件并显示。图片顶左对齐裁剪，展示的就是画布左上角那块。
 */
export function TabSnapshot({ path, iconKey, className }: TabSnapshotProps) {
  const { i18n } = useTranslation();
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!path) {
      setSrc(null);
      return;
    }
    cacheManager
      .load(path)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch((error) => logError("[TabSnapshot] load failed:", error));
    return () => {
      cancelled = true;
    };
  }, [path]);

  const emptyLabel =
    i18n.language === "zh" ? "暂无快照，进入后自动记录" : "No snapshot yet";

  if (!path || !src) {
    return (
      <div
        className={clsx(
          "flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-separator/70 bg-default-100/30 dark:bg-black/10 text-muted/60",
          className,
        )}
        style={{ height: FRAME_HEIGHT }}
      >
        <CardIcon iconKey={iconKey} size={18} className="opacity-50" />
        <span className="text-[10px]">{emptyLabel}</span>
      </div>
    );
  }

  return (
    <div
      className={clsx(
        "overflow-hidden rounded-lg border border-separator/70 bg-default-100/40 dark:bg-black/20",
        className,
      )}
      style={{ height: FRAME_HEIGHT }}
    >
      <img
        src={src}
        alt=""
        draggable={false}
        className="h-full w-full object-cover [object-position:top_left] select-none"
      />
    </div>
  );
}

export default TabSnapshot;