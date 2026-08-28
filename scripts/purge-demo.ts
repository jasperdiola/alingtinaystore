/**
 * Remove everything `npm run db:seed-demo` created — `npm run db:purge-demo`.
 *
 * Matches on the `demo-seed:` idempotency_key tag only, so real orders are
 * never at risk. order_items and order_status_history cascade.
 */
import "dotenv/config";
import { Client } from "pg";

const TAG = "demo-seed:%";

async function main() {
  const c = new Client({ connectionString: process.env.DIRECT_URL });
  await c.connect();

  const before = await c.query(
    `select count(*)::int n from orders where idempotency_key like $1`,
    [TAG]
  );
  const real = await c.query(
    `select count(*)::int n from orders where idempotency_key is null or idempotency_key not like $1`,
    [TAG]
  );

  console.log(`demo orders: ${before.rows[0].n}   non-demo orders: ${real.rows[0].n} (untouched)`);
  if (before.rows[0].n === 0) {
    console.log("nothing to purge.");
    await c.end();
    return;
  }

  const del = await c.query(`delete from orders where idempotency_key like $1`, [TAG]);
  console.log(`deleted ${del.rowCount} order(s); items and status history cascaded.`);

  const after = await c.query(`
    select (select count(*) from orders)::int orders,
           (select count(*) from order_items)::int items,
           (select count(*) from order_status_history)::int history,
           (select coalesce(sum(stock),0) from store_inventory)::int inventory_units
  `);
  console.table(after.rows);
  await c.end();
}

main().catch((e) => {
  console.error("purge failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
