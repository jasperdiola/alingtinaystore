import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  IDLE_COOKIE,
  IDLE_LIMIT_MS,
  idleCookieOptions,
  readStamp,
  stampValue,
} from "@/lib/auth/idle";

/**
 * Next.js 16 renamed `middleware.ts` to `proxy.ts` and the exported function
 * from `middleware` to `proxy`. Every Supabase tutorial still says middleware —
 * the code is the same, the filename and export are not.
 *
 * Two jobs, and only two:
 *
 *  1. Refresh the Supabase auth token and write the rotated cookies onto the
 *     response. Server Components cannot set cookies, so without this the
 *     session would silently expire mid-session.
 *  2. An OPTIMISTIC redirect — bounce anonymous visitors away from /admin.
 *
 * Deliberately NOT here: the `admin_users` lookup. Next's guidance is that
 * proxy runs on every matched request including prefetches, so it should read
 * the session and nothing more. The real authorization decision lives in
 * lib/auth/admin.ts, next to the data. Treat this as a redirect for humans,
 * never as the thing that keeps people out.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Do not remove: this call is what performs the token refresh.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Reachable without a session. /admin/invite belongs here because accepting
  // an invitation necessarily happens before the invitee is signed in.
  const isPublic =
    pathname.startsWith("/admin/login") ||
    pathname.startsWith("/admin/signup") ||
    pathname.startsWith("/admin/invite");

  // Sign-in pages proper. /admin/invite is deliberately excluded: the emailed
  // path establishes a Supabase session *during* the flow (to set a password),
  // so bouncing a signed-in visitor to /admin here would strand them with an
  // account that has no password and no admin_users row.
  const isSignInPage =
    pathname.startsWith("/admin/login") || pathname.startsWith("/admin/signup");

  // Anonymous visitor heading into the admin area → send to login, remembering
  // where they were going so we can return them there afterwards.
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Already signed in but sitting on login/signup → skip straight to /admin.
  if (user && isSignInPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // ---- Idle timeout (authoritative). Applies to every role, no exemptions.
  // Skipped on the invite routes: a half-onboarded invitee has a session but
  // no stamp yet, and "no stamp means expired" would sign them out mid-flow.
  if (user && !isPublic) {
    const now = Date.now();
    const lastSeen = readStamp(request.cookies.get(IDLE_COOKIE)?.value);

    // `null` covers missing, malformed AND forged stamps. Treating a missing
    // stamp as "start the clock now" would mean deleting the cookie buys
    // another 5 minutes, forever — so absent counts as expired. signInAction
    // is what plants the first stamp.
    const expired = lastSeen === null || now - lastSeen > IDLE_LIMIT_MS;

    if (expired) {
      // Revokes the refresh token at Supabase, not just locally. This writes
      // its cookie-clearing headers onto `response` via the setAll callback.
      await supabase.auth.signOut();

      const url = request.nextUrl.clone();
      url.pathname = "/admin/login";
      url.search = "";
      url.searchParams.set("reason", "timeout");

      const redirect = NextResponse.redirect(url);
      // Carry over the cookies signOut() just wrote. Returning a fresh
      // response without this silently discards them and leaves the user
      // signed in — the whole feature would look like it works and not.
      for (const cookie of response.cookies.getAll()) {
        redirect.cookies.set(cookie);
      }
      redirect.cookies.delete({ name: IDLE_COOKIE, path: "/admin" });
      return redirect;
    }

    // Still active — push the deadline out. Any request to /admin counts,
    // including the heartbeat the client sends while the user is typing.
    response.cookies.set(IDLE_COOKIE, stampValue(now), idleCookieOptions());
  }

  return response;
}

export const config = {
  // `:path*` also matches bare /admin.
  matcher: ["/admin/:path*"],
};
