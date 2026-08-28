/**
 * Product image rules. Pure — no Next, no database, no Supabase client.
 *
 * Kept out of app/actions/catalog.ts on purpose: a "use server" module may only
 * export async functions, so these constants would be rewritten into action
 * references and every caller would get a function where it expected a value.
 * That is the bug that killed the stock Adjust button; see
 * scripts/render-check.ts.
 */

/** Public bucket, already created with a manager-only write policy. */
export const PRODUCT_BUCKET = "product-images";

/**
 * Mirrors storage.buckets.allowed_mime_types for this bucket exactly. Checking
 * here as well gives a readable error instead of a raw storage rejection, but
 * the database remains the thing that actually enforces it.
 */
export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
] as const;

/** 5 MB — the bucket's file_size_limit. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const ACCEPT_ATTR = ALLOWED_IMAGE_TYPES.join(",");

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

export type ImageProblem = string | null;

/**
 * Validates a browser-supplied file. Returns a message, or null when it is fine.
 *
 * The type is taken from the file's own MIME rather than its extension: a
 * renamed .exe is still rejected, and the bucket would reject it regardless.
 */
export function checkImage(file: File): ImageProblem {
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_IMAGE_BYTES) {
    return `Image is ${(file.size / 1024 / 1024).toFixed(1)}MB — the limit is 5MB.`;
  }
  if (!ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number])) {
    return `${file.type || "That file type"} is not allowed. Use JPEG, PNG, WebP or AVIF.`;
  }
  return null;
}

/**
 * Storage path for a product's image.
 *
 * Keyed by product id so every image for a product lives together and an
 * orphaned file is traceable back to its product. The timestamp means replacing
 * an image never collides with a cached copy of the previous one at the same
 * URL, which is what makes a stale CDN entry look like "the upload didn't work".
 */
export function imagePath(productId: string, file: File): string {
  const ext = EXT[file.type] ?? "jpg";
  return `${productId}/${Date.now()}.${ext}`;
}

/** True when a URL points at our own bucket, so it is safe for us to delete. */
export function isOwnUpload(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.includes(`/storage/v1/object/public/${PRODUCT_BUCKET}/`);
}

/** Recovers the object path from a public URL, for deletion. */
export function pathFromPublicUrl(url: string): string | null {
  const marker = `/storage/v1/object/public/${PRODUCT_BUCKET}/`;
  const i = url.indexOf(marker);
  if (i === -1) return null;
  return decodeURIComponent(url.slice(i + marker.length).split("?")[0]) || null;
}
