import type { Metadata } from "next";
import Link from "next/link";
import { peso } from "@/lib/format";
import { getPosContext, getSellableLines, getTodaysSales } from "@/lib/queries/pos";
import Register from "./_components/register";

export const metadata: Metadata = {
  title: "Point of Sale · Aling Tinay Admin",
  robots: { index: false, follow: false },
};

export default async function PosPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>;
}) {
  const { store } = await searchParams;
  const ctx = await getPosContext();

  // A cashier assigned to a branch never chooses; everyone else picks once.
  const storeId = ctx.fixedStoreId ?? store ?? ctx.stores[0]?.id ?? null;

  if (!storeId) {
    return (
      <div className="mx-auto max-w-md rounded-xl border border-dashed border-neutral-300 p-8 text-center dark:border-neutral-700">
        <p className="text-sm text-neutral-500">
          No active store is available to sell from.
        </p>
      </div>
    );
  }

  const [lines, today] = await Promise.all([
    getSellableLines(storeId),
    getTodaysSales(storeId),
  ]);
  const current = ctx.stores.find((s) => s.id === storeId);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Point of Sale</h2>
          <p className="text-xs text-neutral-500">
            Counter sales · completes and takes payment immediately
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-[11px] text-neutral-500">Today at this branch</p>
            <p className="text-sm font-semibold tabular-nums">
              {peso(today.total)}
              <span className="ml-1 font-normal text-neutral-500">
                · {today.orders} sale{today.orders === 1 ? "" : "s"}
              </span>
            </p>
          </div>

          {/* Only shown when the cashier isn't pinned to one branch. */}
          {ctx.fixedStoreId === null && ctx.stores.length > 1 && (
            <div className="flex rounded-lg border border-neutral-200 bg-white p-0.5 dark:border-neutral-800 dark:bg-neutral-900">
              {ctx.stores.map((s) => (
                <Link
                  key={s.id}
                  href={`/admin/pos?store=${s.id}`}
                  aria-current={s.id === storeId ? "true" : undefined}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${
                    s.id === storeId
                      ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                      : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                  }`}
                >
                  {s.name}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <Register
        // Remount on a store switch so a half-built basket can't be rung up
        // against the wrong branch's stock.
        key={storeId}
        storeId={storeId}
        storeName={current?.name ?? "This branch"}
        lines={lines}
      />
    </div>
  );
}
