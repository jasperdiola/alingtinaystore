"use client";

import { useState } from "react";
import { cartStore } from "@/lib/cart/store";
import { peso } from "@/lib/format";
import type { ProductSize, StorefrontProduct } from "@/lib/queries/storefront";
import { CheckIcon, PlusIcon } from "./icons";

/**
 * Size chooser plus add-to-cart, living in the card footer.
 *
 * The deployed design has a single quick-add button and lists the sizes as
 * plain text underneath. That cannot work once an order is real: these products
 * come in three sizes at three different prices, so a one-tap add has to guess
 * which one the customer meant, and guessing wrong is a wrong order rather than
 * a wrong pixel.
 *
 * Turning the size list — which the design already allocates space for — into
 * selectable chips keeps the layout and removes the guess. Selecting a chip
 * updates the displayed price, so the number always matches what gets added.
 * Products with a single size skip the chips entirely.
 */
export default function AddToCart({ product }: { product: StorefrontProduct }) {
  const buyable = product.sizes.filter((s) => s.inStock);
  const [selected, setSelected] = useState<ProductSize | null>(buyable[0] ?? null);
  const [justAdded, setJustAdded] = useState(false);

  if (product.sizes.length === 0) return null;

  const active = selected && buyable.some((s) => s.id === selected.id) ? selected : buyable[0];

  function add() {
    if (!active) return;
    cartStore.add({
      sizeId: active.id,
      productId: product.id,
      productName: product.name,
      sizeLabel: active.label,
      price: active.price,
      image: product.image,
    });
    setJustAdded(true);
    // Reverts to the normal label shortly after; a permanently "Added" button
    // stops telling you anything on the second tap.
    window.setTimeout(() => setJustAdded(false), 1400);
  }

  return (
    <div className="mt-1.5">
      <div className="flex items-baseline gap-1.5">
        <span className="text-[9px] font-medium text-gray-400 sm:text-[10px]">
          {product.sizes.length > 1 && !selected ? "From" : ""}
        </span>
        <span className="text-sm font-bold tracking-tight text-gray-900 sm:text-base">
          {peso(active ? active.price : product.fromPrice)}
        </span>
      </div>

      {product.sizes.length > 1 && (
        <div
          className="mt-1.5 flex flex-wrap gap-1"
          role="radiogroup"
          aria-label={`Size for ${product.name}`}
        >
          {product.sizes.map((s) => {
            const on = active?.id === s.id;
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!s.inStock}
                onClick={() => setSelected(s)}
                title={s.inStock ? `${s.label} — ${peso(s.price)}` : `${s.label} — sold out`}
                className={`rounded-md px-1.5 py-1 text-[9px] transition-colors sm:text-[10px] ${
                  on
                    ? "bg-peanut text-white"
                    : s.inStock
                      ? "bg-gray-100 text-gray-600 hover:bg-peanut/15"
                      : "bg-gray-50 text-gray-300 line-through"
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={add}
        disabled={!active}
        aria-label={
          active ? `Add ${product.name} ${active.label} to cart` : `${product.name} is sold out`
        }
        className={`mt-2 flex w-full items-center justify-center gap-1 rounded-lg py-2 text-[11px] font-semibold transition-colors sm:text-xs ${
          justAdded
            ? "bg-green-600 text-white"
            : "bg-roasted text-white hover:bg-peanut disabled:bg-gray-100 disabled:text-gray-400"
        }`}
      >
        {justAdded ? (
          <>
            <CheckIcon className="h-3.5 w-3.5" />
            Added
          </>
        ) : active ? (
          <>
            <PlusIcon className="h-3.5 w-3.5" />
            Add to cart
          </>
        ) : (
          "Sold out"
        )}
      </button>
    </div>
  );
}
