#!/usr/bin/env node
/**
 * 完整链路：`pnpm run <e2e 脚本>` 或 **`--scope-file=…`** 指定场景子集 → `send-results/send-vercel.mjs` → `send-results/send-feishu.mjs`。
 * **用例失败时仍会部署报告并通知飞书**，便于查看 HTML 报告与摘要；默认进程退出码仍反映测试是否通过（供 CI 标红）。
 * 若传入 **`--exit-zero-on-e2e-failure`**（例如 **`pnpm run reaslab-test -- --exit-zero-on-e2e-failure`**）：**始终以退出码 0 结束**，供 GitHub 定时 job 不因 E2E/Vercel/飞书任一步异常而标红；各功能点的通过/失败仍体现在 **Playwright HTML 报告**（及 Vercel 上的报告）中，飞书在能发时仍会发（可能无报告 URL）。
 * 运行：**`pnpm run reaslab-test`** 默认带 **`--scope-file=common/run-scope-beta.txt`**（见 `package.json`）；或 `node run.mjs --e2e=test:05`（脚本名须存在于 `package.json`）。
 * **按 scope 跑**：编辑 **`common/run-scope-beta.txt`**（或自建路径），或设环境变量 **`E2E_SCOPE_FILE`** 覆盖路径（GitHub Actions 等）；解析逻辑见 **`common/parse-run-scope.mjs`**。
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseScopeToOrderedSceneIds } from "./common/parse-run-scope.mjs";
import { deployPlaywrightReportToVercel } from "./send-results/send-vercel.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, ".");
const node = process.execPath;

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    ...opts,
  });
}

/** 将场景号（`NN`）解析为 `test/NN-*.test.ts` 实际路径（相对仓库根）。 */
function resolveScopeTestPaths(repoRoot, sceneIds) {
  if (sceneIds.length === 0) {
    throw new Error("run-scope: 未配置任何场景号（文件为空或仅注释）");
  }
  const testDir = path.join(repoRoot, "test");
  const files = readdirSync(testDir).filter((f) => /^\d{2}-.+\.test\.ts$/.test(f));
  const rel = [];
  for (const id of sceneIds) {
    const hit = files.find((f) => f.startsWith(`${id}-`));
    if (!hit) {
      throw new Error(`run-scope: 未找到场景 ${id} 对应用例（期望 test/${id}-*.test.ts）`);
    }
    rel.push(path.join("test", hit));
  }
  return rel;
}

/** 无 **`--e2e`** 时：不经 scope 则跑 **`testMatch` 全量**（`pnpm exec playwright test --config common/playwright.config.ts`）。 */
const DEFAULT_E2E = "__default_full__";
let e2ePnpmScript = DEFAULT_E2E;
let exitZeroOnE2eFailure = false;
/** 若设置：忽略 `--e2e`，直接按文件列表跑 Playwright。 */
let scopeFilePath = "";
for (const a of process.argv.slice(2)) {
  if (a.startsWith("--e2e=")) {
    const v = a.slice("--e2e=".length).trim();
    if (v) {
      e2ePnpmScript = v;
    }
  } else if (a.startsWith("--scope-file=")) {
    const v = a.slice("--scope-file=".length).trim();
    if (v) {
      scopeFilePath = path.isAbsolute(v) ? v : path.join(REPO_ROOT, v);
    }
  } else if (a === "--exit-zero-on-e2e-failure") {
    exitZeroOnE2eFailure = true;
  }
}

if (!scopeFilePath && process.env.E2E_SCOPE_FILE?.trim()) {
  const v = process.env.E2E_SCOPE_FILE.trim();
  scopeFilePath = path.isAbsolute(v) ? v : path.join(REPO_ROOT, v);
}

const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

/** @type {import('node:child_process').SpawnSyncReturns<string>} */
let t;
if (scopeFilePath) {
  if (e2ePnpmScript !== DEFAULT_E2E) {
    console.log(
      `[run.mjs] 已指定 --scope-file / E2E_SCOPE_FILE，将忽略 --e2e=${JSON.stringify(e2ePnpmScript)}，仅跑 scope 内文件。`,
    );
  }
  const raw = readFileSync(scopeFilePath, "utf8");
  const ids = parseScopeToOrderedSceneIds(raw, { testDir: path.join(REPO_ROOT, "test") });
  const testPaths = resolveScopeTestPaths(REPO_ROOT, ids);
  const scopeLabel = path.relative(REPO_ROOT, scopeFilePath) || scopeFilePath;
  console.log(`[run.mjs] run-scope 来自 ${scopeLabel}（共 ${testPaths.length} 个文件，按执行顺序）：`);
  for (let i = 0; i < testPaths.length; i++) {
    console.log(`  ${i + 1}. ${testPaths[i]}  (场景 ${ids[i]})`);
  }
  t = run(
    pnpmCmd,
    ["exec", "playwright", "test", "--config", "common/playwright.config.ts", ...testPaths],
    { stdio: "inherit" },
  );
} else if (e2ePnpmScript === DEFAULT_E2E) {
  t = run(
    pnpmCmd,
    ["exec", "playwright", "test", "--config", "common/playwright.config.ts"],
    { stdio: "inherit" },
  );
} else {
  t = run(pnpmCmd, ["run", e2ePnpmScript], { stdio: "inherit" });
}
const testsPassed = t.status === 0;
if (!testsPassed) {
  console.error(
    "测试未全部通过（退出码 %s）。仍将上传 Playwright 报告并发送飞书，便于查看失败详情。",
    String(t.status ?? (t.error ? "error" : "unknown")),
  );
}

let reportUrl = "";
const v = deployPlaywrightReportToVercel(REPO_ROOT);
if (v.ok) {
  console.log(v.log);
  console.log("报告地址:", v.url);
  reportUrl = v.url;
} else {
  console.error(v.log);
  console.error("Vercel 部署失败（退出码", v.status, "）；飞书仍发送（若无报告 URL 则卡片不含「打开报告」链接）。");
}

const feishuScript = path.join(REPO_ROOT, "send-results", "send-feishu.mjs");
const feishuArgs = reportUrl ? [feishuScript, reportUrl] : [feishuScript];
const feishuEnv = { ...process.env };
if (scopeFilePath) {
  feishuEnv.E2E_SCOPE_FILE = scopeFilePath;
}
const f = run(node, feishuArgs, { stdio: "inherit", env: feishuEnv });
const feishuExit = f.status ?? (f.error ? 1 : 0);

/** 测试失败优先返回其退出码；否则依次反映部署、飞书失败。 */
let finalExit = 0;
if (!testsPassed) {
  finalExit = typeof t.status === "number" && t.status !== 0 ? t.status : 1;
} else if (!v.ok) {
  finalExit = typeof v.status === "number" ? v.status : 1;
} else if (feishuExit !== 0) {
  finalExit = feishuExit;
}

if (exitZeroOnE2eFailure) {
  if (!testsPassed || !v.ok || feishuExit !== 0) {
    console.log(
      "[--exit-zero-on-e2e-failure] 定时报告模式：E2E / Vercel / 飞书 中至少一项未完全成功（各用例绿/红见 Playwright 报告）；进程仍以 0 退出，避免 GitHub Actions 将本 job 标为失败。",
    );
  }
  finalExit = 0;
}

process.exit(finalExit);
