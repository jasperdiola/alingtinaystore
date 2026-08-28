import { percent } from "@/lib/format";

/**
 * A single headline number. Deliberately not a one-bar chart.
 *
 * The value uses proportional figures (tabular-nums is reserved for columns
 * that must align vertically — on a large standalone number it makes 121 look
 * gap-toothed). The delta pairs an arrow glyph with the number so direction is
 * never carried by colour alone.
 */
export default function StatTile({
  label,
  value,
  delta,
  hint,
}: {
  label: string;
  value: string;
  delta?: number | null;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <p className="text-xs font-medium text-neutral-500">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight">{value}</p>
      <div className="mt-1 flex items-baseline gap-2 text-xs">
        {delta === null || delta === undefined ? (
          <span className="text-neutral-400">
            {delta === null ? "No prior period" : ""}
          </span>
        ) : (
          <span
            style={{ color: delta >= 0 ? "var(--viz-good)" : "var(--viz-bad)" }}
            className="font-medium"
          >
            {delta >= 0 ? "▲" : "▼"} {percent(delta)}
          </span>
        )}
        {hint && <span className="text-neutral-400">{hint}</span>}
      </div>
    </div>
  );
}
