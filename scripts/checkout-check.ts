/**
 * Verifies customer checkout — `npm run db:checkout-check`.
 *
 * Calls the real placeOrderAction rather than a re-implementation of it. A
 * mirror of the logic would pass while the action itself was broken, which is
 * the whole failure mode worth guarding against here.
 *
 * The claims under test:
 *   1. a valid cart becomes a real order, with items, an AT- code and totals
 *      the database's own totals_balance constraint accepts;
 *   2. stock is taken at the moment of ordering, not later;
 *   3. PRICES COME FROM THE DATABASE — a tampered cart cannot set its own
 *      price, which is the one security property a public checkout must have;
 *   4. bad input is refused with a message rather than a constraint violation.
 *
 * Everything it creates is removed at the end.
 */
import "dotenv/config";
import { Client } from "pg";
import { placeOrderAction, type CheckoutState } from "../app/actions/checkout";
import { availablePayments, isPaymentAllowed } from "../lib/orders/payment";

const TAG = "checkout-check";
let pass = 0,
  fail = 0;
const ok = (l: string, c: boolean, d = "") => {
  if (c) {
    pass++;
    console.log(`  \x1b[32mPASS\x1b[0m ${l} ${d}`);
  } else {
    fail++;
    console.log(`  \x1b[31mFAIL\x1b[0m ${l} ${d}`);
  }
};

type Line = { sizeId: string; qty: number };

function form(fields: Record<string, string>, lines: Line[]): FormData {
  const fd = new FormData();
  fd.set("lines", JSON.stringify(lines));
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/**
 * placeOrderAction ends with revalidatePath(), which needs a request context
 * that a plain script does not have. If it throws there the order is already
 * committed, so the outcome is recovered from the database rather than lost.
 */
async function place(
  c: Client,
  fd: FormData
): Promise<CheckoutState | { ok: true; code: string; orderId: string }> {
  const before = (
    await c.query(`select coalesce(max(created_at), now() - interval '1 min') t from orders`)
  ).rows[0].t;
  try {
    return await placeOrderAction(null, fd);
  } catch {
    const row = (
      await c.query(
        `select id, order_code from orders where created_at > $1 order by created_at desc limit 1`,
        [before]
      )
    ).rows[0];
    if (!row) throw new Error("action threw and no order was created");
    return { ok: true, code: row.order_code, orderId: row.id };
  }
}

async function main() {
  const c = new Client({ connectionString: process.env.DIRECT_URL });
  await c.connect();

  const store = (
    await c.query(
      `select id, name, delivery_fee::text fee from stores where is_active order by display_order limit 1`
    )
  ).rows[0];
  const methods = (
    await c.query(
      `select id, name, type::text from payment_methods where is_active order by display_order`
    )
  ).rows as Array<{ id: string; name: string; type: string }>;
  // Works for both fulfilment types, so the other assertions are not tangled
  // up with the pickup/delivery rule.
  const method = methods.find((m) => isPaymentAllowed(m.type, "pickup") && isPaymentAllowed(m.type, "delivery"))!;
  const codOnly = methods.find((m) => m.type === "cod")!;
  const pickupOnly = methods.find((m) => m.type === "pay_on_pickup")!;

  // Two different sizes with plenty of stock at this branch.
  const sizes = (
    await c.query(
      `select ps.id, ps.label, si.effective_price::text price, si.stock, si.id inv_id,
              p.name product
         from store_inventory si
         join product_sizes ps on ps.id = si.product_size_id
         join products p on p.id = ps.product_id
        where si.store_id = $1 and si.is_active and ps.is_active and p.is_active
          and si.stock > 10
        order by ps.id limit 2`,
      [store.id]
    )
  ).rows;

  const baselineUnits = (
    await c.query(`select coalesce(sum(stock),0)::int n from store_inventory`)
  ).rows[0].n;
  const madeIds: string[] = [];

  const base = {
    storeId: store.id,
    paymentMethodId: method.id,
    customerName: `${TAG} probe`,
    customerPhone: "09171234567",
    fulfillment: "pickup",
  };

  try {
    console.log("\n1. A valid cart becomes a real order");
    const lines: Line[] = [
      { sizeId: sizes[0].id, qty: 2 },
      { sizeId: sizes[1].id, qty: 1 },
    ];
    const expected =
      Math.round(Number(sizes[0].price) * 2 * 100) / 100 +
      Math.round(Number(sizes[1].price) * 1 * 100) / 100;

    const res = await place(c, form(base, lines));
    ok("order accepted", res?.ok === true, res?.ok ? "" : (res?.message ?? "null"));
    if (!res?.ok) return;
    madeIds.push(res.orderId);

    const order = (
      await c.query(
        `select order_code, status::text st, payment_status::text ps, fulfillment_type::text ft,
                subtotal::text, delivery_fee::text, total_amount::text, stock_deducted_at,
                (select count(*)::int from order_items where order_id = o.id) items
           from orders o where o.id = $1`,
        [res.orderId]
      )
    ).rows[0];

    ok("order code generated by the database", /^AT-[0-9A-Z]{6}$/.test(order.order_code), order.order_code);
    ok("starts as preparing", order.st === "preparing", order.st);
    ok("starts unpaid", order.ps === "unpaid", order.ps);
    ok("both lines saved", order.items === 2, `${order.items}`);
    ok("subtotal computed from database prices",
      Number(order.subtotal) === expected, `${order.subtotal} vs ${expected.toFixed(2)}`);
    ok("pickup carries no delivery fee", Number(order.delivery_fee) === 0);
    ok("total matches subtotal for pickup", Number(order.total_amount) === expected);

    console.log("\n2. Stock is taken at the moment of ordering");
    ok("deduction stamped", order.stock_deducted_at !== null);
    const after = (await c.query(`select stock from store_inventory where id=$1`, [sizes[0].inv_id]))
      .rows[0].stock;
    ok("2 units gone from the first line", after === sizes[0].stock - 2,
      `${sizes[0].stock} → ${after}`);
    const moves = (
      await c.query(
        `select count(*)::int n from inventory_movements where order_id=$1 and reason='order_placed'`,
        [res.orderId]
      )
    ).rows[0].n;
    ok("a movement recorded per line", moves === 2, `${moves}`);

    console.log("\n3. A tampered cart cannot set its own price");
    // The action takes ids and quantities only; there is no price field to
    // forge. Sending one must change nothing.
    const fd = form(base, lines);
    fd.set("price", "1");
    fd.set("subtotal", "1");
    fd.set("total", "1");
    const tampered = await place(c, fd);
    ok("order still accepted", tampered?.ok === true);
    if (tampered?.ok) {
      madeIds.push(tampered.orderId);
      const t = (
        await c.query(`select subtotal::text, total_amount::text from orders where id=$1`, [
          tampered.orderId,
        ])
      ).rows[0];
      ok("injected price fields ignored", Number(t.subtotal) === expected,
        `${t.subtotal} vs ${expected.toFixed(2)}`);
      ok("total unaffected", Number(t.total_amount) === expected);
    }

    console.log("\n4. Delivery adds the branch's own fee");
    const del = await place(
      c,
      form({ ...base, fulfillment: "delivery", addressLine: "12 Test Street" }, [
        { sizeId: sizes[0].id, qty: 1 },
      ])
    );
    ok("delivery order accepted", del?.ok === true, del?.ok ? "" : (del?.message ?? ""));
    if (del?.ok) {
      madeIds.push(del.orderId);
      const d = (
        await c.query(
          `select delivery_fee::text, total_amount::text, subtotal::text, address_line
             from orders where id=$1`,
          [del.orderId]
        )
      ).rows[0];
      ok("fee taken from the store row", Number(d.delivery_fee) === Number(store.fee),
        `${d.delivery_fee} vs ${store.fee}`);
      ok("total includes the fee",
        Number(d.total_amount) === Number(d.subtotal) + Number(d.delivery_fee));
      ok("address kept", d.address_line === "12 Test Street");
    }

    console.log("\n5. Payment must suit the fulfilment (pure)");
    ok("Cash on Delivery is not offered for pickup", !isPaymentAllowed("cod", "pickup"));
    ok("Cash on Delivery is offered for delivery", isPaymentAllowed("cod", "delivery"));
    ok("Pay at the Store is not offered for delivery", !isPaymentAllowed("pay_on_pickup", "delivery"));
    ok("Pay at the Store is offered for pickup", isPaymentAllowed("pay_on_pickup", "pickup"));
    for (const t of ["gcash_qr", "qrph", "maya_qr", "bank_transfer"]) {
      ok(`${t} works either way`, isPaymentAllowed(t, "pickup") && isPaymentAllowed(t, "delivery"));
    }
    // An unlisted type must stay usable rather than silently vanish from the
    // form the day someone adds a new payment method.
    ok("an unlisted type is allowed by default", isPaymentAllowed("future_wallet", "pickup"));
    ok("the pickup list excludes COD",
      !availablePayments(methods, "pickup").some((m) => m.type === "cod"),
      availablePayments(methods, "pickup").map((m) => m.name).join(", "));
    ok("the delivery list excludes pay-at-store",
      !availablePayments(methods, "delivery").some((m) => m.type === "pay_on_pickup"),
      availablePayments(methods, "delivery").map((m) => m.name).join(", "));

    console.log("\n6. …and the action enforces it, not just the form");
    const mismatches: Array<[string, FormData]> = [
      ["Cash on Delivery on a pickup order", form({ ...base, paymentMethodId: codOnly.id }, lines)],
      [
        "Pay at the Store on a delivery order",
        form(
          {
            ...base,
            fulfillment: "delivery",
            addressLine: "12 Test Street",
            paymentMethodId: pickupOnly.id,
          },
          lines
        ),
      ],
    ];
    for (const [label, bad] of mismatches) {
      let st: CheckoutState = null;
      let threw: string | null = null;
      try {
        st = await placeOrderAction(null, bad);
      } catch (e) {
        threw = e instanceof Error ? e.message.split(/\r?\n/)[0] : String(e);
      }
      const refused = threw === null && st !== null && st.ok === false;
      ok(
        `${label} refused`,
        refused,
        refused
          ? `“${(st as { message: string }).message.slice(0, 56)}”`
          : threw
            ? `THREW: ${threw.slice(0, 50)}`
            : "IT WAS ACCEPTED"
      );
    }

    // The valid pairings must still go through, or the rule is a blanket ban
    // that passes the tests above for the wrong reason.
    const valid: Array<[string, FormData]> = [
      ["Pay at the Store on a pickup order", form({ ...base, paymentMethodId: pickupOnly.id }, lines)],
      [
        "Cash on Delivery on a delivery order",
        form(
          {
            ...base,
            fulfillment: "delivery",
            addressLine: "12 Test Street",
            paymentMethodId: codOnly.id,
          },
          lines
        ),
      ],
    ];
    for (const [label, good] of valid) {
      const res2 = await place(c, good);
      ok(`${label} accepted`, res2?.ok === true, res2?.ok ? "" : (res2?.message ?? "null"));
      if (res2?.ok) madeIds.push(res2.orderId);
    }

    console.log("\n7. Bad input is refused with a message");
    const cases: Array<[string, FormData]> = [
      ["empty cart", form(base, [])],
      ["no name", form({ ...base, customerName: "" }, lines)],
      ["bad phone", form({ ...base, customerPhone: "12345" }, lines)],
      ["bad email", form({ ...base, customerEmail: "not-an-email" }, lines)],
      ["delivery with no address", form({ ...base, fulfillment: "delivery" }, lines)],
      ["unknown branch", form({ ...base, storeId: "00000000-0000-0000-0000-000000000000" }, lines)],
      ["unknown payment method", form({ ...base, paymentMethodId: "" }, lines)],
      ["quantity of zero", form(base, [{ sizeId: sizes[0].id, qty: 0 }])],
      ["absurd quantity", form(base, [{ sizeId: sizes[0].id, qty: 10_000 }])],
      ["duplicate line", form(base, [{ sizeId: sizes[0].id, qty: 1 }, { sizeId: sizes[0].id, qty: 1 }])],
      ["unknown size", form(base, [{ sizeId: "00000000-0000-0000-0000-000000000000", qty: 1 }])],
    ];
    for (const [label, bad] of cases) {
      // A throw is NOT a refusal: an unhandled error is a 500 for the
      // customer, and reporting it as "refused" hid exactly that bug once.
      let state: CheckoutState = null;
      let threw: string | null = null;
      try {
        state = await placeOrderAction(null, bad);
      } catch (e) {
        threw = e instanceof Error ? e.message.split(/\r?\n/)[0] : String(e);
      }
      const refused = threw === null && state !== null && state.ok === false;
      ok(
        `${label} refused`,
        refused,
        refused
          ? `“${(state as { message: string }).message.slice(0, 52)}”`
          : threw
            ? `THREW: ${threw.slice(0, 60)}`
            : "IT WAS ACCEPTED"
      );
    }
  } finally {
    console.log("\ncleanup");
    for (const id of madeIds) {
      // Put back exactly what the order took, then remove its trail.
      await c.query(
        `update store_inventory si set stock = si.stock + oi.quantity
           from order_items oi
          where oi.order_id = $1 and oi.store_inventory_id = si.id
            and exists (select 1 from orders o where o.id = $1
                          and o.stock_deducted_at is not null
                          and o.stock_restored_at is null)`,
        [id]
      );
      await c.query(`delete from inventory_movements where order_id=$1`, [id]);
      await c.query(`delete from orders where id=$1`, [id]);
    }
    const units = (await c.query(`select coalesce(sum(stock),0)::int n from store_inventory`)).rows[0].n;
    ok("inventory restored to baseline", units === baselineUnits, `${units} vs ${baselineUnits}`);
    const leftovers = (
      await c.query(`select count(*)::int n from orders where customer_name like $1`, [`${TAG}%`])
    ).rows[0].n;
    ok("no probe orders left behind", leftovers === 0, `${leftovers}`);
    await c.end();
  }

  console.log(`\n${fail === 0 ? "\x1b[32m" : "\x1b[31m"}${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("\ncheck failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
