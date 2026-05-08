import { expect, test } from "@playwright/test";

import { absUrl } from "../common/global-setup";

/**
 * **用户场景 §4**：设置账号基础信息（见 `docs/用户场景.md`）。
 * 仅覆盖：登录态进入账户设置资料区、**Name** 在原昵称后附加 **Base36(毫秒)** 短后缀（满足总长 ≤20 与 `[a-zA-Z0-9_-]`）、**Save Changes**、成功提示与刷新后持久化。**不**恢复原名（跑完后账号昵称保持为新值）。
 *
 * 有界面调试：`pnpm run test:04:headed`，或
 * `npx playwright test --config common/playwright.config.ts test/04-account-settings.test.ts --headed`。
 */
test.describe("4. 设置账号基础信息", () => {
  test.setTimeout(120_000);

  test("4.1 改昵称保存并刷新仍生效", async ({ page }) => {
    await test.step("进入账户设置（资料区）", async () => {
      await page.goto(absUrl("/account"), { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Account Settings" })).toBeVisible({
        timeout: 60_000,
      });
      await expect(page.getByText("Account Information", { exact: true })).toBeVisible({
        timeout: 30_000,
      });
    });

    const nameInput = page.getByRole("textbox", { name: /Name/i });

    await test.step("修改昵称 → 保存 → 成功提示 → 刷新校验", async () => {
      await expect(nameInput).toBeVisible({ timeout: 30_000 });
      const originalName = await nameInput.inputValue();
      /** 与前端 `accountSettingsSchema.name`（`userNameSchema`）一致：仅 `[a-zA-Z0-9_-]`、总长 ≤20。`Date.now().toString(36)` 比十进制短，便于在限制下保留更多原名。 */
      const suffix = `_${Date.now().toString(36)}`;
      const maxLen = 20;
      const combined = `${originalName}${suffix}`;
      const newName =
        combined.length <= maxLen
          ? combined
          : `${originalName.slice(0, Math.max(0, maxLen - suffix.length))}${suffix}`;

      await nameInput.fill(newName);
      const saveBtn = page.getByRole("button", { name: "Save Changes" });
      await expect(saveBtn).toBeEnabled({ timeout: 15_000 });
      await saveBtn.click();

      await expect(
        page.getByText("Account information updated successfully.", { exact: true }),
      ).toBeVisible({ timeout: 30_000 });

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Account Settings" })).toBeVisible({
        timeout: 60_000,
      });
      await expect(nameInput).toHaveValue(newName, { timeout: 30_000 });
    });
  });
});
