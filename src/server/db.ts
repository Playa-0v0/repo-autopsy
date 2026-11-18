import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  CodeReport,
  DayStat,
  PersonStat,
  RepoArchive,
  RepoStats,
  StarPoint,
} from "../shared/types";

const DATA_DIR = path.join(os.homedir(), ".gitcontribution");
const DB_FILE = path.join(DATA_DIR, "data.db");

interface RepoRow {
  id: number;
  path: string;
  name: string;
  created_at: string;
  last_opened_at: string;
}

interface ScanRow {
  head: string;
  branch: string;
  scanned_at: string;
  duration_ms: number;
  commits: number;
  added: number;
  removed: number;
  active_days: number;
  first_date: string;
  last_date: string;
  people_count: number;
  people_json: string;
  days_json: string;
}

interface JoinedScanRow extends ScanRow {
  repo_path: string;
  repo_name: string;
}

let instance: DatabaseSync | null = null;

function open(): DatabaseSync {
  if (instance) return instance;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_FILE);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS repos (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      path           TEXT NOT NULL UNIQUE,
      name           TEXT NOT NULL,
      created_at     TEXT NOT NULL,
      last_opened_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scans (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id      INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      head         TEXT NOT NULL,
      branch       TEXT NOT NULL,
      scanned_at   TEXT NOT NULL,
      duration_ms  INTEGER NOT NULL,
      commits      INTEGER NOT NULL,
      added        INTEGER NOT NULL,
      removed      INTEGER NOT NULL,
      active_days  INTEGER NOT NULL,
      first_date   TEXT NOT NULL,
      last_date    TEXT NOT NULL,
      people_count INTEGER NOT NULL,
      people_json  TEXT NOT NULL,
      days_json    TEXT NOT NULL,
      UNIQUE (repo_id, head)
    );

    CREATE INDEX IF NOT EXISTS idx_scans_repo ON scans (repo_id, scanned_at DESC);

    CREATE TABLE IF NOT EXISTS avatars (
      key          TEXT PRIMARY KEY,
      platform     TEXT NOT NULL,
      username     TEXT NOT NULL,
      status       TEXT NOT NULL,
      source_url   TEXT,
      content_type TEXT,
      data         BLOB,
      fetched_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS code_reports (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id     INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      head        TEXT NOT NULL,
      scanned_at  TEXT NOT NULL,
      report_json TEXT NOT NULL,
      UNIQUE (repo_id, head)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS analyses (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id     INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      head        TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      markdown    TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      UNIQUE (repo_id, head, fingerprint)
    );

    CREATE TABLE IF NOT EXISTS star_history (
      repo_id     INTEGER PRIMARY KEY REFERENCES repos(id) ON DELETE CASCADE,
      total       INTEGER NOT NULL,
      fetched_at  TEXT NOT NULL,
      points_json TEXT NOT NULL
    );
  `);

  instance = db;
  return db;
}

function rowToStats(row: JoinedScanRow): RepoStats {
  return {
    path: row.repo_path,
    name: row.repo_name,
    branch: row.branch,
    head: row.head,
    scannedAt: row.scanned_at,
    durationMs: row.duration_ms,
    cached: true,
    total: {
      commits: row.commits,
      added: row.added,
      removed: row.removed,
      activeDays: row.active_days,
      firstDate: row.first_date,
      lastDate: row.last_date,
    },
    days: JSON.parse(row.days_json) as DayStat[],
    people: JSON.parse(row.people_json) as PersonStat[],
  };
}

const SELECT_SCAN = `
  SELECT s.*, r.path AS repo_path, r.name AS repo_name
  FROM scans s
  JOIN repos r ON r.id = s.repo_id
`;

/** 绑定一个仓库：没有档案就建档，有就更新最后打开时间 */
export function touchRepo(repoPath: string, name: string): number {
  const db = open();
  const now = new Date().toISOString();

  db.prepare(
    "INSERT OR IGNORE INTO repos (path, name, created_at, last_opened_at) VALUES (?, ?, ?, ?)",
  ).run(repoPath, name, now, now);
  db.prepare("UPDATE repos SET name = ?, last_opened_at = ? WHERE path = ?").run(name, now, repoPath);

  const row = db.prepare("SELECT id FROM repos WHERE path = ?").get(repoPath) as
    | { id: number }
    | undefined;

  if (!row) throw new Error("写入仓库档案失败");
  return row.id;
}

/** 已建档就返回档案 id，没建过返回 null */
export function findRepoIdByPath(repoPath: string): number | null {
  const row = open().prepare("SELECT id FROM repos WHERE path = ?").get(repoPath) as
    | { id: number }
    | undefined;
  return row ? row.id : null;
}

/** 同一个 HEAD 的扫描结果只存一份，命中就直接拿来用 */
export function findScan(repoId: number, head: string): RepoStats | null {
  const row = open()
    .prepare(`${SELECT_SCAN} WHERE s.repo_id = ? AND s.head = ?`)
    .get(repoId, head) as JoinedScanRow | undefined;

  return row ? rowToStats(row) : null;
}

/** 不看 HEAD，直接取这个仓库最近一次的结果 */
export function latestScan(repoId: number): RepoStats | null {
  const row = open()
    .prepare(`${SELECT_SCAN} WHERE s.repo_id = ? ORDER BY s.scanned_at DESC, s.id DESC LIMIT 1`)
    .get(repoId) as JoinedScanRow | undefined;

  return row ? rowToStats(row) : null;
}

export function saveScan(repoId: number, stats: RepoStats): void {
  open()
    .prepare(
      `INSERT INTO scans (
         repo_id, head, branch, scanned_at, duration_ms,
         commits, added, removed, active_days, first_date, last_date,
         people_count, people_json, days_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (repo_id, head) DO UPDATE SET
         branch       = excluded.branch,
         scanned_at   = excluded.scanned_at,
         duration_ms  = excluded.duration_ms,
         commits      = excluded.commits,
         added        = excluded.added,
         removed      = excluded.removed,
         active_days  = excluded.active_days,
         first_date   = excluded.first_date,
         last_date    = excluded.last_date,
         people_count = excluded.people_count,
         people_json  = excluded.people_json,
         days_json    = excluded.days_json`,
    )
    .run(
      repoId,
      stats.head,
      stats.branch,
      stats.scannedAt,
      stats.durationMs,
      stats.total.commits,
      stats.total.added,
      stats.total.removed,
      stats.total.activeDays,
      stats.total.firstDate,
      stats.total.lastDate,
      stats.people.length,
      JSON.stringify(stats.people),
      JSON.stringify(stats.days),
    );
}

export function listArchives(): RepoArchive[] {
  const db = open();
  const repos = db
    .prepare("SELECT * FROM repos ORDER BY last_opened_at DESC")
    .all() as unknown as RepoRow[];

  return repos.map((repo) => {
    const latest = db
      .prepare(
        `SELECT head, branch, scanned_at, commits, added, removed,
                active_days, first_date, last_date, people_count
         FROM scans WHERE repo_id = ?
         ORDER BY scanned_at DESC, id DESC LIMIT 1`,
      )
      .get(repo.id) as
      | {
          head: string;
          branch: string;
          scanned_at: string;
          commits: number;
          added: number;
          removed: number;
          active_days: number;
          first_date: string;
          last_date: string;
          people_count: number;
        }
      | undefined;

    return {
      id: repo.id,
      path: repo.path,
      name: repo.name,
      owner: "",
      createdAt: repo.created_at,
      lastOpenedAt: repo.last_opened_at,
      latest: latest
        ? {
            head: latest.head,
            branch: latest.branch,
            scannedAt: latest.scanned_at,
            commits: latest.commits,
            added: latest.added,
            removed: latest.removed,
            activeDays: latest.active_days,
            firstDate: latest.first_date,
            lastDate: latest.last_date,
            peopleCount: latest.people_count,
          }
        : null,
    };
  });
}

export function findArchive(id: number): RepoArchive | null {
  const db = open();
  const repo = db.prepare("SELECT * FROM repos WHERE id = ?").get(id) as unknown as
    | RepoRow
    | undefined;
  if (!repo) return null;

  const latest = db
    .prepare(
      `SELECT head, branch, scanned_at, commits, added, removed,
              active_days, first_date, last_date, people_count
       FROM scans WHERE repo_id = ?
       ORDER BY scanned_at DESC, id DESC LIMIT 1`,
    )
    .get(id) as
    | {
        head: string;
        branch: string;
        scanned_at: string;
        commits: number;
        added: number;
        removed: number;
        active_days: number;
        first_date: string;
        last_date: string;
        people_count: number;
      }
    | undefined;

  return {
    id: repo.id,
    path: repo.path,
    name: repo.name,
    owner: "",
    createdAt: repo.created_at,
    lastOpenedAt: repo.last_opened_at,
    latest: latest
      ? {
          head: latest.head,
          branch: latest.branch,
          scannedAt: latest.scanned_at,
          commits: latest.commits,
          added: latest.added,
          removed: latest.removed,
          activeDays: latest.active_days,
          firstDate: latest.first_date,
          lastDate: latest.last_date,
          peopleCount: latest.people_count,
        }
      : null,
  };
}

export interface AvatarRecord {
  key: string;
  platform: string;
  username: string;
  status: "ok" | "missing";
  sourceUrl: string | null;
  contentType: string | null;
  data: Uint8Array | null;
  fetchedAt: string;
}

interface AvatarRow {
  key: string;
  platform: string;
  username: string;
  status: string;
  source_url: string | null;
  content_type: string | null;
  data: Uint8Array | null;
  fetched_at: string;
}

export function findAvatar(key: string): AvatarRecord | null {
  const row = open().prepare("SELECT * FROM avatars WHERE key = ?").get(key) as unknown as
    | AvatarRow
    | undefined;
  if (!row) return null;

  return {
    key: row.key,
    platform: row.platform,
    username: row.username,
    status: row.status === "ok" ? "ok" : "missing",
    sourceUrl: row.source_url,
    contentType: row.content_type,
    data: row.data,
    fetchedAt: row.fetched_at,
  };
}

export function saveAvatar(record: AvatarRecord): void {
  open()
    .prepare(
      `INSERT INTO avatars (key, platform, username, status, source_url, content_type, data, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET
         status       = excluded.status,
         source_url   = excluded.source_url,
         content_type = excluded.content_type,
         data         = excluded.data,
         fetched_at   = excluded.fetched_at`,
    )
    .run(
      record.key,
      record.platform,
      record.username,
      record.status,
      record.sourceUrl,
      record.contentType,
      record.data,
      record.fetchedAt,
    );
}

export function findCodeReport(repoId: number, head: string): CodeReport | null {
  const row = open()
    .prepare("SELECT report_json FROM code_reports WHERE repo_id = ? AND head = ?")
    .get(repoId, head) as { report_json: string } | undefined;

  return row ? (JSON.parse(row.report_json) as CodeReport) : null;
}

export function saveCodeReport(repoId: number, head: string, report: CodeReport): void {
  open()
    .prepare(
      `INSERT INTO code_reports (repo_id, head, scanned_at, report_json)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (repo_id, head) DO UPDATE SET
         scanned_at  = excluded.scanned_at,
         report_json = excluded.report_json`,
    )
    .run(repoId, head, new Date().toISOString(), JSON.stringify(report));
}

export function getSetting(key: string): string | null {
  const row = open().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row ? row.value : null;
}

export function setSetting(key: string, value: string): void {
  open()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}

export function findAnalysis(repoId: number, head: string, fingerprint: string): string | null {
  const row = open()
    .prepare("SELECT markdown FROM analyses WHERE repo_id = ? AND head = ? AND fingerprint = ?")
    .get(repoId, head, fingerprint) as { markdown: string } | undefined;
  return row ? row.markdown : null;
}

/** 不管 commit 和提示词，直接取这个仓库最近一次的分析结论 */
export function findLatestAnalysis(
  repoId: number,
): { markdown: string; createdAt: string } | null {
  const row = open()
    .prepare(
      `SELECT markdown, created_at FROM analyses
       WHERE repo_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(repoId) as { markdown: string; created_at: string } | undefined;

  return row ? { markdown: row.markdown, createdAt: row.created_at } : null;
}

export function saveAnalysis(
  repoId: number,
  head: string,
  fingerprint: string,
  markdown: string,
): void {
  open()
    .prepare(
      `INSERT INTO analyses (repo_id, head, fingerprint, markdown, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (repo_id, head, fingerprint) DO UPDATE SET
         markdown   = excluded.markdown,
         created_at = excluded.created_at`,
    )
    .run(repoId, head, fingerprint, markdown, new Date().toISOString());
}

export interface StarHistoryRecord {
  total: number;
  fetchedAt: string;
  points: StarPoint[];
}

export function findStarHistory(repoId: number): StarHistoryRecord | null {
  const row = open()
    .prepare("SELECT total, fetched_at, points_json FROM star_history WHERE repo_id = ?")
    .get(repoId) as { total: number; fetched_at: string; points_json: string } | undefined;

  if (!row) return null;

  return {
    total: row.total,
    fetchedAt: row.fetched_at,
    points: JSON.parse(row.points_json) as StarPoint[],
  };
}

export function saveStarHistory(repoId: number, total: number, points: StarPoint[]): void {
  open()
    .prepare(
      `INSERT INTO star_history (repo_id, total, fetched_at, points_json)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (repo_id) DO UPDATE SET
         total       = excluded.total,
         fetched_at  = excluded.fetched_at,
         points_json = excluded.points_json`,
    )
    .run(repoId, total, new Date().toISOString(), JSON.stringify(points));
}
