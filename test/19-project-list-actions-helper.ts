import { expect, type Locator, type Page } from "@playwright/test";

import {
  createModelingProjectAndEnterIde,
  createTheoremProvingProjectWithoutMathlib,
  NEW_PROJECT_CH18_TOOLCHAIN_SKIP_MSG,
  waitForProjectIdeShell,
} from "./18-new-project-helper";
import {
  navigateToHomeProjects,
  projectsTabPanel,
  projectsTableDataRowsInTabPanel,
} from "./helpers";

export { NEW_PROJECT_CH18_TOOLCHAIN_SKIP_MSG };

/** 章节内共享：建模项目名（19.2～19.7 主项目）。 */
export const chapter19Context: {
  modelingProjectName?: string;
  theoremProjectName?: string;
  copyProjectName?: string;
} = {};

export async function openMyProjectsTab(page: Page): Promise<Locator> {
  await navigateToHomeProjects(page);
  await page.getByRole("tab", { name: "My Projects" }).click();
  const panel = projectsTabPanel(page, "My Projects");
  await expect(panel.getByPlaceholder("Search projects...")).toBeVisible({ timeout: 30_000 });
  await panel.getByPlaceholder("Search projects...").fill("");
  return panel;
}

export async function openArchivedProjectsTab(page: Page): Promise<Locator> {
  await navigateToHomeProjects(page);
  await page.getByRole("tab", { name: "Archived Projects" }).click();
  const panel = projectsTabPanel(page, "Archived Projects");
  await expect(panel.getByPlaceholder("Search projects...")).toBeVisible({ timeout: 30_000 });
  await panel.getByPlaceholder("Search projects...").fill("");
  return panel;
}

export function projectRowInPanel(panel: Locator, projectName: string): Locator {
  return projectsTableDataRowsInTabPanel(panel).filter({ hasText: projectName }).first();
}

export async function waitForProjectRow(panel: Locator, projectName: string): Promise<Locator> {
  const row = projectRowInPanel(panel, projectName);
  await expect(row).toBeVisible({ timeout: 120_000 });
  return row;
}

function isCorruptedChapter19ProjectName(name: string | undefined): boolean {
  return Boolean(name && /github\.com/i.test(name));
}

export async function ensureModelingProjectForChapter19(page: Page): Promise<string> {
  if (chapter19Context.modelingProjectName && !isCorruptedChapter19ProjectName(chapter19Context.modelingProjectName)) {
    return chapter19Context.modelingProjectName;
  }
  if (isCorruptedChapter19ProjectName(chapter19Context.modelingProjectName)) {
    chapter19Context.modelingProjectName = undefined;
  }
  const name = `e2e_pl19_mod_${Date.now()}`;
  const ok = await createModelingProjectAndEnterIde(page, name);
  expect(ok, "§19：创建 Modeling 夹具项目失败").toBeTruthy();
  chapter19Context.modelingProjectName = name;
  return name;
}

export async function ensureTheoremProjectForChapter19(page: Page): Promise<string | null> {
  if (chapter19Context.theoremProjectName) {
    return chapter19Context.theoremProjectName;
  }
  const name = `e2e_pl19_tp_${Date.now()}`;
  const ok = await createTheoremProvingProjectWithoutMathlib(page, name);
  if (!ok) {
    return null;
  }
  chapter19Context.theoremProjectName = name;
  return name;
}

export async function waitForSetupCompletePage(page: Page, timeoutMs = 600_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await page.getByRole("heading", { name: "Project setup complete" }).isVisible().catch(() => false)) {
      return;
    }
    const onStages =
      (await page.getByText("Toolchain", { exact: true }).isVisible().catch(() => false)) ||
      (await page.getByText("Packages", { exact: true }).isVisible().catch(() => false)) ||
      (await page.getByText("Cache", { exact: true }).isVisible().catch(() => false));
    if (onStages) {
      await page.waitForTimeout(2_000);
      continue;
    }
    await page.waitForTimeout(1_000);
  }
  await expect(page.getByRole("heading", { name: "Project setup complete" })).toBeVisible({
    timeout: 5_000,
  });
}

export async function openProjectSettingsFromRow(page: Page, row: Locator): Promise<void> {
  await row.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/settings/i, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

export async function openProjectAgentFromRow(page: Page, row: Locator): Promise<void> {
  await row.getByRole("link", { name: "Agent", exact: true }).click();
  await page.waitForURL(/\/projects\/[^/]+\/agent\/?$/i, { timeout: 60_000 });
}

function agentRightPanel(page: Page): Locator {
  return page
    .getByRole("button", { name: /Hide Right Panel|Show Right Panel/ })
    .locator("xpath=ancestor::div[contains(@class,'border-l')][1]");
}

async function isAgentFileTreeToggleActive(toggle: Locator): Promise<boolean> {
  return toggle
    .evaluate((el) => /border-indigo|bg-sidebar-accent/.test(el.className))
    .catch(() => false);
}

/** Agent 全屏页右栏默认 **Activity**；切到 **Files** 后等待 `@reaslab/file-tree`（无 `.ide-filetree` 包裹）。 */
export async function openAgentProjectFileTree(page: Page): Promise<Locator> {
  const filesTab = page.getByRole("button", { name: "Files", exact: true });
  await expect(filesTab).toBeVisible({ timeout: 30_000 });
  await filesTab.click();

  const rightPanel = agentRightPanel(page);
  await expect(rightPanel.locator("div.flex.h-8.shrink-0.items-center.border-b")).toBeVisible({
    timeout: 15_000,
  });

  const filesToggle = rightPanel.locator("div.flex.h-8.shrink-0.items-center.border-b button").first();
  const tree = page.getByTestId("file-tree-root-area").first();

  if (!(await tree.isVisible().catch(() => false))) {
    const toggleActive = await isAgentFileTreeToggleActive(filesToggle);
    // 已 active 时勿再点 Files 切换钮——会折叠侧栏（`toggleFileTree` 在 filetree ↔ null 间切换）。
    if (!toggleActive && (await filesToggle.isVisible().catch(() => false))) {
      await filesToggle.click();
    }
  }

  await expect(tree).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("row").first()).toBeVisible({ timeout: 30_000 });
  return tree;
}

/** General Settings card (Name / Git / LaTeX rows). */
function projectGeneralSettingsGroup(page: Page) {
  return page
    .getByRole("heading", { name: "General Settings", exact: true })
    .locator("xpath=following-sibling::div[1]");
}

/**
 * **`components/settings/index.tsx`** `SettingsItem`：左侧 label，右侧 `div.ml-auto` 放控件。
 * 勿用「含某 label 文本的任意 div + input.first()」——会命中整个 `SettingsGroup`，始终取到 **Name** 输入框。
 */
function projectSettingsItemRow(page: Page, label: string) {
  return projectGeneralSettingsGroup(page)
    .locator("div.flex.flex-row")
    .filter({
      has: page.getByText(label, { exact: true }),
    });
}

export function projectSettingsTextInput(page: Page, label: string) {
  return projectSettingsItemRow(page, label).locator("div.ml-auto input").first();
}

export function projectSettingsSelectTrigger(page: Page, label: string) {
  return projectSettingsItemRow(page, label)
    .locator('div.ml-auto [data-slot="select-trigger"], div.ml-auto button[role="combobox"]')
    .first();
}

/** Git remote URL 输入框默认 `readOnly`，须先 focus（`settings._index.tsx` onFocus 移除 readonly）。 */
export async function fillProjectSettingsTextInput(
  page: Page,
  label: string,
  value: string,
): Promise<void> {
  const input = projectSettingsTextInput(page, label);
  await expect(input).toBeVisible({ timeout: 15_000 });
  await input.click();
  await input.fill(value);
  await input.press("Tab");
}

/** Pick a LaTeX compiler option different from the current value. */
export async function selectDifferentLaTeXCompiler(page: Page): Promise<string> {
  const trigger = projectSettingsSelectTrigger(page, "LaTeX compiler");
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  const current = (await trigger.innerText()).trim();
  await trigger.click();
  const options = page.getByRole("option");
  await expect(options.first()).toBeVisible({ timeout: 10_000 });
  const count = await options.count();
  for (let i = 0; i < count; i++) {
    const option = options.nth(i);
    const text = (await option.innerText()).trim();
    if (text && text !== current) {
      await option.click();
      return text;
    }
  }
  throw new Error(`No LaTeX compiler option differs from current "${current}"`);
}
