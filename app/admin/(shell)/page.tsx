import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/admin";
import {
  bucketLabelLong,
  count,
  peso,
  pesoExact,
  statusLabel,
} from "@/lib/format";
import {
  getKpis,
  getRevenueSeries,
  getSalesByStore,
  getStatusBreakdown,
  getTopProducts,
  isRangeKey,
  resolveWindow,
  type RangeKey,
} from "@/lib/queries/analytics";
import BarChart, { type Bar } from "./_components/charts/bar-chart";
import { ChartCard, DataTable } from "./_components/charts/chart-card";
import LineChart from "./_components/charts/line-chart";
import StatTile from "./_components/charts/stat-tile";
import RangeFilter from "./_components/range-filter";

export const metadata: Metadata = {
  title: "Dashboard · Aling Tinay Admin",
  robots: { index: false, follow: false },
};

/** Stores keep a fixed colour slot wherever they appear — never by rank. */
const STORE_SLOTS = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)"];

const RANGE_NOTE: Record<RangeKey, string> = {
  today: "since midnight, Manila time",
  "7d": "last 7 days vs the 7 before",
  "30d": "last 30 days vs the 30 before",
  "12mo": "last 12 months vs the 12 before",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  // Sales figures are manager-and-above. Staff are sent to the register
  // instead — /admin is not their home page.
  await requireRole("manager");

  const { range } = await searchParams;
  const key: RangeKey = isRangeKey(range) ? range : "30d";
  const win = resolveWindow(key);

  const [kpis, series, byStore, topProducts, statuses] = await Promise.all([
    getKpis(win),
    getRevenueSeries(win),
    getSalesByStore(win),
    getTopProducts(win, 8),
    getStatusBreakdown(win),
  ]);

  const noSales = kpis.revenue === 0 && kpis.orders === 0;

  const storeBars: Bar[] = byStore.map((s, i) => ({
    label: s.store,
    value: s.revenue,
    meta: `${count(s.orders)} order${s.orders === 1 ? "" : "s"}`,
    color: STORE_SLOTS[i % STORE_SLOTS.length],
  }));

  const productBars: Bar[] = topProducts.map((p) => ({
    label: p.name,
    value: p.revenue,
    meta: `${count(p.units)} units sold`,
  }));

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Overview</h2>
          <p className="text-xs text-neutral-500">
            Revenue counts payment-verified orders only · {RANGE_NOTE[key]}
          </p>
        </div>
        <RangeFilter active={key} />
      </div>

      <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Revenue collected"
          value={peso(kpis.revenue)}
          delta={kpis.revenueDelta}
          hint="vs previous period"
        />
        <StatTile
          label="Orders placed"
          value={count(kpis.orders)}
          delta={kpis.ordersDelta}
          hint="excludes cancelled"
        />
        <StatTile label="Average order" value={peso(kpis.avgOrderValue)} />
        <StatTile label="Units sold" value={count(kpis.units)} />
      </div>

      <div className="mt-4 grid gap-4">
        <ChartCard
          title="Revenue over time"
          subtitle={`${series.length} ${win.bucket} buckets · Manila time`}
          empty={noSales}
          table={
            <DataTable
              columns={["Period", "Revenue", "Orders"]}
              rows={series.map((p) => [
                bucketLabelLong(p.bucket, win.bucket),
                pesoExact(p.revenue),
                p.orders,
              ])}
            />
          }
        >
          <LineChart data={series} unit={win.bucket} />
        </ChartCard>

        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="Sales by location"
            subtitle="Which store is earning"
            empty={noSales}
            table={
              <DataTable
                columns={["Store", "Revenue", "Orders"]}
                rows={byStore.map((s) => [s.store, pesoExact(s.revenue), s.orders])}
              />
            }
          >
            <BarChart bars={storeBars} />
          </ChartCard>

          <ChartCard
            title="Top products"
            subtitle="By revenue collected"
            empty={noSales || topProducts.length === 0}
            table={
              <DataTable
                columns={["Product", "Revenue", "Units"]}
                rows={topProducts.map((p) => [p.name, pesoExact(p.revenue), p.units])}
              />
            }
          >
            <BarChart bars={productBars} />
          </ChartCard>
        </div>

        {/* Seven statuses is past the point where colour carries meaning —
            this is deliberately a table, not a chart. */}
        <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="mb-1 text-sm font-semibold">Order pipeline</h2>
          <p className="mb-4 text-xs text-neutral-500">
            Every order in the period, by status — including cancelled
          </p>
          {statuses.length === 0 ? (
            <p className="py-6 text-center text-sm text-neutral-500">
              No orders in this period.
            </p>
          ) : (
            <DataTable
              columns={["Status", "Orders", "Value"]}
              rows={statuses.map((s) => [
                statusLabel(s.status),
                s.orders,
                pesoExact(s.value),
              ])}
            />
          )}
        </section>
      </div>
    </div>
  );
}
