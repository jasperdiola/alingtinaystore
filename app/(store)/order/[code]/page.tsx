import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { peso } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/queries/storefront";
import { CheckIcon, MapPinIcon, PhoneIcon } from "../../_components/icons";

export const metadata: Metadata = {
  title: "Order placed",
  // A receipt reachable by order code should never be indexed.
  robots: { index: false, follow: false },
};

/**
 * Order receipt, addressed by the human-readable order code.
 *
 * Keyed on order_code rather than the uuid so the URL is something a customer
 * can read back over the phone. The code is random (AT-XXXXXX), the page is
 * noindex, and it shows nothing a shop assistant would not read out anyway —
 * no payment details, no other customer's data.
 *
 * Voided orders are excluded, so an order struck from the record stops
 * resolving here too.
 */
export default async function OrderPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  await connection();
  const { code } = await params;

  const [order, settings] = await Promise.all([
    prisma.orders.findFirst({
      where: { order_code: code.toUpperCase(), deleted_at: null },
      select: {
        order_code: true,
        fulfillment_type: true,
        customer_name: true,
        subtotal: true,
        delivery_fee: true,
        total_amount: true,
        payment_method_name: true,
        address_line: true,
        stores: { select: { name: true, address_line: true } },
        order_items: {
          select: {
            product_name: true,
            size_label: true,
            quantity: true,
            line_total: true,
          },
        },
      },
    }),
    getSettings(),
  ]);

  if (!order) notFound();

  const pickup = order.fulfillment_type === "pickup";

  return (
    <div className="min-h-screen bg-cream pb-16 pt-20 sm:pt-24">
      <div className="mx-auto max-w-2xl px-4 sm:px-6">
        <div className="rounded-2xl bg-white p-6 text-center shadow-sm sm:p-8">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-green-100">
            <CheckIcon className="h-6 w-6 text-green-700" />
          </span>
          <h1 className="mt-4 text-2xl font-bold text-gray-900">Order placed</h1>
          <p className="mt-1 text-sm text-gray-600">
            Salamat, {order.customer_name.split(" ")[0]}! We&rsquo;ll call to confirm
            shortly.
          </p>
          <p className="mt-4 text-xs uppercase tracking-wider text-gray-400">
            Your order code
          </p>
          <p className="text-3xl font-bold tracking-tight text-peanut">
            {order.order_code}
          </p>
        </div>

        <div className="mt-4 rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900">
            {pickup ? "Collect from" : "Delivering to"}
          </h2>
          <p className="mt-1 flex items-start gap-2 text-sm text-gray-600">
            <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0 text-peanut" />
            {pickup ? (
              <span>
                <span className="block font-medium text-gray-900">
                  {order.stores.name}
                </span>
                {order.stores.address_line}
              </span>
            ) : (
              <span>
                <span className="block">{order.address_line}</span>
                <span className="text-xs text-gray-400">
                  Prepared at {order.stores.name}
                </span>
              </span>
            )}
          </p>

          <ul className="mt-5 space-y-2 border-t border-gray-100 pt-4">
            {order.order_items.map((i, n) => (
              <li key={n} className="flex justify-between gap-3 text-sm">
                <span className="min-w-0 text-gray-700">
                  {i.product_name}
                  <span className="text-gray-400">
                    {" "}
                    · {i.size_label} × {i.quantity}
                  </span>
                </span>
                <span className="tabular-nums text-gray-900">
                  {peso(Number(i.line_total))}
                </span>
              </li>
            ))}
          </ul>

          <dl className="mt-4 space-y-1.5 border-t border-gray-100 pt-4 text-sm">
            <div className="flex justify-between text-gray-600">
              <dt>Subtotal</dt>
              <dd className="tabular-nums">{peso(Number(order.subtotal))}</dd>
            </div>
            <div className="flex justify-between text-gray-600">
              <dt>Delivery</dt>
              <dd className="tabular-nums">
                {Number(order.delivery_fee) === 0
                  ? "Free"
                  : peso(Number(order.delivery_fee))}
              </dd>
            </div>
            <div className="flex justify-between border-t border-gray-100 pt-2 text-base font-bold text-gray-900">
              <dt>Total</dt>
              <dd className="tabular-nums">{peso(Number(order.total_amount))}</dd>
            </div>
          </dl>

          <p className="mt-3 rounded-xl bg-cream p-3 text-xs leading-relaxed text-gray-600">
            Paying by <strong>{order.payment_method_name}</strong>.{" "}
            {settings["order.support_note"]}
          </p>
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Link
            href="/shop"
            className="flex-1 rounded-full bg-peanut px-6 py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-roasted"
          >
            Keep shopping
          </Link>
          {settings["contact.phone"] && (
            <a
              href={`tel:${settings["contact.phone_e164"] ?? settings["contact.phone"]}`}
              className="flex flex-1 items-center justify-center gap-2 rounded-full border border-gray-300 px-6 py-3 text-sm font-semibold text-gray-700 transition-colors hover:border-peanut hover:text-peanut"
            >
              <PhoneIcon className="h-4 w-4" />
              {settings["contact.phone"]}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
