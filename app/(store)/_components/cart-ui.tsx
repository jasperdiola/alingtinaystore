"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  cartCount,
  cartStore,
  cartSubtotal,
  MAX_QTY,
  type CartLine,
} from "@/lib/cart/store";
import { peso } from "@/lib/format";
import { ArrowRightIcon, CartIcon, XIcon } from "./icons";
import ProductImage from "./product-image";

/** Shared subscription. Every cart-aware component reads the same snapshot. */
function useCart() {
  return useSyncExternalStore(
    cartStore.subscribe,
    cartStore.getSnapshot,
    cartStore.getServerSnapshot
  );
}

/**
 * The cart is opened by a button in the header and rendered as a drawer at the
 * layout level. Rather than lift state into a provider, both read this tiny
 * store — the drawer's open flag is the only thing they share, and a context
 * for one boolean is more machinery than it earns.
 */
const openListeners = new Set<() => void>();
let isOpen = false;
const openStore = {
  subscribe(fn: () => void) {
    openListeners.add(fn);
    return () => {
      openListeners.delete(fn);
    };
  },
  get: () => isOpen,
  set(next: boolean) {
    isOpen = next;
    for (const fn of openListeners) fn();
  },
};
const useCartOpen = () =>
  useSyncExternalStore(
    openStore.subscribe,
    openStore.get,
    () => false
  );

/* ------------------------------------------------------------ header button */

export function CartButton() {
  const cart = useCart();
  const count = cartCount(cart);

  return (
    <button
      type="button"
      onClick={() => openStore.set(true)}
      aria-label={count ? `Open cart, ${count} item${count === 1 ? "" : "s"}` : "Open cart"}
      className="relative flex min-h-[44px] min-w-[44px] items-center justify-center p-2 text-gray-500 transition-colors hover:text-peanut sm:p-2.5"
    >
      <CartIcon className="h-5 w-5" />
      {count > 0 && (
        <span className="absolute right-1 top-1 grid min-w-[18px] place-items-center rounded-full bg-peanut px-1 text-[10px] font-bold leading-[18px] text-white">
          {count}
        </span>
      )}
    </button>
  );
}

/* -------------------------------------------------------------------- drawer */

export function CartDrawer() {
  const cart = useCart();
  const open = useCartOpen();
  const pathname = usePathname();

  // Close on navigation, derived rather than synced — see SiteHeader for why an
  // effect that calls setState here would render the drawer over the new page.
  const [seenAt, setSeenAt] = useState(pathname);
  if (seenAt !== pathname) {
    setSeenAt(pathname);
    if (isOpen) openStore.set(false);
  }

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") openStore.set(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const subtotal = cartSubtotal(cart);
  const count = cartCount(cart);

  return (
    <>
      <div
        onClick={() => openStore.set(false)}
        aria-hidden
        className={`fixed inset-0 z-[60] bg-roasted/40 backdrop-blur-[2px] transition-opacity duration-300 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <aside
        aria-label="Shopping cart"
        inert={!open}
        className={`fixed inset-y-0 right-0 z-[61] flex w-full max-w-sm flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-center justify-between border-b border-gray-100 px-4 py-4">
          <h2 className="font-semibold text-gray-900">
            Your cart
            {count > 0 && <span className="ml-1.5 text-sm text-gray-400">({count})</span>}
          </h2>
          <button
            type="button"
            onClick={() => openStore.set(false)}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center text-gray-400 transition-colors hover:text-peanut"
          >
            <XIcon className="h-5 w-5" title="Close cart" />
          </button>
        </header>

        {cart.lines.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
            <CartIcon className="h-8 w-8 text-gray-300" />
            <p className="text-sm text-gray-500">Your cart is empty.</p>
            <Link
              href="/shop"
              onClick={() => openStore.set(false)}
              className="rounded-full bg-peanut px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-roasted"
            >
              Browse products
            </Link>
          </div>
        ) : (
          <>
            <ul className="flex-1 divide-y divide-gray-100 overflow-y-auto px-4">
              {cart.lines.map((l) => (
                <CartRow key={l.sizeId} line={l} />
              ))}
            </ul>

            <footer className="border-t border-gray-100 px-4 py-4">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-gray-500">Subtotal</span>
                <span className="text-lg font-bold tabular-nums text-gray-900">
                  {peso(subtotal)}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-gray-400">
                Delivery fee, if any, is added at checkout.
              </p>
              <Link
                href="/checkout"
                onClick={() => openStore.set(false)}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-peanut px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-roasted"
              >
                Checkout
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
              <button
                type="button"
                onClick={() => cartStore.clear()}
                className="mt-2 w-full py-2 text-xs text-gray-400 transition-colors hover:text-rose-600"
              >
                Empty cart
              </button>
            </footer>
          </>
        )}
      </aside>
    </>
  );
}

function CartRow({ line }: { line: CartLine }) {
  return (
    <li className="flex gap-3 py-3">
      <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-cream">
        <ProductImage
          src={line.image}
          alt={line.productName}
          className="h-full w-full object-cover"
        />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-900">{line.productName}</p>
        <p className="text-xs text-gray-500">{line.sizeLabel}</p>
        <p className="mt-0.5 text-sm font-semibold tabular-nums text-gray-900">
          {peso(line.price)}
        </p>

        <div className="mt-1.5 flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-gray-200">
            <button
              type="button"
              onClick={() => cartStore.setQty(line.sizeId, line.qty - 1)}
              aria-label={`Decrease ${line.productName} ${line.sizeLabel}`}
              className="grid size-8 place-items-center text-gray-500 hover:text-peanut"
            >
              −
            </button>
            <span className="w-7 text-center text-sm tabular-nums" aria-live="polite">
              {line.qty}
            </span>
            <button
              type="button"
              onClick={() => cartStore.setQty(line.sizeId, line.qty + 1)}
              disabled={line.qty >= MAX_QTY}
              aria-label={`Increase ${line.productName} ${line.sizeLabel}`}
              className="grid size-8 place-items-center text-gray-500 hover:text-peanut disabled:opacity-30"
            >
              +
            </button>
          </div>
          <button
            type="button"
            onClick={() => cartStore.remove(line.sizeId)}
            className="text-xs text-gray-400 transition-colors hover:text-rose-600"
          >
            Remove
          </button>
        </div>
      </div>

      <span className="shrink-0 text-sm font-semibold tabular-nums text-gray-900">
        {peso(Math.round(line.price * line.qty * 100) / 100)}
      </span>
    </li>
  );
}
