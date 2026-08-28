import type { StorefrontProduct } from "@/lib/queries/storefront";
import AddToCart from "./add-to-cart";
import ProductImage from "./product-image";

/**
 * The product tile used by both the home page and the shop.
 *
 * A Server Component — nothing here is interactive beyond hover, which is CSS.
 * The only client code on the whole grid is the image's error fallback, so a
 * 40-product shop page ships essentially no JavaScript for its content.
 *
 * The hover treatment is deliberately split: the image scales
 * (transform, compositor-only) while the card raises its shadow. Both are
 * cheap; animating width/height or box-shadow spread would not be.
 */
export default function ProductCard({ product }: { product: StorefrontProduct }) {
  const { name, category, description, image, inStock } = product;

  return (
    <article className="group">
      <div className="relative overflow-hidden rounded-2xl bg-white shadow-sm transition-shadow duration-500 group-hover:shadow-xl sm:rounded-3xl">
        <div className="relative aspect-square overflow-hidden bg-cream">
          <ProductImage
            src={image}
            alt={name}
            sizes="(min-width: 1024px) 25vw, 50vw"
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
          {/* Warms the lower edge on hover so the tile lifts as one object. */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/10 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

          {!inStock && (
            <div className="absolute inset-0 grid place-items-center bg-white/70 backdrop-blur-[1px]">
              <span className="rounded-full bg-roasted/85 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
                Sold out
              </span>
            </div>
          )}
        </div>

        <div className="p-2.5 sm:p-4">
          <p className="mb-0.5 truncate text-[10px] font-medium text-peanut sm:text-xs">
            {category}
          </p>
          <h3 className="mt-0.5 truncate text-sm font-semibold text-gray-900 sm:text-base">
            {name}
          </h3>
          {description && (
            <p className="mt-0.5 line-clamp-1 text-xs text-gray-400">{description}</p>
          )}

          {/* Price, size choice and the add button live together, so the
              number on screen always describes the size about to be added. */}
          <AddToCart product={product} />
        </div>
      </div>
    </article>
  );
}
