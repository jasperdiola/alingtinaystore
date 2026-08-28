/**
 * Which payment methods make sense for which fulfilment type. Pure — no Next,
 * no database, no React.
 *
 * Kept out of app/actions/checkout.ts because a "use server" module may only
 * export async functions, and the checkout FORM needs these rules too: the list
 * a customer sees and the list the server accepts have to be the same list, or
 * one of them is wrong.
 *
 * The rule is only interesting for two of the six types, but both were being
 * offered in the wrong place: "Cash on Delivery" appeared on a pickup order
 * where no rider is involved, and "Pay at the Store" on a delivery order the
 * customer never visits the store for.
 */

export type Fulfillment = "pickup" | "delivery";

/**
 * Types that only work one way round. Anything not listed — the QR wallets and
 * bank transfer — is paid before the order moves and works for both, so listing
 * only the exceptions keeps a new payment type working by default rather than
 * silently disappearing from the form.
 */
const ONLY_FOR: Record<string, Fulfillment> = {
  // There is no rider to hand cash to when the customer collects it themselves.
  cod: "delivery",
  // There is no counter to pay at when it is being delivered.
  pay_on_pickup: "pickup",
};

export function isPaymentAllowed(type: string, fulfillment: Fulfillment): boolean {
  const restriction = ONLY_FOR[type];
  return restriction === undefined || restriction === fulfillment;
}

export function availablePayments<T extends { type: string }>(
  methods: T[],
  fulfillment: Fulfillment
): T[] {
  return methods.filter((m) => isPaymentAllowed(m.type, fulfillment));
}

/** Explains the refusal in the customer's terms rather than naming a column. */
export function paymentMismatchMessage(name: string, fulfillment: Fulfillment): string {
  return fulfillment === "pickup"
    ? `${name} isn't available for pickup orders — you'll be collecting it yourself.`
    : `${name} isn't available for delivery orders.`;
}
