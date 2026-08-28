/**
 * Verifies order stock movement — `npm run db:stock-check`.
 *
 * The bug this closes was live, not hypothetical: restore_stock_on_cancel fired
 * unconditionally, so cancelling any order that had never deducted invented
 * inventory out of nothing. Every one of the seeded orders could do it.
 *
 * Properties under test:
 *   - deduct_order_stock takes stock exactly once (idempotent on retry)
 *   - it refuses to oversell, and rolls the whole order back when it does
 *   - cancelling an order that DID deduct gives the stock back
 *   - cancelling an order that never deducted changes nothing
 *
 * Self-cleaning: every order it creates is reversed and deleted.
 */
import "dotenv/config";
import { Client } from "pg";

const TAG = "stock-check:";
let pass = 0, fail = 0;
const ok = (l: string, c: boolean, d = "") => {
  if (c) { pass++; console.log(`  \x1b[32mPASS\x1b[0m ${l} ${d}`); }
  else { fail++; console.log(`  \x1b[31mFAIL\x1b[0m ${l} ${d}`); }
};

async function main() {
  const c = new Client({ connectionString: process.env.DIRECT_URL });
  await c.connect();

  const admin = (await c.query(`select id from admin_users limit 1`)).rows[0];
  const inv = (await c.query(`
    select si.id, si.stock, si.store_id, ps.id size_id, p.id product_id, p.name, ps.label,
           si.effective_price::text price
      from store_inventory si
      join product_sizes ps on ps.id = si.product_size_id
      join products p on p.id = ps.product_id
     where si.is_active and si.stock >= 10 limit 1`)).rows[0];

  const baseline = (await c.query(`select coalesce(sum(stock),0)::int n from store_inventory`)).rows[0].n;
  const made: string[] = [];

  const newOrder = async (key: string, qty: number) => {
    const o = await c.query(
      `insert into orders (idempotency_key, order_code, store_id, payment_status, fulfillment_type,
          customer_name, subtotal, delivery_fee, discount_total, vat_amount)
       values ($1,'',$2,'verified','pickup','Stock Probe',$3,0,0,0) returning id`,
      [TAG + key, inv.store_id, (Number(inv.price) * qty).toFixed(2)]
    );
    const id = o.rows[0].id;
    await c.query(
      `insert into order_items (order_id, store_inventory_id, product_id, product_size_id,
          product_name, size_label, unit_price, quantity)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, inv.id, inv.product_id, inv.size_id, inv.name, inv.label, inv.price, qty]
    );
    made.push(id);
    return id;
  };

  const stockNow = async () =>
    (await c.query(`select stock from store_inventory where id=$1`, [inv.id])).rows[0].stock;

  try {
    console.log(`\nline starts at ${inv.stock} units`);

    console.log("\n1. Placing an order takes stock, once");
    const a = await newOrder("deduct", 3);
    const before = await stockNow();
    await c.query(`select deduct_order_stock($1::uuid, $2::uuid)`, [a, admin.id]);
    const after = await stockNow();
    ok("stock decremented", after === before - 3, `${before} → ${after}`);

    const stamped = (await c.query(
      `select stock_deducted_at is not null d from orders where id=$1`, [a]
    )).rows[0].d;
    ok("stock_deducted_at stamped", stamped);

    const mv = (await c.query(
      `select delta, balance_after, reason, actor_id from inventory_movements where order_id=$1`, [a]
    )).rows;
    ok("one movement, reason order_placed", mv.length === 1 && mv[0].reason === "order_placed");
    ok("movement balance matches live stock", mv[0].balance_after === after);
    ok("actor recorded", mv[0].actor_id === admin.id);

    // A retried checkout must not take stock twice.
    await c.query(`select deduct_order_stock($1::uuid, $2::uuid)`, [a, admin.id]);
    ok("second call is a no-op (idempotent)", (await stockNow()) === after, `${await stockNow()}`);
    ok("no duplicate movement",
      (await c.query(`select count(*)::int n from inventory_movements where order_id=$1`, [a])).rows[0].n === 1);

    console.log("\n2. Cancelling an order that DID deduct returns the stock");
    await c.query(`update orders set status='cancelled', cancel_reason='probe' where id=$1`, [a]);
    ok("stock returned", (await stockNow()) === before, `${await stockNow()}`);
    ok("restore movement written",
      (await c.query(
        `select count(*)::int n from inventory_movements where order_id=$1 and reason='order_cancelled'`, [a]
      )).rows[0].n === 1);

    console.log("\n3. Cancelling an order that never deducted changes NOTHING");
    console.log("   (this is the bug that was live before today)");
    const b = await newOrder("never-deducted", 4);
    const beforeB = (await c.query(`select coalesce(sum(stock),0)::int n from store_inventory`)).rows[0].n;
    const movesB = (await c.query(`select count(*)::int n from inventory_movements`)).rows[0].n;
    await c.query(`update orders set status='cancelled', cancel_reason='probe' where id=$1`, [b]);
    const afterB = (await c.query(`select coalesce(sum(stock),0)::int n from store_inventory`)).rows[0].n;
    const movesAfterB = (await c.query(`select count(*)::int n from inventory_movements`)).rows[0].n;
    ok("inventory unchanged", afterB === beforeB, `${beforeB} → ${afterB}`);
    ok("no phantom restore movement", movesAfterB === movesB);
    ok("cancelled_at still stamped",
      (await c.query(`select cancelled_at is not null x from orders where id=$1`, [b])).rows[0].x);

    console.log("\n4. Overselling is refused and rolls the order back");
    const live = await stockNow();
    const d = await newOrder("oversell", live + 5);
    let refused = false;
    let msg = "";
    await c.query("begin");
    try {
      await c.query(`select deduct_order_stock($1::uuid, null)`, [d]);
      await c.query("commit");
    } catch (e) {
      await c.query("rollback");
      refused = true;
      msg = e instanceof Error ? e.message : String(e);
    }
    ok("refused", refused, msg.split("\n")[0]);
    ok("names the item that ran out", msg.includes(inv.name), `"${inv.name}"`);
    ok("stock untouched by the failed attempt", (await stockNow()) === live, `${await stockNow()}`);
    ok("no partial movement written",
      (await c.query(`select count(*)::int n from inventory_movements where order_id=$1`, [d])).rows[0].n === 0);
  } finally {
    for (const id of made) {
      // Undo any deduction this probe caused, then remove it.
      await c.query(
        `update store_inventory si set stock = si.stock + oi.quantity
           from order_items oi
          where oi.order_id = $1 and oi.store_inventory_id = si.id
            and exists (select 1 from orders o
                         where o.id = $1 and o.stock_deducted_at is not null
                           and o.stock_restored_at is null)`,
        [id]
      );
      await c.query(`delete from inventory_movements where order_id=$1`, [id]);
    }
    await c.query(`delete from orders where idempotency_key like $1`, [TAG + "%"]);
    const units = (await c.query(`select coalesce(sum(stock),0)::int n from store_inventory`)).rows[0].n;
    console.log(`\n  cleanup: ${made.length} probe order(s) reversed · inventory ${units} (expected ${baseline})`);
    if (units !== baseline) { fail++; console.log("  \x1b[31mFAIL\x1b[0m inventory not restored"); }
    await c.end();
  }

  console.log(`\n${fail === 0 ? "\x1b[32m" : "\x1b[31m"}${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("\ncheck failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
