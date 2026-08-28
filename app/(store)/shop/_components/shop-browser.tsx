"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { StorefrontProduct } from "@/lib/queries/storefront";
import {
  deriveCategories,
  filterProducts,
  filtersToQuery,
  SORT_LABELS,
  type ShopFilters,
  type SortKey,
} from "@/lib/shop/filter";
import { SearchIcon, SlidersIcon, XIcon } from "../../_components/icons";
import ProductCard from "../../_components/product-card";

/**
 * The shop, filtered in the browser.
 *
 * The server sends the whole catalogue once (~20KB) and every control below
 * works on that array, so category and search are instant — no request, no
 * loading state, no flash of the previous grid.
 *
 * Still server-RENDERED: a Client Component runs on the server for the initial
 * HTML, so /shop?category=peanuts arrives already filtered and indexable rather
 * than showing everything and correcting itself on hydrate.
 */
export default function ShopBrowser({
  products,
  initial,
}: {
  products: StorefrontProduct[];
  initial: ShopFilters;
}) {
  const [filters, setFilters] = useState<ShopFilters>(initial);

  // Derived from the catalogue rather than queried, so a count and its grid can
  // never disagree.
  const categories = useMemo(() => deriveCategories(products), [products]);
  const visible = useMemo(() => filterProducts(products, filters), [products, filters]);

  /*
   * Keep the address bar in step — without navigating.
   *
   * history.replaceState, NOT router.replace. router.replace issues an RSC
   * request for the new URL, which is the round trip client-side filtering
   * exists to avoid; worse, a response for "?q=mani" could land after the user
   * had already cleared the box and put the deleted text back on screen. This
   * writes the URL and nothing else, so a filtered shop is still shareable and
   * a reload still restores the view, with no request and no race.
   *
   * Debounced only so typing does not write the URL on every keystroke.
   */
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const id = window.setTimeout(() => {
      window.history.replaceState(null, "", `/shop${filtersToQuery(filters)}`);
    }, 250);
    return () => window.clearTimeout(id);
  }, [filters]);

  const set = (patch: Partial<ShopFilters>) => setFilters((f) => ({ ...f, ...patch }));

  const activeCategory = categories.find((c) => c.slug === filters.category);
  const unknownCategory = filters.category !== undefined && !activeCategory;
  const searching = filters.q !== undefined;

  return (
    <>
      <div className="mb-5 flex flex-col items-start justify-between gap-3 sm:mb-8 sm:flex-row sm:items-center sm:gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
            {activeCategory ? activeCategory.name : "Products"}
          </h1>
          <p className="mt-1 text-sm text-gray-600" aria-live="polite">
            Showing <strong>{visible.length}</strong>{" "}
            {visible.length === 1 ? "product" : "products"}
            {searching && <> for &ldquo;{filters.q}&rdquo;</>}
          </p>
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <div className="relative w-full sm:w-64">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              /*
               * type="text", not type="search". The native ✕ on a search input
               * clears the field through the browser rather than React, so the
               * value and the grid can disagree until the next keystroke. The
               * button below does the same job and always goes through state.
               */
              type="text"
              value={filters.q ?? ""}
              // Empty string becomes undefined so "no search" has exactly one
              // representation — clearing therefore falls straight back to
              // whatever category is selected.
              onChange={(e) => set({ q: e.target.value.length ? e.target.value : undefined })}
              placeholder="Search products…"
              aria-label="Search products"
              className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-9 text-sm outline-none transition-all focus:border-peanut focus:ring-2 focus:ring-peanut/10"
            />
            {searching && (
              <button
                type="button"
                onClick={() => set({ q: undefined })}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-peanut"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-500">
            <span className="whitespace-nowrap">Sort:</span>
            <select
              value={filters.sort}
              onChange={(e) => set({ sort: e.target.value as SortKey })}
              aria-label="Sort products"
              className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm text-gray-700 outline-none focus:border-peanut"
            >
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-4 lg:gap-8">
        <aside className="lg:col-span-1">
          {/* Category is the only filter here. Sort lives next to the search
              box, where it applies to what you are looking at. */}
          <div className="hidden rounded-2xl bg-white/70 p-4 shadow-sm backdrop-blur-md lg:sticky lg:top-24 lg:block lg:p-6">
            <div className="mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <SlidersIcon className="h-4 w-4 text-peanut" />
                <h2 className="font-semibold text-gray-900">Filters</h2>
              </span>
              {(filters.category || searching) && (
                <button
                  type="button"
                  onClick={() => set({ category: undefined, q: undefined })}
                  className="text-xs text-gray-400 transition-colors hover:text-peanut"
                >
                  Clear
                </button>
              )}
            </div>

            <h3 className="mb-2 text-sm font-semibold text-gray-900">Category</h3>
            <ul className="space-y-1">
              <li>
                <FilterButton
                  label="All"
                  count={products.length}
                  active={!filters.category}
                  onClick={() => set({ category: undefined })}
                />
              </li>
              {categories.map((c) => (
                <li key={c.slug}>
                  <FilterButton
                    label={c.name}
                    count={c.count}
                    active={filters.category === c.slug}
                    onClick={() => set({ category: c.slug })}
                  />
                </li>
              ))}
            </ul>
          </div>

          {/* Mobile: a swipeable chip row rather than a drawer — with seven
              categories a drawer is two taps to do what one swipe does. */}
          <div className="-mx-4 overflow-x-auto px-4 pb-1 lg:hidden">
            <ul className="flex w-max gap-2">
              <li>
                <Chip
                  label="All"
                  count={products.length}
                  active={!filters.category}
                  onClick={() => set({ category: undefined })}
                />
              </li>
              {categories.map((c) => (
                <li key={c.slug}>
                  <Chip
                    label={c.name}
                    count={c.count}
                    active={filters.category === c.slug}
                    onClick={() => set({ category: c.slug })}
                  />
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <div className="lg:col-span-3">
          {visible.length === 0 ? (
            <div className="grid place-items-center rounded-2xl border border-dashed border-peanut/30 bg-white/50 px-6 py-20 text-center">
              <div className="max-w-sm">
                {/* An unknown category is a different problem from an empty
                    result, and saying so stops a mistyped or retired link
                    reading as "this shop has nothing". */}
                <h2 className="font-semibold text-gray-900">
                  {unknownCategory ? "That category doesn't exist" : "Nothing matches"}
                </h2>
                <p className="mt-1.5 text-sm text-gray-600">
                  {unknownCategory
                    ? "It may have been renamed or retired."
                    : filters.q
                      ? `We couldn't find anything for “${filters.q}”${
                          activeCategory ? ` in ${activeCategory.name}` : ""
                        }.`
                      : "There is nothing in this category right now."}
                </p>
                <button
                  type="button"
                  onClick={() => setFilters({ sort: filters.sort })}
                  className="mt-4 inline-flex items-center rounded-full bg-peanut px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-roasted"
                >
                  See everything
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:gap-6 lg:grid-cols-3 lg:gap-6">
              {visible.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function FilterButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
        active ? "bg-peanut text-white" : "text-gray-600 hover:bg-peanut/10"
      }`}
    >
      <span className="truncate">{label}</span>
      <span className={active ? "text-white/70" : "text-gray-400"}>{count}</span>
    </button>
  );
}

function Chip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-2 text-sm transition-colors ${
        active ? "bg-peanut text-white" : "bg-white text-gray-600 hover:bg-peanut/10"
      }`}
    >
      {label}
      <span className={active ? "text-white/70" : "text-gray-400"}>{count}</span>
    </button>
  );
}
