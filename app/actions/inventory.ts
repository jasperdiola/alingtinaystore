"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession, type AdminSession } from "@/lib/auth/admin";
import { REASON_VALUES } from "@/lib/inventory/reasons";
import { prisma } from "@/lib/prisma";

export type StockActionState = { ok: boolean; message: string } | null;

function canManageStore(session: AdminSession, storeId: string): boolean {
  return (
    session.role === "super_admin" ||
    session.storeId === null ||
    session.storeId === storeId
  );
}

/**
 * Adjust one inventory line.
 *
 * `mode` is either a relative delta ("received 24 more") or an absolute count
 * ("the shelf actually has 7"). An absolute count is converted to a delta here,
 * because inventory_movements records deltas and its delta <> 0 constraint
 * means a no-op has to be rejected rather than silently written.
 *
 * The stock update and the movement row are one transaction. If they could
 * come apart, the audit trail would stop matching the stock it claims to
 * explain — which is worse than having no trail.
 */
export async function adjustStockAction(
  _prev: StockActionState,
  formData: FormData
): Promise<StockActionState> {
  const session = await getAdminSession();
  if (!session) return { ok: false, message: "You are not signed in." };

  const id = String(formData.get("id") ?? "");
  const mode = String(formData.get("mode") ?? "delta");
  const raw = String(formData.get("amount") ?? "").trim();
  const reason = String(formData.get("reason") ?? "");
  const note = String(formData.get("note") ?? "").trim();

  if (!id) return { ok: false, message: "Missing inventory line." };
  if (!REASON_VALUES.has(reason as never)) {
    return { ok: false, message: "Pick a reason for the adjustment." };
  }

  const amount = Number(raw);
  if (!Number.isInteger(amount)) {
    return { ok: false, message: "Enter a whole number." };
  }

  const line = await prisma.store_inventory.findUnique({
    where: { id },
    select: {
      id: true,
      stock: true,
      store_id: true,
      product_sizes: {
        select: { label: true, products: { select: { name: true } } },
      },
    },
  });
  if (!line) return { ok: false, message: "That inventory line no longer exists." };
  if (!canManageStore(session, line.store_id)) {
    return { ok: false, message: "That stock belongs to a store you don't manage." };
  }

  const delta = mode === "set" ? amount - line.stock : amount;

  if (delta === 0) {
    return {
      ok: false,
      message:
        mode === "set"
          ? `Stock is already ${line.stock}. Nothing to change.`
          : "Enter a non-zero amount.",
    };
  }

  const balanceAfter = line.stock + delta;
  if (balanceAfter < 0) {
    return {
      ok: false,
      message: `That would leave ${balanceAfter}. Stock cannot go below zero (current: ${line.stock}).`,
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.store_inventory.update({
        where: { id },
        data: { stock: balanceAfter },
      });
      await tx.inventory_movements.create({
        data: {
          store_inventory_id: id,
          delta,
          balance_after: balanceAfter,
          // The note rides along in the reason so the vocabulary stays fixed
          // while a human can still explain an odd correction.
          reason: note ? `${reason}: ${note}` : reason,
          actor_id: session.userId,
        },
      });
    });
  } catch (e) {
    return { ok: false, message: explain(e) };
  }

  revalidatePath("/admin/inventory");
  revalidatePath("/admin/inventory/movements");

  const name = `${line.product_sizes.products.name} (${line.product_sizes.label})`;
  return {
    ok: true,
    message: `${name}: ${line.stock} → ${balanceAfter} (${delta > 0 ? "+" : ""}${delta}).`,
  };
}

function explain(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const check = msg.match(/violates check constraint "([^"]+)"/);
  if (check) {
    if (check[1] === "store_inventory_stock_check") return "Stock cannot go below zero.";
    if (check[1] === "inventory_movements_delta_check") return "An adjustment must change the count.";
    return `Rejected by ${check[1]}.`;
  }
  return msg.split("\n").filter(Boolean).slice(-1)[0]?.trim() || "Unknown error.";
}
