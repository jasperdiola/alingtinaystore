"use client";

import { useId, useState } from "react";

/**
 * Frame for every chart, plus the table view.
 *
 * The table is not optional polish: the validator flags --viz-3 at 2.82:1 on
 * the light surface, and the documented relief for that is visible labels or a
 * table view. It also covers colorblind readers and anyone who simply wants
 * the number rather than the shape.
 */
export function ChartCard({
  title,
  subtitle,
  table,
  children,
  empty,
}: {
  title: string;
  subtitle?: string;
  table?: React.ReactNode;
  children: React.ReactNode;
  empty?: boolean;
}) {
  const [showTable, setShowTable] = useState(false);
  const id = useId();

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {subtitle && (
            <p className="mt-0.5 text-xs text-neutral-500">{subtitle}</p>
          )}
        </div>
        {table && !empty && (
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            aria-expanded={showTable}
            aria-controls={id}
            className="shrink-0 rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {showTable ? "Chart" : "Table"}
          </button>
        )}
      </header>

      {empty ? (
        <EmptyState />
      ) : (
        <div id={id}>{showTable && table ? table : children}</div>
      )}
    </section>
  );
}

function EmptyState() {
  return (
    <div className="grid h-40 place-items-center rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700">
      <p className="text-sm text-neutral-500">No orders in this period.</p>
    </div>
  );
}

/** Shared table shell so every chart's table view looks the same. */
export function DataTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: (string | number)[][];
}) {
  return (
    <div className="max-h-72 overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-white text-left text-xs text-neutral-500 dark:bg-neutral-900">
          <tr>
            {columns.map((c, i) => (
              <th
                key={c}
                scope="col"
                className={`border-b border-neutral-200 py-2 font-medium dark:border-neutral-800 ${
                  i === 0 ? "" : "text-right"
                }`}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800/60">
              {r.map((cell, ci) => (
                <td
                  key={ci}
                  className={`py-2 ${ci === 0 ? "" : "text-right tabular-nums"}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
