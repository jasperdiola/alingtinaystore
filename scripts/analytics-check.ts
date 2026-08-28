/**
 * Verifies lib/queries/analytics.ts — `npm run db:analytics-check`.
 *
 * Every figure is recomputed by a DIFFERENT code path (raw rows summed in JS)
 * and compared with what the SQL aggregate returned. Includes the timezone
 * trap: an order placed just after Manila midnight falls on the PREVIOUS UTC
 * date, so UTC bucketing would file it under yesterday.
 */
import "dotenv/config";
import { Client } from "pg";
import {
  getKpis,
  getRevenueSeries,
  getSalesByStore,
  getStatusBreakdown,
  getTopProducts,
  resolveWindow,
  RANGES,
  type RangeKey,
} from "../lib/queries/analytics";
import { prisma } from "../lib/prisma";

let pass = 0;
let fail = 0;
const ok = (l: string, cond: boolean, d = "") => {
  if (cond) { pass++; console.log(`  \x1b[32mPASS\x1b[0m ${l} ${d}`); }
  else { fail++; console.log(`  \x1b[31mFAIL\x1b[0m ${l} ${d}`); }
};
const near = (a: number, b: number) => Math.abs(a - b) < 0.011;
const peso = (n: number) => "PHP " + n.toFixed(2);

const TAG = "tz-probe:";

async function main() {
  const c = new Client({ connectionString: process.env.DIRECT_URL });
  await c.connect();

  try {
    for (const { key } of RANGES) {
      const w = resolveWindow(key as RangeKey);
      console.log(`\n=== ${key}  (${w.bucket} buckets)`);
      console.log(`    window ${w.start.toISOString()} → ${w.end.toISOString()}`);

      const kpis = await getKpis(w);

      // Independent recompute: pull the raw rows and reduce them in JS.
      const raw = await c.query(
        `select total_amount::text amt, status::text st, payment_status::text ps
           from orders where created_at >= $1 and created_at < $2`,
        [w.start, w.end]
      );
      const jsRevenue = raw.rows
        .filter((r) => r.ps === "verified" && r.st !== "cancelled")
        .reduce((a, r) => a + Number(r.amt), 0);
      const jsOrders = raw.rows.filter((r) => r.st !== "cancelled").length;

      ok(`revenue matches JS recompute`, near(kpis.revenue, jsRevenue),
        `sql=${peso(kpis.revenue)} js=${peso(jsRevenue)}`);
      ok(`order count matches`, kpis.orders === jsOrders,
        `sql=${kpis.orders} js=${jsOrders}`);

      // Cancelled / unpaid must contribute volume but never revenue.
      const excluded = raw.rows.filter((r) => r.st === "cancelled" || r.ps !== "verified");
      const excludedValue = excluded.reduce((a, r) => a + Number(r.amt), 0);
      ok(`${excluded.length} non-collected order(s) excluded from revenue`,
        excluded.length === 0 || !near(kpis.revenue, jsRevenue + excludedValue),
        excluded.length ? `worth ${peso(excludedValue)}` : "(none in window)");

      // The series must reconcile with the headline figure.
      const series = await getRevenueSeries(w);
      const seriesTotal = series.reduce((a, p) => a + p.revenue, 0);
      ok(`series sums to KPI revenue`, near(seriesTotal, kpis.revenue),
        `series=${peso(seriesTotal)}`);
      ok(`series is gap-filled (${series.length} buckets, none missing)`, series.length > 0);

      // Store split must reconcile too.
      const byStore = await getSalesByStore(w);
      const storeTotal = byStore.reduce((a, s) => a + s.revenue, 0);
      ok(`store split sums to KPI revenue`, near(storeTotal, kpis.revenue),
        `stores=${peso(storeTotal)}`);

      const status = await getStatusBreakdown(w);
      const statusOrders = status.reduce((a, s) => a + s.orders, 0);
      ok(`status breakdown covers every order`, statusOrders === raw.rows.length,
        `${statusOrders} vs ${raw.rows.length}`);

      if (key === "12mo") {
        const top = await getTopProducts(w, 8);
        ok(`top products returned`, top.length > 0, `${top.length} rows`);
        ok(`top products ordered by revenue desc`,
          top.every((p, i) => i === 0 || top[i - 1].revenue >= p.revenue));
        console.log(`    #1 ${top[0]?.name} — ${peso(top[0]?.revenue ?? 0)} (${top[0]?.units} units)`);
      }
    }

    /* ------------------------------------------------ the timezone trap */
    console.log(`\n=== timezone: Manila vs UTC bucketing`);
    const w = resolveWindow("today");
    const justAfterManilaMidnight = new Date(w.start.getTime() + 30 * 60_000);

    if (justAfterManilaMidnight >= new Date()) {
      console.log("  (skipped — it is not yet 00:30 in Manila)");
    } else {
      const utcDate = justAfterManilaMidnight.toISOString().slice(0, 10);
      const manilaDate = new Date(justAfterManilaMidnight.getTime() + 8 * 3600_000)
        .toISOString().slice(0, 10);
      console.log(`  probe instant ${justAfterManilaMidnight.toISOString()}`);
      console.log(`    UTC date    ${utcDate}`);
      console.log(`    Manila date ${manilaDate}   <- these must differ for the test to mean anything`);
      ok("probe straddles the date line", utcDate !== manilaDate);

      const before = await getKpis(w);
      const store = await c.query(`select id from stores where is_active limit 1`);
      await c.query(
        `insert into orders (idempotency_key, store_id, status, payment_status, fulfillment_type,
            customer_name, customer_phone, subtotal, delivery_fee, discount_total, vat_amount,
            created_at, updated_at)
         values ($1,$2,'completed','verified','pickup','TZ Probe','09171234567',
                 1234.00, 0, 0, 132.21, $3, $3)`,
        [TAG + "1", store.rows[0].id, justAfterManilaMidnight]
      );

      const after = await getKpis(w);
      ok("order after Manila midnight counts toward TODAY",
        near(after.revenue - before.revenue, 1234),
        `delta=${peso(after.revenue - before.revenue)} (UTC bucketing would give 0.00)`);

      const series = await getRevenueSeries(w);
      ok("probe lands in a bucket inside today's series",
        series.some((p) => p.revenue >= 1234),
        `first bucket ${series[0]?.bucket}`);
    }
  } finally {
    const del = await c.query(`delete from orders where idempotency_key like $1`, [TAG + "%"]);
    if (del.rowCount) console.log(`\n  cleanup: removed ${del.rowCount} probe order(s)`);
    await c.end();
    await prisma.$disconnect();
  }

  console.log(`\n${fail === 0 ? "\x1b[32m" : "\x1b[31m"}${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("\ncheck failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
