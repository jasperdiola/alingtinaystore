"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/admin";
import { deductOrderStock, isOutOfStockError, outOfStockItem } from "@/lib/orders/stock";
import { prisma } from "@/lib/prisma";

export type SaleState =
  | { ok: true; code: string; orderId: string; total: number; change: number }
  | { ok: false; message: string }
  | null;

type BasketLine = { id: string; qty: number };

const VAT_RATE_INCLUSIVE = 12 / 112;

/**
 * Ring up a counter sale.
 *
 * A POS sale is a normal order with fulfillment_type = 'pickup', already
 * completed and already paid. Deliberately not a parallel table: it then flows
 * into Orders, Invoices and the dashboard through exactly the same queries as
 * an online order, so "today's revenue" means one thing.
 *
 * Everything happens in one transaction — the order, its lines, the stock
 * decrement, and the movement rows. A sale that took stock without recording
 * it, or recorded a sale that never moved stock, is worse than a failed sale.
 */
export async function createSaleAction(
  _prev: SaleState,
  formData: FormData
): Promise<SaleState> {
  const session = await getAdminSession();
  if (!session) return { ok: false, message: "You are not signed in." };

  const storeId = String(formData.get("storeId") ?? "");
  const tenderedRaw = String(formData.get("tendered") ?? "").trim();
  const customerName = String(formData.get("customerName") ?? "").trim();
  const customerPhone = String(formData.get("customerPhone") ?? "").trim();

  if (!storeId) return { ok: false, message: "Choose a store first." };
  // A cashier assigned to a branch can only sell that branch's stock.
  if (session.storeId && session.storeId !== storeId) {
    return { ok: false, message: "You can only sell from your own store." };
  }

  let basket: BasketLine[];
  try {
    basket = JSON.parse(String(formData.get("basket") ?? "[]"));
  } catch {
    return { ok: false, message: "Could not read the basket." };
  }
  if (!Array.isArray(basket) || basket.length === 0) {
    return { ok: false, message: "The basket is empty." };
  }
  if (basket.some((l) => !l?.id || !Number.isInteger(l.qty) || l.qty < 1)) {
    return { ok: false, message: "Every line needs a whole quantity of at least 1." };
  }

  // Phone is optional now, but still validated when the cashier types one.
  if (customerPhone && !/^09\d{9}$/.test(customerPhone)) {
    return { ok: false, message: "Phone must look like 09XXXXXXXXX, or leave it blank." };
  }

  // Prices come from the database, never from the browser. The basket only
  // carries ids and quantities — a tampered request cannot set its own price.
  const lines = await prisma.store_inventory.findMany({
    where: { id: { in: basket.map((l) => l.id) }, store_id: storeId, is_active: true },
    select: {
      id: true,
      stock: true,
      effective_price: true,
      product_sizes: {
        select: {
          id: true,
          label: true,
          products: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (lines.length !== basket.length) {
    return { ok: false, message: "An item is no longer available. Clear it and try again." };
  }

  const byId = new Map(lines.map((l) => [l.id, l]));
  let subtotal = 0;
  for (const b of basket) {
    const line = byId.get(b.id)!;
    if (line.stock < b.qty) {
      return {
        ok: false,
        message: `Only ${line.stock} left of ${line.product_sizes.products.name} (${line.product_sizes.label}).`,
      };
    }
    subtotal += Number(line.effective_price) * b.qty;
  }

  const total = Math.round(subtotal * 100) / 100;
  const tendered = tenderedRaw === "" ? total : Number(tenderedRaw);
  if (!Number.isFinite(tendered)) {
    return { ok: false, message: "Enter a valid amount tendered." };
  }
  if (tendered < total) {
    return { ok: false, message: `Short by ₱${(total - tendered).toFixed(2)}.` };
  }
  const change = Math.round((tendered - total) * 100) / 100;

  const vat = Math.round(total * VAT_RATE_INCLUSIVE * 100) / 100;

  // No field exists for tendered/change, so it goes in the note — a short till
  // at closing can then be traced back to the sale that caused it.
  const note = `Counter sale. Tendered PHP ${tendered.toFixed(2)}, change PHP ${change.toFixed(2)}.`;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const order = await tx.orders.create({
        data: {
          // Left empty on purpose: prepare_order() generates the AT-XXXXXX code
          // when order_code is null or blank. Prisma requires the key because it
          // cannot see the trigger, and generating one here would duplicate the
          // collision-retry loop the database already does.
          order_code: "",
          store_id: storeId,
          // Sold, handed over and paid, all at the counter.
          status: "completed" as never,
          payment_status: "verified" as never,
          fulfillment_type: "pickup" as never,
          customer_name: customerName || "Walk-in customer",
          customer_phone: customerPhone || null,
          customer_notes: note,
          subtotal: total.toFixed(2),
          delivery_fee: "0",
          discount_total: "0",
          vat_amount: vat.toFixed(2),
          is_vat_inclusive: true,
          payment_method_name: "Cash (counter)",
          payment_verified_at: new Date(),
          payment_verified_by: session.userId,
          completed_at: new Date(),
        },
        select: { id: true, order_code: true },
      });

      for (const b of basket) {
        const line = byId.get(b.id)!;
        await tx.order_items.create({
          data: {
            order_id: order.id,
            store_inventory_id: line.id,
            product_id: line.product_sizes.products.id,
            product_size_id: line.product_sizes.id,
            product_name: line.product_sizes.products.name,
            size_label: line.product_sizes.label,
            unit_price: line.effective_price,
            quantity: b.qty,
          },
        });

      }

      // One implementation of "stock leaves the branch", shared with the
      // storefront path. It decrements conditionally, writes a movement per
      // line, and stamps stock_deducted_at — which is what tells the cancel
      // trigger there is something to give back.
      await deductOrderStock(tx, order.id, session.userId);

      return order;
    });

    revalidatePath("/admin/pos");
    revalidatePath("/admin/orders");
    revalidatePath("/admin/inventory");
    revalidatePath("/admin");

    return {
      ok: true,
      code: created.order_code,
      orderId: created.id,
      total,
      change,
    };
  } catch (e) {
    if (isOutOfStockError(e)) {
      return {
        ok: false,
        message: `${outOfStockItem(e) ?? "An item"} sold out while you were ringing up. Nothing was charged.`,
      };
    }
    const msg = e instanceof Error ? e.message : String(e);
    const check = msg.match(/violates check constraint "([^"]+)"/);
    if (check) return { ok: false, message: `Rejected by ${check[1]}.` };
    return { ok: false, message: msg.split("\n").filter(Boolean).slice(-1)[0]?.trim() || "Sale failed." };
  }
}
