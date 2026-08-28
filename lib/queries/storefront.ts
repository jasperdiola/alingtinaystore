import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";

/**
 * Everything the customer-facing pages read.
 *
 * Deliberately separate from lib/queries/catalog.ts, which serves the admin.
 * The two ask different questions: the admin wants every product including
 * retired ones and per-branch stock, the storefront wants only what a customer
 * could actually buy today, aggregated across branches. Sharing one module
 * would mean every query carried an `isAdmin` flag, and the day someone got
 * that flag wrong a retired product would appear on the shop page.
 *
 * Prices are aggregated in SQL and cast to text, then parsed once here.
 * Decimal cannot cross into a Client Component, and a JS float would lose
 * centavos on the way.
 */

export type ProductSize = {
  /** product_sizes.id — the cart line identity and what checkout resolves. */
  id: string;
  label: string;
  /** Cheapest branch price for this size. */
  price: number;
  inStock: boolean;
};

export type StorefrontProduct = {
  id: string;
  slug: string;
  name: string;
  category: string;
  categorySlug: string;
  description: string | null;
  image: string | null;
  /** Lowest price across every size stocked anywhere — the "From ₱X" figure. */
  fromPrice: number;
  /** Buyable sizes, cheapest first. Carries the id the cart stores. */
  sizes: ProductSize[];
  /** False when every branch has run out; the card says so rather than lying. */
  inStock: boolean;
  isFeatured: boolean;
  isBestSeller: boolean;
  /** ISO string — used by the shop's "Newest" sort, done in the browser. */
  createdAt: string;
};

type ProductRaw = {
  id: string;
  slug: string;
  name: string;
  category: string;
  category_slug: string;
  description: string | null;
  image: string | null;
  from_price: string | null;
  sizes: { id: string; label: string; price: string; inStock: boolean }[] | null;
  in_stock: boolean;
  is_featured: boolean;
  is_best_seller: boolean;
  created_at: Date;
};

const shape = (r: ProductRaw): StorefrontProduct => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  category: r.category,
  categorySlug: r.category_slug,
  description: r.description,
  image: r.image,
  fromPrice: Number(r.from_price ?? 0),
  sizes: (r.sizes ?? []).map((z) => ({
    id: z.id,
    label: z.label,
    price: Number(z.price),
    inStock: z.inStock,
  })),
  inStock: r.in_stock,
  isFeatured: r.is_featured,
  isBestSeller: r.is_best_seller,
  createdAt: r.created_at.toISOString(),
});

/**
 * The one query behind both the home page and the shop.
 *
 * A single statement with a lateral aggregate rather than N+1 round trips: a
 * shop page of 40 products would otherwise be 40 extra queries for sizes and 40
 * more for stock. It reads `store_inventory.effective_price`, which the
 * sync_effective_price trigger keeps equal to `price_override ?? size price`,
 * so a branch that prices differently is reflected without any joining here.
 *
 * Only active rows at every level — an inactive product, size or inventory line
 * is invisible to customers, which is what "retire, don't delete" is for.
 */
async function queryProducts(opts: {
  categorySlug?: string;
  search?: string;
  featuredOnly?: boolean;
  bestSellersOnly?: boolean;
  limit?: number;
}): Promise<StorefrontProduct[]> {
  const rows = await prisma.$queryRaw<ProductRaw[]>`
    SELECT p.id, p.slug, p.name, p.short_description AS description, p.image,
           c.name AS category, c.slug AS category_slug,
           p.is_featured, p.is_best_seller, p.created_at,
           agg.from_price::text,
           agg.sizes,
           COALESCE(agg.in_stock, false) AS in_stock
      FROM products p
      JOIN categories c ON c.id = p.category_id AND c.is_active
      LEFT JOIN LATERAL (
        -- Collapsed per size first, then aggregated, so each size carries its
        -- own cheapest branch price and its own stock flag. Ordering by price
        -- also gives the natural 100g -> 1 Kilo sequence with no lookup table.
        SELECT MIN(z.price)      AS from_price,
               BOOL_OR(z.in_stock) AS in_stock,
               JSON_AGG(JSON_BUILD_OBJECT(
                 'id', z.id, 'label', z.label,
                 'price', z.price::text, 'inStock', z.in_stock
               ) ORDER BY z.price) AS sizes
          FROM (
            SELECT ps.id, ps.label,
                   MIN(si.effective_price) AS price,
                   BOOL_OR(si.stock > 0)   AS in_stock
              FROM product_sizes ps
              JOIN store_inventory si ON si.product_size_id = ps.id AND si.is_active
             WHERE ps.product_id = p.id AND ps.is_active
             GROUP BY ps.id, ps.label
          ) z
      ) agg ON TRUE
     WHERE p.is_active
       AND agg.from_price IS NOT NULL
       AND (${opts.categorySlug ?? null}::text IS NULL OR c.slug = ${opts.categorySlug ?? null}::text)
       AND (${opts.search ?? null}::text IS NULL
            OR p.name ILIKE '%' || ${opts.search ?? null}::text || '%'
            OR c.name ILIKE '%' || ${opts.search ?? null}::text || '%')
       AND (${opts.featuredOnly ?? false}::boolean = false OR p.is_featured)
       AND (${opts.bestSellersOnly ?? false}::boolean = false OR p.is_best_seller)
     -- One order, the catalogue's own. Every shop sort is applied in the
     -- browser against this array, and a stable sort keeps this as the tiebreak.
     ORDER BY p.display_order, p.name
     LIMIT ${opts.limit ?? 200}
  `;
  return rows.map(shape);
}

/**
 * The whole sellable catalogue, in one query.
 *
 * The shop sends all of it to the browser and filters there — see
 * lib/shop/filter.ts for why. ~20KB of JSON buys instant category, sort, price
 * and search with no further requests, and lets the category counts and the
 * price ceiling be derived rather than separately queried.
 */
export const getShopProducts = cache(async () => queryProducts({}));

export const getBestSellers = cache(async (limit = 8) =>
  (await queryProducts({ bestSellersOnly: true, limit }))
);

export const getFeatured = cache(async (limit = 8) =>
  (await queryProducts({ featuredOnly: true, limit }))
);

/**
 * The products the hero cycles through.
 *
 * Featured first — that flag is the shop's own "put this on the front page" —
 * falling back to best sellers and then to anything, so the hero is never
 * empty on a catalogue nobody has curated yet.
 */
export const getHeroSlides = cache(
  async (limit = 5): Promise<StorefrontProduct[]> => {
    const featured = await getFeatured(limit);
    if (featured.length) return featured;
    const best = await getBestSellers(limit);
    if (best.length) return best;
    return queryProducts({ limit });
  }
);

/** The hero product. Falls back so the page never renders an empty hero. */
export const getHeroProduct = cache(async (): Promise<StorefrontProduct | null> => {
  const featured = await getFeatured(1);
  if (featured.length) return featured[0];
  const best = await getBestSellers(1);
  if (best.length) return best[0];
  const any = (await queryProducts({ limit: 1 }));
  return any[0] ?? null;
});


/* ------------------------------------------------------------------ content */

export type Testimonial = {
  id: string;
  name: string;
  role: string | null;
  avatar: string | null;
  rating: number;
  text: string;
};

export const getTestimonials = cache(async (): Promise<Testimonial[]> => {
  const rows = await prisma.testimonials.findMany({
    where: { is_active: true },
    orderBy: [{ display_order: "asc" }, { created_at: "asc" }],
    select: {
      id: true,
      customer_name: true,
      role: true,
      avatar: true,
      rating: true,
      text: true,
    },
  });
  return rows.map((t) => ({
    id: t.id,
    name: t.customer_name,
    role: t.role,
    avatar: t.avatar,
    rating: t.rating,
    text: t.text,
  }));
});

export type Branch = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  mapUrl: string | null;
};

export const getBranches = cache(async (): Promise<Branch[]> => {
  const rows = await prisma.stores.findMany({
    where: { is_active: true },
    orderBy: { display_order: "asc" },
    select: {
      id: true,
      name: true,
      address_line: true,
      city: true,
      google_maps_url: true,
    },
  });
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    address: s.address_line,
    city: s.city,
    mapUrl: s.google_maps_url,
  }));
});

/**
 * Public site settings as a plain lookup.
 *
 * `is_public` is honoured here rather than trusted to the caller: this module
 * runs with a connection that bypasses RLS, so the flag is only meaningful if
 * something applies it. Everything returned is safe to render to anyone.
 */
export const getSettings = cache(async (): Promise<Record<string, string>> => {
  const rows = await prisma.site_settings.findMany({
    where: { is_public: true },
    select: { key: true, value: true },
  });
  const out: Record<string, string> = {};
  for (const r of rows) {
    // `value` is jsonb: a JSON string arrives quoted, anything else is rendered
    // as-is so a number or object does not become "[object Object]".
    out[r.key] = typeof r.value === "string" ? r.value : JSON.stringify(r.value);
  }
  return out;
});
