/**
 * Verifies the shop's browser-side filtering — `npm run db:shop-check`.
 *
 * These run against the real catalogue but touch nothing: filterProducts and
 * friends are pure, which is the whole reason they live in lib/shop/filter.ts
 * rather than inside the component. The behaviour a customer actually notices
 * — type to narrow, clear to go back — is therefore checkable without a
 * browser.
 *
 * The reported bug is section 2: clearing the search box must return to the
 * selected category, not to the whole catalogue and not to a stale result.
 */
import "dotenv/config";
import { getShopProducts } from "../lib/queries/storefront";
import {
  deriveCategories,
  filterProducts,
  filtersFromParams,
  filtersToQuery,
  isSortKey,
  SORT_LABELS,
  type ShopFilters,
} from "../lib/shop/filter";

let pass = 0,
  fail = 0;
const ok = (l: string, c: boolean, d = "") => {
  if (c) {
    pass++;
    console.log(`  \x1b[32mPASS\x1b[0m ${l} ${d}`);
  } else {
    fail++;
    console.log(`  \x1b[31mFAIL\x1b[0m ${l} ${d}`);
  }
};

const ids = (list: { id: string }[]) => list.map((p) => p.id).join(",");

async function main() {
  const products = await getShopProducts();
  const categories = deriveCategories(products);
  const cat = categories.find((c) => c.count >= 2) ?? categories[0];
  const base: ShopFilters = { sort: "popular" };

  console.log(
    `\ncatalogue: ${products.length} products, ${categories.length} categories ` +
      `(probing "${cat.name}", ${cat.count})`
  );

  console.log("\n1. Category and search each narrow");
  const all = filterProducts(products, base);
  ok("no filters returns everything", all.length === products.length, `${all.length}`);

  const inCat = filterProducts(products, { ...base, category: cat.slug });
  ok(`category returns its own count`, inCat.length === cat.count, `${inCat.length} vs ${cat.count}`);
  ok("every result really is in that category",
    inCat.every((p) => p.categorySlug === cat.slug));

  const term = inCat[0].name.slice(0, 3);
  const searched = filterProducts(products, { ...base, q: term });
  ok(`searching "${term}" narrows the catalogue`,
    searched.length > 0 && searched.length < products.length,
    `${searched.length} of ${products.length}`);

  console.log("\n2. Clearing the search returns to the selected category");
  /*
   * The reported bug. Typing inside a category and then clearing must land
   * back on exactly that category — not the whole shop, and not the search
   * result that was on screen a moment earlier.
   */
  const typing = filterProducts(products, { ...base, category: cat.slug, q: term });
  ok("search applies within the category",
    typing.every((p) => p.categorySlug === cat.slug),
    `${typing.length} result(s)`);
  ok("search inside a category is a subset of it", typing.length <= inCat.length);

  const cleared = filterProducts(products, { ...base, category: cat.slug, q: undefined });
  ok("clearing restores exactly the category", ids(cleared) === ids(inCat),
    `${cleared.length} vs ${inCat.length}`);
  ok("clearing does NOT fall back to the whole catalogue",
    cleared.length !== products.length || cat.count === products.length);

  const clearedNoCat = filterProducts(products, { ...base, q: undefined });
  ok("clearing with no category restores everything",
    clearedNoCat.length === products.length, `${clearedNoCat.length}`);

  // The component maps an empty input to `undefined`, so "" must behave the
  // same as cleared. If these ever diverge, an empty box would filter by "".
  const emptyString = filterProducts(products, { ...base, category: cat.slug, q: "" });
  ok('an empty search string behaves as cleared', ids(emptyString) === ids(inCat));
  const spaces = filterProducts(products, { ...base, category: cat.slug, q: "   " });
  ok("a whitespace-only search behaves as cleared", ids(spaces) === ids(inCat));

  console.log("\n3. Search matching");
  const upper = filterProducts(products, { ...base, q: term.toUpperCase() });
  ok("case-insensitive", ids(upper) === ids(searched));
  const padded = filterProducts(products, { ...base, q: `  ${term}  ` });
  ok("surrounding spaces ignored", ids(padded) === ids(searched));
  const nonsense = filterProducts(products, { ...base, q: "zzzzqqqq" });
  ok("no match returns empty rather than everything", nonsense.length === 0);

  console.log("\n4. Sorting");
  const asc = filterProducts(products, { ...base, sort: "price-asc" });
  ok("price ascending", asc.every((p, i) => i === 0 || asc[i - 1].fromPrice <= p.fromPrice),
    `${asc[0]?.fromPrice} … ${asc.at(-1)?.fromPrice}`);
  const desc = filterProducts(products, { ...base, sort: "price-desc" });
  ok("price descending", desc.every((p, i) => i === 0 || desc[i - 1].fromPrice >= p.fromPrice),
    `${desc[0]?.fromPrice} … ${desc.at(-1)?.fromPrice}`);
  const newest = filterProducts(products, { ...base, sort: "newest" });
  ok("newest first",
    newest.every((p, i) => i === 0 || newest[i - 1].createdAt >= p.createdAt));
  const popular = filterProducts(products, { ...base, sort: "popular" });
  const rank = (p: (typeof products)[number]) => (p.isBestSeller ? 2 : 0) + (p.isFeatured ? 1 : 0);
  ok("popular puts promoted products first",
    popular.every((p, i) => i === 0 || rank(popular[i - 1]) >= rank(p)));
  ok("every sort keeps the same products", asc.length === products.length &&
    desc.length === products.length && newest.length === products.length);

  console.log("\n5. The URL still describes the view");
  ok("default state has an empty query", filtersToQuery(base) === "");
  ok("category appears", filtersToQuery({ ...base, category: "peanuts" }) === "?category=peanuts");
  ok("popular is left out as the default",
    !filtersToQuery({ ...base, sort: "popular" }).includes("sort"));
  ok("a non-default sort appears",
    filtersToQuery({ ...base, sort: "price-asc" }).includes("sort=price-asc"));

  const round = (f: ShopFilters) => {
    const qs = new URLSearchParams(filtersToQuery(f).replace(/^\?/, ""));
    return filtersFromParams(Object.fromEntries(qs) as Record<string, string>);
  };
  for (const f of [
    base,
    { ...base, category: "peanuts" },
    { ...base, q: "mani" },
    { ...base, sort: "price-desc" as const, category: "seeds", q: "sun" },
  ]) {
    const back = round(f);
    ok(`round-trips ${filtersToQuery(f) || "(no query)"}`,
      back.category === f.category && back.q === f.q && back.sort === f.sort);
  }

  ok("a hand-typed bad sort falls back to popular",
    filtersFromParams({ sort: "chaos" }).sort === "popular");
  ok("isSortKey rejects nonsense", !isSortKey("chaos") && isSortKey("newest"));
  ok("every sort key has a label",
    Object.keys(SORT_LABELS).every((k) => isSortKey(k)));

  // The price filter was removed from the UI; the state must not carry it
  // either, or a stale ?max= would silently hide products.
  ok("no price state survives in the URL",
    !filtersToQuery({ ...base, category: "peanuts" }).includes("max"));

  console.log(`\n${fail === 0 ? "\x1b[32m" : "\x1b[31m"}${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("\ncheck failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
