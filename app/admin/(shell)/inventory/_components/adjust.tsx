"use client";

import { useActionState, useState } from "react";
import { adjustStockAction, type StockActionState } from "@/app/actions/inventory";
import { REASONS } from "@/lib/inventory/reasons";

/**
 * Inline stock adjustment.
 *
 * Two modes on purpose. "Received / removed" is a delta — the natural way to
 * record a delivery. "Counted" is absolute — the natural way to record what is
 * actually on the shelf. Making the cashier do the subtraction is how counts
 * drift.
 */
export default function AdjustStock({
  id,
  product,
  size,
  store,
  stock,
  onDone,
}: {
  id: string;
  product: string;
  size: string;
  store: string;
  stock: number;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(adjustStockAction, null);
  const [mode, setMode] = useState<"delta" | "set">("delta");
  const [amount, setAmount] = useState("");

  const parsed = Number(amount);
  const valid = amount !== "" && Number.isInteger(parsed);
  const preview = !valid ? null : mode === "set" ? parsed : stock + parsed;
  const wouldGoNegative = preview !== null && preview < 0;

  return (
    <div className="rounded-lg border border-neutral-300 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-800/50">
      <p className="text-xs font-semibold">
        {product} <span className="font-normal text-neutral-500">· {size} · {store}</span>
      </p>
      <p className="mt-0.5 text-[11px] text-neutral-500">Currently {stock} in stock</p>

      <form action={action} className="mt-3 flex flex-col gap-2">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="mode" value={mode} />

        <div className="flex gap-1" role="group" aria-label="Adjustment type">
          {(["delta", "set"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`flex-1 rounded-md px-2 py-1 text-xs font-medium ${
                mode === m
                  ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                  : "border border-neutral-300 dark:border-neutral-600"
              }`}
            >
              {m === "delta" ? "Received / removed" : "Counted"}
            </button>
          ))}
        </div>

        <label className="text-[11px] text-neutral-500">
          {mode === "delta" ? "Change (use −5 to remove)" : "Actual count on the shelf"}
          <input
            name="amount"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            autoFocus
            className="mt-1 h-9 w-full rounded-lg border border-neutral-300 px-2 text-sm dark:border-neutral-600 dark:bg-neutral-900"
          />
        </label>

        {preview !== null && (
          <p
            className={`text-[11px] ${
              wouldGoNegative ? "text-rose-600 dark:text-rose-400" : "text-neutral-500"
            }`}
          >
            {wouldGoNegative
              ? `Would leave ${preview} — stock cannot go below zero.`
              : `New level: ${stock} → ${preview}`}
          </p>
        )}

        <label className="text-[11px] text-neutral-500">
          Reason
          <select
            name="reason"
            required
            defaultValue=""
            className="mt-1 h-9 w-full rounded-lg border border-neutral-300 px-2 text-sm dark:border-neutral-600 dark:bg-neutral-900"
          >
            <option value="" disabled>Choose…</option>
            {REASONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </label>

        <input
          name="note"
          placeholder="Note (optional)"
          className="h-9 w-full rounded-lg border border-neutral-300 px-2 text-sm dark:border-neutral-600 dark:bg-neutral-900"
        />

        {state && (
          <p
            role="status"
            className={`text-[11px] ${
              state.ok ? "text-green-700 dark:text-green-400" : "text-rose-600 dark:text-rose-400"
            }`}
          >
            {state.ok ? "✓ " : "✗ "}
            {state.message}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending || wouldGoNegative}
            className="h-9 flex-1 rounded-lg bg-neutral-900 text-xs font-medium text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
          >
            {pending ? "Saving…" : "Save adjustment"}
          </button>
          <button
            type="button"
            onClick={onDone}
            className="h-9 rounded-lg border border-neutral-300 px-3 text-xs dark:border-neutral-600"
          >
            Close
          </button>
        </div>
      </form>
    </div>
  );
}

export type { StockActionState };
