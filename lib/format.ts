/**
 * Display formatting. Safe to import from client components — no DB, no secrets.
 */

const PESO = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

const PESO_EXACT = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const NUM = new Intl.NumberFormat("en-PH");

export const peso = (n: number) => PESO.format(n);
export const pesoExact = (n: number) => PESO_EXACT.format(n);
export const count = (n: number) => NUM.format(n);

/** Axis ticks need to be short or they collide. */
export function pesoCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `₱${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `₱${Math.round(n / 1_000)}k`;
  return `₱${Math.round(n)}`;
}

export const percent = (n: number) =>
  `${n > 0 ? "+" : ""}${n.toFixed(n >= 10 || n <= -10 ? 0 : 1)}%`;

/**
 * Bucket keys arrive as "YYYY-MM-DD HH:MM" already expressed in Manila local
 * time, so they must be formatted as plain wall-clock strings. Passing them
 * through `new Date()` would re-interpret them in the server's zone and shift
 * the labels.
 */
export function bucketLabel(bucket: string, unit: "hour" | "day" | "month"): string {
  const [datePart, timePart = "00:00"] = bucket.split(" ");
  const [y, m, d] = datePart.split("-").map(Number);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  if (unit === "hour") {
    const h = Number(timePart.slice(0, 2));
    const suffix = h < 12 ? "am" : "pm";
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${hour12}${suffix}`;
  }
  if (unit === "month") return `${MONTHS[m - 1]} ${String(y).slice(2)}`;
  return `${MONTHS[m - 1]} ${d}`;
}

/** Longer form for tooltips, where there is room to be unambiguous. */
export function bucketLabelLong(bucket: string, unit: "hour" | "day" | "month"): string {
  const [datePart] = bucket.split(" ");
  const [y, m, d] = datePart.split("-").map(Number);
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];

  if (unit === "hour") return `${bucketLabel(bucket, "hour")}, ${MONTHS[m - 1].slice(0, 3)} ${d}`;
  if (unit === "month") return `${MONTHS[m - 1]} ${y}`;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  preparing: "Preparing",
  ready: "Ready",
  out_for_delivery: "Out for delivery",
  completed: "Completed",
  cancelled: "Cancelled",
};
export const statusLabel = (s: string) => STATUS_LABEL[s] ?? s;
