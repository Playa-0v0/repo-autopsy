import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { StarHistory, StarPoint } from "../shared/types";
import { findStarHistory, saveStarHistory } from "./db.ts";
import { githubToken } from "./github.ts";
import { parseGitHub } from "./remote.ts";

const exec = promisify(execFile);

/** stargazers 接口每页最多 100 条 */
const PAGE_SIZE = 100;
/** 翻 100 页已经够慢，再大的仓库就不折腾了 */
const MAX_STARS = 10_000;

async function remoteUrl(repoPath: string): Promise<string> {
  try {
    const { stdout } = await exec("git", ["remote", "get-url", "origin"], {
      cwd: path.resolve(repoPath),
      encoding: "utf8",
      windowsHide: true,
    });
    return stdout.trim();
  } catch {
    return "";
  }
}

async function githubHeaders(accept: string): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "User-Agent": "gitcontribution",
    Accept: accept,
  };
  const token = await githubToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function githubJson(url: string): Promise<Response> {
  return fetch(url, {
    headers: await githubHeaders("application/vnd.github+json"),
    signal: AbortSignal.timeout(8000),
  });
}

/** 403 不一定是私有仓库，也可能是接口额度用完了 */
function rateLimitReason(response: Response): string | null {
  if (response.status !== 403 && response.status !== 429) return null;
  if (response.headers.get("x-ratelimit-remaining") !== "0") return null;

  const resetAt = Number(response.headers.get("x-ratelimit-reset")) * 1000;
  const when =
    Number.isFinite(resetAt) && resetAt > 0
      ? new Date(resetAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
      : "稍后";
  return `GitHub 接口额度用完了，${when} 之后才能继续拉`;
}

/** 把一串打星时间压成按天的累计曲线 */
export function toStarPoints(stamps: number[]): StarPoint[] {
  const sorted = [...stamps].sort((a, b) => a - b);
  const daily = new Map<string, number>();

  for (const stamp of sorted) {
    const date = new Date(stamp).toISOString().slice(0, 10);
    daily.set(date, (daily.get(date) ?? 0) + 1);
  }

  let running = 0;
  return [...daily.entries()].map(([date, count]) => {
    running += count;
    return { date, count: running };
  });
}

/**
 * 还原 star 增长曲线。
 *
 * GitHub 没有现成的 star 历史接口，只能翻 stargazers 列表拿每颗星的
 * starred_at 时间，再按天累加。结果存进数据库，星数没变就直接用缓存。
 */
export async function readStarHistory(repoPath: string, repoId: number): Promise<StarHistory> {
  const parsed = parseGitHub(await remoteUrl(repoPath));
  if (!parsed) {
    return {
      available: false,
      reason: "这个仓库没有 GitHub 远端，拿不到 star 趋势",
      total: 0,
      fetchedAt: null,
      points: [],
    };
  }

  const cached = findStarHistory(repoId);

  let total = 0;
  try {
    const response = await githubJson(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`);
    if (!response.ok) {
      const reason =
        rateLimitReason(response) ??
        (response.status === 404
          ? "仓库不可访问，可能是私有的"
          : `GitHub 接口返回 ${response.status}`);
      if (cached) {
        return {
          available: true,
          reason: `${reason}，显示的是上次拉到的数据`,
          total: cached.total,
          fetchedAt: cached.fetchedAt,
          points: cached.points,
        };
      }
      return { available: false, reason, total: 0, fetchedAt: null, points: [] };
    }
    const json = (await response.json()) as { stargazers_count?: number };
    total = Number(json.stargazers_count) || 0;
  } catch {
    if (cached) {
      return {
        available: true,
        reason: "GitHub 暂时连不上，显示的是上次拉到的数据",
        total: cached.total,
        fetchedAt: cached.fetchedAt,
        points: cached.points,
      };
    }
    return {
      available: false,
      reason: "GitHub 暂时连不上",
      total: 0,
      fetchedAt: null,
      points: [],
    };
  }

  if (total === 0) {
    return {
      available: true,
      reason: "还没有人点星",
      total: 0,
      fetchedAt: null,
      points: [],
    };
  }

  // 星数没变就不用再翻一遍
  if (cached && cached.total === total) {
    return {
      available: true,
      reason: null,
      total: cached.total,
      fetchedAt: cached.fetchedAt,
      points: cached.points,
    };
  }

  if (total > MAX_STARS) {
    if (cached) {
      return {
        available: true,
        reason: `star 太多（${total.toLocaleString("en-US")}），翻页拉取太慢，显示的是上次的 ${cached.total.toLocaleString("en-US")} 颗`,
        total: cached.total,
        fetchedAt: cached.fetchedAt,
        points: cached.points,
      };
    }
    return {
      available: false,
      reason: `star 太多（${total.toLocaleString("en-US")}），翻页拉取太慢，先不画了`,
      total,
      fetchedAt: null,
      points: [],
    };
  }

  const stamps: number[] = [];
  try {
    for (let page = 1; page <= Math.ceil(total / PAGE_SIZE); page += 1) {
      const response = await fetch(
        `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/stargazers?per_page=${PAGE_SIZE}&page=${page}`,
        {
          headers: await githubHeaders("application/vnd.github.star+json"),
          signal: AbortSignal.timeout(8000),
        },
      );
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("GitHub 要求登录才能拉 star 历史，先运行 gh auth login");
        }
        throw new Error(rateLimitReason(response) ?? `GitHub 接口返回 ${response.status}，翻页失败`);
      }

      const data = (await response.json()) as { starred_at?: string }[];
      if (!Array.isArray(data) || data.length === 0) break;

      for (const item of data) {
        if (typeof item.starred_at !== "string") continue;
        const stamp = Date.parse(item.starred_at);
        if (Number.isFinite(stamp)) stamps.push(stamp);
      }

      if (data.length < PAGE_SIZE) break;
    }
  } catch (error) {
    const reason =
      error instanceof Error && error.message.startsWith("GitHub")
        ? error.message
        : "GitHub 暂时连不上";

    if (cached) {
      return {
        available: true,
        reason: `${reason}，显示的是上次拉到的数据`,
        total: cached.total,
        fetchedAt: cached.fetchedAt,
        points: cached.points,
      };
    }
    return { available: false, reason, total, fetchedAt: null, points: [] };
  }

  const points = toStarPoints(stamps);
  saveStarHistory(repoId, total, points);

  return {
    available: true,
    reason: null,
    total,
    fetchedAt: new Date().toISOString(),
    points,
  };
}
