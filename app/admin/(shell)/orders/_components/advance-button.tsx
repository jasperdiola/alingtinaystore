"use client";

import { useActionState } from "react";
import { advanceOrderAction } from "@/app/actions/orders";
import { statusLabel } from "@/lib/format";

/**
 * Moves one order to its next step, straight from the list.
 *
 * Open to every signed-in role. advanceOrderAction only checks the session and
 * can_manage_store(), with no role gate — a cashier finishing a delivery is
 * the normal case, not an exception. Cancelling is the thing that needs a
 * manager, and that still lives on the order's own page.
 *
 * `next` is computed on the server from the row as it currently is, and sent
 * back so the action can reject a click made against a stale page: two people
 * on the same order should not both be able to push it forward.
 */
export default function AdvanceButton({
  orderId,
  code,
  next,
}: {
  orderId: string;
  code: string;
  /** null when the order is completed or cancelled — nothing to advance to. */
  next: string | null;
}) {
  const [state, advance, pending] = useActionState(advanceOrderAction, null);

  if (!next) return null;

  const label = statusLabel(next);

  return (
    <form action={advance} className="mt-1.5">
      <input type="hidden" name="id" value={orderId} />
      <input type="hidden" name="to" value={next} />
      <button
        type="submit"
        disabled={pending}
        // The visible label is just the destination so the column stays narrow;
        // the accessible name says which order it belongs to, because in a
        // table of twenty rows "Out for delivery" alone identifies nothing.
        aria-label={`Mark order ${code} as ${label.toLowerCase()}`}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-neutral-300 bg-white px-2 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
      >
        <span aria-hidden className="text-neutral-400">
          →
        </span>
        {pending ? "Saving…" : label}
      </button>

      {state && !state.ok && (
        <p role="status" className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
          {state.message}
        </p>
      )}
    </form>
  );
}
