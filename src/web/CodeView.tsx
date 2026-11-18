import { Button } from "@/components/base/buttons/button";
import { Skeleton } from "@/components/base/skeleton/skeleton";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { CodeReport } from "../shared/types";
import { loadCode } from "./api";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

const numberFormat = new Intl.NumberFormat("en-US");

/** 语言名到 public/lang-icons 下的图标文件名，图标来自 LimeA 的那套彩色语言图标 */
const LANGUAGE_ICONS: Record<string, string> = {
  TypeScript: "typescript",
  JavaScript: "javascript",
  Vue: "vue",
  Svelte: "svelte",
  Python: "python",
  Go: "go",
  Rust: "rust",
  Java: "java",
  Kotlin: "kotlin",
  C: "c",
  "C++": "cpp",
  PHP: "php",
  Swift: "swift",
  CSS: "css",
  SCSS: "sass",
  Less: "less",
};

function Panel({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border-button-default bg-background-primary-default">
      <div className="flex items-baseline gap-2 border-b border-separator-border px-4 py-3">
        <h2 className="text-title-3-semibold text-text-primary">{title}</h2>
        <span className="text-caption-2-regular text-text-tertiary">{hint}</span>
      </div>
      {children}
    </section>
  );
}

export function CodeView({ repoPath }: { repoPath: string }) {
  const [report, setReport] = useState<CodeReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(force: boolean) {
    setLoading(true);
    setError(null);
    try {
      setReport(await loadCode(repoPath, force));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "扫描失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(false);
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
      <div className="space-y-3">
        <Skeleton className="h-8" />
        <Skeleton className="h-[280px]" />
        <Skeleton className="h-[280px]" />
      </div>
    );
  }

  const { summary } = report;
  const unsupported = summary.parsableFiles === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption-1-regular text-text-tertiary">
        <span>
          跟踪文件 {numberFormat.format(summary.trackedFiles)} 个，其中代码文件{" "}
          {numberFormat.format(summary.codeFiles)} 个
        </span>
        <span>扫描耗时 {(summary.durationMs / 1000).toFixed(1)} 秒</span>
        {summary.oversizedFiles > 0 && <span>跳过超大文件 {summary.oversizedFiles} 个</span>}
        <Button
          variant="ghost"
          size="xs"
          className="ms-auto"
          onClick={() => void load(true)}
          disabled={loading}
        >
          {loading ? "扫描中…" : "重新扫描"}
        </Button>
      </div>

      <Panel
        title="大代码文件"
        hint={`按行数排序，只统计 git 跟踪的代码文件`}
      >
        {report.files.length === 0 ? (
          <div className="px-4 py-8 text-center text-body-2-regular text-text-tertiary">
            没有找到代码文件
          </div>
        ) : (
          report.files.map((file, index) => (
            <div
              key={file.path}
              className="flex items-center gap-3 border-b border-separator-border px-4 py-2 last:border-b-0 hover:bg-background-secondary-hover"
            >
              <span className="w-6 shrink-0 text-end font-mono text-caption-2-regular text-text-tertiary">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-body-2-regular text-text-primary">
                {file.path}
              </span>
              <span className="hidden w-28 shrink-0 items-center justify-end gap-1.5 sm:flex">
                {LANGUAGE_ICONS[file.language] && (
                  <img
                    src={`/lang-icons/${LANGUAGE_ICONS[file.language]}.svg`}
                    alt=""
                    aria-hidden
                    className="size-3.5 shrink-0"
                  />
                )}
                <span className="truncate text-caption-2-regular text-text-tertiary">
                  {file.language}
                </span>
              </span>
              <span className="w-20 shrink-0 text-end text-body-2-medium text-text-primary tabular-nums">
                {file.oversized ? "—" : `${numberFormat.format(file.lines)} 行`}
              </span>
              <span className="w-16 shrink-0 text-end text-caption-2-regular text-text-tertiary tabular-nums">
                {formatBytes(file.bytes)}
              </span>
            </div>
          ))
        )}
      </Panel>

      <Panel
        title="大函数"
        hint={
          unsupported
            ? "这个仓库里没有 JS / TS 文件"
            : `解析了 ${numberFormat.format(summary.parsedFunctions)} 个函数，列出超过 30 行的`
        }
      >
        {unsupported ? (
          <div className="px-4 py-8 text-center text-body-2-regular text-text-tertiary">
            函数分析目前只支持 TypeScript / JavaScript，其他语言暂不解析
          </div>
        ) : report.functions.length === 0 ? (
          <div className="px-4 py-8 text-center text-body-2-regular text-text-tertiary">
            没有超过 30 行的函数
          </div>
        ) : (
          report.functions.map((fn, index) => (
            <div
              key={`${fn.file}:${fn.startLine}:${index}`}
              className="flex items-center gap-3 border-b border-separator-border px-4 py-2 last:border-b-0 hover:bg-background-secondary-hover"
            >
              <span className="w-6 shrink-0 text-end font-mono text-caption-2-regular text-text-tertiary">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-body-2-regular text-text-primary">
                {fn.name}
              </span>
              <span className="hidden min-w-0 flex-[1.4] truncate font-mono text-caption-2-regular text-text-tertiary md:block">
                {fn.file}:{fn.startLine}
              </span>
              <span className="w-20 shrink-0 text-end text-body-2-medium text-text-primary tabular-nums">
                {numberFormat.format(fn.lines)} 行
              </span>
            </div>
          ))
        )}
      </Panel>

      <p className="text-caption-2-regular text-text-tertiary">
        只统计 git 跟踪的文件，被忽略的目录和未跟踪的临时文件不参与。函数分析仅覆盖
        TypeScript / JavaScript，其他语言只算文件行数。
      </p>
    </div>
  );
}
