"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { signOutIdleAction } from "@/app/actions/auth";

const IDLE_LIMIT_MS = 5 * 60 * 1000;
const IDLE_WARN_MS = 60 * 1000;
const TICK_MS = 5_000;

const ACTIVITY_EVENTS = [
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
] as const;

/**
 * UX half of the idle timeout. The proxy is what actually enforces it — this
 * exists so the user sees the countdown instead of discovering they were
 * signed out on their next click, and so real typing counts as activity.
 *
 * Never treat this as the security control. It is trivially disabled.
 */
export default function IdleWatcher() {
  const pathname = usePathname();
  const isAuthRoute =
    pathname.startsWith("/admin/login") || pathname.startsWith("/admin/signup");

  // Seeded in the effect, not here: Date.now() during render is impure and a
  // re-render would silently reset the clock.
  const lastActivity = useRef(0);
  const lastBeat = useRef(0);
  const signingOut = useRef(false);
  const [msLeft, setMsLeft] = useState<number | null>(null);

  const markActive = useCallback(() => {
    lastActivity.current = Date.now();
    setMsLeft(null);
  }, []);

  // Reset the clock and tell the server we're still here.
  const staySignedIn = useCallback(() => {
    markActive();
    lastBeat.current = Date.now();
    void fetch("/admin/heartbeat", { cache: "no-store" });
  }, [markActive]);

  useEffect(() => {
    if (isAuthRoute) return;

    lastActivity.current = Date.now();
    lastBeat.current = Date.now();

    // Refs, not state: these fire on every keystroke and must not re-render.
    const onActivity = () => {
      lastActivity.current = Date.now();
    };
    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, onActivity, { passive: true });
    }

    // Coming back to the tab counts as activity.
    const onVisible = () => {
      if (document.visibilityState === "visible") onActivity();
    };
    document.addEventListener("visibilitychange", onVisible);

    const timer = setInterval(() => {
      const idleFor = Date.now() - lastActivity.current;

      if (idleFor >= IDLE_LIMIT_MS) {
        if (signingOut.current) return;
        signingOut.current = true;
        void signOutIdleAction();
        return;
      }

      if (idleFor >= IDLE_LIMIT_MS - IDLE_WARN_MS) {
        setMsLeft(IDLE_LIMIT_MS - idleFor);
        return;
      }

      setMsLeft(null);

      // Heartbeat ONLY when there has been real input since the last beat.
      // A heartbeat on a plain timer would keep an abandoned session alive
      // forever, which is precisely the thing this feature prevents.
      const activeSinceLastBeat = lastActivity.current > lastBeat.current;
      const beatIsStale = Date.now() - lastBeat.current > 60_000;
      if (activeSinceLastBeat && beatIsStale) {
        lastBeat.current = Date.now();
        void fetch("/admin/heartbeat", { cache: "no-store" });
      }
    }, TICK_MS);

    return () => {
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, onActivity);
      }
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [isAuthRoute]);

  if (isAuthRoute || msLeft === null) return null;

  const seconds = Math.max(0, Math.ceil(msLeft / 1000));

  return (
    <div
      role="alertdialog"
      aria-modal="false"
      aria-labelledby="idle-title"
      className="fixed inset-x-0 bottom-0 z-50 p-4 sm:bottom-4 sm:right-4 sm:left-auto sm:p-0"
    >
      <div className="mx-auto max-w-sm rounded-xl border border-amber-300 bg-white p-4 shadow-lg dark:border-amber-800 dark:bg-neutral-900">
        <p id="idle-title" className="text-sm font-semibold">
          Still there?
        </p>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          You&apos;ll be signed out in{" "}
          <span className="font-medium tabular-nums">{seconds}s</span> due to
          inactivity.
        </p>
        <button
          type="button"
          autoFocus
          onClick={staySignedIn}
          className="mt-3 h-9 w-full rounded-lg bg-neutral-900 text-sm font-medium text-white
                     hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-amber-500/40
                     dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          Stay signed in
        </button>
      </div>
    </div>
  );
}
