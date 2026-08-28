import "server-only";
import { Prisma } from "@/lib/generated/prisma/client";

/**
 * Take an order's stock out of its branch.
 *
 * Thin wrapper over the `deduct_order_stock` SQL function so every path that
 * places an order — the register today, the storefront later — moves stock the
 * same way. Duplicating this in TypeScript is how the two drift apart, and a
 * drift here shows up as inventory that does not match the shelf.
 *
 * Idempotent: the function no-ops when orders.stock_deducted_at is already set,
 * so a retried checkout cannot deduct twice.
 *
 * Must be called inside the same transaction that created the order — a sale
 * that recorded itself without moving stock is worse than a failed sale.
 */
export async function deductOrderStock(
  tx: Prisma.TransactionClient,
  orderId: string,
  actorId: string | null
): Promise<void> {
  await tx.$executeRaw`SELECT deduct_order_stock(${orderId}::uuid, ${actorId}::uuid)`;
}

/** True when the message came from the function's insufficient-stock raise. */
export function isOutOfStockError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes("insufficient stock for");
}

/** "insufficient stock for Adobong Mani (1 Kilo)" -> "Adobong Mani (1 Kilo)" */
export function outOfStockItem(e: unknown): string | null {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.match(/insufficient stock for (.+?)(?:\n|$)/)?.[1]?.trim() ?? null;
}
