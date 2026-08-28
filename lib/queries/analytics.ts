import "server-only";
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Every number on the dashboard is defined here, once.
 *
 * Two rules this module exists to enforce:
 *
 *  1. TIMEZONE. Columns are `timestamptz` (UTC). The store is in Rizal, so a
 *     "day" means a Manila day. Bucketing in UTC would file every evening's
 *     sales from 16:00 Manila onward under the previous day — eight hours of
 *     wrong, every single day. All bucketing goes through
 *     `AT TIME ZONE 'Asia/Manila'`.
 *
 *  2. MONEY NEVER TOUCHES A FLOAT. Aggregation happens in Postgres `numeric`;
 *     results come back as `::text` and are parsed only where they are
 *     rendered.
 */

/** The Philippines has had no DST since 1978 — a fixed +08:00 is safe. */
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const TZ = "Asia/Manila";

export type RangeKey = "today" | "7d" | "30d" | "12mo";
export type Bucket = "hour" | "day" | "month";

export const RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "12mo", label: "12 months" },
];

export function isRangeKey(v: unknown): v is RangeKey {
  return typeof v === "string" && RANGES.some((r) => r.key === v);
}

function manilaMidnight(daysAgo = 0): Date {
  const shifted = new Date(Date.now() + MANILA_OFFSET_MS);
  return new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate() - daysAgo
    ) - MANILA_OFFSET_MS
  );
}

function manilaMonthStart(monthsAgo = 0): Date {
  const shifted = new Date(Date.now() + MANILA_OFFSET_MS);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() - monthsAgo, 1) -
      MANILA_OFFSET_MS
  );
}

export type Window = {
  key: RangeKey;
  start: Date;
  end: Date;
  bucket: Bucket;
  /** Same-length window immediately before `start`, for deltas. */
  prevStart: Date;
  prevEnd: Date;
};

export function resolveWindow(key: RangeKey): Window {
  const end = new Date();
  let start: Date;
  let bucket: Bucket;

  switch (key) {
    case "today":
      start = manilaMidnight(0);
      bucket = "hour";
      break;
    case "7d":
      start = manilaMidnight(6);
      bucket = "day";
      break;
    case "30d":
      start = manilaMidnight(29);
      bucket = "day";
      break;
    case "12mo":
      start = manilaMonthStart(11);
      bucket = "month";
      break;
  }

  const span = end.getTime() - start.getTime();
  return {
    key,
    start,
    end,
    bucket,
    prevStart: new Date(start.getTime() - span),
    prevEnd: start,
  };
}

/**
 * Revenue = money actually collected. Cancelled orders never count, and
 * `verified` already excludes `refunded`, `unpaid` and `awaiting_verification`.
 */
const COLLECTED = Prisma.sql`o.payment_status = 'verified' AND o.status <> 'cancelled'`;
/*
 * Voided orders are excluded from every figure below at ROW level rather than
 * inside a FILTER, because not every aggregate here is filtered — the status
 * breakdown counts plain COUNT(*). An order voided as a mis-ring never
 * happened, so it must not reach revenue, volume or units.
 */
const LIVE = Prisma.sql`o.deleted_at IS NULL`;
/** Order volume counts demand, so it keeps everything except cancellations. */
const PLACED = Prisma.sql`o.status <> 'cancelled'`;

const stepFor: Record<Bucket, string> = {
  hour: "1 hour",
  day: "1 day",
  month: "1 month",
};

/* --------------------------------------------------------------------- KPIs */

export type Kpis = {
  revenue: number;
  orders: number;
  avgOrderValue: number;
  units: number;
  revenueDelta: number | null;
  ordersDelta: number | null;
};

type KpiRow = { revenue: string; orders: number; units: number };

async function kpiSlice(start: Date, end: Date): Promise<KpiRow> {
  const rows = await prisma.$queryRaw<KpiRow[]>`
    SELECT
      COALESCE(SUM(o.total_amount) FILTER (WHERE ${COLLECTED}), 0)::text AS revenue,
      COUNT(*) FILTER (WHERE ${PLACED})::int                            AS orders,
      COALESCE((
        SELECT SUM(oi.quantity)
          FROM order_items oi
          JOIN orders o2 ON o2.id = oi.order_id
         WHERE o2.created_at >= ${start} AND o2.created_at < ${end}
           AND o2.status <> 'cancelled' AND o2.deleted_at IS NULL
      ), 0)::int                                                        AS units
    FROM orders o
    WHERE o.created_at >= ${start} AND o.created_at < ${end} AND ${LIVE}
  `;
  return rows[0] ?? { revenue: "0", orders: 0, units: 0 };
}

const pctDelta = (now: number, prev: number): number | null =>
  prev === 0 ? null : ((now - prev) / prev) * 100;

export async function getKpis(w: Window): Promise<Kpis> {
  const [cur, prev] = await Promise.all([
    kpiSlice(w.start, w.end),
    kpiSlice(w.prevStart, w.prevEnd),
  ]);

  const revenue = Number(cur.revenue);
  return {
    revenue,
    orders: cur.orders,
    avgOrderValue: cur.orders > 0 ? revenue / cur.orders : 0,
    units: cur.units,
    revenueDelta: pctDelta(revenue, Number(prev.revenue)),
    ordersDelta: pctDelta(cur.orders, prev.orders),
  };
}

/* ------------------------------------------------------------ revenue series */

export type SeriesPoint = { bucket: string; revenue: number; orders: number };

/**
 * Gap-filled: `generate_series` supplies every bucket in the window, so a day
 * with no sales renders as a zero rather than silently collapsing the x-axis.
 */
export async function getRevenueSeries(w: Window): Promise<SeriesPoint[]> {
  const rows = await prisma.$queryRaw<
    { bucket: string; revenue: string; orders: number }[]
  >`
    WITH series AS (
      SELECT generate_series(
        date_trunc(${w.bucket}, ${w.start}::timestamptz AT TIME ZONE ${TZ}),
        date_trunc(${w.bucket}, ${w.end}::timestamptz AT TIME ZONE ${TZ}),
        ${stepFor[w.bucket]}::interval
      ) AS b
    ),
    agg AS (
      SELECT date_trunc(${w.bucket}, o.created_at AT TIME ZONE ${TZ}) AS b,
             SUM(o.total_amount) FILTER (WHERE ${COLLECTED}) AS revenue,
             COUNT(*) FILTER (WHERE ${PLACED})               AS orders
        FROM orders o
       WHERE o.created_at >= ${w.start} AND o.created_at < ${w.end} AND ${LIVE}
       GROUP BY 1
    )
    SELECT to_char(s.b, 'YYYY-MM-DD HH24:MI')      AS bucket,
           COALESCE(agg.revenue, 0)::text          AS revenue,
           COALESCE(agg.orders, 0)::int            AS orders
      FROM series s
      LEFT JOIN agg ON agg.b = s.b
     ORDER BY s.b
  `;

  return rows.map((r) => ({
    bucket: r.bucket,
    revenue: Number(r.revenue),
    orders: r.orders,
  }));
}

/* --------------------------------------------------------------- by location */

export type StoreSlice = {
  storeId: string;
  store: string;
  revenue: number;
  orders: number;
};

export async function getSalesByStore(w: Window): Promise<StoreSlice[]> {
  const rows = await prisma.$queryRaw<
    { store_id: string; store: string; revenue: string; orders: number }[]
  >`
    SELECT s.id AS store_id,
           s.name AS store,
           COALESCE(SUM(o.total_amount) FILTER (WHERE ${COLLECTED}), 0)::text AS revenue,
           COUNT(o.id) FILTER (WHERE ${PLACED})::int                          AS orders
      FROM stores s
      LEFT JOIN orders o
        ON o.store_id = s.id
       AND o.created_at >= ${w.start} AND o.created_at < ${w.end}
       AND ${LIVE}
     WHERE s.is_active
     GROUP BY s.id, s.name, s.display_order
     ORDER BY s.display_order, s.name
  `;

  return rows.map((r) => ({
    storeId: r.store_id,
    store: r.store,
    revenue: Number(r.revenue),
    orders: r.orders,
  }));
}

/* -------------------------------------------------------------- top products */

export type ProductSlice = {
  productId: string | null;
  name: string;
  revenue: number;
  units: number;
};

export async function getTopProducts(w: Window, limit = 8): Promise<ProductSlice[]> {
  const rows = await prisma.$queryRaw<
    { product_id: string | null; name: string; revenue: string; units: number }[]
  >`
    SELECT oi.product_id,
           oi.product_name        AS name,
           SUM(oi.line_total)::text AS revenue,
           SUM(oi.quantity)::int    AS units
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
     WHERE o.created_at >= ${w.start} AND o.created_at < ${w.end}
       AND ${COLLECTED} AND ${LIVE}
     GROUP BY oi.product_id, oi.product_name
     ORDER BY SUM(oi.line_total) DESC
     LIMIT ${limit}
  `;

  return rows.map((r) => ({
    productId: r.product_id,
    name: r.name,
    revenue: Number(r.revenue),
    units: r.units,
  }));
}

/* ---------------------------------------------------------- status breakdown */

export type StatusSlice = { status: string; orders: number; value: number };

export async function getStatusBreakdown(w: Window): Promise<StatusSlice[]> {
  const rows = await prisma.$queryRaw<
    { status: string; orders: number; value: string }[]
  >`
    SELECT o.status::text                        AS status,
           COUNT(*)::int                         AS orders,
           COALESCE(SUM(o.total_amount), 0)::text AS value
      FROM orders o
     WHERE o.created_at >= ${w.start} AND o.created_at < ${w.end} AND ${LIVE}
     GROUP BY o.status
     ORDER BY COUNT(*) DESC
  `;

  return rows.map((r) => ({
    status: r.status,
    orders: r.orders,
    value: Number(r.value),
  }));
}
