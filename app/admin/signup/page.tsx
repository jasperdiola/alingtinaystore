import type { Metadata } from "next";
import { findUsableInvite } from "@/lib/queries/invites";
import SignupForm from "./signup-form";

export const metadata: Metadata = {
  title: "Create staff account · Aling Tinay",
  robots: { index: false, follow: false },
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const { invite: token } = await searchParams;

  // With a valid invite the address and role are fixed by the invitation and
  // the shared code isn't asked for. Without one, fall back to the shared-code
  // flow, which can only ever create staff.
  const invite = token ? await findUsableInvite(token) : null;

  return (
    <SignupForm
      invite={
        invite
          ? { token: token!, email: invite.email, role: invite.role }
          : null
      }
      inviteRejected={Boolean(token) && !invite}
    />
  );
}
