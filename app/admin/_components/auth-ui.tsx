"use client";

import { useId, useState } from "react";

/* ------------------------------------------------------------------ shell */

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="grid min-h-dvh place-items-center bg-neutral-50 px-4 py-10 dark:bg-neutral-950">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <span
            aria-hidden
            className="grid size-10 place-items-center rounded-xl bg-amber-500 text-sm font-bold tracking-tight text-white"
          >
            AT
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold">Aling Tinay Store</p>
            <p className="text-xs text-neutral-500">Admin</p>
          </div>
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white p-7 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-neutral-500">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </div>

        {footer && (
          <p className="mt-5 text-center text-sm text-neutral-500">{footer}</p>
        )}
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ alert */

export function Alert({
  tone,
  children,
}: {
  tone: "error" | "notice";
  children: React.ReactNode;
}) {
  const styles =
    tone === "error"
      ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
      : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200";

  return (
    // aria-live so screen readers announce the result of a submit without
    // the user having to go hunting for what changed.
    <p
      role="alert"
      aria-live="polite"
      className={`mb-4 rounded-lg border px-3 py-2 text-sm ${styles}`}
    >
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------ field */

const inputBase =
  "h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition " +
  "placeholder:text-neutral-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/30 " +
  "disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-950";

export function Field({
  label,
  name,
  type = "text",
  hint,
  ...rest
}: {
  label: string;
  name: string;
  type?: string;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        aria-describedby={hintId}
        className={inputBase}
        {...rest}
      />
      {hint && (
        <p id={hintId} className="mt-1.5 text-xs text-neutral-500">
          {hint}
        </p>
      )}
    </div>
  );
}

export function PasswordField({
  label,
  name,
  hint,
  ...rest
}: {
  label: string;
  name: string;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const [visible, setVisible] = useState(false);

  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          aria-describedby={hintId}
          className={`${inputBase} pr-16`}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={visible ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      {hint && (
        <p id={hintId} className="mt-1.5 text-xs text-neutral-500">
          {hint}
        </p>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- button */

export function SubmitButton({
  pending,
  children,
  pendingLabel,
}: {
  pending: boolean;
  children: React.ReactNode;
  pendingLabel: string;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-10 w-full rounded-lg bg-neutral-900 text-sm font-medium text-white transition
                 hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-900/30
                 disabled:cursor-not-allowed disabled:opacity-60
                 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
