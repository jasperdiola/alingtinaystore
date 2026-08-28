"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signUpAction } from "@/app/actions/auth";
import {
  Alert,
  AuthShell,
  Field,
  PasswordField,
  SubmitButton,
} from "../_components/auth-ui";

export type InviteInfo = { token: string; email: string; role: string };

export default function SignupForm({
  invite = null,
  inviteRejected = false,
}: {
  invite?: InviteInfo | null;
  inviteRejected?: boolean;
}) {
  const [state, action, pending] = useActionState(signUpAction, null);

  const roleLabel = invite ? invite.role.replace("_", " ") : "Staff";

  return (
    <AuthShell
      title={invite ? "Accept your invitation" : "Create staff account"}
      subtitle={
        invite
          ? `You've been invited as ${roleLabel}. Set a password to activate your account.`
          : "Invite only. New accounts are created with Staff access — an administrator can raise your role afterwards."
      }
      footer={
        <>
          Already have an account?{" "}
          <Link
            href="/admin/login"
            className="font-medium text-amber-700 underline-offset-4 hover:underline dark:text-amber-500"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form action={action} noValidate>
        {inviteRejected && !state && (
          <Alert tone="error">
            That invitation link is invalid, expired, or already used. Ask an
            administrator for a new one.
          </Alert>
        )}
        {state?.error && <Alert tone="error">{state.error}</Alert>}
        {state?.notice && <Alert tone="notice">{state.notice}</Alert>}

        {invite ? (
          // The token carries the role; the address is fixed server-side too,
          // so editing this field would just fail validation.
          <input type="hidden" name="invite" value={invite.token} />
        ) : (
          <>
            <Field
              label="Invite code"
              name="code"
              type="password"
              autoComplete="off"
              placeholder="Provided by an administrator"
              hint="This page is unlisted, but the code is what actually restricts it."
              required
              autoFocus
              disabled={pending}
            />
            <hr className="mb-4 border-neutral-200 dark:border-neutral-800" />
          </>
        )}

        <Field
          label="Full name"
          name="fullName"
          autoComplete="name"
          placeholder="Juan dela Cruz"
          required
          autoFocus={Boolean(invite)}
          disabled={pending}
        />

        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@alingtinay.ph"
          defaultValue={invite?.email}
          readOnly={Boolean(invite)}
          hint={invite ? "Fixed by your invitation." : undefined}
          required
          disabled={pending}
        />

        <PasswordField
          label="Password"
          name="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          hint="Minimum 8 characters."
          minLength={8}
          required
          disabled={pending}
        />

        <PasswordField
          label="Confirm password"
          name="confirmPassword"
          autoComplete="new-password"
          placeholder="Re-enter your password"
          required
          disabled={pending}
        />

        <div className="mt-6">
          <SubmitButton pending={pending} pendingLabel="Creating account…">
            {invite ? "Activate account" : "Create account"}
          </SubmitButton>
        </div>
      </form>
    </AuthShell>
  );
}
