"use server";

import { revalidatePath } from "next/cache";
import { type AdminRole, getAdminSession } from "@/lib/auth/admin";
import { prisma } from "@/lib/prisma";

export type StaffActionState = { ok: boolean; message: string } | null;

const ROLES: AdminRole[] = ["staff", "manager", "super_admin"];

/**
 * Changing an existing account is super_admin only, matching your
 * admin_users_super_write RLS policy. A manager can invite a new staff member
 * but cannot promote anyone, including themselves.
 */
async function requireSuperAdmin() {
  const session = await getAdminSession();
  if (!session) return { denied: true as const, message: "You are not signed in." };
  if (session.role !== "super_admin") {
    return { denied: true as const, message: "Only a super admin can change accounts." };
  }
  return { denied: false as const, session };
}

/**
 * Refuses the two changes that lock everybody out.
 *
 * Self-edits are blocked outright rather than conditionally: a super_admin
 * demoting themselves is almost always a misclick, and there is no undo once
 * the privilege is gone.
 */
async function guardLockout(
  targetId: string,
  selfId: string,
  intent: "role" | "deactivate"
): Promise<string | null> {
  if (targetId === selfId) {
    return intent === "role"
      ? "You cannot change your own role. Ask another super admin."
      : "You cannot deactivate your own account.";
  }

  const target = await prisma.admin_users.findUnique({
    where: { id: targetId },
    select: { role: true, is_active: true },
  });
  if (!target) return "That account no longer exists.";

  if (target.role === "super_admin" && target.is_active) {
    const remaining = await prisma.admin_users.count({
      where: { role: "super_admin" as never, is_active: true },
    });
    if (remaining <= 1) {
      return "That is the last active super admin. Promote someone else first.";
    }
  }
  return null;
}

/* ------------------------------------------------------------------- role */

export async function setAdminRoleAction(
  _prev: StaffActionState,
  formData: FormData
): Promise<StaffActionState> {
  const auth = await requireSuperAdmin();
  if (auth.denied) return { ok: false, message: auth.message };

  const id = String(formData.get("id") ?? "");
  const role = String(formData.get("role") ?? "") as AdminRole;

  if (!id) return { ok: false, message: "Missing account." };
  if (!ROLES.includes(role)) return { ok: false, message: "Unknown role." };

  const blocked = await guardLockout(id, auth.session.userId, "role");
  if (blocked) return { ok: false, message: blocked };

  const current = await prisma.admin_users.findUnique({
    where: { id },
    select: { role: true, full_name: true, email: true },
  });
  if (!current) return { ok: false, message: "That account no longer exists." };
  if (current.role === role) {
    return { ok: false, message: `Already ${role.replace("_", " ")}.` };
  }

  await prisma.admin_users.update({ where: { id }, data: { role: role as never } });
  revalidatePath("/admin/invites");

  const who = current.full_name || current.email;
  return { ok: true, message: `${who} is now ${role.replace("_", " ")}.` };
}

/* --------------------------------------------------------------- activate */

export async function setAdminActiveAction(
  _prev: StaffActionState,
  formData: FormData
): Promise<StaffActionState> {
  const auth = await requireSuperAdmin();
  if (auth.denied) return { ok: false, message: auth.message };

  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "1";
  if (!id) return { ok: false, message: "Missing account." };

  // Reactivating can never lock anyone out, so only deactivation is guarded.
  if (!active) {
    const blocked = await guardLockout(id, auth.session.userId, "deactivate");
    if (blocked) return { ok: false, message: blocked };
  }

  const target = await prisma.admin_users.findUnique({
    where: { id },
    select: { full_name: true, email: true, is_active: true },
  });
  if (!target) return { ok: false, message: "That account no longer exists." };
  if (target.is_active === active) {
    return { ok: false, message: `Already ${active ? "active" : "deactivated"}.` };
  }

  await prisma.admin_users.update({ where: { id }, data: { is_active: active } });
  revalidatePath("/admin/invites");

  const who = target.full_name || target.email;
  return {
    ok: true,
    message: active
      ? `${who} can sign in again.`
      : `${who} deactivated. Their next request signs them out.`,
  };
}
