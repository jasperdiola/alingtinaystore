import Link from "next/link";
import { RANGES, type RangeKey } from "@/lib/queries/analytics";

/**
 * One filter row above the charts — never inside a card, and never per-chart.
 *
 * Plain links rather than client state: the range lives in the URL, so it is
 * shareable and bookmarkable, and changing it is a server re-render with the
 * new numbers already computed. No loading spinner, no client fetch.
 */
export default function RangeFilter({ active }: { active: RangeKey }) {
  return (
    <div
      role="group"
      aria-label="Date range"
      className="inline-flex rounded-lg border border-neutral-200 bg-white p-0.5 dark:border-neutral-800 dark:bg-neutral-900"
    >
      {RANGES.map((r) => {
        const selected = r.key === active;
        return (
          <Link
            key={r.key}
            href={`/admin?range=${r.key}`}
            scroll={false}
            aria-current={selected ? "true" : undefined}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              selected
                ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
            }`}
          >
            {r.label}
          </Link>
        );
      })}
    </div>
  );
}
