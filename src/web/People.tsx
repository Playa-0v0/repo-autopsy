import { Avatar } from "@/components/base/avatar/avatar";
import { cx } from "@/utils/cx";
import { GitBranch } from "lucide-react";
import type { DayStat, PersonStat } from "../shared/types";
import { avatarUrl } from "./api";
import { Heatmap, type Metric } from "./Heatmap";

export interface OverviewStat {
  days: DayStat[];
  commits: number;
  added: number;
  removed: number;
  activeDays: number;
}

interface PeopleProps {
  people: PersonStat[];
  overview: OverviewStat;
  start: string;
  end: string;
  metric: Metric;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

const ROW =
  "flex w-full items-center gap-3 border-b border-separator-border px-4 py-3 text-start transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus-ring last:border-b-0";

const numberFormat = new Intl.NumberFormat("en-US");

export function People({
  people,
  overview,
  start,
  end,
  metric,
  selectedId,
  onSelect,
}: PeopleProps) {
  const overviewActive = selectedId === null;

  return (
    <div className="overflow-hidden rounded-2xl border border-border-button-default bg-background-primary-default">
      <button
        type="button"
        aria-pressed={overviewActive}
        onClick={() => onSelect(null)}
        className={cx(
          ROW,
          overviewActive ? "bg-background-secondary-hover" : "hover:bg-background-secondary-hover",
        )}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-background-tertiary-default">
          <GitBranch className="size-4 text-text-secondary" aria-hidden />
        </span>

        <div className="min-w-0 flex-1">
          <div className="text-body-medium text-text-primary">总览</div>
          <div className="mt-0.5 text-caption-2-regular text-text-tertiary">
            共 {people.length} 位贡献者
          </div>
        </div>

        <div className="hidden shrink-0 md:block">
          <Heatmap
            days={overview.days}
            start={start}
            end={end}
            metric={metric}
            cell={7}
            gap={2}
            showLabels={false}
            interactive={false}
          />
        </div>

        {/* 固定宽度，保证每行右侧的热力图和数字都落在同一条竖线上 */}
        <div className="w-36 shrink-0 text-end tabular-nums">
          <div className="whitespace-nowrap text-body-2-medium text-text-primary">
            {overview.commits.toLocaleString("zh-CN")} 次
          </div>
          <div className="whitespace-nowrap text-caption-2-regular">
            <span className="diff-add">+{numberFormat.format(overview.added)}</span>
            <span className="diff-del ms-1">-{numberFormat.format(overview.removed)}</span>
          </div>
        </div>
      </button>

      {people.map((person) => {
        const active = selectedId === person.id;
        return (
          <button
            key={person.id}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(active ? null : person.id)}
            className={cx(
              ROW,
              active ? "bg-background-secondary-hover" : "hover:bg-background-secondary-hover",
            )}
          >
            <Avatar
              size="lg"
              color={person.color}
              initials={person.initials}
              src={avatarUrl(person.name, person.email)}
              alt={person.name}
            />

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-body-medium text-text-primary">{person.name}</span>
                {person.isBot && (
                  <span className="shrink-0 rounded-full bg-background-tertiary-default px-1.5 text-caption-2-medium text-text-tertiary">
                    机器人
                  </span>
                )}
              </div>
              <div className="mt-0.5 truncate text-caption-2-regular text-text-tertiary">
                {person.email || "没有记录邮箱"}
              </div>
            </div>

            <div className="hidden shrink-0 md:block">
              <Heatmap
                days={person.days}
                start={start}
                end={end}
                metric={metric}
                cell={7}
                gap={2}
                showLabels={false}
                interactive={false}
              />
            </div>

            <div className="w-36 shrink-0 text-end tabular-nums">
              <div className="whitespace-nowrap text-body-2-medium text-text-primary">
                {person.commits.toLocaleString("zh-CN")} 次
              </div>
              <div className="whitespace-nowrap text-caption-2-regular">
                <span className="diff-add">+{numberFormat.format(person.added)}</span>
                <span className="diff-del ms-1">-{numberFormat.format(person.removed)}</span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
