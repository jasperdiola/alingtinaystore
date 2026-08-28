"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useSyncExternalStore } from "react";
import { placeOrderAction, type CheckoutState } from "@/app/actions/checkout";
import { cartStore, cartSubtotal, toOrderLines } from "@/lib/cart/store";
import { peso } from "@/lib/format";
import { availablePayments, type Fulfillment } from "@/lib/orders/payment";
import type { Branch } from "@/lib/queries/storefront";
import { ArrowRightIcon, CartIcon } from "../../_components/icons";
import ProductImage from "../../_components/product-image";

export type PaymentOption = {
  id: string;
  name: string;
  /** payment_methods.type — decides which fulfilment types it suits. */
  type: string;
  instructions: string | null;
  requiresProof: boolean;
  /** Public URL of the QR to scan, when this method has one. */
  qrImagePath: string | null;
};

const field =
  "mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none transition-all focus:border-peanut focus:ring-2 focus:ring-peanut/10";
const label = "block text-xs font-medium text-gray-600";

export default function CheckoutForm({
  branches,
  payments,
  deliveryFee,
}: {
  branches: Branch[];
  payments: PaymentOption[];
  deliveryFee: number;
}) {
  const cart = useSyncExternalStore(
    cartStore.subscribe,
    cartStore.getSnapshot,
    cartStore.getServerSnapshot
  );
  const router = useRouter();
  const [state, submit, pending] = useActionState(placeOrderAction, null as CheckoutState);
  const [fulfillment, setFulfillment] = useState<Fulfillment>("pickup");
  const [paymentId, setPaymentId] = useState<string | null>(null);

  /*
   * On success the cart must be emptied and the customer sent to the receipt.
   * This is a genuine external effect — clearing localStorage and navigating —
   * triggered by a value arriving from the server, which is what effects are
   * for. Keyed on the order code so it runs once per order.
   */
  useEffect(() => {
    if (state?.ok) {
      cartStore.clear();
      router.push(`/order/${state.code}`);
    }
  }, [state, router]);

  const subtotal = cartSubtotal(cart);
  const fee = fulfillment === "delivery" ? deliveryFee : 0;
  const total = Math.round((subtotal + fee) * 100) / 100;

  /*
   * Only the methods that suit the chosen fulfilment.
   *
   * "Cash on Delivery" on a pickup order and "Pay at the Store" on a delivery
   * order were both being offered, and either would have produced an order
   * nobody could actually pay for.
   *
   * The selection is DERIVED rather than stored: switching from pickup to
   * delivery silently invalidates "Pay at the Store", so falling back to the
   * first valid option during render keeps the radio and the hidden field in
   * step without an effect that fires after a wrong value has been submitted.
   */
  const available = availablePayments(payments, fulfillment);
  const activePaymentId =
    paymentId && available.some((p) => p.id === paymentId)
      ? paymentId
      : (available[0]?.id ?? "");
  const chosenPayment = available.find((p) => p.id === activePaymentId);

  if (cart.lines.length === 0 && !state?.ok) {
    return (
      <div className="grid place-items-center rounded-2xl border border-dashed border-peanut/30 bg-white/60 px-6 py-20 text-center">
        <div className="max-w-sm">
          <CartIcon className="mx-auto h-8 w-8 text-gray-300" />
          <h2 className="mt-3 font-semibold text-gray-900">Your cart is empty</h2>
          <p className="mt-1.5 text-sm text-gray-600">
            Add a few things and come back to place your order.
          </p>
          <Link
            href="/shop"
            className="mt-4 inline-flex items-center rounded-full bg-peanut px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-roasted"
          >
            Browse products
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={submit} className="grid gap-6 lg:grid-cols-[1fr_22rem] lg:items-start">
      {/* The cart travels as ids and quantities. Prices are re-read on the
          server, so nothing here can change what the order costs. */}
      <input type="hidden" name="lines" value={JSON.stringify(toOrderLines(cart))} />
      <input type="hidden" name="fulfillment" value={fulfillment} />
      <input type="hidden" name="paymentMethodId" value={activePaymentId} />

      <div className="space-y-5">
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900">How would you like it?</h2>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(["pickup", "delivery"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFulfillment(f)}
                aria-pressed={fulfillment === f}
                className={`rounded-xl border px-4 py-3 text-sm font-medium capitalize transition-colors ${
                  fulfillment === f
                    ? "border-peanut bg-peanut/10 text-peanut"
                    : "border-gray-200 text-gray-600 hover:border-peanut/40"
                }`}
              >
                {f}
                <span className="mt-0.5 block text-[11px] font-normal text-gray-400">
                  {f === "pickup" ? "Collect at a branch" : `+${peso(deliveryFee)} fee`}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900">
            {fulfillment === "pickup" ? "Collect from" : "Prepared at"}
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {fulfillment === "pickup"
              ? "Pick the branch you'll drop by."
              : "We'll deliver from the branch nearest you."}
          </p>
          <div className="mt-3 space-y-2">
            {branches.map((b) => (
              <label
                key={b.id}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 p-3 transition-colors has-[:checked]:border-peanut has-[:checked]:bg-peanut/5"
              >
                <input
                  type="radio"
                  name="storeId"
                  value={b.id}
                  defaultChecked={b.id === branches[0]?.id}
                  className="mt-0.5 size-4 accent-[#c68642]"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-gray-900">{b.name}</span>
                  {b.address && (
                    <span className="block text-xs text-gray-500">{b.address}</span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900">Your details</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className={label}>
              Name
              <input name="customerName" required maxLength={120} className={field} />
            </label>
            <label className={label}>
              Mobile number
              <input
                name="customerPhone"
                required
                inputMode="tel"
                placeholder="09XXXXXXXXX"
                className={field}
              />
            </label>
            <label className={`${label} sm:col-span-2`}>
              Email <span className="text-gray-400">(optional)</span>
              <input name="customerEmail" type="email" className={field} />
            </label>

            {fulfillment === "delivery" && (
              <>
                <label className={`${label} sm:col-span-2`}>
                  Street address
                  <input name="addressLine" required className={field} />
                </label>
                <label className={label}>
                  Barangay
                  <input name="barangay" className={field} />
                </label>
                <label className={label}>
                  City / municipality
                  <input name="city" className={field} />
                </label>
              </>
            )}

            <label className={`${label} sm:col-span-2`}>
              Notes <span className="text-gray-400">(optional)</span>
              <textarea name="notes" rows={2} maxLength={500} className={field} />
            </label>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900">Payment</h2>
          <div className="mt-3 space-y-2">
            {available.map((p) => (
              <label
                key={p.id}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 p-3 transition-colors has-[:checked]:border-peanut has-[:checked]:bg-peanut/5"
              >
                <input
                  type="radio"
                  name="paymentChoice"
                  checked={activePaymentId === p.id}
                  onChange={() => setPaymentId(p.id)}
                  className="mt-0.5 size-4 accent-[#c68642]"
                />
                <span className="text-sm font-medium text-gray-900">{p.name}</span>
              </label>
            ))}
          </div>
          {(chosenPayment?.qrImagePath || chosenPayment?.instructions) && (
            <div className="mt-3 rounded-xl bg-cream p-3">
              {chosenPayment.qrImagePath && (
                <figure className="mb-3 flex flex-col items-center">
                  {/*
                    A plain img, and bounded by HEIGHT as well as width.

                    These are phone screenshots — tall portraits where the QR is
                    roughly half the frame and the rest is the wallet's own
                    chrome. Constraining width alone made the panel enormous and
                    the code no bigger. object-contain keeps the aspect ratio
                    whichever shape the next upload happens to be.

                    next/image is avoided on purpose: it resamples, and a
                    resampled QR can stop scanning.
                  */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={chosenPayment.qrImagePath}
                    alt={`${chosenPayment.name} QR code`}
                    className="max-h-[340px] w-auto max-w-full rounded-lg border border-peanut/20 bg-white object-contain p-1.5"
                  />
                  <figcaption className="mt-1.5 text-center text-[11px] text-gray-500">
                    Scan to pay with {chosenPayment.name} ·{" "}
                    {/* Scanning off a screen fails often enough — from glare, a
                        cracked lens, a small window — that a way to enlarge is
                        worth more than it costs. */}
                    <a
                      href={chosenPayment.qrImagePath}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2 hover:text-peanut"
                    >
                      open full size
                    </a>
                  </figcaption>
                </figure>
              )}
              {chosenPayment.instructions && (
                <p className="text-xs leading-relaxed text-gray-600">
                  {chosenPayment.instructions}
                </p>
              )}
              {chosenPayment.requiresProof && (
                <p className="mt-2 text-[11px] font-medium text-peanut">
                  Keep your receipt — we&rsquo;ll ask for it to confirm the order.
                </p>
              )}
            </div>
          )}
        </section>
      </div>

      {/* ------------------------------------------------------------ summary */}
      <aside className="rounded-2xl bg-white p-5 shadow-sm lg:sticky lg:top-24">
        <h2 className="text-sm font-semibold text-gray-900">Order summary</h2>

        <ul className="mt-3 space-y-3">
          {cart.lines.map((l) => (
            <li key={l.sizeId} className="flex gap-3">
              <div className="size-12 shrink-0 overflow-hidden rounded-lg bg-cream">
                <ProductImage
                  src={l.image}
                  alt={l.productName}
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">{l.productName}</p>
                <p className="text-xs text-gray-500">
                  {l.sizeLabel} × {l.qty}
                </p>
              </div>
              <span className="text-sm font-medium tabular-nums text-gray-900">
                {peso(Math.round(l.price * l.qty * 100) / 100)}
              </span>
            </li>
          ))}
        </ul>

        <dl className="mt-4 space-y-1.5 border-t border-gray-100 pt-4 text-sm">
          <div className="flex justify-between text-gray-600">
            <dt>Subtotal</dt>
            <dd className="tabular-nums">{peso(subtotal)}</dd>
          </div>
          <div className="flex justify-between text-gray-600">
            <dt>Delivery</dt>
            <dd className="tabular-nums">{fee === 0 ? "Free" : peso(fee)}</dd>
          </div>
          <div className="flex justify-between border-t border-gray-100 pt-2 text-base font-bold text-gray-900">
            <dt>Total</dt>
            <dd className="tabular-nums">{peso(total)}</dd>
          </div>
        </dl>
        <p className="mt-1 text-[11px] text-gray-400">VAT included.</p>

        {state && !state.ok && (
          <p
            role="alert"
            className="mt-3 rounded-xl bg-rose-50 p-3 text-xs text-rose-700"
          >
            {state.message}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-peanut px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-roasted disabled:opacity-60"
        >
          {pending ? "Placing order…" : "Place order"}
          {!pending && <ArrowRightIcon className="h-4 w-4" />}
        </button>
        <p className="mt-2 text-center text-[11px] text-gray-400">
          We&rsquo;ll call to confirm before preparing your order.
        </p>
      </aside>
    </form>
  );
}
