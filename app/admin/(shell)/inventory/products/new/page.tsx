import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/admin";
import { getCatalogRefs } from "@/lib/queries/catalog";
import { CreateProductForm } from "../_components/product-forms";

export const metadata: Metadata = {
  title: "New product · Aling Tinay Admin",
  robots: { index: false, follow: false },
};

export default async function NewProductPage() {
  await requireRole("manager");
  const { categories, stores } = await getCatalogRefs();

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/admin/inventory/products" className="text-xs text-neutral-500 underline-offset-4 hover:underline">
        ← Products
      </Link>
      <div className="mt-2 mb-4">
        <h2 className="text-lg font-semibold">New product</h2>
        <p className="text-xs text-neutral-500">
          A product needs one size and one branch before it can be sold. You can add more after.
        </p>
      </div>
      <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <CreateProductForm categories={categories} stores={stores} />
      </div>
    </div>
  );
}
