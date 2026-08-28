"use client";

import { useState } from "react";
import { peso } from "@/lib/format";

export type Bar = {
  label: string;
  value: number;
  /** Sub-line shown in the tooltip, e.g. "12 orders". */
  meta?: string;
  /** Entity colour. Omit for single-hue magnitude charts. */
  color?: string;
};

/**
 * Horizontal bars for magnitude.
 *
 * Horizontal because store and product names are long — rotated x labels are
 * a readability tax. Every bar carries a visible direct value label, which is
 * also the documented relief for the light-mode contrast warning on the aqua
 * slot.
 */
export default function BarChart({
  bars,
  emptyLabel = "No data",
}: {
  bars: Bar[];
  emptyLabel?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...bars.map((b) => b.value), 1);

  if (!bars.length) {
    return <p className="py-8 text-center text-sm text-neutral-500">{emptyLabel}</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {bars.map((b, i) => {
        const pct = (b.value / max) * 100;
        return (
          <li
            key={b.label}
            className="relative"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
              <span className="truncate text-neutral-700 dark:text-neutral-300">
                {b.label}
              </span>
              {/* Direct label — the value is never tooltip-only. */}
              <span className="shrink-0 tabular-nums font-medium">{peso(b.value)}</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
              <div
                className="h-full rounded-full transition-[width] duration-300"
                style={{
                  width: `${Math.max(pct, b.value > 0 ? 1.5 : 0)}%`,
                  background: b.color ?? "var(--viz-1)",
                }}
              />
            </div>

            {hover === i && b.meta && (
              <div className="pointer-events-none absolute right-0 top-full z-10 mt-1 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs shadow-sm dark:border-neutral-700 dark:bg-neutral-800">
                {b.meta}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
