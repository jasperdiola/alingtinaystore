import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { findUsableInvite } from "@/lib/queries/invites";
import SetPasswordForm from "./set-password-form";

export const metadata: Metadata = {
  title: "Finish setting up · Aling Tinay Admin",
  robots: { index: false, follow: false },
};

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const invite = await findUsableInvite(token ?? "");

  // Re-checked here as well as in the accept route: this page is reachable
  // directly, and the action re-checks again before writing anything.
  if (!invite) redirect("/admin/login?invite=invalid");

  return (
    <SetPasswordForm
      token={token!}
      email={invite.email}
      role={invite.role}
    />
  );
}
