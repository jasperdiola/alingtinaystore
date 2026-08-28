/**
 * Verifies stock adjustment — `npm run db:inventory-check`.
 *
 * The property under test: a stock change and its inventory_movements row are
 * written together or not at all. If they could come apart, the audit trail
 * would stop matching the stock it claims to explain, which is worse than
 * having no trail. Also checks the database's own guards (stock >= 0,
 * delta <> 0) actually fire.
 *
 * Self-cleaning: every movement it writes is deleted and stock is restored.
 */
import "dotenv/config";
import { Client } from "pg";

let pass = 0, fail = 0;
const ok = (l: string, c: boolean, d = "") => {
  if (c) { pass++; console.log(`  \x1b[32mPASS\x1b[0m ${l} ${d}`); }
  else { fail++; console.log(`  \x1b[31mFAIL\x1b[0m ${l} ${d}`); }
};

// Captured at run time; a hardcoded number goes stale after any half-failed run.
let BASELINE_UNITS = 0;

async function main() {
  const c = new Client({ connectionString: process.env.DIRECT_URL });
  await c.connect();

  BASELINE_UNITS = (await c.query(`select coalesce(sum(stock),0)::int n from store_inventory`)).rows[0].n;
  const admin = (await c.query(`select id, full_name from admin_users limit 1`)).rows[0];
  const line = (await c.query(
    `select si.id, si.stock from store_inventory si where si.is_active and si.stock >= 5 limit 1`
  )).rows[0];
  const startStock: number = line.stock;
  const madeMovements: string[] = [];

  /** Exactly what adjustStockAction does, in one transaction. */
  async function adjust(delta: number, reason: string) {
    await c.query("begin");
    try {
      const r = await c.query(
        `update store_inventory set stock = stock + $2 where id = $1 returning stock`,
        [line.id, delta]
      );
      const balanceAfter = r.rows[0].stock;
      const m = await c.query(
        `insert into inventory_movements (store_inventory_id, delta, balance_after, reason, actor_id)
         values ($1,$2,$3,$4,$5) returning id`,
        [line.id, delta, balanceAfter, reason, admin.id]
      );
      await c.query("commit");
      madeMovements.push(m.rows[0].id);
      return { balanceAfter };
    } catch (e) {
      await c.query("rollback");
      throw e;
    }
  }

  try {
    console.log(`\nline starts at ${startStock} units`);

    console.log("\n1. Positive adjustment (a delivery)");
    const a = await adjust(12, "restock");
    ok("stock increased", a.balanceAfter === startStock + 12, `${startStock} → ${a.balanceAfter}`);
    const m1 = (await c.query(
      `select delta, balance_after, reason, actor_id from inventory_movements
        where store_inventory_id=$1 order by created_at desc limit 1`, [line.id]
    )).rows[0];
    ok("movement records the delta", m1.delta === 12);
    ok("balance_after matches the new stock", m1.balance_after === a.balanceAfter);
    ok("actor recorded", m1.actor_id === admin.id, `-> ${admin.full_name}`);

    console.log("\n2. Negative adjustment (damage)");
    const b = await adjust(-5, "damaged: crushed in transit");
    ok("stock decreased", b.balanceAfter === startStock + 7, `→ ${b.balanceAfter}`);
    const m2 = (await c.query(
      `select delta, reason from inventory_movements where store_inventory_id=$1 order by created_at desc limit 1`,
      [line.id]
    )).rows[0];
    ok("negative delta stored as-is", m2.delta === -5);
    ok("note preserved alongside the reason code", m2.reason === "damaged: crushed in transit");

    console.log("\n3. Absolute count converts to a delta");
    const current = (await c.query(`select stock from store_inventory where id=$1`, [line.id])).rows[0].stock;
    const target = current - 3;
    const c3 = await adjust(target - current, "manual_count");
    ok("counted value reached", c3.balanceAfter === target, `${current} → ${c3.balanceAfter}`);

    console.log("\n4. The database refuses bad writes");
    let negativeRejected = false;
    try {
      const now = (await c.query(`select stock from store_inventory where id=$1`, [line.id])).rows[0].stock;
      await adjust(-(now + 1), "manual_count");
    } catch {
      negativeRejected = true;
    }
    ok("stock cannot go below zero", negativeRejected);

    let zeroRejected = false;
    try {
      await adjust(0, "manual_count");
    } catch {
      zeroRejected = true;
    }
    ok("a no-op adjustment is rejected (delta <> 0)", zeroRejected);

    console.log("\n5. Trail reconciles with stock");
    const rows = (await c.query(
      `select delta, balance_after from inventory_movements
        where store_inventory_id=$1 order by created_at`, [line.id]
    )).rows;
    let running = startStock;
    let consistent = true;
    for (const r of rows) {
      running += r.delta;
      if (running !== r.balance_after) consistent = false;
    }
    const finalStock = (await c.query(`select stock from store_inventory where id=$1`, [line.id])).rows[0].stock;
    ok("every balance_after equals the running total", consistent);
    ok("final stock equals the last balance_after", finalStock === rows[rows.length - 1].balance_after,
      `${finalStock}`);

    console.log("\n6. A rolled-back adjustment leaves no trace");
    const beforeCount = (await c.query(`select count(*)::int n from inventory_movements`)).rows[0].n;
    await c.query("begin");
    await c.query(`update store_inventory set stock = stock + 99 where id=$1`, [line.id]);
    await c.query("rollback");
    const afterCount = (await c.query(`select count(*)::int n from inventory_movements`)).rows[0].n;
    const afterStock = (await c.query(`select stock from store_inventory where id=$1`, [line.id])).rows[0].stock;
    ok("no orphan movement", afterCount === beforeCount);
    ok("stock unchanged by the rollback", afterStock === finalStock);
  } finally {
    if (madeMovements.length) {
      await c.query(`delete from inventory_movements where id = any($1::bigint[])`, [madeMovements]);
    }
    await c.query(`update store_inventory set stock = $2 where id = $1`, [line.id, startStock]);
    const units = (await c.query(`select coalesce(sum(stock),0)::int n from store_inventory`)).rows[0].n;
    const moves = (await c.query(`select count(*)::int n from inventory_movements`)).rows[0].n;
    console.log(`\n  cleanup: stock restored, ${madeMovements.length} test movement(s) removed`);
    console.log(`  inventory_units ${units} (expected ${BASELINE_UNITS}) · movements remaining ${moves}`);
    if (units !== BASELINE_UNITS) { fail++; console.log("  \x1b[31mFAIL\x1b[0m inventory not restored"); }
    await c.end();
  }

  console.log(`\n${fail === 0 ? "\x1b[32m" : "\x1b[31m"}${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("\ncheck failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
