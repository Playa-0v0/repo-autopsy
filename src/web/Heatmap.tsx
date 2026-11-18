import { useMemo, useRef, useState } from "react";
import type { DayStat } from "../shared/types";

export type Metric = "commits" | "lines";

interface HeatmapProps {
  days: DayStat[];
  start: string;
  end: string;
  metric: Metric;
  /** 每格边长（像素）。不传时按列数自适应 */
  cell?: number;
  gap?: number;
  showLabels?: boolean;
  /** 悬停时是否显示浮层 */
  interactive?: boolean;
}

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

function parseDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

/** 0 是周一，6 是周日 */
function weekdayIndex(date: Date): number {
  return (date.getUTCDay() + 6) % 7;
}

function valueOf(day: DayStat | null, metric: Metric): number {
  if (!day) return 0;
  return metric === "commits" ? day.commits : day.added + day.removed;
}

interface Cell {
  date: string;
  day: DayStat | null;
  level: number;
  inRange: boolean;
}

interface WeekColumn {
  cells: Cell[];
  lead: number;
}

/**
 * 分档用非零值的四分位，让深浅真正反映这个仓库自己的节奏，
 * 而不是套一个跟数据规模无关的固定阈值。
 */
function buildThresholds(values: number[]): [number, number, number] {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return [0, 0, 0];
  const at = (ratio: number) => sorted[Math.min(sorted.length - 1, Math.floor(ratio * sorted.length))];
  return [at(0.25), at(0.5), at(0.75)];
}

function levelOf(value: number, thresholds: [number, number, number]): number {
  if (value <= 0) return 0;
  const [low, mid, high] = thresholds;
  if (value <= low) return 1;
  if (value <= mid) return 2;
  if (value <= high) return 3;
  return 4;
}

function buildModel(days: DayStat[], start: string, end: string, metric: Metric) {
  const byDate = new Map(days.map((day) => [day.date, day]));

  const startDate = parseDate(start);
  const endDate = parseDate(end);

  // 从 start 所在周的周一画到 end 所在周的周日，保证每列都是完整七天
  const gridStart = addDays(startDate, -weekdayIndex(startDate));
  const gridEnd = addDays(endDate, 6 - weekdayIndex(endDate));

  const values: number[] = [];
  for (let cursor = new Date(startDate); cursor <= endDate; cursor = addDays(cursor, 1)) {
    values.push(valueOf(byDate.get(formatDate(cursor)) ?? null, metric));
  }
  const thresholds = buildThresholds(values);

  const weeks: WeekColumn[] = [];
  const months: { label: string; index: number }[] = [];
  let lastMonth = -1;

  for (let cursor = new Date(gridStart); cursor <= gridEnd; cursor = addDays(cursor, 7)) {
    const cells: Cell[] = [];
    for (let offset = 0; offset < 7; offset += 1) {
      const current = addDays(cursor, offset);
      const iso = formatDate(current);
      const inRange = current >= startDate && current <= endDate;
      const day = inRange ? (byDate.get(iso) ?? null) : null;
      cells.push({
        date: iso,
        day,
        inRange,
        level: inRange ? levelOf(valueOf(day, metric), thresholds) : 0,
      });
    }

    const weekMonth = cursor.getUTCMonth();
    if (weekMonth !== lastMonth) {
      months.push({ label: `${weekMonth + 1}月`, index: weeks.length });
      lastMonth = weekMonth;
    }

    weeks.push({ cells, lead: 0 });
  }

  return { weeks, months };
}

export function Heatmap({
  days,
  start,
  end,
  metric,
  cell,
  gap,
  showLabels = true,
  interactive = true,
}: HeatmapProps) {
  const { weeks, months } = useMemo(
    () => buildModel(days, start, end, metric),
    [days, start, end, metric],
  );
  const [hovered, setHovered] = useState<{ cell: Cell; x: number; y: number } | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  // 数据天数少时列数也少，格子放大一点，不然像一小撮点
  const cellSize = cell ?? (weeks.length <= 12 ? 22 : weeks.length <= 30 ? 16 : 13);
  const gapSize = gap ?? Math.max(2, Math.round(cellSize / 5));
  const labelWidth = showLabels ? 26 : 0;

  return (
    <div className="relative" ref={hostRef}>
      {showLabels && (
        <div
          className="mb-1 grid text-caption-2-medium text-text-tertiary"
          style={{
            marginInlineStart: labelWidth,
            gridTemplateColumns: `repeat(${weeks.length}, ${cellSize}px)`,
            columnGap: gapSize,
          }}
        >
          {weeks.map((_, index) => {
            const month = months.find((item) => item.index === index);
            return (
              <span key={index} className="whitespace-nowrap">
                {month?.label ?? ""}
              </span>
            );
          })}
        </div>
      )}

      <div className="flex" style={{ gap: gapSize }}>
        {showLabels && (
          <div
            className="grid text-caption-2-regular text-text-tertiary"
            style={{
              width: labelWidth - gapSize,
              gridTemplateRows: `repeat(7, ${cellSize}px)`,
              gap: gapSize,
            }}
          >
            {["一", "", "三", "", "五", "", "日"].map((label, index) => (
              <span key={index} style={{ lineHeight: `${cellSize}px` }}>
                {label}
              </span>
            ))}
          </div>
        )}

        <div
          className="contributions-grid grid overflow-visible"
          data-accent="green"
          style={{
            gridAutoFlow: "column",
            gridTemplateRows: `repeat(7, ${cellSize}px)`,
            gridAutoColumns: `${cellSize}px`,
            gap: gapSize,
          }}
          onMouseLeave={() => setHovered(null)}
        >
          {weeks.map((week, weekIndex) =>
            week.cells.map((cellData, dayIndex) => {
              const hidden = !cellData.inRange;
              return (
                <div
                  key={`${weekIndex}-${dayIndex}`}
                  className={
                    hidden
                      ? "invisible rounded-[3px]"
                      : "contribution-cell rounded-[3px] transition-transform duration-150 hover:scale-[1.18]"
                  }
                  data-tier={cellData.level}
                  style={{ width: cellSize, height: cellSize }}
                  onMouseEnter={
                    interactive && !hidden
                      ? (event) => {
                          const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                          const host = hostRef.current?.getBoundingClientRect();
                          if (!host) return;
                          setHovered({
                            cell: cellData,
                            x: rect.left - host.left + rect.width / 2,
                            y: rect.top - host.top,
                          });
                        }
                      : undefined
                  }
                  onMouseLeave={interactive ? () => setHovered(null) : undefined}
                />
              );
            }),
          )}
        </div>
      </div>

      {hovered && (
        <div
          className="pointer-events-none absolute z-50 rounded-lg border border-border-button-default bg-background-primary-default px-2.5 py-1.5 shadow-dropdown"
          style={{
            left: hovered.x,
            top: hovered.y - 8,
            transform: "translate(-50%, -100%)",
          }}
        >
          <div className="text-caption-1-semibold text-text-primary">
            {hovered.cell.date}
            {WEEKDAY_LABELS[weekdayIndex(parseDate(hovered.cell.date))] && (
              <span className="ms-1 text-text-tertiary">
                周{WEEKDAY_LABELS[weekdayIndex(parseDate(hovered.cell.date))]}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-caption-2-regular text-text-secondary">
            <span>{hovered.cell.day?.commits ?? 0} 次提交</span>
            <span className="diff-add">
              +{(hovered.cell.day?.added ?? 0).toLocaleString("en-US")}
            </span>
            <span className="diff-del">
              -{(hovered.cell.day?.removed ?? 0).toLocaleString("en-US")}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/** 图例：Less → More */
export function HeatmapLegend({ metric }: { metric: Metric }) {
  return (
    <div className="flex items-center gap-1.5 text-caption-2-regular text-text-tertiary">
      <span>少</span>
      <div className="contributions-grid flex gap-[3px]" data-accent="green">
        {[0, 1, 2, 3, 4].map((tier) => (
          <div key={tier} className="contribution-cell size-3 rounded-[3px]" data-tier={tier} />
        ))}
      </div>
      <span>多</span>
      <span className="ms-2">{metric === "commits" ? "按提交次数" : "按代码行数"}</span>
    </div>
  );
}
