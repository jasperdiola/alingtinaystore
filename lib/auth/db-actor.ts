import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Runs a write with the acting admin visible to Postgres.
 *
 * Several triggers record who did something via auth.uid(), which reads
 * `request.jwt.claims`: log_order_transition, and the three price-audit
 * triggers. The Prisma connection carries no JWT, so without this every one of
 * them logs an anonymous actor — an audit trail that cannot say who acted is
 * worse than none, because it looks like one.
 *
 * `set_config(..., true)` scopes the setting to this transaction, so nothing
 * leaks to the next request that reuses the pooled connection.
 */
export async function withActor<T>(
  actorId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('request.jwt.claims', ${JSON.stringify({
      sub: actorId,
    })}, true)`;
    return fn(tx);
  });
}
