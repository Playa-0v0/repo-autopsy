import { Skeleton } from "@/components/base/skeleton/skeleton";
import { useEffect, useState } from "react";
import type { ScoreReport } from "../shared/types";
import { loadScore } from "./api";
import { RadarChart } from "./RadarChart";

export function ScoreView({ repoPath }: { repoPath: string }) {
  const [score, setScore] = useState<ScoreReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    loadScore(repoPath)
      .then((value) => {
        if (!cancelled) setScore(value);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "评分失败");
      });

    return () => {
      cancelled = true;
    };
  }, [repoPath]);

  if (error) {
    return (
      <div className="rounded-2xl border border-border-error-default bg-background-primary-default px-4 py-3 text-body-2-regular text-text-error-primary">
        {error}
      </div>
    );
  }

  if (!score) {
    return (
      <div className="space-y-4 rounded-2xl border border-border-button-default bg-background-primary-default p-5">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border-button-default bg-background-primary-default p-5">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between sm:gap-8">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="text-title-3-semibold text-text-primary">六维评分</h2>
              <span className="text-caption-2-regular text-text-tertiary">
                趣味指标，只在同一仓库内纵向比较
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-display-3-semibold tabular-nums text-text-primary">
                {score.total}
              </span>
              <span className="text-body-2-regular text-text-tertiary">/ 100</span>
            </div>
            <p className="mt-2 text-title-3-semibold text-text-primary">{score.title}</p>
            <p className="mt-1 text-body-2-regular text-text-secondary">{score.subtitle}</p>
          </div>

          <div className="shrink-0">
            <RadarChart dimensions={score.dimensions} />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border-button-default bg-background-primary-default p-5">
        <div className="mb-4 flex flex-wrap items-baseline gap-2">
          <h2 className="text-title-3-semibold text-text-primary">各项评分</h2>
          <span className="text-caption-2-regular text-text-tertiary">每个维度的计算依据</span>
        </div>

        <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
          {score.dimensions.map((dimension) => (
            <div key={dimension.key}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-caption-1-medium text-text-primary">{dimension.label}</span>
                <span className="tabular-nums text-caption-1-semibold text-text-primary">
                  {dimension.score}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-background-tertiary-default">
                <div
                  className="h-full rounded-full bg-accent-500"
                  style={{ width: `${dimension.score}%` }}
                />
              </div>
              <ul className="mt-2 space-y-1">
                {dimension.details.map((detail) => (
                  <li
                    key={detail}
                    className="flex gap-1.5 text-caption-1-regular text-text-secondary"
                  >
                    <span
                      className="mt-[0.45em] size-1 shrink-0 rounded-full bg-text-tertiary"
                      aria-hidden
                    />
                    <span className="min-w-0 break-words">{detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
