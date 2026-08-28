"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/lib/generated/prisma/client";
import {
  isPaymentAllowed,
  paymentMismatchMessage,
  type Fulfillment,
} from "@/lib/orders/payment";
import { deductOrderStock, isOutOfStockError, outOfStockItem } from "@/lib/orders/stock";
import { prisma } from "@/lib/prisma";

export type CheckoutState =
  | { ok: true; code: string; orderId: string }
  | { ok: false; message: string; field?: string }
  | null;

/** VAT is inclusive, matching prepare_order() and the POS. */
const VAT_RATE_INCLUSIVE = 12 / 112;

const PHONE = /^09\d{9}$/;
/**
 * Prisma throws P2023 when a non-uuid string is compared against a uuid column,
 * which surfaces as a 500 rather than a message. Every id here arrives from a
 * form, so each is shape-checked before it reaches a query.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Line = { sizeId: string; qty: number };

/** Cart lines arrive as JSON in a hidden field; treat every part as hostile. */
function parseLines(raw: string): Line[] | null {
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data) || data.length === 0 || data.length > 50) return null;
    const lines: Line[] = [];
    for (const l of data) {
      if (typeof l?.sizeId !== "string" || !UUID.test(l.sizeId)) return null;
      if (!Number.isInteger(l?.qty)) return null;
      if (l.qty < 1 || l.qty > 99) return null;
      lines.push({ sizeId: l.sizeId, qty: l.qty });
    }
    // A duplicated size id would otherwise create two lines for one product.
    const seen = new Set(lines.map((l) => l.sizeId));
    return seen.size === lines.length ? lines : null;
  } catch {
    return null;
  }
}

/**
 * Place a customer order.
 *
 * The security-relevant part: NOTHING about money comes from the browser. The
 * cart sends size ids and quantities; every unit price, the delivery fee and
 * the totals are read from the database here. A tampered payload can change
 * what is ordered — never what it costs.
 *
 * Stock is taken immediately, in the same transaction, through the same
 * deduct_order_stock() the POS uses. A customer order that reserves nothing is
 * how two people buy the last kilo.
 */
export async function placeOrderAction(
  _prev: CheckoutState,
  formData: FormData
): Promise<CheckoutState> {
  const text = (k: string) => String(formData.get(k) ?? "").trim();

  const lines = parseLines(String(formData.get("lines") ?? ""));
  if (!lines) return { ok: false, message: "Your cart is empty or unreadable. Please try again." };

  const storeId = text("storeId");
  const fulfillment = text("fulfillment");
  const paymentMethodId = text("paymentMethodId");
  const name = text("customerName");
  const phone = text("customerPhone").replace(/[\s-]/g, "");
  const email = text("customerEmail");
  const notes = text("notes");
  const address = text("addressLine");
  const barangay = text("barangay");
  const city = text("city");

  if (!["delivery", "pickup"].includes(fulfillment)) {
    return { ok: false, message: "Choose delivery or pickup.", field: "fulfillment" };
  }
  if (!UUID.test(storeId)) {
    return { ok: false, message: "Choose a branch.", field: "storeId" };
  }
  if (!UUID.test(paymentMethodId)) {
    return { ok: false, message: "Choose a payment method.", field: "paymentMethodId" };
  }
  if (name.length < 2 || name.length > 120) {
    return { ok: false, message: "Enter your name.", field: "customerName" };
  }
  // orders_customer_phone_check enforces this too; saying so here is friendlier.
  if (!PHONE.test(phone)) {
    return { ok: false, message: "Phone must look like 09XXXXXXXXX.", field: "customerPhone" };
  }
  if (email && !EMAIL.test(email)) {
    return { ok: false, message: "That email address doesn't look right.", field: "customerEmail" };
  }
  // delivery_needs_address is a database constraint; catching it here gives a
  // message that names the field instead of a constraint violation.
  if (fulfillment === "delivery" && address.length < 5) {
    return {
      ok: false,
      message: "Delivery needs a street address.",
      field: "addressLine",
    };
  }

  const store = await prisma.stores.findFirst({
    where: { id: storeId, is_active: true },
    select: { id: true, name: true, delivery_fee: true },
  });
  if (!store) return { ok: false, message: "That branch is not available.", field: "storeId" };

  const method = await prisma.payment_methods.findFirst({
    where: { id: paymentMethodId, is_active: true },
    select: { id: true, name: true, type: true },
  });
  if (!method) {
    return { ok: false, message: "Choose a payment method.", field: "paymentMethodId" };
  }
  /*
   * Re-checked here even though the form only offers valid options.
   *
   * The form filters the list for display; this decides whether the order is
   * allowed. Without it, a stale page — someone who picked "Pay at the Store"
   * and then switched to delivery — or a hand-edited request could book a
   * delivery to be paid at a counter the customer never visits.
   */
  if (!isPaymentAllowed(method.type, fulfillment as Fulfillment)) {
    return {
      ok: false,
      message: paymentMismatchMessage(method.name, fulfillment as Fulfillment),
      field: "paymentMethodId",
    };
  }

  /*
   * Resolve each cart line to THIS branch's inventory row.
   *
   * The cart is branch-agnostic by design — a customer browses the catalogue
   * and picks where to collect at the end — so this is where an abstract "1/2
   * Kilo of Kasoy" becomes a specific row with a specific price and stock
   * level at a specific store.
   */
  const inventory = await prisma.store_inventory.findMany({
    where: {
      store_id: store.id,
      is_active: true,
      product_size_id: { in: lines.map((l) => l.sizeId) },
      product_sizes: { is_active: true, products: { is_active: true } },
    },
    select: {
      id: true,
      product_size_id: true,
      effective_price: true,
      stock: true,
      product_sizes: {
        select: { id: true, label: true, product_id: true, products: { select: { name: true } } },
      },
    },
  });

  const bySize = new Map(inventory.map((i) => [i.product_size_id, i]));

  const missing = lines.filter((l) => !bySize.has(l.sizeId));
  if (missing.length) {
    return {
      ok: false,
      message: `${missing.length} item${missing.length === 1 ? " is" : "s are"} not carried at ${store.name}. Pick another branch or remove them.`,
      field: "storeId",
    };
  }

  const short = lines
    .map((l) => ({ l, inv: bySize.get(l.sizeId)! }))
    .filter(({ l, inv }) => inv.stock < l.qty);
  if (short.length) {
    const first = short[0];
    return {
      ok: false,
      message: `${first.inv.product_sizes.products.name} (${first.inv.product_sizes.label}) — only ${first.inv.stock} left at ${store.name}.`,
      field: "storeId",
    };
  }

  // Prices from the database, rounded per line exactly as totals_balance and
  // the POS do, so the trigger's arithmetic and ours cannot disagree.
  const priced = lines.map((l) => {
    const inv = bySize.get(l.sizeId)!;
    const unit = Number(inv.effective_price);
    return {
      inv,
      qty: l.qty,
      unit,
      lineTotal: Math.round(unit * l.qty * 100) / 100,
    };
  });

  const subtotal = Math.round(priced.reduce((s, p) => s + p.lineTotal, 0) * 100) / 100;
  // pickup_has_no_fee: a pickup order must carry a zero fee.
  const deliveryFee = fulfillment === "delivery" ? Number(store.delivery_fee) : 0;
  const total = Math.round((subtotal + deliveryFee) * 100) / 100;
  const vat = Math.round(total * VAT_RATE_INCLUSIVE * 100) / 100;

  let order: { id: string; order_code: string };
  try {
    order = await prisma.$transaction(async (tx) => {
      const created = await tx.orders.create({
        data: {
          // Blank on purpose — prepare_order() generates AT-XXXXXX and computes
          // total_amount. Generating one here would duplicate the database's
          // collision-retry loop.
          order_code: "",
          store_id: store.id,
          fulfillment_type: fulfillment as never,
          // Orders start being prepared; nobody has to press a button to begin
          // work on an order that has just come in.
          payment_status: "unpaid" as never,
          customer_name: name,
          customer_phone: phone,
          customer_email: email || null,
          customer_notes: notes || null,
          address_line: fulfillment === "delivery" ? address : null,
          barangay: fulfillment === "delivery" ? barangay || null : null,
          city: fulfillment === "delivery" ? city || null : null,
          province: fulfillment === "delivery" ? "Rizal" : null,
          subtotal: subtotal.toFixed(2),
          delivery_fee: deliveryFee.toFixed(2),
          discount_total: "0",
          vat_amount: vat.toFixed(2),
          is_vat_inclusive: true,
          payment_method_id: method.id,
          payment_method_name: method.name,
        },
        select: { id: true, order_code: true },
      });

      for (const p of priced) {
        await tx.order_items.create({
          data: {
            order_id: created.id,
            store_inventory_id: p.inv.id,
            product_id: p.inv.product_sizes.product_id,
            product_size_id: p.inv.product_sizes.id,
            product_name: p.inv.product_sizes.products.name,
            size_label: p.inv.product_sizes.label,
            unit_price: p.unit.toFixed(2),
            quantity: p.qty,
          },
        });
      }

      // Same function the POS uses: idempotent, refuses to go negative, and
      // writes an inventory_movements row per line.
      await deductOrderStock(tx, created.id, null);

      return created;
    });

  } catch (e) {
    if (isOutOfStockError(e)) {
      return {
        ok: false,
        message: `Someone just bought the last of ${outOfStockItem(e) ?? "an item"}. Please adjust your cart.`,
        field: "storeId",
      };
    }
    return { ok: false, message: explain(e) };
  }

  /*
   * The order is committed. Everything from here is bookkeeping, and none of it
   * may turn a placed order into a reported failure.
   *
   * revalidatePath needs a request context and throws without one. It used to
   * sit inside the try above, so any failure here told the customer "we
   * couldn't place that order" while the order existed and their stock was
   * already taken — they would simply order again. A stale admin cache is a far
   * smaller problem than a duplicated order.
   */
  try {
    revalidatePath("/admin/orders");
    revalidatePath("/admin");
  } catch {
    // Nothing to do: the next request rebuilds the page anyway.
  }

  return { ok: true, code: order.order_code, orderId: order.id };
}

function explain(e: unknown): string {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return "That order was already placed.";
  }
  const msg = e instanceof Error ? e.message : String(e);
  const check = msg.match(/violates check constraint "([^"]+)"/);
  if (check) {
    const hints: Record<string, string> = {
      delivery_needs_address: "delivery orders need a street address.",
      pickup_has_no_fee: "pickup orders cannot carry a delivery fee.",
      orders_customer_phone_check: "phone must look like 09XXXXXXXXX.",
      totals_balance: "the totals did not add up — please try again.",
    };
    return `We couldn't place that order — ${hints[check[1]] ?? check[1]}`;
  }
  return "We couldn't place that order. Please try again, or call us.";
}
