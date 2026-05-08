#!/usr/bin/env node
/**
 * 将仓库根目录下 `playwright-report/` 部署到 Vercel（`pnpm exec vercel deploy …`），并从日志解析生产 URL。
 * 单独运行：`node send-results/send-vercel.mjs`（需已存在 `playwright-report/index.html`）。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const REPORT_DIR = path.join(REPO_ROOT, "playwright-report");

/** 从 vercel deploy 日志里取生产环境 URL */
export function extractProductionUrl(text) {
  const prod = text.match(/Production[:\s✅]*\s*(https:\/\/[^\s\])'"<>]+)/i);
  if (prod) {
    return prod[1].replace(/[)\]'"]+$/, "");
  }
  const urls = [...text.matchAll(/https:\/\/[^\s\])'"<>]+/g)].map((m) => m[0]);
  const vercelHosts = urls.filter((u) => /\.vercel\.app\b/i.test(u));
  const pick = vercelHosts.length ? vercelHosts[vercelHosts.length - 1] : urls.at(-1);
  return pick ?? null;
}

/**
 * @param {string} [repoRoot] 仓库根，默认本脚本上级
 * @returns {{ ok: true, url: string, log: string } | { ok: false, status: number|null, log: string }}
 */
export function deployPlaywrightReportToVercel(repoRoot = REPO_ROOT) {
  const reportDir = path.join(repoRoot, "playwright-report");
  if (!fs.existsSync(path.join(reportDir, "index.html"))) {
    return {
      ok: false,
      status: 2,
      log: `未找到 ${path.join(reportDir, "index.html")}，请先 pnpm exec playwright test --config common/playwright.config.ts 生成报告。`,
    };
  }

  const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const vercelArgs = ["exec", "vercel", "deploy", "playwright-report", "--prod", "--yes"];
  const v = spawnSync(pnpmCmd, vercelArgs, {
    cwd: repoRoot,
    stdio: ["inherit", "pipe", "pipe"],
    encoding: "utf8",
  });
  const log = `${v.stdout ?? ""}\n${v.stderr ?? ""}`;
  if (v.status !== 0) {
    return { ok: false, status: v.status ?? 1, log };
  }
  const url = extractProductionUrl(log);
  if (!url) {
    return {
      ok: false,
      status: 1,
      log: `${log}\n未能从 Vercel 输出中解析报告 URL。`,
    };
  }
  return { ok: true, url, log };
}

function isExecutedAsCli() {
  const arg1 = process.argv[1];
  if (!arg1) {
    return false;
  }
  return path.resolve(arg1) === path.resolve(fileURLToPath(import.meta.url));
}

if (isExecutedAsCli()) {
  const r = deployPlaywrightReportToVercel();
  if (r.ok) {
    console.log(r.log);
    console.log("报告地址:", r.url);
    process.exit(0);
  }
  console.error(r.log);
  console.error(
    "Vercel 部署失败。可检查 `pnpm run vercel:login` 或 `VERCEL_TOKEN`。手动发飞书：",
    `node send-results/send-feishu.mjs "<报告 https URL>"`,
  );
  process.exit(typeof r.status === "number" ? r.status : 1);
}
