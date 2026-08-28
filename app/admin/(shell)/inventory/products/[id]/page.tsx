import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/admin";
import { getCatalogRefs, getProductForEdit } from "@/lib/queries/catalog";
import { recentPriceChangesFor } from "@/lib/queries/price-history";
import { PriceLogList } from "../../_components/price-log";
import {
  EditProductForm,
  ProductImage,
  RetireProduct,
  SizeManager,
} from "../_components/product-forms";

export const metadata: Metadata = {
  title: "Edit product · Aling Tinay Admin",
  robots: { index: false, follow: false },
};

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("manager");
  const { id } = await params;
  const [product, refs, priceLog] = await Promise.all([
    getProductForEdit(id),
    getCatalogRefs(),
    recentPriceChangesFor(id),
  ]);
  if (!product) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/admin/inventory/products" className="text-xs text-neutral-500 underline-offset-4 hover:underline">
        ← Products
      </Link>

      <div className="mt-2 mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{product.name}</h2>
          <p className="text-xs text-neutral-500">
            {product.sizes.length} size{product.sizes.length === 1 ? "" : "s"} · slug{" "}
            <code>{product.slug}</code>
          </p>
        </div>
        {!product.isActive && (
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            Retired
          </span>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <h3 className="mb-4 text-sm font-semibold">Details</h3>
          <EditProductForm product={product} categories={refs.categories} />
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <h3 className="mb-1 text-sm font-semibold">Image</h3>
          <p className="mb-3 text-xs text-neutral-500">
            What customers see on the storefront. The admin pages only show it
            so you can check the right one uploaded.
          </p>
          <ProductImage id={product.id} currentUrl={product.image || null} />
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <h3 className="mb-1 text-sm font-semibold">Sizes</h3>
          <p className="mb-3 text-xs text-neutral-500">
            Prices here are the catalog price. A branch that sets its own keeps it — change that from Inventory.
          </p>
          <SizeManager product={product} stores={refs.stores} />
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">Recent price changes</h3>
            <Link
              href="/admin/inventory/price-history"
              className="text-xs text-neutral-500 underline-offset-4 hover:underline"
            >
              All products →
            </Link>
          </div>
          <PriceLogList rows={priceLog} />
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <h3 className="mb-2 text-sm font-semibold">Availability</h3>
          <RetireProduct id={product.id} isActive={product.isActive} soldCount={product.soldCount} />
        </section>
      </div>
    </div>
  );
}
