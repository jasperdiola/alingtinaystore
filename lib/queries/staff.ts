import "server-only";
import type { AdminRole } from "@/lib/auth/admin";
import { getAdminSession } from "@/lib/auth/admin";
import { prisma } from "@/lib/prisma";

export type StaffMember = {
  id: string;
  email: string;
  fullName: string;
  role: AdminRole;
  store: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  /** True for the signed-in admin, so the UI can refuse self-edits. */
  isSelf: boolean;
};

export async function listStaff(): Promise<StaffMember[]> {
  const session = await getAdminSession();
  if (!session) return [];

  const rows = await prisma.admin_users.findMany({
    orderBy: [{ is_active: "desc" }, { created_at: "asc" }],
    select: {
      id: true,
      email: true,
      full_name: true,
      role: true,
      is_active: true,
      last_login_at: true,
      created_at: true,
      stores: { select: { name: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    fullName: r.full_name,
    role: r.role as AdminRole,
    store: r.stores?.name ?? null,
    isActive: r.is_active,
    lastLoginAt: r.last_login_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
    isSelf: r.id === session.userId,
  }));
}

/**
 * How many active super_admins exist.
 *
 * The UI uses this to refuse the change that locks everyone out: demoting or
 * deactivating the last one. The action re-checks — this is only so the button
 * can explain itself before you press it.
 */
export async function countActiveSuperAdmins(): Promise<number> {
  return prisma.admin_users.count({
    where: { role: "super_admin" as never, is_active: true },
  });
}

export async function getStoreChoices() {
  return prisma.stores.findMany({
    where: { is_active: true },
    orderBy: { display_order: "asc" },
    select: { id: true, name: true },
  });
}
