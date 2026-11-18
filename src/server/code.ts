import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parse } from "@babel/parser";
import type {
  CodeFileStat,
  CodeFunctionStat,
  CodeReport,
  LanguageStat,
} from "../shared/types";

const exec = promisify(execFile);

/** 只认这些扩展名，markdown、json、图片、字体一概不参与 */
const CODE_LANGUAGES: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  mts: "TypeScript",
  cts: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  vue: "Vue",
  svelte: "Svelte",
  py: "Python",
  go: "Go",
  rs: "Rust",
  java: "Java",
  kt: "Kotlin",
  kts: "Kotlin",
  c: "C",
  h: "C",
  cc: "C++",
  cpp: "C++",
  hpp: "C++",
  cs: "C#",
  rb: "Ruby",
  php: "PHP",
  swift: "Swift",
  scala: "Scala",
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
  ps1: "PowerShell",
  sql: "SQL",
  css: "CSS",
  scss: "SCSS",
  less: "Less",
};

/** 只有 JS / TS 系能解析函数，其他语言暂时只统计文件行数 */
const PARSABLE = new Set(["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"]);

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
]);

const SKIP_KEYS = new Set([
  "loc",
  "start",
  "end",
  "extra",
  "range",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "comments",
  "tokens",
]);

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MIN_FUNCTION_LINES = 30;
const TOP_LIMIT = 40;

interface AstNode {
  type: string;
  loc?: { start: { line: number }; end: { line: number } };
  id?: { type: string; name?: string };
  key?: { name?: string; value?: string; type: string };
  kind?: string;
  [key: string]: unknown;
}

function extOf(file: string): string {
  const base = file.slice(file.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
}

async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", ["-c", "core.quotepath=false", ...args], {
    cwd: repo,
    maxBuffer: 32 * 1024 * 1024,
    encoding: "utf8",
    windowsHide: true,
  });
  return stdout;
}

async function mapLimit<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await run(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function functionName(node: AstNode, parent: AstNode | null): string {
  if (node.id?.name) return node.id.name;

  if (node.key) {
    if (typeof node.key.name === "string") return node.key.name;
    if (typeof node.key.value === "string") return node.key.value;
  }

  if (node.kind === "constructor") return "constructor";
  if (node.kind === "get" || node.kind === "set") return `<${node.kind}ter>`;

  if (parent?.type === "VariableDeclarator" && parent.id?.name) return parent.id.name;
  if (parent?.type === "AssignmentExpression") {
    const left = parent["left"] as AstNode | undefined;
    if (left?.type === "Identifier" && typeof left.name === "string") return left.name;
  }
  if (parent?.type === "Property" && parent.key?.name) return parent.key.name;

  return "<匿名>";
}

function extractFunctions(file: string, text: string): CodeFunctionStat[] {
  let ast: unknown;
  try {
    ast = parse(text, {
      sourceType: "module",
      errorRecovery: true,
      allowReturnOutsideFunction: true,
      plugins: ["typescript", "jsx", "decorators-legacy"],
    });
  } catch {
    return [];
  }

  const found: CodeFunctionStat[] = [];

  const visit = (node: unknown, parent: AstNode | null) => {
    if (!node || typeof node !== "object") return;
    const current = node as AstNode;
    if (typeof current.type !== "string") return;

    if (FUNCTION_TYPES.has(current.type) && current.loc) {
      const lines = current.loc.end.line - current.loc.start.line + 1;
      if (lines >= MIN_FUNCTION_LINES) {
        found.push({
          file,
          name: functionName(current, parent),
          startLine: current.loc.start.line,
          endLine: current.loc.end.line,
          lines,
        });
      }
    }

    for (const key of Object.keys(current)) {
      if (SKIP_KEYS.has(key)) continue;
      const value = (current as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        for (const item of value) visit(item, current);
      } else if (value && typeof value === "object") {
        visit(value, current);
      }
    }
  };

  visit(ast, null);
  return found;
}

/**
 * 扫描仓库里被 git 跟踪的代码文件：按行数排出大文件，再解析出大函数。
 *
 * 文件清单来自 git，所以被 ignore 的目录（node_modules、dist 之外的自定义忽略）
 * 和未跟踪的临时文件都不会进来。markdown、json、图片、字体不在代码扩展名表里，
 * 也不会被算进来。
 */
export async function scanCode(repoPath: string): Promise<CodeReport> {
  const started = Date.now();
  const root = path.resolve(repoPath);

  const listed = await git(root, ["ls-files"]);
  const tracked = listed.split("\n").filter(Boolean);

  const targets: { file: string; ext: string; language: string }[] = [];
  for (const file of tracked) {
    const ext = extOf(file);
    const language = CODE_LANGUAGES[ext];
    if (!language) continue;
    // 类型声明文件没有函数体，min 文件分析价值也不大
    if (file.endsWith(".d.ts") || /\.min\.(js|css)$/i.test(file)) continue;
    targets.push({ file, ext, language });
  }

  let scannedFiles = 0;
  let oversizedFiles = 0;
  let parsedFunctions = 0;
  let parsableFiles = 0;

  /** 语言占比按字节算，和 GitHub 的 Languages 条一致 */
  const languageBytes = new Map<string, { bytes: number; files: number }>();

  const collected = await mapLimit(targets, 16, async (target) => {
    try {
      const full = path.join(root, target.file);
      const info = await fs.stat(full);

      const bucket = languageBytes.get(target.language) ?? { bytes: 0, files: 0 };
      bucket.bytes += info.size;
      bucket.files += 1;
      languageBytes.set(target.language, bucket);

      if (info.size > MAX_FILE_BYTES) {
        oversizedFiles += 1;
        return {
          file: {
            path: target.file,
            language: target.language,
            lines: 0,
            bytes: info.size,
            oversized: true,
          } satisfies CodeFileStat,
          functions: [] as CodeFunctionStat[],
        };
      }

      const text = await fs.readFile(full, "utf8");
      const lines = text.length === 0 ? 0 : text.split("\n").length;
      scannedFiles += 1;

      let functions: CodeFunctionStat[] = [];
      if (PARSABLE.has(target.ext)) {
        parsableFiles += 1;
        functions = extractFunctions(target.file, text);
        parsedFunctions += functions.length;
      }

      return {
        file: {
          path: target.file,
          language: target.language,
          lines,
          bytes: info.size,
          oversized: false,
        } satisfies CodeFileStat,
        functions,
      };
    } catch {
      return null;
    }
  });

  const files: CodeFileStat[] = [];
  const functions: CodeFunctionStat[] = [];

  for (const item of collected) {
    if (!item) continue;
    files.push(item.file);
    functions.push(...item.functions);
  }

  files.sort((a, b) => b.lines - a.lines || b.bytes - a.bytes);
  functions.sort((a, b) => b.lines - a.lines);

  const totalBytes = [...languageBytes.values()].reduce((sum, item) => sum + item.bytes, 0);
  const languages: LanguageStat[] = [...languageBytes.entries()]
    .map(([language, item]) => ({
      language,
      bytes: item.bytes,
      files: item.files,
      ratio: totalBytes > 0 ? item.bytes / totalBytes : 0,
    }))
    .sort((a, b) => b.bytes - a.bytes);

  return {
    files: files.slice(0, TOP_LIMIT),
    functions: functions.slice(0, TOP_LIMIT),
    languages,
    summary: {
      trackedFiles: tracked.length,
      codeFiles: targets.length,
      scannedFiles,
      parsedFunctions,
      oversizedFiles,
      parsableFiles,
      durationMs: Date.now() - started,
    },
  };
}
