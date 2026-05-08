import { expect, test } from "@playwright/test";

import {
  E2E_DEFAULT_IMPORT_GIT_URL,
  manualImportGitAndEnterIde,
  reasLingoWhoAreYouProbe,
} from "./helpers";

/**
 * **用户场景 §6**：从 Git 导入项目（`docs/用户场景.md`）。
 * 使用前端示例默认仓库 **flt-regular**，项目名使用 **E2E 专用前缀**，避免与人工项目混淆。
 *
 * 调试（有界面）：`pnpm run test:06:headed`
 */
const P116_SKIP_MSG =
  "Import Git 未在超时内完成（网络、GitHub 限流、工具链/lake 过慢或 gRPC 超时），跳过本用例。";

test.describe("6. 从 Git 导入项目", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(600_000);

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

  test("6.1 进入 IDE 并试用 ReasLingo 对话", async ({ page }) => {
    const projectName = `e2eImportGit_${Date.now()}`;
    const ok = await manualImportGitAndEnterIde(page, E2E_DEFAULT_IMPORT_GIT_URL, projectName);
    test.skip(!ok, P116_SKIP_MSG);

    await expect(page).toHaveURL(/\/projects\/[^/]+\/?$/i);
    await expect(page.getByTitle("Create New File")).toBeVisible({ timeout: 30_000 });

    await test.step("§6 步骤 6：ReasLingo 默认 Agent，who are you?", async () => {
      await reasLingoWhoAreYouProbe(page, null);
    });
  });
});
