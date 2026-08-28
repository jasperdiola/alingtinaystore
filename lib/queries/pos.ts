import "server-only";
import { getAdminSession } from "@/lib/auth/admin";
import { prisma } from "@/lib/prisma";

export type SellableLine = {
  /** store_inventory.id — the thing actually being sold. */
  id: string;
  product: string;
  size: string;
  category: string;
  price: number;
  stock: number;
};

export type PosContext = {
  /** Stores this cashier may sell from. One entry means no picker is needed. */
  stores: { id: string; name: string }[];
  /** Fixed by the cashier's assignment, or null when they choose. */
  fixedStoreId: string | null;
};

export async function getPosContext(): Promise<PosContext> {
  const session = await getAdminSession();
  if (!session) return { stores: [], fixedStoreId: null };

  if (session.storeId) {
    const s = await prisma.stores.findUnique({
      where: { id: session.storeId },
      select: { id: true, name: true },
    });
    return { stores: s ? [s] : [], fixedStoreId: session.storeId };
  }

  const stores = await prisma.stores.findMany({
    where: { is_active: true },
    orderBy: { display_order: "asc" },
    select: { id: true, name: true },
  });
  return { stores, fixedStoreId: null };
}

/**
 * What this branch can actually sell right now.
 *
 * Out-of-stock lines are excluded rather than shown greyed out — a counter is
 * not the place to discover something is unavailable after tapping it.
 */
export async function getSellableLines(storeId: string, q?: string): Promise<SellableLine[]> {
  const session = await getAdminSession();
  if (!session) return [];
  // A cashier assigned to a store can only ever sell that store's stock.
  if (session.storeId && session.storeId !== storeId) return [];

  const term = q?.trim();
  const rows = await prisma.store_inventory.findMany({
    where: {
      store_id: storeId,
      is_active: true,
      stock: { gt: 0 },
      product_sizes: {
        is_active: true,
        products: {
          is_active: true,
          ...(term ? { name: { contains: term, mode: "insensitive" as const } } : {}),
        },
      },
    },
    orderBy: [{ product_sizes: { products: { name: "asc" } } }, { id: "asc" }],
    take: 200,
    select: {
      id: true,
      stock: true,
      effective_price: true,
      product_sizes: {
        select: {
          label: true,
          products: { select: { name: true, categories: { select: { name: true } } } },
        },
      },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    product: r.product_sizes.products.name,
    size: r.product_sizes.label,
    category: r.product_sizes.products.categories.name,
    price: Number(r.effective_price),
    stock: r.stock,
  }));
}

/** Today's counter takings for this cashier's store — a running till figure. */
export async function getTodaysSales(storeId: string) {
  const rows = await prisma.$queryRaw<{ orders: number; total: string }[]>`
    SELECT COUNT(*)::int                              AS orders,
           COALESCE(SUM(o.total_amount), 0)::text     AS total
      FROM orders o
     WHERE o.store_id = ${storeId}::uuid
       AND o.deleted_at IS NULL
       AND o.fulfillment_type = 'pickup'
       AND o.status = 'completed'
       AND o.payment_status = 'verified'
       AND date_trunc('day', o.created_at AT TIME ZONE 'Asia/Manila')
         = date_trunc('day', now() AT TIME ZONE 'Asia/Manila')
  `;
  return { orders: rows[0]?.orders ?? 0, total: Number(rows[0]?.total ?? 0) };
}
