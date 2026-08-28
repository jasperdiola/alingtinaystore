/**
 * Verifies the price audit trail — `npm run db:price-check`.
 *
 * The claims under test:
 *   1. every price write is logged, whatever route it arrives by;
 *   2. the log names who did it when the actor context is set;
 *   3. the cascade to follower branches is NOT logged, so one decision
 *      produces one row rather than one row per branch;
 *   4. a no-op write logs nothing;
 *   5. the snapshot survives the thing it describes.
 *
 * Every price it touches is restored at the end, and every row it wrote is
 * deleted — the table is an audit log, so leaving test rows behind would
 * corrupt the very record this is meant to protect.
 */
import "dotenv/config";
import { Client } from "pg";

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

  const admin = (await c.query(`select id, full_name, email from admin_users limit 1`)).rows[0];
  const adminName = admin.full_name ?? admin.email;

  // A size stocked in more than one branch, so the cascade has somewhere to go.
  const size = (
    await c.query(`
      select ps.id, ps.label, ps.price::text price, p.id product_id, p.name
        from product_sizes ps
        join products p on p.id = ps.product_id
       where (select count(*) from store_inventory si where si.product_size_id = ps.id) > 1
       order by ps.id limit 1`)
  ).rows[0];

  const line = (
    await c.query(
      `select si.id, si.price_override::text ovr, si.store_id, s.name store_name
         from store_inventory si join stores s on s.id = si.store_id
        where si.product_size_id = $1 order by si.id limit 1`,
      [size.id]
    )
  ).rows[0];

  const product = (
    await c.query(`select id, name, base_price::text bp from products where id = $1`, [
      size.product_id,
    ])
  ).rows[0];

  // Captured, never hardcoded — a half-failed run must not poison later runs.
  const baseline = {
    sizePrice: size.price,
    override: line.ovr as string | null,
    basePrice: product.bp,
    logRows: (await c.query(`select count(*)::int n from price_history`)).rows[0].n,
  };
  const followers = (
    await c.query(
      `select count(*)::int n from store_inventory where product_size_id=$1 and price_override is null`,
      [size.id]
    )
  ).rows[0].n;

  console.log(
    `\nprobe: ${product.name} (${size.label}) · catalog ₱${baseline.sizePrice} · ` +
      `${followers} follower branch${followers === 1 ? "" : "es"} · baseline ${baseline.logRows} log rows`
  );

  /** A write with the actor context set, exactly as withActor() does it. */
  const asAdmin = async (sql: string, params: unknown[]) => {
    await c.query("begin");
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: admin.id }),
    ]);
    await c.query(sql, params);
    await c.query("commit");
  };

  /*
   * A bigserial watermark, deliberately not a timestamp.
   *
   * The obvious `created_at >= new Date()` compares this machine's clock to the
   * database's. They differ by a fraction of a second, and now() is the
   * TRANSACTION start time, so the first write of the run lands just below the
   * local reading and vanishes from the results — which reads exactly like a
   * trigger that did not fire. The id sequence is monotonic and involves no
   * clock at all.
   */
  const watermark: string = (
    await c.query(`select coalesce(max(id), 0)::text n from price_history`)
  ).rows[0].n;

  const logged = async (scope?: string) =>
    (
      await c.query(
        `select scope, product_name, size_label, store_name,
                old_price::text op, new_price::text np, store_id,
                (select coalesce(au.full_name, au.email) from admin_users au where au.id = ph.changed_by) actor
           from price_history ph
          where id > $1 ${scope ? "and scope = $2" : ""}
          order by id`,
        scope ? [watermark, scope] : [watermark]
      )
    ).rows;

  try {
    console.log("\n1. Catalog price change");
    const newCatalog = (Number(baseline.sizePrice) + 7).toFixed(2);
    await asAdmin(`update product_sizes set price=$2 where id=$1`, [size.id, newCatalog]);
    const cat = await logged("catalog");
    ok("one row written", cat.length === 1, `got ${cat.length}`);
    ok("old and new price both captured",
      cat[0]?.op === baseline.sizePrice && cat[0]?.np === newCatalog,
      `${cat[0]?.op} → ${cat[0]?.np}`);
    ok("attributed to the acting admin", cat[0]?.actor === adminName, `got ${cat[0]?.actor ?? "null"}`);
    ok("product and size names snapshotted",
      cat[0]?.product_name === product.name && cat[0]?.size_label === size.label);

    console.log("\n2. The cascade to follower branches is not logged");
    // cascade_size_price() just rewrote effective_price on every follower. If
    // the audit watched effective_price instead of price_override, this would
    // be `followers` extra rows burying the one decision that caused them.
    const all = await logged();
    ok(`${followers} follower branches produced 0 extra rows`, all.length === 1,
      `${all.length} total row${all.length === 1 ? "" : "s"}`);

    console.log("\n3. A no-op write logs nothing");
    await asAdmin(`update product_sizes set price=$2 where id=$1`, [size.id, newCatalog]);
    ok("same value written twice → still one row", (await logged()).length === 1);
    // Proves the trigger keys on the value, not on the UPDATE statement.
    await asAdmin(`update product_sizes set updated_at=now() where id=$1`, [size.id]);
    ok("touching another column logs nothing", (await logged()).length === 1);

    console.log("\n4. Branch override");
    const ovr = (Number(newCatalog) + 13).toFixed(2);
    await asAdmin(`update store_inventory set price_override=$2 where id=$1`, [line.id, ovr]);
    const br = await logged("branch");
    ok("one row written", br.length === 1, `got ${br.length}`);
    ok("branch scope names the store", br[0]?.store_name === line.store_name,
      `got ${br[0]?.store_name ?? "null"}`);
    ok("store_id recorded for scoped access", br[0]?.store_id === line.store_id);
    ok("old override captured", br[0]?.op === baseline.override, `got ${br[0]?.op ?? "null"}`);
    ok("new override captured", br[0]?.np === ovr);

    console.log("\n5. Clearing an override is a change too");
    await asAdmin(`update store_inventory set price_override=null where id=$1`, [line.id]);
    const cleared = await logged("branch");
    ok("clearing logs a second row", cleared.length === 2, `got ${cleared.length}`);
    ok("null new_price records the return to catalog", cleared[1]?.np === null,
      `got ${cleared[1]?.np ?? "null"}`);

    console.log("\n6. Headline (storefront) price");
    const newBase = (Number(baseline.basePrice) + 5).toFixed(2);
    await asAdmin(`update products set base_price=$2 where id=$1`, [product.id, newBase]);
    const hl = await logged("headline");
    ok("one row written", hl.length === 1, `got ${hl.length}`);
    ok("scoped to the product, no size or store",
      hl[0]?.size_label === null && hl[0]?.store_name === null);

    console.log("\n7. The trigger cannot be bypassed");
    // No set_config: a raw write straight at the table, the way someone poking
    // at the SQL editor would do it. It must still be recorded — anonymously,
    // which is the honest answer rather than a missing row.
    await c.query(`update product_sizes set price=$2 where id=$1`, [size.id, baseline.sizePrice]);
    const bypass = await logged("catalog");
    ok("a raw SQL write is still logged", bypass.length === 2, `got ${bypass.length}`);
    ok("an unattributed write records no actor, rather than no row",
      bypass[1]?.actor === null, `got ${bypass[1]?.actor}`);

    console.log("\n8. Snapshots survive their subject");
    // The FK is ON DELETE SET NULL, not CASCADE. Simulated in a rolled-back
    // transaction so no real product is harmed.
    await c.query("begin");
    await c.query(`update price_history set product_id=null where id > $1`, [watermark]);
    const orphan = (
      await c.query(
        `select count(*)::int n from price_history where id > $1 and product_name = $2`,
        [watermark, product.name]
      )
    ).rows[0].n;
    await c.query("rollback");
    ok("a row with no product still names the product", orphan > 0, `${orphan} rows`);

    console.log("\n9. Row-level security is on");
    const rls = (
      await c.query(
        `select relrowsecurity r, (select count(*)::int from pg_policies where tablename='price_history') p
           from pg_class where relname='price_history'`
      )
    ).rows[0];
    ok("RLS enabled", rls.r === true);
    ok("a read policy exists", rls.p > 0, `${rls.p} polic${rls.p === 1 ? "y" : "ies"}`);
  } finally {
    console.log("\ncleanup");
    // Restore prices first: each restore writes its own audit row, so the
    // delete has to come last or it would leave the cleanup's own trail behind.
    await c.query(`update product_sizes set price=$2 where id=$1`, [size.id, baseline.sizePrice]);
    await c.query(`update store_inventory set price_override=$2 where id=$1`, [
      line.id,
      baseline.override,
    ]);
    await c.query(`update products set base_price=$2 where id=$1`, [product.id, baseline.basePrice]);
    await c.query(`delete from price_history where id > $1`, [watermark]);

    const after = {
      sizePrice: (await c.query(`select price::text p from product_sizes where id=$1`, [size.id]))
        .rows[0].p,
      override: (await c.query(`select price_override::text o from store_inventory where id=$1`, [line.id]))
        .rows[0].o,
      basePrice: (await c.query(`select base_price::text b from products where id=$1`, [product.id]))
        .rows[0].b,
      logRows: (await c.query(`select count(*)::int n from price_history`)).rows[0].n,
    };
    ok("catalog price restored", after.sizePrice === baseline.sizePrice,
      `${after.sizePrice} vs ${baseline.sizePrice}`);
    ok("branch override restored", after.override === baseline.override,
      `${after.override ?? "null"} vs ${baseline.override ?? "null"}`);
    ok("headline price restored", after.basePrice === baseline.basePrice);
    ok("audit log left exactly as found", after.logRows === baseline.logRows,
      `${after.logRows} vs ${baseline.logRows}`);

    // effective_price is derived; confirm the restore propagated back too.
    const drift = (
      await c.query(
        `select count(*)::int n from store_inventory si
           join product_sizes ps on ps.id = si.product_size_id
          where si.product_size_id = $1
            and si.effective_price is distinct from coalesce(si.price_override, ps.price)`,
        [size.id]
      )
    ).rows[0].n;
    ok("effective_price consistent across every branch", drift === 0, `${drift} drifted`);

    await c.end();
  }

  console.log(`\n${fail === 0 ? "\x1b[32m" : "\x1b[31m"}${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("\ncheck failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
