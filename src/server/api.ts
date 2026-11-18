import fs from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import {
  findArchive,
  findCodeReport,
  findRepoIdByPath,
  findScan,
  latestScan,
  listArchives,
  saveCodeReport,
  saveScan,
  touchRepo,
} from "./db.ts";
import { getAvatar } from "./avatar.ts";
import { scanCode } from "./code.ts";
import { readHead, scanRepo } from "./git.ts";
import { readGraph } from "./graph.ts";

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(payload);
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
      if (cached) {
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

  if (url.pathname === "/api/repos") {
    send(res, 200, listArchives());
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
