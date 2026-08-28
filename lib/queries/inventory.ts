import "server-only";
import { getAdminSession, type AdminSession } from "@/lib/auth/admin";
import { prisma } from "@/lib/prisma";

export const PAGE_SIZE = 30;

/** Same rule as orders and invoices — see lib/queries/orders.ts. */
function scopedStoreId(session: AdminSession): string | null {
  if (session.role === "super_admin" || session.storeId === null) return null;
  return session.storeId;
}

export type StockRow = {
  id: string;
  product: string;
  productId: string;
  size: string;
  store: string;
  storeId: string;
  stock: number;
  price: number;
  threshold: number;
  low: boolean;
  category: string;
  /** product_sizes.price — the catalog price this branch inherits. */
  sizePrice: number;
  /** Set when this branch deliberately departs from the catalog price. */
  overridePrice: number | null;
};

export type StockFilters = {
  storeId?: string;
  categoryId?: string;
  q?: string;
  low?: boolean;
  page: number;
};

/**
 * The low-stock threshold falls back from the row to the store, matching the
 * `coalesce(si.low_stock_threshold, s.low_stock_threshold)` your other queries
 * use. A per-row override only exists for lines that need special treatment.
 */
export async function listStock(filters: StockFilters) {
  const session = await getAdminSession();
  if (!session) return { rows: [] as StockRow[], total: 0, page: 1, pages: 1 };

  const forced = scopedStoreId(session);
  const storeId = forced ?? filters.storeId;
  const q = filters.q?.trim();

  // Category and search both live under product_sizes.products, so they are
  // built as one nested filter rather than two spreads that would overwrite
  // each other.
  const productWhere = {
    ...(filters.categoryId ? { category_id: filters.categoryId } : {}),
    ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
  };

  const where = {
    is_active: true,
    ...(storeId ? { store_id: storeId } : {}),
    ...(Object.keys(productWhere).length
      ? { product_sizes: { products: productWhere } }
      : {}),
  };

  const page = Math.max(1, filters.page);

  const [total, rows] = await Promise.all([
    prisma.store_inventory.count({ where }),
    prisma.store_inventory.findMany({
      where,
      // Lowest stock first: the rows that need attention lead.
      orderBy: [{ stock: "asc" }, { id: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        stock: true,
        effective_price: true,
        low_stock_threshold: true,
        price_override: true,
        stores: { select: { id: true, name: true, low_stock_threshold: true } },
        product_sizes: {
          select: {
            label: true,
            price: true,
            products: { select: { id: true, name: true, categories: { select: { name: true } } } },
          },
        },
      },
    }),
  ]);

  const mapped: StockRow[] = rows.map((r) => {
    const threshold = r.low_stock_threshold ?? r.stores.low_stock_threshold;
    return {
      id: r.id,
      product: r.product_sizes.products.name,
      productId: r.product_sizes.products.id,
      size: r.product_sizes.label,
      store: r.stores.name,
      storeId: r.stores.id,
      stock: r.stock,
      price: Number(r.effective_price),
      threshold,
      low: r.stock <= threshold,
      category: r.product_sizes.products.categories.name,
      sizePrice: Number(r.product_sizes.price),
      overridePrice: r.price_override === null ? null : Number(r.price_override),
    };
  });

  // `low` filters on a value derived per row (row threshold OR store default),
  // which cannot be expressed in the same WHERE — so it is applied after the
  // fetch. Noted because it means the count reflects the page, not the whole set.
  const filtered = filters.low ? mapped.filter((r) => r.low) : mapped;

  return {
    rows: filtered,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    lowFilterIsPageLocal: Boolean(filters.low),
  };
}

/** Headline counts, computed in SQL so they cover the whole set, not a page. */
export async function getStockSummary() {
  const session = await getAdminSession();
  if (!session) return [];
  const forced = scopedStoreId(session);

  const rows = await prisma.$queryRaw<
    { store: string; lines: number; units: number; low: number; out: number }[]
  >`
    SELECT s.name AS store,
           COUNT(*)::int                                                          AS lines,
           COALESCE(SUM(si.stock), 0)::int                                        AS units,
           COUNT(*) FILTER (
             WHERE si.stock <= COALESCE(si.low_stock_threshold, s.low_stock_threshold)
           )::int                                                                 AS low,
           COUNT(*) FILTER (WHERE si.stock = 0)::int                              AS out
      FROM store_inventory si
      JOIN stores s ON s.id = si.store_id
     WHERE si.is_active
       AND (${forced}::uuid IS NULL OR si.store_id = ${forced}::uuid)
     GROUP BY s.name, s.display_order
     ORDER BY s.display_order
  `;
  return rows;
}

export async function getInventoryFilters() {
  const session = await getAdminSession();
  if (!session) return { stores: [], categories: [] };

  const [stores, categories] = await Promise.all([
    scopedStoreId(session)
      ? Promise.resolve([])
      : prisma.stores.findMany({
          where: { is_active: true },
          orderBy: { display_order: "asc" },
          select: { id: true, name: true },
        }),
    prisma.categories.findMany({
      where: { is_active: true },
      orderBy: [{ display_order: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
  ]);

  return { stores, categories };
}

export type MovementRow = {
  id: string;
  product: string;
  size: string;
  store: string;
  delta: number;
  balanceAfter: number;
  reason: string;
  actor: string | null;
  orderCode: string | null;
  at: string;
};

/** The audit trail. This is the payoff for writing movements on every change. */
export async function listMovements(page = 1, limit = 40) {
  const session = await getAdminSession();
  if (!session) return { rows: [] as MovementRow[], total: 0, page: 1, pages: 1 };
  const forced = scopedStoreId(session);

  const where = forced ? { store_inventory: { store_id: forced } } : {};

  const [total, rows] = await Promise.all([
    prisma.inventory_movements.count({ where }),
    prisma.inventory_movements.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip: (Math.max(1, page) - 1) * limit,
      take: limit,
      select: {
        id: true,
        delta: true,
        balance_after: true,
        reason: true,
        created_at: true,
        admin_users: { select: { full_name: true, email: true } },
        orders: { select: { order_code: true } },
        store_inventory: {
          select: {
            stores: { select: { name: true } },
            product_sizes: {
              select: { label: true, products: { select: { name: true } } },
            },
          },
        },
      },
    }),
  ]);

  return {
    rows: rows.map((m) => ({
      id: String(m.id),
      product: m.store_inventory.product_sizes.products.name,
      size: m.store_inventory.product_sizes.label,
      store: m.store_inventory.stores.name,
      delta: m.delta,
      balanceAfter: m.balance_after,
      reason: m.reason,
      actor: m.admin_users?.full_name ?? m.admin_users?.email ?? null,
      orderCode: m.orders?.order_code ?? null,
      at: m.created_at.toISOString(),
    })),
    total,
    page: Math.max(1, page),
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}

export type CatalogSize = {
  sizeId: string;
  label: string;
  price: number;
  /** Branches inheriting this price. */
  following: number;
  /** Branches that deliberately set their own. */
  pinned: number;
  /** The differing branch prices, so a manager sees what a change won't touch. */
  overrides: { store: string; price: number }[];
};

export type CatalogProduct = {
  id: string;
  name: string;
  category: string;
  sizes: CatalogSize[];
};

/**
 * Catalog pricing — one price per size, shared across branches.
 *
 * Deliberately shows how many branches follow each price and which ones pin
 * their own, because changing the catalog price only moves the followers
 * (cascade_size_price skips rows with a price_override). A manager who can't
 * see that will assume a price change applied everywhere.
 */
export async function listCatalogPrices(q?: string, limit = 40): Promise<CatalogProduct[]> {
  const term = q?.trim();
  const rows = await prisma.products.findMany({
    where: {
      is_active: true,
      ...(term ? { name: { contains: term, mode: "insensitive" as const } } : {}),
    },
    orderBy: [{ display_order: "asc" }, { name: "asc" }],
    take: limit,
    select: {
      id: true,
      name: true,
      categories: { select: { name: true } },
      product_sizes: {
        where: { is_active: true },
        orderBy: { display_order: "asc" },
        select: {
          id: true,
          label: true,
          price: true,
          store_inventory: {
            select: {
              price_override: true,
              stores: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.categories.name,
    sizes: p.product_sizes.map((s) => {
      const overrides = s.store_inventory
        .filter((si) => si.price_override !== null)
        .map((si) => ({ store: si.stores.name, price: Number(si.price_override) }));
      return {
        sizeId: s.id,
        label: s.label,
        price: Number(s.price),
        following: s.store_inventory.length - overrides.length,
        pinned: overrides.length,
        overrides,
      };
    }),
  }));
}
