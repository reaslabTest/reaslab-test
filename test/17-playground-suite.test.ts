import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { writePlaygroundProjectUuidArtifact } from "./data/e2e-playground-project-artifact";
import {
  applyPlaygroundEditorSettings,
  exportPlaygroundToUrlAndReadLink,
  installPlaygroundInitScript,
  loadPlaygroundContentFromUrl,
  loadPlaygroundFileFromDisk,
  navigateToPlayground,
  playgroundLoadFixturePath,
  PLAYGROUND_REMAINING_EXAMPLES,
  readPlaygroundEditorSettings,
  selectPlaygroundExample,
  waitForPlaygroundLeanEditor,
  expectPlaygroundInfoviewForEvalLine,
} from "./17-playground-suite-helper";
import { navigateToHomeProjects, openLeafFile, projectsTabPanel, projectsTableDataRowsInTabPanel, waitForFileTree } from "./helpers";

/**
 * **用户场景 §17**：Playground 完整功能（见 `docs/用户场景.md`）。
 * **17.1～17.4** 免登录；**17.5** 使用 **`storageState`** 登录态。
 * **Basic Math** 由 **§1 / `01-playground.test.ts`** 覆盖，**17.1** 测其余四类 Example。
 *
 * 单文件调试：**`pnpm run test:17:headed`**。
 */
test.describe("17. Playground 完整功能", () => {
  test.describe.configure({ mode: "serial" });

  test.describe("17.1～17.4 免登录", () => {
    test.use({ storageState: { cookies: [], origins: [] } });
    test.setTimeout(240_000);

    test.beforeEach(async ({ page }) => {
      await installPlaygroundInitScript(page);
    });

    test("17.1 试用Example其余样例", async ({ page }) => {
      await test.step("进入 Playground 并等待 Lean 就绪", async () => {
        await navigateToPlayground(page);
        await waitForPlaygroundLeanEditor(page);
      });

      for (const example of PLAYGROUND_REMAINING_EXAMPLES) {
        await test.step(`Examples → ${example.title}`, async () => {
          await selectPlaygroundExample(page, example.title);
          await expect(page.locator(".cm-content").first()).toContainText(example.codeSnippet, {
            timeout: 60_000,
          });
          await expectPlaygroundInfoviewForEvalLine(page, example.evalLine, example.infoPattern);
        });
      }
    });

    test("17.2 通过Load导入", async ({ page }) => {
      const fixtureMarker = "E2E playground load fixture";

      await test.step("进入 Playground", async () => {
        await navigateToPlayground(page);
        await waitForPlaygroundLeanEditor(page);
      });

      await test.step("Load file from disk：.lean", async () => {
        await loadPlaygroundFileFromDisk(page, playgroundLoadFixturePath("lean"));
        await expect(page.locator(".cm-content").first()).toContainText(fixtureMarker);
        await expect(page.locator(".cm-content").first()).toContainText("#eval 1 + 2");
      });

      await test.step("Load file from disk：.txt", async () => {
        await loadPlaygroundFileFromDisk(page, playgroundLoadFixturePath("txt"));
        await expect(page.locator(".cm-content").first()).toContainText(fixtureMarker);
      });

      await test.step("Load content from URL（#codez=）", async () => {
        await selectPlaygroundExample(page, "Basic Math");
        const shareUrl = await exportPlaygroundToUrlAndReadLink(page);
        await loadPlaygroundContentFromUrl(page, shareUrl);
        await expect(page.locator(".cm-content").first()).toContainText("def double (n : Nat) : Nat := n * 2", {
          timeout: 60_000,
        });
      });
    });

    test("17.3 通过Export导出", async ({ page }) => {
      const fixtureMarker = "E2E playground load fixture";

      await test.step("进入 Playground 并加载夹具", async () => {
        await navigateToPlayground(page);
        await waitForPlaygroundLeanEditor(page);
        await loadPlaygroundFileFromDisk(page, playgroundLoadFixturePath("lean"));
        await expect(page.locator(".cm-content").first()).toContainText(fixtureMarker);
      });

      await test.step("Export content to disk", async () => {
        const downloadPromise = page.waitForEvent("download");
        await page.getByRole("button", { name: "Export", exact: true }).click();
        await page.getByRole("menuitem", { name: "Export content to disk" }).click();
        await expect(page.getByText("File exported successfully")).toBeVisible({ timeout: 15_000 });
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toMatch(/lean-playground-.*\.lean$/u);
        const savePath = path.join(test.info().outputDir, download.suggestedFilename());
        await download.saveAs(savePath);
        const body = fs.readFileSync(savePath, "utf8");
        expect(body).toContain(fixtureMarker);
      });

      await test.step("Export content to URL", async () => {
        const shareUrl = await exportPlaygroundToUrlAndReadLink(page);
        expect(shareUrl).toMatch(/\/playground#codez=/i);
      });
    });

    test("17.4 通过Settings设置字体行号等", async ({ page }) => {
      await test.step("进入 Playground", async () => {
        await navigateToPlayground(page);
        await waitForPlaygroundLeanEditor(page);
      });

      await test.step("修改 Font Size / Tab Size / 行号 / 换行", async () => {
        await applyPlaygroundEditorSettings(page, {
          fontSize: "18px",
          tabSize: "4",
          showLineNumbers: false,
          wordWrap: true,
        });
      });

      await test.step("验收 localStorage 与编辑器外观", async () => {
        const settings = await readPlaygroundEditorSettings(page);
        expect(settings.fontSize).toBe(18);
        expect(settings.tabSize).toBe(4);
        expect(settings.lineNumber).toBe(false);
        expect(settings.wordWrap).toBe(true);

        await expect
          .poll(async () =>
            page.locator(".cm-editor").first().evaluate((el) => getComputedStyle(el).fontSize),
          )
          .toBe("18px");
        await expect(page.locator(".cm-editor .cm-lineNumbers")).toHaveCount(0);
        await expect(page.locator(".cm-editor.cm-lineWrapping, .cm-editor .cm-lineWrapping").first()).toBeVisible();
      });
    });
  });

  test.describe("17.5 通过Create Project创建项目", () => {
    test.setTimeout(600_000);

    test.beforeEach(async ({ page }) => {
      await installPlaygroundInitScript(page, { resetCta: true });
    });

    test("17.5 通过Create Project创建项目", async ({ page }) => {
      const projectName = `e2e_pg_${Date.now().toString(36)}`;
      const codeMarker = "def double (n : Nat) : Nat := n * 2";

      await test.step("登录态进入 Playground 并加载 Example", async () => {
        await navigateToPlayground(page);
        await waitForPlaygroundLeanEditor(page);
        await selectPlaygroundExample(page, "Basic Math");
        await expect(page.locator(".cm-content").first()).toContainText(codeMarker);
      });

      await test.step("左下 Create Project → 填名 → Create", async () => {
        await page.getByRole("button", { name: "Create Project", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Create Project" });
        await expect(dialog).toBeVisible({ timeout: 60_000 });
        await dialog.getByLabel("Project Name").fill(projectName);
        await dialog.getByRole("button", { name: "Create Project", exact: true }).click();
        await page.waitForURL(/\/projects\/[^/]+\/?$/i, { timeout: 600_000 });
      });

      await test.step("项目 IDE：Main.lean 含 Playground 代码", async () => {
        const uuidMatch = page.url().match(/\/projects\/([^/]+)/i);
        expect(uuidMatch?.[1]).toBeTruthy();
        writePlaygroundProjectUuidArtifact(uuidMatch![1]!);
        await expect(page.getByTitle("Create New File")).toBeVisible({ timeout: 120_000 });
        await waitForFileTree(page);
        // iipe `newLeanProject` + 写入 `Main.lean` 后不会自动打开标签；须在 Explore 点开（见截图空白编辑区）。
        await openLeafFile(page, ["Main.lean"]);
        const editor = page.locator(".cm-content").filter({ visible: true }).first();
        await expect(editor).toContainText(codeMarker, { timeout: 180_000 });
      });

      await test.step("Projects 列表可见新项目", async () => {
        await navigateToHomeProjects(page);
        await page.getByRole("tab", { name: "My Projects" }).click();
        const panel = projectsTabPanel(page, "My Projects");
        await expect(panel.getByPlaceholder("Search projects...")).toBeVisible({ timeout: 30_000 });
        await panel.getByPlaceholder("Search projects...").fill(projectName);
        const row = projectsTableDataRowsInTabPanel(panel).filter({ hasText: projectName });
        await expect(row.first()).toBeVisible({ timeout: 60_000 });
      });
    });
  });
});
