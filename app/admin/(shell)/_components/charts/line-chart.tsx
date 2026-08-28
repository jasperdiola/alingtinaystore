"use client";

import { useEffect, useRef, useState } from "react";
import { bucketLabel, bucketLabelLong, peso, pesoCompact } from "@/lib/format";

type Point = { bucket: string; revenue: number; orders: number };

/**
 * Single-series revenue trend.
 *
 * The viewBox width tracks the container instead of being fixed. A fixed 760
 * viewBox squeezed into a 398px phone renders every label at roughly half size
 * — technically present, practically unreadable. Measuring means 11px type
 * stays 11px at any width, and the geometry-based label thinning adapts on its
 * own because the available pixels really did change.
 *
 * One series, so no legend — the card title names it.
 */
export default function LineChart({
  data,
  unit,
}: {
  data: Point[];
  unit: "hour" | "day" | "month";
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(760);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setW(Math.max(280, Math.round(entry.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const narrow = w < 520;
  const H = narrow ? 200 : 240;
  // A 56px gutter is a seventh of a phone screen; the axis labels are shorter
  // there anyway because pesoCompact collapses to "₱23k".
  const PAD = {
    top: 16,
    right: narrow ? 10 : 16,
    bottom: 28,
    left: narrow ? 42 : 56,
  };

  const plotW = Math.max(10, w - PAD.left - PAD.right);
  const plotH = H - PAD.top - PAD.bottom;

  const max = Math.max(...data.map((d) => d.revenue), 1);
  const niceMax = niceCeil(max);

  const x = (i: number) =>
    PAD.left + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / niceMax) * plotH;

  const line = data.map((d, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(d.revenue)}`).join(" ");
  const area = `${line} L ${x(data.length - 1)} ${PAD.top + plotH} L ${x(0)} ${PAD.top + plotH} Z`;

  const ticks = (narrow ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]).map((f) => f * niceMax);

  // Thin by geometry, not by count: reserve room for a label and see how many
  // fit. Counting back from the end keeps the most recent bucket labelled.
  const gap = data.length > 1 ? plotW / (data.length - 1) : plotW;
  const labelEvery = Math.max(1, Math.ceil((narrow ? 44 : 58) / gap));
  const showLabel = (i: number) => (data.length - 1 - i) % labelEvery === 0;

  return (
    <figure className="m-0">
      <div ref={wrapRef} className="relative w-full">
        <svg
          viewBox={`0 0 ${w} ${H}`}
          width="100%"
          height={H}
          role="img"
          aria-label={`Revenue by ${unit}. Peak ${peso(max)}.`}
          onMouseLeave={() => setHover(null)}
          className="touch-pan-y"
        >
          {ticks.map((t) => (
            <g key={t}>
              {/* Solid hairlines — dashing adds noise and reads as disabled. */}
              <line
                x1={PAD.left}
                x2={w - PAD.right}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--viz-grid)"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y(t) + 4}
                textAnchor="end"
                fontSize={11}
                fill="var(--viz-muted)"
                className="tabular-nums"
              >
                {pesoCompact(t)}
              </text>
            </g>
          ))}

          <defs>
            <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--viz-1)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--viz-1)" stopOpacity="0" />
            </linearGradient>
          </defs>

          <path d={area} fill="url(#revFill)" />
          <path
            d={line}
            fill="none"
            stroke="var(--viz-1)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {data.map((d, i) =>
            showLabel(i) ? (
              <text
                key={d.bucket}
                x={x(i)}
                y={H - 8}
                textAnchor="middle"
                fontSize={11}
                fill="var(--viz-muted)"
              >
                {bucketLabel(d.bucket, unit)}
              </text>
            ) : null
          )}

          {hover !== null && (
            <>
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={PAD.top + plotH}
                stroke="var(--viz-axis)"
                strokeWidth={1}
              />
              {/* 2px surface ring so the marker reads against the line. */}
              <circle
                cx={x(hover)}
                cy={y(data[hover].revenue)}
                r={5}
                fill="var(--viz-1)"
                stroke="var(--viz-surface)"
                strokeWidth={2}
              />
            </>
          )}

          {/* Full-height hit columns — never make anyone target the dot, and on
              touch a fat column is the difference between usable and not. */}
          {data.map((d, i) => (
            <rect
              key={`hit-${d.bucket}`}
              x={x(i) - plotW / Math.max(data.length, 1) / 2}
              y={PAD.top}
              width={Math.max(plotW / Math.max(data.length, 1), 24)}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onTouchStart={() => setHover(i)}
            />
          ))}
        </svg>

        {hover !== null && (
          <div
            className="pointer-events-none absolute top-2 z-10 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs shadow-sm dark:border-neutral-700 dark:bg-neutral-800"
            style={{
              left: `min(max(0px, ${(x(hover) / w) * 100}% - 70px), calc(100% - 150px))`,
            }}
          >
            <p className="font-medium">{bucketLabelLong(data[hover].bucket, unit)}</p>
            <p className="mt-1 tabular-nums text-neutral-600 dark:text-neutral-300">
              {peso(data[hover].revenue)} collected
            </p>
            <p className="tabular-nums text-neutral-500">
              {data[hover].orders} order{data[hover].orders === 1 ? "" : "s"}
            </p>
          </div>
        )}
      </div>
    </figure>
  );
}

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / mag) * mag;
}
