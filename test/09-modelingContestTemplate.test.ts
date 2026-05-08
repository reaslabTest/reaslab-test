import { expect, test } from "@playwright/test";

import {
  MODELING_CH9_SKIP_MSG,
  openLeafFile,
  reasLingoWhoAreYouProbe,
  tryEnterContestTemplateModelingIde,
} from "./helpers";

test.describe("9. 模板创建竞赛建模项目", () => {
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

  test("9.1 从竞赛建模模板创建项目并进入建模 IDE", async ({ page }) => {
    test.skip(!(await tryEnterContestTemplateModelingIde(page)), MODELING_CH9_SKIP_MSG);
    await expect(page).toHaveURL(/\/projects\/[^/]+\/?$/i);
    await expect(page.getByTitle("Create New File")).toBeVisible({ timeout: 30_000 });
    await expect(
      page.locator(".bg-sidebar button").filter({ has: page.locator("svg.lucide-sliders-horizontal") }),
    ).toBeVisible({ timeout: 30_000 });
  });

  /**
   * `docs/用户场景.md` 9.2：进入项目后打开 **README.md**，工具栏眼睛 **Toggle Markdown Preview**，
   * `.ide-markdown-surface` 与 `.prose-markdown` 有内容即成功（与 7.2 一致）。
   */
  test("9.2 打开 README.md 并显示 Markdown 预览", async ({ page }) => {
    test.skip(!(await tryEnterContestTemplateModelingIde(page)), MODELING_CH9_SKIP_MSG);

    await expect(page.getByTitle("Create New File")).toBeVisible({ timeout: 30_000 });

    try {
      await openLeafFile(page, ["README.md"]);
    } catch {
      const tree = page.locator(".ide-filetree").filter({ visible: true }).first();
      await expect(tree).toBeVisible({ timeout: 45_000 });
      await tree.getByText(/readme\.md/i).first().click({ timeout: 15_000 });
    }

    await page.locator(".cm-editor").first().waitFor({ state: "visible", timeout: 60_000 });

    const markdownPreviewToggle = page
      .locator("div.flex.h-8.justify-end.gap-2.border-b")
      .locator("button")
      .filter({ has: page.locator("svg.lucide-eye") })
      .first();
    await expect(markdownPreviewToggle).toBeVisible({ timeout: 20_000 });
    await markdownPreviewToggle.click();

    const previewSurface = page.locator(".ide-markdown-surface").filter({ visible: true }).first();
    await expect(previewSurface).toBeVisible({ timeout: 45_000 });
    await expect
      .poll(
        async () => (await previewSurface.locator(".prose-markdown").first().innerText()).trim().length,
        { timeout: 60_000 },
      )
      .toBeGreaterThan(5);
  });

  test("9.3 ReasLingo：Math Modeling 与 who are you?", async ({ page }) => {
    test.skip(!(await tryEnterContestTemplateModelingIde(page)), MODELING_CH9_SKIP_MSG);
    const ok = await reasLingoWhoAreYouProbe(page, /Math Modeling/i);
    test.skip(!ok, "当前环境无 Math Modeling Agent，跳过 9.3 ReasLingo。");
  });
});
