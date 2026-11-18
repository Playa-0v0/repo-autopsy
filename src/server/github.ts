import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

let cached: string | null | undefined;

/**
 * GitHub 的 stargazers 接口现在要求登录。优先用环境变量里的 token，
 * 没有就看本机的 gh CLI 有没有登录过。
 */
export async function githubToken(): Promise<string | null> {
  const fromEnv = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (fromEnv) return fromEnv;
  if (cached !== undefined) return cached;

  try {
    const { stdout } = await exec("gh", ["auth", "token"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
    });
    cached = stdout.trim() || null;
  } catch {
    cached = null;
  }

  return cached;
}
