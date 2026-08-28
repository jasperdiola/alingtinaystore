"use client";

import { useActionState } from "react";
import { acceptInviteAction } from "@/app/actions/accept-invite";
import {
  Alert,
  AuthShell,
  Field,
  PasswordField,
  SubmitButton,
} from "../../_components/auth-ui";

export default function SetPasswordForm({
  token,
  email,
  role,
}: {
  token: string;
  email: string;
  role: string;
}) {
  const [state, action, pending] = useActionState(acceptInviteAction, null);

  return (
    <AuthShell
      title="Finish setting up"
      subtitle={`You were invited as ${role.replace("_", " ")}. Choose a password to activate your account.`}
    >
      <form action={action} noValidate>
        {state?.error && <Alert tone="error">{state.error}</Alert>}

        <input type="hidden" name="token" value={token} />

        <Field
          label="Email"
          name="emailDisplay"
          type="email"
          defaultValue={email}
          readOnly
          disabled
          hint="Fixed by your invitation."
        />

        <Field
          label="Full name"
          name="fullName"
          autoComplete="name"
          placeholder="Juan dela Cruz"
          required
          autoFocus
          disabled={pending}
        />

        <PasswordField
          label="Password"
          name="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
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
          <SubmitButton pending={pending} pendingLabel="Activating…">
            Activate account
          </SubmitButton>
        </div>
      </form>
    </AuthShell>
  );
}
