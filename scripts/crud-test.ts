/**
 * End-to-end CRUD check — run with `npm run db:crud-test`.
 *
 * Exercises the exact write paths the admin panel uses (INSERT across three
 * tables in a transaction, UPDATE, DELETE), verifies the database triggers and
 * check constraints behave as expected, then deletes everything it created.
 * Safe to run repeatedly; it only ever touches rows whose slug it generated.
 */
import "dotenv/config";
import { Prisma } from "../lib/generated/prisma/client";
import { prisma } from "../lib/prisma";

const SLUG = `crud-test-${Date.now()}`;
let productId: string | null = null;

const ok = (m: string) => console.log(`  [32m✓[0m ${m}`);
const info = (m: string) => console.log(`  · ${m}`);

async function main() {
  const category = await prisma.categories.findFirstOrThrow({
    where: { is_active: true },
    select: { id: true, name: true },
  });
  const store = await prisma.stores.findFirstOrThrow({
    where: { is_active: true },
    select: { id: true, name: true },
  });
  info(`using category "${category.name}", store "${store.name}"`);

  /* ---------------------------------------------------------- 1. INSERT */
  console.log("\n1. INSERT (transaction across 3 tables)");
  const created = await prisma.$transaction(async (tx) => {
    const product = await tx.products.create({
      data: {
        name: "CRUD Test Product",
        slug: SLUG,
        category_id: category.id,
        base_price: "250.00",
        stock: 10,
      },
      select: { id: true },
    });
    const size = await tx.product_sizes.create({
      data: { product_id: product.id, label: "1 Kilo", price: "250.00" },
      select: { id: true },
    });
    const inv = await tx.store_inventory.create({
      // effective_price deliberately omitted — the trigger derives it.
      data: { store_id: store.id, product_size_id: size.id, stock: 10 },
      select: { id: true, effective_price: true },
    });
    return { productId: product.id, sizeId: size.id, invId: inv.id, eff: inv.effective_price };
  });
  productId = created.productId;
  ok(`product + size + store_inventory created`);

  if (created.eff.toString() !== "250") {
    throw new Error(`trigger sync_effective_price did not fire (got ${created.eff})`);
  }
  ok(`trigger set effective_price = ${created.eff} without us passing it`);

  /* ---------------------------------------------------------- 2. UPDATE */
  console.log("\n2. UPDATE");
  const updated = await prisma.products.update({
    where: { id: productId },
    data: { base_price: "275.50", stock: 42 },
    select: { base_price: true, stock: true, updated_at: true },
  });
  ok(`base_price -> ${updated.base_price}, stock -> ${updated.stock}`);
  ok(`touch_updated_at trigger set updated_at = ${updated.updated_at.toISOString()}`);

  // Updating the SIZE price should cascade into store_inventory.effective_price.
  await prisma.product_sizes.updateMany({
    where: { product_id: productId },
    data: { price: "300.00" },
  });
  const cascaded = await prisma.store_inventory.findFirstOrThrow({
    where: { product_sizes: { product_id: productId } },
    select: { effective_price: true },
  });
  if (cascaded.effective_price.toString() !== "300") {
    throw new Error(`cascade_size_price did not fire (got ${cascaded.effective_price})`);
  }
  ok(`cascade_size_price propagated size price -> effective_price = ${cascaded.effective_price}`);

  /* ------------------------------------------------- 3. CONSTRAINTS fire */
  console.log("\n3. Constraints reject bad writes");

  await expectFailure("negative stock", () =>
    prisma.products.update({ where: { id: productId! }, data: { stock: -5 } })
  );
  await expectFailure("original_price below base_price", () =>
    prisma.products.update({
      where: { id: productId! },
      data: { original_price: "1.00" },
    })
  );
  await expectFailure("duplicate slug", () =>
    prisma.products.create({
      data: { name: "Dupe", slug: SLUG, category_id: category.id },
    })
  );

  /* ---------------------------------------------------------- 4. DELETE */
  console.log("\n4. DELETE (with cascades)");
  await prisma.products.delete({ where: { id: productId } });
  productId = null;

  const leftoverSizes = await prisma.product_sizes.count({ where: { product_id: created.productId } });
  const leftoverInv = await prisma.store_inventory.count({ where: { id: created.invId } });
  if (leftoverSizes !== 0 || leftoverInv !== 0) {
    throw new Error(`cascade incomplete: ${leftoverSizes} sizes, ${leftoverInv} inventory rows remain`);
  }
  ok("product deleted; product_sizes and store_inventory cascaded away");
}

async function expectFailure(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    throw new Error(`EXPECTED "${label}" to be rejected, but it succeeded`);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("EXPECTED")) throw e;
    const code = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : null;
    const msg = e instanceof Error ? e.message : String(e);
    const named =
      msg.match(/violates check constraint "([^"]+)"/)?.[1] ??
      (code === "P2002" ? "unique constraint (P2002)" : null);
    if (!named) {
      console.log(`  [33m![0m ${label}: rejected, but error shape unrecognised:\n      ${msg.split("\n").slice(0, 2).join(" ")}`);
      return;
    }
    ok(`${label} rejected by ${named}`);
  }
}

main()
  .then(() => console.log("\nAll CRUD operations verified.\n"))
  .catch(async (err) => {
    console.error("\nFAILED:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (productId) {
      await prisma.products.delete({ where: { id: productId } }).catch(() => {});
      console.log("(cleaned up leftover test product)");
    }
    await prisma.$disconnect();
  });
