import { expect, test, type Locator } from "@playwright/test";

import { absUrl } from "../common/global-setup";

import {
  bulkArchiveAndPermanentlyDeleteAllMyProjectsOnProjectsPage,
  countProjectsTableRowsWhenReady,
  navigateToHomeProjects,
  projectsListBatchToolbar,
  projectsTabPanel,
  projectsTableDataRowsInTabPanel,
  waitForMyProjectsTableRows,
} from "./helpers";

/**
 * **用户场景 §13**：查看项目列表并管理项目（见 `docs/用户场景.md`）。
 * 覆盖：工作台 Projects 四标签、**My Projects** 列表（**不按关键字搜索**；仅在数行/点行前 **`fill("")` 清空残留筛选**，避免误 skip）、点击项目名进入 IDE、行内 Setup/Settings/Download/Copy/Rename/Archive、多选批量栏。（**13.1 不新建项目**，依赖账号在 **My Projects** 下已有至少一个自有项目，由其它用例创建。）
 * **13.1** 不对单条项目确认归档/删除；**13.2** 固定执行：对 **My Projects** 下当前账号 **全部自有项目** **全选 → 归档 → 在「Archived」中永久删除**（见 `bulkArchiveAndPermanentlyDeleteAllMyProjectsOnProjectsPage`），并断言 **My Projects** 表格数据行为 0。
 *
 * 有界面调试：Playwright 使用 **`--headed`**（没有 `--head`）。例如：
 * `pnpm run test:13:headed`，或
 * `npx playwright test --config common/playwright.config.ts test/13-project-list.test.ts --headed`。
 */
/** 列表数据行内指向 IDE 的项目名链接（排除行内 Setup/Settings 等）。 */
async function projectDisplayNameFromListRow(row: Locator): Promise<string> {
  const links = row.getByRole("link");
  const n = await links.count();
  const skip = new Set(["Setup", "Settings"]);
  for (let i = 0; i < n; i++) {
    const t = ((await links.nth(i).textContent()) ?? "").trim();
    if (t && !skip.has(t)) {
      return t;
    }
  }
  return "";
}

test.describe("13. 项目列表查看及管理", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240_000);

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

  test("13.1 四标签与行内操作", async ({ page }) => {
    let projectName = "";
    await test.step("工作台 Projects：四标签与搜索框可见", async () => {
      await navigateToHomeProjects(page);
      await expect(page.getByRole("tab", { name: "All Projects" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "My Projects" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Shared with Me" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Archived Projects" })).toBeVisible();

      const panelAll = projectsTabPanel(page, "All Projects");
      await expect(panelAll.getByPlaceholder("Search projects...")).toBeVisible();
      await expect(panelAll.getByRole("columnheader", { name: "Project", exact: true })).toBeVisible();

      await page.getByRole("tab", { name: "Shared with Me" }).click();
      await expect(projectsTabPanel(page, "Shared with Me").getByPlaceholder("Search projects...")).toBeVisible();

      await page.getByRole("tab", { name: "Archived Projects" }).click();
      await expect(projectsTabPanel(page, "Archived Projects").getByPlaceholder("Search projects...")).toBeVisible();

      await page.getByRole("tab", { name: "All Projects" }).click();
    });

    await test.step("返回列表：My Projects 列表非空与行内操作", async () => {
      await page.goto(absUrl("/"), { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible({ timeout: 30_000 });
      await page.getByRole("tab", { name: "My Projects" }).click();

      const panel = projectsTabPanel(page, "My Projects");
      const rowCount = await waitForMyProjectsTableRows(panel)
        .then((n) => n)
        .catch(() => 0);
      if (rowCount === 0) {
        test.skip(
          true,
          "My Projects 无自有项目：13.1 不新建项目，请先运行其它用例在本账号下创建至少一个项目。",
        );
      }
      const rows = projectsTableDataRowsInTabPanel(panel);
      const firstRow = rows.first();
      projectName = (await projectDisplayNameFromListRow(firstRow)).trim();
      expect(projectName.length).toBeGreaterThan(0);

      await expect(firstRow).toBeVisible({ timeout: 30_000 });
      await expect(firstRow.getByRole("link", { name: "Setup", exact: true })).toBeVisible();
      await expect(firstRow.getByRole("link", { name: "Settings", exact: true })).toBeVisible();
      await expect(firstRow.getByRole("button", { name: "Download", exact: true })).toBeVisible();
      await expect(firstRow.getByRole("button", { name: "Copy", exact: true })).toBeVisible();
      await expect(firstRow.getByRole("button", { name: "Rename", exact: true })).toBeVisible();
      await expect(firstRow.getByRole("button", { name: "Archive", exact: true })).toBeVisible();
    });

    await test.step("Rename 对话框打开后取消", async () => {
      const row = projectsTableDataRowsInTabPanel(projectsTabPanel(page, "My Projects")).first();
      await row.getByRole("button", { name: "Rename", exact: true }).click();
      await expect(page.getByRole("dialog").getByText("Rename project")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10_000 });
    });

    await test.step("多选后出现批量栏（不确认归档）", async () => {
      const row = projectsTableDataRowsInTabPanel(projectsTabPanel(page, "My Projects")).first();
      await row.getByRole("checkbox", { name: `Select project ${projectName}` }).click();
      await expect(page.getByText("Selected 1", { exact: true })).toBeVisible({ timeout: 10_000 });
      const myPanel = projectsTabPanel(page, "My Projects");
      await expect(
        projectsListBatchToolbar(myPanel).getByRole("button", { name: "Archive", exact: true }),
      ).toBeEnabled();

      await row.getByRole("checkbox", { name: `Select project ${projectName}` }).click();
      await expect(page.getByText("Selected 1", { exact: true })).toBeHidden({ timeout: 10_000 });
    });

    await test.step("点击项目名进入 IDE", async () => {
      const row = projectsTableDataRowsInTabPanel(projectsTabPanel(page, "My Projects")).first();
      await row.getByRole("link", { name: projectName, exact: true }).click();
      await page.waitForURL(/\/projects\/[^/]+\/?$/i, { timeout: 60_000 });
      await expect(page.getByTitle("Create New File")).toBeVisible({ timeout: 30_000 });
    });

    await test.step("行内 Settings 进入设置页", async () => {
      await page.goto(absUrl("/"), { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible({ timeout: 30_000 });
      await page.getByRole("tab", { name: "My Projects" }).click();
      const panel = projectsTabPanel(page, "My Projects");
      await expect(panel.getByPlaceholder("Search projects...")).toBeVisible({ timeout: 30_000 });
      await panel.getByPlaceholder("Search projects...").fill("");
      const row = projectsTableDataRowsInTabPanel(panel).first();
      await expect(row).toBeVisible({ timeout: 30_000 });
      await row.getByRole("link", { name: "Settings", exact: true }).click();
      await expect(page).toHaveURL(/\/projects\/[^/]+\/settings/i, { timeout: 30_000 });
    });
  });

  test("13.2 删除MyProjects所有项目", async ({ page }) => {
    test.setTimeout(600_000);
    await test.step("My Projects：全选 → Archive → 确认（若有）→ Archived：全选 → Delete → 确认", async () => {
      await bulkArchiveAndPermanentlyDeleteAllMyProjectsOnProjectsPage(page);
    });

    await test.step("My Projects：列表无数据行", async () => {
      // bulkArchive 已在 `/` 上切换 My Projects 并 count=0；勿再 goto/reload（iipe 删除后 updateProjectsCache 已更新 SWR，且 WSL→beta 易 ERR_CONNECTION_CLOSED）。
      await page.getByRole("tab", { name: "My Projects" }).click();
      const panel = projectsTabPanel(page, "My Projects");
      const left = await countProjectsTableRowsWhenReady(panel);
      expect(left).toBe(0);
    });
  });
});
