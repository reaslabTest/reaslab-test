import { expect, test, type Page } from "@playwright/test";

import { absUrl, TEST_USER } from "../common/global-setup";

/**
 * **用户场景 §3.1** 登录 + **登出**（见 `docs/用户场景.md`）：同一用例内 **登录一次 → 登出一次**。
 * 登出：顶栏用户菜单 **Logout** → **`/home`** 未登录态出现 **Login** 链。
 *
 * 凭据与 **`common/global-setup.ts`** 中 **`TEST_USER`** / 预置 **`storage-state`** 一致。
 *
 * 单文件调试：`pnpm run test:03:headed`，或
 * `npx playwright test --config common/playwright.config.ts test/03-loginOut.test.ts --headed`。
 */
async function loginWithEmailPassword(page: Page): Promise<void> {
  await page.goto(absUrl("/unauthenticated/login"), { waitUntil: "domcontentloaded" });
  const emailInput = page.locator("#Email");
  await emailInput.waitFor({ state: "visible", timeout: 60_000 });
  await emailInput.fill(TEST_USER.email);
  await page.locator("#Password").fill(TEST_USER.password);
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible({ timeout: 60_000 });
}

async function openUserMenu(page: Page): Promise<void> {
  /**
   * `reaslab-iipe`：`UserMenu` 用 **`DropdownMenuTrigger`** 包住 **`CurrentUserAvatar`**；
   * **`@base-ui/react/avatar`** 的 **`AvatarImage`**（`img`）在就绪过程中可能被替换，直接点 `img` 易出现 **detached**。
   * 应点 **`[data-slot="dropdown-menu-trigger"]`** 且内含 **`[data-slot="avatar"]`** 的节点（与 **Templates** 下拉区分）。
   */
  const userMenuTrigger = page.locator("header nav [data-slot='dropdown-menu-trigger']").filter({
    has: page.locator("[data-slot='avatar']"),
  });
  await expect(userMenuTrigger).toBeVisible({ timeout: 30_000 });
  await userMenuTrigger.click();
  await expect(page.getByRole("menuitem", { name: /^Logout$/i })).toBeVisible({ timeout: 15_000 });
}

test.describe("3. 登录", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.setTimeout(120_000);

  test("3.1 通过邮箱登录", async ({ page }) => {
    page.setDefaultNavigationTimeout(90_000);
    page.setDefaultTimeout(60_000);

    await test.step("邮箱 + 密码登录 → 工作台 Projects", async () => {
      await loginWithEmailPassword(page);
    });

    await test.step("打开用户菜单并 Logout", async () => {
      await openUserMenu(page);
      await page.getByRole("menuitem", { name: /^Logout$/i }).click();
    });

    await test.step("回到 /home 且可见 Login（链）", async () => {
      await page.waitForURL(/\/home\/?$/i, { timeout: 60_000, waitUntil: "domcontentloaded" });
      await expect(page.getByRole("link", { name: /^Login$/i }).first()).toBeVisible({
        timeout: 30_000,
      });
    });
  });
});
