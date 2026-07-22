"use client";

import { useId } from "react";

export default function UsageChart({
  data,
  width = 600,
  height = 160,
}: {
  data: { label: string; value: number }[];
  width?: number;
  height?: number;
}) {
  const id = useId().replace(/:/g, "");
  if (data.length === 0) {
    return (
      <div className="surface-soft rounded-[1.5rem] p-6 text-center text-sm text-[var(--muted)]">
        No data
      </div>
    );
  }
  const max = Math.max(1, ...data.map((d) => d.value));
  const min = 0;
  const padX = 24;
  const padY = 24;
  const w = width - padX * 2;
  const h = height - padY * 2;
  const stepX = w / Math.max(1, data.length - 1);

  const points = data.map((d, i) => {
    const x = padX + stepX * i;
    const y = padY + h - ((d.value - min) / (max - min)) * h;
    return { x, y, d };
  });

  const linePath = points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(" ");
  const areaPath = `${linePath} L ${padX + stepX * (data.length - 1)} ${padY + h} L ${padX} ${padY + h} Z`;

  return (
    <svg width={width} height={height} className="w-full h-auto">
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--brand-glow)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-line`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--brand)" />
          <stop offset="100%" stopColor="var(--brand-glow)" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((n) => <line key={n} x1={padX} x2={width - padX} y1={padY + h * n} y2={padY + h * n} stroke="var(--border)" strokeWidth="1" />)}
      <path d={areaPath} fill={`url(#${id}-fill)`} opacity="0.78" />
      <path className="chart-line" pathLength="1" d={linePath} fill="none" stroke={`url(#${id}-line)`} strokeWidth="2" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3" fill="var(--card-strong)" stroke="var(--brand-glow)" strokeWidth="1.5" />
      ))}
      {data.length <= 12 && points.map((p, i) => (
        <text
          key={i}
          x={p.x}
          y={height - 6}
          textAnchor="middle"
          fontSize="10"
          fill="var(--muted)"
        >
          {p.d.label}
        </text>
      ))}
    </svg>
  );
}
