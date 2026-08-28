import "server-only";
import { getAdminSession, type AdminSession } from "@/lib/auth/admin";
import { prisma } from "@/lib/prisma";

export const PRICE_PAGE_SIZE = 40;

export type PriceScope = "headline" | "catalog" | "branch";

export type PriceChange = {
  id: string;
  scope: PriceScope;
  product: string;
  productId: string | null;
  size: string | null;
  store: string | null;
  oldPrice: number | null;
  newPrice: number | null;
  actor: string | null;
  at: string;
};

/** Same rule as orders, invoices and inventory — see lib/queries/orders.ts. */
function scopedStoreId(session: AdminSession): string | null {
  if (session.role === "super_admin" || session.storeId === null) return null;
  return session.storeId;
}

/**
 * A branch manager sees their own branch's overrides plus every catalog and
 * headline change, because those set the price their branch inherits. Hiding
 * them would leave a manager watching their own price move with no record of
 * why.
 */
function scopeWhere(session: AdminSession, productId?: string) {
  const store = scopedStoreId(session);
  return {
    ...(productId ? { product_id: productId } : {}),
    ...(store ? { OR: [{ store_id: store }, { scope: { not: "branch" } }] } : {}),
  };
}

function shape(r: {
  id: bigint;
  scope: string;
  product_id: string | null;
  product_name: string;
  size_label: string | null;
  store_name: string | null;
  old_price: unknown;
  new_price: unknown;
  created_at: Date;
  admin_users: { full_name: string | null; email: string } | null;
}): PriceChange {
  return {
    // bigserial: BigInt survives the trip to a Client Component but breaks
    // JSON.stringify, so it becomes a string at the query boundary.
    id: String(r.id),
    scope: r.scope as PriceScope,
    product: r.product_name,
    productId: r.product_id,
    size: r.size_label,
    store: r.store_name,
    // Decimal cannot cross the RSC boundary; Number is safe here because these
    // are display-only and never re-aggregated.
    oldPrice: r.old_price === null ? null : Number(r.old_price),
    newPrice: r.new_price === null ? null : Number(r.new_price),
    actor: r.admin_users?.full_name ?? r.admin_users?.email ?? null,
    at: r.created_at.toISOString(),
  };
}

const SELECT = {
  id: true,
  scope: true,
  product_id: true,
  product_name: true,
  size_label: true,
  store_name: true,
  old_price: true,
  new_price: true,
  created_at: true,
  admin_users: { select: { full_name: true, email: true } },
} as const;

export async function listPriceChanges(page = 1, limit = PRICE_PAGE_SIZE) {
  const session = await getAdminSession();
  if (!session) return { rows: [] as PriceChange[], total: 0, page: 1, pages: 1 };

  const where = scopeWhere(session);
  const [total, rows] = await Promise.all([
    prisma.price_history.count({ where }),
    prisma.price_history.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip: (Math.max(1, page) - 1) * limit,
      take: limit,
      select: SELECT,
    }),
  ]);

  return {
    rows: rows.map(shape),
    total,
    page: Math.max(1, page),
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}

/** The last few changes for one product, shown inline on its edit page. */
export async function recentPriceChangesFor(productId: string, limit = 6) {
  const session = await getAdminSession();
  if (!session) return [] as PriceChange[];

  const rows = await prisma.price_history.findMany({
    where: scopeWhere(session, productId),
    orderBy: { created_at: "desc" },
    take: limit,
    select: SELECT,
  });
  return rows.map(shape);
}
