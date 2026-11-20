import clsx from "clsx";

interface SettingsRowProps {
  /** 锚点 id,供站内搜索跳转 */
  id?: string;
  /** 标题 */
  title: React.ReactNode;
  /** 描述 */
  description?: React.ReactNode;
  /** 右侧控件 */
  control: React.ReactNode;
  /** 自定义类名 */
  className?: string;
}

export function SettingsRow({
  id,
  title,
  description,
  control,
  className,
}: SettingsRowProps) {
  return (
    <div
      id={id}
      className={clsx(
        "flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground break-words">{title}</p>
        {description && (
          <p className="text-sm text-muted mt-0.5">{description}</p>
        )}
      </div>
      {/* 窄屏：控件整行靠左（不是靠右）—— 靠右的控件在窄屏上离拇指
          更远，且长控件会溢出。宽屏保持靠右。 */}
      <div className="shrink-0 sm:text-right w-full sm:w-auto">{control}</div>
    </div>
  );
}

/** 设置区域内统一的分隔线 */
export function SettingsDivider() {
  return <div className="h-px bg-separator w-full" role="separator" />;
}
