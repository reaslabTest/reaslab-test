import path from "node:path";

import { defineConfig, devices, type PlaywrightTestOptions } from "@playwright/test";

import { E2E_BASE_URL, E2E_WAF_BYPASS_CONTEXT } from "./global-setup";

/**
 * E2E：`testDir` 为仓库根；用例与共享辅助在 **`test/`**（匹配 `test` 目录下全部 `*.test.ts`、`test/helpers.ts`）。无匹配时仍依赖 `passWithNoTests`。
 */

const COMMON_DIR = import.meta.dirname;
const TEST_E2E_ROOT = path.join(COMMON_DIR, "..");

/** 与 `global-setup.ts` 写入路径一致（`common/.auth/`）。 */
const STORAGE_STATE_PATH = path.join(COMMON_DIR, ".auth", "storage-state.json");

/** 与 global-setup 一致：Linux root 下 Chromium 须关闭沙箱。 */
function chromiumArgsForPlatform(): string[] {
  if (
    process.platform === "linux" &&
    typeof process.getuid === "function" &&
    process.getuid() === 0
  ) {
    return ["--no-sandbox", "--disable-setuid-sandbox"];
  }
  return [];
}

const rootSandboxArgs = chromiumArgsForPlatform();
const chromeProjectUse = {
  ...devices["Desktop Chrome"],
  ...E2E_WAF_BYPASS_CONTEXT,
  ...(rootSandboxArgs.length > 0 ? { launchOptions: { args: rootSandboxArgs } } : {}),
} as unknown as PlaywrightTestOptions;

export default defineConfig({
  testDir: TEST_E2E_ROOT,
  /** 无匹配用例时仍退出 0（例如仅生成报告流水线）。 */
  passWithNoTests: true,
  globalSetup: path.join(COMMON_DIR, "global-setup.ts"),
  /** P109 等含「上传关窗最长 180s + 轮询文件树」；须大于单步 expect 上限，避免 worker 收尾关浏览器时 poll 仍访问 locator。 */
  timeout: 360_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  reporter: [
    /** GitHub Actions：在 workflow 摘要里生成用例级结果；与下方 `list` 互补。 */
    ...(process.env.GITHUB_ACTIONS ? ([["github"]] as const) : []),
    /** 控制台逐条打印「正在跑 / 通过 / 失败」；定时任务日志里可看出执行到哪个用例（多 worker 时可能交错）。 */
    ["list"],
    [
      "html",
      {
        open: "never",
        outputFolder: path.join(TEST_E2E_ROOT, "playwright-report"),
      },
    ],
    ["json", { outputFile: path.join(TEST_E2E_ROOT, "test-results", "e2e-results.json") }],
  ],
  outputDir: path.join(TEST_E2E_ROOT, "test-results"),
  use: {
    baseURL: E2E_BASE_URL,
    ...E2E_WAF_BYPASS_CONTEXT,
    viewport: { width: 1280, height: 720 },
    screenshot: "on",
    trace: "on-first-retry",
    navigationTimeout: 60_000,
    storageState: STORAGE_STATE_PATH,
  },
  projects: [
    {
      name: "e2e",
      testMatch: "test/**/*.test.ts",
      use: chromeProjectUse,
    },
  ],
});
