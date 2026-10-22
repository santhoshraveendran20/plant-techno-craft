import { Fragment } from "react";
import { cn } from "@/lib/utils";
import { useIsTabletUp } from "@/hooks/useMediaQuery";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const HIDE = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
  "2xl": "hidden 2xl:table-cell",
};

/**
 * One list, three layouts:
 *  - phones (< 768px): each row becomes a card (primary + aside on top, details below, actions at the end)
 *  - tablets: a table where low-priority columns (`hide: "lg" | "xl"`) are dropped so nothing scrolls sideways
 *  - desktop: the full table
 *
 * Column: { key, header, cell(row), align?: "right", hide?: "sm"|"md"|"lg"|"xl", primary?, aside?, actions?,
 *           card?: false, className? }
 */
export function ResponsiveTable({
  columns,
  rows,
  rowKey = (r) => r.id,
  onRowClick,
  rowClassName,
  empty = null,
  footer,
  inset = false,
  className,
}) {
  const tableMode = useIsTabletUp();
  if (!rows?.length) return empty;

  if (!tableMode) {
    const primary = columns.find((c) => c.primary) || columns[0];
    const asides = columns.filter((c) => c.aside && c !== primary);
    const actions = columns.filter((c) => c.actions);
    const details = columns.filter((c) => c !== primary && !c.aside && !c.actions && c.card !== false);
    return (
      <ul className={cn("divide-y", className)}>
        {rows.map((row, i) => (
          <li
            key={rowKey(row, i)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={cn("px-4 py-3", onRowClick && "cursor-pointer active:bg-muted/60", rowClassName?.(row))}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">{primary.cell(row)}</div>
              {asides.length > 0 && (
                <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                  {asides.map((c) => (
                    <div key={c.key}>{c.cell(row)}</div>
                  ))}
                </div>
              )}
            </div>
            {details.length > 0 && (
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                {details.map((c) => (
                  <div key={c.key} className={cn("min-w-0", c.wide && "col-span-2")}>
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{c.header}</dt>
                    <dd className="break-words">{c.cell(row)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {actions.length > 0 && (
              <div className="mt-3 flex flex-wrap justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                {actions.map((c) => (
                  <Fragment key={c.key}>{c.cell(row)}</Fragment>
                ))}
              </div>
            )}
          </li>
        ))}
        {footer && (
          <li className="bg-muted/50 px-4 py-3">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm font-medium">
              {columns
                .filter((c) => footer[c.key] !== undefined && footer[c.key] !== null && footer[c.key] !== "")
                .map((c) => (
                  <div key={c.key}>
                    <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{c.primary ? "" : c.header}</dt>
                    <dd>{footer[c.key]}</dd>
                  </div>
                ))}
            </dl>
          </li>
        )}
      </ul>
    );
  }

  const cellClass = (c, i) =>
    cn(
      c.hide && HIDE[c.hide],
      c.align === "right" && "text-right",
      inset && i === 0 && "pl-5",
      inset && i === columns.length - 1 && "pr-5",
      c.className
    );

  return (
    <Table className={className}>
      <TableHeader>
        <TableRow>
          {columns.map((c, i) => (
            <TableHead key={c.key} className={cellClass(c, i)}>
              {c.actions ? <span className="sr-only">{c.header || "Actions"}</span> : c.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, ri) => (
          <TableRow
            key={rowKey(row, ri)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={cn(onRowClick && "cursor-pointer", rowClassName?.(row))}
          >
            {columns.map((c, i) => (
              <TableCell
                key={c.key}
                className={cellClass(c, i)}
                onClick={c.actions ? (e) => e.stopPropagation() : undefined}
              >
                {c.cell(row)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
      {footer && (
        <TableFooter>
          <TableRow>
            {columns.map((c, i) => (
              <TableCell key={c.key} className={cellClass(c, i)}>
                {footer[c.key] ?? ""}
              </TableCell>
            ))}
          </TableRow>
        </TableFooter>
      )}
    </Table>
  );
}
