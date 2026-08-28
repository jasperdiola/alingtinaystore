import { createHmac, timingSafeEqual } from "node:crypto";

/** Sign out after this much time with no activity. */
export const IDLE_LIMIT_MS = 5 * 60 * 1000;

/** Show the "you're about to be signed out" warning with this much left. */
export const IDLE_WARN_MS = 60 * 1000;

export const IDLE_COOKIE = "admin_last_seen";

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) {
    // Deliberately loud. Falling back to a default here would silently disable
    // the idle timeout, which is exactly the failure you'd never notice.
    throw new Error(
      "SESSION_SECRET is not set — required to sign the admin idle-timeout cookie."
    );
  }
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** `<timestamp>.<hmac>` — the value stored in the idle cookie. */
export function stampValue(now: number = Date.now()): string {
  const ts = String(now);
  return `${ts}.${sign(ts)}`;
}

/**
 * Verify a stamp and return its timestamp, or null if it is missing,
 * malformed, or not signed by us.
 *
 * The signature is what makes this trustworthy. Without it, anyone with the
 * devtools cookie editor could write a fresh timestamp and never time out —
 * and "someone at an unattended browser" is the entire threat model here.
 */
export function readStamp(raw: string | undefined): number | null {
  if (!raw) return null;

  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;

  const ts = raw.slice(0, dot);
  const provided = raw.slice(dot + 1);
  const expected = sign(ts);

  // timingSafeEqual throws on length mismatch, so check that first.
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
    return null;
  }

  const parsed = Number(ts);
  return Number.isFinite(parsed) ? parsed : null;
}

export function idleCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    // Scoped to /admin so it never rides along on storefront requests.
    path: "/admin",
    secure: process.env.NODE_ENV === "production",
  };
}
