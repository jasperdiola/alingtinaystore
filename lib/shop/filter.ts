/**
 * Shop filtering. Pure — no Next, no database, no React.
 *
 * These run in the BROWSER, on a catalogue the server already sent.
 *
 * The shop used to filter in SQL, so every category click, sort change and
 * keystroke was a request. That is the right shape for a large or unbounded
 * catalogue; it is the wrong shape for this one. The whole catalogue is ~20KB
 * of JSON — less than a single product photo — and "All" already loads every
 * row, so the data needed to answer every other filter is on the page before
 * the customer touches anything. Asking the server again is pure latency.
 *
 * Being pure also means the same functions run during server rendering, so a
 * shared link like /shop?category=peanuts still arrives already filtered rather
 * than flashing the full grid and correcting itself.
 */
import type { StorefrontProduct } from "@/lib/queries/storefront";

export type SortKey = "popular" | "newest" | "price-asc" | "price-desc";

export const SORT_LABELS: Record<SortKey, string> = {
  popular: "Popular",
  newest: "Newest",
  "price-asc": "Price: Low to High",
  "price-desc": "Price: High to Low",
};

export const isSortKey = (v: string | undefined | null): v is SortKey =>
  typeof v === "string" && v in SORT_LABELS;

export type ShopFilters = {
  category?: string;
  q?: string;
  sort: SortKey;
};

export type ShopCategory = { slug: string; name: string; count: number };

/**
 * Categories with live counts, derived from the catalogue itself.
 *
 * Previously its own SQL query. Deriving it means a category can never offer a
 * filter that leads to an empty page — the count and the grid are now computed
 * from one array, so they cannot disagree.
 */
export function deriveCategories(products: StorefrontProduct[]): ShopCategory[] {
  const seen = new Map<string, ShopCategory>();
  for (const p of products) {
    const existing = seen.get(p.categorySlug);
    if (existing) existing.count += 1;
    else seen.set(p.categorySlug, { slug: p.categorySlug, name: p.category, count: 1 });
  }
  // Insertion order follows the catalogue's own display_order, which is the
  // order the shop wants; no separate sort needed.
  return [...seen.values()];
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Ranking for "Popular".
 *
 * There is no click data to rank by, so popular means what the shop itself
 * promotes: best sellers first, then featured. Ties fall back to the catalogue
 * order the admin set.
 */
const popularity = (p: StorefrontProduct) =>
  (p.isBestSeller ? 2 : 0) + (p.isFeatured ? 1 : 0);

export function filterProducts(
  products: StorefrontProduct[],
  { category, q, sort }: ShopFilters
): StorefrontProduct[] {
  const term = q ? norm(q) : "";

  const out = products.filter((p) => {
    if (category && p.categorySlug !== category) return false;
    if (!term) return true;
    return (
      norm(p.name).includes(term) ||
      norm(p.category).includes(term) ||
      (p.description ? norm(p.description).includes(term) : false)
    );
  });

  // The incoming array is already in catalogue order, so every comparator only
  // has to break ties — and a stable sort keeps that order where they tie.
  switch (sort) {
    case "price-asc":
      return out.sort((a, b) => a.fromPrice - b.fromPrice);
    case "price-desc":
      return out.sort((a, b) => b.fromPrice - a.fromPrice);
    case "newest":
      return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    case "popular":
    default:
      return out.sort((a, b) => popularity(b) - popularity(a));
  }
}

/** The filter state as a URL query, so any view stays shareable. */
export function filtersToQuery(f: ShopFilters): string {
  const q = new URLSearchParams();
  if (f.category) q.set("category", f.category);
  if (f.q) q.set("q", f.q);
  if (f.sort !== "popular") q.set("sort", f.sort);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Reads filter state back out of a URL, tolerating anything hand-typed. */
export function filtersFromParams(params: {
  category?: string;
  q?: string;
  sort?: string;
}): ShopFilters {
  return {
    category: params.category || undefined,
    q: params.q?.trim() || undefined,
    // An unrecognised ?sort= falls back rather than breaking a typed URL.
    sort: isSortKey(params.sort) ? params.sort : "popular",
  };
}
