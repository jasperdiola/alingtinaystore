"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { signOutAction } from "@/app/actions/auth";
import type { AdminRole } from "@/lib/auth/admin";

type Item = { href: string; label: string; icon: string; minRole?: AdminRole };

const RANK: Record<AdminRole, number> = { staff: 1, manager: 2, super_admin: 3 };

/**
 * `minRole` here only hides links. The enforcement is requireRole() inside the
 * pages themselves — a missing nav item stops nobody from typing the URL.
 */
const ITEMS: Item[] = [
  { href: "/admin", label: "Dashboard", icon: "▦", minRole: "manager" },
  { href: "/admin/pos", label: "Point of Sale", icon: "◉" },
  { href: "/admin/orders", label: "Orders", icon: "☰" },
  { href: "/admin/invoices", label: "Invoices", icon: "🧾" },
  { href: "/admin/inventory", label: "Inventory", icon: "▤" },
  { href: "/admin/invites", label: "Staff & Invites", icon: "✦", minRole: "manager" },
];

const ROLE_LABEL: Record<AdminRole, string> = {
  staff: "Staff",
  manager: "Manager",
  super_admin: "Super admin",
};

const COLLAPSE_KEY = "admin.nav.collapsed";

/**
 * Drawers feel wrong with a symmetric curve. Entering uses a decelerating
 * ease-out so the panel arrives and settles; leaving is shorter and
 * accelerating, because a dismissal that lingers feels unresponsive.
 */
const EASE_IN = "cubic-bezier(0.32, 0.72, 0, 1)";
const ENTER_MS = 280;
const EXIT_MS = 200;

function visibleItems(role: AdminRole) {
  return ITEMS.filter((i) => !i.minRole || RANK[role] >= RANK[i.minRole]);
}

function useIsActive() {
  const pathname = usePathname();
  return (href: string) =>
    // /admin must match exactly, or it lights up on every subpage.
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

/* ------------------------------------------------------------------ links */

function NavLinks({
  role,
  collapsed = false,
  onNavigate,
}: {
  role: AdminRole;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const isActive = useIsActive();

  return (
    <nav className="flex flex-col gap-0.5" aria-label="Admin sections">
      {visibleItems(role).map((item) => {
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            title={collapsed ? item.label : undefined}
            className={`group relative flex items-center gap-3 rounded-lg py-2 text-sm outline-none transition-colors duration-150
              focus-visible:ring-2 focus-visible:ring-amber-500/50
              ${collapsed ? "justify-center px-0" : "px-3"}
              ${
                active
                  ? "bg-neutral-900 font-medium text-white dark:bg-white dark:text-neutral-900"
                  : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              }`}
          >
            <span aria-hidden className="w-4 shrink-0 text-center text-xs opacity-70">
              {item.icon}
            </span>
            {/* Collapsing animates the label out rather than snapping, so the
                icon rail reads as the same nav rather than a different one. */}
            <span
              className="overflow-hidden whitespace-nowrap transition-all duration-200 motion-reduce:transition-none"
              style={{
                width: collapsed ? 0 : "auto",
                opacity: collapsed ? 0 : 1,
              }}
            >
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={`mb-6 flex items-center gap-2.5 ${collapsed ? "justify-center px-0" : "px-1"}`}>
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-lg bg-amber-500 text-xs font-bold text-white"
      >
        AT
      </span>
      <div
        className="overflow-hidden leading-tight transition-all duration-200 motion-reduce:transition-none"
        style={{ width: collapsed ? 0 : "auto", opacity: collapsed ? 0 : 1 }}
      >
        <p className="whitespace-nowrap text-sm font-semibold">Aling Tinay</p>
        <p className="whitespace-nowrap text-[11px] text-neutral-500">Admin</p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- sidebar */

/**
 * Collapse state lives in localStorage, which is an external store — so it is
 * read with useSyncExternalStore rather than an effect. Reading it in an effect
 * and calling setState causes a cascading render, and React now flags it.
 *
 * getServerSnapshot returns false so SSR and the first client render agree
 * (expanded); the stored value is applied immediately after hydration, and the
 * `ready` flag below suppresses the width transition so that lands as a snap
 * rather than an animation on every page load.
 */
const collapseStore = {
  listeners: new Set<() => void>(),
  subscribe(cb: () => void) {
    collapseStore.listeners.add(cb);
    window.addEventListener("storage", cb);
    return () => {
      collapseStore.listeners.delete(cb);
      window.removeEventListener("storage", cb);
    };
  },
  get() {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false; // private mode or blocked storage
    }
  },
  getServer() {
    return false;
  },
  set(v: boolean) {
    try {
      localStorage.setItem(COLLAPSE_KEY, v ? "1" : "0");
    } catch {}
    collapseStore.listeners.forEach((l) => l());
  },
};

export function Sidebar({ role }: { role: AdminRole }) {
  const collapsed = useSyncExternalStore(
    collapseStore.subscribe,
    collapseStore.get,
    collapseStore.getServer
  );
  // Suppresses the width transition on first paint, so a restored collapsed
  // sidebar snaps instead of animating open on every navigation.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // setState lives in the rAF callback, not the effect body.
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => setReady(true))
    );
    return () => cancelAnimationFrame(id);
  }, []);

  const toggle = () => collapseStore.set(!collapsed);

  return (
    <aside
      data-print-hide
      style={{
        width: collapsed ? "4.5rem" : "15rem",
        transitionDuration: ready ? "260ms" : "0ms",
        transitionTimingFunction: EASE_IN,
      }}
      className="hidden shrink-0 flex-col border-r border-neutral-200 bg-white p-3 transition-[width] md:flex motion-reduce:transition-none dark:border-neutral-800 dark:bg-neutral-900"
    >
      <Brand collapsed={collapsed} />
      <NavLinks role={role} collapsed={collapsed} />

      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        className="mt-auto flex items-center justify-center rounded-lg py-2 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
      >
        <span
          aria-hidden
          className="inline-block text-sm transition-transform duration-260 motion-reduce:transition-none"
          style={{ transform: collapsed ? "rotate(180deg)" : "none", transitionTimingFunction: EASE_IN }}
        >
          ‹‹
        </span>
      </button>
    </aside>
  );
}

/* ----------------------------------------------------------------- topbar */

export function Topbar({
  name,
  role,
  title,
}: {
  name: string;
  role: AdminRole;
  title: string;
}) {
  // Two states, not one: `mounted` keeps the drawer in the DOM long enough to
  // animate out. Unmounting on close would make the exit instant.
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setMounted(true);
    // Paint at the off-screen position first, then transition in.
    requestAnimationFrame(() => setShown(true));
  }, []);

  const close = useCallback(() => {
    setShown(false);
    closeTimer.current = setTimeout(() => {
      setMounted(false);
      // Return focus where it came from, or the trigger vanishes under the user.
      triggerRef.current?.focus();
    }, EXIT_MS);
  }, []);

  // Escape closes, and the page behind must not scroll while the drawer is up.
  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [mounted, close]);

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  return (
    <>
      <header
        data-print-hide
        className="sticky top-0 z-30 flex items-center gap-3 border-b border-neutral-200 bg-white/85 px-4 py-3 backdrop-blur md:px-6 dark:border-neutral-800 dark:bg-neutral-900/85"
      >
        <button
          ref={triggerRef}
          type="button"
          onClick={open}
          aria-label="Open navigation"
          aria-expanded={mounted}
          className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm transition-colors hover:bg-neutral-100 md:hidden dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          ☰
        </button>

        <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{title}</h1>

        <div className="hidden min-w-0 text-right sm:block">
          <p className="truncate text-xs font-medium leading-tight">{name}</p>
          <p className="text-[11px] leading-tight text-neutral-500">{ROLE_LABEL[role]}</p>
        </div>

        <form action={signOutAction}>
          <button
            type="submit"
            className="whitespace-nowrap rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Sign out
          </button>
        </form>
      </header>

      {mounted && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          {/* Backdrop fades; the panel slides. Doing both on the panel alone
              makes it read as a card appearing rather than a drawer opening. */}
          <button
            aria-label="Close navigation"
            onClick={close}
            style={{ transitionDuration: shown ? `${ENTER_MS}ms` : `${EXIT_MS}ms` }}
            className={`absolute inset-0 bg-black/40 transition-opacity motion-reduce:transition-none ${
              shown ? "opacity-100" : "opacity-0"
            }`}
          />

          <div
            ref={panelRef}
            tabIndex={-1}
            style={{
              transform: shown ? "translateX(0)" : "translateX(-100%)",
              transitionDuration: shown ? `${ENTER_MS}ms` : `${EXIT_MS}ms`,
              transitionTimingFunction: shown ? EASE_IN : "cubic-bezier(0.4, 0, 1, 1)",
            }}
            className="absolute inset-y-0 left-0 flex w-[17rem] max-w-[85vw] flex-col bg-white p-4 shadow-xl outline-none transition-transform will-change-transform motion-reduce:transition-none dark:bg-neutral-900"
          >
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className="grid size-8 place-items-center rounded-lg bg-amber-500 text-xs font-bold text-white"
                >
                  AT
                </span>
                <div className="leading-tight">
                  <p className="text-sm font-semibold">Aling Tinay</p>
                  <p className="text-[11px] text-neutral-500">{ROLE_LABEL[role]}</p>
                </div>
              </div>
              <button
                onClick={close}
                aria-label="Close navigation"
                className="rounded-md px-2 py-1 text-lg leading-none text-neutral-500 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                ×
              </button>
            </div>

            <NavLinks role={role} onNavigate={close} />

            <p className="mt-auto truncate pt-4 text-[11px] text-neutral-400">{name}</p>
          </div>
        </div>
      )}
    </>
  );
}
