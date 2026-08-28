import type { Metadata } from "next";
import { connection } from "next/server";
import { getShopProducts } from "@/lib/queries/storefront";
import { filtersFromParams } from "@/lib/shop/filter";
import ShopBrowser from "./_components/shop-browser";

export const metadata: Metadata = {
  title: "Shop",
  description:
    "Browse every peanut, cornick, kasoy and Filipino snack we roast — available across our three branches in Rizal.",
};

/**
 * The shop.
 *
 * One query, one payload. The whole catalogue goes to ShopBrowser, which
 * filters it in the browser — so this page runs a single statement no matter
 * which filters the URL carries, instead of one per category click.
 *
 * The URL is still read here and passed down as the initial state, so a shared
 * or bookmarked /shop?category=peanuts is server-rendered already filtered.
 */
export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; q?: string; sort?: string }>;
}) {
  await connection();

  const [products, params] = await Promise.all([getShopProducts(), searchParams]);
  const initial = filtersFromParams(params);

  return (
    <div className="min-h-screen bg-cream pb-12 pt-20 sm:pb-16 sm:pt-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <ShopBrowser products={products} initial={initial} />
      </div>
    </div>
  );
}
