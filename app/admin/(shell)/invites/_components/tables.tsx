"use client";

import { useActionState } from "react";
import {
  resendInviteAction,
  revokeInviteAction,
  type InviteState,
} from "@/app/actions/invites";
import {
  setAdminActiveAction,
  setAdminRoleAction,
  type StaffActionState,
} from "@/app/actions/staff";
import type { AdminRole } from "@/lib/auth/admin";
import type { InviteRow } from "@/lib/queries/invites";
import type { StaffMember } from "@/lib/queries/staff";

const ROLE_LABEL: Record<string, string> = {
  staff: "Staff",
  manager: "Manager",
  super_admin: "Super admin",
};

const when = (iso: string) =>
  new Date(iso).toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const STATUS_TONE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
  accepted: "bg-green-50 text-green-800 dark:bg-green-950/50 dark:text-green-200",
  revoked: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  expired: "bg-rose-50 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200",
};

const btn =
  "rounded-lg border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800";

function Msg({ state }: { state: InviteState | StaffActionState }) {
  if (!state) return null;
  return (
    <p
      role="status"
      className={`mt-1 text-[11px] ${
        state.ok ? "text-green-700 dark:text-green-400" : "text-rose-600 dark:text-rose-400"
      }`}
    >
      {state.ok ? "✓ " : "✗ "}
      {state.message}
    </p>
  );
}

/* ------------------------------------------------------------- invites */

function InviteActions({ id }: { id: string }) {
  const [resendState, resend, resending] = useActionState(resendInviteAction, null as InviteState);
  const [revokeState, revoke, revoking] = useActionState(revokeInviteAction, null as InviteState);

  return (
    <div>
      <div className="flex justify-end gap-1.5">
        <form action={resend}>
          <input type="hidden" name="id" value={id} />
          <button type="submit" disabled={resending} className={btn}>
            {resending ? "…" : "Resend"}
          </button>
        </form>
        <form action={revoke}>
          <input type="hidden" name="id" value={id} />
          <button
            type="submit"
            disabled={revoking}
            className="rounded-lg border border-rose-300 px-2.5 py-1 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-40 dark:border-rose-800 dark:text-rose-400"
          >
            {revoking ? "…" : "Revoke"}
          </button>
        </form>
      </div>
      <Msg state={resendState} />
      <Msg state={revokeState} />
    </div>
  );
}

export function InvitesTable({ invites }: { invites: InviteRow[] }) {
  if (invites.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-neutral-300 py-8 text-center text-sm text-neutral-500 dark:border-neutral-700">
        No invitations yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <table className="rtable w-full text-sm sm:min-w-[640px]">
        <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500 dark:border-neutral-800">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-medium">Email</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Role</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Invited by</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {invites.map((i) => (
            <tr key={i.id} className="border-b border-neutral-100 align-top last:border-0 dark:border-neutral-800/60">
              <td data-label="" className="px-4 py-3">{i.email}</td>
              <td data-label="Role" className="px-4 py-3 text-neutral-600 dark:text-neutral-400">
                {ROLE_LABEL[i.role] ?? i.role}
              </td>
              <td data-label="Status" className="px-4 py-3">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[i.status]}`}>
                  {i.status}
                </span>
                {i.status === "pending" && (
                  <div className="mt-0.5 text-[11px] text-neutral-500">
                    expires {when(i.expiresAt)}
                  </div>
                )}
              </td>
              <td data-label="Invited by" className="px-4 py-3 text-neutral-600 dark:text-neutral-400">
                {i.invitedByName ?? "—"}
              </td>
              <td data-label="" className="px-4 py-3 text-right">
                {i.status === "pending" ? (
                  <InviteActions id={i.id} />
                ) : (
                  <span className="text-[11px] text-neutral-400">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------------------------------------------- staff */

function StaffActions({
  member,
  lastSuperAdmin,
}: {
  member: StaffMember;
  lastSuperAdmin: boolean;
}) {
  const [roleState, setRole, savingRole] = useActionState(setAdminRoleAction, null as StaffActionState);
  const [activeState, setActive, savingActive] = useActionState(setAdminActiveAction, null as StaffActionState);

  // Self-edits and last-super-admin changes are refused by the action; the UI
  // says why up front instead of letting someone click into a rejection.
  if (member.isSelf) {
    return <span className="text-[11px] text-neutral-400">This is you</span>;
  }
  const frozen = member.role === "super_admin" && member.isActive && lastSuperAdmin;
  if (frozen) {
    return (
      <span className="text-[11px] text-neutral-400">
        Last super admin — promote someone else first
      </span>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-end gap-1.5">
        <form action={setRole} className="flex items-center gap-1">
          <input type="hidden" name="id" value={member.id} />
          <select
            name="role"
            defaultValue={member.role}
            aria-label={`Role for ${member.email}`}
            className="h-7 rounded-lg border border-neutral-300 px-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-950"
          >
            {(["staff", "manager", "super_admin"] as AdminRole[]).map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select>
          <button type="submit" disabled={savingRole} className={btn}>
            {savingRole ? "…" : "Save"}
          </button>
        </form>

        <form action={setActive}>
          <input type="hidden" name="id" value={member.id} />
          <input type="hidden" name="active" value={member.isActive ? "0" : "1"} />
          <button
            type="submit"
            disabled={savingActive}
            className={
              member.isActive
                ? "rounded-lg border border-rose-300 px-2.5 py-1 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-40 dark:border-rose-800 dark:text-rose-400"
                : btn
            }
          >
            {savingActive ? "…" : member.isActive ? "Deactivate" : "Reactivate"}
          </button>
        </form>
      </div>
      <Msg state={roleState} />
      <Msg state={activeState} />
    </div>
  );
}

export function StaffTable({
  staff,
  canManage,
  superAdminCount,
}: {
  staff: StaffMember[];
  /** super_admin only — mirrors your admin_users_super_write RLS policy. */
  canManage: boolean;
  superAdminCount: number;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <table className="rtable w-full text-sm sm:min-w-[640px]">
        <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500 dark:border-neutral-800">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-medium">Name</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Role</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Store</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Last sign-in</th>
            {canManage && (
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {staff.map((m) => (
            <tr
              key={m.id}
              className={`border-b border-neutral-100 align-top last:border-0 dark:border-neutral-800/60 ${
                m.isActive ? "" : "opacity-60"
              }`}
            >
              <td data-label="" className="px-4 py-3">
                <div className="font-medium">
                  {m.fullName || m.email}
                  {m.isSelf && <span className="ml-2 text-[11px] text-neutral-400">you</span>}
                </div>
                <div className="text-xs text-neutral-500">{m.email}</div>
                {!m.isActive && (
                  <div className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                    Deactivated
                  </div>
                )}
              </td>
              <td data-label="Role" className="px-4 py-3 text-neutral-600 dark:text-neutral-400">
                {ROLE_LABEL[m.role] ?? m.role}
              </td>
              <td data-label="Store" className="px-4 py-3 text-neutral-600 dark:text-neutral-400">
                {m.store ?? "All stores"}
              </td>
              <td data-label="Last sign-in" className="px-4 py-3 text-neutral-600 dark:text-neutral-400">
                {m.lastLoginAt ? when(m.lastLoginAt) : "Never"}
              </td>
              {canManage && (
                <td data-label="" className="px-4 py-3 text-right">
                  <StaffActions member={m} lastSuperAdmin={superAdminCount <= 1} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
