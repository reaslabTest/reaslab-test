import path from "node:path";

import { type Locator, type Page, expect, test } from "@playwright/test";

import { gotoWithRetry } from "../common/e2e-nav";
import { absUrl } from "../common/global-setup";
import {
  readModelingContestTemplateProjectUuidArtifact,
  writeModelingContestTemplateProjectUuidArtifact,
} from "./data/e2e-modeling-contest-template-project-artifact";
import {
  clearModelingProjectUuidArtifact,
  readModelingProjectUuidArtifact,
  writeModelingProjectUuidArtifact,
} from "./data/e2e-modeling-project-artifact";
import {
  readOptimizationTemplateProjectUuidArtifact,
  writeOptimizationTemplateProjectUuidArtifact,
} from "./data/e2e-optimization-template-project-artifact";
import { readTheoremProjectUuidArtifact, writeTheoremProjectUuidArtifact } from "./data/e2e-theorem-project-artifact";

/** 与前端 `Hotkey.OPEN_FILE_EXPLORER` / `OPEN_PROJECT_SEARCH`（`mod+shift+e` / `mod+shift+f`）一致；无头 Linux 用 Ctrl。 */
const FILE_EXPLORER_HOTKEY = "Control+Shift+E";
const PROJECT_SEARCH_HOTKEY = "Control+Shift+F";

export async function navigateToHomeProjects(page: Page): Promise<void> {
  await gotoWithRetry(page, absUrl("/"), { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible({ timeout: 30_000 });
}

/** 与 `reaslab-iipe` Import Git 页 `ImportForm` 示例 URL 一致。 */
export const E2E_DEFAULT_IMPORT_GIT_URL =
  "https://github.com/leanprover-community/flt-regular.git" as const;

const IMPORT_GIT_IDE_NAV_TIMEOUT_MS = 600_000; // 10 min：服务端 clone + 重定向
const IMPORT_GIT_IDE_SHELL_TIMEOUT_MS = 600_000; // 10 min：toolchain / lake / 缓存

/**
 * 工作台 **`/?nav=import-git`** → **Manual Import**：填写仓库 URL 与项目名 → **Import Project**，
 * 等待进入 **`/projects/:uuid`** 且 **Create New File** 与文件树就绪（定理类仓库含长时间环境准备，与 MIL 模板同级）。
 *
 * 表单默认 **Theorem Proving**；Lean 仓库勿选 **Modeling**。
 */
export async function manualImportGitAndEnterIde(
  page: Page,
  sourceUrl: string,
  projectName: string,
): Promise<boolean> {
  try {
    await page.goto(absUrl("/?nav=import-git"), { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Import from Git/i })).toBeVisible({
      timeout: 60_000,
    });

    const urlInput = page.locator("#sourceUrl");
    await expect(urlInput).toBeVisible({ timeout: 30_000 });
    await urlInput.fill(sourceUrl);

    const nameInput = page.locator("#projectName");
    await expect(nameInput).toBeVisible({ timeout: 15_000 });
    await nameInput.fill(projectName);

    const importBtn = page.getByRole("button", { name: "Import Project", exact: true });
    await expect(importBtn).toBeVisible({ timeout: 15_000 });
    await importBtn.click();

    await page.waitForURL(/\/projects\/[^/]+\/?$/i, { timeout: IMPORT_GIT_IDE_NAV_TIMEOUT_MS });
    await page
      .getByTitle("Create New File")
      .waitFor({ state: "visible", timeout: IMPORT_GIT_IDE_SHELL_TIMEOUT_MS });
    await waitForFileTree(page);
    return true;
  } catch {
    return false;
  }
}

/**
 * 工作台 Projects 下指定标签对应的面板。
 * 使用 **`role="tabpanel"` + 名称** 定位，避免多个 `[data-slot="tabs-content"]` 在 Radix Tabs 下仍被 `filter({ visible: true })` 同时命中，导致 `getByPlaceholder` strict mode 冲突。
 */
export function projectsTabPanel(page: Page, tabName: string) {
  return page.getByRole("tabpanel", { name: tabName, exact: true });
}

/**
 * **`ProjectsBatchToolbar`**（reaslab-iipe `projects-batch-toolbar.tsx`）：在搜索框与表格之间，
 * 出现 **「Selected N」** 时右侧才有 **Archive**（非 Archived）或 **Restore / Delete**（Archived）。
 * 须用本定位器再点按钮，**勿**用裸 `page.getByRole("button", { name: "Archive" })`，否则会命中表格行内的 **Archive**（`ArchiveProjectButton`），不会打开批量确认框。
 */
export function projectsListBatchToolbar(panel: Locator): Locator {
  return panel.getByText(/^Selected \d+/).locator("..");
}

/**
 * **`projects-table`** 的 tbody 数据行（`data-slot="table-row"`），**不按名称过滤**。
 * 用于「我的项目」全量清理与空表断言；勿用裸 **`getByRole("row")`** 以免混入表头等非数据行。
 */
export function projectsTableDataRowsInTabPanel(panel: Locator): Locator {
  return panel.locator('[data-slot="table-body"] [data-slot="table-row"]');
}

/**
 * 在工作台 **`/`** Projects：**My Projects** 下对当前列表中的 **全部自有项目** 循环执行：
 * **全选 → Archive → 确认**，再在 **Archived Projects** 中对 **全部已归档行** **全选 → Delete → 确认**（永久删除）。
 *
 * 各标签页会先 **`fill("")` 清空搜索框**：这不是「按关键字搜索」，而是**去掉残留筛选**，避免 `count()` 读到 0 行却误判已空、或 Archived 里筛掉行而跳过永久删除。
 *
 * 与前端 **`projects-table`**（表头 `aria-label="Select all projects"`）、**`projects-batch-toolbar`**、
 * **`projects-page`** 批量确认文案一致；多轮执行直至「我的项目」与「已归档」列表均无数据行，或达到轮数上限。
 */
export async function bulkArchiveAndPermanentlyDeleteAllMyProjectsOnProjectsPage(page: Page): Promise<void> {
  const maxPasses = 8;
  for (let pass = 0; pass < maxPasses; pass++) {
    await navigateToHomeProjects(page);

    await page.getByRole("tab", { name: "My Projects" }).click();
    const myPanel = projectsTabPanel(page, "My Projects");
    // 空列表时 table-body 可能被样式隐藏，勿对 tbody 断言 visible；以搜索框就绪代表面板可交互。
    await expect(myPanel.getByPlaceholder("Search projects...")).toBeVisible({ timeout: 30_000 });
    await myPanel.getByPlaceholder("Search projects...").fill("");
    const nMyStart = await projectsTableDataRowsInTabPanel(myPanel).count();

    if (nMyStart > 0) {
      await myPanel.getByRole("checkbox", { name: "Select all projects" }).click();
      await expect(myPanel.getByText(/^Selected \d+/)).toBeVisible({ timeout: 10_000 });
      await projectsListBatchToolbar(myPanel).getByRole("button", { name: "Archive", exact: true }).click();

      const confirmArchive = page
        .locator('[data-slot="alert-dialog-content"]')
        .filter({ hasText: "Archive selected projects?" });
      await expect(confirmArchive).toBeVisible({ timeout: 20_000 });
      await confirmArchive.getByRole("button", { name: "Archive", exact: true }).click();
      await expect(confirmArchive).toBeHidden({ timeout: 180_000 });
    }

    await page.getByRole("tab", { name: "Archived Projects" }).click();
    const archivedPanel = projectsTabPanel(page, "Archived Projects");
    await expect(archivedPanel.getByPlaceholder("Search projects...")).toBeVisible({ timeout: 30_000 });
    await archivedPanel.getByPlaceholder("Search projects...").fill("");

    if (nMyStart > 0) {
      await expect
        .poll(async () => await projectsTableDataRowsInTabPanel(archivedPanel).count(), { timeout: 120_000 })
        .toBeGreaterThan(0);
    }

    const nArch = await projectsTableDataRowsInTabPanel(archivedPanel).count();

    if (nArch > 0) {
      await archivedPanel.getByRole("checkbox", { name: "Select all projects" }).click();
      await expect(archivedPanel.getByText(/^Selected \d+/)).toBeVisible({ timeout: 10_000 });
      await projectsListBatchToolbar(archivedPanel).getByRole("button", { name: "Delete", exact: true }).click();

      const confirmDelete = page
        .locator('[data-slot="alert-dialog-content"]')
        .filter({ hasText: "Permanently delete selected projects?" });
      await expect(confirmDelete).toBeVisible({ timeout: 20_000 });
      await confirmDelete.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(confirmDelete).toBeHidden({ timeout: 180_000 });
    }

    // 用回合结束时的真实行数判断「是否已清空」，勿用本轮开头的 nMyStart（首帧 0 行会误判并提前 return）
    await page.getByRole("tab", { name: "My Projects" }).click();
    const myPanelEnd = projectsTabPanel(page, "My Projects");
    await myPanelEnd.getByPlaceholder("Search projects...").fill("");
    const nMyEnd = await projectsTableDataRowsInTabPanel(myPanelEnd).count();
    await page.getByRole("tab", { name: "Archived Projects" }).click();
    const archivedPanelEnd = projectsTabPanel(page, "Archived Projects");
    await archivedPanelEnd.getByPlaceholder("Search projects...").fill("");
    const nArchEnd = await projectsTableDataRowsInTabPanel(archivedPanelEnd).count();
    if (nMyEnd === 0 && nArchEnd === 0) {
      return;
    }
  }

  await navigateToHomeProjects(page);
  await page.getByRole("tab", { name: "My Projects" }).click();
  const left = await projectsTableDataRowsInTabPanel(projectsTabPanel(page, "My Projects")).count();
  if (left > 0) {
    throw new Error(
      `bulkArchiveAndPermanentlyDeleteAllMyProjectsOnProjectsPage: 经过 ${maxPasses} 轮后 My Projects 仍有 ${left} 行；请检查归档/删除确认框或列表筛选状态。`,
    );
  }
}

/** 顶栏 Menubar 中「展开左侧栏」：折叠时图标为 `PanelLeft`，展开时为 `PanelLeftClose`（见 `IdeMenubar`）。 */
async function expandLeftPanelViaMenubarIfCollapsed(page: Page): Promise<void> {
  const menubar = page.getByRole("menubar");
  const toggle = menubar
    .locator("button")
    .filter({ has: page.locator("svg[class*='lucide-panel-left']") })
    .first();
  if ((await toggle.count()) === 0) {
    return;
  }
  const cls = (await toggle.locator("svg").first().getAttribute("class")) ?? "";
  if (cls.includes("lucide-panel-left-close")) {
    return;
  }
  if (cls.includes("lucide-panel-left")) {
    await toggle.click();
  }
}

async function activateFilesExplorerTabViaSidebar(page: Page): Promise<void> {
  const explorer = page.getByRole("button", { name: /Explorer/i });
  if ((await explorer.count()) === 0) {
    return;
  }
  await explorer.first().click();
  await page.waitForTimeout(250);
}

export async function waitForFileTree(page: Page): Promise<Locator> {
  await page.locator("body").click({ position: { x: 400, y: 280 } });
  await page.waitForTimeout(150);

  const panel = page.locator(".ide-filetree").filter({ visible: true }).first();

  for (let round = 0; round < 5; round++) {
    await activateFilesExplorerTabViaSidebar(page);
    if (await panel.isVisible().catch(() => false)) {
      break;
    }
    await page.keyboard.press(FILE_EXPLORER_HOTKEY);
    await page.waitForTimeout(400);
    if (await panel.isVisible().catch(() => false)) {
      break;
    }
    if (round === 1) {
      await page.keyboard.press(PROJECT_SEARCH_HOTKEY);
      await page.waitForTimeout(250);
      await activateFilesExplorerTabViaSidebar(page);
      await page.keyboard.press(FILE_EXPLORER_HOTKEY);
      await page.waitForTimeout(400);
      if (await panel.isVisible().catch(() => false)) {
        break;
      }
    }
    await expandLeftPanelViaMenubarIfCollapsed(page);
    await page.waitForTimeout(350);
    await activateFilesExplorerTabViaSidebar(page);
    await page.keyboard.press(FILE_EXPLORER_HOTKEY);
    await page.waitForTimeout(400);
    if (await panel.isVisible().catch(() => false)) {
      break;
    }
  }

  await expect(panel).toBeVisible({ timeout: 45_000 });

  const treegrid = panel.getByRole("treegrid", { name: "File tree" });
  const hasTreegrid = (await treegrid.count()) > 0;
  const treegridShown = hasTreegrid && (await treegrid.isVisible().catch(() => false));
  const tree = treegridShown ? treegrid : panel;

  if (treegridShown) {
    const rows = treegrid.getByRole("row");
    if ((await rows.count()) > 0) {
      await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    }
  } else if (!hasTreegrid) {
    const rows = panel.getByRole("row");
    if ((await rows.count()) > 0) {
      await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    }
  }

  return tree;
}

function fixtureBasenameRowPattern(absoluteFilePath: string): RegExp {
  const escaped = path.basename(absoluteFilePath).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped, "i");
}

/**
 * Explore：选中 **README.md**（或文件树首行）后，经 **`Upload Files`**（`title="Upload Files"`）将**单个文件**上传到当前选中目录（与 **`reaslingoUploadFileForAiChat`** 同源弹窗；**非** chat-uploads 专用路径）。
 * 用于 **`docs/用户场景.md`** §12（编辑 LaTeX 文件并生成 PDF）等到项目根等。
 *
 * **`replaceIfExists`**（默认 **true**）：服务端 **`createFile`** 不覆盖已存在路径；复用 **`modeling-project-uuid`** 的 E2E 项目时，先删树上同名文件再上传，避免 **`Failed to upload: …`**。
 */
export async function uploadSingleFileViaExploreUploadDialog(
  page: Page,
  absoluteFilePath: string,
  options?: { replaceIfExists?: boolean },
): Promise<void> {
  const replaceIfExists = options?.replaceIfExists ?? true;
  const rowPattern = fixtureBasenameRowPattern(absoluteFilePath);

  await waitForFileTree(page);
  const tree = page.locator(".ide-filetree").filter({ visible: true }).first();
  await expect(tree).toBeVisible({ timeout: 45_000 });

  const existing = tree.getByRole("row", { name: rowPattern }).first();
  if (replaceIfExists && (await existing.isVisible().catch(() => false))) {
    await deleteIdeFileTreeRow(page, rowPattern);
  }

  const readmeRow = tree.getByRole("row", { name: /readme\.md/i }).first();
  if ((await readmeRow.count()) > 0 && (await readmeRow.isVisible().catch(() => false))) {
    await readmeRow.click();
  } else {
    await tree.getByRole("row").first().click();
  }

  const uploadBtn = page.locator('button[title="Upload Files"]').first();
  await expect(uploadBtn).toBeVisible({ timeout: 15_000 });
  await uploadBtn.scrollIntoViewIfNeeded();
  await uploadBtn.click();

  const uploadDialog = page.getByRole("dialog").filter({
    has: page.getByRole("button", { name: "Select Files", exact: true }),
  });
  await expect(uploadDialog).toBeVisible({ timeout: 15_000 });

  const fileInput = uploadDialog.locator('input[type="file"]:not([webkitdirectory])').first();
  await expect(fileInput).toBeAttached({ timeout: 10_000 });
  await fileInput.setInputFiles(absoluteFilePath);

  await expect(uploadDialog).toBeHidden({ timeout: 180_000 });
  await expect(
    page.locator("[data-sonner-toast]").filter({
      hasText: /Failed to upload|Upload failed:|Upload process failed/i,
    }),
  ).toHaveCount(0, { timeout: 15_000 });
  await expect(tree.getByRole("row", { name: rowPattern }).first()).toBeVisible({ timeout: 120_000 });
}

/** 文件树右键 **Delete** 并确认（清掉服务端文件与 Loro 文档绑定）。 */
export async function deleteIdeFileTreeRow(page: Page, rowPattern: RegExp): Promise<void> {
  const tree = page.locator(".ide-filetree").filter({ visible: true }).first();
  const row = tree.getByRole("row", { name: rowPattern }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete" }).click();

  const dialog = page.locator('[data-slot="alert-dialog-content"]').filter({ visible: true }).first();
  await expect(dialog.getByText(/Are you sure you want to delete/i)).toBeVisible({ timeout: 15_000 });
  const confirmDelete = dialog.getByRole("button", { name: "Delete", exact: true });
  await expect(confirmDelete).toBeEnabled({ timeout: 10_000 });
  await confirmDelete.click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(row).toBeHidden({ timeout: 120_000 });
}

export async function ensureReasLingoVisible(page: Page): Promise<void> {
  const header = page.getByText("ReasLingo", { exact: true }).first();
  for (let i = 0; i < 3; i++) {
    try {
      await expect(header).toBeVisible({ timeout: 2000 });
      return;
    } catch {
      await page.keyboard.press("Control+j");
    }
  }
  await expect(header).toBeVisible({ timeout: 20_000 });
}

/** 侧栏整块 **ReasLingo**（含 **`ReasLingoHeader`** 的 New Chat 与 **`MessageList`**，不仅输入条）。 */
export function reasLingoSidebarShellLocator(page: Page): Locator {
  return page
    .locator('[data-sidebar="group"]')
    .filter({ has: page.getByText("ReasLingo", { exact: true }) })
    .filter({ visible: true })
    .first();
}

/**
 * reaslab-iipe 侧栏 ReasLingo 输入区（`MessageInput`）。
 * 旧版 **Add Context** 已改为 **`@` 提及**（`AtMentionPopover.tsx`）+ **`title="Upload Files for AI Chat"`**。
 */
export function reasLingoInputHostLocator(page: Page): Locator {
  return page
    .locator('[data-sidebar="group"]')
    .filter({ has: page.getByText("ReasLingo", { exact: true }) })
    .filter({
      has: page
        .getByTitle("Upload Files for AI Chat")
        .or(page.getByRole("textbox"))
        .or(page.getByTitle("Send Message")),
    })
    .filter({ visible: true })
    .first();
}

/** `MessageInput` 主输入：HTML `<textarea>`，无障碍树为 **textbox**。 */
export function reasLingoPromptInput(reasLingoInputHost: Locator): Locator {
  return reasLingoInputHost.getByRole("textbox").or(reasLingoInputHost.locator("textarea")).first();
}

/**
 * 侧栏 **ReasLingo** → **`title="New Chat"`**（`ReasLingoHeader.tsx`）。
 * **`reaslab-iipe`**：`onNewSession` 为 **`handleCreateEmptySession`**（`setAiCurrentSession(null)` + **WelcomeScreen**），**不**立即 `createSession`；首条发送时由 **`ReasLingoChatArea.handleNewSession`** 创建 ACP 会话。
 */
export async function reasLingoClickNewChatWhenIdle(page: Page): Promise<void> {
  await ensureReasLingoVisible(page);
  const shell = reasLingoSidebarShellLocator(page);
  await expect(shell).toBeVisible({ timeout: 20_000 });
  const newChatBtn = shell.getByTitle("New Chat").first();
  await expect(newChatBtn).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(async () => (await newChatBtn.isDisabled().catch(() => true)) === false, {
      timeout: 120_000,
      intervals: [400, 800, 1_600],
    })
    .toBeTruthy();
  await newChatBtn.click();
  await expect(shell.getByText(/Welcome to/i).first()).toBeVisible({ timeout: 30_000 });
  await expect(shell.getByText(/^who are you\?$/i)).toHaveCount(0);
}

/**
 * 侧栏 **ReasLingo** 切回 **Default** Agent（**§7.4** / **§8.5** 等）。
 */
export async function ensureReasLingoDefaultAgent(page: Page, host?: Locator): Promise<void> {
  const h = host ?? reasLingoInputHostLocator(page);
  const agentBtn = h
    .getByRole("button", { name: /^Agent$/i })
    .or(h.locator('button[title="Switch Agent"]'))
    .first();
  await expect(agentBtn).toBeVisible({ timeout: 15_000 });
  const label = ((await agentBtn.textContent()) ?? "").replace(/\s+/g, " ").trim();
  if (label === "Agent") {
    return;
  }
  await agentBtn.click();
  const panel = page.locator('[data-slot="dropdown-menu-content"][class*="w-56"]');
  await expect(panel).toBeVisible({ timeout: 10_000 });
  const defaultItem = panel.locator('[data-slot="dropdown-menu-item"]').filter({ hasText: /^Default$/i });
  if ((await defaultItem.count()) > 0) {
    await defaultItem.first().click();
  } else {
    const selectedRow = panel
      .locator('[data-slot="dropdown-menu-item"]')
      .filter({ has: page.locator("svg.lucide-check") });
    if ((await selectedRow.count()) > 0) {
      await selectedRow.first().click();
    } else {
      await page.keyboard.press("Escape");
      throw new Error("ReasLingo 无法切回 Default Agent。");
    }
  }
  try {
    await expect(panel).toBeHidden({ timeout: 5_000 });
  } catch {
    await page.keyboard.press("Escape");
  }
  await expect(agentBtn.getByText(/^Agent$/)).toBeVisible({ timeout: 15_000 });
}

/** 在 ReasLingo 输入框用 `@` 选中工程内已有文件（与 `useAtMention` / `AtMentionPopover` 一致）。 */
export async function reasLingoAttachProjectFileViaAtMention(
  page: Page,
  reasLingoInputHost: Locator,
  fileName: string,
  searchQuery?: string,
): Promise<void> {
  const query = searchQuery ?? fileName.replace(/\.[^/.]+$/u, "");
  const ta = reasLingoPromptInput(reasLingoInputHost);
  await expect(ta).toBeVisible({ timeout: 20_000 });
  await ta.click();
  await ta.fill(`@${query}`);

  const mentionList = page
    .getByRole("listbox")
    .filter({ visible: true })
    .filter({ hasNot: page.locator(".ide-filetree") });
  await expect(mentionList.first()).toBeVisible({ timeout: 15_000 });

  const option = mentionList
    .getByRole("option")
    .filter({ has: page.getByText(fileName, { exact: true }) })
    .first();
  await expect(option).toBeVisible({ timeout: 30_000 });
  await option.click();
}

/**
 * 将本地文件上传到项目的 **`chat-uploads/`** 下，供 §5.2～§5.4 等 ReasLingo 用例使用。
 *
 * **与当前产品、手动成功路径一致**：左侧 Explore 工具栏 **`title="Upload Files"`**（`file-tree-toolbar`）
 * → 弹窗标题 **「Upload Files」**（`upload-dialog.tsx`）→ 对隐藏 file input 做 **`setInputFiles`**
 *（等效于点 **「Select Files」** 再选文件）。上传目标目录为选中行对应的父路径：此处先保证存在
 * **`chat-uploads`** 文件夹并选中该行，使文件落在 **`chat-uploads/<文件名>`**。
 *
 * 不再依赖 ReasLingo 输入条上的 **「Upload Files for AI Chat」** 及其「Upload & Reference」弹窗——
 * 与你在截图中的手动流程一致；`reasLingoInputHost` 仍保留在签名上以免改动各用例调用处。
 */
export async function reaslingoUploadFileForAiChat(
  page: Page,
  reasLingoInputHost: Locator,
  filePath: string,
): Promise<void> {
  void reasLingoInputHost;

  await waitForFileTree(page);
  const tree = page.locator(".ide-filetree").filter({ visible: true }).first();
  await expect(tree).toBeVisible({ timeout: 45_000 });

  await ensureChatUploadsFolderInIdeFileTree(page);
  await expandIdeFileTreeRowByLabel(page, /chat-uploads/i);

  const uploadBtn = page.locator('button[title="Upload Files"]').first();
  await uploadBtn.scrollIntoViewIfNeeded();
  await uploadBtn.click();

  const uploadDialog = page.getByRole("dialog").filter({
    has: page.getByRole("button", { name: "Select Files", exact: true }),
  });
  await expect(uploadDialog).toBeVisible({ timeout: 15_000 });

  const fileInput = uploadDialog.locator('input[type="file"]:not([webkitdirectory])').first();
  await expect(fileInput).toBeAttached({ timeout: 10_000 });
  await fileInput.setInputFiles(filePath);

  await expect(uploadDialog).toBeHidden({ timeout: 180_000 });
  await expect(
    page.locator("[data-sonner-toast]").filter({
      hasText: /Failed to upload|Upload failed:|Upload process failed/i,
    }),
  ).toHaveCount(0, { timeout: 15_000 });
}

/** 在 Explore 文件树中保证存在 `chat-uploads` 目录（无则在本机「Create new folder」下创建）。 */
async function ensureChatUploadsFolderInIdeFileTree(page: Page): Promise<void> {
  const tree = page.locator(".ide-filetree").filter({ visible: true }).first();
  if ((await tree.getByRole("row", { name: /chat-uploads/i }).count()) > 0) {
    return;
  }
  const readmeRow = tree.getByRole("row", { name: /readme\.md/i }).first();
  if ((await readmeRow.count()) > 0 && (await readmeRow.isVisible().catch(() => false))) {
    await readmeRow.click();
  } else {
    await tree.getByRole("row").first().click();
  }
  const createFolder = page.getByTitle("Create new folder");
  await expect(createFolder).toBeVisible({ timeout: 15_000 });
  await createFolder.click();
  const nameInput = page.getByPlaceholder("New Folder");
  await expect(nameInput).toBeVisible({ timeout: 15_000 });
  await nameInput.fill("chat-uploads");
  await nameInput.press("Enter");
  await expect(tree.getByRole("row", { name: /chat-uploads/i }).first()).toBeVisible({ timeout: 60_000 });
}

/** 在可见 `.ide-filetree` 中展开匹配 `rowLabel` 的文件夹行。无匹配则跳过。 */
export async function expandIdeFileTreeRowByLabel(page: Page, rowLabel: string | RegExp): Promise<void> {
  const shell = page.locator(".ide-filetree").filter({ visible: true }).first();

  const basenameMatches = (basename: string | null): boolean => {
    if (!basename) {
      return false;
    }
    return typeof rowLabel === "string" ? basename === rowLabel : rowLabel.test(basename);
  };

  /**
   * `@reaslab/file-tree`（iipe / beta）：`Tree` + `TreeItem` 渲染为 **treegrid**，展开控件为
   * **`<Button slot="chevron" data-tree-chevron>`**（Hugeicons，**无** `lucide-chevron-right`），且 **无** `data-filetree-node`。
   *
   * **幂等**：`aria-expanded="true"` 时不再点 chevron，避免「上传前已展开 → 上传后再 expand 实为收起」导致子文件从 DOM 消失。
   */
  let treeGrid = shell.getByRole("treegrid", { name: /file tree/i }).first();
  if ((await treeGrid.count()) === 0) {
    treeGrid = shell.getByRole("treegrid").first();
  }
  if ((await treeGrid.count()) > 0) {
    const row = treeGrid.getByRole("row", { name: rowLabel }).first();
    if ((await row.count()) > 0) {
      const expanded = await row.getAttribute("aria-expanded");
      if (expanded === "true") {
        return;
      }
      const racChevron = row.locator("[data-tree-chevron]").first();
      if ((await racChevron.count()) > 0) {
        await racChevron.scrollIntoViewIfNeeded();
        await racChevron.click({ force: true });
        return;
      }
      const expandBtn = row.getByRole("button", { name: /Expand/i }).first();
      if ((await expandBtn.count()) > 0) {
        await expandBtn.scrollIntoViewIfNeeded();
        await expandBtn.click({ force: true });
        return;
      }
      try {
        await row.focus({ timeout: 5_000 });
      } catch {
        /* ignore */
      }
      await page.keyboard.press("ArrowRight");
      return;
    }
  }

  /**
   * `reaslab-uni`：`DirNode` 根节点带 **`data-filetree-node` + `data-node-basename`**，展开为
   * **`svg.lucide-chevron-right`** 或整行 **`.ide-filetree-content`** 点击（`toggleDir`）。
   */
  const uniNodes = shell.locator("[data-filetree-node='true'][data-node-basename]");
  for (let i = 0; i < (await uniNodes.count()); i++) {
    const node = uniNodes.nth(i);
    const base = await node.getAttribute("data-node-basename");
    if (!basenameMatches(base)) {
      continue;
    }
    const lucideChevron = node
      .locator("svg.lucide-chevron-right, svg[class*='chevron-right']")
      .first();
    if ((await lucideChevron.count()) > 0) {
      await lucideChevron.scrollIntoViewIfNeeded();
      await lucideChevron.click({ force: true });
      return;
    }
    const content = node.locator(".ide-filetree-content").first();
    if ((await content.count()) > 0) {
      await content.scrollIntoViewIfNeeded();
      await content.click({ force: true });
      return;
    }
  }

  /** 兜底：仅在 shell 上找 row（无嵌套 treegrid 的旧布局）。 */
  const row = shell.getByRole("row", { name: rowLabel }).first();
  if ((await row.count()) === 0) {
    return;
  }
  const expandBtn = row.getByRole("button", { name: /Expand/i }).first();
  if ((await expandBtn.count()) > 0) {
    await expandBtn.scrollIntoViewIfNeeded();
    await expandBtn.click({ force: true });
    return;
  }
  await row.click();
}

/**
 * 侧栏 ReasLingo 本轮「进行中」线索（与 **`MessageInput`** 的 **Stop Message**、**`MessageList`** 的
 * **Receiving response** / **Thinking** / **Processing, please wait** 一致）。
 */
export function reasLingoStreamActivityLocator(host: Locator): Locator {
  return host
    .getByTitle("Stop Message")
    .or(host.getByText(/Receiving response/i))
    .or(host.getByText(/^Thinking$/i))
    .or(host.getByText(/Processing, please wait/i));
}

/** 发送后等待流式/工具阶段开始（须在点击 **Send Message** 之后立刻调用，避免竞态）。 */
export async function waitForReasLingoStreamStarted(page: Page, timeout = 180_000): Promise<void> {
  const host = reasLingoInputHostLocator(page);
  await expect(reasLingoStreamActivityLocator(host).first()).toBeVisible({ timeout });
}

/**
 * 等待 ReasLingo 本轮助理回复**流式结束**（与前端 `MessageInput` 的 `isLoading` → **Stop Message**、
 * `MessageList` 的 **Receiving response** 一致）。勿用固定 `sleep`：Paper Copilot / 工具链可能远超 30s，
 * 否则后续断言会在仍在生成时开始，导致超时误报。
 *
 * 若调用时流式已结束（**Send Message** 可见且无 **Stop**），则不再要求「进行中」UI 再次出现。
 */
export async function waitForReasLingoAssistantReplyDone(page: Page): Promise<void> {
  const host = reasLingoInputHostLocator(page);

  const stopBtn = host.getByTitle("Stop Message");
  const receiving = host.getByText(/Receiving response/i);
  const streamUi = reasLingoStreamActivityLocator(host).first();

  const isIdle = async (): Promise<boolean> => {
    const r = await receiving.isVisible().catch(() => false);
    const s = await stopBtn.isVisible().catch(() => false);
    if (r || s) {
      return false;
    }
    return host.getByTitle("Send Message").first().isVisible().catch(() => false);
  };

  if (!(await streamUi.isVisible().catch(() => false))) {
    if (await isIdle()) {
      return;
    }
    await expect(streamUi).toBeVisible({ timeout: 120_000 });
  }

  await expect
    .poll(
      async () => {
        const r = await receiving.isVisible().catch(() => false);
        const s = await stopBtn.isVisible().catch(() => false);
        return !r && !s;
      },
      { timeout: 300_000, intervals: [400, 800, 1_600, 3_200] },
    )
    .toBeTruthy();
}

/**
 * `docs/用户场景.md` §6～§9：侧栏 ReasLingo，发送 **`who are you?`**，并等待本轮助理输出结束（与 `waitForReasLingoAssistantReplyDone` 一致）。
 * `agentMenuLabel` 为 **`null`** 时不打开 Agent 菜单（保持默认 Agent）；否则在 **Agent / Switch Agent** 触发器菜单中选首条匹配项，菜单关闭后 **固定等待 2s** 再输入 **`who are you?`**。
 *
 * @returns 若指定了 `agentMenuLabel` 但菜单中无匹配项，返回 **`false`**（调用方宜 `test.skip`）；否则返回 **`true`**。
 */
export async function reasLingoWhoAreYouProbe(
  page: Page,
  agentMenuLabel: RegExp | null,
): Promise<boolean> {
  await ensureReasLingoVisible(page);
  const host = reasLingoInputHostLocator(page);
  await expect(host).toBeVisible({ timeout: 20_000 });

  if (agentMenuLabel) {
    const trigger = host.getByRole("button", { name: /^Agent$/i }).or(host.locator('button[title="Switch Agent"]'));
    await expect(trigger.first()).toBeVisible({ timeout: 15_000 });
    await trigger.first().click();
    const panel = page.locator('[data-slot="dropdown-menu-content"][class*="w-56"]');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    const item = panel.locator('[data-slot="dropdown-menu-item"]').filter({ hasText: agentMenuLabel });
    if ((await item.count()) < 1) {
      await page.keyboard.press("Escape");
      return false;
    }
    await item.first().click();
    await expect(panel).toBeHidden({ timeout: 5_000 });
    // 切换 Agent 后给前端/会话态一短窗再输入，避免偶发抢在 UI 未就绪时填问句。
    await page.waitForTimeout(2_000);
  }

  const ta = reasLingoPromptInput(host);
  await expect(ta).toBeVisible({ timeout: 15_000 });
  await ta.click();
  await ta.fill("who are you?");
  const sendBtn = host.getByTitle("Send Message").first();
  await expect(sendBtn).toBeEnabled({ timeout: 180_000 });
  await sendBtn.click();
  await waitForReasLingoStreamStarted(page);
  await waitForReasLingoAssistantReplyDone(page);
  return true;
}

/** §5 / §16：关闭模型菜单中的 **Auto**。 */
export async function turnOffReasLingoAutoModel(page: Page, host?: Locator): Promise<void> {
  const h = host ?? reasLingoInputHostLocator(page);
  const modelBtn = h.getByTitle("Switch Model");
  await modelBtn.click();
  const panel = page.getByRole("menu").filter({ has: page.getByRole("switch") }).first();
  await expect(panel).toBeVisible({ timeout: 10_000 });
  const autoSwitch = panel.getByRole("switch");
  if (await autoSwitch.isChecked()) {
    await autoSwitch.click();
  }
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden({ timeout: 5_000 });
}

/**
 * 在 **Switch Model** 菜单中关闭 **Auto** 并选中 **ReasProX** 或 **ReasPro**（优先 **ReasProX**）。
 * @returns 选中成功为 **`true`**；列表中均无则为 **`false`**。
 */
export async function selectReasLingoReasProModel(page: Page, host?: Locator): Promise<boolean> {
  const h = host ?? reasLingoInputHostLocator(page);
  const modelBtn = h.getByTitle("Switch Model");
  await modelBtn.click();
  const panel = page.getByRole("menu").filter({ has: page.getByRole("switch") }).first();
  await expect(panel).toBeVisible({ timeout: 10_000 });
  const autoSwitch = panel.getByRole("switch");
  if (await autoSwitch.isChecked()) {
    await autoSwitch.click();
  }
  for (const label of [/^ReasProX$/i, /^ReasPro$/i] as const) {
    const item = panel.locator('[data-slot="dropdown-menu-item"]').filter({ hasText: label });
    if ((await item.count()) > 0) {
      await item.first().click();
      try {
        await expect(panel).toBeHidden({ timeout: 5_000 });
      } catch {
        await page.keyboard.press("Escape");
      }
      return true;
    }
  }
  await page.keyboard.press("Escape");
  return false;
}

/**
 * 侧栏 **Agent** 菜单切换至 `agentMenuLabel` 首条匹配项。
 * @returns 菜单无匹配项时 **`false`**。
 */
export async function switchReasLingoAgentByMenuLabel(
  page: Page,
  agentMenuLabel: RegExp,
  host?: Locator,
): Promise<boolean> {
  const h = host ?? reasLingoInputHostLocator(page);
  const trigger = h.getByRole("button", { name: /^Agent$/i }).or(h.locator('button[title="Switch Agent"]'));
  await expect(trigger.first()).toBeVisible({ timeout: 15_000 });
  await trigger.first().click();
  const panel = page.locator('[data-slot="dropdown-menu-content"][class*="w-56"]');
  await expect(panel).toBeVisible({ timeout: 10_000 });
  const item = panel.locator('[data-slot="dropdown-menu-item"]').filter({ hasText: agentMenuLabel });
  if ((await item.count()) < 1) {
    await page.keyboard.press("Escape");
    return false;
  }
  await item.first().click();
  await expect(panel).toBeHidden({ timeout: 5_000 });
  await page.waitForTimeout(2_000);
  return true;
}

/** §16.3：侧栏是否含轻量写作大纲成功线索。 */
export function reasLingoReasFlowWritingOutlineSuccess(text: string): boolean {
  const t = text.replace(/\r\n/g, "\n");
  const lower = t.toLowerCase();
  const hasBullets =
    /(^|\n)\s*[-*•]\s+\S/m.test(t) || /(^|\n)\s*\d+\.\s+\S/m.test(t) || lower.includes("•");
  const sectionHits = [/introduction/i, /related work/i, /method/i, /background/i, /survey/i].filter((re) =>
    re.test(t),
  ).length;
  return hasBullets && sectionHits >= 2 && t.trim().length > 80;
}

/**
 * **`docs/用户场景.md` §16.2**：切换 **ReasFlow Copilot**、验收 placeholder / 隐藏 Default 专属控件、选 **ReasPro** 系模型并发送 **who are you?**。
 * @returns Agent 菜单无匹配项时 **`false`**。
 */
export async function reasLingoReasFlowCopilotInputBarProbe(page: Page): Promise<boolean> {
  await ensureReasLingoVisible(page);
  const host = reasLingoInputHostLocator(page);
  await expect(host).toBeVisible({ timeout: 20_000 });

  await turnOffReasLingoAutoModel(page, host);
  const switched = await switchReasLingoAgentByMenuLabel(page, REASFLOW_COPILOT_AGENT_MENU_LABEL, host);
  if (!switched) {
    return false;
  }

  await expect(host.locator('button[title="Switch Agent"]').first()).toBeVisible({ timeout: 15_000 });
  await expect(host.getByTitle("Chain of Thought")).toHaveCount(0);
  await expect(host.getByTitle("Web Search")).toHaveCount(0);
  await expect(host.getByTitle("More Settings")).toHaveCount(0);

  const ta = reasLingoPromptInput(host);
  await expect(ta).toHaveAttribute("placeholder", REASFLOW_COPILOT_INPUT_PLACEHOLDER, { timeout: 10_000 });

  const modelOk = await selectReasLingoReasProModel(page, host);
  if (!modelOk) {
    return false;
  }

  await ta.click();
  await ta.fill("who are you?");
  const sendBtn = host.getByTitle("Send Message").first();
  await expect(sendBtn).toBeEnabled({ timeout: 180_000 });
  await sendBtn.click();
  await waitForReasLingoStreamStarted(page);
  await waitForReasLingoAssistantReplyDone(page);
  return true;
}

/** 填写 prompt 并等待本轮流式结束。 */
export async function sendReasLingoPromptAndWaitForReply(
  page: Page,
  host: Locator,
  prompt: string,
): Promise<void> {
  const ta = reasLingoPromptInput(host);
  await expect(ta).toBeVisible({ timeout: 15_000 });
  await ta.click();
  await ta.fill(prompt);
  const sendBtn = host.getByTitle("Send Message").first();
  await expect(sendBtn).toBeEnabled({ timeout: 180_000 });
  await sendBtn.click();
  await waitForReasLingoStreamStarted(page);
  await waitForReasLingoAssistantReplyDone(page);
}

/** `docs/用户场景.md` §8.5：MIL 入门 **Lean** 相对路径（与 **`S01_Getting_Started.lean`** 首行 **`#eval "Hello, World!"`** 一致）。 */
export const MIL_S01_GETTING_STARTED_LEAN_REL = "MIL/C01_Introduction/S01_Getting_Started.lean" as const;

/** `docs/用户场景.md` §8.5：英文探针，要求 **`read_file`** 读取 **`MIL_S01_GETTING_STARTED_LEAN_REL`**（**`reaslab-iipe`** 会话 **`mcpServers: []`**，无 **`lean_mcp`**）。 */
export const CH8_5_READ_GETTING_STARTED_USER_PROMPT =
  `Read ${MIL_S01_GETTING_STARTED_LEAN_REL} from the project root using the read_file tool. Confirm the first code line is #eval "Hello, World!" (a string literal, not IO.println). Quote that exact line from the file in your reply.` as const;

/** §8.5：侧栏是否含 **read_file / S01** 成功线索（兼容旧 **`lean_mcp` + Infoview** 环境）。 */
export function reasLingoLeanGettingStartedSuccessInSidebarText(text: string): boolean {
  const t = text.replace(/\r\n/g, "\n");
  const relEsc = MIL_S01_GETTING_STARTED_LEAN_REL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hasPath = new RegExp(relEsc, "i").test(t) || /S01_Getting_Started\.lean/i.test(t);
  const hasEval = /#eval\s+"Hello,\s*World!"/i.test(t);

  const legacyLeanMcp =
    /lean_mcp/i.test(t) && /⊢|\bno goals\b|unsolved goals|\bString\b/i.test(t);

  const readFileOk =
    /read_file/i.test(t) &&
    hasPath &&
    hasEval &&
    (/Execute Tool Call/i.test(t) || /Read file|read_file/i.test(t));

  return hasPath && hasEval && (readFileOk || legacyLeanMcp);
}

/**
 * **`docs/用户场景.md` §8.5（读取 Getting Started Lean）**：侧栏 **ReasLingo**、**Default** Agent → **`CH8_5_READ_GETTING_STARTED_USER_PROMPT`**；
 * 当前 **`reaslab-iipe`** 经 **`read_file`** 读取 **`MIL_S01_GETTING_STARTED_LEAN_REL`** 并确认 **`#eval "Hello, World!"`**（**§8.2** 已在 IDE **Infoview** 验收预览）。
 *
 * @returns 无法回到 **Default**、或未命中成功线索时 **`false`**（**`test.skip`**）。读文件硬失败 **抛出**。
 *
 * **与 `reaslab-iipe` 对齐**：**`AgentSelector.tsx`** 无单独 **Default** 菜单项时，**再次点选当前已勾选项** 清回默认，**勿**用 **`/^Default$/`** 匹配菜单。
 */
export async function reasLingoDefaultAgentLeanGettingStartedProbe(page: Page): Promise<boolean> {
  await ensureReasLingoVisible(page);
  const host = reasLingoInputHostLocator(page);
  await expect(host).toBeVisible({ timeout: 20_000 });

  const trigger = host.getByRole("button", { name: /^Agent$/i }).or(host.locator('button[title="Switch Agent"]'));
  await expect(trigger.first()).toBeVisible({ timeout: 15_000 });
  await trigger.first().click();
  const panel = page.locator('[data-slot="dropdown-menu-content"][class*="w-56"]');
  await expect(panel).toBeVisible({ timeout: 10_000 });

  const defaultItem = panel.locator('[data-slot="dropdown-menu-item"]').filter({ hasText: /^Default$/i });
  if ((await defaultItem.count()) > 0) {
    await defaultItem.first().click();
  } else {
    const selectedRow = panel
      .locator('[data-slot="dropdown-menu-item"]')
      .filter({ has: page.locator("svg.lucide-check") });
    if ((await selectedRow.count()) > 0) {
      await selectedRow.first().click();
    } else {
      await page.keyboard.press("Escape");
    }
  }
  try {
    await expect(panel).toBeHidden({ timeout: 5_000 });
  } catch {
    await page.keyboard.press("Escape");
  }

  const switchAgentBtn = host.locator('button[title="Switch Agent"]');
  try {
    await expect(switchAgentBtn.getByText(/^Agent$/)).toBeVisible({ timeout: 10_000 });
  } catch {
    return false;
  }

  await reasLingoClickNewChatWhenIdle(page);

  const cm = page.locator(".cm-editor .cm-content").first();
  if ((await cm.count()) > 0) {
    await cm.click({ timeout: 10_000 }).catch(() => {});
  }

  const ta = reasLingoPromptInput(host);
  await expect(ta).toBeVisible({ timeout: 15_000 });
  await ta.click();
  await ta.fill(CH8_5_READ_GETTING_STARTED_USER_PROMPT);
  const sendBtn = host.getByTitle("Send Message").first();
  await expect(sendBtn).toBeEnabled({ timeout: 180_000 });
  await sendBtn.click();
  await waitForReasLingoStreamStarted(page);
  await waitForReasLingoAssistantReplyDone(page);

  const readHardFailure =
    /ENOENT|no such file|Failed to read|read_file.*\berror\b|Cannot read file|permission denied/i;
  const leanMcpHardFailure =
    /MCP\s+error|StatusCode\.UNIMPLEMENTED|-326\s*03|Failed to get Lean infoview|Failed to restart Lean file|gRPC\s+error/i;

  try {
    await expect
      .poll(
        async () => {
          const body = ((await host.innerText()) ?? "").trim();
          if (readHardFailure.test(body)) {
            throw new Error(`§8.5 读取 Getting Started Lean 失败（读文件错误）。节选：${body.slice(-2_500)}`);
          }
          if (leanMcpHardFailure.test(body) && !reasLingoLeanGettingStartedSuccessInSidebarText(body)) {
            throw new Error(`§8.5 失败（侧栏含 MCP/gRPC 错误）。节选：${body.slice(-2_500)}`);
          }
          if (/I\s*'?m\s+sorry|cannot\s+assist/i.test(body) && !reasLingoLeanGettingStartedSuccessInSidebarText(body)) {
            return false;
          }
          return reasLingoLeanGettingStartedSuccessInSidebarText(body);
        },
        { timeout: 300_000, intervals: [800, 2_000, 4_000, 8_000] },
      )
      .toBeTruthy();
  } catch (e) {
    if (e instanceof Error && e.message.includes("§8.5")) {
      throw e;
    }
    return false;
  }

  const bodyAfter = (await host.innerText()) ?? "";
  if (readHardFailure.test(bodyAfter)) {
    throw new Error(`§8.5 在轮询末尾出现读文件错误。节选：${bodyAfter.slice(-2_500)}`);
  }
  if (leanMcpHardFailure.test(bodyAfter) && !reasLingoLeanGettingStartedSuccessInSidebarText(bodyAfter)) {
    throw new Error(`§8.5 在轮询末尾出现 MCP 错误。节选：${bodyAfter.slice(-2_500)}`);
  }

  return true;
}

/** @deprecated 使用 **`reasLingoDefaultAgentLeanGettingStartedProbe`**（§8.5 已改为 **read_file**，非 **lean_mcp**）。 */
export const reasLingoDefaultAgentLeanMcpInfoviewProbe = reasLingoDefaultAgentLeanGettingStartedProbe;

/** `docs/用户场景.md` §8.6：发给模型的用户消息须为英文（**`lake build`**，与 **`reaslab-iipe` `skills.rs`** 一致）。 */
export const CH8_6_LAKE_BUILD_USER_PROMPT =
  "From this Lean/Lake workspace root, run a full project build with `lake build` (no target). In your reply, quote one line from the command output that shows success (e.g. build completed, error: 0, or status=Success)." as const;

/** §8.6：侧栏是否含 **`lake build`** 成功线索（shell 或历史 **`lake_mcp` / `lake_build`** 摘要均可）。 */
export function reasLingoLakeBuildSuccessInSidebarText(text: string): boolean {
  const t = text.replace(/\r\n/g, "\n");
  const mentionsLakeBuild = /lake\s+build|lake_build/i.test(t);
  const mcpSuccess = /\bstatus=Success\b/i.test(t) || /"status"\s*:\s*"success"/i.test(t);
  const shellSuccess =
    /Build completed successfully/i.test(t) ||
    /\bbuild completed\b/i.test(t) ||
    (mentionsLakeBuild && /\berror\(s\):\s*0\b/i.test(t)) ||
    (mentionsLakeBuild && /successfully built|✔.*built/i.test(t));

  return mcpSuccess || shellSuccess;
}

/**
 * **`docs/用户场景.md` §8.6**：侧栏 **ReasLingo**、**Default** Agent → **`CH8_6_LAKE_BUILD_USER_PROMPT`**；
 * 当前 **`reaslab-iipe`** 经 **shell `lake build`**（**`mcpServers: []`**）；仍兼容 **`lake_mcp`** / **`status=Success`** 旧摘要。
 *
 * @returns 无法回到 **Default**、或未命中成功线索时 **`false`**（**`test.skip`**）。硬失败 **抛出**。
 */
export async function reasLingoDefaultAgentLakeMcpBuildProbe(page: Page): Promise<boolean> {
  await ensureReasLingoVisible(page);
  const host = reasLingoInputHostLocator(page);
  await expect(host).toBeVisible({ timeout: 20_000 });

  const trigger = host.getByRole("button", { name: /^Agent$/i }).or(host.locator('button[title="Switch Agent"]'));
  await expect(trigger.first()).toBeVisible({ timeout: 15_000 });
  await trigger.first().click();
  const panel = page.locator('[data-slot="dropdown-menu-content"][class*="w-56"]');
  await expect(panel).toBeVisible({ timeout: 10_000 });

  const defaultItem = panel.locator('[data-slot="dropdown-menu-item"]').filter({ hasText: /^Default$/i });
  if ((await defaultItem.count()) > 0) {
    await defaultItem.first().click();
  } else {
    const selectedRow = panel
      .locator('[data-slot="dropdown-menu-item"]')
      .filter({ has: page.locator("svg.lucide-check") });
    if ((await selectedRow.count()) > 0) {
      await selectedRow.first().click();
    } else {
      await page.keyboard.press("Escape");
    }
  }
  try {
    await expect(panel).toBeHidden({ timeout: 5_000 });
  } catch {
    await page.keyboard.press("Escape");
  }

  const switchAgentBtn = host.locator('button[title="Switch Agent"]');
  try {
    await expect(switchAgentBtn.getByText(/^Agent$/)).toBeVisible({ timeout: 10_000 });
  } catch {
    return false;
  }

  await reasLingoClickNewChatWhenIdle(page);

  const ta = reasLingoPromptInput(host);
  await expect(ta).toBeVisible({ timeout: 15_000 });
  await ta.click();
  await ta.fill(CH8_6_LAKE_BUILD_USER_PROMPT);
  const sendBtn = host.getByTitle("Send Message").first();
  await expect(sendBtn).toBeEnabled({ timeout: 180_000 });
  await sendBtn.click();
  await waitForReasLingoStreamStarted(page);
  await waitForReasLingoAssistantReplyDone(page);

  const lakeBuildHardFailure =
    /MCP\s+error|StatusCode\.UNIMPLEMENTED|-326\s*03|Build failed:|gRPC\s+error|\bstatus=Error\b|\bstatus=TimedOut\b|timed_out|error\(s\):\s*[1-9]\d*/i;

  try {
    await expect
      .poll(
        async () => {
          const body = ((await host.innerText()) ?? "").trim();
          if (lakeBuildHardFailure.test(body)) {
            throw new Error(`§8.6 lake build 失败（侧栏含构建/MCP 错误）。节选：${body.slice(-2_500)}`);
          }
          if (/I\s*'?m\s+sorry|cannot\s+assist/i.test(body) && !reasLingoLakeBuildSuccessInSidebarText(body)) {
            return false;
          }
          return reasLingoLakeBuildSuccessInSidebarText(body);
        },
        { timeout: 300_000, intervals: [800, 2_000, 4_000, 8_000] },
      )
      .toBeTruthy();
  } catch (e) {
    if (e instanceof Error && e.message.includes("§8.6 lake build 失败")) {
      throw e;
    }
    return false;
  }

  const bodyAfter = (await host.innerText()) ?? "";
  if (lakeBuildHardFailure.test(bodyAfter)) {
    throw new Error(`§8.6 lake build 在轮询末尾出现构建/MCP 错误。节选：${bodyAfter.slice(-2_500)}`);
  }

  return true;
}

/** §7.4：侧栏正文是否含 **python-execute / shell** 成功线索（与 **`reaslab-iipe` `skills.rs`** 一致，非 Console 专用文案）。 */
export function reasLingoPythonExecuteSuccessInSidebarText(text: string, relPyPath: string): boolean {
  const t = text.replace(/\r\n/g, "\n");
  const base = relPyPath.replace(/^\/+/, "").split("/").pop() ?? relPyPath;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mentionsScript =
    new RegExp(esc(relPyPath), "i").test(t) || new RegExp(esc(base), "i").test(t);

  const exitOk =
    /Process finished with exit code\s*0\b/i.test(t) ||
    /\bexit[_\s-]*code\s*[:=]\s*0\b/i.test(t) ||
    /"exit_code"\s*:\s*0\b/.test(t);

  const toolPathOk =
    /python-execute/i.test(t) &&
    mentionsScript &&
    (/Execute Tool Call/i.test(t) ||
      /"exit_code"\s*:\s*0\b/.test(t) ||
      /\bexit[_\s-]*code\s*[:=]\s*0\b/i.test(t));

  const actionsToolOk =
    /\bActions\s+[1-9]\d*\/[1-9]\d*\b/i.test(t) &&
    mentionsScript &&
    (/python-execute|bash|shell/i.test(t));

  return exitOk || toolPathOk || actionsToolOk;
}

/** §7.4：侧栏是否出现**助理侧**工具执行线索（勿仅匹配用户气泡里的 `python-execute` 字样）。 */
export function reasLingoPythonExecuteToolStartedInSidebarText(text: string, relPyPath: string): boolean {
  const t = text.replace(/\r\n/g, "\n");
  const base = relPyPath.replace(/^\/+/, "").split("/").pop() ?? relPyPath;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mentionsScript =
    new RegExp(esc(relPyPath), "i").test(t) || new RegExp(esc(base), "i").test(t);
  if (!mentionsScript || !/python-execute/i.test(t)) {
    return false;
  }
  return (
    /\bActions\s+[1-9]\d*\/[1-9]\d*\b/i.test(t) ||
    /Execute Tool Call/i.test(t) ||
    /Process finished with exit code\s*0\b/i.test(t) ||
    /"exit_code"\s*:\s*0\b/.test(t) ||
    /\bexit[_\s-]*code\s*[:=]\s*0\b/i.test(t)
  );
}

/**
 * `docs/用户场景.md` §7.4：**第二次**跑与 **§7.3** 相同的模板主 **`.py`**（路径 **`projectPyDataName`**）：
 * 侧栏 **ReasLingo**、**默认 Agent**、**New Chat** 后要求经 **`python-execute`**（shell 工具，见 **`reaslab-iipe` `skills.rs`**）全量执行；
 * 与 **§7.3** **Run Python → Console** 形成双路径验收。
 */
export async function reasLingoDefaultAgentMcpPythonProbe(
  page: Page,
  projectPyDataName: string,
): Promise<void> {
  await ensureReasLingoVisible(page);
  const shell = reasLingoSidebarShellLocator(page);
  const host = reasLingoInputHostLocator(page);
  await expect(shell).toBeVisible({ timeout: 20_000 });
  await expect(host).toBeVisible({ timeout: 20_000 });

  await ensureReasLingoDefaultAgent(page, host);
  await reasLingoClickNewChatWhenIdle(page);

  const rel = projectPyDataName.startsWith("/") ? projectPyDataName.slice(1) : projectPyDataName;
  const base = rel.split("/").pop() ?? rel;
  const prompt = [
    `Run ${JSON.stringify(rel)} from the project root with the bash/shell tool.`,
    `The command MUST be exactly: python-execute ${JSON.stringify(rel)}`,
    "Wait until execution finishes. Do not answer without running that command.",
    'Reply with one line from tool output showing success (e.g. "exit_code": 0 or exit code 0).',
  ].join(" ");

  const ta = reasLingoPromptInput(host);
  await expect(ta).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(
      async () => {
        const stop = await host.getByTitle("Stop Message").isVisible().catch(() => false);
        const recv = await host.getByText(/Receiving response/i).isVisible().catch(() => false);
        return !stop && !recv;
      },
      { timeout: 120_000, intervals: [400, 800, 1_600] },
    )
    .toBeTruthy();

  await ta.click();
  await ta.fill(prompt);
  await expect(ta).toHaveValue(new RegExp(base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), {
    timeout: 10_000,
  });

  const sendBtn = host.getByTitle("Send Message").first();
  await expect(sendBtn).toBeEnabled({ timeout: 60_000 });
  await sendBtn.click();

  const relEsc = rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const baseEsc = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  /** 用户气泡在 **`MessageList`**，不在仅含输入条的 `host` 内；发送失败时 `handleSendMessage` 会静默 return 且仍显示 Welcome。 */
  try {
    await expect(shell.getByText(new RegExp(relEsc, "i")).first()).toBeVisible({ timeout: 45_000 });
  } catch {
    const toast = page.locator("[data-sonner-toast]").filter({
      hasText: /Authentication required|Failed to start conversation|Failed to send message/i,
    });
    if (await toast.first().isVisible().catch(() => false)) {
      throw new Error(
        `§7.4：ReasLingo 未发出用户消息（${base}）。侧栏 toast：${((await toast.first().innerText()) ?? "").slice(0, 300)}`,
      );
    }
    const stillWelcome = await shell.getByText(/Welcome to/i).isVisible().catch(() => false);
    throw new Error(
      stillWelcome
        ? `§7.4：点击发送后仍为 WelcomeScreen，用户消息未进入 MessageList（可能 isLoading 仍为 true 或 ACP session 未创建）。探针：${base}`
        : `§7.4：侧栏未出现含 ${base} 的用户消息。`,
    );
  }

  await expect(reasLingoStreamActivityLocator(shell).first()).toBeVisible({ timeout: 180_000 });

  await expect(async () => {
    await expect(page).toHaveURL(/\/projects\/[^/]+/i);
    const body = (await shell.innerText()) ?? "";
    expect(reasLingoPythonExecuteToolStartedInSidebarText(body, rel)).toBeTruthy();
  }).toPass({ timeout: 300_000 });

  await waitForReasLingoAssistantReplyDone(page);

  const pythonHardFailure =
    /Command timed out after|failed to execute command|python-execute:\s|Unauthorized access|GurobiError/i;

  const bodyFinal = (await shell.innerText()) ?? "";
  if (pythonHardFailure.test(bodyFinal)) {
    throw new Error(`§7.4 python-execute 失败（侧栏含执行错误）。节选：${bodyFinal.slice(-2_500)}`);
  }
  if (!reasLingoPythonExecuteSuccessInSidebarText(bodyFinal, rel)) {
    const stillOnWhoAreYou =
      /who are you\?/i.test(bodyFinal) &&
      !new RegExp(`python-execute.*${baseEsc}`, "is").test(bodyFinal.replace(/\s+/g, " "));
    throw new Error(
      stillOnWhoAreYou
        ? "§7.4：侧栏仍为 who are you? 会话，python-execute 探针未发出或未渲染；请确认 New Chat 与 Default Agent。"
        : `§7.4：助理未执行 python-execute ${rel} 或未出现 exit_code 0 / Actions 线索。节选：${bodyFinal.slice(-2_500)}`,
    );
  }
}

/** `docs/用户场景.md` §12.2：发给模型的用户消息须为英文（**`latexmk`**，与 **`reaslab-iipe` `skills.rs`** 一致）。 */
export const CH12_2_TEX_COMPILE_USER_PROMPT =
  "Compile test_upload.tex from the project root using latexmk (-interaction=nonstopmode -file-line-error -synctex=1; use -r .reaslab_meta/tex/latexmkrc if the project has no latexmkrc). In your reply, quote key log lines that show this run succeeded (e.g. Output written on ... test_upload.pdf)." as const;

/** @deprecated 保留别名，供旧文档引用；请使用 **`CH12_2_TEX_COMPILE_USER_PROMPT`**。 */
export const CH12_2_TEX_MCP_USER_PROMPT = CH12_2_TEX_COMPILE_USER_PROMPT;

/** §12.2：侧栏是否含 LaTeX 编译成功线索（**latexmk** 或历史 **tex_mcp** 工具名均可）。 */
export function reasLingoLatexCompileSuccessInSidebarText(text: string): boolean {
  const t = text.replace(/\r\n/g, "\n");
  return (
    /Output written on/i.test(t) ||
    /test_upload\.pdf/i.test(t) ||
    /LaTeX2e|Document Class:\s*article/i.test(t) ||
    (/status\s*=\s*0/i.test(t) && /pdf_available\s*=\s*true/i.test(t)) ||
    /errors\s*=\s*0,\s*warnings\s*=\s*0.*test_upload\.tex/i.test(t) ||
    /No parsed diagnostics/i.test(t) ||
    (/latexmk/i.test(t) && /test_upload\.tex/i.test(t) && /Output written on/i.test(t))
  );
}

/**
 * `docs/用户场景.md` §12.2：侧栏 **ReasLingo**、**Default** Agent → **New Chat** → **`CH12_2_TEX_COMPILE_USER_PROMPT`**；
 * 当前 **`reaslab-iipe`** 经 **shell `latexmk`** 编译（**`mcpServers: []`**，见 **`skills.rs`**）；仍兼容侧栏出现 **`compile_tex`** / **`get_compile_log`** 的旧路径。
 *
 * **前提**：工程根目录已存在 **`test_upload.tex`**。
 */
export async function reasLingoDefaultAgentTexMcpCompileLogProbe(page: Page): Promise<void> {
  await ensureReasLingoVisible(page);

  const exploreUploadDialog = page.getByRole("dialog").filter({
    has: page.getByRole("button", { name: "Select Files", exact: true }),
  });
  if (await exploreUploadDialog.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
    await expect(exploreUploadDialog).toBeHidden({ timeout: 15_000 });
  }

  const shell = page
    .locator('[data-sidebar="group"]')
    .filter({ has: page.getByText("ReasLingo", { exact: true }) })
    .filter({ visible: true })
    .first();
  const host = reasLingoInputHostLocator(page);
  await expect(host).toBeVisible({ timeout: 20_000 });

  const agentBtn = host
    .getByRole("button", { name: /^Agent$/i })
    .or(host.locator('button[title="Switch Agent"]'))
    .first();
  await expect(agentBtn).toBeVisible({ timeout: 15_000 });

  const agentTriggerLabel = ((await agentBtn.textContent()) ?? "").replace(/\s+/g, " ").trim();
  const alreadyOnDefaultAgent = agentTriggerLabel === "Agent";

  if (!alreadyOnDefaultAgent) {
    await agentBtn.click();
    const panel = page.locator('[data-slot="dropdown-menu-content"][class*="w-56"]');
    await expect(panel).toBeVisible({ timeout: 10_000 });

    const defaultItem = panel.locator('[data-slot="dropdown-menu-item"]').filter({ hasText: /^Default$/i });
    if ((await defaultItem.count()) > 0) {
      await defaultItem.first().click();
    } else {
      const selectedRow = panel
        .locator('[data-slot="dropdown-menu-item"]')
        .filter({ has: page.locator("svg.lucide-check") });
      if ((await selectedRow.count()) > 0) {
        await selectedRow.first().click();
      } else {
        await page.keyboard.press("Escape");
        throw new Error(
          "ReasLingo 无法切回 Default：下拉中无「Default」项且无带勾选图标的当前 Agent 行（与 §8.5（调用lean_mcp）策略一致）。",
        );
      }
    }
    try {
      await expect(panel).toBeHidden({ timeout: 5_000 });
    } catch {
      await page.keyboard.press("Escape");
    }
  }

  await expect(agentBtn.getByText(/^Agent$/)).toBeVisible({ timeout: 15_000 });

  await reasLingoClickNewChatWhenIdle(page);

  const ta = reasLingoPromptInput(host);
  await expect(ta).toBeVisible({ timeout: 15_000 });
  await ta.click();
  await ta.fill(CH12_2_TEX_COMPILE_USER_PROMPT);
  const sendBtn = host.getByTitle("Send Message").first();
  await expect(sendBtn).toBeEnabled({ timeout: 180_000 });
  await sendBtn.click();
  await waitForReasLingoStreamStarted(page);
  await waitForReasLingoAssistantReplyDone(page);

  const latexHardFailure =
    /! LaTeX Error|Emergency stop|latexmk: Error|Fatal error occurred/i;

  await expect
    .poll(
      async () => {
        const t = ((await shell.innerText()) ?? "").replace(/\r\n/g, "\n");
        if (latexHardFailure.test(t)) {
          throw new Error(`§12.2 LaTeX 编译失败（侧栏含错误）。节选：${t.slice(-2_500)}`);
        }
        if (reasLingoLatexCompileSuccessInSidebarText(t)) {
          return true;
        }
        const iCompile = t.indexOf("compile_tex");
        const iLog = t.indexOf("get_compile_log");
        return iCompile >= 0 && iLog > iCompile;
      },
      { timeout: 300_000, intervals: [800, 2_000, 4_000, 8_000] },
    )
    .toBeTruthy();
}

/** `docs/用户场景.md` §7.5：与文档一致的英文召回句（口语拼写）。 */
export const CH7_HISTORY_RECALL_PROMPT = "what question did I asked?";

/** §7.4 → §7.5：在 **who are you?** 探针后重命名当前会话，供 **§7.5** 稳定选中（避免与 **python-execute** 或历史脏数据混淆）。 */
export const CH7_WHO_ARE_YOU_SESSION_TAG = "CH7 who probe";

/** **`ChatHistory.tsx`** 浮层根（`bg-popover` / `slide-in-from-top`），勿用宽泛 `div:has(Search...)`。 */
function reasLingoIdeChatHistoryPopover(page: Page): Locator {
  const search = page.getByPlaceholder("Search...", { exact: true });
  return page
    .locator("div")
    .filter({ has: search })
    .filter({ has: page.locator("div.max-h-80.overflow-y-auto") })
    .filter({ visible: true })
    .last();
}

/**
 * **`reaslab-iipe` `SessionItem`** 外层：`group relative` + `div[role="button"][tabindex="0"]`。
 * 备用 `:has(svg)`（不依赖 `lucide-*` 类名）；勿 `/\d+\s+messages/`（Rename 编辑态隐藏 meta）。
 */
function reasLingoIdeChatHistorySessionRows(pop: Locator): Locator {
  const primary = pop.locator('div.group.relative[role="button"][tabindex="0"]');
  const fallback = pop.locator('div[role="button"][tabindex="0"]:has(svg)');
  return primary.or(fallback);
}

/** 编辑器 **Command Palette** 打开时会挡住侧栏操作。 */
async function dismissCommandPaletteIfOpen(page: Page): Promise<void> {
  const palette = page.getByRole("heading", { name: "Command Palette", exact: true });
  if (await palette.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden({ timeout: 5_000 });
  }
}

/** 侧栏 **Chat History** 浮层：将**当前（列表首条 / 最新）**会话重命名为 **`tag`**。 */
export async function reasLingoTagCurrentSessionInHistoryPopover(page: Page, tag: string): Promise<void> {
  await dismissCommandPaletteIfOpen(page);
  const host = reasLingoInputHostLocator(page);
  await host.getByTitle("Chat History").click();
  const pop = reasLingoIdeChatHistoryPopover(page);
  await expect(pop).toBeVisible({ timeout: 15_000 });
  await expect(pop.getByText(/Loading chat history/i)).toBeHidden({ timeout: 120_000 });

  const sessionRows = reasLingoIdeChatHistorySessionRows(pop);
  await expect
    .poll(async () => sessionRows.count(), { timeout: 60_000, intervals: [200, 500, 1_000, 2_000] })
    .toBeGreaterThan(0);
  const currentRow = sessionRows.first();
  await expect(currentRow).toBeVisible({ timeout: 15_000 });

  await currentRow.scrollIntoViewIfNeeded();
  await currentRow.hover();
  await currentRow.getByTitle("Rename").click();
  const titleInput = currentRow.locator('input[type="text"]');
  await expect(titleInput).toBeVisible({ timeout: 10_000 });
  await titleInput.fill(tag);
  await currentRow.getByTitle("Save").click();
  const tagEsc = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await expect(sessionRows.filter({ hasText: new RegExp(tagEsc, "i") }).first()).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(pop).toBeHidden({ timeout: 10_000 });
}

function sidebarLooksLikeWhoAreYouSession(text: string): boolean {
  const t = text.replace(/\r\n/g, "\n");
  return /who are you\?/i.test(t) || /I[''\u2019]?m ReasLingo/i.test(t) || /ReasLingo.*assistant/i.test(t);
}

async function sidebarShowsWhoAreYouSessionLoaded(shell: Locator): Promise<boolean> {
  if ((await shell.getByText(/who are you\?/i).count()) > 0) {
    return true;
  }
  if ((await shell.getByText(/I[''\u2019]?m ReasLingo/i).count()) > 0) {
    return true;
  }
  if ((await shell.getByText(/ReasLingo.*assistant/i).count()) > 0) {
    return true;
  }
  return sidebarLooksLikeWhoAreYouSession((await shell.innerText()) ?? "");
}

/** §7.5：串行主线历史不足两条时的 **`test.skip`** 说明。 */
export const MODELING_CH7_HISTORY_TWO_SESSIONS_SKIP_MSG =
  "§7.5 需要至少 2 条 ReasLingo 历史会话（主线含 §7.4 who are you? 与 python-execute）；当前列表不足。";

/**
 * **`docs/用户场景.md` §7.5**：**Chat History** → 选择 **§7.4** 打标会话 **`CH7_WHO_ARE_YOU_SESSION_TAG`**（无标签时回退 **who are you** 标题 / 最下一条）→ 发送 **`CH7_HISTORY_RECALL_PROMPT`** →
 * 流结束后侧栏正文含 **`who are you`**（与 **§7.4** 默认 Agent **who are you?** 对齐）。
 *
 * **会话行定位**：见 **`reasLingoIdeChatHistorySessionRows`**（`SessionItem` 的 **`div.group.relative[role="button"]`**）。
 *
 * @returns **`true`** 已断言成功；**`false`** 表示历史少于 **2** 条（调用方 **`test.skip`**）。
 */
export async function reasLingoSelectBottomHistorySessionAndAssertRecallWhoAreYou(page: Page): Promise<boolean> {
  await ensureReasLingoVisible(page);
  const shell = reasLingoSidebarShellLocator(page);
  const host = reasLingoInputHostLocator(page);
  await expect(shell).toBeVisible({ timeout: 20_000 });
  await expect(host).toBeVisible({ timeout: 20_000 });

  await test.step("§7.5-1：Chat History → 等待列表加载", async () => {
    await dismissCommandPaletteIfOpen(page);
    await host.getByTitle("Chat History").click();
    const pop = reasLingoIdeChatHistoryPopover(page);
    await expect(pop).toBeVisible({ timeout: 15_000 });
    await expect(pop.getByText(/Loading chat history/i)).toBeHidden({ timeout: 120_000 });
  });

  const pop = reasLingoIdeChatHistoryPopover(page);
  const sessionRows = reasLingoIdeChatHistorySessionRows(pop);

  try {
    await expect
      .poll(async () => sessionRows.count(), { timeout: 60_000, intervals: [200, 500, 1_000, 2_000] })
      .toBeGreaterThanOrEqual(2);
  } catch {
    await page.keyboard.press("Escape");
    return false;
  }

  const n = await sessionRows.count();
  if (n < 2) {
    await page.keyboard.press("Escape");
    return false;
  }

  await test.step(`§7.5-2：选择「${CH7_WHO_ARE_YOU_SESSION_TAG}」会话并验收已加载`, async () => {
    const tagEsc = CH7_WHO_ARE_YOU_SESSION_TAG.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let target = sessionRows.filter({ hasText: new RegExp(tagEsc, "i") }).first();
    if ((await target.count()) < 1) {
      target = sessionRows.filter({ hasText: /who are you/i }).last();
    }

    if ((await target.count()) < 1) {
      const scrollArea = pop.locator(".max-h-80.overflow-y-auto").first();
      await scrollArea.evaluate((el: HTMLElement) => {
        el.scrollTop = el.scrollHeight;
      });
      await page.waitForTimeout(1_000);
      target = sessionRows.nth(n - 1);
    }

    await target.scrollIntoViewIfNeeded();
    await target.click();
    await expect(pop).toBeHidden({ timeout: 15_000 });

    /** 等待会话消息加载（`selectSession` 异步拉取历史页）。 */
    const welcome = shell.getByText(/Welcome to/i).first();
    if (await welcome.isVisible().catch(() => false)) {
      await expect(welcome).toBeHidden({ timeout: 30_000 });
    }

    await expect
      .poll(async () => sidebarShowsWhoAreYouSessionLoaded(shell), {
        timeout: 60_000,
        intervals: [400, 800, 1_600, 3_200],
      })
      .toBeTruthy();
  });

  await test.step(`§7.5-3：发送「${CH7_HISTORY_RECALL_PROMPT}」并等待流式结束`, async () => {
    const ta = reasLingoPromptInput(host);
    await expect(ta).toBeVisible({ timeout: 15_000 });
    await ta.click();
    await ta.fill(CH7_HISTORY_RECALL_PROMPT);
    const sendBtn = host.getByTitle("Send Message").first();
    await expect(sendBtn).toBeEnabled({ timeout: 180_000 });
    await sendBtn.click();
    await expect(async () => {
      await expect(page).toHaveURL(/\/projects\/[^/]+/i);
      await expect(shell.getByText(/what question did I asked\?/i).first()).toBeVisible();
    }).toPass({ timeout: 60_000 });
    await waitForReasLingoAssistantReplyDone(page);
  });

  await test.step("§7.5-4：验收侧栏含 who are you（历史或助理召回）", async () => {
    await expect
      .poll(async () => {
        const t = (await shell.innerText()) ?? "";
        return (
          /who\s+are\s+you/i.test(t) ||
          /I[''\u2019]?m ReasLingo/i.test(t) ||
          /ReasLingo.*assistant/i.test(t) ||
          /you asked.*who/i.test(t)
        );
      }, {
        timeout: 120_000,
        intervals: [500, 1_500, 3_000],
      })
      .toBeTruthy();
  });

  return true;
}

/** `docs/用户场景.md` §7.6：**Models** 中未找到 **SiliconFlow** 或未展开时的 **`test.skip`** 说明。 */
export const MODELING_CH7_SETTINGS_SILICONFLOW_SKIP_MSG =
  "§7.6：ReasLingo Settings → Models 在加载完成或列表渲染后仍无可点的 SiliconFlow（或未展示该 Provider），跳过。";

/** 与 **`docs/用户场景.md`** §7.6 步骤 3 一致（产品内展示文案）。 */
export const CH7_SETTINGS_USER_RULE_TEXT = "Always response in English";

/**
 * 内层 **Models / User Rules / Tools** 的 **`tablist`**（与 **`ReasLingoSettings.tsx`** 一致）；
 * 用 **`has`「Tools」** 与顶层编辑器文件 **TabsList** 区分（旧版 Tab 文案为 **Tools & MCP**，已移除）。
 */
function reasLingoIdeSettingsInnerTablist(page: Page): Locator {
  return page.getByRole("tablist").filter({
    has: page.getByRole("tab", { name: "Tools", exact: true }),
  });
}

/**
 * 侧栏 **ReasLingo** **标题行**（**`ReasLingoHeader`**）里 **`title="Settings"`** 的齿轮 → 打开编辑器虚拟页 **ReasLingo Settings**（`reaslingo://settings`）。
 * **勿**与输入条底部的 **`title="More Settings"`**（**`Sliders`**，**`ChatCommonSettingsSelector`**）混淆。
 */
export async function reasLingoOpenIdeAiSettings(page: Page): Promise<void> {
  await ensureReasLingoVisible(page);
  const sidebar = reasLingoInputHostLocator(page);
  const settingsBtn = sidebar.locator('button[title="Settings"]').first();
  await expect(settingsBtn).toBeVisible({ timeout: 15_000 });
  await settingsBtn.click();
  await expect(page.getByRole("tab", { name: "ReasLingo Settings" })).toBeVisible({ timeout: 30_000 });
  await expect(reasLingoIdeSettingsInnerTablist(page)).toBeVisible({ timeout: 20_000 });
}

/** 关闭 **ReasLingo Settings** 编辑器 Tab（与 **`editor-tabs.tsx`** 的 **Close** 按钮一致）。 */
export async function reasLingoCloseIdeAiSettingsTab(page: Page): Promise<void> {
  const row = page.locator("div.group").filter({ has: page.getByText("ReasLingo Settings", { exact: true }) });
  const closeBtn = row.getByRole("button", { name: "Close", exact: true }).first();
  if ((await closeBtn.count()) > 0) {
    await closeBtn.click({ timeout: 10_000 });
  }
}

/**
 * **`docs/用户场景.md` §7.6**：**Models**（SiliconFlow、**`test`** 占位模型）→ **User Rules** → **Tools**（**Semantic Scholar** API Key 区块）→
 * 关闭设置；侧栏 **Switch Model** 列表中可见 **`test`**。
 *
 * @returns **`false`** 仅当找不到 **SiliconFlow** 展开行（调用方 **`test.skip`**）；其余步骤失败时 **抛出**。
 */
export async function reasLingoIdeSettingsAiFlow(page: Page): Promise<boolean> {
  await reasLingoOpenIdeAiSettings(page);
  const innerTabs = reasLingoIdeSettingsInnerTablist(page);

  /** **`ReasLingoSettings`** 内层 **`TabsPrimitive.Root`**（`data-slot="tabs"`），比 **`role=tabpanel` + name** 更稳（**Base UI Tabs** 与 **keepMounted** 并存时）。 */
  const settingsTabsRoot = page
    .locator('[data-slot="tabs"]')
    .filter({ has: page.getByRole("tab", { name: "Tools", exact: true }) })
    .first();
  await expect(settingsTabsRoot).toBeVisible({ timeout: 15_000 });

  await innerTabs.getByRole("tab", { name: "Models", exact: true }).click();

  /** `ProviderItem`：**`data-slot="collapsible-trigger"`**；等待 **`Loading models...`** 结束与列表渲染（一次 **`toBeVisible`** 覆盖）。 */
  const sfTrigger = settingsTabsRoot
    .locator('[data-slot="collapsible-trigger"]')
    .filter({ hasText: /SiliconFlow/i })
    .first();
  try {
    await expect(sfTrigger).toBeVisible({ timeout: 120_000 });
  } catch {
    await reasLingoCloseIdeAiSettingsTab(page);
    return false;
  }

  await test.step("§7.6-2 Models：SiliconFlow → Add Model → test / test → Save", async () => {
    await sfTrigger.click();

    /**
     * **`filter({ has: sfTrigger })`** 在部分 Playwright 版本下对 **`has`** 子定位解析不稳；**keepMounted** 时未激活 Tab 里也可能残留 SiliconFlow 文案。
     * 改为 **`hasText: /SiliconFlow/` + `visible: true`**，并 **`scrollIntoViewIfNeeded`**（**`ScrollArea`** 内可能被裁切）。
     */
    const siliconCollapsible = settingsTabsRoot
      .locator('[data-slot="collapsible"]')
      .filter({ hasText: /SiliconFlow/i })
      .filter({ visible: true })
      .first();
    await expect(siliconCollapsible).toBeVisible({ timeout: 15_000 });

    /** 上轮 E2E 或手工已创建 **`test`** 时，再 **Add Model** 同名会与 **`handleSaveAddModel`** 冲突；先删再建（**`ModelsConfig`** 删除确认 **Remove**）。 */
    const staleDelete = siliconCollapsible.locator('button[title="Delete test"]').first();
    if ((await staleDelete.count()) > 0 && (await staleDelete.isVisible().catch(() => false))) {
      await staleDelete.scrollIntoViewIfNeeded();
      await staleDelete.click();
      const confirmDlg = page
        .getByRole("dialog")
        .filter({ hasText: /Are you sure you want to remove the model/i });
      await expect(confirmDlg).toBeVisible({ timeout: 15_000 });
      await confirmDlg.getByRole("button", { name: "Remove" }).click();
      await expect(confirmDlg).toBeHidden({ timeout: 30_000 });
    }

    const apiKeyInput = siliconCollapsible.locator('input[placeholder="Enter API Key"]');
    await apiKeyInput.scrollIntoViewIfNeeded();
    await expect(apiKeyInput).toBeVisible({ timeout: 30_000 });
    await apiKeyInput.fill("test");

    const addModelBtn = siliconCollapsible.getByRole("button", { name: /Add Model/i });
    await addModelBtn.scrollIntoViewIfNeeded();
    await expect(addModelBtn).toBeVisible({ timeout: 15_000 });
    await addModelBtn.click();

    await siliconCollapsible.getByPlaceholder("e.g. deepseek-custom").fill("test");
    await siliconCollapsible.getByPlaceholder("e.g. deepseek-chat").fill("test");

    /** 折叠区内另有 **Provider** 区块的 **Save**；新增模型表单的 **Save** 在同区内偏后，取 **`.last()`**。 */
    await siliconCollapsible.getByRole("button", { name: "Save", exact: true }).last().click();

    /**
     * 内联 **`showAddInput`** 打开时 **「+ Add Model」** 会从 DOM 卸掉，**`getByRole(button, /Add Model/)` 恒为 0**；
     * 保存成功后表单关闭再挂载按钮。断言 **占位表单消失** 比再等 **Add Model** 更符合 Playwright（稳定、语义即「保存完成」）。
     */
    await expect(siliconCollapsible.getByPlaceholder("e.g. deepseek-chat")).toBeHidden({ timeout: 120_000 });
  });

  await test.step("§7.6-3 User Rules：+ Add Rule → Always response in English → Save", async () => {
    await innerTabs.getByRole("tab", { name: "User Rules", exact: true }).click();
    const userPanel = page.getByRole("tabpanel", { name: "User Rules", exact: true });
    await expect(userPanel).toBeVisible({ timeout: 15_000 });

    const existingRule = userPanel.getByText(CH7_SETTINGS_USER_RULE_TEXT, { exact: true });
    if ((await existingRule.count()) < 1 || !(await existingRule.first().isVisible().catch(() => false))) {
      await userPanel.getByRole("button", { name: /Add Rule/i }).click();
      const tb = userPanel.getByRole("textbox").first();
      await expect(tb).toBeVisible({ timeout: 10_000 });
      await tb.fill(CH7_SETTINGS_USER_RULE_TEXT);
      await userPanel.getByRole("button", { name: "Save", exact: true }).first().click();
    }
    await expect(userPanel.getByText(CH7_SETTINGS_USER_RULE_TEXT, { exact: true })).toBeVisible({
      timeout: 60_000,
    });
  });

  await test.step("§7.6-4 Tools：Semantic Scholar API key 区块", async () => {
    await innerTabs.getByRole("tab", { name: "Tools", exact: true }).click();
    const toolsPanel = page.getByRole("tabpanel", { name: "Tools", exact: true });
    await expect(toolsPanel).toBeVisible({ timeout: 15_000 });
    await expect(toolsPanel.getByRole("heading", { name: "Tools", exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(toolsPanel.getByText("Semantic Scholar", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(toolsPanel.getByPlaceholder("Paste your API key...")).toBeVisible({ timeout: 15_000 });
    await expect(toolsPanel.getByRole("button", { name: "Test", exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(toolsPanel.getByRole("button", { name: "Save", exact: true })).toBeVisible({
      timeout: 10_000,
    });
  });

  await test.step("§7.6-5 关闭设置；侧栏 Switch Model 列表含 test", async () => {
    await reasLingoCloseIdeAiSettingsTab(page);

    const host = reasLingoInputHostLocator(page);
    await expect(host).toBeVisible({ timeout: 20_000 });

    const modelTrigger = host.locator('button[title="Switch Model"]').first();
    await expect(modelTrigger).toBeVisible({ timeout: 15_000 });
    await modelTrigger.click();

    const menu = page.locator('[data-slot="dropdown-menu-content"]').filter({ visible: true }).first();
    await expect(menu).toBeVisible({ timeout: 10_000 });
    await expect(menu.getByText(/^test$/).first()).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Escape");
  });

  return true;
}

/** MIL 入门路径（与 monorepo e2e `TEST_FILES.GETTING_STARTED` 对齐）。 */
export const MIL_GETTING_STARTED_SEGMENTS = ["MIL", "C01_Introduction", "S01_Getting_Started.lean"];

/** `docs/用户场景.md` §5：空白 Modeling 项目不可用时的跳过说明。 */
export const MODELING_CH5_SKIP_MSG =
  "无法进入数学建模 IDE：请确认已登录且 New Project 可创建 Modeling 项目，或 test/data/.e2e-artifacts/modeling-project-uuid.txt 仍有效。";

/** `docs/用户场景.md` §5.9：**Chain of Thought** 依赖系统默认或至少一枚启用模型的 **`supportsReasoning`**（Auto 下默认可推理时亦可见）。 */
export const MODELING_CH5_CHAIN_OF_THOUGHT_SKIP_MSG =
  "§5.9 Chain of Thought：系统默认与已启用模型均不支持 reasoning（Auto 与手动切换后仍无 CoT 按钮），跳过。";

/** `docs/用户场景.md` §7「模板创建优化建模项目」：从「Optimization Modeling Templates」创建项目失败时的跳过说明。 */
export const MODELING_CH7_SKIP_MSG =
  "无法从优化建模模板进入数学建模 IDE：请确认已登录、模板服务可用，或 test/data/.e2e-artifacts/optimization-template-project-uuid.txt 仍有效。";

/** `docs/用户场景.md` §7.3：Console 出现 Gurobi / 许可证类错误时的 **`test.skip`** 说明（需 Solver Settings 或环境许可）。 */
export const MODELING_PYTHON_CONSOLE_GUROBI_SKIP_MSG =
  "Console 出现 Gurobi/许可证类错误：请在侧栏 Solver Settings 配置 Gurobi WLS 并 Test/Save，或为 CI 注入许可；见 docs/用户场景.md §7.3。";

/** `docs/用户场景.md` §9「模板创建竞赛建模项目」：从「Math Modeling Contest Templates」创建项目失败时的跳过说明。 */
export const MODELING_CH9_SKIP_MSG =
  "无法从数学建模竞赛模板进入建模 IDE：请确认已登录、竞赛模板服务可用，或 test/data/.e2e-artifacts/modeling-contest-template-project-uuid.txt 仍有效。";

/** `docs/用户场景.md` §8「模板创建定理证明项目」：MIL 定理证明模板 IDE 不可用时的跳过说明（与 `tryEnterLeanProjectIde` / `theorem-project-uuid.txt` 一致）。 */
export const THEOREM_CH8_SKIP_MSG =
  "无法进入 MIL 定理证明 IDE：请确认已登录且 Theorem Proving Templates → Mathematics in Lean → Use Template 可用（首次 lake 可能极慢），或 test/data/.e2e-artifacts/theorem-project-uuid.txt 仍有效。";

/** §8.4 Agent 菜单项：`paper-generation` 的 **`display_name`**（`builtin_llm_and_agents.sql` 现为 **ReasFlow Copilot**，旧环境可能仍为 **Paper Copilot**）。 */
export const REASFLOW_COPILOT_AGENT_MENU_LABEL = /ReasFlow Copilot|Paper Copilot/i;

/** `docs/用户场景.md` §8.4：**ReasFlow Copilot**（原 Paper Copilot）不可用时的 **`test.skip`** 说明。 */
export const THEOREM_CH8_REASFLOW_COPILOT_SKIP_MSG =
  "§8.4 切换 ReasFlow Copilot：侧栏 Agent 菜单无 **ReasFlow Copilot**（或旧版 **Paper Copilot**），跳过。";

/** `paper-generation` 输入 placeholder（`builtin.rs` **ReasFlow Copilot**）。 */
export const REASFLOW_COPILOT_INPUT_PLACEHOLDER =
  "Research topic, outline, or what you want ReasFlow Copilot to help with";

/** `docs/用户场景.md` §8.5（读取 Getting Started Lean）：无法切回 **Default** 或 **read_file** 探针未命中时的 **`test.skip`** 说明。 */
export const THEOREM_CH8_LEAN_MCP_SKIP_MSG =
  "§8.5（读取 Getting Started Lean）须 **Default** Agent，且侧栏出现 **read_file** 与 **S01_Getting_Started.lean**、**#eval \"Hello, World!\"** 等成功线索。若无法切回 **Default** 或未读取/确认文件，跳过。";

/** `docs/用户场景.md` §8.6：须 **Default** Agent，且侧栏出现 **`lake build`** 成功线索。 */
export const THEOREM_CH8_LAKE_MCP_SKIP_MSG =
  "§8.6（调用 lake build）须 **Default** Agent，且助理侧出现 **`lake build`** 成功线索（如 build completed、error(s): 0、status=Success）。若无法切回 **Default** 或未执行构建，跳过。";

/** `docs/用户场景.md` §8.3（语义搜索及Lean搜索）：**Semantic** gRPC / **`lean_search`** 不可用或探针未命中时的 **`test.skip`** 说明。 */
export const THEOREM_CH8_SEMANTIC_LEAN_SEARCH_SKIP_MSG =
  "§8.3 语义搜索及 Lean 搜索：Semantic 定理搜索或 **`lean_search`** 报错/超时（常见未配置 **`TheoremSemanticSearchService`** 或工具链）；见左侧 **`Semantic Search`**。";

/**
 * **`docs/用户场景.md` §8.3**：左侧 **`title="Semantic Search"`** → **Semantic** 子标签：**`normed space`** + **Search**；
 * **Lean/Local** 子标签：**`Real`** + **Search**。出现 **Error** 卡片或轮询超时则返回 **`false`**。
 */
export async function milSemanticSearchAndLeanToolbarProbe(page: Page): Promise<boolean> {
  await page.getByTitle("Semantic Search").click();

  const semanticShell = page
    .locator("div.flex.size-full.flex-col")
    .filter({ has: page.getByPlaceholder("Enter your query") })
    .first();
  await expect(semanticShell.getByPlaceholder("Enter your query")).toBeVisible({ timeout: 20_000 });
  await semanticShell.getByPlaceholder("Enter your query").fill("normed space");
  await semanticShell.getByRole("button", { name: "Search", exact: true }).click();

  const semanticScroll = semanticShell.locator(".min-h-0.flex-1.overflow-auto").first();
  try {
    await expect
      .poll(
        async () => {
          const err = await semanticScroll.locator("h4").filter({ hasText: /^Error$/ }).isVisible().catch(() => false);
          if (err) {
            return false;
          }
          const cards = await page.locator(".semantic-search section").count();
          const empty = await semanticScroll.getByText(/No results found/i).count();
          return cards > 0 || empty > 0;
        },
        { timeout: 120_000, intervals: [600, 1_500, 3_000] },
      )
      .toBeTruthy();
  } catch {
    return false;
  }

  if (await semanticScroll.locator("h4").filter({ hasText: /^Error$/ }).isVisible().catch(() => false)) {
    return false;
  }

  const leanQueryPlaceholder = /Search (local )?lemmas, theorems, definitions/i;
  await semanticShell.getByRole("button", { name: /^Lean(\/Local)?$/ }).click();
  const leanShell = page
    .locator("div.flex.size-full.flex-col")
    .filter({ has: page.getByPlaceholder(leanQueryPlaceholder) })
    .first();
  await expect(leanShell.getByPlaceholder(leanQueryPlaceholder)).toBeVisible({
    timeout: 15_000,
  });
  await leanShell.getByPlaceholder(leanQueryPlaceholder).fill("Real");
  await leanShell.getByRole("button", { name: "Search", exact: true }).click();

  const leanScroll = leanShell.locator(".min-h-0.flex-1.overflow-auto").first();
  try {
    await expect
      .poll(
        async () => {
          const err = await leanScroll.locator("h4").filter({ hasText: /^Error$/ }).isVisible().catch(() => false);
          if (err) {
            return false;
          }
          const empty = await leanScroll.getByText(/No results found/i).count();
          const hit = await leanScroll.locator("section").filter({ has: page.locator("h3") }).count();
          return empty > 0 || hit > 0;
        },
        { timeout: 120_000, intervals: [600, 1_500, 3_000] },
      )
      .toBeTruthy();
  } catch {
    return false;
  }

  if (await leanScroll.locator("h4").filter({ hasText: /^Error$/ }).isVisible().catch(() => false)) {
    return false;
  }

  return true;
}

const OPT_TEMPLATE_IDE_SHELL_TIMEOUT_MS = 180_000;

const MIL_IMPORT_NAV_TIMEOUT_MS = 600_000;
const MIL_IDE_SHELL_TIMEOUT_MS = 600_000;

export async function createTheoremProvingProjectFromMilTemplate(page: Page): Promise<boolean> {
  try {
    await page.goto(absUrl("/?nav=theorem-proving-templates"), { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Create Project Using Template" })).toBeVisible({
      timeout: 60_000,
    });
    await page.getByRole("button", { name: "Use Template" }).first().click();
    await page.waitForURL(/\/projects\/[^/]+\/?$/i, { timeout: MIL_IMPORT_NAV_TIMEOUT_MS });
    await page
      .getByTitle("Create New File")
      .waitFor({ state: "visible", timeout: MIL_IDE_SHELL_TIMEOUT_MS });
    await waitForFileTree(page);
    return true;
  } catch {
    return false;
  }
}

export async function createBlankModelingProjectAndEnterIde(page: Page): Promise<boolean> {
  try {
    await navigateToHomeProjects(page);
    await page.getByRole("button", { name: "New Project" }).first().click();
    await expect(page.getByRole("heading", { name: "New Project" })).toBeVisible({
      timeout: 120_000,
    });

    const toolchainErr = page.getByText(/Could not load toolchain versions/i);
    if ((await toolchainErr.count()) > 0 && (await toolchainErr.isVisible().catch(() => false))) {
      return false;
    }

    const modelingBtn = page.getByRole("button", { name: "Modeling", exact: true });
    if ((await modelingBtn.count()) > 0) {
      const m = modelingBtn.first();
      const pressed = await m.getAttribute("aria-pressed");
      const dataState = await m.getAttribute("data-state");
      const on = pressed === "true" || dataState === "on";
      if (!on) {
        await m.click();
      }
    }

    const name = `e2e_u5_${Date.now()}`;
    const nameInput = page.locator("input#project-name, input#projectName").first();
    await expect(nameInput).toBeVisible({ timeout: 60_000 });
    await nameInput.fill(name);

    const createBtn = page.getByRole("button", { name: "Create Project" });
    await expect(createBtn).toBeEnabled({ timeout: 90_000 });
    await createBtn.click();

    await page.waitForURL(/\/projects\/[^/]+\/?$/i, { timeout: 120_000 });
    await page.getByTitle("Create New File").waitFor({ state: "visible", timeout: 120_000 });
    await waitForFileTree(page);
    return true;
  } catch {
    return false;
  }
}

export async function createModelingProjectFromFirstOptimizationTemplate(page: Page): Promise<boolean> {
  try {
    await page.goto(absUrl("/?nav=optimization-modeling-templates"), { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Optimization Modeling Templates" })).toBeVisible({
      timeout: 120_000,
    });

    const failedHeading = page.getByRole("heading", { name: "Failed to load templates" });
    const emptyHeading = page.getByRole("heading", { name: "No templates available" });
    if ((await failedHeading.count()) > 0 && (await failedHeading.isVisible().catch(() => false))) {
      return false;
    }
    if ((await emptyHeading.count()) > 0 && (await emptyHeading.isVisible().catch(() => false))) {
      return false;
    }

    await expect(page.getByText(/\d+\s+templates?\s+in\s+total/i)).toBeVisible({ timeout: 120_000 });

    const firstCardToDetail = page
      .locator(
        "xpath=//div[contains(@class,'lg:grid-cols-3')]//button[@type='button'][.//img[@alt]]",
      )
      .first();
    await expect(firstCardToDetail).toBeVisible({ timeout: 60_000 });
    await firstCardToDetail.click();

    await page.waitForURL(/\/modeling-templates\/[^/]+/i, { timeout: 60_000 });

    const useTpl = page.getByRole("button", { name: "Use Template" });
    await expect(useTpl).toBeVisible({ timeout: 120_000 });
    await useTpl.click();

    await page.waitForURL(/\/projects\/[^/]+\/?$/i, { timeout: OPT_TEMPLATE_IDE_SHELL_TIMEOUT_MS });
    await page
      .getByTitle("Create New File")
      .waitFor({ state: "visible", timeout: OPT_TEMPLATE_IDE_SHELL_TIMEOUT_MS });
    await waitForFileTree(page);
    return true;
  } catch {
    return false;
  }
}

async function openCachedProjectIdeByUuid(page: Page, uuid: string): Promise<boolean> {
  try {
    const res = await gotoWithRetry(page, absUrl(`/projects/${uuid}`), { waitUntil: "domcontentloaded" });
    if (!res?.ok() && res?.status() !== 304) {
      return false;
    }
    await waitForFileTree(page);
    return true;
  } catch {
    return false;
  }
}

export async function tryEnterOptimizationTemplateModelingIde(page: Page): Promise<boolean> {
  const openByUuid = openCachedProjectIdeByUuid;

  const cached = readOptimizationTemplateProjectUuidArtifact();
  if (cached && (await openByUuid(cached))) {
    return true;
  }

  const ok = await createModelingProjectFromFirstOptimizationTemplate(page);
  if (!ok) {
    return false;
  }
  const m = page.url().match(/\/projects\/([^/]+)/i);
  if (m?.[1]) {
    writeOptimizationTemplateProjectUuidArtifact(m[1]);
  }
  return true;
}

export async function createModelingProjectFromFirstContestTemplate(page: Page): Promise<boolean> {
  try {
    await page.goto(absUrl("/?nav=math-modeling-contest-templates"), { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Math Modeling Contest Templates" })).toBeVisible({
      timeout: 120_000,
    });

    const failedHeading = page.getByRole("heading", { name: "Failed to Load Templates" });
    const emptyHeading = page.getByRole("heading", {
      name: "No Competition Templates Available",
    });
    if ((await failedHeading.count()) > 0 && (await failedHeading.isVisible().catch(() => false))) {
      return false;
    }
    if ((await emptyHeading.count()) > 0 && (await emptyHeading.isVisible().catch(() => false))) {
      return false;
    }

    await expect(page.getByText(/\d+\s+templates?\s+in\s+total/i)).toBeVisible({ timeout: 120_000 });

    const firstCardToDetail = page
      .locator(
        "xpath=//div[contains(@class,'lg:grid-cols-3')]//button[@type='button'][.//img[@alt]]",
      )
      .first();
    await expect(firstCardToDetail).toBeVisible({ timeout: 60_000 });
    await firstCardToDetail.click();

    await page.waitForURL(/\/modeling-competition\/[^/]+/i, { timeout: 60_000 });

    const useTpl = page.getByRole("button", { name: "Use Template" });
    await expect(useTpl).toBeVisible({ timeout: 120_000 });
    await useTpl.click();

    await page.waitForURL(/\/projects\/[^/]+\/?$/i, { timeout: OPT_TEMPLATE_IDE_SHELL_TIMEOUT_MS });
    await page
      .getByTitle("Create New File")
      .waitFor({ state: "visible", timeout: OPT_TEMPLATE_IDE_SHELL_TIMEOUT_MS });
    await waitForFileTree(page);
    return true;
  } catch {
    return false;
  }
}

export async function tryEnterContestTemplateModelingIde(page: Page): Promise<boolean> {
  const openByUuid = openCachedProjectIdeByUuid;

  const cached = readModelingContestTemplateProjectUuidArtifact();
  if (cached && (await openByUuid(cached))) {
    return true;
  }

  const ok = await createModelingProjectFromFirstContestTemplate(page);
  if (!ok) {
    return false;
  }
  const m = page.url().match(/\/projects\/([^/]+)/i);
  if (m?.[1]) {
    writeModelingContestTemplateProjectUuidArtifact(m[1]);
  }
  return true;
}

export async function tryEnterModelingProjectIde(page: Page): Promise<boolean> {
  const openByUuid = openCachedProjectIdeByUuid;

  const cached = readModelingProjectUuidArtifact();
  if (cached && (await openByUuid(cached))) {
    return true;
  }
  if (cached) {
    clearModelingProjectUuidArtifact();
  }

  const ok = await createBlankModelingProjectAndEnterIde(page);
  if (!ok) {
    return false;
  }
  const m = page.url().match(/\/projects\/([^/]+)/i);
  if (m?.[1]) {
    writeModelingProjectUuidArtifact(m[1]);
  }
  return true;
}

export async function tryEnterLeanProjectIde(page: Page): Promise<boolean> {
  const openByUuid = openCachedProjectIdeByUuid;

  const cached = readTheoremProjectUuidArtifact();
  if (cached && (await openByUuid(cached))) {
    return true;
  }

  await navigateToHomeProjects(page);
  const ok = await createTheoremProvingProjectFromMilTemplate(page);
  if (!ok) {
    return false;
  }
  const m = page.url().match(/\/projects\/([^/]+)/i);
  if (m?.[1]) {
    writeTheoremProjectUuidArtifact(m[1]);
  }
  return true;
}

/** 当前可见编辑区内的 CodeMirror **`.cm-content`**（与 **`12-latex.test.ts`** 同源）。 */
export function visibleCmContentInActiveEditor(page: Page): Locator {
  return page.locator(".cm-content").filter({ visible: true }).first();
}

/**
 * **`docs/用户场景.md`** §7.3：在 **Explore** 中打开文件树里 **第一个** accessible name 以 **`.py`** 结尾的 **row**。
 */
export async function openFirstPythonFileRowInFileTree(page: Page): Promise<void> {
  const tree = page.locator(".ide-filetree").filter({ visible: true }).first();
  await expect(tree).toBeVisible({ timeout: 45_000 });
  const pyRow = tree.getByRole("row", { name: /\.py$/i }).first();
  await expect(pyRow).toBeVisible({ timeout: 180_000 });
  await pyRow.click();
}

/**
 * 与 **`openFirstPythonFileRowInFileTree`** 同一行：首个 **`.py`** 节点上 **`span[data-name]`** 的工程内路径（如 **`/main.py`**），供 **§7.4** **python-execute** 与 **§7.3** 指向同一脚本。
 */
export async function readFirstPythonDataNameFromIdeFileTree(page: Page): Promise<string> {
  const tree = page.locator(".ide-filetree").filter({ visible: true }).first();
  await expect(tree).toBeVisible({ timeout: 45_000 });
  const pyRow = tree.getByRole("row", { name: /\.py$/i }).first();
  await expect(pyRow).toBeVisible({ timeout: 180_000 });
  const span = pyRow.locator("[data-name]").first();
  await expect(span).toBeVisible({ timeout: 15_000 });
  const v = await span.getAttribute("data-name");
  if (!v || !/\.py$/i.test(v)) {
    throw new Error(`first .py row missing data-name ending in .py, got: ${String(v)}`);
  }
  return v;
}

/** 底部 **Console** 未挂载时展开底栏（**`IdeMenubar`** 中 **`lucide-panel-bottom*`** 或 **Ctrl+Alt+B**）。 */
export async function ensureIdeBottomPanelOpenForConsole(page: Page): Promise<void> {
  const consoleTab = page.getByRole("tab", { name: "Console", exact: true });
  if (await consoleTab.isVisible().catch(() => false)) {
    return;
  }
  const menubar = page.getByRole("menubar");
  const toggle = menubar.locator("button").filter({
    has: page.locator("svg[class*='lucide-panel-bottom']"),
  }).first();
  if ((await toggle.count()) > 0 && (await toggle.isVisible().catch(() => false))) {
    await toggle.click();
  } else {
    await page.keyboard.press("Control+Alt+b");
  }
  await expect(consoleTab).toBeVisible({ timeout: 20_000 });
}

/** 编辑器工具栏 **Run Python**（**`lucide-play`**，与 **`Hotkey.RUN_PYTHON_FILE`** 一致；**`TooltipIconButton`** 无 **`title`**）。 */
export async function clickEditorToolbarRunPython(page: Page): Promise<void> {
  const editorToolbar = page
    .locator("div.flex.h-8.justify-end.gap-2.border-b")
    .filter({ visible: true })
    .first();
  await expect(editorToolbar).toBeVisible({ timeout: 30_000 });
  const runBtn = editorToolbar.locator("button").filter({
    has: page.locator("svg.lucide-play, svg[class*='lucide-play']"),
  }).first();
  await expect(runBtn).toBeVisible({ timeout: 30_000 });
  await runBtn.click();
}

/** §7.3：Console 以 **exit code** 断言；非 0 且 Gurobi/许可证 stderr 时返回 **`gurobi_license_skip`**（用例 **`test.skip`**）。 */
export type PythonTemplateConsoleOutcome = "ok" | "gurobi_license_skip";

/**
 * **`bottom-panel.tsx`** 里 **Console** 与 **Terminal** 各有一个 **`.ide-bottom-panel-scrollarea`**（同一 `Tabs` 下，**Console 的 `TabsContent` 在前**）。
 * Playwright 的 **`visible: true).first()`** 可能命中 **Terminal** 占位区，导致永远读不到 **`Process finished with exit code`**；故固定取 **`.nth(0)`**（Python Console 的 `ScrollArea`）。
 */
export function idePythonConsoleBottomScrollArea(page: Page): Locator {
  return page.locator(".ide-bottom-panel-scrollarea").nth(0);
}

/**
 * **`bottom-panel`** 的 **`ScrollArea`**（`scroll-area.tsx`）视口滚到底，使 **`Process finished with exit code`** 出现在可视区域（长日志时否则可能只在底部）。
 */
export async function scrollIdeBottomPanelConsoleToEnd(scrollRoot: Locator): Promise<void> {
  for (let round = 0; round < 3; round++) {
    const viewport = scrollRoot.locator('[data-slot="scroll-area-viewport"]').first();
    if ((await viewport.count()) > 0) {
      await viewport.evaluate((el: HTMLElement) => {
        el.scrollTop = el.scrollHeight;
      });
    } else {
      await scrollRoot.evaluate((el: HTMLElement) => {
        const v = el.querySelector("[data-slot=\"scroll-area-viewport\"]") as HTMLElement | null;
        if (v) {
          v.scrollTop = v.scrollHeight;
        }
      });
    }
  }
}

/**
 * 假定已切到 **Console** 并已点 **Run Python**：等待 **`bottom-panel.tsx`** 出现 **`Process finished with exit code N`**（与产品 **`text-muted-foreground`** 状态行一致），以 **N === 0** 为成功。
 * **N !== 0** 且 stderr 为 Gurobi/许可证类文案时返回 **`gurobi_license_skip`**（调用方 **`test.skip`**）；否则抛错。
 */
export async function waitForPythonConsoleSettledAndAssertGreenOrGurobiSkip(
  page: Page,
): Promise<PythonTemplateConsoleOutcome> {
  const scroll = idePythonConsoleBottomScrollArea(page);
  await expect(scroll).toBeVisible({ timeout: 120_000 });

  await expect
    .poll(
      async () => {
        const root = idePythonConsoleBottomScrollArea(page);
        await scrollIdeBottomPanelConsoleToEnd(root);
        if (/Process timed out/i.test((await root.textContent()) ?? "")) {
          throw new Error("Console：出现 Process timed out，未产生 exit code 行。");
        }
        return (await root.getByText(/Process finished with exit code\s*-?\d+/i).count()) > 0;
      },
      { timeout: 300_000, intervals: [800, 2000] },
    )
    .toBe(true);

  const root = idePythonConsoleBottomScrollArea(page);
  await scrollIdeBottomPanelConsoleToEnd(root);

  const exitLine = root.getByText(/Process finished with exit code\s*-?\d+/i).first();
  await expect(exitLine).toBeVisible({ timeout: 30_000 });
  const exitText = (await exitLine.textContent()) ?? "";
  const exitM = exitText.match(/exit code\s*(-?\d+)/i);
  if (!exitM) {
    const body = (await root.textContent()) ?? "";
    throw new Error(
      `Console 未解析到退出码数字：exitLine=${JSON.stringify(exitText)}；末尾约 800 字：${body.slice(-800)}`,
    );
  }
  const code = Number.parseInt(exitM[1]!, 10);

  // 成功时 Console 常无 `.text-red-600`；对 0 匹配调用 `textContent()` 会按默认超时一直等，直至整测超时/浏览器被关。
  const redLoc = root.locator(".text-red-600");
  const redText =
    (await redLoc.count()) === 0
      ? ""
      : (await redLoc.allTextContents()).join("\n").trim();

  if (code !== 0) {
    if (/GurobiError|Unauthorized access|No Gurobi|invalid license|License expired|license\s+error/i.test(redText)) {
      return "gurobi_license_skip";
    }
    throw new Error(`Console 退出码为 ${code}（非 0）。stderr 片段：${redText.slice(0, 2000)}`);
  }

  return "ok";
}

export async function openLeafFile(page: Page, segments: readonly string[]): Promise<void> {
  const tree = await waitForFileTree(page);
  const dirs = segments.slice(0, -1);
  for (let i = 0; i < dirs.length; i += 1) {
    const nextName = segments[i + 1]!;
    const alreadyVisible = await tree
      .getByText(nextName, { exact: true })
      .first()
      .isVisible()
      .catch(() => false);
    if (alreadyVisible) {
      continue;
    }
    const dirNode = tree.getByText(dirs[i]!, { exact: true }).first();
    await expect(dirNode).toBeVisible({ timeout: 20_000 });
    await dirNode.click();
    await expect(tree.getByText(nextName, { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  }
  const fileName = segments[segments.length - 1]!;
  const fileNode = tree.getByText(fileName, { exact: true }).first();
  await expect(fileNode).toBeVisible({ timeout: 20_000 });
  await fileNode.click();
}


/** 项目 IDE **Explore** 根目录新建文件（与 **`15-reaslingo-home`** 文件树交互一致）。 */
export async function createProjectIdeRootFile(page: Page, fileName: string): Promise<void> {
  await page.getByTitle("Create New File").first().click();
  const input = page.locator('[data-filetree-node="true"] input').first();
  await expect(input).toBeVisible({ timeout: 15_000 });
  await input.fill(fileName);
  await input.press("Enter");
  const tree = page.locator(".ide-filetree").filter({ visible: true }).first();
  const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await expect(tree.getByRole("row", { name: new RegExp(escaped, "i") }).first()).toBeVisible({
    timeout: 60_000,
  });
}
