"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { peso } from "@/lib/format";
import type { StorefrontProduct } from "@/lib/queries/storefront";
import { ArrowRightIcon, Stars } from "./icons";
import ProductImage from "./product-image";

/** Matches the reference design's autoplay. */
const INTERVAL_MS = 6000;

/**
 * The "Featured This Week" hero.
 *
 * Cycles the featured products every six seconds, with the copy staggering in
 * on each change — eyebrow, then headline, then blurb, then buttons — which is
 * what makes a slide change read as one movement rather than five.
 *
 * Every slide is rendered and cross-faded rather than swapped out. Mounting one
 * at a time would mean the headline's height changes mid-transition, and only
 * the current product would be in the HTML for a crawler; this way all five are
 * present and the tallest one sets the height once.
 */
export default function HeroCarousel({
  slides,
  tagline,
}: {
  slides: StorefrontProduct[];
  tagline?: string;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    // A single slide has nowhere to go, and a paused carousel should stay put.
    if (paused || slides.length < 2) return;
    const id = window.setInterval(
      () => setIndex((i) => (i + 1) % slides.length),
      INTERVAL_MS
    );
    return () => window.clearInterval(id);
  }, [paused, slides.length]);

  if (slides.length === 0) return null;

  return (
    <section
      className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-roasted"
      aria-roledescription="carousel"
      aria-label="Featured this week"
      // Pausing on hover and on focus is what makes the copy readable at all —
      // six seconds is not long enough to read a blurb and click a button.
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div className="absolute inset-0">
        {slides.map((s, i) => (
          <div
            key={s.id}
            aria-hidden={i !== index}
            className="absolute inset-0 transition-opacity duration-1000 ease-out"
            style={{ opacity: i === index ? 1 : 0 }}
          >
            <ProductImage
              src={s.image}
              alt=""
              className="h-full w-full scale-105 object-cover transition-transform duration-[7000ms] ease-out"
            />
          </div>
        ))}
        {/* Fixed scrim: the copy must stay legible over whatever photo shows. */}
        <div className="absolute inset-0 bg-roasted/75" />
      </div>

      <div className="relative flex w-full flex-1 flex-col justify-center">
        <div className="mx-auto grid w-full max-w-7xl grid-cols-1 grid-rows-1 px-4 py-8 text-center sm:px-6 sm:py-20 lg:px-8 lg:py-28">
          {slides.map((s, i) => (
            <Slide key={s.id} product={s} active={i === index} tagline={tagline} />
          ))}
        </div>
      </div>

      {slides.length > 1 && (
        <div className="relative pb-6 sm:pb-8">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex justify-center gap-2">
              {slides.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`Show ${s.name}`}
                  aria-current={i === index}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === index ? "w-8 bg-white" : "w-1.5 bg-white/30 hover:bg-white/50"
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * One slide's copy.
 *
 * Inactive slides are laid on top of each other in the same grid cell and
 * hidden, so the section's height is the tallest slide's and never jumps.
 * `inert` keeps the hidden ones out of the tab order — otherwise Tab walks
 * through four invisible sets of buttons.
 */
function Slide({
  product,
  active,
  tagline,
}: {
  product: StorefrontProduct;
  active: boolean;
  tagline?: string;
}) {
  // Each element waits a little longer than the one above it, so the copy
  // arrives in reading order. Values follow the reference design.
  const step = (delayMs: number) => ({
    opacity: active ? 1 : 0,
    transform: active ? "none" : "translateY(20px)",
    transition: `opacity 600ms cubic-bezier(0.22,1,0.36,1) ${active ? delayMs : 0}ms, transform 600ms cubic-bezier(0.22,1,0.36,1) ${active ? delayMs : 0}ms`,
  });

  return (
    <div
      inert={!active}
      className={`col-start-1 row-start-1 ${active ? "" : "pointer-events-none"}`}
      style={{
        gridArea: "1 / 1",
        visibility: active ? "visible" : "hidden",
        transitionDelay: active ? "0ms" : "600ms",
      }}
    >
      <div className="mx-auto max-w-2xl text-center">
        <p
          className="mb-3 inline-block rounded-full bg-white/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-white backdrop-blur sm:mb-4 sm:text-xs"
          style={{
            ...step(100),
            transform: active ? "none" : "translateY(-10px)",
          }}
        >
          Featured This Week
        </p>

        <h1
          className="text-[clamp(1.6rem,5vw,3.8rem)] font-bold leading-[1.05] tracking-tight text-white"
          style={step(150)}
        >
          {product.name}
        </h1>

        <p
          className="mt-2 text-sm leading-relaxed text-white/70 sm:mt-3 sm:text-base"
          style={step(200)}
        >
          {product.description ?? tagline}
        </p>

        <p className="mt-3 text-white/90" style={step(225)}>
          <span className="text-xs text-white/50">From </span>
          <span className="text-2xl font-bold tracking-tight">
            {peso(product.fromPrice)}
          </span>
          {product.sizes.length > 0 && (
            <span className="ml-2 text-xs text-white/50">
              {product.sizes.map((z) => z.label).join(" · ")}
            </span>
          )}
        </p>

        <div
          className="mt-5 flex flex-col items-center justify-center gap-3 sm:mt-6 sm:flex-row sm:gap-4"
          style={step(250)}
        >
          <Link
            href={`/shop?category=${product.categorySlug}`}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-peanut px-7 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-peanut/90 sm:w-auto"
          >
            Order Now
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
          <a
            href="#our-story"
            className="inline-flex w-full items-center justify-center rounded-full border border-white/25 px-7 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-white/10 sm:w-auto"
          >
            Learn More
          </a>
        </div>

        <div
          className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-[10px] text-white/50 sm:mt-6 sm:text-xs"
          style={{ ...step(350), transform: "none" }}
        >
          <div className="flex items-center gap-2">
            <div className="flex -space-x-2">
              {["A", "B", "C"].map((c) => (
                <span
                  key={c}
                  className="grid size-7 place-items-center rounded-full border-2 border-roasted bg-beige text-[10px] font-semibold text-roasted"
                >
                  {c}
                </span>
              ))}
            </div>
            <span>2k+ happy customers</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Stars rating={5} />
            <span>4.8/5</span>
          </div>
        </div>
      </div>
    </div>
  );
}
