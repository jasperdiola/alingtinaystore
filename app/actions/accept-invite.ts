"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { IDLE_COOKIE, idleCookieOptions, stampValue } from "@/lib/auth/idle";
import { prisma } from "@/lib/prisma";
import { findUsableInvite } from "@/lib/queries/invites";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AcceptState = { error?: string } | null;

/**
 * Finishes the emailed-invite path.
 *
 * By this point Supabase has already created the auth.users row (that's what
 * inviteUserByEmail does) and the accept route exchanged the emailed code for
 * a session. So the account exists but has no password and no admin_users row.
 * This sets both.
 */
export async function acceptInviteAction(
  _prev: AcceptState,
  formData: FormData
): Promise<AcceptState> {
  const token = String(formData.get("token") ?? "").trim();
  const fullName = String(formData.get("fullName") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");

  if (!fullName) return { error: "Enter your full name." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  if (password !== confirm) return { error: "Passwords do not match." };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Your invite link has expired. Ask for a new one." };
  }

  const invite = await findUsableInvite(token);
  if (!invite) {
    return { error: "That invite is no longer valid. Ask for a new one." };
  }

  // The signed-in identity must be the person who was invited. Without this,
  // anyone with a session could redeem someone else's invite and inherit its
  // role.
  if ((user.email ?? "").toLowerCase() !== invite.email) {
    return { error: `This invite is for ${invite.email}.` };
  }

  const { error: pwError } = await supabase.auth.updateUser({ password });
  if (pwError) return { error: pwError.message };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.admin_users.create({
        data: {
          id: user.id,
          email: invite.email,
          full_name: fullName,
          role: invite.role,
          store_id: invite.store_id,
        },
      });
      await tx.staff_invites.update({
        where: { id: invite.id },
        data: { accepted_at: new Date() },
      });
    });
  } catch {
    return {
      error: "Password saved, but granting access failed. Try signing in, or ask an administrator.",
    };
  }

  const cookieStore = await cookies();
  cookieStore.set(IDLE_COOKIE, stampValue(), idleCookieOptions());

  redirect("/admin");
}
