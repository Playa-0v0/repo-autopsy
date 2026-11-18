import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { CodeReport, LanguageStat } from "../shared/types";
import { scanCode } from "./code.ts";
import { findAnalysis, findCodeReport, getSetting, saveAnalysis, saveCodeReport } from "./db.ts";

const SYSTEM_PROMPT = `你是一个代码仓库技术栈分析助手。

规则：
1. 只根据用户给出的信息判断，不要编造不存在的依赖、版本或产品。
2. 信息不足以判断时写「未识别」，不要猜测。
3. 输出一个 markdown 表格，列固定为：类别 | 技术 | 用途。
4. 类别用简短中文，例如：UI 框架、状态管理、构建工具、测试、样式、数据存储、服务端、工具链、AI 能力。
5. 表格之后最多补三条要点，不要写长篇分析。`;

interface Facts {
  name: string;
  description: string;
  languages: LanguageStat[];
  runtime: string[];
  dev: string[];
  directories: string[];
}

function trimDependencies(source: Record<string, string> | undefined, limit: number): string[] {
  if (!source) return [];
  return Object.keys(source)
    .filter((name) => !name.startsWith("@types/"))
    .sort()
    .slice(0, limit);
}

async function collectFacts(root: string, repoId: number, head: string): Promise<Facts> {
  let pkg: Record<string, unknown> = {};
  try {
    pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    // 不是 Node 项目就没有 package.json
  }

  let report: CodeReport | null = findCodeReport(repoId, head);
  if (!report) {
    report = await scanCode(root);
    saveCodeReport(repoId, head, report);
  }

  let directories: string[] = [];
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    directories = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .filter((name) => name !== "node_modules")
      .slice(0, 20);
  } catch {
    // 读不到目录不影响分析
  }

  return {
    name: typeof pkg.name === "string" ? pkg.name : path.basename(root),
    description: typeof pkg.description === "string" ? pkg.description : "",
    languages: report.languages ?? [],
    runtime: trimDependencies(pkg.dependencies as Record<string, string> | undefined, 80),
    dev: trimDependencies(pkg.devDependencies as Record<string, string> | undefined, 80),
    directories,
  };
}

function buildPrompt(facts: Facts, extra: string): string {
  const lines: string[] = [];
  lines.push(`仓库：${facts.name}`);
  if (facts.description) lines.push(`描述：${facts.description}`);

  if (facts.languages.length > 0) {
    const langs = facts.languages
      .slice(0, 8)
      .map((item) => `${item.language} ${(item.ratio * 100).toFixed(1)}%`)
      .join("、");
    lines.push(`语言占比：${langs}`);
  }

  if (facts.runtime.length > 0) {
    lines.push(`运行时依赖：${facts.runtime.join("、")}`);
  } else {
    lines.push("运行时依赖：没有 package.json 或没有依赖");
  }

  if (facts.dev.length > 0) lines.push(`开发依赖：${facts.dev.join("、")}`);
  if (facts.directories.length > 0) lines.push(`一级目录：${facts.directories.join("、")}`);

  if (extra.trim()) lines.push(`额外要求：${extra.trim()}`);

  lines.push("");
  lines.push("请按系统提示的格式输出这个仓库的技术栈表格。");
  return lines.join("\n");
}

async function callModel(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
}): Promise<string> {
  const endpoint = `${input.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: input.prompt },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`模型接口返回 ${response.status}${detail ? `：${detail.slice(0, 200)}` : ""}`);
  }

  const json = (await response.json()) as {
    choices?: { message?: { content?: unknown } }[];
  };
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("模型没有返回内容");
  }

  return content.trim();
}

/** 把仓库信息喂给模型，返回一段 markdown。同一个 commit 和提示词会直接复用结果 */
export async function analyzeTechStack(input: {
  repoPath: string;
  repoId: number;
  head: string;
  force: boolean;
}): Promise<string> {
  const baseUrl = getSetting("ai.baseUrl") ?? "";
  const apiKey = getSetting("ai.apiKey") ?? "";
  const model = getSetting("ai.model") ?? "";
  const extra = getSetting("ai.extraPrompt") ?? "";

  if (!baseUrl || !apiKey || !model) {
    throw new Error("还没有配置模型，先在菜单里填接口地址、密钥和模型名");
  }

  const root = path.resolve(input.repoPath);
  const facts = await collectFacts(root, input.repoId, input.head);
  const prompt = buildPrompt(facts, extra);

  const fingerprint = createHash("sha256")
    .update(`${baseUrl}|${model}|${prompt}`)
    .digest("hex")
    .slice(0, 24);

  if (!input.force) {
    const cached = findAnalysis(input.repoId, input.head, fingerprint);
    if (cached) return cached;
  }

  const markdown = await callModel({ baseUrl, apiKey, model, prompt });
  saveAnalysis(input.repoId, input.head, fingerprint, markdown);
  return markdown;
}
