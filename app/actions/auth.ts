"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { AdminRole } from "@/lib/auth/admin";
import { IDLE_COOKIE, idleCookieOptions, stampValue } from "@/lib/auth/idle";
import { prisma } from "@/lib/prisma";
import { findUsableInvite } from "@/lib/queries/invites";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AuthState = { error?: string; notice?: string } | null;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Only allow relative paths, so `?next=` can't be used as an open redirect. */
function safeNext(raw: FormDataEntryValue | null): string {
  const v = typeof raw === "string" ? raw : "";
  return v.startsWith("/") && !v.startsWith("//") ? v : "/admin";
}

/* -------------------------------------------------------------- SIGN IN */

export async function signInAction(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  if (!EMAIL.test(email)) return { error: "Enter a valid email address." };
  if (!password) return { error: "Enter your password." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    // One message for both "no such account" and "wrong password". Telling
    // them apart would let anyone enumerate which emails are admins.
    return { error: "Incorrect email or password." };
  }

  // Authenticated is not authorized. A Supabase Auth account only becomes an
  // admin if it has a matching, active row in admin_users.
  const admin = await prisma.admin_users.findUnique({
    where: { id: data.user.id },
    select: { is_active: true },
  });

  if (!admin || !admin.is_active) {
    await supabase.auth.signOut();
    return {
      error: admin
        ? "This admin account has been deactivated."
        : "This account does not have admin access.",
    };
  }

  await prisma.admin_users.update({
    where: { id: data.user.id },
    data: { last_login_at: new Date() },
  });

  // Plant the first idle stamp. The proxy treats a valid Supabase session with
  // no stamp as expired, so without this line you'd be signed out immediately.
  const cookieStore = await cookies();
  cookieStore.set(IDLE_COOKIE, stampValue(), idleCookieOptions());

  // redirect() throws a control-flow signal — it must not sit inside a
  // try/catch, or the framework's own exception gets swallowed.
  redirect(next);
}

/* -------------------------------------------------------------- SIGN UP */

export async function signUpAction(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const fullName = String(formData.get("fullName") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");
  const inviteToken = String(formData.get("invite") ?? "").trim();

  // Two ways in. A personal invite carries its own role and locks the address;
  // the shared code is the fallback and can only ever produce staff.
  let grantedRole: AdminRole = "staff";
  let grantedStoreId: string | null = null;
  let inviteId: string | null = null;

  if (inviteToken) {
    const invite = await findUsableInvite(inviteToken);
    if (!invite) {
      return { error: "That invite link is no longer valid. Ask for a new one." };
    }
    // The address is fixed by the invite. Otherwise anyone holding a link for
    // one person could use it to create an account under another address.
    if (email !== invite.email) {
      return { error: `This invite is for ${invite.email}.` };
    }
    grantedRole = invite.role as AdminRole;
    grantedStoreId = invite.store_id;
    inviteId = invite.id;
  } else {
    const expected = process.env.ADMIN_SIGNUP_CODE;
    if (!expected) {
      return { error: "Sign-up is closed. Ask an administrator to invite you." };
    }
    const code = String(formData.get("code") ?? "");
    if (code !== expected) return { error: "That invite code is not valid." };
  }

  if (!fullName) return { error: "Enter your full name." };
  if (!EMAIL.test(email)) return { error: "Enter a valid email address." };
  if (password.length < 8)
    return { error: "Password must be at least 8 characters." };
  if (password !== confirm) return { error: "Passwords do not match." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error || !data.user) {
    return { error: error?.message ?? "Could not create that account." };
  }

  try {
    // Both writes together: granting access and burning the invite must not
    // come apart, or a link could be redeemed twice.
    await prisma.$transaction(async (tx) => {
      await tx.admin_users.create({
        data: {
          id: data.user!.id, // must equal auth.users.id — that FK is the link
          email,
          full_name: fullName,
          // Never read from the form. Without an invite this is always
          // "staff"; with one it comes from the invite record, which only an
          // authorised admin could create.
          role: grantedRole,
          store_id: grantedStoreId,
        },
      });

      if (inviteId) {
        await tx.staff_invites.update({
          where: { id: inviteId },
          data: { accepted_at: new Date() },
        });
      }
    });
  } catch {
    return {
      error:
        "Account created, but granting admin access failed. It may already exist — try signing in.",
    };
  }

  // With "Confirm email" enabled in Supabase (the default), signUp returns no
  // session and the user must click the emailed link before they can sign in.
  if (!data.session) {
    return {
      notice:
        "Account created. Check your email for a confirmation link, then sign in.",
    };
  }

  redirect("/admin");
}

/* ------------------------------------------------------------- SIGN OUT */

export async function signOutAction() {
  await clearSession();
  redirect("/admin/login");
}

/** Called by the client idle watcher when the inactivity limit is reached. */
export async function signOutIdleAction() {
  await clearSession();
  redirect("/admin/login?reason=timeout");
}

async function clearSession() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  const cookieStore = await cookies();
  cookieStore.delete({ name: IDLE_COOKIE, path: "/admin" });
}
