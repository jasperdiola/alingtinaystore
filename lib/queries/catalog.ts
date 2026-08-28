import "server-only";
import { prisma } from "@/lib/prisma";

export const PAGE_SIZE = 20;

export type ProductRow = {
  id: string;
  name: string;
  slug: string;
  category: string;
  basePrice: number;
  isActive: boolean;
  isFeatured: boolean;
  isBestSeller: boolean;
  sizeCount: number;
  /** Distinct branches carrying at least one of this product's sizes. */
  storeCount: number;
  totalStock: number;
  /** Primary image, so the editor can show which products still have none. */
  image: string | null;
};

/**
 * Product list for the catalog editor.
 *
 * The per-product aggregates (sizes, branches, stock) are computed in ONE SQL
 * statement rather than by loading every size and inventory row into JS.
 * Prisma's nested includes would issue a query per relation level and ship
 * ~330 rows to build four numbers; this ships 20.
 */
export async function listProducts(q: string | undefined, page: number) {
  const term = q?.trim() ? `%${q.trim()}%` : null;
  const offset = (Math.max(1, page) - 1) * PAGE_SIZE;

  const [rows, totalRow] = await Promise.all([
    prisma.$queryRaw<
      {
        id: string; name: string; slug: string; category: string; image: string | null;
        base_price: string; is_active: boolean; is_featured: boolean;
        is_best_seller: boolean; size_count: number; store_count: number; total_stock: number;
      }[]
    >`
      SELECT p.id, p.name, p.slug, c.name AS category, p.image,
             p.base_price::text, p.is_active, p.is_featured, p.is_best_seller,
             COUNT(DISTINCT ps.id)::int                          AS size_count,
             COUNT(DISTINCT si.store_id)::int                    AS store_count,
             COALESCE(SUM(si.stock), 0)::int                     AS total_stock
        FROM products p
        JOIN categories c ON c.id = p.category_id
        LEFT JOIN product_sizes ps ON ps.product_id = p.id AND ps.is_active
        LEFT JOIN store_inventory si ON si.product_size_id = ps.id AND si.is_active
       WHERE (${term}::text IS NULL OR p.name ILIKE ${term}::text)
       GROUP BY p.id, p.name, p.slug, c.name, p.image, p.base_price,
                p.is_active, p.is_featured, p.is_best_seller, p.display_order
       ORDER BY p.is_active DESC, p.display_order, p.name
       LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `,
    prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM products p
       WHERE (${term}::text IS NULL OR p.name ILIKE ${term}::text)
    `,
  ]);

  const total = totalRow[0]?.n ?? 0;
  return {
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      category: r.category,
      image: r.image,
      basePrice: Number(r.base_price),
      isActive: r.is_active,
      isFeatured: r.is_featured,
      isBestSeller: r.is_best_seller,
      sizeCount: r.size_count,
      storeCount: r.store_count,
      totalStock: r.total_stock,
    })) satisfies ProductRow[],
    total,
    page: Math.max(1, page),
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

export async function getProductForEdit(id: string) {
  const p = await prisma.products.findUnique({
    where: { id },
    select: {
      id: true, name: true, slug: true, description: true, short_description: true,
      category_id: true, base_price: true, original_price: true, image: true,
      is_active: true, is_featured: true, is_best_seller: true, display_order: true,
      created_at: true,
      product_sizes: {
        orderBy: { display_order: "asc" },
        select: {
          id: true, label: true, weight: true, price: true, sku: true, is_active: true,
          store_inventory: {
            select: {
              id: true, stock: true, price_override: true,
              stores: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });
  if (!p) return null;

  // Whether this product has ever been sold decides delete vs deactivate.
  const soldCount = await prisma.order_items.count({ where: { product_id: id } });

  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    shortDescription: p.short_description,
    categoryId: p.category_id,
    basePrice: Number(p.base_price),
    originalPrice: p.original_price === null ? null : Number(p.original_price),
    image: p.image,
    isActive: p.is_active,
    isFeatured: p.is_featured,
    isBestSeller: p.is_best_seller,
    displayOrder: p.display_order,
    soldCount,
    sizes: p.product_sizes.map((s) => ({
      id: s.id,
      label: s.label,
      weight: s.weight,
      price: Number(s.price),
      sku: s.sku,
      isActive: s.is_active,
      stores: s.store_inventory.map((si) => ({
        inventoryId: si.id,
        storeId: si.stores.id,
        store: si.stores.name,
        stock: si.stock,
        // A branch that pins its own price is unaffected by a catalog change;
        // the editor has to say so before the change is made.
        override: si.price_override === null ? null : Number(si.price_override),
      })),
    })),
  };
}

export type ProductForEdit = NonNullable<Awaited<ReturnType<typeof getProductForEdit>>>;

export async function getCatalogRefs() {
  const [categories, stores] = await Promise.all([
    prisma.categories.findMany({
      where: { is_active: true },
      orderBy: [{ display_order: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    prisma.stores.findMany({
      where: { is_active: true },
      orderBy: { display_order: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  return { categories, stores };
}
