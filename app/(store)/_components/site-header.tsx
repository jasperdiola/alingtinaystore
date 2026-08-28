"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CartButton } from "./cart-ui";
import { MenuIcon, XIcon } from "./icons";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/shop", label: "Shop" },
];

/**
 * Fixed storefront header.
 *
 * Client-side for the mobile drawer and the active-link state, both of which
 * need the current path. It takes its content as props so the brand name and
 * phone number still come from the database rather than being hardcoded in a
 * client bundle.
 */
export default function SiteHeader({
  brandName,
  phone,
  phoneE164,
}: {
  brandName: string;
  phone: string;
  phoneE164: string;
}) {
  const pathname = usePathname();

  /*
   * The drawer stores WHICH path it was opened on, and is open only while the
   * current path still matches. Navigating therefore closes it for free.
   *
   * The obvious version — a boolean plus an effect that resets it when the
   * pathname changes — is a setState inside an effect: it renders the drawer
   * open over the new page, then immediately re-renders to close it. Deriving
   * the value during render skips that entirely.
   */
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const open = openedAt === pathname;
  const setOpen = (next: boolean) => setOpenedAt(next ? pathname : null);

  // A drawer over a scrollable page scrolls the page behind it on iOS.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // setOpenedAt directly, not the setOpen wrapper: the wrapper is a new
    // function each render, so depending on it would re-run this effect (and
    // rebind the listener) on every single render.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenedAt(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-gray-100 bg-white/95 shadow-sm backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-3 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between lg:h-20">
          <Link href="/" className="flex items-center gap-2 py-1">
            <span className="grid size-8 place-items-center rounded-lg bg-roasted text-sm font-bold text-cream lg:size-10 lg:text-base">
              A
            </span>
            <span className="text-base font-bold tracking-tight text-gray-900 lg:text-lg">
              {brandName}
            </span>
          </Link>

          <nav className="hidden items-center gap-6 md:flex" aria-label="Main">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                aria-current={isActive(l.href) ? "page" : undefined}
                className={`text-sm font-medium transition-colors ${
                  isActive(l.href)
                    ? "text-peanut"
                    : "text-gray-600 hover:text-peanut"
                }`}
              >
                {l.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-1">
            <CartButton />
            <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            // 44px is the minimum comfortable touch target; the icon alone is 20.
            className="flex min-h-[44px] min-w-[44px] items-center justify-center p-2.5 text-gray-500 transition-colors hover:text-peanut md:hidden"
          >
            {open ? (
              <XIcon className="h-5 w-5" title="Close menu" />
            ) : (
              <MenuIcon className="h-5 w-5" title="Open menu" />
            )}
            </button>
          </div>
        </div>
      </div>

      {/*
        Rendered always and collapsed with grid-template-rows so the drawer can
        animate its height without a magic pixel value, and so its links stay in
        the DOM for search engines. inert keeps them out of the tab order while
        it is closed.
      */}
      <div
        id="mobile-nav"
        inert={!open}
        className={`grid overflow-hidden border-t border-gray-100 bg-white transition-[grid-template-rows,opacity] duration-300 ease-out md:hidden ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <nav className="min-h-0" aria-label="Mobile">
          <ul className="px-3 py-2">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  aria-current={isActive(l.href) ? "page" : undefined}
                  className={`block rounded-lg px-3 py-3 text-sm font-medium ${
                    isActive(l.href)
                      ? "bg-peanut/10 text-peanut"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {l.label}
                </Link>
              </li>
            ))}
            <li className="px-3 pb-2 pt-1">
              <a
                href={`tel:${phoneE164}`}
                className="block rounded-full bg-peanut px-4 py-3 text-center text-sm font-semibold text-white"
              >
                Call {phone}
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
