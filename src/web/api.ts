import type {
  CodeReport,
  GraphData,
  RemoteInfo,
  RepoArchive,
  RepoStats,
  ScoreReport,
} from "../shared/types";

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

export function loadRemote(repoPath: string): Promise<RemoteInfo> {
  return request<RemoteInfo>(`/api/remote?path=${encodeURIComponent(repoPath)}`);
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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

export interface AiSettings {
  baseUrl: string;
  model: string;
  extraPrompt: string;
  hasKey: boolean;
}

export function loadSettings(): Promise<AiSettings> {
  return request<AiSettings>("/api/settings");
}

/** 只读最近一次的结论，不会触发新的模型调用 */
export function loadLatestAnalysis(
  repoPath: string,
): Promise<{ markdown: string | null; createdAt: string | null }> {
  return request<{ markdown: string | null; createdAt: string | null }>(
    `/api/analysis?path=${encodeURIComponent(repoPath)}`,
  );
}

export function loadScore(repoPath: string): Promise<ScoreReport> {
  return request<ScoreReport>(`/api/score?path=${encodeURIComponent(repoPath)}`);
}

export function saveSettings(input: Record<string, string>): Promise<{ ok: boolean }> {
  return postJson<{ ok: boolean }>("/api/settings", input);
}

export function analyzeTechStack(
  repoPath: string,
  force = false,
): Promise<{ markdown: string }> {
  return postJson<{ markdown: string }>("/api/analyze", { path: repoPath, force });
}
