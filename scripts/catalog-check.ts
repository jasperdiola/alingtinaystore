/**
 * Verifies product create / edit / retire — `npm run db:catalog-check`.
 *
 * Two properties matter here:
 *
 *  1. A created product is immediately SELLABLE. products alone is not enough —
 *     without a size and a store_inventory row it can never reach an order, so
 *     the three inserts must be one transaction.
 *  2. Retiring never destroys history. order_items.product_id is ON DELETE SET
 *     NULL and every product already appears on order lines, so a delete would
 *     silently orphan them.
 *
 * Self-cleaning: the product it creates is hard-deleted (it has no history).
 */
import "dotenv/config";
import { Client } from "pg";

let pass = 0, fail = 0;
const ok = (l: string, c: boolean, d = "") => {
  if (c) { pass++; console.log(`  \x1b[32mPASS\x1b[0m ${l} ${d}`); }
  else { fail++; console.log(`  \x1b[31mFAIL\x1b[0m ${l} ${d}`); }
};

const SLUG = `catalog-check-${Date.now()}`;

async function main() {
  const c = new Client({ connectionString: process.env.DIRECT_URL });
  await c.connect();

  const cat = (await c.query(`select id, name from categories where is_active limit 1`)).rows[0];
  const stores = (await c.query(`select id, name from stores where is_active order by display_order`)).rows;
  const startUnits = (await c.query(`select coalesce(sum(stock),0)::int n from store_inventory`)).rows[0].n;
  let productId: string | null = null;

  try {
    console.log("\n1. Create makes a product that can actually be sold");
    await c.query("begin");
    const p = await c.query(
      `insert into products (name, slug, category_id, base_price, description, short_description)
       values ('Catalog Check Nuts', $1, $2, 250.00, 'probe', 'probe') returning id`,
      [SLUG, cat.id]
    );
    productId = p.rows[0].id;
    const size = await c.query(
      `insert into product_sizes (product_id, label, price) values ($1,'1 Kilo',250.00) returning id`,
      [productId]
    );
    const sizeId = size.rows[0].id;
    for (const s of stores) {
      await c.query(
        `insert into store_inventory (store_id, product_size_id, stock) values ($1,$2,12)`,
        [s.id, sizeId]
      );
    }
    await c.query("commit");

    const chain = (await c.query(
      `select count(*)::int n from products p
         join product_sizes ps on ps.product_id = p.id
         join store_inventory si on si.product_size_id = ps.id
        where p.id = $1`, [productId]
    )).rows[0].n;
    ok("products -> sizes -> store_inventory chain complete", chain === stores.length, `${chain} branch rows`);

    const eff = (await c.query(
      `select distinct effective_price::text e from store_inventory where product_size_id=$1`, [sizeId]
    )).rows;
    ok("effective_price derived by the trigger, not written by us",
      eff.length === 1 && Number(eff[0].e) === 250, `-> ${eff.map((x) => x.e).join(", ")}`);

    const sellable = (await c.query(
      `select count(*)::int n from store_inventory si
         join product_sizes ps on ps.id = si.product_size_id
         join products p on p.id = ps.product_id
        where p.id=$1 and p.is_active and ps.is_active and si.is_active and si.stock > 0`,
      [productId]
    )).rows[0].n;
    ok("appears in the POS sellable query", sellable === stores.length, `${sellable} lines`);

    console.log("\n2. Constraints still hold on the new product");
    let badSlug = false;
    try { await c.query(`update products set slug='Not A Slug' where id=$1`, [productId]); }
    catch { badSlug = true; }
    ok("slug format enforced", badSlug);

    let badCompare = false;
    try { await c.query(`update products set original_price = 10 where id=$1`, [productId]); }
    catch { badCompare = true; }
    ok("compare-at price must exceed price", badCompare);

    await c.query(`update products set original_price = 300 where id=$1`, [productId]);
    ok("a valid compare-at price is accepted",
      Number((await c.query(`select original_price::text o from products where id=$1`, [productId])).rows[0].o) === 300);

    console.log("\n3. Adding a second size reaches every chosen branch");
    const s2 = await c.query(
      `insert into product_sizes (product_id, label, price, display_order) values ($1,'1/2 Kilo',130.00,1) returning id`,
      [productId]
    );
    for (const s of stores) {
      await c.query(`insert into store_inventory (store_id, product_size_id, stock) values ($1,$2,5)`, [s.id, s2.rows[0].id]);
    }
    const sizes = (await c.query(
      `select count(*)::int n from product_sizes where product_id=$1 and is_active`, [productId]
    )).rows[0].n;
    ok("two active sizes", sizes === 2);

    console.log("\n4. Retire hides without destroying");
    await c.query(`update products set is_active=false where id=$1`, [productId]);
    const hidden = (await c.query(
      `select count(*)::int n from store_inventory si
         join product_sizes ps on ps.id=si.product_size_id
         join products p on p.id=ps.product_id
        where p.id=$1 and p.is_active`, [productId]
    )).rows[0].n;
    ok("retired product drops out of the sellable query", hidden === 0);
    const rowsIntact = (await c.query(
      `select count(*)::int n from store_inventory si
         join product_sizes ps on ps.id=si.product_size_id where ps.product_id=$1`, [productId]
    )).rows[0].n;
    ok("its inventory rows still exist", rowsIntact === stores.length * 2, `${rowsIntact} rows`);
    await c.query(`update products set is_active=true where id=$1`, [productId]);

    console.log("\n5. Why the editor retires instead of deleting");
    const withHistory = (await c.query(
      `select count(distinct p.id)::int n from products p join order_items oi on oi.product_id=p.id`
    )).rows[0].n;
    const totalProducts = (await c.query(`select count(*)::int n from products`)).rows[0].n;
    ok("every existing product has order history",
      withHistory === totalProducts - 1, `${withHistory} of ${totalProducts - 1} pre-existing`);
    const fk = (await c.query(`
      select pg_get_constraintdef(con.oid) def from pg_constraint con
       join pg_class rel on rel.oid=con.conrelid
      where rel.relname='order_items' and con.conname='order_items_product_id_fkey'`)).rows[0].def;
    ok("deleting one would SET NULL on its order lines", fk.includes("ON DELETE SET NULL"));
  } finally {
    if (productId) {
      // Safe: this probe product has no order history, so nothing is orphaned.
      await c.query(`delete from products where id=$1`, [productId]);
    }
    const units = (await c.query(`select coalesce(sum(stock),0)::int n from store_inventory`)).rows[0].n;
    const left = (await c.query(`select count(*)::int n from products where slug like 'catalog-check-%'`)).rows[0].n;
    console.log(`\n  cleanup: ${left} probe product(s) left · inventory_units ${units} (expected ${startUnits})`);
    if (left !== 0 || units !== startUnits) {
      fail++;
      console.log("  \x1b[31mFAIL\x1b[0m cleanup incomplete");
    }
    await c.end();
  }

  console.log(`\n${fail === 0 ? "\x1b[32m" : "\x1b[31m"}${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("\ncheck failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
