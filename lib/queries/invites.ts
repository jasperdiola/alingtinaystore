import "server-only";
import type { AdminRole } from "@/lib/auth/admin";
import { prisma } from "@/lib/prisma";

export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";

export type InviteRow = {
  id: string;
  email: string;
  role: AdminRole;
  status: InviteStatus;
  storeId: string | null;
  invitedByName: string | null;
  expiresAt: string;
  createdAt: string;
};

function statusOf(i: {
  accepted_at: Date | null;
  revoked_at: Date | null;
  expires_at: Date;
}): InviteStatus {
  if (i.accepted_at) return "accepted";
  if (i.revoked_at) return "revoked";
  if (i.expires_at.getTime() < Date.now()) return "expired";
  return "pending";
}

/** For the admin page's invite list. Tokens are deliberately never returned. */
export async function listInvites(limit = 50): Promise<InviteRow[]> {
  const rows = await prisma.staff_invites.findMany({
    orderBy: { created_at: "desc" },
    take: limit,
    select: {
      id: true,
      email: true,
      role: true,
      store_id: true,
      expires_at: true,
      accepted_at: true,
      revoked_at: true,
      created_at: true,
      admin_users: { select: { full_name: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role as AdminRole,
    status: statusOf(r),
    storeId: r.store_id,
    invitedByName: r.admin_users?.full_name ?? null,
    expiresAt: r.expires_at.toISOString(),
    createdAt: r.created_at.toISOString(),
  }));
}

/**
 * Look up an invite by its token and confirm it is still usable.
 *
 * Note this uses findFirst, not findUnique. The uniqueness on `email` is a
 * PARTIAL index (only where accepted_at IS NULL AND revoked_at IS NULL), so
 * several rows can legitimately share an address once older invites are
 * accepted or revoked.
 */
export async function findUsableInvite(token: string) {
  if (!token) return null;

  const invite = await prisma.staff_invites.findFirst({
    where: {
      token,
      accepted_at: null,
      revoked_at: null,
      expires_at: { gt: new Date() },
    },
    select: {
      id: true,
      email: true,
      role: true,
      store_id: true,
      expires_at: true,
    },
  });

  return invite;
}

/** Why a token failed, so the UI can say something more useful than "invalid". */
export async function describeInvite(token: string): Promise<InviteStatus | "unknown"> {
  const invite = await prisma.staff_invites.findFirst({
    where: { token },
    select: { accepted_at: true, revoked_at: true, expires_at: true },
  });
  return invite ? statusOf(invite) : "unknown";
}
