import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { pesoExact } from "@/lib/format";
import { getBusiness, getInvoice } from "@/lib/queries/invoices";
import PrintButton from "../_components/print-button";

export const metadata: Metadata = {
  title: "Invoice · Aling Tinay Admin",
  robots: { index: false, follow: false },
};

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [inv, business] = await Promise.all([getInvoice(id), getBusiness()]);
  if (!inv) notFound();

  const paid = inv.payment === "verified";
  const muted = "text-neutral-600 dark:text-neutral-400 dark:print:text-neutral-700";

  return (
    <div className="mx-auto max-w-3xl">
      {/* Screen-only toolbar — print:hidden keeps it off the paper. */}
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link
          href="/admin/invoices"
          className="text-xs text-neutral-500 underline-offset-4 hover:underline"
        >
          ← All invoices
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href={`/admin/orders/${inv.id}`}
            className="h-9 rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700"
          >
            View order
          </Link>
          <PrintButton />
        </div>
      </div>

      {/* data-invoice is what the print stylesheet promotes to the whole page;
          everything else on screen is hidden when printing. */}
      <article
        data-invoice
        className="rounded-xl border border-neutral-200 bg-white p-8 text-neutral-900 print:rounded-none print:border-0 print:p-0 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:print:bg-white dark:print:text-black"
      >
        <header className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-xl font-bold tracking-tight">{business.name}</h1>
            {business.tagline && (
              <p className="mt-0.5 max-w-xs text-xs text-neutral-500">
                {business.tagline}
              </p>
            )}
            <p className={`mt-2 text-xs ${muted}`}>
              {inv.store.name} branch
              <br />
              {inv.store.address}
              {inv.store.phone && (
                <>
                  <br />
                  {inv.store.phone}
                </>
              )}
            </p>
          </div>

          <div className="text-right">
            <p className="text-sm font-semibold uppercase tracking-wide">Invoice</p>
            <p className="mt-1 text-lg font-bold tabular-nums">{inv.code}</p>
            <p className="mt-1 text-xs text-neutral-500">Issued {day(inv.createdAt)}</p>
            {/* Border + word, never colour alone. */}
            <p
              className={`mt-2 inline-block rounded border px-2 py-0.5 text-xs font-bold uppercase ${
                paid
                  ? "border-green-600 text-green-700"
                  : "border-neutral-400 text-neutral-600"
              }`}
            >
              {paid ? "Paid" : "Unpaid"}
            </p>
          </div>
        </header>

        <section className="mt-8 grid gap-6 sm:grid-cols-2">
          <div>
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              Bill to
            </h2>
            <p className="mt-1 text-sm font-medium">{inv.billTo.name}</p>
            <p className={`text-xs ${muted}`}>
              {inv.billTo.phone}
              {inv.billTo.email && (
                <>
                  <br />
                  {inv.billTo.email}
                </>
              )}
              {inv.billTo.address && (
                <>
                  <br />
                  {inv.billTo.address}
                </>
              )}
            </p>
          </div>
          <div className="sm:text-right">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              Details
            </h2>
            <p className={`mt-1 text-xs ${muted}`}>
              {inv.fulfillment === "delivery" ? "For delivery" : "For pickup"}
              {inv.paymentInfo.method && (
                <>
                  <br />
                  {inv.paymentInfo.method}
                </>
              )}
              {inv.paymentInfo.reference && (
                <>
                  <br />
                  Ref. {inv.paymentInfo.reference}
                </>
              )}
              {inv.paidAt && (
                <>
                  <br />
                  Paid {day(inv.paidAt)}
                </>
              )}
            </p>
          </div>
        </section>

        <table className="mt-8 w-full text-sm">
          <thead>
            <tr className="border-y border-neutral-300 text-left text-[11px] uppercase tracking-wide text-neutral-500">
              <th scope="col" className="py-2 font-semibold">Item</th>
              <th scope="col" className="py-2 text-right font-semibold">Unit price</th>
              <th scope="col" className="py-2 text-right font-semibold">Qty</th>
              <th scope="col" className="py-2 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.items.map((i) => (
              <tr key={i.id} className="border-b border-neutral-200">
                <td className="py-2.5">
                  {i.name}
                  <span className="ml-2 text-xs text-neutral-500">{i.size}</span>
                </td>
                <td className="py-2.5 text-right tabular-nums">{pesoExact(i.unitPrice)}</td>
                <td className="py-2.5 text-right tabular-nums">{i.quantity}</td>
                <td className="py-2.5 text-right tabular-nums">{pesoExact(i.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex justify-end">
          <dl className="w-full max-w-xs text-sm">
            <div className="flex justify-between py-1">
              <dt className={muted}>Subtotal</dt>
              <dd className="tabular-nums">{pesoExact(inv.money.subtotal)}</dd>
            </div>
            {inv.money.deliveryFee > 0 && (
              <div className="flex justify-between py-1">
                <dt className={muted}>Delivery fee</dt>
                <dd className="tabular-nums">{pesoExact(inv.money.deliveryFee)}</dd>
              </div>
            )}
            {inv.money.discount > 0 && (
              <div className="flex justify-between py-1">
                <dt className={muted}>Discount</dt>
                <dd className="tabular-nums">−{pesoExact(inv.money.discount)}</dd>
              </div>
            )}
            <div className="mt-1 flex justify-between border-t border-neutral-300 pt-2 text-base font-bold">
              <dt>Total</dt>
              <dd className="tabular-nums">{pesoExact(inv.money.total)}</dd>
            </div>
            <div className="flex justify-between pt-1 text-[11px] text-neutral-500">
              <dt>{inv.money.vatInclusive ? "VAT included (12%)" : "VAT (12%)"}</dt>
              <dd className="tabular-nums">{pesoExact(inv.money.vat)}</dd>
            </div>
          </dl>
        </div>

        <footer className="mt-10 border-t border-neutral-200 pt-4 text-[11px] leading-relaxed text-neutral-500">
          <p>
            Thank you for your purchase.
            {business.phone ? ` Questions? ${business.phone}` : ""}
          </p>
          {/* Deliberate and load-bearing. An Official Receipt in the Philippines
              needs a BIR permit number, the business TIN, and an accredited
              serial series. None of that exists in this database, so this
              document must not present itself as one. */}
          <p className="mt-1">
            This is an internal sales invoice for record-keeping. It is not a
            BIR-registered Official Receipt.
          </p>
        </footer>
      </article>
    </div>
  );
}
