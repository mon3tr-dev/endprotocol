import { cn } from "@/lib/utils";

export interface GlassTableProps {
  className?: string;
  children?: React.ReactNode;
}

function Table({ className, children }: GlassTableProps) {
  return <div className={cn("w-full overflow-x-auto", className)}>{children}</div>;
}

function ScrollContainer({ className, children }: GlassTableProps) {
  return <div className={cn("overflow-x-auto", className)}>{children}</div>;
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
      className={cn("px-4 py-2.5 text-xs font-semibold text-muted", className)}
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
  return <td className={cn("px-4 py-2.5 text-foreground/90", className)}>{children}</td>;
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
