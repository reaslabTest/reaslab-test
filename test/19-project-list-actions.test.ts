import { expect, test } from "@playwright/test";

import { waitForProjectIdeShell } from "./18-new-project-helper";
import {
  chapter19Context,
  ensureModelingProjectForChapter19,
  ensureTheoremProjectForChapter19,
  NEW_PROJECT_CH18_TOOLCHAIN_SKIP_MSG,
  openArchivedProjectsTab,
  openMyProjectsTab,
  openProjectAgentFromRow,
  openAgentProjectFileTree,
  openProjectSettingsFromRow,
  fillProjectSettingsTextInput,
  selectDifferentLaTeXCompiler,
  projectRowInPanel,
  waitForProjectRow,
  waitForSetupCompletePage,
} from "./19-project-list-actions-helper";
import { openLeafFile, waitForFileTree } from "./helpers";

/**
 * **用户场景 §19**：项目列表行内 **Actions**（见 `docs/用户场景.md`）。
 * 依赖 **§18** 或本章夹具在 **My Projects** 下创建项目；全量跑时位于 **§13.2** 清空之前。
 *
 * 单文件调试：**`pnpm run test:19:headed`**。
 */
test.describe("19. 项目列表行内操作", () => {
  test.describe.configure({ mode: "serial" });

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

  test.describe("19.1 通过 Setup 设置项目依赖", () => {
    test.setTimeout(900_000);

    test("19.1 通过 Setup 设置项目依赖", async ({ page }) => {
      const theoremName = await ensureTheoremProjectForChapter19(page);
      test.skip(!theoremName, NEW_PROJECT_CH18_TOOLCHAIN_SKIP_MSG);

      await test.step("列表 Actions → Setup → 等待完成", async () => {
        const panel = await openMyProjectsTab(page);
        await waitForProjectRow(panel, theoremName!);
        const row = projectRowInPanel(panel, theoremName!);
        await row.getByRole("link", { name: "Setup", exact: true }).click();
        await expect(page).toHaveURL(/\/projects\/[^/]+\/setup\/?$/i, { timeout: 60_000 });
        await waitForSetupCompletePage(page, 600_000);
        await expect(page.getByRole("heading", { name: "Project setup complete" })).toBeVisible();
      });

      await test.step("Open Project 进入 IDE", async () => {
        await page.getByRole("link", { name: "Open Project" }).click();
        await waitForProjectIdeShell(page, 120_000);
      });
    });
  });

  test.describe("19.2 通过 Settings 设置项目基础信息", () => {
    test.setTimeout(180_000);

    test("19.2 通过 Settings 设置项目基础信息", async ({ page }) => {
      const projectName = await ensureModelingProjectForChapter19(page);
      const renamed = `${projectName}_set`;

      await test.step("Actions → Settings → General", async () => {
        const panel = await openMyProjectsTab(page);
        const row = await waitForProjectRow(panel, projectName);
        await openProjectSettingsFromRow(page, row);
        await expect(page.getByRole("heading", { name: "General Settings" })).toBeVisible({
          timeout: 30_000,
        });
        await expect(page.getByText("Git remote URL", { exact: true })).toBeVisible();
        await expect(page.getByText("LaTeX compiler", { exact: true })).toBeVisible();

        await fillProjectSettingsTextInput(page, "Name", renamed);
        await expect(page.getByText("Project name saved").first()).toBeVisible({ timeout: 30_000 });
        chapter19Context.modelingProjectName = renamed;

        const gitUrl = "https://github.com/leanprover-community/mathlib4.git";
        await fillProjectSettingsTextInput(page, "Git remote URL", gitUrl);
        await expect(page.getByText("Git remote URL saved").first()).toBeVisible({ timeout: 30_000 });

        const optionText = await selectDifferentLaTeXCompiler(page);
        await expect(page.getByText(new RegExp(`LaTeX compiler set to ${optionText}`, "i")).first()).toBeVisible({
          timeout: 30_000,
        });
      });

      await test.step("Collaborators 标签", async () => {
        await page.getByRole("link", { name: "Collaborators", exact: true }).click();
        await expect(page).toHaveURL(/\/settings\/collaborators/i, { timeout: 30_000 });
        await expect(page.getByRole("heading", { name: "Collaborators Settings" })).toBeVisible({
          timeout: 30_000,
        });
        await expect(page.getByText("Owner:", { exact: false }).first()).toBeVisible();
      });
    });
  });

  test.describe("19.3 通过 Download 下载项目", () => {
    test.setTimeout(180_000);

    test("19.3 通过 Download 下载项目", async ({ page }) => {
      const projectName = await ensureModelingProjectForChapter19(page);

      await test.step("Actions → Download → 保存 zip", async () => {
        const panel = await openMyProjectsTab(page);
        const row = await waitForProjectRow(panel, projectName);
        const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
        await row.getByRole("button", { name: "Download", exact: true }).click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toBe(`${projectName}.zip`);
      });
    });
  });

  test.describe("19.4 通过 Copy 复制项目", () => {
    test.setTimeout(180_000);

    test("19.4 通过 Copy 复制项目", async ({ page }) => {
      const projectName = await ensureModelingProjectForChapter19(page);
      const copyName = `${projectName}-copy`;

      await test.step("Actions → Copy → 列表出现 -copy 项目", async () => {
        const panel = await openMyProjectsTab(page);
        const row = await waitForProjectRow(panel, projectName);
        await row.getByRole("button", { name: "Copy", exact: true }).click();
        await expect
          .poll(
            async () => {
              await panel.getByPlaceholder("Search projects...").fill(copyName);
              return projectRowInPanel(panel, copyName).isVisible().catch(() => false);
            },
            { timeout: 120_000 },
          )
          .toBe(true);
        chapter19Context.copyProjectName = copyName;
      });

      await test.step("进入副本 IDE 核对文件树", async () => {
        const panel = await openMyProjectsTab(page);
        const copyRow = await waitForProjectRow(panel, copyName);
        await copyRow.getByRole("link", { name: copyName, exact: true }).click();
        await page.waitForURL(/\/projects\/[^/]+\/?$/i, { timeout: 60_000 });
        await waitForFileTree(page);
        await openLeafFile(page, ["README.md"]);
        await expect(page.locator(".cm-content").filter({ visible: true }).first()).toContainText(
          /./,
          { timeout: 30_000 },
        );
      });
    });
  });

  test.describe("19.5 通过 Rename 重命名项目", () => {
    test.setTimeout(180_000);

    test("19.5 通过 Rename 重命名项目", async ({ page }) => {
      const sourceName = chapter19Context.copyProjectName;
      expect(sourceName, "§19.5 依赖 §19.4 副本项目").toBeTruthy();
      const newName = `e2e_pl19_ren_${Date.now()}`;

      await test.step("Actions → Rename → 确认", async () => {
        const panel = await openMyProjectsTab(page);
        const row = await waitForProjectRow(panel, sourceName!);
        await row.getByRole("button", { name: "Rename", exact: true }).click();
        await expect(page.getByRole("dialog").getByText("Rename project")).toBeVisible();
        const input = page.getByRole("dialog").locator("input").first();
        await input.fill(newName);
        await page.getByRole("dialog").getByRole("button", { name: "Rename", exact: true }).click();
        await expect(page.getByRole("dialog")).toBeHidden({ timeout: 30_000 });
        chapter19Context.copyProjectName = newName;
      });

      await test.step("列表名更新", async () => {
        const panel = await openMyProjectsTab(page);
        await panel.getByPlaceholder("Search projects...").fill(newName);
        await expect(projectRowInPanel(panel, newName)).toBeVisible({ timeout: 60_000 });
      });
    });
  });

  test.describe("19.6 通过 Agent 使用 AI", () => {
    test.setTimeout(180_000);

    test("19.6 通过 Agent 使用 AI", async ({ page }) => {
      const projectName = await ensureModelingProjectForChapter19(page);

      await test.step("Actions → Agent → 全屏 ReasLingo", async () => {
        const panel = await openMyProjectsTab(page);
        const row = await waitForProjectRow(panel, projectName);
        await openProjectAgentFromRow(page, row);
        await expect(page.getByText("ReasLingo", { exact: true }).first()).toBeVisible({
          timeout: 60_000,
        });
      });

      await test.step("文件树可见项目文件", async () => {
        const tree = await openAgentProjectFileTree(page);
        await expect(tree.getByText("README.md").first()).toBeVisible({
          timeout: 30_000,
        });
      });

      await test.step("Switch to Editor Mode 返回 IDE", async () => {
        await page.getByRole("button", { name: "Editor", exact: true }).click();
        await page.waitForURL(/\/projects\/[^/]+\/?$/i, { timeout: 60_000 });
        await expect(page.getByTitle("Create New File")).toBeVisible({ timeout: 60_000 });
      });
    });
  });

  test.describe("19.7 项目归档", () => {
    test.setTimeout(180_000);

    test("19.7 项目归档", async ({ page }) => {
      const projectName = await ensureModelingProjectForChapter19(page);

      await test.step("Actions → Archive → 确认", async () => {
        const panel = await openMyProjectsTab(page);
        const row = await waitForProjectRow(panel, projectName);
        await row.getByRole("button", { name: "Archive", exact: true }).click();
        const archiveDialog = page.getByRole("alertdialog");
        await expect(archiveDialog.getByRole("heading", { name: "Archive project?" })).toBeVisible();
        await archiveDialog.getByRole("button", { name: "Archive", exact: true }).click();
        await expect(archiveDialog).toBeHidden({ timeout: 30_000 });
      });

      await test.step("My Projects 中不再显示", async () => {
        const panel = await openMyProjectsTab(page);
        await panel.getByPlaceholder("Search projects...").fill(projectName);
        await expect(projectRowInPanel(panel, projectName)).toBeHidden({ timeout: 60_000 });
      });
    });
  });

  test.describe("19.8 项目复原", () => {
    test.setTimeout(180_000);

    test("19.8 项目复原", async ({ page }) => {
      const projectName = chapter19Context.modelingProjectName;
      expect(projectName, "§19.8 依赖 §19.7 已归档项目").toBeTruthy();

      await test.step("Archived Projects → Restore", async () => {
        const panel = await openArchivedProjectsTab(page);
        const row = await waitForProjectRow(panel, projectName!);
        await row.getByRole("button", { name: "Restore", exact: true }).click();
      });

      await test.step("My Projects 中恢复可见", async () => {
        const panel = await openMyProjectsTab(page);
        await panel.getByPlaceholder("Search projects...").fill(projectName!);
        await expect(projectRowInPanel(panel, projectName!)).toBeVisible({ timeout: 60_000 });
      });
    });
  });
});
