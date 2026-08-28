"use client";

import { useActionState, useState } from "react";
import { createInviteAction, type InviteState } from "@/app/actions/invites";

/**
 * Send an invitation.
 *
 * The role list is narrowed to what this admin may actually grant — a manager
 * can only invite staff. mayInvite() in the action enforces it regardless; this
 * just avoids offering a choice that would be rejected.
 */
export default function InviteForm({
  canGrantAnyRole,
  stores,
}: {
  canGrantAnyRole: boolean;
  stores: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(createInviteAction, null as InviteState);
  const [copied, setCopied] = useState(false);

  const field =
    "h-9 w-full rounded-lg border border-neutral-300 px-2 text-sm dark:border-neutral-700 dark:bg-neutral-950";

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <h3 className="text-sm font-semibold">Invite someone</h3>
      <p className="mt-0.5 text-xs text-neutral-500">
        They receive a link that lets them set their own password.
      </p>

      <form action={action} className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-[11px] text-neutral-500">
          Email
          <input
            name="email"
            type="email"
            required
            placeholder="name@example.com"
            className={`mt-1 ${field}`}
          />
        </label>

        <label className="text-[11px] text-neutral-500">
          Role
          <select name="role" defaultValue="staff" className={`mt-1 ${field}`}>
            <option value="staff">Staff — register only</option>
            {canGrantAnyRole && (
              <>
                <option value="manager">Manager — dashboard and invites</option>
                <option value="super_admin">Super admin — full control</option>
              </>
            )}
          </select>
        </label>

        <label className="text-[11px] text-neutral-500 sm:col-span-2">
          Assign to a store (optional)
          <select name="storeId" defaultValue="" className={`mt-1 ${field}`}>
            <option value="">All stores</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] text-neutral-400">
            Assigning a store limits them to that branch&apos;s orders and stock.
          </span>
        </label>

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={pending}
            className="h-9 rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
          >
            {pending ? "Sending…" : "Send invitation"}
          </button>
        </div>

        {state && (
          <div className="sm:col-span-2">
            <p
              role="status"
              className={`text-xs ${
                state.ok
                  ? "text-green-700 dark:text-green-400"
                  : "text-rose-600 dark:text-rose-400"
              }`}
            >
              {state.ok ? "✓ " : "✗ "}
              {state.message}
            </p>

            {/* Delivery is best-effort; the link always works. When email
                fails, this is how the invite still reaches someone. */}
            {state.ok && state.link && (
              <div className="mt-2 flex gap-2">
                <input
                  readOnly
                  value={state.link}
                  aria-label="Invitation link"
                  onFocus={(e) => e.currentTarget.select()}
                  className={`${field} font-mono text-[11px]`}
                />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(state.link);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="h-9 shrink-0 rounded-lg border border-neutral-300 px-3 text-xs dark:border-neutral-700"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            )}
          </div>
        )}
      </form>
    </section>
  );
}
