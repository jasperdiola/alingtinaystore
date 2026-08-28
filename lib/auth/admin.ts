import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AdminRole = "staff" | "manager" | "super_admin";

export type AdminSession = {
  userId: string;
  email: string;
  fullName: string;
  role: AdminRole;
  storeId: string | null;
};

const RANK: Record<AdminRole, number> = {
  staff: 1,
  manager: 2,
  super_admin: 3,
};

/**
 * The single source of truth for "who is signed in, and are they an admin".
 *
 * Two lookups, and both matter:
 *
 *  1. `supabase.auth.getUser()` — revalidates the JWT against Supabase's auth
 *     server. Never use `getSession()` for an authorization decision: it only
 *     decodes the cookie, which the client controls and can forge.
 *  2. `admin_users` — being a Supabase Auth user does NOT make you an admin.
 *     Anyone who signs up exists in auth.users; only a row here grants access.
 *
 * Wrapped in React.cache so calling it in a layout and again in a page costs
 * one round trip per request, not two.
 */
export const getAdminSession = cache(async (): Promise<AdminSession | null> => {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = await prisma.admin_users.findUnique({
    where: { id: user.id },
    select: {
      id: true,
      email: true,
      full_name: true,
      role: true,
      store_id: true,
      is_active: true,
    },
  });

  // No row, or deactivated — authenticated but not authorized.
  if (!admin || !admin.is_active) return null;

  return {
    userId: admin.id,
    email: admin.email,
    fullName: admin.full_name,
    role: admin.role as AdminRole,
    storeId: admin.store_id,
  };
});

/** Mirrors your admin_at_least() SQL helper, for checks in application code. */
export async function adminAtLeast(minimum: AdminRole): Promise<boolean> {
  const session = await getAdminSession();
  return session ? RANK[session.role] >= RANK[minimum] : false;
}

/**
 * Where a role belongs when it lands on the admin area with nowhere specific
 * to go. Staff cannot see the dashboard, so /admin is not their home — the
 * register is.
 */
export function landingFor(role: AdminRole): string {
  return role === "staff" ? "/admin/pos" : "/admin";
}

/**
 * Page-level guard for sections a role must not reach.
 *
 * This is the enforcement; hiding the nav link is only tidiness. A staff
 * member who types /admin, follows a bookmark, or is sent a link still has to
 * come through here. Kept per-page rather than in the shell layout because a
 * Server Component layout has no reliable view of the pathname.
 */
export async function requireRole(minimum: AdminRole): Promise<AdminSession> {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login?next=/admin");
  if (RANK[session.role] < RANK[minimum]) redirect(landingFor(session.role));
  return session;
}
