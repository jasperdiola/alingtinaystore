/**
 * Verifies the order lifecycle — `npm run db:orders-check`.
 *
 * Covers the manual flow the store actually runs:
 *   delivery   preparing → out_for_delivery → completed
 *   pickup     preparing → ready            → completed
 *
 * plus the two-step cancellation (staff request → manager approves/declines),
 * and the claim that setting `request.jwt.claims` inside the transaction makes
 * log_order_transition() record `changed_by`. Everything it creates is tagged
 * and removed at the end.
 */
import "dotenv/config";
import { Client } from "pg";
import { canApproveCancel, canCancel, nextStatus } from "../lib/orders/flow";

const TAG = "orders-check:";
let pass = 0, fail = 0;
const ok = (l: string, c: boolean, d = "") => {
  if (c) { pass++; console.log(`  \x1b[32mPASS\x1b[0m ${l} ${d}`); }
  else { fail++; console.log(`  \x1b[31mFAIL\x1b[0m ${l} ${d}`); }
};

async function main() {
  const c = new Client({ connectionString: process.env.DIRECT_URL });
  await c.connect();

  console.log("\n1. Lifecycle (pure)");
  ok("delivery: preparing → out_for_delivery",
    nextStatus("preparing", "delivery") === "out_for_delivery", `got ${nextStatus("preparing", "delivery")}`);
  ok("delivery: out_for_delivery → completed",
    nextStatus("out_for_delivery", "delivery") === "completed");
  ok("delivery never routes through 'ready'",
    nextStatus("preparing", "delivery") !== "ready");
  ok("pickup: preparing → ready", nextStatus("preparing", "pickup") === "ready");
  ok("pickup: ready → completed", nextStatus("ready", "pickup") === "completed");
  ok("pickup never routes through out_for_delivery",
    nextStatus("preparing", "pickup") !== "out_for_delivery");
  ok("completed is terminal", nextStatus("completed", "pickup") === null);
  ok("cancelled cannot advance", nextStatus("cancelled", "delivery") === null);

  console.log("\n2. Legacy statuses are not stranded");
  ok("pending → preparing", nextStatus("pending", "delivery") === "preparing");
  ok("confirmed → preparing", nextStatus("confirmed", "pickup") === "preparing");
  ok("legacy delivery 'ready' → out_for_delivery",
    nextStatus("ready", "delivery") === "out_for_delivery");
  // A pickup order in out_for_delivery used to return null: no button, no way
  // forward, stuck for good. Two seeded orders were sitting in exactly that
  // state.
  ok("pickup stuck in out_for_delivery → completed",
    nextStatus("out_for_delivery", "pickup") === "completed",
    `got ${nextStatus("out_for_delivery", "pickup")}`);

  // The real guarantee: no non-terminal status is a dead end, for either
  // fulfilment type. Enumerated rather than spot-checked, so a status added
  // later cannot quietly strand orders the way this one did.
  const ALL = ["pending", "confirmed", "preparing", "ready", "out_for_delivery"];
  const dead = ALL.flatMap((s) =>
    (["delivery", "pickup"] as const)
      .filter((f) => nextStatus(s, f) === null)
      .map((f) => `${s}/${f}`)
  );
  ok("every non-terminal status can still advance", dead.length === 0,
    dead.length ? `stranded: ${dead.join(", ")}` : `${ALL.length * 2} combinations`);

  console.log("\n3. Who may cancel outright");
  ok("staff may not approve", !canApproveCancel("staff"));
  ok("manager may approve", canApproveCancel("manager"));
  ok("super_admin may approve", canApproveCancel("super_admin"));
  ok("completed cannot be cancelled", !canCancel("completed"));

  const admin = (await c.query(`select id, full_name from admin_users limit 1`)).rows[0];
  const store = (await c.query(`select id from stores where is_active limit 1`)).rows[0];
  const inv = (await c.query(
    `select si.id, ps.id size_id, p.id product_id, p.name, ps.label, si.effective_price::text price
       from store_inventory si
       join product_sizes ps on ps.id = si.product_size_id
       join products p on p.id = ps.product_id
      where si.store_id = $1 and si.stock > 0 limit 1`,
    [store.id]
  )).rows[0];

  // Captured, never hardcoded: a half-failed run would otherwise make every
  // later run fail against a constant that no longer describes reality.
  const baselineUnits = (await c.query(`select coalesce(sum(stock),0)::int n from store_inventory`)).rows[0].n;

  const made: string[] = [];
  const makeOrder = async (key: string, fulfillment = "pickup") => {
    // status omitted on purpose — proves the column default.
    const r = await c.query(
      `insert into orders (idempotency_key, store_id, payment_status, fulfillment_type,
          customer_name, customer_phone, address_line, subtotal, delivery_fee, discount_total, vat_amount)
       values ($1,$2,'unpaid',$3::fulfillment_type,'Flow Probe','09171234567',$4,$5,0,0,0)
       returning id, status::text st`,
      [TAG + key, store.id, fulfillment, fulfillment === "delivery" ? "1 Test St." : null, inv.price]
    );
    await c.query(
      `insert into order_items (order_id, store_inventory_id, product_id, product_size_id,
          product_name, size_label, unit_price, quantity)
       values ($1,$2,$3,$4,$5,$6,$7,2)`,
      [r.rows[0].id, inv.id, inv.product_id, inv.size_id, inv.name, inv.label, inv.price]
    );
    made.push(r.rows[0].id);
    return r.rows[0];
  };

  const asAdmin = async (sql: string, params: unknown[]) => {
    await c.query("begin");
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: admin.id })]);
    await c.query(sql, params);
    await c.query("commit");
  };

  try {
    console.log("\n4. New orders start in preparing");
    const fresh = await makeOrder("default");
    ok("column default is 'preparing'", fresh.st === "preparing", `got ${fresh.st}`);

    console.log("\n5. Staff request → manager approves");
    const a = await makeOrder("approve");
    // A placed order takes its stock. Before deduct_order_stock existed this
    // step happened nowhere, yet cancelling still credited inventory — the bug
    // this assertion used to hide by passing.
    await c.query(`select deduct_order_stock($1::uuid, $2::uuid)`, [a.id, admin.id]);
    await asAdmin(
      `update orders set cancel_requested_at=now(), cancel_requested_by=$2, cancel_request_reason='customer changed mind' where id=$1`,
      [a.id, admin.id]
    );
    const requested = (await c.query(`select status::text st, cancel_requested_at from orders where id=$1`, [a.id])).rows[0];
    ok("status unchanged while awaiting approval", requested.st === "preparing", `got ${requested.st}`);
    ok("request recorded", requested.cancel_requested_at !== null);

    // Sampled after the deduction above, so the delta measures the restore.
    const stockBefore = (await c.query(`select stock from store_inventory where id=$1`, [inv.id])).rows[0].stock;
    await asAdmin(
      `update orders set status='cancelled', cancel_reason=cancel_request_reason,
          cancel_requested_at=null, cancel_requested_by=null, cancel_request_reason=null where id=$1`,
      [a.id]
    );
    const approved = (await c.query(
      `select status::text st, cancel_reason, cancel_requested_at from orders where id=$1`, [a.id]
    )).rows[0];
    const stockAfter = (await c.query(`select stock from store_inventory where id=$1`, [inv.id])).rows[0].stock;
    ok("approving cancels the order", approved.st === "cancelled");
    ok("reason carried over from the request", approved.cancel_reason === "customer changed mind");
    ok("request cleared once resolved", approved.cancel_requested_at === null);
    ok("stock returned on approval", stockAfter - stockBefore === 2, `${stockBefore} → ${stockAfter}`);
    ok("restore only happens because the order had deducted",
      (await c.query(
        `select stock_deducted_at is not null d, stock_restored_at is not null r from orders where id=$1`,
        [a.id]
      )).rows[0].d === true);

    console.log("\n6. Manager declines → order continues");
    const d = await makeOrder("decline");
    await asAdmin(
      `update orders set cancel_requested_at=now(), cancel_requested_by=$2, cancel_request_reason='mistake' where id=$1`,
      [d.id, admin.id]
    );
    await asAdmin(
      `update orders set cancel_requested_at=null, cancel_requested_by=null, cancel_request_reason=null where id=$1`,
      [d.id]
    );
    const declined = (await c.query(
      `select status::text st, cancel_requested_at, cancelled_at from orders where id=$1`, [d.id]
    )).rows[0];
    ok("still preparing after a decline", declined.st === "preparing", `got ${declined.st}`);
    ok("request cleared", declined.cancel_requested_at === null);
    ok("never cancelled", declined.cancelled_at === null);

    console.log("\n7. Audit trail attributes the actor");
    const p = await makeOrder("audit", "delivery");
    await asAdmin(`update orders set status='out_for_delivery' where id=$1`, [p.id]);
    const h = (await c.query(
      `select h.to_status::text s, au.full_name
         from order_status_history h left join admin_users au on au.id=h.changed_by
        where h.order_id=$1 order by h.created_at desc limit 1`,
      [p.id]
    )).rows[0];
    ok("transition attributed to the acting admin", h.full_name === admin.full_name,
      `${h.s} by ${h.full_name ?? "null"}`);
  } finally {
    for (const id of made) {
      // Net stock effect to undo:
      //   deducted + restored  -> 0, nothing to do
      //   deducted, not restored -> -qty, add it back
      //   never deducted        -> 0, nothing to do
      // The old version also subtracted for every restore, which only balanced
      // while restores happened without a matching deduction.
      await c.query(
        `update store_inventory si set stock = si.stock + oi.quantity
           from order_items oi
          where oi.order_id = $1 and oi.store_inventory_id = si.id
            and exists (select 1 from orders o
                         where o.id = $1
                           and o.stock_deducted_at is not null
                           and o.stock_restored_at is null)`,
        [id]
      );
      await c.query(`delete from inventory_movements where order_id=$1`, [id]);
    }
    await c.query(`delete from orders where idempotency_key like $1`, [TAG + "%"]);
    const units = (await c.query(`select coalesce(sum(stock),0)::int n from store_inventory`)).rows[0].n;
    console.log(`\n  cleanup done · inventory_units ${units} (expected ${baselineUnits})`);
    if (units !== baselineUnits) { fail++; console.log("  \x1b[31mFAIL\x1b[0m inventory not restored"); }
    await c.end();
  }

  console.log(`\n${fail === 0 ? "\x1b[32m" : "\x1b[31m"}${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("\ncheck failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
