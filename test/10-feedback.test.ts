import { expect, test } from "@playwright/test";

import { TEST_USER } from "../common/global-setup";
import { navigateToHomeProjects } from "./helpers";

/**
 * **用户场景 §10**：向 ReasLab 反馈意见（见 `docs/用户场景.md`）。
 * **成功条件**：工作台 **Feedback** 打开 **Create new issue** 弹窗；**Add a title**、**Add a description**、**Contact**
 * 三项必填均可写入且值断言通过后，**在点击 Cancel 之前**对弹窗截图并 **attach** 到报告（避免报告里只剩关闭后的工作台）。
 * **不**点击 **Submit**（避免在 GitHub 创建真实 Issue）。关闭用 **Cancel**。
 *
 * 编号 **P211**：用户场景第 10 章（与 `README` 中 `test:10` 约定一致）。
 *
 * 单文件调试：`pnpm run test:10:headed`
 */
test.describe("10. 向 ReasLab 反馈意见", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        globalThis.localStorage.removeItem("rl---navigation-rail-item");
        globalThis.localStorage.removeItem("reaslingo-chat-view-mode");
      } catch {
        /* ignore */
      }
    });
  });

  test("10.1 打开反馈弹窗并填写必填项（不提交）", async ({ page }, testInfo) => {
    await navigateToHomeProjects(page);

    const feedbackBtn = page.getByRole("button", { name: "Feedback" });
    await expect(feedbackBtn).toBeVisible({ timeout: 30_000 });
    await feedbackBtn.click();

    const dialog = page.getByRole("dialog").filter({
      has: page.getByRole("heading", { name: /create new issue/i }),
    });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByRole("heading", { name: /create new issue/i })).toBeVisible({
      timeout: 10_000,
    });
    await expect(dialog.getByText(/reaslab-ide-issues/i).first()).toBeVisible();

    const stamp = Date.now();
    const marker = `E2E-P211-${stamp}`;
    const title = `[${marker}] Draft by reaslab-test Playwright (do not submit)`;
    const body = [
      "Draft for automated test P211 (reaslab-test). **Do not click Submit.**",
      "",
      "- Test file: test/10-feedback.test.ts",
      "- Search prefix if needed: [E2E-P211-",
    ].join("\n");

    const titleInput = dialog.getByLabel(/add a title/i);
    const descriptionInput = dialog.locator("#fb-description");
    const contactInput = dialog.locator("#fb-contact");

    await titleInput.fill(title);
    await descriptionInput.fill(body);
    await contactInput.fill(TEST_USER.email);

    await expect(titleInput).toHaveValue(title);
    await expect(descriptionInput).toHaveValue(body);
    await expect(contactInput).toHaveValue(TEST_USER.email);

    /** 必须在关弹窗前截图，否则 Playwright 默认「最后一步」截图为已关闭对话框后的页面。 */
    const png = await dialog.screenshot();
    await testInfo.attach("10-feedback-create-issue-dialog-filled.png", {
      body: png,
      contentType: "image/png",
    });

    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
  });
});
