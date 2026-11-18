import type { CodeReport, GraphData, RepoArchive, RepoStats } from "../shared/types";

async function request<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const payload: unknown = await response.json();

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `请求失败（${response.status}）`;
    throw new Error(message);
  }

  return payload as T;
}

export function scanRepo(repoPath: string): Promise<RepoStats> {
  return request<RepoStats>(`/api/scan?path=${encodeURIComponent(repoPath)}`);
}

export function listArchives(): Promise<RepoArchive[]> {
  return request<RepoArchive[]>("/api/repos");
}

export function openArchive(id: number): Promise<RepoStats> {
  return request<RepoStats>(`/api/repo?id=${id}`);
}

/** 头像由后端按需拉取并入库，前端只管引用 */
export function avatarUrl(name: string, email: string): string {
  const params = new URLSearchParams({ name, email });
  return `/api/avatar?${params.toString()}`;
}

export function loadGraph(
  repoPath: string,
  limit: number,
  allBranches: boolean,
): Promise<GraphData> {
  const params = new URLSearchParams({
    path: repoPath,
    limit: String(limit),
    all: allBranches ? "1" : "0",
  });
  return request<GraphData>(`/api/graph?${params.toString()}`);
}

export function loadCode(repoPath: string, force = false): Promise<CodeReport> {
  const params = new URLSearchParams({ path: repoPath });
  if (force) params.set("force", "1");
  return request<CodeReport>(`/api/code?${params.toString()}`);
}
