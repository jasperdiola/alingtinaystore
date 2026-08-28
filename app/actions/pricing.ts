"use server";

import { revalidatePath } from "next/cache";
import { adminAtLeast, getAdminSession } from "@/lib/auth/admin";
import { withActor } from "@/lib/auth/db-actor";
import { prisma } from "@/lib/prisma";

export type PriceActionState = { ok: boolean; message: string } | null;

/** Two decimal places, never negative — matches the DB's money check constraints. */
const MONEY = /^\d+(\.\d{1,2})?$/;

/**
 * Pricing is manager-and-above, deliberately tighter than the database.
 *
 * store_inventory_admin_write in your RLS is can_manage_store(), which would
 * let a cashier change price_override. A mistyped price sells stock at a loss
 * silently and nothing downstream would catch it, so the application holds a
 * higher bar than the database does.
 */
type Pricer =
  | { denied: true; message: string }
  | { denied: false; actorId: string };

async function requirePricer(): Promise<Pricer> {
  const session = await getAdminSession();
  if (!session) return { denied: true, message: "You are not signed in." };
  if (!(await adminAtLeast("manager"))) {
    return { denied: true, message: `Your role (${session.role}) cannot change prices.` };
  }
  return { denied: false, actorId: session.userId };
}

/* ------------------------------------------------------- per-store override */

/**
 * Set or clear one branch's price.
 *
 * `effective_price` is never written here. The sync_effective_price() BEFORE
 * trigger derives it from `price_override ?? product_sizes.price`, so clearing
 * the override is what returns a branch to the catalog price — there is no
 * separate "reset" to perform.
 */
export async function setPriceOverrideAction(
  _prev: PriceActionState,
  formData: FormData
): Promise<PriceActionState> {
  const gate = await requirePricer();
  if (gate.denied) return { ok: false, message: gate.message };

  const id = String(formData.get("id") ?? "");
  const clear = String(formData.get("clear") ?? "") === "1";
  const raw = String(formData.get("price") ?? "").trim();

  if (!id) return { ok: false, message: "Missing inventory line." };

  const line = await prisma.store_inventory.findUnique({
    where: { id },
    select: {
      id: true,
      price_override: true,
      stores: { select: { name: true } },
      product_sizes: {
        select: { label: true, price: true, products: { select: { name: true } } },
      },
    },
  });
  if (!line) return { ok: false, message: "That inventory line no longer exists." };

  const label = `${line.product_sizes.products.name} (${line.product_sizes.label}) at ${line.stores.name}`;
  const catalog = Number(line.product_sizes.price);

  if (clear) {
    if (line.price_override === null) {
      return { ok: false, message: `${label} already uses the catalog price.` };
    }
    await withActor(gate.actorId, (tx) =>
      tx.store_inventory.update({ where: { id }, data: { price_override: null } })
    );
    revalidatePath("/admin/inventory");
    return {
      ok: true,
      message: `${label} now follows the catalog price (₱${catalog.toFixed(2)}).`,
    };
  }

  if (!MONEY.test(raw)) {
    return { ok: false, message: "Enter an amount with at most two decimals." };
  }

  try {
    await withActor(gate.actorId, (tx) =>
      tx.store_inventory.update({
        where: { id },
        // Passing the string, not Number(raw) — Prisma maps it straight to
        // Decimal, and a JS float would quietly lose centavos.
        data: { price_override: raw },
      })
    );
  } catch (e) {
    return { ok: false, message: explain(e) };
  }

  revalidatePath("/admin/inventory");
  return { ok: true, message: `${label} priced at ₱${raw} (catalog is ₱${catalog.toFixed(2)}).` };
}

/* ---------------------------------------------------------- catalog pricing */

/**
 * Change a size's catalog price.
 *
 * cascade_size_price() then updates every branch WHERE price_override IS NULL,
 * so branches that deliberately differ keep their own price. That is the
 * intended behaviour, and the reason the response says how many branches
 * actually moved.
 */
export async function setSizePriceAction(
  _prev: PriceActionState,
  formData: FormData
): Promise<PriceActionState> {
  const gate = await requirePricer();
  if (gate.denied) return { ok: false, message: gate.message };

  const id = String(formData.get("sizeId") ?? "");
  const raw = String(formData.get("price") ?? "").trim();

  if (!id) return { ok: false, message: "Missing size." };
  if (!MONEY.test(raw)) {
    return { ok: false, message: "Enter an amount with at most two decimals." };
  }

  const size = await prisma.product_sizes.findUnique({
    where: { id },
    select: {
      label: true,
      price: true,
      products: { select: { name: true } },
      store_inventory: { select: { price_override: true } },
    },
  });
  if (!size) return { ok: false, message: "That size no longer exists." };

  if (Number(size.price) === Number(raw)) {
    return { ok: false, message: `Already ₱${raw}. Nothing to change.` };
  }

  const following = size.store_inventory.filter((s) => s.price_override === null).length;
  const pinned = size.store_inventory.length - following;

  try {
    await withActor(gate.actorId, (tx) =>
      tx.product_sizes.update({ where: { id }, data: { price: raw } })
    );
  } catch (e) {
    return { ok: false, message: explain(e) };
  }

  revalidatePath("/admin/inventory");
  revalidatePath("/admin/inventory/products");

  return {
    ok: true,
    message:
      `${size.products.name} (${size.label}) is now ₱${raw}. ` +
      `${following} branch${following === 1 ? "" : "es"} updated` +
      (pinned > 0 ? `; ${pinned} kept its own price.` : "."),
  };
}

function explain(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const check = msg.match(/violates check constraint "([^"]+)"/);
  if (check) {
    if (check[1] === "store_inventory_price_override_check") return "Price cannot be negative.";
    if (check[1] === "product_sizes_price_check") return "Price cannot be negative.";
    return `Rejected by ${check[1]}.`;
  }
  return msg.split("\n").filter(Boolean).slice(-1)[0]?.trim() || "Unknown error.";
}
