/**
 * Verifies voiding an order — `npm run db:void-check`.
 *
 * Voiding is the manager's remedy for an order that should never have been
 * placed. The claims that matter:
 *
 *   1. it is not a DELETE — the row, its items and its history all survive;
 *   2. the reason is mandatory, enforced by the database and not just the form;
 *   3. stock the order took comes back, and stock it never took does not;
 *   4. it disappears from the numbers — revenue, order counts, units and the
 *      status breakdown all behave as though it never happened.
 *
 * Point 4 is the one worth proving through the real code path rather than a
 * hand-written query: getKpis and friends are what the dashboard actually
 * calls, so they are what this asserts against.
 *
 * Everything it creates is tagged and removed at the end.
 */
import "dotenv/config";
import { Client } from "pg";
import { getKpis, getStatusBreakdown, resolveWindow } from "../lib/queries/analytics";
import { canApproveCancel, canDeleteOrder } from "../lib/orders/flow";

const TAG = "void-check:";
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

async function main() {
  const c = new Client({ connectionString: process.env.DIRECT_URL });
  await c.connect();

  console.log("\n1. Who may void (pure)");
  ok("staff may not", !canDeleteOrder("staff"));
  ok("manager may", canDeleteOrder("manager"));
  ok("super_admin may", canDeleteOrder("super_admin"));
  ok("same bar as cancelling, for now",
    ["staff", "manager", "super_admin"].every((r) => canDeleteOrder(r) === canApproveCancel(r)));

  const admin = (await c.query(`select id, full_name from admin_users limit 1`)).rows[0];
  const store = (await c.query(`select id from stores where is_active limit 1`)).rows[0];
  const inv = (
    await c.query(
      `select si.id, ps.id size_id, p.id product_id, p.name, ps.label,
              si.effective_price::text price, si.stock
         from store_inventory si
         join product_sizes ps on ps.id = si.product_size_id
         join products p on p.id = ps.product_id
        where si.store_id = $1 and si.stock > 5 limit 1`,
      [store.id]
    )
  ).rows[0];

  const baselineUnits = (
    await c.query(`select coalesce(sum(stock),0)::int n from store_inventory`)
  ).rows[0].n;

  const made: string[] = [];
  const makeOrder = async (key: string, qty = 2) => {
    const r = await c.query(
      `insert into orders (idempotency_key, store_id, payment_status, fulfillment_type,
          customer_name, customer_phone, subtotal, delivery_fee, discount_total, vat_amount)
       values ($1,$2,'verified','pickup','Void Probe','09171234567',$3,0,0,0)
       returning id, order_code`,
      [TAG + key, store.id, (Number(inv.price) * qty).toFixed(2)]
    );
    await c.query(
      `insert into order_items (order_id, store_inventory_id, product_id, product_size_id,
          product_name, size_label, unit_price, quantity)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [r.rows[0].id, inv.id, inv.product_id, inv.size_id, inv.name, inv.label, inv.price, qty]
    );
    made.push(r.rows[0].id);
    return r.rows[0];
  };

  /** Exactly what deleteOrderAction does, in one transaction. */
  const voidOrder = async (id: string, reason: string, alreadyCancelled = false) => {
    await c.query("begin");
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: admin.id }),
    ]);
    await c.query(
      `update orders set ${alreadyCancelled ? "" : "status='cancelled', cancel_reason=$3,"}
          deleted_at=now(), deleted_by=$2, delete_reason=$3 where id=$1`,
      [id, admin.id, reason]
    );
    await c.query("commit");
  };

  try {
    console.log("\n2. The reason is mandatory, enforced by the database");
    const g = await makeOrder("guard");
    for (const [label, reason] of [
      ["no reason at all", null],
      ["blank", "   "],
      ["too short", "ab"],
    ] as const) {
      let rejected = false;
      try {
        await c.query(`update orders set deleted_at=now(), delete_reason=$2 where id=$1`, [g.id, reason]);
      } catch {
        rejected = true;
      }
      await c.query("rollback").catch(() => {});
      ok(`voiding with ${label} is refused`, rejected);
    }

    console.log("\n3. Stock the order took comes back");
    const a = await makeOrder("stock", 2);
    await c.query(`select deduct_order_stock($1::uuid, $2::uuid)`, [a.id, admin.id]);
    const afterDeduct = (await c.query(`select stock from store_inventory where id=$1`, [inv.id])).rows[0].stock;
    await voidOrder(a.id, "Rang up the wrong customer");
    const afterVoid = (await c.query(`select stock from store_inventory where id=$1`, [inv.id])).rows[0].stock;
    ok("the 2 units are returned", afterVoid - afterDeduct === 2, `${afterDeduct} → ${afterVoid}`);
    const row = (
      await c.query(
        `select deleted_at, delete_reason, stock_restored_at, status::text st,
                (select coalesce(full_name,email) from admin_users where id=deleted_by) by
           from orders where id=$1`,
        [a.id]
      )
    ).rows[0];
    ok("reason kept on the record", row.delete_reason === "Rang up the wrong customer");
    ok("attributed to the manager who voided it", row.by === (admin.full_name ?? null), `got ${row.by}`);
    ok("stock restore stamped", row.stock_restored_at !== null);
    ok("status is cancelled so it leaves the funnel too", row.st === "cancelled");

    console.log("\n4. Stock it never took is not handed back");
    const b = await makeOrder("nostock", 3);
    const before = (await c.query(`select stock from store_inventory where id=$1`, [inv.id])).rows[0].stock;
    await voidOrder(b.id, "Duplicate of the previous sale");
    const after = (await c.query(`select stock from store_inventory where id=$1`, [inv.id])).rows[0].stock;
    ok("inventory untouched", after === before, `${before} → ${after}`);
    ok("no phantom restore stamp",
      (await c.query(`select stock_restored_at from orders where id=$1`, [b.id])).rows[0].stock_restored_at === null);

    console.log("\n5. It is not a delete — the record survives");
    const kept = (
      await c.query(
        `select (select count(*)::int from order_items where order_id=$1) items,
                (select count(*)::int from order_status_history where order_id=$1) history,
                (select count(*)::int from orders where id=$1) row_still_there`,
        [a.id]
      )
    ).rows[0];
    ok("the order row is still there", kept.row_still_there === 1);
    ok("its line items survive", kept.items > 0, `${kept.items} item(s)`);
    ok("its status history survives", kept.history > 0, `${kept.history} entr(ies)`);

    console.log("\n6. It disappears from the numbers (via the real queries)");
    /*
     * The window is resolved AFTER the order exists, and the same window is
     * used for both reads.
     *
     * resolveWindow() ends the range at the moment it is called, so resolving
     * first puts a freshly created order past w.end: it looks excluded when it
     * was simply out of range, and the void assertions then pass without ever
     * having had anything to remove. Voiding is now the only thing that changes
     * between the two reads, so the difference is exactly this order.
     */
    const live = await makeOrder("live", 1);
    const placed = (
      await c.query(`select created_at, total_amount::text t from orders where id=$1`, [live.id])
    ).rows[0];
    const liveTotal = Number(placed.t);

    /*
     * Wait for this machine's clock to pass the timestamp Postgres gave the
     * order.
     *
     * resolveWindow() ends "today" at new Date() — the APP's clock — while
     * created_at comes from the DATABASE's. The two differ by a second or so in
     * either direction, so an order placed now can be stamped just after the
     * window that is supposed to contain it, and the assertions below would
     * measure a removal that never happened. Waiting removes the clock from the
     * test; the underlying skew is noted in the report.
     */
    const stamped = new Date(placed.created_at).getTime();
    while (Date.now() <= stamped) {
      await new Promise((r) => setTimeout(r, 100));
    }

    const w = resolveWindow("today");
    ok("the probe order falls inside today's window",
      new Date(placed.created_at) >= w.start && new Date(placed.created_at) < w.end);
    const kpiWithLive = await getKpis(w);

    await voidOrder(live.id, "Cashier hit complete by mistake");
    const kpiAfterVoid = await getKpis(w);

    const revenueDrop = Number(kpiWithLive.revenue) - Number(kpiAfterVoid.revenue);
    ok("voiding removes exactly its revenue", revenueDrop === liveTotal,
      `dropped ${revenueDrop.toFixed(2)}, order was ${liveTotal.toFixed(2)}`);
    ok("voiding removes exactly one order",
      kpiWithLive.orders - kpiAfterVoid.orders === 1, `${kpiWithLive.orders} → ${kpiAfterVoid.orders}`);
    ok("voiding removes its units",
      kpiWithLive.units - kpiAfterVoid.units === 1, `${kpiWithLive.units} → ${kpiAfterVoid.units}`);

    // The status breakdown is a plain COUNT(*) with no FILTER, so it is the
    // aggregate most likely to leak a voided order back in.
    const breakdown = await getStatusBreakdown(w);
    const counted = breakdown.reduce((a, s) => a + s.orders, 0);
    const liveToday = (
      await c.query(
        `select count(*)::int n from orders
          where deleted_at is null
            and date_trunc('day', created_at at time zone 'Asia/Manila')
              = date_trunc('day', now() at time zone 'Asia/Manila')`
      )
    ).rows[0].n;
    ok("status breakdown counts only live orders", counted === liveToday,
      `breakdown ${counted} vs live ${liveToday}`);
  } finally {
    console.log("\ncleanup");
    for (const id of made) {
      // Net stock effect to undo, exactly as in orders-check:
      //   deducted + restored    -> 0, nothing to do
      //   deducted, not restored -> -qty, add it back
      //   never deducted         -> 0, nothing to do
      // An earlier version subtracted whenever an order had been restored,
      // which double-corrected and permanently removed real units.
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
    }
    await c.query(`delete from orders where idempotency_key like $1`, [TAG + "%"]);
    const units = (await c.query(`select coalesce(sum(stock),0)::int n from store_inventory`)).rows[0].n;
    ok("inventory restored to baseline", units === baselineUnits, `${units} vs ${baselineUnits}`);
    const leftovers = (
      await c.query(`select count(*)::int n from orders where idempotency_key like $1`, [TAG + "%"])
    ).rows[0].n;
    ok("no probe orders left behind", leftovers === 0);
    await c.end();
  }

  console.log(`\n${fail === 0 ? "\x1b[32m" : "\x1b[31m"}${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("\ncheck failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
