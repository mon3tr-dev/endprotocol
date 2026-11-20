import { cn } from "@/lib/utils";

export interface GlassTableProps {
  className?: string;
  children?: React.ReactNode;
}

function Table({ className, children }: GlassTableProps) {
  return (
    // 窄屏：表格整体横向滚动。表格天生是「多列并排」的信息结构，
    // 硬改成堆叠会破坏「同一行是同一条记录」的语义（这在开发者页的
    // 缓存图片表、字段表里尤其重要）。这里给出可滚动的容器并保留滚动条
    // 可见性提示 —— 桌面端是 overlayScrollbar 接管，窄屏退回原生滚动条。
    <div
      className={cn(
        "w-full overflow-x-auto scroll-touch",
        "[scrollbar-width:thin] sm:[scrollbar-width:none]",
        "[&::-webkit-scrollbar]:h-6 sm:[&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}

function ScrollContainer({ className, children }: GlassTableProps) {
  return (
    <div className={cn("overflow-x-auto scroll-touch", className)}>
      {children}
    </div>
  );
}

function Content({
  "aria-label": ariaLabel,
  className,
  children,
}: {
  "aria-label"?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <table aria-label={ariaLabel} className={cn("w-full border-collapse text-sm", className)}>
      {children}
    </table>
  );
}

function Header({ className, children }: GlassTableProps) {
  return (
    <thead className={cn("bg-default-50/70 text-left", className)}>
      <tr>{children}</tr>
    </thead>
  );
}

function Column({ isRowHeader, className, children }: { isRowHeader?: boolean; className?: string; children?: React.ReactNode }) {
  return (
    <th
      scope={isRowHeader ? "row" : "col"}
      // 窄屏：单元格收紧内边距 + 不换行 —— 换行会把表头撑成两行，
      // 表格高度暴涨；不换行则靠容器横向滚动。
      className={cn(
        "px-2 sm:px-4 py-2 sm:py-2.5 text-xs font-semibold text-muted whitespace-nowrap",
        className,
      )}
    >
      {children}
    </th>
  );
}

function Body({ className, children }: GlassTableProps) {
  return <tbody className={cn("divide-y divide-separator/60", className)}>{children}</tbody>;
}

function Row({ className, children }: GlassTableProps) {
  return (
    <tr
      className={cn(
        // 行 hover 用纯色轻染（paint 级），不位移不模糊
        "[transition:background-color_var(--lg-dur-fast)_var(--lg-ease-standard)] lg-hoverable-soft/60",
        className,
      )}
    >
      {children}
    </tr>
  );
}

function Cell({ className, children }: GlassTableProps) {
  return (
    <td className={cn("px-2 sm:px-4 py-2 sm:py-2.5 text-foreground/90", className)}>
      {children}
    </td>
  );
}

Table.ScrollContainer = ScrollContainer;
Table.Content = Content;
Table.Header = Header;
Table.Column = Column;
Table.Body = Body;
Table.Row = Row;
Table.Cell = Cell;

const GlassTable = Table;

export { Table, GlassTable };
