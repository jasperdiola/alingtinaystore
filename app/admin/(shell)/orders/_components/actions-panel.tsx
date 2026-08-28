"use client";

import { useActionState, useState } from "react";
import {
  advanceOrderAction,
  approveCancelAction,
  cancelOrderAction,
  declineCancelAction,
  deleteOrderAction,
  setPaymentAction,
  type OrderActionState,
} from "@/app/actions/orders";
import { statusLabel } from "@/lib/format";

function Result({ state }: { state: OrderActionState }) {
  if (!state) return null;
  return (
    <p
      role="status"
      className={`mt-2 text-xs ${
        state.ok
          ? "text-green-700 dark:text-green-400"
          : "text-rose-600 dark:text-rose-400"
      }`}
    >
      {state.ok ? "✓ " : "✗ "}
      {state.message}
    </p>
  );
}

const btn =
  "h-9 w-full rounded-lg text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50";

export type CancelRequest = { at: string; reason: string | null; by: string | null };

export default function ActionsPanel({
  orderId,
  status,
  payment,
  next,
  cancellable,
  canApprove,
  canDelete,
  cancelRequest,
}: {
  orderId: string;
  status: string;
  payment: string;
  /** Computed server-side from the live row, not from what the browser saw. */
  next: string | null;
  cancellable: boolean;
  /** manager / super_admin — may cancel outright and rule on requests. */
  canApprove: boolean;
  /** manager / super_admin — may void an order that should never have existed. */
  canDelete: boolean;
  cancelRequest: CancelRequest | null;
}) {
  const [advState, advance, advancing] = useActionState(advanceOrderAction, null);
  const [payState, setPayment, paying] = useActionState(setPaymentAction, null);
  const [canState, cancel, cancelling] = useActionState(cancelOrderAction, null);
  const [okState, approve, approving] = useActionState(approveCancelAction, null);
  const [noState, decline, declining] = useActionState(declineCancelAction, null);
  const [delState, remove, removing] = useActionState(deleteOrderAction, null);
  const [showCancel, setShowCancel] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      {/* --------------------------------------------- pending cancellation */}
      {cancelRequest && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
          <p className="text-xs font-semibold">Cancellation requested</p>
          <p className="mt-1 text-xs text-neutral-700 dark:text-neutral-300">
            {cancelRequest.reason || "No reason given"}
          </p>
          <p className="mt-1 text-[11px] text-neutral-500">
            by {cancelRequest.by ?? "unknown"} ·{" "}
            {new Date(cancelRequest.at).toLocaleString("en-PH", {
              timeZone: "Asia/Manila",
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </p>

          {canApprove ? (
            <div className="mt-3 flex gap-2">
              <form action={approve} className="flex-1">
                <input type="hidden" name="id" value={orderId} />
                <button
                  type="submit"
                  disabled={approving}
                  className={`${btn} bg-rose-600 text-white hover:bg-rose-700`}
                >
                  {approving ? "Cancelling…" : "Approve"}
                </button>
              </form>
              <form action={decline} className="flex-1">
                <input type="hidden" name="id" value={orderId} />
                <button
                  type="submit"
                  disabled={declining}
                  className={`${btn} border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300`}
                >
                  {declining ? "…" : "Decline"}
                </button>
              </form>
            </div>
          ) : (
            // Staff raised it; only a manager can rule on it.
            <p className="mt-2 text-[11px] font-medium text-amber-800 dark:text-amber-300">
              Waiting for a manager to approve. The order continues until then.
            </p>
          )}
          <Result state={okState} />
          <Result state={noState} />
        </section>
      )}

      {/* ---------------------------------------------------------- fulfilment */}
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Fulfilment
        </h3>
        {next ? (
          <form action={advance}>
            <input type="hidden" name="id" value={orderId} />
            <input type="hidden" name="to" value={next} />
            <button
              type="submit"
              disabled={advancing}
              className={`${btn} bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200`}
            >
              {advancing ? "Saving…" : `Mark as ${statusLabel(next).toLowerCase()}`}
            </button>
            <p className="mt-1.5 text-[11px] text-neutral-500">
              One step at a time — currently {statusLabel(status).toLowerCase()}.
            </p>
          </form>
        ) : (
          <p className="text-xs text-neutral-500">
            {status === "cancelled"
              ? "This order was cancelled."
              : "This order is complete. Nothing further to do."}
          </p>
        )}
        <Result state={advState} />
      </section>

      {/* ------------------------------------------------------------- payment */}
      <section className="border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Payment
        </h3>

        {payment !== "verified" && payment !== "refunded" && (
          <form action={setPayment} className="mb-2">
            <input type="hidden" name="id" value={orderId} />
            <input type="hidden" name="to" value="verified" />
            <button
              type="submit"
              disabled={paying}
              className={`${btn} border border-green-600/40 bg-green-50 text-green-800 hover:bg-green-100 dark:bg-green-950/40 dark:text-green-200`}
            >
              {paying ? "Saving…" : "Mark payment verified"}
            </button>
            <p className="mt-1.5 text-[11px] text-neutral-500">
              Only verified payments count toward dashboard revenue.
            </p>
          </form>
        )}

        {payment !== "rejected" && payment !== "verified" && (
          <>
            {!showReject ? (
              <button
                type="button"
                onClick={() => setShowReject(true)}
                className={`${btn} border border-neutral-300 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800`}
              >
                Reject payment
              </button>
            ) : (
              <form action={setPayment} className="flex flex-col gap-2">
                <input type="hidden" name="id" value={orderId} />
                <input type="hidden" name="to" value="rejected" />
                <textarea
                  name="reason"
                  required
                  rows={2}
                  placeholder="Why is this being rejected?"
                  className="rounded-lg border border-neutral-300 p-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                />
                <div className="flex gap-2">
                  <button type="submit" disabled={paying} className={`${btn} border border-rose-500/40 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-200`}>
                    Confirm reject
                  </button>
                  <button type="button" onClick={() => setShowReject(false)} className={`${btn} border border-neutral-300 dark:border-neutral-700`}>
                    Back
                  </button>
                </div>
              </form>
            )}
          </>
        )}

        {payment === "verified" && (
          <form action={setPayment}>
            <input type="hidden" name="id" value={orderId} />
            <input type="hidden" name="to" value="refunded" />
            <button
              type="submit"
              disabled={paying}
              className={`${btn} border border-neutral-300 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800`}
            >
              {paying ? "Saving…" : "Mark refunded"}
            </button>
            <p className="mt-1.5 text-[11px] text-neutral-500">
              Removes this order from collected revenue.
            </p>
          </form>
        )}
        <Result state={payState} />
      </section>

      {/* -------------------------------------------------------------- cancel */}
      {cancellable && !cancelRequest && (
        <section className="border-t border-neutral-200 pt-4 dark:border-neutral-800">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Cancel
          </h3>
          {!showCancel ? (
            <button
              type="button"
              onClick={() => setShowCancel(true)}
              className={`${btn} border border-rose-300 text-rose-600 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-400 dark:hover:bg-rose-950/30`}
            >
              {canApprove ? "Cancel this order" : "Request cancellation"}
            </button>
          ) : (
            <form action={cancel} className="flex flex-col gap-2">
              <input type="hidden" name="id" value={orderId} />
              <textarea
                name="reason"
                required
                rows={2}
                placeholder="Reason for cancelling"
                className="rounded-lg border border-neutral-300 p-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              />
              <p className="text-[11px] text-neutral-500">
                {canApprove
                  ? "Cancels immediately. Stock for every line is returned to this store automatically."
                  : "A manager has to approve this. The order keeps being prepared until they do."}
              </p>
              <div className="flex gap-2">
                <button type="submit" disabled={cancelling} className={`${btn} bg-rose-600 text-white hover:bg-rose-700`}>
                  {cancelling ? "Saving…" : canApprove ? "Confirm cancel" : "Send request"}
                </button>
                <button type="button" onClick={() => setShowCancel(false)} className={`${btn} border border-neutral-300 dark:border-neutral-700`}>
                  Back
                </button>
              </div>
            </form>
          )}
          <Result state={canState} />
        </section>
      )}

      {/* ---------------------------------------------------------- void */}
      {canDelete && (
        <section className="border-t border-neutral-200 pt-4 dark:border-neutral-800">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Void
          </h3>
          {!showDelete ? (
            <>
              <button
                type="button"
                onClick={() => setShowDelete(true)}
                className={`${btn} border border-neutral-400 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800`}
              >
                Void this order
              </button>
              <p className="mt-1.5 text-[11px] text-neutral-500">
                For an order that should never have been placed — a mis-rung
                sale or a duplicate. Different from cancelling a real one.
              </p>
            </>
          ) : (
            <form action={remove} className="flex flex-col gap-2">
              <input type="hidden" name="id" value={orderId} />
              <textarea
                name="reason"
                required
                minLength={3}
                maxLength={500}
                rows={2}
                placeholder="What happened? (kept on the record)"
                className="rounded-lg border border-neutral-300 p-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              />
              <p className="text-[11px] text-neutral-500">
                Hidden from orders, invoices and every sales figure. The record
                is kept with your name and reason on the voided-orders page, and
                any stock this order took is returned.
              </p>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={removing}
                  className={`${btn} bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900`}
                >
                  {removing ? "Voiding…" : "Confirm void"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowDelete(false)}
                  className={`${btn} border border-neutral-300 dark:border-neutral-700`}
                >
                  Back
                </button>
              </div>
            </form>
          )}
          <Result state={delState} />
        </section>
      )}
    </div>
  );
}
