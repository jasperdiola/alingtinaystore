"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { createSaleAction, type SaleState } from "@/app/actions/pos";
import { peso, pesoExact } from "@/lib/format";
import type { SellableLine } from "@/lib/queries/pos";

type BasketEntry = { line: SellableLine; qty: number };

export default function Register({
  storeId,
  storeName,
  lines,
}: {
  storeId: string;
  storeName: string;
  lines: SellableLine[];
}) {
  const [state, submit, pending] = useActionState(createSaleAction, null as SaleState);
  const [basket, setBasket] = useState<Map<string, BasketEntry>>(new Map());
  const [query, setQuery] = useState("");
  const [tendered, setTendered] = useState("");
  const [showCustomer, setShowCustomer] = useState(false);
  /*
   * "Complete sale" asks before it commits. A POS sale takes stock and books
   * revenue the instant it is submitted, and undoing one needs a manager, so a
   * single mis-tap should not be able to do that.
   */
  const [confirming, setConfirming] = useState(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter(
      (l) =>
        l.product.toLowerCase().includes(q) ||
        l.size.toLowerCase().includes(q) ||
        l.category.toLowerCase().includes(q)
    );
  }, [lines, query]);

  const entries = [...basket.values()];
  const total = entries.reduce((a, e) => a + e.line.price * e.qty, 0);
  const tenderedNum = tendered === "" ? null : Number(tendered);
  const change =
    tenderedNum === null || !Number.isFinite(tenderedNum) ? null : tenderedNum - total;

  function add(line: SellableLine) {
    setConfirming(false);
    setBasket((prev) => {
      const next = new Map(prev);
      const cur = next.get(line.id);
      // Never let the basket exceed what the shelf holds.
      const qty = Math.min((cur?.qty ?? 0) + 1, line.stock);
      next.set(line.id, { line, qty });
      return next;
    });
  }

  function setQty(id: string, qty: number) {
    setConfirming(false);
    setBasket((prev) => {
      const next = new Map(prev);
      const cur = next.get(id);
      if (!cur) return prev;
      if (qty <= 0) next.delete(id);
      else next.set(id, { ...cur, qty: Math.min(qty, cur.line.stock) });
      return next;
    });
  }

  // A completed sale replaces the register with a receipt, so a cashier can
  // never accidentally ring the same basket twice.
  if (state?.ok) {
    return (
      <div className="mx-auto max-w-md rounded-xl border border-green-300 bg-green-50 p-6 text-center dark:border-green-800 dark:bg-green-950/30">
        <p className="text-xs font-semibold uppercase tracking-wide text-green-800 dark:text-green-300">
          Sale complete
        </p>
        <p className="mt-1 text-2xl font-bold tabular-nums">{state.code}</p>
        <dl className="mt-4 space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-neutral-600 dark:text-neutral-400">Total</dt>
            <dd className="tabular-nums font-medium">{pesoExact(state.total)}</dd>
          </div>
          <div className="flex justify-between text-lg font-bold">
            <dt>Change</dt>
            <dd className="tabular-nums">{pesoExact(state.change)}</dd>
          </div>
        </dl>
        <div className="mt-6 flex gap-2">
          <button
            type="button"
            onClick={() => {
              setBasket(new Map());
              setTendered("");
              // Reloading resets the action state and refetches stock levels.
              window.location.reload();
            }}
            className="h-10 flex-1 rounded-lg bg-neutral-900 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
          >
            New sale
          </button>
          <Link
            href={`/admin/invoices/${state.orderId}`}
            className="grid h-10 flex-1 place-items-center rounded-lg border border-neutral-300 text-sm dark:border-neutral-700"
          >
            Print receipt
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      {/* ------------------------------------------------------- products */}
      <div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search products…"
          aria-label="Search products"
          autoFocus
          className="mb-3 h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />

        {visible.length === 0 ? (
          <div className="grid h-40 place-items-center rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700">
            <p className="text-sm text-neutral-500">
              {lines.length === 0 ? "Nothing in stock at this branch." : "No match."}
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {visible.map((l) => {
              const inBasket = basket.get(l.id)?.qty ?? 0;
              const maxed = inBasket >= l.stock;
              return (
                <li key={l.id}>
                  {/* Big tap target — this is used at a counter, often fast. */}
                  <button
                    type="button"
                    onClick={() => add(l)}
                    disabled={maxed}
                    className="flex h-full w-full flex-col items-start rounded-xl border border-neutral-200 bg-white p-3 text-left transition hover:border-neutral-400 disabled:opacity-40 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-600"
                  >
                    <span className="text-sm font-medium leading-tight">{l.product}</span>
                    <span className="text-xs text-neutral-500">{l.size}</span>
                    <span className="mt-auto pt-2 text-sm font-semibold tabular-nums">
                      {peso(l.price)}
                    </span>
                    <span className="text-[11px] text-neutral-400">
                      {maxed ? "all in basket" : `${l.stock} left`}
                      {inBasket > 0 && !maxed && ` · ${inBasket} added`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* --------------------------------------------------------- basket */}
      <form
        id="pos-basket"
        action={submit}
        className="flex h-fit scroll-mt-20 flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 pb-6 max-lg:mb-20 lg:sticky lg:top-20 dark:border-neutral-800 dark:bg-neutral-900"
      >
        <input type="hidden" name="storeId" value={storeId} />
        <input
          type="hidden"
          name="basket"
          value={JSON.stringify(entries.map((e) => ({ id: e.line.id, qty: e.qty })))}
        />

        <header>
          <h3 className="text-sm font-semibold">Basket</h3>
          <p className="text-[11px] text-neutral-500">{storeName}</p>
        </header>

        {entries.length === 0 ? (
          <p className="py-6 text-center text-xs text-neutral-500">
            Tap a product to start a sale.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {entries.map((e) => (
              <li key={e.line.id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{e.line.product}</p>
                  <p className="text-[11px] text-neutral-500">
                    {e.line.size} · {peso(e.line.price)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setQty(e.line.id, e.qty - 1)}
                    aria-label={`Reduce ${e.line.product}`}
                    className="size-7 rounded border border-neutral-300 text-sm dark:border-neutral-600"
                  >
                    −
                  </button>
                  <span className="w-6 text-center text-xs tabular-nums">{e.qty}</span>
                  <button
                    type="button"
                    onClick={() => setQty(e.line.id, e.qty + 1)}
                    disabled={e.qty >= e.line.stock}
                    aria-label={`Add ${e.line.product}`}
                    className="size-7 rounded border border-neutral-300 text-sm disabled:opacity-30 dark:border-neutral-600"
                  >
                    +
                  </button>
                </div>
                <span className="w-16 text-right text-xs tabular-nums font-medium">
                  {peso(e.line.price * e.qty)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-between border-t border-neutral-200 pt-3 text-base font-bold dark:border-neutral-800">
          <span>Total</span>
          <span className="tabular-nums">{pesoExact(total)}</span>
        </div>

        <label className="text-[11px] text-neutral-500">
          Cash received
          <input
            name="tendered"
            inputMode="decimal"
            value={tendered}
            onChange={(e) => {
              setConfirming(false);
              setTendered(e.target.value);
            }}
            placeholder={total > 0 ? total.toFixed(2) : "0.00"}
            className="mt-1 h-11 w-full rounded-lg border border-neutral-300 px-3 text-lg tabular-nums dark:border-neutral-600 dark:bg-neutral-950"
          />
        </label>

        {/* The number the cashier actually needs, as large as the total. */}
        {change !== null && entries.length > 0 && (
          <div
            className={`flex justify-between rounded-lg px-3 py-2 text-base font-bold ${
              change < 0
                ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                : "bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-300"
            }`}
          >
            <span>{change < 0 ? "Short by" : "Change"}</span>
            <span className="tabular-nums">{pesoExact(Math.abs(change))}</span>
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowCustomer((v) => !v)}
          className="text-left text-[11px] text-neutral-500 underline-offset-2 hover:underline"
        >
          {showCustomer ? "Hide" : "Add"} customer details (optional)
        </button>
        {showCustomer && (
          <div className="flex flex-col gap-2">
            <input
              name="customerName"
              placeholder="Name"
              className="h-9 rounded-lg border border-neutral-300 px-2 text-sm dark:border-neutral-600 dark:bg-neutral-950"
            />
            <input
              name="customerPhone"
              placeholder="09XXXXXXXXX"
              inputMode="numeric"
              className="h-9 rounded-lg border border-neutral-300 px-2 text-sm dark:border-neutral-600 dark:bg-neutral-950"
            />
          </div>
        )}

        {state && !state.ok && (
          <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">
            ✗ {state.message}
          </p>
        )}

        {confirming && (
          <div
            role="alertdialog"
            aria-label="Confirm this sale"
            className="rounded-lg border border-neutral-300 bg-neutral-50 p-3 dark:border-neutral-600 dark:bg-neutral-800/60"
          >
            <p className="text-xs font-semibold">Ring up this sale?</p>
            <ul className="mt-2 space-y-0.5 text-[11px] text-neutral-600 dark:text-neutral-400">
              {entries.map((e) => (
                <li key={e.line.id} className="flex justify-between gap-2">
                  <span className="truncate">
                    {e.qty}× {e.line.product} ({e.line.size})
                  </span>
                  <span className="tabular-nums">{pesoExact(e.line.price * e.qty)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-2 border-t border-neutral-300 pt-2 text-xs dark:border-neutral-600">
              <div className="flex justify-between font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">{pesoExact(total)}</dd>
              </div>
              {change !== null && (
                <div className="flex justify-between">
                  <dt className="text-neutral-500">Change from {pesoExact(tenderedNum ?? 0)}</dt>
                  <dd className="tabular-nums">{pesoExact(change)}</dd>
                </div>
              )}
            </dl>
            <p className="mt-2 text-[11px] text-neutral-500">
              This takes the stock and records the sale. Only a manager can undo it.
            </p>
          </div>
        )}

        <div className="flex gap-2">
          {confirming ? (
            <>
              <button
                type="submit"
                disabled={pending}
                className="h-11 flex-1 rounded-lg bg-green-700 text-sm font-semibold text-white disabled:opacity-40 hover:bg-green-800"
              >
                {pending ? "Recording…" : "Yes, complete sale"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={pending}
                className="h-11 rounded-lg border border-neutral-300 px-3 text-sm dark:border-neutral-700"
              >
                Back
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={entries.length === 0 || (change !== null && change < 0)}
              className="h-11 flex-1 rounded-lg bg-neutral-900 text-sm font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
            >
              Complete sale
            </button>
          )}
          {entries.length > 0 && (
            <button
              type="button"
              onClick={() => { setConfirming(false); setBasket(new Map()); setTendered(""); }}
              className="h-11 rounded-lg border border-neutral-300 px-3 text-sm dark:border-neutral-700"
            >
              Clear
            </button>
          )}
        </div>
      </form>

      {/* Mobile only. On a phone the basket sits below a long product grid, so
          without this the total is off-screen exactly while you are adding to
          it. Appears only once there is something to total. */}
      {entries.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur lg:hidden dark:border-neutral-800 dark:bg-neutral-900/95">
          <a
            href="#pos-basket"
            className="flex items-center justify-between gap-3 rounded-lg bg-neutral-900 px-4 py-3 text-white dark:bg-white dark:text-neutral-900"
          >
            <span className="text-sm font-medium">
              {entries.reduce((a, e) => a + e.qty, 0)} item
              {entries.reduce((a, e) => a + e.qty, 0) === 1 ? "" : "s"}
            </span>
            <span className="text-base font-bold tabular-nums">{pesoExact(total)}</span>
          </a>
        </div>
      )}
    </div>
  );
}
