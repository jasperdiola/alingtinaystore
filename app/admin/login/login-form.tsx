"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signInAction } from "@/app/actions/auth";
import {
  Alert,
  AuthShell,
  Field,
  PasswordField,
  SubmitButton,
} from "../_components/auth-ui";

export default function LoginForm({
  next,
  timedOut = false,
}: {
  next: string;
  timedOut?: boolean;
}) {
  const [state, action, pending] = useActionState(signInAction, null);

  return (
    <AuthShell
      title="Sign in"
      subtitle="Admin access for Aling Tinay Store."
      footer={
        <>
          Need an admin account?{" "}
          <Link
            href="/admin/signup"
            className="font-medium text-amber-700 underline-offset-4 hover:underline dark:text-amber-500"
          >
            Create one
          </Link>
        </>
      }
    >
      <form action={action} noValidate>
        {/* Suppressed once a submit has produced its own message, so the two
            alerts never stack and contradict each other. */}
        {timedOut && !state && (
          <Alert tone="notice">
            You were signed out after 5 minutes of inactivity.
          </Alert>
        )}
        {state?.error && <Alert tone="error">{state.error}</Alert>}

        {/* Where to land after signing in. Server-side validated to be a
            relative path, so this can't be turned into an open redirect. */}
        <input type="hidden" name="next" value={next} />

        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@alingtinay.ph"
          required
          autoFocus
          disabled={pending}
        />

        <PasswordField
          label="Password"
          name="password"
          autoComplete="current-password"
          placeholder="••••••••"
          required
          disabled={pending}
        />

        <div className="mt-6">
          <SubmitButton pending={pending} pendingLabel="Signing in…">
            Sign in
          </SubmitButton>
        </div>
      </form>
    </AuthShell>
  );
}
