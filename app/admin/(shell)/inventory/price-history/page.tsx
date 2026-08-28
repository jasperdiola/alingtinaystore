import type { Metadata } from "next";
import Link from "next/link";
import { count } from "@/lib/format";
import { listPriceChanges } from "@/lib/queries/price-history";
import { PriceLogTable } from "../_components/price-log";

export const metadata: Metadata = {
  title: "Price history · Aling Tinay Admin",
  robots: { index: false, follow: false },
};

export default async function PriceHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Number(pageParam ?? 1) || 1;
  const { rows, total, pages } = await listPriceChanges(page);

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href="/admin/inventory"
        className="text-xs text-neutral-500 underline-offset-4 hover:underline"
      >
        ← Inventory
      </Link>

      <div className="mt-2 mb-4">
        <h2 className="text-lg font-semibold">Price history</h2>
        <p className="text-xs text-neutral-500">
          {count(total)} recorded change{total === 1 ? "" : "s"} · recorded by the
          database itself, so nothing that moves a price can skip it
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="grid h-40 place-items-center rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700">
          <p className="max-w-sm text-center text-sm text-neutral-500">
            No price changes recorded yet. The next catalog or branch price you
            set will appear here with who set it.
          </p>
        </div>
      ) : (
        <PriceLogTable rows={rows} />
      )}

      {pages > 1 && (
        <nav
          className="mt-4 flex items-center justify-between text-sm"
          aria-label="Pagination"
        >
          <Link
            href={`/admin/inventory/price-history?page=${Math.max(1, page - 1)}`}
            className={`rounded-lg border border-neutral-300 px-3 py-1.5 dark:border-neutral-700 ${page === 1 ? "pointer-events-none opacity-40" : ""}`}
          >
            Previous
          </Link>
          <span className="text-xs text-neutral-500">
            Page {page} of {pages}
          </span>
          <Link
            href={`/admin/inventory/price-history?page=${Math.min(pages, page + 1)}`}
            className={`rounded-lg border border-neutral-300 px-3 py-1.5 dark:border-neutral-700 ${page === pages ? "pointer-events-none opacity-40" : ""}`}
          >
            Next
          </Link>
        </nav>
      )}
    </div>
  );
}
