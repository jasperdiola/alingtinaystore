"use client";

import { useState } from "react";

/**
 * Thumbnail for the product list.
 *
 * A client component purely so it can react to the image failing to load. That
 * matters here rather than being a nicety: most products still point at
 * `/images/*.jpeg` paths whose files are not in the repo, so the row would show
 * a silently broken image and read as "has a picture" when it has none. Saying
 * "Missing" is what tells you which products actually need an upload.
 *
 * A plain <img>, not next/image: next/image throws on a host that is not
 * allow-listed, and these URLs are whatever happens to be in the database,
 * including old external ones. A 40px thumbnail gains nothing from the
 * optimizer anyway.
 */
export default function ProductThumb({
  src,
  name,
}: {
  src: string | null;
  name: string;
}) {
  const [failed, setFailed] = useState(false);
  const missing = !src || failed;

  return (
    <div
      className={`grid size-10 shrink-0 place-items-center overflow-hidden rounded-md border ${
        missing
          ? "border-dashed border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800"
          : "border-neutral-200 dark:border-neutral-700"
      }`}
      title={missing ? `${name} has no working image` : name}
    >
      {missing ? (
        <span className="text-[9px] leading-tight text-neutral-400">
          {src ? "broken" : "none"}
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
