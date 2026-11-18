import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { AvatarColor, DayStat, PersonStat, RepoStats } from "../shared/types";

const exec = promisify(execFile);

/** 分隔符用一个几乎不会出现在提交信息里的控制字符 */
const SEP = "\u001f";
const HEADER = `C${SEP}`;

/** 大仓库一次取全量，缓冲给足 */
const MAX_BUFFER = 512 * 1024 * 1024;

interface RawCommit {
  hash: string;
  name: string;
  email: string;
  date: string;
  added: number;
  removed: number;
}

interface Accumulator {
  name: string;
  email: string;
  nameCounts: Map<string, number>;
  commits: number;
  added: number;
  removed: number;
  days: Map<string, DayStat>;
}

const BOT_PATTERN = /\[bot\]|\bbot\b|dependabot|renovate|github-actions|actions-user/i;

const AVATAR_COLORS: AvatarColor[] = ["neutral", "blue", "lime", "pink"];

async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", ["-c", "core.quotepath=false", ...args], {
    cwd: repo,
    maxBuffer: MAX_BUFFER,
    encoding: "utf8",
    windowsHide: true,
  });
  return stdout;
}

function emptyAccumulator(name: string, email: string): Accumulator {
  return {
    name,
    email,
    nameCounts: new Map(),
    commits: 0,
    added: 0,
    removed: 0,
    days: new Map(),
  };
}

function addCommit(acc: Accumulator, commit: RawCommit): void {
  acc.commits += 1;
  acc.added += commit.added;
  acc.removed += commit.removed;
  acc.nameCounts.set(commit.name, (acc.nameCounts.get(commit.name) ?? 0) + 1);

  const day = acc.days.get(commit.date) ?? { date: commit.date, commits: 0, added: 0, removed: 0 };
  day.commits += 1;
  day.added += commit.added;
  day.removed += commit.removed;
  acc.days.set(commit.date, day);
}

/** 名字出现次数最多的那个，作为展示名 */
function displayName(acc: Accumulator): string {
  let best = acc.name;
  let bestCount = -1;
  for (const [name, count] of acc.nameCounts) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

function initialsOf(name: string): string {
  const cleaned = name.replace(/\[bot\]/gi, "").trim();
  if (!cleaned) return "?";
  const first = [...cleaned][0] ?? "?";
  return /[a-z]/i.test(first) ? first.toUpperCase() : first;
}

function colorOf(id: string): AvatarColor {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function toPersonStat(id: string, acc: Accumulator): PersonStat {
  const days = [...acc.days.values()].sort((a, b) => a.date.localeCompare(b.date));
  const name = displayName(acc);
  return {
    id,
    name,
    email: acc.email,
    initials: initialsOf(name),
    color: colorOf(id),
    isBot: BOT_PATTERN.test(name),
    commits: acc.commits,
    added: acc.added,
    removed: acc.removed,
    activeDays: days.length,
    firstDate: days[0]?.date ?? "",
    lastDate: days.at(-1)?.date ?? "",
    days,
  };
}

function parseLog(output: string): RawCommit[] {
  const commits: RawCommit[] = [];
  let current: RawCommit | null = null;

  for (const line of output.split("\n")) {
    if (line.startsWith(HEADER)) {
      const [, hash, name, email, date] = line.split(SEP);
      current = { hash, name, email, date, added: 0, removed: 0 };
      commits.push(current);
      continue;
    }
    if (!current || !line) continue;

    const [added, removed] = line.split("\t");
    // 二进制文件没有行数概念，跳过
    if (added === "-" || removed === "-") continue;

    const a = Number(added);
    const r = Number(removed);
    if (Number.isFinite(a)) current.added += a;
    if (Number.isFinite(r)) current.removed += r;
  }

  return commits;
}

/**
 * 把同一个人散落的多个身份合并。
 *
 * git 只记录提交时本机的名字和邮箱，同一个人常常会留下好几套：
 * 改了名字、某次提交没配邮箱、换了机器。这里按两步归并：
 *   1. 邮箱非空的，以邮箱为准（改过名字也认得出是同一人）
 *   2. 邮箱为空的，去找同名的唯一身份；同名对应多个邮箱时不猜，单独成一人
 */
function groupPeople(commits: RawCommit[]): PersonStat[] {
  const byEmail = new Map<string, Accumulator>();

  for (const commit of commits) {
    const email = commit.email.trim().toLowerCase();
    if (!email) continue;
    let acc = byEmail.get(email);
    if (!acc) {
      acc = emptyAccumulator(commit.name, commit.email.trim());
      byEmail.set(email, acc);
    }
    addCommit(acc, commit);
  }

  // 名字到邮箱的索引，用来判断一个空邮箱提交能归到谁名下
  const nameToEmails = new Map<string, Set<string>>();
  for (const [email, acc] of byEmail) {
    for (const name of acc.nameCounts.keys()) {
      const emails = nameToEmails.get(name) ?? new Set<string>();
      emails.add(email);
      nameToEmails.set(name, emails);
    }
  }

  const byNameOnly = new Map<string, Accumulator>();
  for (const commit of commits) {
    if (commit.email.trim()) continue;

    const candidates = nameToEmails.get(commit.name);
    if (candidates && candidates.size === 1) {
      const [onlyEmail] = candidates;
      addCommit(byEmail.get(onlyEmail)!, commit);
      continue;
    }

    const key = commit.name;
    let acc = byNameOnly.get(key);
    if (!acc) {
      acc = emptyAccumulator(commit.name, "");
      byNameOnly.set(key, acc);
    }
    addCommit(acc, commit);
  }

  const people: PersonStat[] = [];
  for (const [email, acc] of byEmail) people.push(toPersonStat(email, acc));
  for (const [name, acc] of byNameOnly) people.push(toPersonStat(`name:${name}`, acc));

  return people.sort((a, b) => b.added + b.removed - (a.added + a.removed));
}

function summarize(days: Map<string, DayStat>, commits: number, added: number, removed: number) {
  const sorted = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  return {
    commits,
    added,
    removed,
    activeDays: sorted.length,
    firstDate: sorted[0]?.date ?? "",
    lastDate: sorted.at(-1)?.date ?? "",
  };
}

export async function scanRepo(repoPath: string): Promise<RepoStats> {
  const startedAt = Date.now();
  const abs = path.resolve(repoPath);

  let head: string;
  let branch: string;
  try {
    head = (await git(abs, ["rev-parse", "HEAD"])).trim();
    branch = (await git(abs, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  } catch {
    throw new Error(`读不到这个仓库：${abs}。确认它是个 git 仓库，且至少有一次提交。`);
  }

  const output = await git(abs, [
    // 重命名检测要开着，否则一次改名会被算成删光再写一遍，行数虚高
    "log",
    "--numstat",
    "--no-merges",
    `--pretty=format:${HEADER}%H${SEP}%aN${SEP}%aE${SEP}%ad`,
    "--date=short",
  ]);

  const commits = parseLog(output);
  const people = groupPeople(commits);

  const allDays = new Map<string, DayStat>();
  let added = 0;
  let removed = 0;
  for (const commit of commits) {
    added += commit.added;
    removed += commit.removed;
    const day = allDays.get(commit.date) ?? { date: commit.date, commits: 0, added: 0, removed: 0 };
    day.commits += 1;
    day.added += commit.added;
    day.removed += commit.removed;
    allDays.set(commit.date, day);
  }

  return {
    path: abs,
    name: path.basename(abs),
    branch,
    head,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    cached: false,
    total: summarize(allDays, commits.length, added, removed),
    days: [...allDays.values()].sort((a, b) => a.date.localeCompare(b.date)),
    people,
  };
}

/** 只读 HEAD，用来判断缓存是否还能用 */
export async function readHead(repoPath: string): Promise<string | null> {
  try {
    const out = await git(path.resolve(repoPath), ["rev-parse", "HEAD"]);
    return out.trim();
  } catch {
    return null;
  }
}
