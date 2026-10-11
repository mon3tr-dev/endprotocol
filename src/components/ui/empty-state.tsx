import clsx from "clsx";

interface EmptyStateProps {
  /** 图标（任意 ReactNode，通常为 SVG 图标组件） */
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** 容器高度(默认 200px) */
  minHeight?: number | string;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  minHeight = 200,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={clsx(
        "flex flex-col items-center justify-center text-center px-6 py-12",
        className,
      )}
      style={{ minHeight }}
    >
      {icon && (
        <div className="mb-4 opacity-40 text-muted [&_svg]:w-14 [&_svg]:h-14 transition-transform duration-300 hover:scale-110">
          {icon}
        </div>
      )}
      <p className="text-base lg:text-lg font-semibold text-foreground">
        {title}
      </p>
      {description && (
        <p className="text-sm text-muted/80 mt-1.5 max-w-md leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/** 默认无账户图标(内联 svg,不依赖外部库) */
export function EmptyStateUserIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
      />
    </svg>
  );
}
