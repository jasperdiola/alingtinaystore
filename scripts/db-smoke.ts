/**
 * Database smoke test — run with `npm run db:smoke`.
 *
 * This deliberately runs OUTSIDE Next.js so that a failure here means
 * "I can't reach the database", with no framework variables in play.
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  const [stores, categories, products, orders, admins] = await Promise.all([
    prisma.stores.count(),
    prisma.categories.count(),
    prisma.products.count(),
    prisma.orders.count(),
    prisma.admin_users.count(),
  ]);

  console.log("Row counts:");
  console.table({ stores, categories, products, orders, admins });

  // `categories` and `product_sizes` are relation fields Prisma inferred from
  // your real foreign keys — this is the payoff over raw SQL: one query, joined,
  // fully typed.
  const sample = await prisma.products.findMany({
    take: 5,
    where: { is_active: true },
    orderBy: { display_order: "asc" },
    select: {
      name: true,
      slug: true,
      base_price: true,
      stock: true,
      categories: { select: { name: true } },
      product_sizes: {
        select: { label: true, price: true },
        orderBy: { display_order: "asc" },
      },
    },
  });

  console.log(`\nFirst ${sample.length} active product(s):`);
  for (const p of sample) {
    // Money columns come back as Prisma Decimal objects, not JS numbers —
    // never do float math on prices. Convert only for display.
    const sizes = p.product_sizes
      .map((s) => `${s.label} @ ${s.price.toString()}`)
      .join(", ");
    console.log(
      `  ${p.name} [${p.categories.name}] ` +
        `base=${p.base_price.toString()} stock=${p.stock}` +
        (sizes ? `\n      sizes: ${sizes}` : "")
    );
  }
}

main()
  .catch((err) => {
    console.error("Smoke test failed:\n", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
