import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { GraphCommit, GraphData, GraphRef } from "../shared/types";

const exec = promisify(execFile);
const SEP = "\u001f";

function parseRefs(raw: string): GraphRef[] {
  if (!raw.trim()) return [];

  const refs: GraphRef[] = [];
  for (const part of raw.split(",")) {
    const text = part.trim();
    if (!text) continue;
    // 远程仓库的默认分支指针，画在图上只是噪音
    if (text.endsWith("/HEAD")) continue;

    if (text.startsWith("HEAD -> ")) {
      refs.push({ name: text.slice(8), type: "head" });
      continue;
    }
    if (text === "HEAD") continue;
    if (text.startsWith("tag: ")) {
      refs.push({ name: text.slice(5), type: "tag" });
      continue;
    }

    refs.push({ name: text, type: "branch" });
  }

  return refs;
}

async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", ["-c", "core.quotepath=false", ...args], {
    cwd: repo,
    maxBuffer: 64 * 1024 * 1024,
    encoding: "utf8",
    windowsHide: true,
  });
  return stdout;
}

/**
 * 取最近的提交及其父提交关系。父提交列表就是画线所需的全部信息：
 * 一个提交有几个父，图上就从它分出几条线。
 */
export async function readGraph(
  repoPath: string,
  limit: number,
  allBranches: boolean,
): Promise<GraphData> {
  const abs = path.resolve(repoPath);

  const format = `--pretty=format:%H${SEP}%P${SEP}%an${SEP}%ae${SEP}%at${SEP}%D${SEP}%s`;
  const args = ["log", "--date-order", "-n", String(limit)];
  if (allBranches) args.splice(1, 0, "--all");
  args.push(format);

  const [output, countOutput] = await Promise.all([
    git(abs, args),
    git(abs, allBranches ? ["rev-list", "--count", "--all"] : ["rev-list", "--count", "HEAD"]),
  ]);

  const commits: GraphCommit[] = [];
  for (const line of output.split("\n")) {
    if (!line) continue;

    const [hash, parents, author, email, timestamp, refs, subject] = line.split(SEP);
    if (!hash) continue;

    commits.push({
      hash,
      parents: parents ? parents.split(" ").filter(Boolean) : [],
      author: author ?? "",
      email: email ?? "",
      timestamp: Number(timestamp) || 0,
      refs: parseRefs(refs ?? ""),
      subject: subject ?? "",
    });
  }

  return { commits, total: Number(countOutput.trim()) || commits.length };
}
