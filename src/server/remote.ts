import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { RemoteInfo } from "../shared/types";

const exec = promisify(execFile);

const CACHE_TTL = 10 * 60 * 1000;
const cache = new Map<string, { at: number; data: RemoteInfo }>();

function parseGitHub(url: string): { owner: string; repo: string } | null {
  const https = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (https) return { owner: https[1], repo: https[2] };

  const ssh = url.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };

  return null;
}

async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, {
    cwd: repo,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout;
}

/** 标签从本地读，不发网络请求 */
async function readTags(repo: string): Promise<{ name: string; date: string }[]> {
  try {
    const output = await git(repo, [
      "tag",
      "--sort=-creatordate",
      "--format=%(refname:short)|%(creatordate:short)",
    ]);
    return output
      .split("\n")
      .filter(Boolean)
      .slice(0, 8)
      .map((line) => {
        const [name, date] = line.split("|");
        return { name, date: date ?? "" };
      });
  } catch {
    return [];
  }
}

/**
 * PR 总数只能靠分页信息推断：只要一条，但看 Link 头里的最后一页编号。
 * 拿不到就当 0，不影响其他字段。
 */
async function countOpenPulls(owner: string, repo: string): Promise<number> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=1`,
      {
        headers: { "User-Agent": "gitcontribution", Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!response.ok) return 0;

    const link = response.headers.get("link");
    const last = link?.match(/[?&]page=(\d+)>;\s*rel="last"/);
    if (last) return Number(last[1]) || 0;

    const data = (await response.json()) as unknown;
    return Array.isArray(data) ? data.length : 0;
  } catch {
    return 0;
  }
}

/** 只解析远端地址里的 owner，给档案列表用 */
export async function readOwner(repoPath: string): Promise<string> {
  try {
    const url = (await git(path.resolve(repoPath), ["remote", "get-url", "origin"])).trim();
    return parseGitHub(url)?.owner ?? "";
  } catch {
    return "";
  }
}

/**
 * 读远端仓库的公开信息。star、fork 这类只能从 GitHub 接口拿，
 * 所以这块依赖网络；拿不到就退化成只显示本地 tag，不阻塞页面。
 */
export async function readRemote(repoPath: string): Promise<RemoteInfo> {
  const root = path.resolve(repoPath);
  const hit = cache.get(root);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.data;

  let remoteUrl = "";
  try {
    remoteUrl = (await git(root, ["remote", "get-url", "origin"])).trim();
  } catch {
    // 没有 origin 也没关系，下面按本地仓库处理
  }

  const parsed = remoteUrl ? parseGitHub(remoteUrl) : null;
  const tags = await readTags(root);

  if (!parsed) {
    const offline: RemoteInfo = {
      platform: null,
      owner: "",
      repo: path.basename(root),
      webUrl: null,
      description: null,
      stars: 0,
      forks: 0,
      watchers: 0,
      openIssues: 0,
      openPulls: 0,
      license: null,
      homepage: null,
      pushedAt: null,
      online: false,
      tags,
    };
    cache.set(root, { at: Date.now(), data: offline });
    return offline;
  }

  const base = {
    platform: "github" as const,
    owner: parsed.owner,
    repo: parsed.repo,
    webUrl: `https://github.com/${parsed.owner}/${parsed.repo}`,
  };

  try {
    const [response, openPulls] = await Promise.all([
      fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, {
        headers: { "User-Agent": "gitcontribution", Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(8000),
      }),
      countOpenPulls(parsed.owner, parsed.repo),
    ]);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const json = (await response.json()) as Record<string, unknown>;
    const license =
      json.license && typeof json.license === "object"
        ? String((json.license as Record<string, unknown>).spdx_id ?? "") || null
        : null;

    const info: RemoteInfo = {
      ...base,
      description: typeof json.description === "string" ? json.description : null,
      stars: Number(json.stargazers_count) || 0,
      forks: Number(json.forks_count) || 0,
      watchers: Number(json.subscribers_count) || 0,
      openIssues: Number(json.open_issues_count) || 0,
      openPulls,
      license,
      homepage: typeof json.homepage === "string" && json.homepage ? json.homepage : null,
      pushedAt: typeof json.pushed_at === "string" ? json.pushed_at : null,
      online: true,
      tags,
    };
    cache.set(root, { at: Date.now(), data: info });
    return info;
  } catch {
    const offline: RemoteInfo = {
      ...base,
      description: null,
      stars: 0,
      forks: 0,
      watchers: 0,
      openIssues: 0,
      openPulls: 0,
      license: null,
      homepage: null,
      pushedAt: null,
      online: false,
      tags,
    };
    cache.set(root, { at: Date.now(), data: offline });
    return offline;
  }
}
