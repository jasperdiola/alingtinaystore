"use client";

import { useState } from "react";

/**
 * Product photo with an honest fallback.
 *
 * This is a Client Component for one reason: it needs `onError`. Most products
 * currently point at `/images/*.jpeg` files that are not in this repo, and a
 * broken <img> renders as a torn-page glyph or an empty box — which reads as a
 * broken site rather than a product awaiting a photo. Catching the failure lets
 * the card fall back to a branded placeholder that still names the product.
 *
 * A plain <img> rather than next/image: these URLs come from the database and
 * can be anything an admin has ever set, including hosts that are not in
 * next.config's remotePatterns — and next/image throws on those rather than
 * degrading. Uploaded images already arrive correctly sized from the admin.
 */
export default function ProductImage({
  src,
  alt,
  className = "",
  sizes,
}: {
  src: string | null;
  alt: string;
  className?: string;
  /** Rendered into the placeholder so it never looks like a loading skeleton. */
  sizes?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={`flex items-center justify-center bg-gradient-to-br from-beige/60 to-cream p-3 text-center ${className}`}
      >
        <span className="text-[10px] font-medium leading-tight text-roasted/40 sm:text-xs">
          {alt}
        </span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      sizes={sizes}
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
