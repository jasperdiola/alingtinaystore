import type { Metadata } from "next";
import Link from "next/link";
import { count, peso } from "@/lib/format";
import { listInvoices, PAGE_SIZE } from "@/lib/queries/invoices";
import { PaymentBadge } from "../orders/_components/badges";

export const metadata: Metadata = {
  title: "Invoices · Aling Tinay Admin",
  robots: { index: false, follow: false },
};

const when = (iso: string) =>
  new Date(iso).toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
  });

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const page = Number(sp.page ?? 1) || 1;
  const { rows, total, pages } = await listInvoices({ q: sp.q, payment: sp.payment, page });

  const qs = (p: number) => {
    const next = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]);
    next.set("page", String(p));
    return `/admin/invoices?${next.toString()}`;
  };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Invoices</h2>
        <p className="text-xs text-neutral-500">
          {count(total)} invoiceable order{total === 1 ? "" : "s"} · cancelled orders excluded
          {total > PAGE_SIZE && ` · page ${page} of ${pages}`}
        </p>
      </div>

      <form className="mb-4 grid grid-cols-1 gap-2 sm:flex">
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Order code, name or phone"
          aria-label="Search invoices"
          className="h-9 w-full sm:w-64 rounded-lg border border-neutral-300 px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
        <select
          name="payment"
          defaultValue={sp.payment ?? ""}
          aria-label="Filter by payment"
          className="h-9 rounded-lg border border-neutral-300 px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        >
          <option value="">All payments</option>
          <option value="verified">Paid</option>
          <option value="unpaid">Unpaid</option>
          <option value="awaiting_verification">Awaiting check</option>
        </select>
        <button className="h-9 rounded-lg border border-neutral-300 px-3 text-sm dark:border-neutral-700">
          Search
        </button>
      </form>

      {rows.length === 0 ? (
        <div className="grid h-40 place-items-center rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700">
          <p className="text-sm text-neutral-500">No invoices match.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <table className="rtable w-full text-sm sm:min-w-[640px]">
            <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500 dark:border-neutral-800">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">Invoice no.</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Date</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Customer</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Store</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Payment</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50 dark:border-neutral-800/60 dark:hover:bg-neutral-800/40">
                  <td data-label="" className="px-4 py-3">
                    <Link href={`/admin/invoices/${r.id}`} className="font-medium underline-offset-4 hover:underline">
                      {r.code}
                    </Link>
                  </td>
                  <td data-label="Date" className="px-4 py-3 text-neutral-600 dark:text-neutral-400">{when(r.createdAt)}</td>
                  <td data-label="Customer" className="px-4 py-3">{r.customer}</td>
                  <td data-label="Store" className="px-4 py-3 text-neutral-600 dark:text-neutral-400">{r.store}</td>
                  <td data-label="Payment" className="px-4 py-3"><PaymentBadge payment={r.payment} /></td>
                  <td data-label="Amount" className="px-4 py-3 text-right tabular-nums font-medium">{peso(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination">
          <Link href={qs(Math.max(1, page - 1))} className={`rounded-lg border border-neutral-300 px-3 py-1.5 dark:border-neutral-700 ${page === 1 ? "pointer-events-none opacity-40" : ""}`}>Previous</Link>
          <span className="text-xs text-neutral-500">Page {page} of {pages}</span>
          <Link href={qs(Math.min(pages, page + 1))} className={`rounded-lg border border-neutral-300 px-3 py-1.5 dark:border-neutral-700 ${page === pages ? "pointer-events-none opacity-40" : ""}`}>Next</Link>
        </nav>
      )}
    </div>
  );
}
