import { useEffect, useMemo, useRef, useState } from "react";
import { GitBranch, Loader2, RefreshCw } from "lucide-react";
import { Avatar } from "@/components/base/avatar/avatar";
import { Button } from "@/components/base/buttons/button";
import {
  Dropdown,
  DropdownDivider,
  DropdownItem,
  DropdownPopover,
  DropdownTrigger,
} from "@/components/base/dropdown/dropdown";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { Skeleton } from "@/components/base/skeleton/skeleton";
import { DirectionProvider } from "@/components/foundations/direction/direction";
import { cx } from "@/utils/cx";
import type { PersonStat, RemoteInfo, RepoArchive, RepoStats } from "../shared/types";
import { avatarUrl, listArchives, loadRemote, openArchive, scanRepo } from "./api";
import { CodeView } from "./CodeView";
import { Heatmap, HeatmapLegend, type Metric } from "./Heatmap";
import { GraphView } from "./GraphView";
import { People } from "./People";
import { RepoView } from "./RepoView";
import { SettingsDialog } from "./SettingsDialog";

const STORAGE_KEY = "gitcontribution:repo";
const numberFormat = new Intl.NumberFormat("en-US");

type RangeKey = "3m" | "6m" | "1y" | "all";

const RANGES: { key: RangeKey; label: string; days: number | null }[] = [
  { key: "3m", label: "3 个月", days: 90 },
  { key: "6m", label: "6 个月", days: 182 },
  { key: "1y", label: "1 年", days: 365 },
  { key: "all", label: "全部", days: null },
];

function shiftDate(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";

  const diff = Date.now() - then;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}

function resolveWindow(stats: RepoStats, range: RangeKey) {
  const end = stats.total.lastDate;
  if (!end) return { start: "", end: "" };
  const span = RANGES.find((item) => item.key === range)?.days ?? null;
  if (span === null) return { start: stats.total.firstDate, end };
  const start = shiftDate(end, -span);
  return { start: start < stats.total.firstDate ? stats.total.firstDate : start, end };
}

/** 把人裁剪到当前时间窗口，保证列表数字和热力图看的是同一段时间 */
function clipPerson(person: PersonStat, start: string, end: string): PersonStat | null {
  const days = person.days.filter((day) => day.date >= start && day.date <= end);
  if (days.length === 0) return null;
  return {
    ...person,
    days,
    commits: days.reduce((sum, day) => sum + day.commits, 0),
    added: days.reduce((sum, day) => sum + day.added, 0),
    removed: days.reduce((sum, day) => sum + day.removed, 0),
    activeDays: days.length,
  };
}

function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  /** add / del 给增删行数上色 */
  tone?: "add" | "del";
}) {
  return (
    <div className="rounded-2xl border border-border-button-default bg-background-primary-default px-4 py-3">
      <div className="text-caption-1-regular text-text-tertiary">{label}</div>
      <div
        className={cx(
          "mt-1 text-title-2-semibold tabular-nums",
          tone === "add" && "diff-add",
          tone === "del" && "diff-del",
          !tone && "text-text-primary",
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-caption-2-regular text-text-tertiary">{hint}</div>}
    </div>
  );
}

export default function App() {
  const [pathInput, setPathInput] = useState("");
  const [stats, setStats] = useState<RepoStats | null>(null);
  const [archives, setArchives] = useState<RepoArchive[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>("6m");
  const [metric, setMetric] = useState<Metric>("commits");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showBots, setShowBots] = useState(false);
  const [mode, setMode] = useState<"contrib" | "graph" | "code" | "repo">("repo");
  const [codeKey, setCodeKey] = useState(0);
  const [remote, setRemote] = useState<RemoteInfo | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiVersion, setAiVersion] = useState(0);
  const bootstrapped = useRef(false);

  async function refreshArchives() {
    try {
      setArchives(await listArchives());
    } catch {
      // 档案列表拉不到不影响主流程
    }
  }

  async function load(repoPath: string) {
    const trimmed = repoPath.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    setSelectedId(null);

    try {
      const next = await scanRepo(trimmed);
      setStats(next);
      setPathInput(next.path);
      localStorage.setItem(STORAGE_KEY, next.path);
      void refreshArchives();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "扫描失败");
      setStats(null);
    } finally {
      setLoading(false);
    }
  }

  async function open(archive: RepoArchive) {
    if (!archive.latest) {
      await load(archive.path);
      return;
    }

    setLoading(true);
    setError(null);
    setSelectedId(null);

    try {
      const next = await openArchive(archive.id);
      setStats(next);
      setPathInput(next.path);
      localStorage.setItem(STORAGE_KEY, next.path);
      void refreshArchives();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取档案失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    void (async () => {
      const list = await listArchives().catch(() => [] as RepoArchive[]);
      setArchives(list);

      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        setPathInput(saved);
        void load(saved);
        return;
      }

      const recent = list.find((item) => item.latest !== null);
      if (recent) void open(recent);
    })();
  }, []);

  useEffect(() => {
    if (!stats) {
      setRemote(null);
      return;
    }

    let cancelled = false;
    loadRemote(stats.path)
      .then((next) => {
        if (!cancelled) setRemote(next);
      })
      .catch(() => {
        // 远端信息拿不到就不显示头像
      });

    return () => {
      cancelled = true;
    };
  }, [stats?.path]);

  const window = useMemo(() => (stats ? resolveWindow(stats, range) : { start: "", end: "" }), [stats, range]);

  const people = useMemo(() => {
    if (!stats) return [];
    return stats.people
      .filter((person) => showBots || !person.isBot)
      .map((person) => clipPerson(person, window.start, window.end))
      .filter((person): person is PersonStat => person !== null);
  }, [stats, showBots, window]);

  const botCount = useMemo(
    () => (stats ? stats.people.filter((person) => person.isBot).length : 0),
    [stats],
  );

  const aggregate = useMemo(() => {
    if (!stats) return null;
    const days = stats.days.filter((day) => day.date >= window.start && day.date <= window.end);
    return {
      days,
      commits: days.reduce((sum, day) => sum + day.commits, 0),
      added: days.reduce((sum, day) => sum + day.added, 0),
      removed: days.reduce((sum, day) => sum + day.removed, 0),
      activeDays: days.length,
    };
  }, [stats, window]);

  const selected = useMemo(
    () => people.find((person) => person.id === selectedId) ?? null,
    [people, selectedId],
  );

  const view = selected ?? aggregate;

  return (
    <DirectionProvider locale="zh-CN">
      <div className="min-h-screen bg-background-full">
        <header className="border-b border-separator-border bg-background-primary-default">
          <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-4 px-6 py-4">
            <div className="flex items-center gap-1.5">
              <Dropdown>
                <DropdownTrigger
                  aria-label="仓库操作"
                  className="flex size-8 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-background-secondary-hover"
                >
                  <GitBranch className="size-4" aria-hidden />
                </DropdownTrigger>
                <DropdownPopover aria-label="仓库操作">
                  <DropdownItem
                    onSelect={() => {
                      if (stats) {
                        setMode("code");
                        setCodeKey((value) => value + 1);
                      } else if (pathInput.trim()) {
                        void load(pathInput);
                      }
                    }}
                  >
                    扫描仓库
                  </DropdownItem>
                  <DropdownItem onSelect={() => stats && void load(stats.path)}>
                    重新统计
                  </DropdownItem>
                  <DropdownDivider />
                  <DropdownItem onSelect={() => setSettingsOpen(true)}>模型设置</DropdownItem>
                </DropdownPopover>
              </Dropdown>
              <img src="/icon.png" alt="" className="size-7 rounded-lg object-cover" />
              <span className="text-title-3-semibold text-text-primary">仓库画像</span>
            </div>

            <form
              className="ms-auto flex min-w-0 flex-1 items-center justify-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void load(pathInput);
              }}
            >
              <input
                value={pathInput}
                onChange={(event) => setPathInput(event.target.value)}
                placeholder="粘贴本地仓库路径，例如 E:\LimeA"
                spellCheck={false}
                className="h-8 w-full max-w-[380px] min-w-0 rounded-lg border border-border-button-default bg-background-primary-default px-2.5 text-body-2-regular text-text-primary placeholder:text-text-placeholder outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
              />
              <Button type="submit" size="small" disabled={loading}>
                打开
              </Button>
            </form>
          </div>
        </header>

        <main className="mx-auto max-w-[1100px] px-6 pt-6 pb-16">
          {archives.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="text-caption-1-regular text-text-tertiary">仓库档案</span>
              {archives.map((archive) => {
                const active = stats?.path === archive.path;
                return (
                  <button
                    key={archive.id}
                    type="button"
                    onClick={() => void open(archive)}
                    className={cx(
                      "flex max-w-[260px] items-center gap-2 rounded-full border px-3 py-1.5 text-caption-1-medium",
                      "transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring",
                      active
                        ? "border-accent-500 bg-background-secondary-hover text-text-primary"
                        : "border-border-button-default bg-background-primary-default text-text-secondary hover:bg-background-secondary-hover",
                    )}
                  >
                    {archive.owner && (
                      <Avatar size="xs" src={avatarUrl(archive.owner, "")} alt={archive.owner} />
                    )}
                    <span className="truncate">{archive.name}</span>
                    <span className="shrink-0 text-caption-2-regular text-text-tertiary">
                      {relativeTime(archive.latest?.scannedAt ?? archive.lastOpenedAt)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-2xl border border-border-error-default bg-background-primary-default px-4 py-3 text-body-2-regular text-text-error-primary">
              {error}
            </div>
          )}

          {loading && !stats && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {Array.from({ length: 4 }, (_, index) => (
                  <Skeleton key={index} className="h-[76px]" />
                ))}
              </div>
              <Skeleton className="h-[260px]" />
              <Skeleton className="h-[200px]" />
            </div>
          )}

          {!loading && !stats && !error && (
            <div className="rounded-2xl border border-dashed border-border-button-default bg-background-primary-default px-6 py-16 text-center">
              <div className="text-title-3-medium text-text-primary">先绑定一个本地仓库</div>
              <p className="mx-auto mt-2 max-w-[440px] text-body-2-regular text-text-tertiary">
                在上面填入仓库的完整路径，或者直接把文件夹路径粘进去。数据只在本机读取，不会上传。
              </p>
            </div>
          )}

          {stats && view && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="flex items-center gap-2">
                  {remote?.owner && (
                    <Avatar size="xs" src={avatarUrl(remote.owner, "")} alt={remote.owner} />
                  )}
                  <span className="text-body-medium text-text-primary">{stats.name}</span>
                  <span className="rounded-full bg-background-tertiary-default px-2 py-0.5 text-caption-2-medium text-text-secondary">
                    {stats.branch}
                  </span>
                  {stats.cached && (
                    <span className="text-caption-2-regular text-text-tertiary">来自档案</span>
                  )}
                </div>
                <span className="truncate text-caption-1-regular text-text-tertiary">{stats.path}</span>

                <Button
                  variant="ghost"
                  size="xs"
                  className="ms-auto"
                  leadingIcon={loading ? Loader2 : RefreshCw}
                  onClick={() => void load(stats.path)}
                  disabled={loading}
                >
                  重新扫描
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard label="提交" value={view.commits.toLocaleString("zh-CN")} />
                <StatCard
                  label="新增行"
                  value={`+${numberFormat.format(view.added)}`}
                  tone="add"
                />
                <StatCard
                  label="删除行"
                  value={`-${numberFormat.format(view.removed)}`}
                  tone="del"
                />
                <StatCard
                  label="活跃天数"
                  value={`${view.activeDays} 天`}
                  hint={`扫描耗时 ${(stats.durationMs / 1000).toFixed(1)} 秒`}
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <SegmentedControl
                  selectedKeys={[mode]}
                  onSelectionChange={(keys) => {
                    const next = [...keys][0];
                    if (next === "contrib" || next === "graph" || next === "code" || next === "repo")
                      setMode(next);
                  }}
                >
                  <SegmentedControlItem id="repo">仓库画像</SegmentedControlItem>
                  <SegmentedControlItem id="contrib">贡献</SegmentedControlItem>
                  <SegmentedControlItem id="graph">提交图</SegmentedControlItem>
                  <SegmentedControlItem id="code">代码画像</SegmentedControlItem>
                </SegmentedControl>

                {mode === "contrib" && (
                  <>
                    <SegmentedControl
                      selectedKeys={[range]}
                      onSelectionChange={(keys) => {
                        const next = [...keys][0];
                        if (typeof next === "string") setRange(next as RangeKey);
                      }}
                    >
                      {RANGES.map((item) => (
                        <SegmentedControlItem key={item.key} id={item.key}>
                          {item.label}
                        </SegmentedControlItem>
                      ))}
                    </SegmentedControl>

                    <SegmentedControl
                      selectedKeys={[metric]}
                      onSelectionChange={(keys) => {
                        const next = [...keys][0];
                        if (next === "commits" || next === "lines") setMetric(next);
                      }}
                    >
                      <SegmentedControlItem id="commits">提交次数</SegmentedControlItem>
                      <SegmentedControlItem id="lines">代码行数</SegmentedControlItem>
                    </SegmentedControl>

                    <div className="ms-auto">
                      <HeatmapLegend metric={metric} />
                    </div>
                  </>
                )}
              </div>

              {mode === "graph" ? (
                <GraphView key={stats.path} repoPath={stats.path} />
              ) : mode === "code" ? (
                <CodeView key={`${stats.path}-${codeKey}`} repoPath={stats.path} />
              ) : mode === "repo" ? (
                <RepoView
                  key={`${stats.path}-${aiVersion}`}
                  repoPath={stats.path}
                  people={stats.people}
                />
              ) : (
                <>
              <section className="rounded-2xl border border-border-button-default bg-background-primary-default p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {selected && (
                      <Avatar
                        size="md"
                        color={selected.color}
                        initials={selected.initials}
                        src={avatarUrl(selected.name, selected.email)}
                        alt={selected.name}
                      />
                    )}
                    <div>
                      <h2 className="text-title-3-semibold text-text-primary">
                        {selected ? selected.name : "全部贡献"}
                      </h2>
                      <p className="text-caption-1-regular text-text-tertiary">
                        {window.start} 至 {window.end}
                      </p>
                    </div>
                  </div>
                  {selected && (
                    <Button variant="ghost" size="xs" onClick={() => setSelectedId(null)}>
                      返回全部
                    </Button>
                  )}
                </div>

                <div className="overflow-x-auto pb-1">
                  <div className="inline-block min-w-full">
                    <Heatmap
                      days={view.days}
                      start={window.start}
                      end={window.end}
                      metric={metric}
                    />
                  </div>
                </div>
              </section>

              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-title-3-semibold text-text-primary">
                    贡献者 <span className="text-text-tertiary">{people.length}</span>
                  </h2>
                  {botCount > 0 && (
                    <Button variant="ghost" size="xs" onClick={() => setShowBots((value) => !value)}>
                      {showBots ? "隐藏机器人" : `显示机器人（${botCount}）`}
                    </Button>
                  )}
                </div>

                <People
                  people={people}
                  overview={aggregate!}
                  start={window.start}
                  end={window.end}
                  metric={metric}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              </section>

              <p className="text-caption-2-regular text-text-tertiary">
                统计的是当前分支、不含合并提交的改动量。同一个人改了名字或漏配邮箱时会自动合并。
              </p>
                </>
              )}
            </div>
          )}
        </main>
      </div>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => setAiVersion((value) => value + 1)}
      />
    </DirectionProvider>
  );
}
