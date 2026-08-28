import type { Metadata } from "next";
import Link from "next/link";
import { count } from "@/lib/format";
import { listMovements } from "@/lib/queries/inventory";

export const metadata: Metadata = {
  title: "Stock movements · Aling Tinay Admin",
  robots: { index: false, follow: false },
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** `restock: delivered late` → "Restock" + the note kept separate. */
function splitReason(reason: string) {
  const [code, ...rest] = reason.split(":");
  return {
    code: code.trim().replace(/_/g, " "),
    note: rest.join(":").trim() || null,
  };
}

export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Number(pageParam ?? 1) || 1;
  const { rows, total, pages } = await listMovements(page);

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href="/admin/inventory"
        className="text-xs text-neutral-500 underline-offset-4 hover:underline"
      >
        ← Inventory
      </Link>

      <div className="mt-2 mb-4">
        <h2 className="text-lg font-semibold">Stock movements</h2>
        <p className="text-xs text-neutral-500">
          {count(total)} recorded change{total === 1 ? "" : "s"} · every manual
          adjustment and every cancelled order
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="grid h-40 place-items-center rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700">
          <p className="max-w-sm text-center text-sm text-neutral-500">
            No movements yet. Adjusting stock or cancelling an order will record
            one here.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <table className="rtable w-full text-sm sm:min-w-[640px]">
            <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500 dark:border-neutral-800">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">When</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Product</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Reason</th>
                <th scope="col" className="px-4 py-2.5 font-medium">By</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Change</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">After</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const r = splitReason(m.reason);
                return (
                  <tr key={m.id} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800/60">
                    <td data-label="When" className="whitespace-nowrap px-4 py-3 text-neutral-600 dark:text-neutral-400">
                      {when(m.at)}
                    </td>
                    <td data-label="" className="px-4 py-3">
                      <div>{m.product}</div>
                      <div className="text-xs text-neutral-500">
                        {m.size} · {m.store}
                      </div>
                    </td>
                    <td data-label="Reason" className="px-4 py-3">
                      <span className="capitalize">{r.code}</span>
                      {r.note && (
                        <div className="text-xs text-neutral-500">{r.note}</div>
                      )}
                      {m.orderCode && (
                        <div className="text-xs text-neutral-500">{m.orderCode}</div>
                      )}
                    </td>
                    <td data-label="By" className="px-4 py-3 text-neutral-600 dark:text-neutral-400">
                      {m.actor ?? "System"}
                    </td>
                    <td data-label="Change" className="px-4 py-3 text-right">
                      {/* Sign carries the meaning; colour only reinforces it. */}
                      <span
                        className={`tabular-nums font-medium ${
                          m.delta > 0
                            ? "text-green-700 dark:text-green-400"
                            : "text-rose-600 dark:text-rose-400"
                        }`}
                      >
                        {m.delta > 0 ? "+" : ""}
                        {m.delta}
                      </span>
                    </td>
                    <td data-label="After" className="px-4 py-3 text-right tabular-nums">{m.balanceAfter}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination">
          <Link
            href={`/admin/inventory/movements?page=${Math.max(1, page - 1)}`}
            className={`rounded-lg border border-neutral-300 px-3 py-1.5 dark:border-neutral-700 ${page === 1 ? "pointer-events-none opacity-40" : ""}`}
          >
            Previous
          </Link>
          <span className="text-xs text-neutral-500">Page {page} of {pages}</span>
          <Link
            href={`/admin/inventory/movements?page=${Math.min(pages, page + 1)}`}
            className={`rounded-lg border border-neutral-300 px-3 py-1.5 dark:border-neutral-700 ${page === pages ? "pointer-events-none opacity-40" : ""}`}
          >
            Next
          </Link>
        </nav>
      )}
    </div>
  );
}
