import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/admin";
import { count, peso } from "@/lib/format";
import { listVoidedOrders } from "@/lib/queries/orders";

export const metadata: Metadata = {
  title: "Voided orders · Aling Tinay Admin",
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

export default async function VoidedOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  // Same bar as voiding one: this page is the record of managers' corrections,
  // not something the whole floor browses.
  await requireRole("manager");

  const { page: pageParam } = await searchParams;
  const page = Number(pageParam ?? 1) || 1;
  const { rows, total, pages } = await listVoidedOrders(page);

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href="/admin/orders"
        className="text-xs text-neutral-500 underline-offset-4 hover:underline"
      >
        ← Orders
      </Link>

      <div className="mt-2 mb-4">
        <h2 className="text-lg font-semibold">Voided orders</h2>
        <p className="text-xs text-neutral-500">
          {count(total)} order{total === 1 ? "" : "s"} struck from the record ·
          excluded from every sales figure, kept here so nothing disappears
          without a trace
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="grid h-40 place-items-center rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700">
          <p className="max-w-sm text-center text-sm text-neutral-500">
            Nothing has been voided. An order voided from its own page appears
            here with who did it and why.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <table className="rtable w-full text-sm sm:min-w-[720px]">
            <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500 dark:border-neutral-800">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">Order</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Reason</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Voided by</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Stock</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr
                  key={o.id}
                  className="border-b border-neutral-100 last:border-0 dark:border-neutral-800/60"
                >
                  <td data-label="" className="px-4 py-3">
                    <div className="font-medium">{o.code}</div>
                    <div className="text-xs text-neutral-500">
                      {o.customer} · {o.store}
                    </div>
                    <div className="text-xs text-neutral-500">
                      placed {when(o.createdAt)}
                    </div>
                  </td>
                  <td data-label="Reason" className="px-4 py-3">
                    <p className="max-w-xs whitespace-pre-wrap">{o.reason}</p>
                  </td>
                  <td
                    data-label="Voided by"
                    className="px-4 py-3 text-neutral-600 dark:text-neutral-400"
                  >
                    <div>{o.voidedBy ?? "Unknown"}</div>
                    <div className="text-xs text-neutral-500">{when(o.voidedAt)}</div>
                  </td>
                  <td data-label="Stock" className="px-4 py-3">
                    {o.stockReturned ? (
                      <span className="text-xs font-medium text-green-700 dark:text-green-400">
                        Returned
                      </span>
                    ) : (
                      // Not a failure: an order voided before it ever took
                      // stock has nothing to give back.
                      <span className="text-xs text-neutral-500">None taken</span>
                    )}
                  </td>
                  <td data-label="Value" className="px-4 py-3 text-right">
                    {/* Struck through: this money was never collected. */}
                    <div className="tabular-nums font-medium text-neutral-400 line-through">
                      {peso(o.total)}
                    </div>
                    <div className="text-xs text-neutral-500">
                      {o.items} item{o.items === 1 ? "" : "s"}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav
          className="mt-4 flex items-center justify-between text-sm"
          aria-label="Pagination"
        >
          <Link
            href={`/admin/orders/voided?page=${Math.max(1, page - 1)}`}
            className={`rounded-lg border border-neutral-300 px-3 py-1.5 dark:border-neutral-700 ${page === 1 ? "pointer-events-none opacity-40" : ""}`}
          >
            Previous
          </Link>
          <span className="text-xs text-neutral-500">
            Page {page} of {pages}
          </span>
          <Link
            href={`/admin/orders/voided?page=${Math.min(pages, page + 1)}`}
            className={`rounded-lg border border-neutral-300 px-3 py-1.5 dark:border-neutral-700 ${page === pages ? "pointer-events-none opacity-40" : ""}`}
          >
            Next
          </Link>
        </nav>
      )}
    </div>
  );
}
