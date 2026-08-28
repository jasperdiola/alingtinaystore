import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase client bound to the request's cookies.
 *
 * Use this in Server Components, Server Actions and Route Handlers. The auth
 * session lives in cookies, so the client has to read and write them rather
 * than hold state in memory.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Components are not allowed to set cookies — Next throws
            // here. That's fine: proxy.ts refreshes the session on every
            // /admin request, so the refreshed token is already persisted.
            // Only swallow this in a read path; Server Actions CAN set cookies
            // and will not hit this branch.
          }
        },
      },
    }
  );
}
