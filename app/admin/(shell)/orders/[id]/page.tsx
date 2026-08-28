import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/auth/admin";
import { canApproveCancel, canCancel, canDeleteOrder, nextStatus } from "@/lib/orders/flow";
import { pesoExact, statusLabel } from "@/lib/format";
import { getOrder } from "@/lib/queries/orders";
import ActionsPanel from "../_components/actions-panel";
import { FulfillmentBadge, PAYMENT_LABEL, PaymentBadge, StatusBadge } from "../_components/badges";

export const metadata: Metadata = {
  title: "Order · Aling Tinay Admin",
  robots: { index: false, follow: false },
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  });

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="shrink-0 text-neutral-500">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // getOrder applies the same store scope as the list, so an out-of-scope id
  // is indistinguishable from one that doesn't exist.
  const [order, session] = await Promise.all([getOrder(id), getAdminSession()]);
  if (!order) notFound();

  const next = nextStatus(order.status, order.fulfillment);

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href="/admin/orders"
        className="text-xs text-neutral-500 underline-offset-4 hover:underline"
      >
        ← All orders
      </Link>

      <header className="mt-2 mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{order.code}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
            <span>{when(order.timestamps.created)}</span>·<span>{order.store}</span>·
            <FulfillmentBadge type={order.fulfillment} />
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge status={order.status} />
          <PaymentBadge payment={order.payment} />
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {/* ------------------------------------------------------- items */}
          <section className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
            <h3 className="border-b border-neutral-200 px-5 py-3 text-sm font-semibold dark:border-neutral-800">
              Items
            </h3>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-neutral-500">
                <tr>
                  <th scope="col" className="px-5 py-2 font-medium">Product</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Unit</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Qty</th>
                  <th scope="col" className="px-5 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((i) => (
                  <tr key={i.id} className="border-t border-neutral-100 dark:border-neutral-800/60">
                    <td className="px-5 py-2.5">
                      {i.name}
                      <span className="ml-2 text-xs text-neutral-500">{i.size}</span>
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{pesoExact(i.unitPrice)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{i.quantity}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{pesoExact(i.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <dl className="border-t border-neutral-200 px-5 py-3 dark:border-neutral-800">
              <Row label="Subtotal" value={<span className="tabular-nums">{pesoExact(order.money.subtotal)}</span>} />
              {order.money.deliveryFee > 0 && (
                <Row label="Delivery fee" value={<span className="tabular-nums">{pesoExact(order.money.deliveryFee)}</span>} />
              )}
              {order.money.discount > 0 && (
                <Row label="Discount" value={<span className="tabular-nums">−{pesoExact(order.money.discount)}</span>} />
              )}
              <div className="mt-1 flex justify-between border-t border-neutral-200 pt-2 text-sm font-semibold dark:border-neutral-800">
                <span>Total</span>
                <span className="tabular-nums">{pesoExact(order.money.total)}</span>
              </div>
              <p className="mt-1 text-right text-[11px] text-neutral-500">
                {order.money.vatInclusive ? "VAT-inclusive" : "VAT added"} ·{" "}
                {pesoExact(order.money.vat)} VAT
              </p>
            </dl>
          </section>

          {/* ----------------------------------------------------- customer */}
          <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
            <h3 className="mb-2 text-sm font-semibold">Customer</h3>
            <dl>
              <Row label="Name" value={order.customer.name} />
              <Row label="Phone" value={order.customer.phone} />
              <Row label="Email" value={order.customer.email} />
              <Row label="Address" value={order.customer.address} />
              <Row label="Landmark" value={order.customer.landmark} />
              <Row label="Notes" value={order.customer.notes} />
            </dl>
          </section>

          {/* ------------------------------------------------------ history */}
          <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
            <h3 className="mb-3 text-sm font-semibold">History</h3>
            <ol className="flex flex-col gap-3">
              {order.history.map((h) => (
                <li key={h.id} className="flex gap-3 text-sm">
                  <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-neutral-400" />
                  <div className="min-w-0">
                    <p>
                      {h.toStatus && (
                        <>
                          {h.fromStatus ? `${statusLabel(h.fromStatus)} → ` : ""}
                          <span className="font-medium">{statusLabel(h.toStatus)}</span>
                        </>
                      )}
                      {h.toPayment && h.toPayment !== h.fromPayment && (
                        <span className="text-neutral-600 dark:text-neutral-400">
                          {h.toStatus ? " · " : ""}payment {PAYMENT_LABEL[h.toPayment] ?? h.toPayment}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {when(h.at)}
                      {/* changed_by comes from auth.uid(); the action sets
                          request.jwt.claims so this is populated. Rows written
                          before that (or by the seed) show as System. */}
                      {" · "}
                      {h.by ?? "System"}
                      {h.note ? ` · ${h.note}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>

        {/* ------------------------------------------------------- sidebar */}
        <div className="flex flex-col gap-4">
          <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
            <h3 className="mb-2 text-sm font-semibold">Actions</h3>
            <ActionsPanel
              orderId={order.id}
              status={order.status}
              payment={order.payment}
              next={next}
              cancellable={canCancel(order.status)}
              canApprove={canApproveCancel(session?.role ?? "staff")}
              canDelete={canDeleteOrder(session?.role ?? "staff")}
              cancelRequest={order.cancelRequest}
            />
          </section>

          <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
            <h3 className="mb-2 text-sm font-semibold">Payment details</h3>
            <dl>
              <Row label="Method" value={order.paymentInfo.method} />
              <Row label="Reference" value={order.paymentInfo.reference} />
              <Row label="Submitted" value={order.paymentInfo.submittedAt && when(order.paymentInfo.submittedAt)} />
              <Row label="Verified" value={order.paymentInfo.verifiedAt && when(order.paymentInfo.verifiedAt)} />
              <Row label="Rejected because" value={order.paymentInfo.rejectionReason} />
            </dl>
          </section>

          {order.cancelReason && (
            <section className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm dark:border-rose-900 dark:bg-rose-950/30">
              <h3 className="mb-1 font-semibold">Cancelled</h3>
              <p className="text-neutral-700 dark:text-neutral-300">{order.cancelReason}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
