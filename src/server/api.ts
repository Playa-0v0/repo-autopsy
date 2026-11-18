import fs from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import {
  findArchive,
  findCodeReport,
  findLatestAnalysis,
  findRepoIdByPath,
  findScan,
  getSetting,
  latestScan,
  listArchives,
  saveCodeReport,
  saveScan,
  setSetting,
  touchRepo,
} from "./db.ts";
import { getAvatar } from "./avatar.ts";
import { analyzeTechStack } from "./analyze.ts";
import { scanCode } from "./code.ts";
import { readHead, scanRepo } from "./git.ts";
import { readGraph } from "./graph.ts";
import { readRemote, readOwner } from "./remote.ts";
import { computeScore } from "./score.ts";

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/api/avatar") {
    const name = url.searchParams.get("name") ?? "";
    const email = url.searchParams.get("email") ?? "";
    const avatar = await getAvatar(name, email);

    if (!avatar) {
      res.statusCode = 404;
      res.setHeader("Cache-Control", "public, max-age=600");
      res.end();
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", avatar.contentType);
    res.setHeader("Content-Length", String(avatar.data.byteLength));
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.end(Buffer.from(avatar.data));
    return;
  }

  if (url.pathname === "/api/graph") {
    const repoPath = url.searchParams.get("path")?.trim();
    if (!repoPath) {
      send(res, 400, { error: "请先填一个仓库路径" });
      return;
    }

    const rawLimit = Number(url.searchParams.get("limit"));
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 2000) : 200;
    const allBranches = url.searchParams.get("all") !== "0";

    try {
      send(res, 200, await readGraph(repoPath, limit, allBranches));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      send(res, 500, { error: message });
    }
    return;
  }

  if (url.pathname === "/api/code") {
    const repoPath = url.searchParams.get("path")?.trim();
    if (!repoPath) {
      send(res, 400, { error: "请先填一个仓库路径" });
      return;
    }

    const abs = path.resolve(repoPath);

    try {
      const head = await readHead(abs);
      if (!head) {
        send(res, 400, { error: `${abs} 不是一个 git 仓库，或者还没有任何提交` });
        return;
      }

      const repoId = touchRepo(abs, path.basename(abs));
      const force = url.searchParams.get("force") === "1";
      const cached = force ? null : findCodeReport(repoId, head);
      // 早期版本的结果没有语言占比，遇到就重扫一次
      if (cached && Array.isArray(cached.languages)) {
        send(res, 200, cached);
        return;
      }

      const report = await scanCode(abs);
      saveCodeReport(repoId, head, report);
      send(res, 200, report);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      send(res, 500, { error: message });
    }
    return;
  }

  if (url.pathname === "/api/remote") {
    const repoPath = url.searchParams.get("path")?.trim();
    if (!repoPath) {
      send(res, 400, { error: "请先填一个仓库路径" });
      return;
    }

    try {
      send(res, 200, await readRemote(repoPath));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      send(res, 500, { error: message });
    }
    return;
  }

  if (url.pathname === "/api/score") {
    const repoPath = url.searchParams.get("path")?.trim();
    if (!repoPath) {
      send(res, 400, { error: "请先填一个仓库路径" });
      return;
    }

    try {
      const abs = path.resolve(repoPath);
      const head = await readHead(abs);
      if (!head) {
        send(res, 400, { error: `${abs} 不是一个 git 仓库，或者还没有任何提交` });
        return;
      }

      const repoId = findRepoIdByPath(abs);
      if (repoId === null) {
        send(res, 400, { error: "这个仓库还没有统计过，先跑一次扫描" });
        return;
      }

      const scan = findScan(repoId, head);
      if (!scan) {
        send(res, 400, { error: "当前提交还没有统计过，先跑一次扫描" });
        return;
      }

      let report = findCodeReport(repoId, head);
      // 老缓存缺少全量指标，重新扫一遍
      if (!report || !report.metrics || report.metrics.productionFiles === undefined) {
        report = await scanCode(abs);
        saveCodeReport(repoId, head, report);
      }

      send(res, 200, computeScore(abs, scan, report));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      send(res, 500, { error: message });
    }
    return;
  }

  if (url.pathname === "/api/analysis") {
    const repoPath = url.searchParams.get("path")?.trim();
    if (!repoPath) {
      send(res, 400, { error: "请先填一个仓库路径" });
      return;
    }

    const repoId = findRepoIdByPath(path.resolve(repoPath));
    if (repoId === null) {
      send(res, 200, { markdown: null, createdAt: null });
      return;
    }

    const latest = findLatestAnalysis(repoId);
    send(res, 200, {
      markdown: latest?.markdown ?? null,
      createdAt: latest?.createdAt ?? null,
    });
    return;
  }

  if (url.pathname === "/api/settings") {
    if (req.method === "POST") {
      const body = await readJson(req);
      const keys = ["ai.baseUrl", "ai.apiKey", "ai.model", "ai.extraPrompt"];
      for (const key of keys) {
        if (typeof body[key] === "string") setSetting(key, body[key] as string);
      }
      send(res, 200, { ok: true });
      return;
    }

    send(res, 200, {
      baseUrl: getSetting("ai.baseUrl") ?? "",
      model: getSetting("ai.model") ?? "",
      extraPrompt: getSetting("ai.extraPrompt") ?? "",
      hasKey: Boolean(getSetting("ai.apiKey")),
    });
    return;
  }

  if (url.pathname === "/api/analyze") {
    if (req.method !== "POST") {
      send(res, 405, { error: "这个接口要用 POST" });
      return;
    }

    const body = await readJson(req);
    const input = typeof body.path === "string" ? body.path.trim() : "";
    if (!input) {
      send(res, 400, { error: "请先填一个仓库路径" });
      return;
    }

    const abs = path.resolve(input);

    try {
      const head = await readHead(abs);
      if (!head) {
        send(res, 400, { error: `${abs} 不是一个 git 仓库，或者还没有任何提交` });
        return;
      }

      const repoId = touchRepo(abs, path.basename(abs));
      const markdown = await analyzeTechStack({
        repoPath: abs,
        repoId,
        head,
        force: body.force === true,
      });
      send(res, 200, { markdown });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      send(res, 500, { error: message });
    }
    return;
  }

  if (url.pathname === "/api/repos") {
    const archives = await Promise.all(
      listArchives().map(async (item) => ({ ...item, owner: await readOwner(item.path) })),
    );
    send(res, 200, archives);
    return;
  }

  if (url.pathname === "/api/repo") {
    const id = Number(url.searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) {
      send(res, 400, { error: "档案编号不对" });
      return;
    }

    const archive = findArchive(id);
    if (!archive) {
      send(res, 404, { error: "找不到这个仓库档案" });
      return;
    }

    const stats = latestScan(id);
    if (!stats) {
      send(res, 404, { error: `${archive.name} 还没有扫描记录，点一下重新扫描` });
      return;
    }

    send(res, 200, stats);
    return;
  }

  if (url.pathname !== "/api/scan") {
    send(res, 404, { error: "没有这个接口" });
    return;
  }

  const input = url.searchParams.get("path")?.trim();
  if (!input) {
    send(res, 400, { error: "请先填一个仓库路径" });
    return;
  }

  const repoPath = path.resolve(input);

  try {
    const stat = await fs.stat(repoPath);
    if (!stat.isDirectory()) {
      send(res, 400, { error: `这不是一个文件夹：${repoPath}` });
      return;
    }
  } catch {
    send(res, 400, { error: `找不到这个路径：${repoPath}` });
    return;
  }

  try {
    const head = await readHead(repoPath);
    if (!head) {
      send(res, 400, { error: `${repoPath} 不是一个 git 仓库，或者还没有任何提交` });
      return;
    }

    const existingId = findRepoIdByPath(repoPath);
    if (existingId !== null) {
      const cached = findScan(existingId, head);
      if (cached) {
        touchRepo(repoPath, cached.name);
        send(res, 200, cached);
        return;
      }
    }

    const stats = await scanRepo(repoPath);
    const repoId = touchRepo(repoPath, stats.name);
    saveScan(repoId, stats);
    send(res, 200, stats);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send(res, 500, { error: message });
  }
}
