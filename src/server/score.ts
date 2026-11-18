import fs from "node:fs";
import path from "node:path";
import type { CodeReport, RepoStats, ScoreDimension, ScoreReport } from "../shared/types";

/** 测试文件不参与可维护性统计 */
const TEST_FILE = /(\.test\.|\.spec\.|__tests__|[\\/]tests?[\\/]|_test\.)/;

const DAY = 86_400_000;

/** vscode 主仓库的实测劣化值，作为锚点：劣化 0.303 对应 80 分 */
const REFERENCE_BADNESS = 0.303;
const REFERENCE_SCORE = 80;

/** 六维都达到这个分数才算没有短板 */
const BALANCED_SCORE = 70;

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/** 活跃度：按天提交数做时间衰减，再走饱和曲线 */
function activityScore(scan: RepoStats): ScoreDimension {
  const now = Date.now();
  let weighted = 0;
  let activeRecent = 0;

  for (const day of scan.days) {
    const age = (now - new Date(`${day.date}T00:00:00`).getTime()) / DAY;
    if (age < 0 || age > 365) continue;
    if (age <= 90) activeRecent += 1;
    weighted += day.commits * Math.pow(0.5, age / 30);
  }

  const raw = weighted / 90;
  const score = clamp(100 * (1 - Math.exp(-raw / 0.3)));

  return {
    key: "activity",
    label: "活跃度",
    score: Math.round(score),
    details: [
      `最近 90 天活跃 ${activeRecent} 天`,
      `加权日均提交 ${raw.toFixed(2)} 次（半衰期 30 天）`,
    ],
  };
}

/** 协作度：用有效贡献者数（HHI 的倒数），避免"一个主力 + 十九个 typo"的情况 */
function collaborationScore(scan: RepoStats): ScoreDimension {
  const humans = scan.people.filter((person) => !person.isBot);
  const total = humans.reduce((sum, person) => sum + person.commits, 0);

  if (total === 0) {
    return { key: "collab", label: "协作度", score: 0, details: ["没有可统计的贡献者"] };
  }

  let hhi = 0;
  for (const person of humans) {
    const share = person.commits / total;
    hhi += share * share;
  }

  const effective = 1 / hhi;
  const score = clamp(100 * (1 - Math.exp(-effective / 2.5)));
  const top = [...humans].sort((a, b) => b.commits - a.commits)[0];
  const topShare = Math.round((top.commits / total) * 100);

  return {
    key: "collab",
    label: "协作度",
    score: Math.round(score),
    details: [
      `${humans.length} 位贡献者，有效贡献者 ${effective.toFixed(2)} 人`,
      `主力贡献 ${topShare}%`,
    ],
  };
}

/** 代码规模：只用来区分玩具和工程，5 万行以后不再明显加分 */
function scaleScore(report: CodeReport): ScoreDimension {
  const lines = report.metrics?.totalLines ?? report.files.reduce((sum, file) => sum + file.lines, 0);
  const score = clamp(100 * (1 - Math.exp(-lines / 50_000)));

  return {
    key: "scale",
    label: "代码规模",
    score: Math.round(score),
    details: [`${report.summary.codeFiles} 个代码文件，共 ${lines.toLocaleString("en-US")} 行`],
  };
}

/** 可维护性：看多大比例的代码单元超标，与代码总量无关 */
function maintainabilityScore(report: CodeReport): ScoreDimension {
  const metrics = report.metrics;
  const fileDenom = Math.max(metrics?.productionFiles ?? 0, 1);
  // 函数太少时样本波动大，分母至少按 20 个算
  const fnDenom = Math.max(metrics?.productionFunctions ?? 0, 20);

  const longFiles = metrics?.longFiles ?? 0;
  const longFns = metrics?.longFunctions ?? 0;
  const fileRate = longFiles / fileDenom;
  const fnRate = longFns / fnDenom;

  const badness = fileRate + fnRate * 2;
  const score = clamp(REFERENCE_SCORE * (REFERENCE_BADNESS / Math.max(badness, 0.001)));

  const details = [
    `超长文件 ${longFiles} / ${fileDenom}（${(fileRate * 100).toFixed(1)}%）`,
    `超长函数 ${longFns} / ${metrics?.productionFunctions ?? 0}（${(fnRate * 100).toFixed(1)}%）`,
  ];

  if (metrics?.longestFunction) {
    const longest = metrics.longestFunction;
    details.push(`最长函数：${longest.name}（${longest.file}），${longest.lines} 行`);
  }

  return { key: "maintain", label: "可维护性", score: Math.round(score), details };
}

/** 工程化：七项清单，只看有没有 */
function engineeringScore(root: string, report: CodeReport): ScoreDimension {
  const exists = (rel: string) => fs.existsSync(path.join(root, rel));

  const items: { label: string; points: number; detail: string }[] = [];

  const testFiles = report.files.filter((file) => TEST_FILE.test(file.path)).length;
  items.push({
    label: "测试",
    points: testFiles > 0 ? 25 : 0,
    detail: testFiles > 0 ? `${testFiles} 个测试文件` : "没有测试文件",
  });

  const ciPaths = [".github/workflows", ".gitlab-ci.yml", ".circleci", "azure-pipelines.yml"];
  const ci = ciPaths.find(exists);
  items.push({ label: "CI", points: ci ? 20 : 0, detail: ci ?? "没有流水线配置" });

  const lintPaths = [
    "eslint.config.js",
    "eslint.config.mjs",
    "eslint.config.ts",
    ".eslintrc",
    ".eslintrc.json",
    ".eslintrc.js",
    "oxlint.json",
    ".oxlintrc.json",
    "biome.json",
    ".ruff.toml",
    "ruff.toml",
    "rustfmt.toml",
    ".prettierrc",
  ];
  const lint = lintPaths.find(exists);
  items.push({ label: "静态检查", points: lint ? 20 : 0, detail: lint ?? "没有检查配置" });

  const locks = [
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "Cargo.lock",
    "poetry.lock",
    "go.sum",
    "uv.lock",
  ];
  const lock = locks.find(exists);
  items.push({ label: "依赖锁定", points: lock ? 10 : 0, detail: lock ?? "没有 lockfile" });

  const builds = [
    "vite.config.ts",
    "vite.config.js",
    "webpack.config.js",
    "rollup.config.js",
    "tsup.config.ts",
    "esbuild.config.js",
  ];
  let build = builds.find(exists) ?? null;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    if (!build && pkg.scripts?.build) build = "package.json 的 build 脚本";
  } catch {
    // 没有 package.json 就算了
  }
  items.push({ label: "构建", points: build ? 10 : 0, detail: build ?? "没有构建配置" });

  items.push({
    label: ".gitignore",
    points: exists(".gitignore") ? 10 : 0,
    detail: exists(".gitignore") ? "有" : "没有",
  });
  items.push({
    label: ".editorconfig",
    points: exists(".editorconfig") ? 5 : 0,
    detail: exists(".editorconfig") ? "有" : "没有",
  });

  const total = items.reduce((sum, item) => sum + item.points, 0);

  return {
    key: "engineering",
    label: "工程化",
    score: clamp(total),
    details: items.map((item) => `${item.points > 0 ? "✓" : "✗"} ${item.label}：${item.detail}`),
  };
}

/** 提交粒度：平均一次提交改多少行。小步提交才便于审查和回滚 */
function granularityScore(scan: RepoStats): ScoreDimension {
  const commits = scan.total.commits;
  const changed = scan.total.added + scan.total.removed;

  if (commits === 0) {
    return { key: "granularity", label: "提交粒度", score: 0, details: ["没有提交"] };
  }

  const average = changed / commits;
  const score = clamp(100 * (1 - Math.min(average / 2000, 1)));

  return {
    key: "granularity",
    label: "提交粒度",
    score: Math.round(score),
    details: [
      `平均每次提交改动 ${Math.round(average).toLocaleString("en-US")} 行`,
      `共 ${commits.toLocaleString("en-US")} 次提交，累计改动 ${changed.toLocaleString("en-US")} 行`,
    ],
  };
}

const WEAK_TITLES: Record<string, string> = {
  activity: "沉睡者",
  collab: "独行侠",
  scale: "小而精",
  maintain: "意大利面厨师",
  engineering: "裸奔主义",
  granularity: "大爆炸",
};

/** 汇总六个维度。总分取算术平均，称号按最低的那一维定 */
export function computeScore(root: string, scan: RepoStats, report: CodeReport): ScoreReport {
  const dimensions = [
    activityScore(scan),
    collaborationScore(scan),
    scaleScore(report),
    maintainabilityScore(report),
    engineeringScore(root, report),
    granularityScore(scan),
  ];

  const total = Math.round(
    dimensions.reduce((sum, dimension) => sum + dimension.score, 0) / dimensions.length,
  );

  const lowest = [...dimensions].sort((a, b) => a.score - b.score)[0];
  const balanced = lowest.score >= BALANCED_SCORE;

  const title = balanced ? "六边形战士" : WEAK_TITLES[lowest.key];
  const subtitle = balanced
    ? `六维都在 ${BALANCED_SCORE} 分以上`
    : `短板是${lowest.label}（${lowest.score} 分）`;

  return { total, title, subtitle, dimensions };
}
