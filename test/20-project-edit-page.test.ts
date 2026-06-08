import { expect, test } from "@playwright/test";

import {
  chapter20Context,
  clickMenuSyncPull,
  clickMenuSyncPush,
  closeMenuSettingsSheet,
  compileTexAndExpectPdfCanvas,
  configureGitRemoteInProjectSettings,
  E2E_GIT_SYNC_REPO_URL,
  enterModelingProjectIdeForChapter20,
  openModelingProjectIdeByUuid,
  openMenuSettingsSheet,
  openProjectHistoryDialog,
  appendLineToVisibleEditor,
  expectActiveEditorLineNumbers,
  expectEditorLineNumbersInStorage,
  fillMenuNumberSetting,
  projectUuidFromUrl,
  selectMenuEditorTheme,
  selectMenuLaTeXCompilerDifferent,
  setMenuLineNumbersEnabled,
  uploadTexFixtureForChapter20,
  visibleCmContent,
} from "./20-project-edit-page-helper";
import { openLeafFile } from "./helpers";

/**
 * **用户场景 §20**：项目 IDE 顶栏 **Menu / History**（见 `docs/用户场景.md`）。
 * 全量跑时位于 **§19** 之后、**§13.2** 之前；单文件：**`pnpm run test:20:headed`**。
 */
test.describe("20. 项目编辑页（Menu / History）", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        globalThis.localStorage.removeItem("rl---navigation-rail-item");
        globalThis.localStorage.removeItem("reaslingo-chat-view-mode");
        // §20.2：与 `lineNumbersAtom` 默认 true 对齐，避免残留 localStorage 导致开关与编辑器不同步
        globalThis.localStorage.removeItem("editor.lineNumbers");
        globalThis.localStorage.removeItem("editor.fontSize");
        globalThis.localStorage.removeItem("editor.tabSize");
        globalThis.localStorage.removeItem("ide.theme");
      } catch {
        /* ignore */
      }
    });
  });

  test.describe("20.1 通过 Menu 导出、复制与 GitHub 同步", () => {
    test.setTimeout(300_000);

    test("20.1 通过 Menu 导出、复制与 GitHub 同步", async ({ page }) => {
      await enterModelingProjectIdeForChapter20(page);
      const projectName = chapter20Context.projectName!;
      const sourceUuid = projectUuidFromUrl(page);
      chapter20Context.projectUuid = sourceUuid;
      chapter20Context.modelingProjectUuid = sourceUuid;

      await test.step("Menu 分区与 Source (ZIP)", async () => {
        const sheet = await openMenuSettingsSheet(page);
        const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
        await sheet.getByRole("button", { name: /Source \(ZIP\)/ }).click();
        await expect(page.getByText("Project downloaded successfully").first()).toBeVisible({
          timeout: 30_000,
        });
        const download = await downloadPromise;
        expect(download.suggestedFilename().toLowerCase().endsWith(".zip")).toBeTruthy();
        await closeMenuSettingsSheet(sheet);
      });

      await test.step("Copy Project → 跳转副本 IDE", async () => {
        const sheet = await openMenuSettingsSheet(page);
        await sheet.getByRole("button", { name: "Copy Project", exact: true }).click();
        await expect(
          page.getByText("Project copied successfully, jump to the new project").first(),
        ).toBeVisible({ timeout: 60_000 });
        await page.waitForURL(/\/projects\/[^/]+\/?$/i, { timeout: 60_000 });
        chapter20Context.menuCopyProjectName = `${projectName}-copy`;
      });

      await test.step("返回原项目并配置 Git remote", async () => {
        await openModelingProjectIdeByUuid(page, sourceUuid);
        await configureGitRemoteInProjectSettings(page, E2E_GIT_SYNC_REPO_URL, sourceUuid);
      });

      await test.step("Sync Push To Remote", async () => {
        await clickMenuSyncPush(page);
      });

      await test.step("Sync Pull From Remote", async () => {
        await clickMenuSyncPull(page);
      });
    });
  });

  test.describe("20.2 通过 Menu Settings 进行更多设置", () => {
    test.setTimeout(180_000);

    test("20.2 通过 Menu Settings 进行更多设置", async ({ page }) => {
      await enterModelingProjectIdeForChapter20(page);
      await openLeafFile(page, ["README.md"]);
      await expect(visibleCmContent(page)).toBeVisible({ timeout: 30_000 });

      await test.step("Theme → Dark", async () => {
        const sheet = await openMenuSettingsSheet(page);
        await selectMenuEditorTheme(sheet, page, "Dark");
      });

      await test.step("Font Size / Tab Size / Line Numbers / Word Wrap", async () => {
        const sheet = await openMenuSettingsSheet(page);
        await setMenuLineNumbersEnabled(sheet, false);
        await fillMenuNumberSetting(sheet, "fontSize", 16);
        await fillMenuNumberSetting(sheet, "tabSize", 4);
        await closeMenuSettingsSheet(sheet);
      });

      await test.step("编辑器即时生效", async () => {
        await expect(page.locator("html")).toHaveAttribute("data-ide-theme-mode", "dark");
        await expectEditorLineNumbersInStorage(page, false);
        await expectActiveEditorLineNumbers(page, false);
      });

      await test.step("（可选）Reset All Editor Settings", async () => {
        const sheet2 = await openMenuSettingsSheet(page);
        const resetBtn = sheet2.getByRole("button", { name: "Reset All Editor Settings", exact: true });
        await resetBtn.scrollIntoViewIfNeeded();
        await resetBtn.click();
        await expect(page.getByText("Editor settings reset to defaults").first()).toBeVisible({
          timeout: 15_000,
        });
        await closeMenuSettingsSheet(sheet2);
      });
    });
  });

  test.describe("20.3 通过 Menu LaTeX 进行更多设置", () => {
    test.setTimeout(600_000);

    test("20.3 通过 Menu LaTeX 进行更多设置", async ({ page }) => {
      await enterModelingProjectIdeForChapter20(page);

      await test.step("上传 .tex 夹具", async () => {
        await uploadTexFixtureForChapter20(page);
      });

      await test.step("Menu → LaTeX 设置", async () => {
        const sheet = await openMenuSettingsSheet(page);
        await sheet.getByText("LaTeX", { exact: true }).scrollIntoViewIfNeeded();

        const mainDocTrigger = sheet.locator("#main-document-selector");
        if (await mainDocTrigger.isVisible().catch(() => false)) {
          await mainDocTrigger.click();
          await page.getByRole("option").first().click();
          await expect(page.getByText("Updated main document").first()).toBeVisible({
            timeout: 30_000,
          });
        }

        const compiler = await selectMenuLaTeXCompilerDifferent(page, sheet);
        await expect(page.getByText("Updated LaTeX compiler").first()).toBeVisible({
          timeout: 30_000,
        });
        expect(compiler.length).toBeGreaterThan(0);
        await closeMenuSettingsSheet(sheet);
      });

      await test.step("Compile → PDF 预览", async () => {
        await openLeafFile(page, ["test_upload.tex"]);
        await expect(visibleCmContent(page)).toContainText(/\\documentclass/i, {
          timeout: 30_000,
        });
        await compileTexAndExpectPdfCanvas(page);
      });
    });
  });

  test.describe("20.4 项目修改历史查看、checkout", () => {
    test.setTimeout(300_000);

    test("20.4 项目修改历史查看、checkout", async ({ page }) => {
      await enterModelingProjectIdeForChapter20(page);
      const marker = `E2E_CH20_HIST_${Date.now()}`;

      await test.step("编辑 README 产生快照", async () => {
        await openLeafFile(page, ["README.md"]);
        await appendLineToVisibleEditor(page, marker);
      });

      await test.step("History → Diff → Checkout", async () => {
        const dialog = await openProjectHistoryDialog(page);
        const snapshotButtons = dialog.locator("ul.space-y-1 button");
        await expect
          .poll(async () => snapshotButtons.count(), { timeout: 120_000, intervals: [1_000, 2_000, 4_000] })
          .toBeGreaterThanOrEqual(2);

        const count = await snapshotButtons.count();
        await snapshotButtons.nth(count - 1).click();

        const changedFile = dialog
          .locator("button")
          .filter({ hasText: /README\.md/i })
          .first();
        await expect(changedFile).toBeVisible({ timeout: 30_000 });
        await changedFile.click();
        await expect(dialog.getByText("Diff").first()).toBeVisible();

        await dialog.getByRole("button", { name: "Checkout This Snapshot", exact: true }).click();
        await expect(page.getByText("Checked out snapshot").first()).toBeVisible({
          timeout: 120_000,
        });
        await expect(dialog).toBeHidden({ timeout: 30_000 });
      });

      await test.step("Explore 核对回滚", async () => {
        await openLeafFile(page, ["README.md"]);
        await expect(visibleCmContent(page)).not.toContainText(marker, { timeout: 30_000 });
      });
    });
  });
});
