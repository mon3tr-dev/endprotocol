import { GlassCard } from "@/components/ui/glass";
import clsx from "clsx";

interface SectionCardProps {
  id?: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** 是否显示内部 padding,默认 true */
  padded?: boolean;
  /** 移除内边距(用于内部自定义布局) */
  flush?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function SectionCard({
  id,
  title,
  description,
  actions,
  padded = true,
  flush = false,
  className,
  children,
}: SectionCardProps) {
  return (
    <GlassCard
      id={id}
      className={clsx(
        "border border-separator/90 overflow-hidden",
        "[transition:box-shadow_var(--lg-dur-fast)_var(--lg-ease-standard),transform_var(--lg-dur-fast)_var(--lg-ease-standard),translate_var(--lg-dur-fast)_var(--lg-ease-standard),scale_var(--lg-dur-fast)_var(--lg-ease-standard)]",
        // 窄屏不放大：手机上的 hover 态是「粘住」的（点过就一直高亮），
        // 放大的卡片会显得像被按住了。
        "lg:hover:shadow-md lg:hover:scale-[1.01]",
        className,
      )}
    >
      {(title || actions) && (
        <div
          className={clsx(
            "flex items-center justify-between gap-3",
            // 窄屏：标题区纵向堆叠（标题 + 操作按钮各占一行），
            // 标题长时不会把操作按钮挤出卡片。
            "flex-col sm:flex-row sm:items-center",
            padded && (flush ? "px-0 pt-0" : "px-4 pt-4 pb-2 sm:px-6 sm:pt-6 sm:pb-2"),
          )}
        >
          <div className="min-w-0">
            {title && (
              <h2 className="text-base sm:text-lg font-semibold break-words">
                {title}
              </h2>
            )}
            {description && (
              <p className="text-sm text-muted mt-0.5">{description}</p>
            )}
          </div>
          {actions && (
            <div className="flex items-center gap-2 shrink-0 max-w-full overflow-x-auto scroll-touch [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {actions}
            </div>
          )}
        </div>
      )}
      <div
        className={clsx(
          padded && !flush && "p-4 sm:p-6",
          flush && "p-0",
          !padded && !flush && "p-0",
          title && padded && "pt-2",
        )}
      >
        {children}
      </div>
    </GlassCard>
  );
}
