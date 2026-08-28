import { statusLabel } from "@/lib/format";

/**
 * Status colours come from the reserved STATUS palette, never the categorical
 * series slots — a status colour must never impersonate a chart series. Each
 * badge pairs the colour with its label, so meaning never rides on hue alone.
 */
const STATUS_TONE: Record<string, string> = {
  pending: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  confirmed: "bg-blue-50 text-blue-800 dark:bg-blue-950/50 dark:text-blue-200",
  preparing: "bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
  ready: "bg-violet-50 text-violet-800 dark:bg-violet-950/50 dark:text-violet-200",
  out_for_delivery: "bg-cyan-50 text-cyan-900 dark:bg-cyan-950/50 dark:text-cyan-200",
  completed: "bg-green-50 text-green-800 dark:bg-green-950/50 dark:text-green-200",
  cancelled: "bg-rose-50 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200",
};

const PAYMENT_LABEL: Record<string, string> = {
  unpaid: "Unpaid",
  awaiting_verification: "Awaiting check",
  verified: "Verified",
  rejected: "Rejected",
  refunded: "Refunded",
};

const PAYMENT_TONE: Record<string, string> = {
  unpaid: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  awaiting_verification: "bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
  verified: "bg-green-50 text-green-800 dark:bg-green-950/50 dark:text-green-200",
  rejected: "bg-rose-50 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200",
  refunded: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
};

const base =
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";

export function StatusBadge({ status }: { status: string }) {
  return <span className={`${base} ${STATUS_TONE[status] ?? STATUS_TONE.pending}`}>{statusLabel(status)}</span>;
}

export function PaymentBadge({ payment }: { payment: string }) {
  return (
    <span className={`${base} ${PAYMENT_TONE[payment] ?? PAYMENT_TONE.unpaid}`}>
      {PAYMENT_LABEL[payment] ?? payment}
    </span>
  );
}

export function FulfillmentBadge({ type }: { type: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-neutral-500">
      <span aria-hidden>{type === "delivery" ? "🛵" : "🏪"}</span>
      {type === "delivery" ? "Delivery" : "Pickup"}
    </span>
  );
}

export { PAYMENT_LABEL };
