import type { Metadata } from "next";
import Link from "next/link";
import { adminAtLeast } from "@/lib/auth/admin";
import { count } from "@/lib/format";
import {
  getInventoryFilters,
  getStockSummary,
  listStock,
  PAGE_SIZE,
} from "@/lib/queries/inventory";
import StockTable from "./_components/stock-table";

export const metadata: Metadata = {
  title: "Inventory · Aling Tinay Admin",
  robots: { index: false, follow: false },
};

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const page = Number(sp.page ?? 1) || 1;
  const low = sp.low === "1";

  const [stock, filters, summary, canPrice] = await Promise.all([
    listStock({
      storeId: sp.store,
      categoryId: sp.category,
      q: sp.q,
      low,
      page,
    }),
    getInventoryFilters(),
    getStockSummary(),
    adminAtLeast("manager"),
  ]);

  const qs = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(
      Object.entries(sp).filter(([, v]) => v) as [string, string][]
    );
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    next.delete("page");
    return `/admin/inventory?${next.toString()}`;
  };

  const select =
    "h-9 rounded-lg border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900";

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Inventory</h2>
          <p className="text-xs text-neutral-500">
            Stock per store · every adjustment is recorded
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
        {canPrice && (
          <Link
            href="/admin/inventory/products"
            className="h-9 rounded-lg border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            Products &amp; pricing
          </Link>
        )}
        <Link
          href="/admin/inventory/movements"
          className="h-9 rounded-lg border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          Movement history
        </Link>
        <Link
          href="/admin/inventory/price-history"
          className="h-9 rounded-lg border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          Price history
        </Link>
        </div>
      </div>

      {/* Whole-set counts from SQL, so they don't lie when you're on page 3. */}
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {summary.map((s) => (
          <div
            key={s.store}
            className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <p className="text-xs font-medium text-neutral-500">{s.store}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{count(s.units)}</p>
            <p className="text-[11px] text-neutral-500">
              units across {s.lines} lines
            </p>
            <p className="mt-1 text-[11px]">
              <span className={s.low > 0 ? "font-medium text-amber-700 dark:text-amber-400" : "text-neutral-500"}>
                {s.low} low
              </span>
              {" · "}
              <span className={s.out > 0 ? "font-medium text-rose-600 dark:text-rose-400" : "text-neutral-500"}>
                {s.out} out
              </span>
            </p>
          </div>
        ))}
      </div>

      <form className="mb-4 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Product name"
          aria-label="Search products"
          className={`${select} w-full sm:w-52`}
        />
        {filters.stores.length > 0 && (
          <select name="store" defaultValue={sp.store ?? ""} aria-label="Filter by store" className={select}>
            <option value="">All stores</option>
            {filters.stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
        <select name="category" defaultValue={sp.category ?? ""} aria-label="Filter by category" className={select}>
          <option value="">All categories</option>
          {filters.categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {low && <input type="hidden" name="low" value="1" />}
        <button className={select}>Search</button>
        <Link
          href={qs({ low: low ? null : "1" })}
          className={`${select} flex items-center ${low ? "bg-amber-100 font-medium dark:bg-amber-950/50" : ""}`}
        >
          {low ? "✓ Low stock only" : "Low stock only"}
        </Link>
      </form>

      {low && (
        <p className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          The low-stock threshold varies per line (falling back to the store
          default), so this filter applies to the current page only — the counts
          above are the authoritative whole-store figures.
        </p>
      )}

      <StockTable rows={stock.rows} canPrice={canPrice} />

      <div className="mt-3 flex items-center justify-between text-xs text-neutral-500">
        <span>
          {count(stock.total)} line{stock.total === 1 ? "" : "s"}
          {stock.total > PAGE_SIZE && ` · page ${stock.page} of ${stock.pages}`}
        </span>
        {stock.pages > 1 && (
          <nav className="flex gap-2" aria-label="Pagination">
            <Link
              href={`/admin/inventory?${new URLSearchParams({ ...(sp as Record<string, string>), page: String(Math.max(1, page - 1)) }).toString()}`}
              className={`rounded-lg border border-neutral-300 px-3 py-1.5 dark:border-neutral-700 ${page === 1 ? "pointer-events-none opacity-40" : ""}`}
            >
              Previous
            </Link>
            <Link
              href={`/admin/inventory?${new URLSearchParams({ ...(sp as Record<string, string>), page: String(Math.min(stock.pages, page + 1)) }).toString()}`}
              className={`rounded-lg border border-neutral-300 px-3 py-1.5 dark:border-neutral-700 ${page === stock.pages ? "pointer-events-none opacity-40" : ""}`}
            >
              Next
            </Link>
          </nav>
        )}
      </div>
    </div>
  );
}
