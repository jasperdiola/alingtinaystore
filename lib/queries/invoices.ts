import "server-only";
import { getAdminSession, type AdminSession } from "@/lib/auth/admin";
import { prisma } from "@/lib/prisma";

export const PAGE_SIZE = 25;

/** Same scoping rule as orders — see lib/queries/orders.ts. */
function storeScope(session: AdminSession) {
  if (session.role === "super_admin" || session.storeId === null) return {};
  return { store_id: session.storeId };
}

export type InvoiceRow = {
  id: string;
  code: string;
  customer: string;
  store: string;
  total: number;
  payment: string;
  status: string;
  createdAt: string;
};

/**
 * Cancelled orders are excluded: there is nothing to invoice for a sale that
 * did not happen. Unpaid ones are included on purpose — an invoice normally
 * precedes payment, and the document itself states whether it has been paid.
 */
export async function listInvoices(filters: { q?: string; payment?: string; page: number }) {
  const session = await getAdminSession();
  if (!session) return { rows: [] as InvoiceRow[], total: 0, page: 1, pages: 1 };

  const q = filters.q?.trim();
  const where = {
    deleted_at: null,
    ...storeScope(session),
    status: { not: "cancelled" as never },
    ...(filters.payment ? { payment_status: filters.payment as never } : {}),
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
        id: true, order_code: true, customer_name: true, total_amount: true,
        payment_status: true, status: true, created_at: true,
        stores: { select: { name: true } },
      },
    }),
  ]);

  return {
    rows: rows.map((o) => ({
      id: o.id,
      code: o.order_code,
      customer: o.customer_name,
      store: o.stores.name,
      total: Number(o.total_amount),
      payment: o.payment_status as string,
      status: o.status as string,
      createdAt: o.created_at.toISOString(),
    })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

export type Business = { name: string; tagline: string | null; phone: string | null };

/**
 * site_settings is a key/value store with JSONB values, so a plain string
 * setting arrives as a JSON string rather than a bare one.
 */
export async function getBusiness(): Promise<Business> {
  const rows = await prisma.site_settings.findMany({
    where: { key: { in: ["brand.name", "brand.tagline", "contact.phone"] } },
    select: { key: true, value: true },
  });
  const map = new Map(rows.map((r) => [r.key, typeof r.value === "string" ? r.value : String(r.value ?? "")]));
  return {
    name: map.get("brand.name") || "Aling Tinay's",
    tagline: map.get("brand.tagline") ?? null,
    phone: map.get("contact.phone") ?? null,
  };
}

export async function getInvoice(id: string) {
  const session = await getAdminSession();
  if (!session) return null;

  const o = await prisma.orders.findFirst({
    where: { id, deleted_at: null, ...storeScope(session), status: { not: "cancelled" as never } },
    select: {
      id: true, order_code: true, status: true, payment_status: true,
      fulfillment_type: true, customer_name: true, customer_phone: true,
      customer_email: true, address_line: true, barangay: true, city: true,
      province: true, subtotal: true, delivery_fee: true, discount_total: true,
      total_amount: true, vat_amount: true, is_vat_inclusive: true,
      payment_method_name: true, payment_reference_no: true,
      payment_verified_at: true, completed_at: true, created_at: true,
      stores: {
        select: { name: true, address_line: true, barangay: true, city: true, province: true, phone: true },
      },
      order_items: {
        orderBy: { id: "asc" },
        select: { id: true, product_name: true, size_label: true, unit_price: true, quantity: true, line_total: true },
      },
    },
  });
  if (!o) return null;

  const storeAddress = [o.stores.address_line, o.stores.barangay, o.stores.city, o.stores.province]
    .filter(Boolean)
    .join(", ");

  return {
    id: o.id,
    code: o.order_code,
    status: o.status as string,
    payment: o.payment_status as string,
    fulfillment: o.fulfillment_type as string,
    issuedAt: (o.completed_at ?? o.created_at).toISOString(),
    createdAt: o.created_at.toISOString(),
    paidAt: o.payment_verified_at?.toISOString() ?? null,
    store: { name: o.stores.name, address: storeAddress, phone: o.stores.phone },
    billTo: {
      name: o.customer_name,
      phone: o.customer_phone,
      email: o.customer_email,
      address: [o.address_line, o.barangay, o.city, o.province].filter(Boolean).join(", "),
    },
    paymentInfo: { method: o.payment_method_name, reference: o.payment_reference_no },
    items: o.order_items.map((i) => ({
      id: String(i.id),
      name: i.product_name,
      size: i.size_label,
      unitPrice: Number(i.unit_price),
      quantity: i.quantity,
      lineTotal: Number(i.line_total ?? 0),
    })),
    money: {
      subtotal: Number(o.subtotal),
      deliveryFee: Number(o.delivery_fee),
      discount: Number(o.discount_total),
      total: Number(o.total_amount),
      vat: Number(o.vat_amount),
      vatInclusive: o.is_vat_inclusive,
    },
  };
}

export type Invoice = NonNullable<Awaited<ReturnType<typeof getInvoice>>>;
