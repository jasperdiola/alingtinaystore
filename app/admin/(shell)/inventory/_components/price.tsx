"use client";

import { useActionState, useState } from "react";
import { setPriceOverrideAction } from "@/app/actions/pricing";
import { pesoExact } from "@/lib/format";

/**
 * Per-branch price. Makes the inheritance visible rather than showing one
 * number and hoping the manager remembers where it came from: the catalog
 * price is always shown, and "Use catalog price" is how you clear an override.
 */
export default function PriceEditor({
  id,
  product,
  size,
  store,
  sizePrice,
  overridePrice,
  onDone,
}: {
  id: string;
  product: string;
  size: string;
  store: string;
  sizePrice: number;
  overridePrice: number | null;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(setPriceOverrideAction, null);
  const [value, setValue] = useState(
    overridePrice === null ? sizePrice.toFixed(2) : overridePrice.toFixed(2)
  );

  const effective = overridePrice ?? sizePrice;

  return (
    <div className="rounded-lg border border-neutral-300 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-800/50">
      <p className="text-xs font-semibold">
        {product}{" "}
        <span className="font-normal text-neutral-500">
          · {size} · {store}
        </span>
      </p>

      <dl className="mt-2 space-y-0.5 text-[11px]">
        <div className="flex justify-between gap-4">
          <dt className="text-neutral-500">Catalog price (all branches)</dt>
          <dd className="tabular-nums">{pesoExact(sizePrice)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-neutral-500">This branch sells at</dt>
          <dd className="tabular-nums font-medium">
            {pesoExact(effective)}
            {overridePrice !== null && (
              <span className="ml-1 font-normal text-amber-700 dark:text-amber-400">
                override
              </span>
            )}
          </dd>
        </div>
      </dl>

      <form action={action} className="mt-3 flex flex-col gap-2">
        <input type="hidden" name="id" value={id} />
        <label className="text-[11px] text-neutral-500">
          Price for {store}
          <input
            name="price"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
            autoFocus
            className="mt-1 h-9 w-full rounded-lg border border-neutral-300 px-2 text-sm tabular-nums dark:border-neutral-600 dark:bg-neutral-900"
          />
        </label>

        {state && (
          <p
            role="status"
            className={`text-[11px] ${
              state.ok
                ? "text-green-700 dark:text-green-400"
                : "text-rose-600 dark:text-rose-400"
            }`}
          >
            {state.ok ? "✓ " : "✗ "}
            {state.message}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending}
            className="h-9 flex-1 rounded-lg bg-neutral-900 text-xs font-medium text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
          >
            {pending ? "Saving…" : "Set branch price"}
          </button>
          <button
            type="button"
            onClick={onDone}
            className="h-9 rounded-lg border border-neutral-300 px-3 text-xs dark:border-neutral-600"
          >
            Close
          </button>
        </div>

        {overridePrice !== null && (
          <button
            type="submit"
            name="clear"
            value="1"
            disabled={pending}
            className="h-8 rounded-lg border border-neutral-300 text-[11px] text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-700"
          >
            Use catalog price ({pesoExact(sizePrice)}) instead
          </button>
        )}
      </form>
    </div>
  );
}
