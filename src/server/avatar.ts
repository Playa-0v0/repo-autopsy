import { findAvatar, saveAvatar } from "./db.ts";

/** GitHub 用户名规则：字母数字和连字符，不能以连字符开头或结尾 */
const USERNAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

/** 确认过不存在的，一周内不再重试 */
const MISS_TTL = 7 * 24 * 60 * 60 * 1000;
const TIMEOUT = 8_000;
const MAX_BYTES = 3 * 1024 * 1024;

export interface AvatarImage {
  data: Uint8Array;
  contentType: string;
  cached: boolean;
}

/**
 * 从提交者信息里猜可能的 GitHub 用户名，按可信度排序。
 *
 * 只用两个来源：GitHub 的 noreply 邮箱直接写着用户名；其次是贡献者
 * 拿自己的 GitHub 名当提交名。故意不用邮箱前缀 —— 它极容易撞上
 * 同名的陌生人，宁可没有头像，也不要挂错人的脸。
 */
export function guessUsernames(name: string, email: string): string[] {
  const candidates: string[] = [];

  const noreply = email.match(/^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i);
  if (noreply) candidates.push(noreply[1]);

  const cleaned = name.replace(/\[bot\]/gi, "").trim();
  if (USERNAME_PATTERN.test(cleaned)) candidates.push(cleaned);

  return [...new Set(candidates)];
}

async function download(url: string): Promise<{ data: Uint8Array; contentType: string } | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { "User-Agent": "gitcontribution" },
      redirect: "follow",
    });

    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return null;

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) return null;

    return { data: new Uint8Array(buffer), contentType };
  } catch {
    return null;
  }
}

/** 先查库，库里没有才上网；拉到的图片直接入库，下次不再请求 */
export async function getAvatar(name: string, email: string): Promise<AvatarImage | null> {
  const usernames = guessUsernames(name, email);
  if (usernames.length === 0) return null;

  const now = Date.now();
  let everyCandidateKnownMissing = true;

  for (const username of usernames) {
    const record = findAvatar(`github:${username}`);

    if (!record) {
      everyCandidateKnownMissing = false;
      continue;
    }

    if (record.status === "ok" && record.data && record.contentType) {
      return { data: record.data, contentType: record.contentType, cached: true };
    }

    const age = now - new Date(record.fetchedAt).getTime();
    if (record.status !== "missing" || !Number.isFinite(age) || age >= MISS_TTL) {
      everyCandidateKnownMissing = false;
    }
  }

  if (everyCandidateKnownMissing) return null;

  for (const username of usernames) {
    const url = `https://github.com/${username}.png?size=96`;
    const image = await download(url);

    saveAvatar({
      key: `github:${username}`,
      platform: "github",
      username,
      status: image ? "ok" : "missing",
      sourceUrl: url,
      contentType: image?.contentType ?? null,
      data: image?.data ?? null,
      fetchedAt: new Date().toISOString(),
    });

    if (image) return { ...image, cached: false };
  }

  return null;
}
