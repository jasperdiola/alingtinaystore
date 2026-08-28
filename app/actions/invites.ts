"use server";

import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { type AdminRole, getAdminSession } from "@/lib/auth/admin";
import { sendInviteEmail } from "@/lib/email/invite";
import { prisma } from "@/lib/prisma";

export type InviteState =
  | { ok: true; message: string; link: string }
  | { ok: false; message: string }
  | null;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES: AdminRole[] = ["staff", "manager", "super_admin"];

/**
 * Who may invite whom.
 *
 * staff       — cannot invite at all.
 * manager     — may invite staff only.
 * super_admin — may invite any role.
 *
 * Enforced here rather than in the form, because a Server Action is reachable
 * by direct POST. A manager crafting a request with role=super_admin is exactly
 * the privilege-escalation this blocks.
 */
function mayInvite(actor: AdminRole, target: AdminRole): boolean {
  if (actor === "super_admin") return true;
  if (actor === "manager") return target === "staff";
  return false;
}

async function inviteBaseUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");

  // Fall back to the request's own host so this works in dev and on preview
  // deployments without extra configuration.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/* ------------------------------------------------------------------ CREATE */

export async function createInviteAction(
  _prev: InviteState,
  formData: FormData
): Promise<InviteState> {
  const session = await getAdminSession();
  if (!session) return { ok: false, message: "You are not signed in." };

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "staff") as AdminRole;
  const storeIdRaw = String(formData.get("storeId") ?? "").trim();
  const storeId = storeIdRaw === "" ? null : storeIdRaw;

  if (!EMAIL.test(email)) return { ok: false, message: "Enter a valid email address." };
  if (!ROLES.includes(role)) return { ok: false, message: "Unknown role." };
  if (!mayInvite(session.role, role)) {
    return {
      ok: false,
      message: `Your role (${session.role}) cannot invite a ${role}.`,
    };
  }

  // Already an admin? Inviting again would fail at the auth layer anyway.
  const existing = await prisma.admin_users.findFirst({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    return { ok: false, message: `${email} already has an admin account.` };
  }

  // 32 bytes -> 43 url-safe chars, comfortably over the length check
  // the database enforces on this column.
  const token = randomBytes(32).toString("base64url");

  try {
    await prisma.staff_invites.create({
      data: {
        email,
        role,
        token,
        store_id: storeId,
        invited_by: session.userId,
      },
    });
  } catch {
    // The partial unique index allows only one live invite per address.
    return {
      ok: false,
      message: `There is already a pending invite for ${email}. Revoke it first, or resend it.`,
    };
  }

  const link = `${await inviteBaseUrl()}/admin/invite/accept?token=${token}`;
  const delivery = await sendInviteEmail(email, link);

  revalidatePath("/admin");

  return {
    ok: true,
    link,
    message: delivery.sent
      ? `Invite sent to ${email}. It expires in 7 days.`
      : `Invite created for ${email}, but the email was not sent (${delivery.reason}) — share the link below instead.`,
  };
}

/* ------------------------------------------------------------------ REVOKE */

export async function revokeInviteAction(
  _prev: InviteState,
  formData: FormData
): Promise<InviteState> {
  const session = await getAdminSession();
  if (!session) return { ok: false, message: "You are not signed in." };
  if (session.role === "staff") {
    return { ok: false, message: "Staff cannot manage invites." };
  }

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, message: "Missing invite id." };

  const invite = await prisma.staff_invites.findUnique({
    where: { id },
    select: { email: true, role: true, accepted_at: true },
  });
  if (!invite) return { ok: false, message: "That invite no longer exists." };
  if (invite.accepted_at) {
    return {
      ok: false,
      message: "That invite was already accepted — deactivate the admin account instead.",
    };
  }
  if (!mayInvite(session.role, invite.role as AdminRole)) {
    return { ok: false, message: "You cannot manage an invite for that role." };
  }

  await prisma.staff_invites.update({
    where: { id },
    data: { revoked_at: new Date() },
  });

  revalidatePath("/admin");
  return { ok: true, link: "", message: `Invite for ${invite.email} revoked.` };
}

/* ------------------------------------------------------------------ RESEND */

export async function resendInviteAction(
  _prev: InviteState,
  formData: FormData
): Promise<InviteState> {
  const session = await getAdminSession();
  if (!session) return { ok: false, message: "You are not signed in." };
  if (session.role === "staff") {
    return { ok: false, message: "Staff cannot manage invites." };
  }

  const id = String(formData.get("id") ?? "");
  const invite = await prisma.staff_invites.findUnique({
    where: { id },
    select: { email: true, token: true, accepted_at: true, revoked_at: true },
  });

  if (!invite) return { ok: false, message: "That invite no longer exists." };
  if (invite.accepted_at) return { ok: false, message: "That invite was already accepted." };
  if (invite.revoked_at) return { ok: false, message: "That invite was revoked." };

  // Push the expiry out so a resent invite is actually usable.
  await prisma.staff_invites.update({
    where: { id },
    data: { expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
  });

  const link = `${await inviteBaseUrl()}/admin/invite/accept?token=${invite.token}`;
  const delivery = await sendInviteEmail(invite.email, link);

  revalidatePath("/admin");
  return {
    ok: true,
    link,
    message: delivery.sent
      ? `Invite resent to ${invite.email}.`
      : `Expiry extended, but the email was not sent (${delivery.reason}) — share the link below.`,
  };
}
