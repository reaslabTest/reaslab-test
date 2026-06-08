import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, type Locator, type Page } from "@playwright/test";

import { absUrl } from "../common/global-setup";
import {
  compileTexAndExpectPdfCanvas,
  createModelingProjectAndEnterIde,
  visibleCmContent,
  waitForProjectIdeShell,
} from "./18-new-project-helper";
import {
  chapter19Context,
  openMyProjectsTab,
  waitForProjectRow,
} from "./19-project-list-actions-helper";
import {
  manualImportGitAndEnterIde,
  openLeafFile,
  uploadSingleFileViaExploreUploadDialog,
  waitForFileTree,
} from "./helpers";

export { visibleCmContent, compileTexAndExpectPdfCanvas };

export const TEST_UPLOAD_TEX = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "data",
  "test_upload.tex",
);

/** §20.1 Push/Pull 默认仓库（可用 **`E2E_GIT_SYNC_REPO_URL`** 覆盖）。 */
export const E2E_GIT_SYNC_REPO_URL =
  process.env.E2E_GIT_SYNC_REPO_URL?.trim() ||
  "https://github.com/reaslabTest/test_beta_project.git";

export const chapter20Context: {
  projectName?: string;
  /** §20.1 Git 导入后的 uuid；勿与 Modeling 夹具混用。 */
  projectUuid?: string;
  /** §20 Modeling 夹具 uuid；20.2～20.4 应优先用此直达 IDE。 */
  modelingProjectUuid?: string;
  menuCopyProjectName?: string;
} = {};

function isCorruptedProjectName(name: string | undefined): boolean {
  return Boolean(name && /github\.com/i.test(name));
}

/** 全量跑时复用 §19 建模夹具；单跑本章时自动新建项目。 */
export async function ensureModelingProjectForChapter20(page: Page): Promise<string> {
  const from19 = chapter19Context.modelingProjectName;
  if (from19 && !isCorruptedProjectName(from19)) {
    chapter20Context.projectName = from19;
    return from19;
  }
  if (chapter20Context.projectName && !isCorruptedProjectName(chapter20Context.projectName)) {
    return chapter20Context.projectName;
  }
  const name = `e2e_pl20_mod_${Date.now()}`;
  const ok = await createModelingProjectAndEnterIde(page, name);
  expect(ok, "§20：创建 Modeling 夹具项目失败").toBeTruthy();
  chapter20Context.projectName = name;
  chapter20Context.modelingProjectUuid = projectUuidFromUrl(page);
  return name;
}

function isOnProjectIdeUrl(page: Page, projectUuid?: string): boolean {
  const m = page.url().match(/\/projects\/([^/]+)\/?$/i);
  if (!m?.[1]) {
    return false;
  }
  return projectUuid ? m[1] === projectUuid : true;
}

/** 用 uuid 直达 IDE，避免列表里 `{name}-copy` 与 `{name}` 的 `hasText` 误匹配。 */
export async function openModelingProjectIdeByUuid(page: Page, projectUuid: string): Promise<void> {
  if (isOnProjectIdeUrl(page, projectUuid) && (await page.getByTitle("Create New File").isVisible().catch(() => false))) {
    await waitForFileTree(page);
    return;
  }
  await page.goto(absUrl(`/projects/${projectUuid}`), { waitUntil: "domcontentloaded" });
  await waitForProjectIdeShell(page, 120_000);
  chapter20Context.projectUuid = projectUuid;
  chapter20Context.modelingProjectUuid = projectUuid;
}

export async function enterModelingProjectIdeForChapter20(page: Page): Promise<void> {
  const projectName = await ensureModelingProjectForChapter20(page);
  if (chapter20Context.modelingProjectUuid) {
    await openModelingProjectIdeByUuid(page, chapter20Context.modelingProjectUuid);
    return;
  }
  if (
    isOnProjectIdeUrl(page) &&
    (await page.getByTitle("Create New File").isVisible().catch(() => false))
  ) {
    const uuid = projectUuidFromUrl(page);
    chapter20Context.projectUuid = uuid;
    chapter20Context.modelingProjectUuid = uuid;
    await waitForFileTree(page);
    return;
  }
  const panel = await openMyProjectsTab(page);
  await panel.getByPlaceholder("Search projects...").fill(projectName);
  const row = await waitForProjectRow(panel, projectName);
  const nameLink = row.getByTestId("project-name-link");
  await expect(nameLink).toHaveText(projectName, { timeout: 30_000 });
  await nameLink.click();
  await page.waitForURL(/\/projects\/[^/]+\/?$/i, { timeout: 60_000 });
  await waitForProjectIdeShell(page, 120_000);
  const uuid = projectUuidFromUrl(page);
  chapter20Context.projectUuid = uuid;
  chapter20Context.modelingProjectUuid = uuid;
}

export function projectUuidFromUrl(page: Page): string {
  const m = page.url().match(/\/projects\/([^/]+)/i);
  expect(m?.[1], "当前 URL 应处于 /projects/:uuid").toBeTruthy();
  return m![1]!;
}

/** `ProjectEditorSettingsDrawer` 左侧 Sheet（`settings-drawer.tsx` → `data-slot="sheet-content"`）。 */
export function menuSettingsSheetLocator(page: Page): Locator {
  return page
    .locator('[data-slot="sheet-content"][data-side="left"]')
    .filter({ has: page.getByRole("heading", { name: "Download", exact: true }) });
}

/** 顶栏 **Menu** 抽屉；**勿在已打开时再次点击 Menu**（`SheetTrigger` 会 toggle 关闭）。 */
export async function openMenuSettingsSheet(page: Page): Promise<Locator> {
  const sheet = menuSettingsSheetLocator(page);
  if (!(await sheet.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Menu", exact: true }).click();
  }
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  await expect(sheet.getByRole("heading", { name: "Actions", exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(sheet.getByRole("heading", { name: "Settings", exact: true })).toBeVisible({
    timeout: 15_000,
  });
  return sheet;
}

export async function closeMenuSettingsSheet(sheet: Locator): Promise<void> {
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden({ timeout: 10_000 });
}

/** 当前 README 等文件所在 tabpanel 内的 CodeMirror（避免误匹配其他 `.cm-editor`）。 */
export function activeFileTabEditor(page: Page): Locator {
  return page
    .getByRole("tabpanel")
    .filter({ has: page.locator(".cm-editor") })
    .locator(".cm-editor")
    .first();
}

/** `NumberSetting`：`Label htmlFor` + `onBlur` 提交（`settings-drawer.tsx`）。 */
export async function fillMenuNumberSetting(
  sheet: Locator,
  inputId: "fontSize" | "tabSize",
  value: number,
): Promise<void> {
  const label = inputId === "fontSize" ? "Font Size" : "Tab Size";
  const input = sheet.getByLabel(label, { exact: true });
  await expect(input).toBeVisible({ timeout: 15_000 });
  if ((await input.inputValue()) === String(value)) {
    return;
  }
  await input.fill(String(value));
  await input.evaluate((el) => (el as HTMLInputElement).blur());
  await expect(input).toHaveValue(String(value));
}

/** Menu Settings → Theme（`ideThemeModeAtom` → `editor-theme-root` 写 `html[data-ide-theme-mode]`）。 */
export async function selectMenuEditorTheme(
  sheet: Locator,
  page: Page,
  theme: "Dark" | "Light",
): Promise<void> {
  const themeTrigger = sheet.locator("#editorTheme");
  await themeTrigger.click();
  const option = page
    .getByRole("option", { name: theme, exact: true })
    .or(page.locator('[data-slot="select-item"]').filter({ hasText: new RegExp(`^${theme}$`) }).first());
  await option.first().click();
  await expect(themeTrigger).toContainText(theme, { timeout: 15_000 });
  await expect(page.locator("html")).toHaveAttribute("data-ide-theme-mode", theme.toLowerCase(), {
    timeout: 15_000,
  });
}

/** Menu Settings 中 **Line Numbers**（`EditorSettings` 内第一个 `[data-slot="switch"]`；隐藏 `#lineNumbers` 在视口外不可点）。 */
export async function setMenuLineNumbersEnabled(sheet: Locator, enabled: boolean): Promise<void> {
  const sw = sheet.locator('[data-slot="switch"]').first();
  await sw.scrollIntoViewIfNeeded();
  await expect(sw).toBeVisible({ timeout: 15_000 });
  const isOn = (await sw.getAttribute("data-checked")) !== null;
  if (isOn !== enabled) {
    await sw.click();
  }
  await expect
    .poll(async () => ((await sw.getAttribute("data-checked")) !== null) === enabled, {
      timeout: 10_000,
      message: `Line Numbers → ${enabled}`,
    })
    .toBe(true);
}

export async function expectEditorLineNumbersInStorage(page: Page, enabled: boolean): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const raw = globalThis.localStorage.getItem("editor.lineNumbers");
          if (raw === null) {
            return true;
          }
          return JSON.parse(raw) as boolean;
        }),
      { timeout: 10_000 },
    )
    .toBe(enabled);
}

/** `ViewConfigSync` 根据 `lineNumbersAtom` 重配 `lineNumberCompartment`（`editor.tsx`）。 */
export async function expectActiveEditorLineNumbers(page: Page, visible: boolean): Promise<void> {
  await visibleCmContent(page).click();
  const gutter = activeFileTabEditor(page).locator(".cm-gutter.cm-lineNumbers");
  if (visible) {
    await expect(gutter).toBeVisible({ timeout: 15_000 });
  } else {
    await expect.poll(async () => gutter.count(), { timeout: 20_000 }).toBe(0);
  }
}

/** §20.1 Push/Pull：Menu 同步读工作区 `git remote origin`，空白 Modeling 无 `.git`。
 *  E2E 通过 Git 导入 clone 仓库，使磁盘上已有 origin（与 §6 导入路径一致）。 */
export async function configureGitRemoteInProjectSettings(
  page: Page,
  gitUrl: string,
  _projectUuid?: string,
): Promise<void> {
  const importName = `e2e_pl20_git_${Date.now()}`;
  const ok = await manualImportGitAndEnterIde(page, gitUrl, importName);
  expect(ok, `§20.1：Git 导入失败，无法为 Push/Pull 配置 origin (${gitUrl})`).toBeTruthy();
  chapter20Context.projectUuid = projectUuidFromUrl(page);
  // 保留 modelingProjectUuid，供 20.2～20.4 回到 Modeling 夹具
}

export async function clickMenuSyncPush(page: Page): Promise<void> {
  await openLeafFile(page, ["README.md"]);
  await appendLineToVisibleEditor(page, `<!-- e2e git sync ${Date.now()} -->`);
  const sheet = await openMenuSettingsSheet(page);
  await sheet.getByRole("button", { name: "Sync Push To Remote", exact: true }).click();
  await expect(page.getByText("Successfully pushed to GitHub").first()).toBeVisible({
    timeout: 180_000,
  });
  await closeMenuSettingsSheet(sheet);
}

export async function clickMenuSyncPull(page: Page): Promise<void> {
  const sheet = await openMenuSettingsSheet(page);
  await sheet.getByRole("button", { name: "Sync Pull From Remote", exact: true }).click();
  await expect(page.getByText("Successfully pulled from GitHub").first()).toBeVisible({
    timeout: 180_000,
  });
  await closeMenuSettingsSheet(sheet);
}

export async function selectMenuLaTeXCompilerDifferent(page: Page, sheet: Locator): Promise<string> {
  const trigger = sheet.locator("#latex-selector");
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

export async function appendLineToVisibleEditor(page: Page, line: string): Promise<void> {
  const editor = visibleCmContent(page);
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type(line);
  await page.keyboard.press("Control+S");
  await page.waitForTimeout(2_000);
}

export async function openProjectHistoryDialog(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "History", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Project History" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByText("Snapshots").first()).toBeVisible();
  return dialog;
}

export async function uploadTexFixtureForChapter20(page: Page): Promise<void> {
  await uploadSingleFileViaExploreUploadDialog(page, TEST_UPLOAD_TEX);
  const tree = page.locator(".ide-filetree").filter({ visible: true }).first();
  await expect(tree.getByRole("row", { name: /test_upload\.tex/i }).first()).toBeVisible({
    timeout: 180_000,
  });
}
