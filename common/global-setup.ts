import { mkdirSync } from "node:fs";
import path from "node:path";

import { chromium, type FullConfig, type Page } from "@playwright/test";

/**
 * 被测前端 origin（与 `playwright.config` 根级 `baseURL` 同源；改环境时只改 **`E2E_BASE_URL_DEFAULT`**）。
 * 单行格式供 **`send-results/send-feishu.mjs`** 解析；飞书「被测网站」展示可用环境变量 **`E2E_BASE_URL`** 覆盖。
 */
const E2E_BASE_URL_DEFAULT = "https://beta.reaslab.io";

export const E2E_BASE_URL = E2E_BASE_URL_DEFAULT;

/**
 * 飞书自定义机器人 Webhook 默认值（**`send-results/send-feishu.mjs`** 会解析本文件中的 **`FEISHU_WEBHOOK_URL_DEFAULT`** 行；流水线可用 **`FEISHU_WEBHOOK_URL`** 覆盖）。
 * 勿提交含签名的变体；机器人须关闭签名校验（与飞书脚本一致）。
 * 须为**单独一行**源码赋值（`send-feishu.mjs` 按行解析）；勿在注释反引号内写与真实赋值同形的占位 URL，以免旧版正则误匹配。
 */
const FEISHU_WEBHOOK_URL_DEFAULT = "https://open.feishu.cn/open-apis/bot/v2/hook/cd861436-2cdb-4f1e-8921-86f5d768d068";

export const FEISHU_WEBHOOK_URL =
  process.env.FEISHU_WEBHOOK_URL?.trim() || FEISHU_WEBHOOK_URL_DEFAULT;

/**
 * Cloudflare Access + 服务令牌：请求携带与策略一致的 **Id/Secret**（**`x-testing-auth`**）及固定 **User-Agent**，不依赖 runner 出口 IP。
 * 与 **beta.reaslab.io** 侧策略变更时在此同步更新。
 */
export const E2E_CF_TESTING_AUTH = "Sec-Auto-9vP#2zR7_Qx8k-2026";
export const E2E_BOT_USER_AGENT =
  process.env.E2E_USER_AGENT ?? "Internal-QA-Bot/1.0 (E2E-Automated-Runner)";

/**
 * P110 §5.5 等项目分享邀请的目标邮箱；流水线可用环境变量 **`E2E_SHARE_INVITE_EMAIL`** 覆盖。
 */
export const E2E_SHARE_INVITE_EMAIL =
  process.env.E2E_SHARE_INVITE_EMAIL?.trim() || "yuanbo@icode.pku.edu.cn";

/**
 * 场景 2「邮箱注册」E2E 中 **plus-address** 的基址（`local+tag@domain`），验证邮件进该收件箱而非 **`TEST_USER`**。
 * 流水线可用 **`E2E_SIGNUP_INBOX_EMAIL`** 覆盖。
 */
export const E2E_SIGNUP_INBOX_EMAIL =
  process.env.E2E_SIGNUP_INBOX_EMAIL?.trim() || "reaslabTest2@proton.me";

/** 与 `playwright.config` 中各 project 的 `use` 保持一致，须与 global-setup 登录共用。 */
export const E2E_WAF_BYPASS_CONTEXT = {
  userAgent: E2E_BOT_USER_AGENT,
  extraHTTPHeaders: {
    "x-testing-auth": E2E_CF_TESTING_AUTH,
  },
} as const;

/**
 * 拼绝对 URL：部分环境下 Playwright `use.baseURL` 未进 worker，`page.goto("/")` 会报 invalid URL。
 */
export function absUrl(path: string): string {
  const pathname = path.startsWith("/") ? path : `/${path}`;
  return new URL(pathname, E2E_BASE_URL).href;
}

/**
 * GitHub.com 账号（与 ReasLab 侧 **`TEST_USER`** 不同）；可用于需登录 GitHub 的其它脚本或本地调试。
 */
export const E2E_GITHUB_USERNAME = "reaslabTest";
export const E2E_GITHUB_PASSWORD = "reaslab123Test";

const TEST_USER = {
  email: "reaslabTest@proton.me",
  password: "reaslabTest",
  userName: "reaslabTest",
};

const STORAGE_STATE_PATH = path.join(import.meta.dirname, ".auth", "storage-state.json");

/** 登录链路各步上限约 1 分钟（与 `test/03-loginOut` 一致）。 */
const NAV_TIMEOUT_MS = 60_000;
const ACTION_TIMEOUT_MS = 60_000;
const POST_LOGIN_SHELL_MS = 60_000;

/** Linux 下以 root 跑 Chromium 时默认沙箱不可用，必须关闭沙箱，否则常见白屏/脚本不执行、#Email 永不出现。 */
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

/** 与 `playwright test --headed` 一致时由 Playwright 传入 `--headed`（见 argv）。 */
function wantHeadedBrowser(): boolean {
  return process.argv.includes("--headed");
}

async function waitForProjectsHeading(page: Page, timeoutMs: number): Promise<void> {
  const heading = page.getByRole("heading", { name: "Projects" });
  try {
    await heading.waitFor({ state: "visible", timeout: timeoutMs });
  } catch {
    throw new Error(
      `等待「Projects」标题超时（${timeoutMs}ms）。请确认已登录且已进入工作台（${E2E_BASE_URL}）。当前 URL：${page.url()}`,
    );
  }
}

/**
 * Log in as the test user and save the browser storage state (cookies).
 */
async function loginAndSaveState(): Promise<void> {
  mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });

  const browser = await chromium.launch({
    headless: !wantHeadedBrowser(),
    args: chromiumArgsForPlatform(),
  });
  const context = await browser.newContext({ ...E2E_WAF_BYPASS_CONTEXT });
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
  page.setDefaultTimeout(ACTION_TIMEOUT_MS);

  await page.goto(absUrl("/unauthenticated/login"), {
    waitUntil: "domcontentloaded",
    timeout: NAV_TIMEOUT_MS,
  });
  const emailInput = page.locator("#Email");
  await emailInput.waitFor({ state: "visible", timeout: ACTION_TIMEOUT_MS });
  await emailInput.fill(TEST_USER.email);
  await page.locator("#Password").fill(TEST_USER.password);
  await page.getByRole("button", { name: "Login", exact: true }).click();

  await waitForProjectsHeading(page, POST_LOGIN_SHELL_MS);

  await context.storageState({ path: STORAGE_STATE_PATH });

  await browser.close();
}

async function globalSetup(_config: FullConfig): Promise<void> {
  await loginAndSaveState();
}

export default globalSetup;
export { TEST_USER, STORAGE_STATE_PATH };
