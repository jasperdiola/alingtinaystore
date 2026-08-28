"use client";

import { useState } from "react";
import { peso } from "@/lib/format";
import type { StockRow } from "@/lib/queries/inventory";
import AdjustStock from "./adjust";
import PriceEditor from "./price";

export default function StockTable({
  rows,
  canPrice,
}: {
  rows: StockRow[];
  /** Hides the Price button for staff. app/actions/pricing.ts is the control. */
  canPrice: boolean;
}) {
  const [open, setOpen] = useState<{ id: string; panel: "stock" | "price" } | null>(null);
  const isOpen = (id: string, panel: "stock" | "price") =>
    open?.id === id && open.panel === panel;

  if (rows.length === 0) {
    return (
      <div className="grid h-40 place-items-center rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700">
        <p className="text-sm text-neutral-500">No stock lines match these filters.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <table className="rtable w-full text-sm sm:min-w-[640px]">
        <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500 dark:border-neutral-800">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-medium">Product</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Store</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">Price</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">Stock</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              <span className="sr-only">Adjust</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className="border-b border-neutral-100 align-top last:border-0 dark:border-neutral-800/60"
            >
              <td data-label="" className="px-4 py-3">
                <div className="font-medium">{r.product}</div>
                <div className="text-xs text-neutral-500">
                  {r.size} · {r.category}
                </div>
                {isOpen(r.id, "stock") && (
                  <div className="mt-3 max-w-sm">
                    <AdjustStock
                      id={r.id}
                      product={r.product}
                      size={r.size}
                      store={r.store}
                      stock={r.stock}
                      onDone={() => setOpen(null)}
                    />
                  </div>
                )}
                {isOpen(r.id, "price") && (
                  <div className="mt-3 max-w-sm">
                    <PriceEditor
                      id={r.id}
                      product={r.product}
                      size={r.size}
                      store={r.store}
                      sizePrice={r.sizePrice}
                      overridePrice={r.overridePrice}
                      onDone={() => setOpen(null)}
                    />
                  </div>
                )}
              </td>
              <td data-label="Store" className="px-4 py-3 text-neutral-600 dark:text-neutral-400">{r.store}</td>
              <td data-label="Price" className="px-4 py-3 text-right">
                <div className="tabular-nums">{peso(r.price)}</div>
                {r.overridePrice !== null && (
                  <div className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                    Branch price
                  </div>
                )}
              </td>
              <td data-label="Stock" className="px-4 py-3 text-right">
                <div className="tabular-nums font-medium">{r.stock}</div>
                {/* Word + colour, never colour alone. */}
                {r.stock === 0 ? (
                  <div className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                    Out of stock
                  </div>
                ) : r.low ? (
                  <div className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                    Low · min {r.threshold}
                  </div>
                ) : null}
              </td>
              <td data-label="" className="px-4 py-3 text-right">
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen(r.id, "stock") ? null : { id: r.id, panel: "stock" })}
                    aria-expanded={isOpen(r.id, "stock")}
                    className="rounded-lg border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                  >
                    {isOpen(r.id, "stock") ? "Cancel" : "Adjust"}
                  </button>
                  {canPrice && (
                    <button
                      type="button"
                      onClick={() => setOpen(isOpen(r.id, "price") ? null : { id: r.id, panel: "price" })}
                      aria-expanded={isOpen(r.id, "price")}
                      className="rounded-lg border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                    >
                      {isOpen(r.id, "price") ? "Cancel" : "Price"}
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
