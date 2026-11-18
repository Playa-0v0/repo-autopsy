import type { ScoreDimension } from "../shared/types";

const SIZE = 260;
const CX = SIZE / 2;
const CY = SIZE / 2;
const RADIUS = 82;

/** 把第 index 个轴上的 value 换算成坐标 */
function point(index: number, value: number, total: number): [number, number] {
  const angle = (Math.PI * 2 * index) / total - Math.PI / 2;
  const radius = (RADIUS * value) / 100;
  return [CX + Math.cos(angle) * radius, CY + Math.sin(angle) * radius];
}

function anchorFor(index: number, total: number): "start" | "middle" | "end" {
  const angle = (Math.PI * 2 * index) / total - Math.PI / 2;
  const cos = Math.cos(angle);
  if (cos > 0.2) return "start";
  if (cos < -0.2) return "end";
  return "middle";
}

export function RadarChart({ dimensions }: { dimensions: ScoreDimension[] }) {
  const total = dimensions.length;
  const rings = [25, 50, 75, 100];

  const polygon = (value: number) =>
    dimensions.map((_, index) => point(index, value, total).join(",")).join(" ");

  const dataPolygon = dimensions
    .map((dimension, index) => point(index, dimension.score, total).join(","))
    .join(" ");

  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label="六维评分雷达图"
      className="shrink-0"
    >
      {rings.map((ring) => (
        <polygon
          key={ring}
          points={polygon(ring)}
          className="fill-none stroke-separator-border"
          strokeWidth={1}
        />
      ))}

      {dimensions.map((_, index) => {
        const [x, y] = point(index, 100, total);
        return (
          <line
            key={index}
            x1={CX}
            y1={CY}
            x2={x}
            y2={y}
            className="stroke-separator-border"
            strokeWidth={1}
          />
        );
      })}

      <polygon
        points={dataPolygon}
        className="fill-accent-500/15 stroke-accent-500"
        strokeWidth={2}
      />

      {dimensions.map((dimension, index) => {
        const [x, y] = point(index, dimension.score, total);
        return <circle key={dimension.key} cx={x} cy={y} r={3} className="fill-accent-500" />;
      })}

      {dimensions.map((dimension, index) => {
        const [x, y] = point(index, 124, total);
        const anchor = anchorFor(index, total);
        return (
          <text key={dimension.key} x={x} y={y} textAnchor={anchor} dominantBaseline="middle">
            <tspan className="fill-text-secondary text-caption-1-medium">{dimension.label}</tspan>
            <tspan
              x={x}
              dy={14}
              className="fill-text-primary text-caption-2-semibold"
            >
              {dimension.score}
            </tspan>
          </text>
        );
      })}
    </svg>
  );
}
