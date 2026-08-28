import type { Metadata } from "next";
import Link from "next/link";
import { adminAtLeast } from "@/lib/auth/admin";
import { count, peso } from "@/lib/format";
import { nextStatus } from "@/lib/orders/flow";
import { getStoreFilterOptions, listOrders, PAGE_SIZE } from "@/lib/queries/orders";
import AdvanceButton from "./_components/advance-button";
import { FulfillmentBadge, PaymentBadge, StatusBadge } from "./_components/badges";
import OrderFilters from "./_components/filters";

export const metadata: Metadata = {
  title: "Orders · Aling Tinay Admin",
  robots: { index: false, follow: false },
};

function when(iso: string) {
  // Rendered in Manila time to match the dashboard's day boundaries.
  return new Date(iso).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const page = Number(sp.page ?? 1) || 1;

  const [{ rows, total, pages }, stores, canSeeVoided] = await Promise.all([
    listOrders({
      status: sp.status,
      payment: sp.payment,
      storeId: sp.store,
      q: sp.q,
      page,
    }),
    getStoreFilterOptions(),
    adminAtLeast("manager"),
  ]);

  const qs = (p: number) => {
    const next = new URLSearchParams(
      Object.entries(sp).filter(([, v]) => v) as [string, string][]
    );
    next.set("page", String(p));
    return `/admin/orders?${next.toString()}`;
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Orders</h2>
          <p className="text-xs text-neutral-500">
            {count(total)} order{total === 1 ? "" : "s"}
            {total > PAGE_SIZE && ` · page ${page} of ${pages}`}
          </p>
        </div>
        {canSeeVoided && (
          <Link
            href="/admin/orders/voided"
            className="h-9 rounded-lg border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            Voided orders
          </Link>
        )}
      </div>

      <div className="mb-4">
        <OrderFilters stores={stores} />
      </div>

      {rows.length === 0 ? (
        <div className="grid h-48 place-items-center rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700">
          <p className="text-sm text-neutral-500">No orders match these filters.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <table className="rtable w-full text-sm sm:min-w-[640px]">
            <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500 dark:border-neutral-800">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">Order</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Customer</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Store</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Payment</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr
                  key={o.id}
                  className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50 dark:border-neutral-800/60 dark:hover:bg-neutral-800/40"
                >
                  <td data-label="" className="px-4 py-3">
                    {/* The whole row reads as one target via this link's title;
                        keeping the anchor on the code keeps it keyboard-sane. */}
                    <Link
                      href={`/admin/orders/${o.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {o.code}
                    </Link>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-neutral-500">
                      <span>{when(o.createdAt)}</span>
                      <FulfillmentBadge type={o.fulfillment} />
                    </div>
                  </td>
                  <td data-label="Customer" className="px-4 py-3">
                    <div className="truncate">{o.customer}</div>
                    <div className="text-xs text-neutral-500">{o.phone}</div>
                  </td>
                  <td data-label="Store" className="px-4 py-3 text-neutral-600 dark:text-neutral-400">{o.store}</td>
                  <td data-label="Status" className="px-4 py-3">
                    <StatusBadge status={o.status} />
                    {o.cancelPending && (
                      <div className="mt-1 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                        Cancellation requested
                      </div>
                    )}
                    {/* Computed here, from the row just read out of the
                        database — never in the browser, which may be looking at
                        a page that is minutes old. */}
                    <AdvanceButton
                      orderId={o.id}
                      code={o.code}
                      next={nextStatus(o.status, o.fulfillment)}
                    />
                  </td>
                  <td data-label="Payment" className="px-4 py-3"><PaymentBadge payment={o.payment} /></td>
                  <td data-label="Total" className="px-4 py-3 text-right">
                    <div className="tabular-nums font-medium">{peso(o.total)}</div>
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
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination">
          <Link
            href={qs(Math.max(1, page - 1))}
            aria-disabled={page === 1}
            className={`rounded-lg border border-neutral-300 px-3 py-1.5 dark:border-neutral-700 ${
              page === 1 ? "pointer-events-none opacity-40" : "hover:bg-neutral-50 dark:hover:bg-neutral-800"
            }`}
          >
            Previous
          </Link>
          <span className="text-xs text-neutral-500">
            Page {page} of {pages}
          </span>
          <Link
            href={qs(Math.min(pages, page + 1))}
            aria-disabled={page === pages}
            className={`rounded-lg border border-neutral-300 px-3 py-1.5 dark:border-neutral-700 ${
              page === pages ? "pointer-events-none opacity-40" : "hover:bg-neutral-50 dark:hover:bg-neutral-800"
            }`}
          >
            Next
          </Link>
        </nav>
      )}
    </div>
  );
}
