"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession, type AdminSession } from "@/lib/auth/admin";
import { withActor } from "@/lib/auth/db-actor";
import { canApproveCancel, canCancel, canDeleteOrder, nextStatus } from "@/lib/orders/flow";
import { prisma } from "@/lib/prisma";

export type OrderActionState = { ok: boolean; message: string } | null;


/* ------------------------------------------------------------ authorization */

/** Mirrors can_manage_store() in SQL. */
function canManageStore(session: AdminSession, storeId: string): boolean {
  return (
    session.role === "super_admin" ||
    session.storeId === null ||
    session.storeId === storeId
  );
}

type LoadedOrder = {
  id: string;
  store_id: string;
  status: string;
  payment_status: string;
  fulfillment_type: string;
  cancel_requested_at: Date | null;
  cancel_request_reason: string | null;
  deletedAt: Date | null;
};

/** Explicitly tagged so `denied` narrows cleanly at every call site. */
type Authorized =
  | { denied: true; message: string }
  | { denied: false; session: AdminSession; order: LoadedOrder };

async function authorize(orderId: string, allowVoided = false): Promise<Authorized> {
  const session = await getAdminSession();
  if (!session) return { denied: true, message: "You are not signed in." };

  const order = await prisma.orders.findUnique({
    where: { id: orderId },
    select: {
      id: true, store_id: true, status: true, payment_status: true, fulfillment_type: true,
      cancel_requested_at: true, cancel_request_reason: true, deleted_at: true,
    },
  });
  if (!order) return { denied: true, message: "That order no longer exists." };
  // A voided order is out of circulation. deleteOrderAction re-checks the flag
  // itself so it can give a clearer message than this one.
  if (order.deleted_at && !allowVoided) {
    return { denied: true, message: "That order was voided and can no longer be changed." };
  }
  if (!canManageStore(session, order.store_id)) {
    return { denied: true, message: "That order belongs to a store you don't manage." };
  }
  return {
    denied: false,
    session,
    order: {
      id: order.id,
      store_id: order.store_id,
      status: order.status as string,
      payment_status: order.payment_status as string,
      fulfillment_type: order.fulfillment_type as string,
      cancel_requested_at: order.cancel_requested_at,
      cancel_request_reason: order.cancel_request_reason,
      deletedAt: order.deleted_at,
    },
  };
}

function done(path: string, message: string): OrderActionState {
  revalidatePath("/admin/orders");
  revalidatePath(path);
  revalidatePath("/admin");
  return { ok: true, message };
}

/* -------------------------------------------------------------- advance step */

export async function advanceOrderAction(
  _prev: OrderActionState,
  formData: FormData
): Promise<OrderActionState> {
  const id = String(formData.get("id") ?? "");
  const auth = await authorize(id);
  if (auth.denied) return { ok: false, message: auth.message };
  const { session, order } = auth;

  const target = nextStatus(order.status, order.fulfillment_type);
  if (!target) {
    return { ok: false, message: `An order that is ${order.status} cannot advance further.` };
  }
  // Guard against a stale page: the submitted value must match what we
  // computed from the current row, not from whatever the browser last saw.
  const claimed = String(formData.get("to") ?? "");
  if (claimed && claimed !== target) {
    return { ok: false, message: "This order moved on already — reload and try again." };
  }

  try {
    await withActor(session.userId, (tx) =>
      tx.orders.update({
        where: { id },
        data: {
          status: target as never,
          ...(target === "confirmed" ? { confirmed_at: new Date() } : {}),
          ...(target === "completed" ? { completed_at: new Date() } : {}),
        },
      })
    );
  } catch (e) {
    return { ok: false, message: explain(e) };
  }

  return done(`/admin/orders/${id}`, `Marked as ${target.replace(/_/g, " ")}.`);
}

/* ------------------------------------------------------------------- payment */

export async function setPaymentAction(
  _prev: OrderActionState,
  formData: FormData
): Promise<OrderActionState> {
  const id = String(formData.get("id") ?? "");
  const to = String(formData.get("to") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  if (!["verified", "rejected", "refunded"].includes(to)) {
    return { ok: false, message: "Unsupported payment state." };
  }

  const auth = await authorize(id);
  if (auth.denied) return { ok: false, message: auth.message };
  const { session, order } = auth;

  if (to === "rejected" && !reason) {
    return { ok: false, message: "Give a reason when rejecting a payment." };
  }
  if (to === "refunded" && order.payment_status !== "verified") {
    return { ok: false, message: "Only a verified payment can be refunded." };
  }

  try {
    await withActor(session.userId, (tx) =>
      tx.orders.update({
        where: { id },
        data: {
          payment_status: to as never,
          ...(to === "verified"
            ? { payment_verified_at: new Date(), payment_verified_by: session.userId, payment_rejection_reason: null }
            : {}),
          ...(to === "rejected" ? { payment_rejection_reason: reason } : {}),
        },
      })
    );
  } catch (e) {
    return { ok: false, message: explain(e) };
  }

  return done(`/admin/orders/${id}`, `Payment marked ${to}.`);
}

/* -------------------------------------------------------------------- cancel */

export async function cancelOrderAction(
  _prev: OrderActionState,
  formData: FormData
): Promise<OrderActionState> {
  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { ok: false, message: "Give a reason for cancelling." };

  const auth = await authorize(id);
  if (auth.denied) return { ok: false, message: auth.message };
  const { session, order } = auth;

  if (!canCancel(order.status)) {
    return { ok: false, message: `An order that is ${order.status} cannot be cancelled.` };
  }

  // Staff raise a request; the order keeps working until someone senior rules
  // on it. Managers and super_admins skip the queue and cancel outright.
  if (!canApproveCancel(session.role)) {
    if (order.cancel_requested_at) {
      return { ok: false, message: "A cancellation is already awaiting approval." };
    }
    try {
      await withActor(session.userId, (tx) =>
        tx.orders.update({
          where: { id },
          data: {
            cancel_requested_at: new Date(),
            cancel_requested_by: session.userId,
            cancel_request_reason: reason,
          },
        })
      );
    } catch (e) {
      return { ok: false, message: explain(e) };
    }
    return done(
      `/admin/orders/${id}`,
      "Cancellation requested — a manager needs to approve it."
    );
  }

  return finaliseCancel(id, session, reason);
}

/* --------------------------------------------- approve / decline a request */

export async function approveCancelAction(
  _prev: OrderActionState,
  formData: FormData
): Promise<OrderActionState> {
  const id = String(formData.get("id") ?? "");
  const auth = await authorize(id);
  if (auth.denied) return { ok: false, message: auth.message };
  const { session, order } = auth;

  if (!canApproveCancel(session.role)) {
    return { ok: false, message: "Only a manager can approve a cancellation." };
  }
  if (!order.cancel_requested_at) {
    return { ok: false, message: "There is no cancellation to approve." };
  }
  if (!canCancel(order.status)) {
    return { ok: false, message: `An order that is ${order.status} cannot be cancelled.` };
  }

  return finaliseCancel(id, session, order.cancel_request_reason ?? "Approved cancellation");
}

export async function declineCancelAction(
  _prev: OrderActionState,
  formData: FormData
): Promise<OrderActionState> {
  const id = String(formData.get("id") ?? "");
  const auth = await authorize(id);
  if (auth.denied) return { ok: false, message: auth.message };
  const { session, order } = auth;

  if (!canApproveCancel(session.role)) {
    return { ok: false, message: "Only a manager can decline a cancellation." };
  }
  if (!order.cancel_requested_at) {
    return { ok: false, message: "There is no cancellation to decline." };
  }

  try {
    await withActor(session.userId, (tx) =>
      tx.orders.update({
        where: { id },
        data: {
          cancel_requested_at: null,
          cancel_requested_by: null,
          cancel_request_reason: null,
        },
      })
    );
  } catch (e) {
    return { ok: false, message: explain(e) };
  }

  return done(`/admin/orders/${id}`, "Cancellation declined — the order continues.");
}

/* ---------------------------------------------------------------- void */

/**
 * Void an order that should never have been placed — a mis-rung POS sale, a
 * duplicate, a test order in live data.
 *
 * Not a DELETE, on purpose. The row is the only evidence the mistake happened,
 * and order_items, order_status_history and inventory_movements all reference
 * it. It is hidden from every operational view and kept, with the reason, on
 * the voided-orders page.
 *
 * Cancelling first is what returns the stock: restore_stock_on_cancel() fires
 * on the transition and is guarded by stock_deducted_at, so an order that never
 * took stock does not hand any back. Doing it in the same transaction means an
 * order can never end up voided but still holding stock.
 */
export async function deleteOrderAction(
  _prev: OrderActionState,
  formData: FormData
): Promise<OrderActionState> {
  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  const auth = await authorize(id, true);
  if (auth.denied) return { ok: false, message: auth.message };
  const { session, order } = auth;

  if (!canDeleteOrder(session.role)) {
    return { ok: false, message: "Only a manager can void an order." };
  }
  if (order.deletedAt) {
    return { ok: false, message: "That order is already voided." };
  }
  // The reason is the entire point of keeping the row, so it is required here
  // and by orders_delete_needs_reason in the database.
  if (reason.length < 3) {
    return { ok: false, message: "Give a reason — at least a few words." };
  }
  if (reason.length > 500) {
    return { ok: false, message: "Keep the reason under 500 characters." };
  }

  try {
    await withActor(session.userId, (tx) =>
      tx.orders.update({
        where: { id },
        data: {
          // Skipped when it is already cancelled: the trigger only fires on the
          // transition, and re-stating it would be a no-op anyway.
          ...(order.status === "cancelled"
            ? {}
            : { status: "cancelled" as never, cancel_reason: `Voided: ${reason}` }),
          deleted_at: new Date(),
          deleted_by: session.userId,
          delete_reason: reason,
          cancel_requested_at: null,
          cancel_requested_by: null,
          cancel_request_reason: null,
        },
      })
    );
  } catch (e) {
    return { ok: false, message: explain(e) };
  }

  revalidatePath("/admin/orders");
  revalidatePath("/admin/orders/voided");
  revalidatePath("/admin/invoices");
  revalidatePath("/admin");
  return { ok: true, message: "Order voided. Stock returned and the record kept." };
}

/** The one place that actually cancels, so stock handling can't diverge. */
async function finaliseCancel(
  id: string,
  session: AdminSession,
  reason: string
): Promise<OrderActionState> {
  try {
    // Setting status to cancelled fires restore_stock_on_cancel(), which puts
    // the units back into store_inventory and writes an inventory_movements
    // row per line. That is intended — do not also adjust stock here.
    await withActor(session.userId, (tx) =>
      tx.orders.update({
        where: { id },
        data: {
          status: "cancelled" as never,
          cancel_reason: reason,
          // The request is resolved; clearing it keeps "awaiting approval"
          // queues from showing orders that are already dead.
          cancel_requested_at: null,
          cancel_requested_by: null,
          cancel_request_reason: null,
        },
      })
    );
  } catch (e) {
    return { ok: false, message: explain(e) };
  }
  return done(`/admin/orders/${id}`, "Order cancelled and stock returned.");
}

/* --------------------------------------------------------------------- utils */

function explain(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const check = msg.match(/violates check constraint "([^"]+)"/);
  if (check) return `Rejected by ${check[1]}.`;
  return msg.split("\n").filter(Boolean).slice(-1)[0]?.trim() || "Unknown error.";
}
