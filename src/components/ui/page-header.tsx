import clsx from "clsx";

interface PageHeaderProps {
  /** 主标题 */
  title: React.ReactNode;
  /** 副标题 / 提示 */
  description?: React.ReactNode;
  /** 右上角操作按钮组 */
  actions?: React.ReactNode;
  /** 标题锚点 id,供站内搜索跳转 */
  id?: string;
  /** 自定义类名 */
  className?: string;
}

export function PageHeader({
  title,
  description,
  actions,
  id,
  className,
}: PageHeaderProps) {
  return (
    <header
      id={id}
      className={clsx(
        "flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4",
        className,
      )}
    >
      <div className="min-w-0">
        {/* 标题字号：手机上 2xl（24px）已经占掉一行，再大就挤掉副标题。
            桌面端保持 3xl。 */}
        <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-foreground tracking-tight break-words">
          {title}
        </h1>
        {description && (
          <p className="text-foreground/70 mt-1 text-sm leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {actions && (
        /* 窄屏：操作区改为整行横向滚动 —— 多个按钮横排必然溢出，
           换行又会把标题挤下去。横向滚动让它们「排得下」且不换行。 */
        <div className="flex items-center gap-2 shrink-0 max-w-full overflow-x-auto scroll-touch [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:overflow-visible">
          {actions}
        </div>
      )}
    </header>
  );
}
