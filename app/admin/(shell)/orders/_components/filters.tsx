"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

const STATUSES = [
  "pending", "confirmed", "preparing", "ready", "out_for_delivery", "completed", "cancelled",
];
const PAYMENTS = ["unpaid", "awaiting_verification", "verified", "rejected", "refunded"];

const select =
  "h-9 rounded-lg border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900";

/**
 * Filters live in the URL, so a filtered view is shareable and the back button
 * behaves. Changing one resets to page 1 — staying on page 7 of a result set
 * that now has two pages is a classic way to show an empty screen.
 */
export default function OrderFilters({
  stores,
}: {
  stores: { id: string; name: string }[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  function apply(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    start(() => router.push(`/admin/orders?${next.toString()}`));
  }

  const active =
    params.get("status") || params.get("payment") || params.get("store") || params.get("q");

  return (
    <div
      className={`grid grid-cols-1 gap-2 transition-opacity sm:flex sm:flex-wrap sm:items-center ${pending ? "opacity-60" : ""}`}
    >
      <form
        className="contents sm:block"
        onSubmit={(e) => {
          e.preventDefault();
          apply("q", new FormData(e.currentTarget).get("q") as string);
        }}
      >
        <input
          name="q"
          defaultValue={params.get("q") ?? ""}
          placeholder="Order code, name or phone"
          aria-label="Search orders"
          className={`${select} w-full sm:w-56`}
        />
      </form>

      <select
        aria-label="Filter by status"
        value={params.get("status") ?? ""}
        onChange={(e) => apply("status", e.target.value)}
        className={select}
      >
        <option value="">All statuses</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s.replace(/_/g, " ")}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by payment"
        value={params.get("payment") ?? ""}
        onChange={(e) => apply("payment", e.target.value)}
        className={select}
      >
        <option value="">All payments</option>
        {PAYMENTS.map((p) => (
          <option key={p} value={p}>
            {p.replace(/_/g, " ")}
          </option>
        ))}
      </select>

      {stores.length > 0 && (
        <select
          aria-label="Filter by store"
          value={params.get("store") ?? ""}
          onChange={(e) => apply("store", e.target.value)}
          className={select}
        >
          <option value="">All stores</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}

      {active && (
        <button
          type="button"
          onClick={() => start(() => router.push("/admin/orders"))}
          className="h-9 rounded-lg px-2 text-sm text-neutral-500 underline-offset-4 hover:underline"
        >
          Clear
        </button>
      )}
    </div>
  );
}
