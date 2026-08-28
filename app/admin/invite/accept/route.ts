import { NextResponse, type NextRequest } from "next/server";
import { describeInvite, findUsableInvite } from "@/lib/queries/invites";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Entry point for an invite link. Two ways to arrive here:
 *
 *  A. From Supabase's invite email. Supabase verifies first, then redirects
 *     with `?code=...`. inviteUserByEmail already created the auth.users row,
 *     so the invitee has an account with no password — exchange the code for a
 *     session and send them to set one.
 *
 *  B. From a link an admin copied and sent by hand, when email delivery wasn't
 *     configured or was rate-limited. No Supabase account exists yet, so send
 *     them through the normal sign-up form with the email locked to the invite.
 *
 * Either way `token` is OUR invite token, distinct from Supabase's `code`.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const token = searchParams.get("token") ?? "";
  const code = searchParams.get("code");

  const invite = await findUsableInvite(token);

  if (!invite) {
    // Say *why* it failed rather than a flat "invalid".
    const status = token ? await describeInvite(token) : "unknown";
    const reason =
      status === "accepted"
        ? "already-accepted"
        : status === "revoked"
          ? "revoked"
          : status === "expired"
            ? "expired"
            : "invalid";
    return NextResponse.redirect(`${origin}/admin/login?invite=${reason}`);
  }

  // Path A — arrived via Supabase's email.
  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(`${origin}/admin/login?invite=invalid`);
    }
    return NextResponse.redirect(
      `${origin}/admin/invite/set-password?token=${encodeURIComponent(token)}`
    );
  }

  // Path B — link shared manually.
  return NextResponse.redirect(
    `${origin}/admin/signup?invite=${encodeURIComponent(token)}`
  );
}
