/** 一天的产出 */
export interface DayStat {
  date: string;
  commits: number;
  added: number;
  removed: number;
}

export type AvatarColor = "neutral" | "blue" | "lime" | "pink";

/** 一个人的汇总 */
export interface PersonStat {
  /** 稳定标识，通常是邮箱；没有邮箱时用名字 */
  id: string;
  name: string;
  email: string;
  initials: string;
  color: AvatarColor;
  isBot: boolean;
  commits: number;
  added: number;
  removed: number;
  activeDays: number;
  firstDate: string;
  lastDate: string;
  /** 只包含有提交的日期 */
  days: DayStat[];
}

export interface RepoStats {
  path: string;
  name: string;
  branch: string;
  head: string;
  scannedAt: string;
  durationMs: number;
  cached: boolean;
  total: {
    commits: number;
    added: number;
    removed: number;
    activeDays: number;
    firstDate: string;
    lastDate: string;
  };
  days: DayStat[];
  people: PersonStat[];
}

/** 档案列表里展示的最新一次扫描摘要 */
export interface ScanSummary {
  head: string;
  branch: string;
  scannedAt: string;
  commits: number;
  added: number;
  removed: number;
  activeDays: number;
  firstDate: string;
  lastDate: string;
  peopleCount: number;
}

/** 一个仓库的档案：绑定过就能随时回来查看 */
export interface RepoArchive {
  id: number;
  path: string;
  name: string;
  owner: string;
  createdAt: string;
  lastOpenedAt: string;
  latest: ScanSummary | null;
}

export type GraphRefType = "head" | "branch" | "tag";

export interface GraphRef {
  name: string;
  type: GraphRefType;
}

/** 提交图上的一个节点 */
export interface GraphCommit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  /** Unix 秒 */
  timestamp: number;
  subject: string;
  refs: GraphRef[];
}

export interface GraphData {
  commits: GraphCommit[];
  total: number;
}

/** 一个代码文件的行数统计 */
export interface CodeFileStat {
  path: string;
  language: string;
  lines: number;
  bytes: number;
  /** 体积过大、跳过了行数和函数分析 */
  oversized: boolean;
}

/** 解析出来的一个函数 */
export interface CodeFunctionStat {
  file: string;
  name: string;
  startLine: number;
  endLine: number;
  lines: number;
}

/** 一种语言在仓库里的占比 */
export interface LanguageStat {
  language: string;
  bytes: number;
  files: number;
  /** 0 ~ 1 */
  ratio: number;
}

/** 全量代码的汇总指标，不随展示用的 Top 列表截断 */
export interface CodeMetrics {
  /** 所有代码文件的总行数 */
  totalLines: number;
  /** 排除测试文件后的总行数 */
  productionLines: number;
  /** 排除测试文件后的文件数 */
  productionFiles: number;
  /** 排除测试文件后的函数数 */
  productionFunctions: number;
  longFiles: number;
  longFileExcess: number;
  longFunctions: number;
  longFunctionExcess: number;
  longestFunction: { file: string; name: string; lines: number } | null;
}

export interface CodeReport {
  files: CodeFileStat[];
  functions: CodeFunctionStat[];
  languages: LanguageStat[];
  metrics: CodeMetrics;
  summary: {
    trackedFiles: number;
    codeFiles: number;
    scannedFiles: number;
    parsedFunctions: number;
    oversizedFiles: number;
    parsableFiles: number;
    durationMs: number;
  };
}

/** 六维评分的一个维度 */
export interface ScoreDimension {
  key: string;
  label: string;
  score: number;
  details: string[];
}

/** 仓库的六维评分 */
export interface ScoreReport {
  total: number;
  title: string;
  subtitle: string;
  dimensions: ScoreDimension[];
}

/** 远端仓库的公开信息，来自 GitHub 接口和本地 tag */
export interface RemoteInfo {
  platform: "github" | null;
  owner: string;
  repo: string;
  webUrl: string | null;
  description: string | null;
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number;
  openPulls: number;
  license: string | null;
  homepage: string | null;
  pushedAt: string | null;
  /** GitHub 接口是否成功，失败时只有本地 tag */
  online: boolean;
  tags: { name: string; date: string }[];
}
