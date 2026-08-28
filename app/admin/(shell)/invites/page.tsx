import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/admin";
import { listInvites } from "@/lib/queries/invites";
import { countActiveSuperAdmins, getStoreChoices, listStaff } from "@/lib/queries/staff";
import InviteForm from "./_components/invite-form";
import { InvitesTable, StaffTable } from "./_components/tables";

export const metadata: Metadata = {
  title: "Staff & Invites · Aling Tinay Admin",
  robots: { index: false, follow: false },
};

export default async function StaffPage() {
  // Manager and above. The hidden nav link is cosmetic; this is the control.
  const session = await requireRole("manager");
  const isSuper = session.role === "super_admin";

  const [invites, staff, stores, superAdmins] = await Promise.all([
    listInvites(),
    listStaff(),
    getStoreChoices(),
    countActiveSuperAdmins(),
  ]);

  const pending = invites.filter((i) => i.status === "pending").length;
  const active = staff.filter((s) => s.isActive).length;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Staff &amp; Invites</h2>
        <p className="text-xs text-neutral-500">
          {active} active account{active === 1 ? "" : "s"}
          {pending > 0 && ` · ${pending} invitation${pending === 1 ? "" : "s"} awaiting acceptance`}
        </p>
      </div>

      <div className="flex flex-col gap-6">
        <InviteForm canGrantAnyRole={isSuper} stores={stores} />

        <section>
          <h3 className="mb-2 text-sm font-semibold">Invitations</h3>
          <InvitesTable invites={invites} />
        </section>

        <section>
          <h3 className="mb-1 text-sm font-semibold">Team</h3>
          <p className="mb-2 text-xs text-neutral-500">
            {isSuper
              ? "Deactivating someone signs them out on their next request."
              : "Only a super admin can change roles or deactivate accounts."}
          </p>
          <StaffTable
            staff={staff}
            canManage={isSuper}
            superAdminCount={superAdmins}
          />
        </section>
      </div>
    </div>
  );
}
