import { Button } from "@/components/base/buttons/button";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { Skeleton } from "@/components/base/skeleton/skeleton";
import { cx } from "@/utils/cx";
import { useEffect, useMemo, useState } from "react";
import type { GraphCommit, GraphData } from "../shared/types";
import { loadGraph } from "./api";

const ROW_HEIGHT = 32;
const PAGE_SIZE = 200;

interface LaidOutRow {
  commit: GraphCommit;
  lane: number;
}

interface Edge {
  fromLane: number;
  fromRow: number;
  toLane: number;
  toRow: number;
}

function laneColor(lane: number): string {
  return `var(--lane-${(lane % 8) + 1})`;
}

/**
 * 给每个提交分配一条轨道。
 *
 * 顺着时间往下走，同时维护一列"还在等父提交出现"的轨道。一个提交落下来时，
 * 先看有没有轨道正在等它 —— 多条轨道同时等同一个父提交时，让它们并到最左边
 * 那条，其余立刻释放，否则分支一多轨道就会无限膨胀。多出来的父提交各自
 * 占一条新轨道，合并提交因此自然分岔。
 */
function computeLayout(commits: GraphCommit[]): {
  rows: LaidOutRow[];
  edges: Edge[];
  laneCount: number;
} {
  const pending: (string | null)[] = [];
  const rows: LaidOutRow[] = [];
  const rowOf = new Map<string, number>();

  commits.forEach((commit, index) => {
    const waiting: number[] = [];
    for (let i = 0; i < pending.length; i += 1) {
      if (pending[i] === commit.hash) waiting.push(i);
    }

    let lane: number;
    if (waiting.length > 0) {
      lane = waiting[0];
      for (let i = 1; i < waiting.length; i += 1) pending[waiting[i]] = null;
    } else {
      lane = pending.indexOf(null);
      if (lane === -1) lane = pending.length;
      pending[lane] = commit.hash;
    }

    rowOf.set(commit.hash, index);
    rows.push({ commit, lane });

    const [first, ...rest] = commit.parents;
    if (first) {
      const existing = pending.indexOf(first);
      // 第一个父提交已经在别的轨道上等着了，这条轨道就到此为止
      pending[lane] = existing === -1 || existing === lane ? first : null;
    } else {
      pending[lane] = null;
    }

    for (const parent of rest) {
      if (pending.includes(parent)) continue;
      const empty = pending.indexOf(null);
      if (empty === -1) pending.push(parent);
      else pending[empty] = parent;
    }
  });

  const edges: Edge[] = [];
  rows.forEach((row, index) => {
    for (const parent of row.commit.parents) {
      const parentIndex = rowOf.get(parent);
      // 父提交可能落在加载窗口之外，那就先不画，避免一条线冲出列表
      if (parentIndex === undefined) continue;
      edges.push({
        fromLane: row.lane,
        fromRow: index,
        toLane: rows[parentIndex].lane,
        toRow: parentIndex,
      });
    }
  });

  const laneCount = rows.reduce((max, row) => Math.max(max, row.lane + 1), 1);
  return { rows, edges, laneCount };
}

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp * 1000;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`;
  return new Date(timestamp * 1000).toLocaleDateString("zh-CN");
}

const REF_STYLES = {
  head: "bg-accent-100 text-accent-900",
  branch: "bg-background-tertiary-default text-text-secondary",
  tag: "bg-amber-100 text-amber-900",
} as const;

export function GraphView({ repoPath }: { repoPath: string }) {
  const [allBranches, setAllBranches] = useState(true);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    loadGraph(repoPath, limit, allBranches)
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "读取提交图失败");
        setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [repoPath, limit, allBranches]);

  const layout = useMemo(() => (data ? computeLayout(data.commits) : null), [data]);

  if (error) {
    return (
      <div className="rounded-2xl border border-border-error-default bg-background-primary-default px-4 py-3 text-body-2-regular text-text-error-primary">
        {error}
      </div>
    );
  }

  if (!layout || !data) {
    return (
      <div className="space-y-2 rounded-2xl border border-border-button-default bg-background-primary-default p-4">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-6" />
        ))}
      </div>
    );
  }

  // 轨道间距按分支数收缩；分支少时放宽，曲线才看得清
  const laneWidth = layout.laneCount > 30 ? 8 : layout.laneCount > 16 ? 14 : 20;
  const padX = 10;
  const graphWidth = padX * 2 + layout.laneCount * laneWidth;
  const nodeRadius = Math.max(3, Math.min(4.5, laneWidth / 2 - 1));
  const height = layout.rows.length * ROW_HEIGHT;

  const xOf = (lane: number) => padX + lane * laneWidth + laneWidth / 2;
  const yOf = (row: number) => row * ROW_HEIGHT + ROW_HEIGHT / 2;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SegmentedControl
          selectedKeys={[allBranches ? "all" : "head"]}
          onSelectionChange={(keys) => {
            const next = [...keys][0];
            if (next !== "all" && next !== "head") return;
            setAllBranches(next === "all");
            setLimit(PAGE_SIZE);
          }}
        >
          <SegmentedControlItem id="all">所有分支</SegmentedControlItem>
          <SegmentedControlItem id="head">当前分支</SegmentedControlItem>
        </SegmentedControl>

        <span className="text-caption-1-regular text-text-tertiary">
          显示 {layout.rows.length} / {data.total} 个提交
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border-button-default bg-background-primary-default">
        {/* 列标题，让每一列都有名有姓 */}
        <div className="flex items-center border-b border-separator-border bg-background-secondary-default text-caption-2-medium text-text-tertiary">
          <div className="shrink-0" style={{ width: graphWidth }} />
          <span className="min-w-0 flex-1 py-2">提交</span>
          <span className="hidden w-24 shrink-0 py-2 sm:block">作者</span>
          <span className="w-16 shrink-0 py-2 text-end">时间</span>
          <span className="w-[76px] shrink-0 pe-3 py-2 text-end">哈希</span>
        </div>

        <div className="relative">
          {/* 轨道区单独铺一层浅底，和右侧内容明确分开 */}
          <div
            className="pointer-events-none absolute inset-y-0 start-0 border-e border-separator-border bg-background-secondary-default"
            style={{ width: graphWidth }}
          />

          <svg
            className="pointer-events-none absolute inset-y-0 start-0"
            width={graphWidth}
            height={height}
            aria-hidden
          >
            {layout.edges.map((edge, index) => {
              const x1 = xOf(edge.fromLane);
              const y1 = yOf(edge.fromRow);
              const x2 = xOf(edge.toLane);
              const y2 = yOf(edge.toRow);
              const middle = (y1 + y2) / 2;
              const d =
                x1 === x2
                  ? `M ${x1} ${y1} L ${x2} ${y2}`
                  : `M ${x1} ${y1} C ${x1} ${middle} ${x2} ${middle} ${x2} ${y2}`;

              return (
                <path
                  key={index}
                  d={d}
                  fill="none"
                  stroke={laneColor(edge.fromLane)}
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              );
            })}

            {layout.rows.map((row, index) => {
              const isMerge = row.commit.parents.length > 1;
              const color = laneColor(row.lane);
              return (
                <circle
                  key={row.commit.hash}
                  cx={xOf(row.lane)}
                  cy={yOf(index)}
                  r={isMerge ? nodeRadius + 0.5 : nodeRadius}
                  fill={isMerge ? "var(--color-background-secondary-default)" : color}
                  stroke={color}
                  strokeWidth={isMerge ? 2 : 0}
                />
              );
            })}
          </svg>

          <div className="relative" style={{ marginInlineStart: graphWidth }}>
            {layout.rows.map((row) => (
              <div
                key={row.commit.hash}
                className="flex items-center gap-2 border-b border-separator-border px-2 last:border-b-0 hover:bg-background-secondary-hover"
                style={{ height: ROW_HEIGHT }}
              >
                {row.commit.refs.slice(0, 1).map((ref) => (
                  <span
                    key={`${ref.type}:${ref.name}`}
                    className={cx(
                      "max-w-[120px] shrink-0 truncate rounded-full px-1.5 text-caption-2-medium",
                      REF_STYLES[ref.type],
                    )}
                  >
                    {ref.name}
                  </span>
                ))}
                {row.commit.refs.length > 1 && (
                  <span className="shrink-0 text-caption-2-regular text-text-tertiary">
                    +{row.commit.refs.length - 1}
                  </span>
                )}

                <span className="min-w-0 flex-1 truncate text-body-2-regular text-text-primary">
                  {row.commit.subject}
                </span>

                <span className="hidden w-24 shrink-0 truncate text-caption-2-regular text-text-tertiary sm:block">
                  {row.commit.author}
                </span>
                <span className="w-16 shrink-0 text-end text-caption-2-regular text-text-tertiary">
                  {relativeTime(row.commit.timestamp)}
                </span>
                <span className="w-[76px] shrink-0 pe-1 text-end font-mono text-caption-2-regular text-text-tertiary">
                  {row.commit.hash.slice(0, 7)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {layout.rows.length < data.total && (
        <div className="mt-3 flex justify-center">
          <Button
            variant="secondary"
            size="small"
            onClick={() => setLimit((value) => value + PAGE_SIZE)}
            disabled={loading}
          >
            {loading ? "加载中…" : `加载更多（还有 ${data.total - layout.rows.length} 个）`}
          </Button>
        </div>
      )}
    </div>
  );
}
