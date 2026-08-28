/**
 * The order state machine. Pure — no Next, no database, no session.
 *
 * Kept out of app/actions/orders.ts deliberately: a "use server" module may
 * only export async functions, so a synchronous helper living there is a
 * latent build error. Being pure also means it can be unit-tested directly.
 *
 * The lifecycle, as operated by hand at the store:
 *
 *   delivery   preparing → out_for_delivery → completed
 *   pickup     preparing → ready            → completed
 *
 * Orders are created already `preparing` (the column default) — nobody has to
 * press a button to start work on an order that has just come in.
 */

const DELIVERY_FLOW = ["preparing", "out_for_delivery", "completed"] as const;
const PICKUP_FLOW = ["preparing", "ready", "completed"] as const;

const TERMINAL = new Set(["completed", "cancelled"]);

/**
 * Statuses that are not on this order's own flow, and where each one exits to.
 *
 * Two kinds land here. First, statuses that predate this lifecycle — earlier
 * orders and the demo seed sit in `pending` and `confirmed`. Second, a status
 * belonging to the *other* fulfilment type: `ready` is a pickup step, so a
 * delivery order on it goes out next, and `out_for_delivery` is a delivery
 * step, so a pickup order that somehow reached it has already left the shop
 * and the only sensible exit is completed.
 *
 * Every status must appear here or on its own flow. Anything missing has no
 * button at all and is stranded forever — which is exactly what happened to
 * pickup orders sitting in `out_for_delivery` before this entry existed.
 */
const OFF_FLOW_NEXT: Record<string, { delivery: string; pickup: string }> = {
  pending: { delivery: "preparing", pickup: "preparing" },
  confirmed: { delivery: "preparing", pickup: "preparing" },
  ready: { delivery: "out_for_delivery", pickup: "completed" },
  out_for_delivery: { delivery: "completed", pickup: "completed" },
};

export function nextStatus(current: string, fulfillment: string): string | null {
  const pickup = fulfillment === "pickup";
  const flow: readonly string[] = pickup ? PICKUP_FLOW : DELIVERY_FLOW;

  const i = flow.indexOf(current);
  if (i !== -1) return i === flow.length - 1 ? null : flow[i + 1];

  const off = OFF_FLOW_NEXT[current];
  return off ? (pickup ? off.pickup : off.delivery) : null;
}

export const canCancel = (status: string) => !TERMINAL.has(status);

/** Roles allowed to actually cancel, and to rule on someone else's request. */
export const canApproveCancel = (role: string) =>
  role === "manager" || role === "super_admin";

/**
 * Roles allowed to void an order — the remedy for one that should never have
 * existed, typically a slip at the POS.
 *
 * Same two roles as cancelling, but kept as its own rule rather than reusing
 * canApproveCancel: these answer different questions ("may you end a real
 * order?" vs "may you strike one from the record?"), and if the store ever
 * wants a shift manager who can cancel but not void, that change should be one
 * edit here rather than a hunt for every call site.
 */
export const canDeleteOrder = (role: string) =>
  role === "manager" || role === "super_admin";
