"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export type RevealFrom = "up" | "down" | "left" | "right" | "fade" | "pop";

/** Matches the distances the reference design animates over. */
const OFFSET: Record<RevealFrom, string> = {
  up: "translateY(30px)",
  down: "translateY(-10px)",
  left: "translateX(-40px)",
  right: "translateX(40px)",
  fade: "none",
  pop: "scale(0.6)",
};

/**
 * Reveals its children when they scroll into view.
 *
 * A hand-rolled replacement for the reference design's Framer Motion
 * `whileInView`. Framer is roughly 40KB gzipped — twice the weight of this
 * shop's entire product catalogue — and, more importantly, every `motion.div`
 * is a Client Component: wrapping the grid in one would drag every product card
 * into the browser bundle. This is a client component too, but `children`
 * arrives as an already-rendered slot, so the cards it wraps stay Server
 * Components.
 *
 * Two robustness rules the animation must not break:
 *
 *  - Content that never reveals is content nobody can read. If IntersectionObserver
 *    is unavailable the children start visible, and a <noscript> rule in the
 *    layout does the same when scripting is off.
 *  - prefers-reduced-motion skips straight to the final state. This is a whole
 *    page of movement, which is exactly what that setting exists to opt out of.
 */
export default function Reveal({
  children,
  from = "up",
  delay = 0,
  duration = 600,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  from?: RevealFrom;
  /** Milliseconds. Cards in a grid stagger by index — see the home page. */
  delay?: number;
  duration?: number;
  className?: string;
  as?: "div" | "section" | "li";
}) {
  const ref = useRef<HTMLElement>(null);
  /*
   * Always false initially, on the server and in the browser alike.
   *
   * Deriving it from `typeof IntersectionObserver` looked like a sensible
   * fallback but hydrated inconsistently: the server has no such global, so it
   * rendered children visible, while the browser's first render found one and
   * rendered them hidden — a mismatch on every revealed element, and a visible
   * flash of content appearing then vanishing before it animated in.
   *
   * A browser without IntersectionObserver is handled in the effect below, and
   * a browser without JavaScript by the <noscript> rule in the layout.
   */
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || shown) return;

    /*
     * No observer: reveal the element directly rather than leaving the content
     * stranded at opacity 0.
     *
     * Written to the DOM instead of through state on purpose — setState here
     * would be a state update inside an effect body, costing a second render to
     * reach a value that can never change again. This is the kind of one-way
     * external write an effect is actually for.
     */
    if (typeof IntersectionObserver === "undefined") {
      el.style.opacity = "1";
      el.style.transform = "none";
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          setShown(true);
          // `once`: revealing again on every scroll past is noise, and it
          // keeps the observer alive for the life of the page.
          io.disconnect();
        }
      },
      // Fires a little before the element's top edge reaches the fold, so the
      // motion finishes about when it becomes properly readable.
      { rootMargin: "0px 0px -8% 0px" }
    );

    io.observe(el);
    return () => io.disconnect();
  }, [shown]);

  return (
    <Tag
      // @ts-expect-error — one ref type across the three allowed tags.
      ref={ref}
      data-reveal={shown ? "shown" : "hidden"}
      className={className}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "none" : OFFSET[from],
        transition: `opacity ${duration}ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms, transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms`,
      }}
    >
      {children}
    </Tag>
  );
}
