/**
 * Stock adjustment reasons. Pure data — no Next, no database.
 *
 * Deliberately NOT in app/actions/inventory.ts. A "use server" module may only
 * export async functions; anything else is rewritten into a server-action
 * reference, so a client component importing this array would receive a
 * function and crash on .map(). That is not a lint rule, it is what the
 * compiler actually does.
 *
 * A fixed vocabulary rather than free text: if everyone types their own
 * wording you can never answer "how much did we lose to spoilage last month".
 */
export const REASONS = [
  { value: "restock", label: "Restock / delivery received" },
  { value: "manual_count", label: "Stock count correction" },
  { value: "damaged", label: "Damaged" },
  { value: "expired", label: "Expired" },
  { value: "transfer_out", label: "Transferred to another store" },
  { value: "transfer_in", label: "Transferred in" },
  { value: "internal_use", label: "Internal use / sample" },
] as const;

export const REASON_VALUES: ReadonlySet<string> = new Set(REASONS.map((r) => r.value));
