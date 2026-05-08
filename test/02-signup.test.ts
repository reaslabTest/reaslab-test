import { expect, test } from "@playwright/test";

import { absUrl, E2E_SIGNUP_INBOX_EMAIL, TEST_USER } from "../common/global-setup";

/**
 * 用户场景 2：通过邮箱注册（见 `docs/用户场景.md`）——打开注册页 → 填写用户名、邮箱、密码 → 提交后出现绿色成功提示（验证邮件已发送）。
 *
 * 不自动化「邮件内点击验证链接」。默认使用 **`E2E_SIGNUP_INBOX_EMAIL`**（见 `common/global-setup.ts`，一般为 `reaslabTest2@proton.me`）的 **plus-address**（`local+signup.<ts>@domain`），与主测试账号 **`TEST_USER`** 收件箱分离。
 *
 * 环境变量（可选）：
 * - **`E2E_SIGNUP_INBOX_EMAIL`**：基址邮箱，默认已在 global-setup 中定义。
 * - **`E2E_SIGNUP_EMAIL_LOCAL`** / **`E2E_SIGNUP_EMAIL_DOMAIN`**：分别覆盖 `@` 左侧 / 右侧（仍会自动加 `+signup.<tag>`）。
 * - **`E2E_SIGNUP_PASSWORD`**：注册密码（须 8～20 字符，与前端 `passwordSchema` 一致）。
 *
 * 单文件调试：`pnpm run test:02:headed`，或
 * `npx playwright test --config common/playwright.config.ts test/02-signup.test.ts --headed`。
 */

const NAV_MS = 90_000;
const ACTION_MS = 60_000;
const SUCCESS_MS = 90_000;

/** 与 `reaslab-ide` `lib/utils/validate.ts` 中 `userNameSchema` 一致：字母或下划线开头，3～20 字符。 */
function signupUsername(): string {
  const core = Date.now().toString(36);
  const name = `e2e_${core}`;
  return name.length <= 20 ? name : name.slice(0, 20);
}

function signupTestEmail(): string {
  const tag = `signup.${Date.now().toString(36)}`;

  const domainFromEnv = process.env.E2E_SIGNUP_EMAIL_DOMAIN?.trim();
  const localFromEnv = process.env.E2E_SIGNUP_EMAIL_LOCAL?.trim();

  if (localFromEnv || domainFromEnv) {
    const fallback = E2E_SIGNUP_INBOX_EMAIL.split("@");
    const local = localFromEnv || fallback[0] || "reaslabTest2";
    const domain = domainFromEnv || fallback[1] || TEST_USER.email.split("@")[1] || "proton.me";
    return `${local}+${tag}@${domain}`;
  }

  const at = E2E_SIGNUP_INBOX_EMAIL.indexOf("@");
  if (at <= 0) {
    throw new Error(`E2E_SIGNUP_INBOX_EMAIL 无效（缺少 @）：${E2E_SIGNUP_INBOX_EMAIL}`);
  }
  const local = E2E_SIGNUP_INBOX_EMAIL.slice(0, at);
  const domain = E2E_SIGNUP_INBOX_EMAIL.slice(at + 1);
  return `${local}+${tag}@${domain}`;
}

function signupPassword(): string {
  const raw = process.env.E2E_SIGNUP_PASSWORD?.trim();
  const pwd = raw && raw.length >= 8 && raw.length <= 20 ? raw : "reaslabTest";
  return pwd;
}

test.describe("2. 通过邮箱注册账号", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.setTimeout(120_000);

  test("2.1 提交注册信息后提示验证邮件已发送", async ({ page }) => {
    page.setDefaultNavigationTimeout(NAV_MS);
    page.setDefaultTimeout(ACTION_MS);

    const userName = signupUsername();
    const email = signupTestEmail();
    const password = signupPassword();

    await test.step("打开注册页", async () => {
      await page.goto(absUrl("/unauthenticated/signup"), { waitUntil: "domcontentloaded" });
      // 注册页标题在 CardTitle（<div>）上，无 heading 角色，不能用 getByRole("heading")。
      await expect(page.getByText("Create your account", { exact: true })).toBeVisible({
        timeout: ACTION_MS,
      });
    });

    await test.step("填写表单并提交", async () => {
      await page.locator("#username").waitFor({ state: "visible", timeout: ACTION_MS });
      await page.locator("#username").fill(userName);
      await page.locator("#email").fill(email);
      await page.locator("#password").fill(password);
      await page.locator("#confirmPassword").fill(password);

      const submit = page.getByRole("button", { name: /^Sign up$/i });
      await expect(submit).toBeEnabled({ timeout: 15_000 });
      await submit.click();
    });

    await test.step("绿色成功区出现「Verification email sent」", async () => {
      const successBox = page.locator("div.border-green-200").filter({
        hasText: /Verification email sent/i,
      });
      const errBox = page.locator("div.border-red-200").filter({ has: page.locator("p.text-red-800") });

      try {
        await expect(successBox).toBeVisible({ timeout: SUCCESS_MS });
      } catch (e) {
        const errVisible = await errBox.first().isVisible().catch(() => false);
        const errText = errVisible
          ? (await errBox.first().locator("p").textContent().catch(() => ""))?.trim()
          : "";
        const hint = errText
          ? `服务端/表单错误提示：${errText}`
          : "未见红色错误框；请检查网络、WAF 或 beta 上注册接口是否可用。";
        throw new Error(`${(e as Error).message}\n[诊断] ${hint}\n注册邮箱：${email} 用户名：${userName}`);
      }
    });
  });
});
