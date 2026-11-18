import { Avatar } from "@/components/base/avatar/avatar";
import { Button } from "@/components/base/buttons/button";
import { Skeleton } from "@/components/base/skeleton/skeleton";
import { CircleAlert, ExternalLink, Eye, GitFork, GitPullRequest, Star, Tag } from "lucide-react";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { CodeReport, LanguageStat, PersonStat, RemoteInfo } from "../shared/types";
import { analyzeTechStack, avatarUrl, loadCode, loadLatestAnalysis, loadRemote, loadSettings } from "./api";

/** 和 GitHub 语言条一致的配色 */
const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  CSS: "#563d7c",
  SCSS: "#c6538c",
  Less: "#1d365d",
  Vue: "#41b883",
  Svelte: "#ff3e00",
  Python: "#3572A5",
  Go: "#00ADD8",
  Rust: "#dea584",
  Java: "#b07219",
  Kotlin: "#A97BFF",
  C: "#555555",
  "C++": "#f34b7d",
  "C#": "#178600",
  PHP: "#4F5D95",
  Swift: "#F05138",
  Ruby: "#701516",
  Scala: "#c22d40",
  Shell: "#89e051",
  PowerShell: "#012456",
  SQL: "#e38c00",
  HTML: "#e34c26",
};

const OTHER_COLOR = "#8b949e";
const MAX_SEGMENTS = 7;
const MAX_AVATARS = 48;

const numberFormat = new Intl.NumberFormat("en-US");

function formatPercent(ratio: number): string {
  const value = ratio * 100;
  // 极小占比不显示成一堆零，免得看着像没算出来
  if (value > 0 && value < 0.1) return "<0.1%";
  return `${value.toFixed(1)}%`;
}

function compactNumber(value: number): string {
  if (value >= 10000) return `${(value / 1000).toFixed(1)}k`;
  return numberFormat.format(value);
}

function Metric({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof Star;
  value: number;
  label: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <Icon className="size-4 text-text-tertiary" aria-hidden />
      <span className="text-body-2-medium text-text-primary tabular-nums">
        {compactNumber(value)}
      </span>
      <span className="text-caption-2-regular text-text-tertiary">{label}</span>
    </span>
  );
}

function colorOf(language: string): string {
  return LANGUAGE_COLORS[language] ?? OTHER_COLOR;
}

function buildSegments(languages: LanguageStat[]): LanguageStat[] {
  if (languages.length <= MAX_SEGMENTS) return languages;

  const head = languages.slice(0, MAX_SEGMENTS - 1);
  const tail = languages.slice(MAX_SEGMENTS - 1);
  const merged = tail.reduce(
    (acc, item) => ({
      language: "Other",
      bytes: acc.bytes + item.bytes,
      files: acc.files + item.files,
      ratio: acc.ratio + item.ratio,
    }),
    { language: "Other", bytes: 0, files: 0, ratio: 0 },
  );

  return [...head, merged];
}

export function RepoView({ repoPath, people }: { repoPath: string; people: PersonStat[] }) {
  const [report, setReport] = useState<CodeReport | null>(null);
  const [remote, setRemote] = useState<RemoteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analysisAt, setAnalysisAt] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [aiReady, setAiReady] = useState(false);

  useEffect(() => {
    loadSettings()
      .then((settings) =>
        setAiReady(Boolean(settings.baseUrl && settings.model && settings.hasKey)),
      )
      .catch(() => setAiReady(false));
  }, []);

  // 打开就显示上次的结论，不重新调模型
  useEffect(() => {
    let cancelled = false;
    loadLatestAnalysis(repoPath)
      .then((saved) => {
        if (cancelled || !saved.markdown) return;
        setAnalysis(saved.markdown);
        setAnalysisAt(saved.createdAt);
      })
      .catch(() => {
        // 没有历史结论就是空的
      });

    return () => {
      cancelled = true;
    };
  }, [repoPath]);

  async function runAnalysis(force: boolean) {
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const result = await analyzeTechStack(repoPath, force);
      setAnalysis(result.markdown);
      setAnalysisAt(new Date().toISOString());
    } catch (cause) {
      setAnalysisError(cause instanceof Error ? cause.message : "分析失败");
    } finally {
      setAnalyzing(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    loadRemote(repoPath)
      .then((next) => {
        if (!cancelled) setRemote(next);
      })
      .catch(() => {
        // 远端信息拿不到不影响其他区块
      });

    return () => {
      cancelled = true;
    };
  }, [repoPath]);

  useEffect(() => {
    let cancelled = false;

    loadCode(repoPath)
      .then((next) => {
        if (!cancelled) setReport(next);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "读取失败");
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

  if (!report) {
    return (
      <div className="space-y-4 rounded-2xl border border-border-button-default bg-background-primary-default p-5">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }

  const segments = buildSegments(report.languages ?? []);
  const humans = people.filter((person) => !person.isBot);
  const shownPeople = humans.slice(0, MAX_AVATARS);
  const restCount = humans.length - shownPeople.length;

  return (
    <div className="space-y-4">
      {remote && (
        <section className="rounded-2xl border border-border-button-default bg-background-primary-default p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {remote.owner && (
                  <Avatar size="md" src={avatarUrl(remote.owner, "")} alt={remote.owner} />
                )}
                <h2 className="text-title-3-semibold text-text-primary">
                  {remote.owner ? `${remote.owner}/${remote.repo}` : remote.repo}
                </h2>
                {remote.platform === "github" && (
                  <span className="rounded-full bg-background-tertiary-default px-2 py-0.5 text-caption-2-medium text-text-secondary">
                    GitHub
                  </span>
                )}
                {!remote.online && (
                  <span className="text-caption-2-regular text-text-tertiary">
                    远端信息没拉到
                  </span>
                )}
              </div>
              {remote.description && (
                <p className="mt-1 text-body-2-regular text-text-secondary">
                  {remote.description}
                </p>
              )}
            </div>

            {remote.webUrl && (
              <a
                href={remote.webUrl}
                target="_blank"
                rel="noreferrer"
                className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-caption-1-medium text-text-secondary transition-colors hover:bg-background-secondary-hover hover:text-text-primary"
              >
                打开仓库
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
            <Metric icon={Star} value={remote.stars} label="Star" />
            <Metric icon={GitFork} value={remote.forks} label="Fork" />
            <Metric icon={Eye} value={remote.watchers} label="Watch" />
            <Metric icon={CircleAlert} value={remote.openIssues} label="Issue" />
            <Metric icon={GitPullRequest} value={remote.openPulls} label="PR" />
            {remote.license && (
              <span className="text-caption-1-regular text-text-tertiary">{remote.license}</span>
            )}
          </div>

          {remote.tags.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              <Tag className="size-3.5 text-text-tertiary" aria-hidden />
              {remote.tags.map((tag) => (
                <span
                  key={tag.name}
                  className="rounded-full bg-background-tertiary-default px-2 py-0.5 font-mono text-caption-2-medium text-text-secondary"
                  title={tag.date}
                >
                  {tag.name}
                </span>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="rounded-2xl border border-border-button-default bg-background-primary-default p-5">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="text-title-3-semibold text-text-primary">语言构成</h2>
          <span className="text-caption-2-regular text-text-tertiary">
            {numberFormat.format(report.summary.codeFiles)} 个代码文件
          </span>
        </div>

        {segments.length === 0 ? (
          <div className="py-8 text-center text-body-2-regular text-text-tertiary">
            没有找到代码文件
          </div>
        ) : (
          <>
            <div className="flex h-2 w-full gap-px overflow-hidden rounded-full">
              {segments.map((segment) => (
                <div
                  key={segment.language}
                  className="h-full first:rounded-s-full last:rounded-e-full"
                  style={{
                    width: `${segment.ratio * 100}%`,
                    backgroundColor: colorOf(segment.language),
                  }}
                  title={`${segment.language} ${formatPercent(segment.ratio)}`}
                />
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
              {segments.map((segment) => (
                <div key={segment.language} className="flex items-center gap-2">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: colorOf(segment.language) }}
                    aria-hidden
                  />
                  <span className="text-body-2-medium text-text-primary">{segment.language}</span>
                  <span className="text-caption-1-regular text-text-tertiary tabular-nums">
                    {formatPercent(segment.ratio)}
                  </span>
                  <span className="text-caption-2-regular text-text-tertiary tabular-nums">
                    {numberFormat.format(segment.files)} 文件
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        <p className="mt-5 text-caption-2-regular text-text-tertiary">
          按文件字节数统计，和 GitHub 的语言条算法一致。只算 git 跟踪的代码文件，markdown、图片、配置都不计入。
        </p>
      </section>

      <section className="rounded-2xl border border-border-button-default bg-background-primary-default p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <h2 className="text-title-3-semibold text-text-primary">技术栈</h2>
            <span className="text-caption-2-regular text-text-tertiary">模型分析</span>
            {analysisAt && (
              <span className="text-caption-2-regular text-text-tertiary">
                {new Date(analysisAt).toLocaleString("zh-CN")}
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void runAnalysis(true)}
            disabled={!aiReady || analyzing}
          >
            {analyzing ? "分析中…" : analysis ? "重新分析" : "开始分析"}
          </Button>
        </div>

        {!aiReady ? (
          <p className="text-body-2-regular text-text-tertiary">
            还没配置模型。点左上角图标 → 模型设置，填一个 OpenAI 兼容接口就能用。
          </p>
        ) : analysis ? (
          <div className="text-body-2-regular text-text-secondary [&_code]:rounded [&_code]:bg-background-tertiary-default [&_code]:px-1 [&_code]:font-mono [&_code]:text-caption-1-regular [&_li]:mt-0.5 [&_p]:mt-2 [&_strong]:font-medium [&_strong]:text-text-primary [&_table]:mt-1 [&_table]:w-full [&_table]:border-collapse [&_td]:border-b [&_td]:border-separator-border [&_td]:px-2 [&_td]:py-1.5 [&_td]:align-top [&_th]:border-b [&_th]:border-separator-border [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-start [&_th]:text-caption-2-medium [&_th]:text-text-tertiary [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:ps-5">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{analysis}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-body-2-regular text-text-tertiary">
            会把依赖列表、语言占比和一级目录发给模型，生成一张技术栈表格。不会上传源码。
          </p>
        )}

        {analysisError && (
          <p className="mt-2 text-caption-1-regular text-text-error-primary">{analysisError}</p>
        )}
      </section>

      <section className="rounded-2xl border border-border-button-default bg-background-primary-default p-5">
        <div className="mb-4 flex items-baseline gap-2">
          <h2 className="text-title-3-semibold text-text-primary">贡献者</h2>
          <span className="rounded-full bg-background-tertiary-default px-2 text-caption-2-medium text-text-secondary tabular-nums">
            {numberFormat.format(humans.length)}
          </span>
        </div>

        {humans.length === 0 ? (
          <div className="py-6 text-center text-body-2-regular text-text-tertiary">
            没有贡献者记录
          </div>
        ) : (
          <div className="flex flex-wrap gap-2.5">
            {shownPeople.map((person) => (
              <Avatar
                key={person.id}
                size="lg"
                color={person.color}
                initials={person.initials}
                src={avatarUrl(person.name, person.email)}
                alt={person.name}
                title={`${person.name} · ${numberFormat.format(person.commits)} 次提交`}
                className="size-12 text-base"
              />
            ))}
            {restCount > 0 && (
              <span className="flex size-12 items-center justify-center rounded-full bg-background-tertiary-default text-caption-2-medium text-text-tertiary tabular-nums">
                +{restCount}
              </span>
            )}
          </div>
        )}

        <p className="mt-4 text-caption-2-regular text-text-tertiary">
          按改动量排序，机器人不显示。鼠标停上去能看到名字和提交数。
        </p>
      </section>
    </div>
  );
}
