import "server-only";
import { getAdminSession, type AdminSession } from "@/lib/auth/admin";
import { prisma } from "@/lib/prisma";

export const PAGE_SIZE = 25;

export type OrderFilters = {
  status?: string;
  payment?: string;
  storeId?: string;
  q?: string;
  page: number;
};

export type OrderRow = {
  id: string;
  code: string;
  customer: string;
  phone: string;
  store: string;
  status: string;
  payment: string;
  fulfillment: string;
  total: number;
  items: number;
  createdAt: string;
  cancelPending: boolean;
};

/**
 * Mirrors can_manage_store(): a super_admin sees everything, an admin with no
 * store_id sees everything, and anyone assigned to a store sees only that
 * store. Applied to every query in this module so scoping can't be forgotten
 * at a call site.
 */
function storeScope(session: AdminSession) {
  if (session.role === "super_admin" || session.storeId === null) return {};
  return { store_id: session.storeId };
}

export async function listOrders(filters: OrderFilters) {
  const session = await getAdminSession();
  if (!session) return { rows: [] as OrderRow[], total: 0, page: 1, pages: 1 };

  const q = filters.q?.trim();
  const where = {
    // Voided orders never appear in the working list. They are not deleted —
    // listVoidedOrders() below is the one place that reads them.
    deleted_at: null,
    ...storeScope(session),
    ...(filters.status ? { status: filters.status as never } : {}),
    ...(filters.payment ? { payment_status: filters.payment as never } : {}),
    // A store filter can only ever narrow, never widen, the scope above.
    ...(filters.storeId && !storeScope(session).store_id
      ? { store_id: filters.storeId }
      : {}),
    ...(q
      ? {
          OR: [
            { order_code: { contains: q, mode: "insensitive" as const } },
            { customer_name: { contains: q, mode: "insensitive" as const } },
            { customer_phone: { contains: q } },
          ],
        }
      : {}),
  };

  const page = Math.max(1, filters.page);

  const [total, rows] = await Promise.all([
    prisma.orders.count({ where }),
    prisma.orders.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        order_code: true,
        customer_name: true,
        customer_phone: true,
        status: true,
        payment_status: true,
        fulfillment_type: true,
        total_amount: true,
        created_at: true,
        cancel_requested_at: true,
        stores: { select: { name: true } },
        _count: { select: { order_items: true } },
      },
    }),
  ]);

  return {
    rows: rows.map((o) => ({
      id: o.id,
      code: o.order_code,
      customer: o.customer_name,
      phone: o.customer_phone,
      store: o.stores.name,
      status: o.status as string,
      payment: o.payment_status as string,
      fulfillment: o.fulfillment_type as string,
      total: Number(o.total_amount),
      items: o._count.order_items,
      createdAt: o.created_at.toISOString(),
      cancelPending: o.cancel_requested_at !== null,
    })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

export async function getOrder(id: string) {
  const session = await getAdminSession();
  if (!session) return null;

  const o = await prisma.orders.findFirst({
    // Scope is part of the WHERE, not a post-filter — an out-of-scope id
    // returns null rather than leaking another store's order. Voided orders
    // are unreachable here too; they have their own page.
    where: { id, deleted_at: null, ...storeScope(session) },
    select: {
      id: true,
      order_code: true,
      status: true,
      payment_status: true,
      fulfillment_type: true,
      customer_name: true,
      customer_phone: true,
      customer_email: true,
      address_line: true,
      barangay: true,
      city: true,
      province: true,
      landmark: true,
      customer_notes: true,
      subtotal: true,
      delivery_fee: true,
      discount_total: true,
      total_amount: true,
      vat_amount: true,
      is_vat_inclusive: true,
      payment_method_name: true,
      payment_reference_no: true,
      payment_submitted_at: true,
      payment_verified_at: true,
      payment_rejection_reason: true,
      confirmed_at: true,
      completed_at: true,
      cancelled_at: true,
      cancel_reason: true,
      cancel_requested_at: true,
      cancel_request_reason: true,
      admin_users_orders_cancel_requested_byToadmin_users: { select: { full_name: true, email: true } },
      created_at: true,
      stores: { select: { id: true, name: true } },
      order_items: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          product_name: true,
          size_label: true,
          unit_price: true,
          quantity: true,
          line_total: true,
        },
      },
      order_status_history: {
        orderBy: { created_at: "asc" },
        select: {
          id: true,
          from_status: true,
          to_status: true,
          from_payment: true,
          to_payment: true,
          note: true,
          created_at: true,
          admin_users: { select: { full_name: true, email: true } },
        },
      },
    },
  });

  if (!o) return null;

  return {
    id: o.id,
    code: o.order_code,
    status: o.status as string,
    payment: o.payment_status as string,
    fulfillment: o.fulfillment_type as string,
    storeId: o.stores.id,
    store: o.stores.name,
    customer: {
      name: o.customer_name,
      phone: o.customer_phone,
      email: o.customer_email,
      address: [o.address_line, o.barangay, o.city, o.province]
        .filter(Boolean)
        .join(", "),
      landmark: o.landmark,
      notes: o.customer_notes,
    },
    money: {
      subtotal: Number(o.subtotal),
      deliveryFee: Number(o.delivery_fee),
      discount: Number(o.discount_total),
      total: Number(o.total_amount),
      vat: Number(o.vat_amount),
      vatInclusive: o.is_vat_inclusive,
    },
    paymentInfo: {
      method: o.payment_method_name,
      reference: o.payment_reference_no,
      submittedAt: o.payment_submitted_at?.toISOString() ?? null,
      verifiedAt: o.payment_verified_at?.toISOString() ?? null,
      rejectionReason: o.payment_rejection_reason,
    },
    timestamps: {
      created: o.created_at.toISOString(),
      confirmed: o.confirmed_at?.toISOString() ?? null,
      completed: o.completed_at?.toISOString() ?? null,
      cancelled: o.cancelled_at?.toISOString() ?? null,
    },
    cancelReason: o.cancel_reason,
    cancelRequest: o.cancel_requested_at
      ? {
          at: o.cancel_requested_at.toISOString(),
          reason: o.cancel_request_reason,
          by:
            o.admin_users_orders_cancel_requested_byToadmin_users?.full_name ??
            o.admin_users_orders_cancel_requested_byToadmin_users?.email ??
            null,
        }
      : null,
    items: o.order_items.map((i) => ({
      id: String(i.id),
      name: i.product_name,
      size: i.size_label,
      unitPrice: Number(i.unit_price),
      quantity: i.quantity,
      lineTotal: Number(i.line_total ?? 0),
    })),
    history: o.order_status_history.map((h) => ({
      id: String(h.id),
      fromStatus: h.from_status as string | null,
      toStatus: h.to_status as string | null,
      fromPayment: h.from_payment as string | null,
      toPayment: h.to_payment as string | null,
      note: h.note,
      at: h.created_at.toISOString(),
      by: h.admin_users?.full_name ?? h.admin_users?.email ?? null,
    })),
  };
}

export type OrderDetail = NonNullable<Awaited<ReturnType<typeof getOrder>>>;

/** Store options for the list filter — omitted when the admin is store-scoped. */
export async function getStoreFilterOptions() {
  const session = await getAdminSession();
  if (!session || session.storeId) return [];
  const rows = await prisma.stores.findMany({
    where: { is_active: true },
    orderBy: { display_order: "asc" },
    select: { id: true, name: true },
  });
  return rows;
}

export type VoidedOrderRow = {
  id: string;
  code: string;
  customer: string;
  store: string;
  total: number;
  items: number;
  createdAt: string;
  voidedAt: string;
  voidedBy: string | null;
  reason: string;
  stockReturned: boolean;
};

/**
 * Orders a manager struck from the record, newest first.
 *
 * The counterpart to listOrders' `deleted_at: null`. These rows are excluded
 * from every operational view and every sales figure, and exist so that a
 * mis-rung sale leaves a trail instead of a hole: what it was, who voided it,
 * when, and why.
 */
export async function listVoidedOrders(page = 1, limit = PAGE_SIZE) {
  const session = await getAdminSession();
  if (!session) return { rows: [] as VoidedOrderRow[], total: 0, page: 1, pages: 1 };

  const where = { deleted_at: { not: null }, ...storeScope(session) };

  const [total, rows] = await Promise.all([
    prisma.orders.count({ where }),
    prisma.orders.findMany({
      where,
      orderBy: { deleted_at: "desc" },
      skip: (Math.max(1, page) - 1) * limit,
      take: limit,
      select: {
        id: true,
        order_code: true,
        customer_name: true,
        total_amount: true,
        created_at: true,
        deleted_at: true,
        delete_reason: true,
        stock_restored_at: true,
        stores: { select: { name: true } },
        admin_users_orders_deleted_byToadmin_users: {
          select: { full_name: true, email: true },
        },
        _count: { select: { order_items: true } },
      },
    }),
  ]);

  return {
    rows: rows.map((o) => {
      const by = o.admin_users_orders_deleted_byToadmin_users;
      return {
        id: o.id,
        code: o.order_code,
        customer: o.customer_name,
        store: o.stores.name,
        // Decimal cannot cross to a Client Component; this is display-only.
        total: Number(o.total_amount),
        items: o._count.order_items,
        createdAt: o.created_at.toISOString(),
        voidedAt: o.deleted_at!.toISOString(),
        voidedBy: by?.full_name ?? by?.email ?? null,
        reason: o.delete_reason ?? "",
        stockReturned: o.stock_restored_at !== null,
      };
    }),
    total,
    page: Math.max(1, page),
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}
