import type { Metadata } from "next";
import Link from "next/link";
import ProductThumb from "./_components/product-thumb";
import { requireRole } from "@/lib/auth/admin";
import { count, peso } from "@/lib/format";
import { listProducts, PAGE_SIZE } from "@/lib/queries/catalog";

export const metadata: Metadata = {
  title: "Products · Aling Tinay Admin",
  robots: { index: false, follow: false },
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  // Catalog changes are manager-and-above, matching products_admin_write.
  await requireRole("manager");

  const sp = await searchParams;
  const page = Number(sp.page ?? 1) || 1;
  const { rows, total, pages } = await listProducts(sp.q, page);

  const qs = (p: number) => {
    const next = new URLSearchParams();
    if (sp.q) next.set("q", sp.q);
    next.set("page", String(p));
    return `/admin/inventory/products?${next.toString()}`;
  };

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/admin/inventory" className="text-xs text-neutral-500 underline-offset-4 hover:underline">
        ← Inventory
      </Link>

      <div className="mt-2 mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Products</h2>
          <p className="text-xs text-neutral-500">
            {count(total)} product{total === 1 ? "" : "s"}
            {total > PAGE_SIZE && ` · page ${page} of ${pages}`}
          </p>
        </div>
        <Link
          href="/admin/inventory/products/new"
          className="h-9 rounded-lg bg-neutral-900 px-4 py-2 text-center text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
        >
          Add product
        </Link>
      </div>

      <form className="mb-4">
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Search products"
          aria-label="Search products"
          className="h-9 w-full rounded-lg border border-neutral-300 px-2 text-sm sm:w-64 dark:border-neutral-700 dark:bg-neutral-900"
        />
      </form>

      {rows.length === 0 ? (
        <div className="grid h-40 place-items-center rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700">
          <p className="text-sm text-neutral-500">No products match.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <table className="rtable w-full text-sm sm:min-w-[640px]">
            <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500 dark:border-neutral-800">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">Product</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Category</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Price</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Sizes</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Stock</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr
                  key={p.id}
                  className={`border-b border-neutral-100 last:border-0 dark:border-neutral-800/60 ${
                    p.isActive ? "" : "opacity-55"
                  }`}
                >
                  <td data-label="" className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <ProductThumb src={p.image} name={p.name} />
                      <div className="min-w-0">
                        <Link
                          href={`/admin/inventory/products/${p.id}`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {p.name}
                        </Link>
                        <div className="mt-0.5 flex flex-wrap gap-1.5 text-[11px]">
                          {!p.isActive && (
                            <span className="font-medium text-neutral-500">Retired</span>
                          )}
                          {p.isFeatured && <span className="text-amber-700 dark:text-amber-400">Featured</span>}
                          {p.isBestSeller && <span className="text-amber-700 dark:text-amber-400">Best seller</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td data-label="Category" className="px-4 py-3 text-neutral-600 dark:text-neutral-400">
                    {p.category}
                  </td>
                  <td data-label="Price" className="px-4 py-3 text-right tabular-nums">
                    {peso(p.basePrice)}
                  </td>
                  <td data-label="Sizes" className="px-4 py-3 text-right">
                    <span className="tabular-nums">{p.sizeCount}</span>
                    <span className="ml-1 text-[11px] text-neutral-500">
                      in {p.storeCount} branch{p.storeCount === 1 ? "" : "es"}
                    </span>
                  </td>
                  <td data-label="Stock" className="px-4 py-3 text-right tabular-nums">
                    {count(p.totalStock)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination">
          <Link
            href={qs(Math.max(1, page - 1))}
            className={`rounded-lg border border-neutral-300 px-3 py-1.5 dark:border-neutral-700 ${
              page === 1 ? "pointer-events-none opacity-40" : ""
            }`}
          >
            Previous
          </Link>
          <span className="text-xs text-neutral-500">Page {page} of {pages}</span>
          <Link
            href={qs(Math.min(pages, page + 1))}
            className={`rounded-lg border border-neutral-300 px-3 py-1.5 dark:border-neutral-700 ${
              page === pages ? "pointer-events-none opacity-40" : ""
            }`}
          >
            Next
          </Link>
        </nav>
      )}
    </div>
  );
}
