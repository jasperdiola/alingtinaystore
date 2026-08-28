import "server-only";
import { createClient } from "@supabase/supabase-js";

export type SendResult =
  | { sent: true }
  | { sent: false; reason: string };

/**
 * Send the invitation email via Supabase Auth.
 *
 * This uses the ADMIN API (`auth.admin.inviteUserByEmail`), which needs the
 * service_role key — a secret that bypasses RLS entirely. It must never reach
 * the browser, so there is no NEXT_PUBLIC_ prefix and this module is
 * server-only.
 *
 * Two things to know about this call:
 *
 *  1. It creates the auth.users row itself, with no password. The invitee sets
 *     one after clicking through. That's why the accept flow doesn't call
 *     signUp() — the account already exists by then.
 *  2. It goes out through Supabase's built-in SMTP, which is heavily
 *     rate-limited (a handful per hour). For real use, attach your own SMTP
 *     provider under Project Settings -> Auth -> SMTP.
 *
 * Delivery is best-effort by design: the caller still gets a usable invite link
 * when this fails, so a mail outage never blocks onboarding.
 */
export async function sendInviteEmail(
  email: string,
  redirectTo: string
): Promise<SendResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    return {
      sent: false,
      reason:
        "SUPABASE_SERVICE_ROLE_KEY is not set — share the invite link manually.",
    };
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
  });

  if (error) {
    // Surfaced to the admin rather than thrown: the invite row already exists
    // and the link still works, so this is a warning, not a failure.
    return { sent: false, reason: error.message };
  }

  return { sent: true };
}
