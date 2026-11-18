import type { StarPoint } from "../shared/types";

const WIDTH = 720;
const HEIGHT = 220;
const PAD = { top: 14, right: 16, bottom: 26, left: 48 };

const numberFormat = new Intl.NumberFormat("en-US");

function compact(value: number): string {
  if (value >= 10000) return `${(value / 1000).toFixed(1)}k`;
  return numberFormat.format(value);
}

function formatDate(iso: string): string {
  return iso.replaceAll("-", "/");
}

export function StarTrendChart({ points }: { points: StarPoint[] }) {
  const innerWidth = WIDTH - PAD.left - PAD.right;
  const innerHeight = HEIGHT - PAD.top - PAD.bottom;
  const baseY = PAD.top + innerHeight;

  const times = points.map((point) => Date.parse(`${point.date}T00:00:00Z`));
  const start = times[0];
  const end = times[times.length - 1];
  const maxCount = points[points.length - 1].count;

  const x = (time: number) =>
    PAD.left + (end === start ? innerWidth / 2 : ((time - start) / (end - start)) * innerWidth);
  const y = (count: number) =>
    PAD.top + innerHeight - (maxCount === 0 ? 0 : (count / maxCount) * innerHeight);

  const line = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${x(times[index]).toFixed(1)} ${y(point.count).toFixed(1)}`)
    .join(" ");
  const area = `${line} L${x(end).toFixed(1)} ${baseY} L${x(start).toFixed(1)} ${baseY} Z`;

  const ticks = [...new Set([0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round(maxCount * ratio)))];

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label="star 增长趋势"
      className="mt-4 h-auto w-full"
    >
      {ticks.map((tick) => {
        const row = y(tick);
        return (
          <g key={tick}>
            <line
              x1={PAD.left}
              y1={row}
              x2={PAD.left + innerWidth}
              y2={row}
              className="stroke-separator-border"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={row}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-text-tertiary text-caption-2-regular"
            >
              {compact(tick)}
            </text>
          </g>
        );
      })}

      <path d={area} className="fill-accent-500/10" />
      <path
        d={line}
        className="fill-none stroke-accent-500"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      <circle cx={x(end)} cy={y(maxCount)} r={3} className="fill-accent-500" />

      <text
        x={PAD.left}
        y={HEIGHT - 6}
        textAnchor="start"
        className="fill-text-tertiary text-caption-2-regular"
      >
        {formatDate(points[0].date)}
      </text>
      <text
        x={PAD.left + innerWidth}
        y={HEIGHT - 6}
        textAnchor="end"
        className="fill-text-tertiary text-caption-2-regular"
      >
        {formatDate(points[points.length - 1].date)}
      </text>
    </svg>
  );
}
