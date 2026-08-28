/**
 * Verifies price behaviour — `npm run db:pricing-check`.
 *
 * The property that matters: changing a catalog price must move the branches
 * that follow it and must NOT touch branches that deliberately set their own.
 * Your cascade_size_price() and sync_effective_price() triggers do this; these
 * checks prove it, because getting it wrong would silently re-price a branch.
 *
 * Restores every value it touches, including the price_history rows its own
 * writes now generate — that table is a real audit log, so a test suite must
 * not leave its probe values sitting in it.
 */
import "dotenv/config";
import { Client } from "pg";

let pass = 0, fail = 0;
const ok = (l: string, c: boolean, d = "") => {
  if (c) { pass++; console.log(`  \x1b[32mPASS\x1b[0m ${l} ${d}`); }
  else { fail++; console.log(`  \x1b[31mFAIL\x1b[0m ${l} ${d}`); }
};
const money = (v: unknown) => Number(v).toFixed(2);

async function main() {
  const c = new Client({ connectionString: process.env.DIRECT_URL });
  await c.connect();

  // A size present in every branch, so a cascade has something to move.
  const size = (await c.query(`
    select ps.id, ps.label, ps.price::text price, p.name
      from product_sizes ps
      join products p on p.id = ps.product_id
      join store_inventory si on si.product_size_id = ps.id
     group by ps.id, ps.label, ps.price, p.name
    having count(*) = 3
     limit 1`)).rows[0];

  const snapshot = (await c.query(
    `select id, price_override::text ovr, effective_price::text eff from store_inventory where product_size_id=$1 order by id`,
    [size.id]
  )).rows;

  // Captured, never hardcoded — a constant goes stale the moment any run
  // half-fails and leaves stock in a different place.
  const baselineUnits = (await c.query(
    `select coalesce(sum(stock),0)::int n from store_inventory`
  )).rows[0].n;

  // Monotonic id, not a timestamp: this machine's clock and the database's
  // differ by a fraction of a second, which is enough to miss the first write.
  const priceLogMark: string = (await c.query(
    `select coalesce(max(id), 0)::text n from price_history`
  )).rows[0].n;

  const baselineMoves = (await c.query(
    `select count(*)::int n from inventory_movements`
  )).rows[0].n;

  console.log(`\nusing "${size.name}" ${size.label} — catalog ${money(size.price)}`);

  try {
    /* ---------------------------------------------- set an override */
    console.log("\n1. A branch price overrides the catalog price");
    const target = snapshot[0];
    await c.query(`update store_inventory set price_override = 999.00 where id=$1`, [target.id]);
    const afterSet = (await c.query(
      `select price_override::text ovr, effective_price::text eff from store_inventory where id=$1`, [target.id]
    )).rows[0];
    ok("effective_price follows the override", money(afterSet.eff) === "999.00", `-> ${money(afterSet.eff)}`);
    ok("we never wrote effective_price ourselves — the trigger did", money(afterSet.ovr) === "999.00");

    /* ------------------------------------- cascade skips the pinned */
    console.log("\n2. Changing the catalog price moves only the followers");
    const newCatalog = (Number(size.price) + 7).toFixed(2);
    await c.query(`update product_sizes set price=$2 where id=$1`, [size.id, newCatalog]);

    const afterCascade = (await c.query(
      `select id, price_override::text ovr, effective_price::text eff from store_inventory where product_size_id=$1 order by id`,
      [size.id]
    )).rows;

    const pinned = afterCascade.find((r) => r.id === target.id)!;
    const followers = afterCascade.filter((r) => r.id !== target.id && r.ovr === null);

    ok("pinned branch kept its own price", money(pinned.eff) === "999.00", `-> ${money(pinned.eff)}`);
    ok(
      `${followers.length} follower(s) moved to the new catalog price`,
      followers.every((r) => money(r.eff) === newCatalog),
      `-> ${followers.map((r) => money(r.eff)).join(", ")} (expected ${newCatalog})`
    );

    /* ------------------------------------------- clearing an override */
    console.log("\n3. Clearing a branch price returns it to the catalog");
    await c.query(`update store_inventory set price_override = null where id=$1`, [target.id]);
    const cleared = (await c.query(
      `select price_override::text ovr, effective_price::text eff from store_inventory where id=$1`, [target.id]
    )).rows[0];
    ok("override removed", cleared.ovr === null);
    ok("effective_price fell back to catalog", money(cleared.eff) === newCatalog, `-> ${money(cleared.eff)}`);

    /* ------------------------------------------------ guards */
    console.log("\n4. The database refuses bad prices");
    let negOverride = false;
    try { await c.query(`update store_inventory set price_override=-1 where id=$1`, [target.id]); }
    catch { negOverride = true; }
    ok("negative branch price rejected", negOverride);

    let negCatalog = false;
    try { await c.query(`update product_sizes set price=-1 where id=$1`, [size.id]); }
    catch { negCatalog = true; }
    ok("negative catalog price rejected", negCatalog);

    /* ------------------------------------------------ no side effects */
    console.log("\n5. Pricing does not disturb stock");
    const units = (await c.query(`select coalesce(sum(stock),0)::int n from store_inventory`)).rows[0].n;
    ok("inventory unchanged by price edits", units === baselineUnits, `${units}`);
    // Counted as a DELTA against the start of this run, not against zero. The
    // old version asserted the whole table was empty, which held only while the
    // shop had never sold anything — the first real POS sale broke it.
    const moves = (await c.query(`select count(*)::int n from inventory_movements`)).rows[0].n;
    ok("no stock movements written by a price change", moves === baselineMoves,
      `${moves} total, ${moves - baselineMoves} new`);
  } finally {
    await c.query(`update product_sizes set price=$2 where id=$1`, [size.id, size.price]);
    for (const row of snapshot) {
      await c.query(`update store_inventory set price_override=$2 where id=$1`, [row.id, row.ovr]);
    }
    const restored = (await c.query(
      `select id, price_override::text ovr, effective_price::text eff from store_inventory where product_size_id=$1 order by id`,
      [size.id]
    )).rows;
    const exact = restored.every((r, i) =>
      String(r.ovr) === String(snapshot[i].ovr) && money(r.eff) === money(snapshot[i].eff)
    );
    console.log(`\n  restored catalog price and ${snapshot.length} branch rows`);
    if (!exact) { fail++; console.log("  \x1b[31mFAIL\x1b[0m original prices not restored exactly"); }
    else console.log("  original prices verified byte-for-byte");

    // The restores above are themselves price changes, so the audit triggers
    // logged them too. Delete after restoring, never before, or the restore's
    // own rows outlive the cleanup.
    const wiped = (await c.query(`delete from price_history where id > $1`, [priceLogMark])).rowCount ?? 0;
    const left = (await c.query(
      `select count(*)::int n from price_history where id > $1`, [priceLogMark]
    )).rows[0].n;
    console.log(`  removed ${wiped} price_history row${wiped === 1 ? "" : "s"} written by this run`);
    if (left !== 0) { fail++; console.log("  \x1b[31mFAIL\x1b[0m audit log not left as found"); }

    await c.end();
  }

  console.log(`\n${fail === 0 ? "\x1b[32m" : "\x1b[31m"}${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("\ncheck failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
