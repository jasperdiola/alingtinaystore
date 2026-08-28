import { pesoExact } from "@/lib/format";
import type { PriceChange, PriceScope } from "@/lib/queries/price-history";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/**
 * Scope is what a reader needs first: "₱120 → ₱135" means something different
 * for one branch than for the whole catalog.
 */
const SCOPE: Record<PriceScope, { label: string; hint: string; className: string }> = {
  headline: {
    label: "Headline",
    hint: "storefront display price",
    className:
      "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  },
  catalog: {
    label: "Catalog",
    hint: "every branch that follows it",
    className: "bg-blue-50 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300",
  },
  branch: {
    label: "Branch",
    hint: "one branch only",
    className:
      "bg-amber-50 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300",
  },
};

export function ScopeBadge({ scope }: { scope: PriceScope }) {
  const s = SCOPE[scope];
  return (
    <span
      title={s.hint}
      className={`inline-block rounded-md px-1.5 py-0.5 text-[11px] font-medium ${s.className}`}
    >
      {s.label}
    </span>
  );
}

/** "—" for the null side of setting or clearing a branch override. */
function Money({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <span className="text-neutral-400" title="Followed the catalog price">
        catalog
      </span>
    );
  }
  return <span className="tabular-nums">{pesoExact(value)}</span>;
}

export function PriceDelta({ from, to }: { from: number | null; to: number | null }) {
  const rose = from !== null && to !== null && to > from;
  const fell = from !== null && to !== null && to < from;
  return (
    <span className="whitespace-nowrap">
      <Money value={from} />
      <span aria-hidden className="mx-1 text-neutral-400">
        →
      </span>
      {/* The arrow and the numbers carry the meaning; colour reinforces it. */}
      <span
        className={
          rose
            ? "font-medium text-rose-600 dark:text-rose-400"
            : fell
              ? "font-medium text-green-700 dark:text-green-400"
              : "font-medium"
        }
      >
        <Money value={to} />
      </span>
    </span>
  );
}

/** Compact list for the product edit page. */
export function PriceLogList({ rows }: { rows: PriceChange[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-xs text-neutral-500">
        No price changes recorded yet. Every change from here on is logged with
        who made it.
      </p>
    );
  }
  return (
    <ul className="space-y-2 text-sm">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <ScopeBadge scope={r.scope} />
          <PriceDelta from={r.oldPrice} to={r.newPrice} />
          <span className="text-xs text-neutral-500">
            {[r.size, r.store].filter(Boolean).join(" · ") || "all sizes"}
          </span>
          <span className="ml-auto text-xs text-neutral-500">
            {when(r.at)} · {r.actor ?? "System"}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Full table for the dedicated history page. */
export function PriceLogTable({ rows }: { rows: PriceChange[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <table className="rtable w-full text-sm sm:min-w-[680px]">
        <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500 dark:border-neutral-800">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-medium">When</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Product</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Scope</th>
            <th scope="col" className="px-4 py-2.5 font-medium">By</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className="border-b border-neutral-100 last:border-0 dark:border-neutral-800/60"
            >
              <td
                data-label="When"
                className="whitespace-nowrap px-4 py-3 text-neutral-600 dark:text-neutral-400"
              >
                {when(r.at)}
              </td>
              <td data-label="" className="px-4 py-3">
                <div>{r.product}</div>
                <div className="text-xs text-neutral-500">
                  {[r.size, r.store].filter(Boolean).join(" · ") || "all sizes"}
                </div>
              </td>
              <td data-label="Scope" className="px-4 py-3">
                <ScopeBadge scope={r.scope} />
              </td>
              <td
                data-label="By"
                className="px-4 py-3 text-neutral-600 dark:text-neutral-400"
              >
                {r.actor ?? "System"}
              </td>
              <td data-label="Change" className="px-4 py-3 text-right">
                <PriceDelta from={r.oldPrice} to={r.newPrice} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
