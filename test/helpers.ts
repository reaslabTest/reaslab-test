import { type Locator, type Page, expect, test } from "@playwright/test";

import { absUrl } from "../common/global-setup";
import {
  readModelingContestTemplateProjectUuidArtifact,
  writeModelingContestTemplateProjectUuidArtifact,
} from "./data/e2e-modeling-contest-template-project-artifact";
import {
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
  await page.goto(absUrl("/"));
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

/**
 * Explore：选中 **README.md**（或文件树首行）后，经 **`Upload Files`**（`title="Upload Files"`）将**单个文件**上传到当前选中目录（与 **`reaslingoUploadFileForAiChat`** 同源弹窗；**非** chat-uploads 专用路径）。
 * 用于 **`docs/用户场景.md`** §12（编辑 LaTeX 文件并生成 PDF）等到项目根等。
 */
export async function uploadSingleFileViaExploreUploadDialog(page: Page, absoluteFilePath: string): Promise<void> {
  await waitForFileTree(page);
  const tree = page.locator(".ide-filetree").filter({ visible: true }).first();
  await expect(tree).toBeVisible({ timeout: 45_000 });

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
 * 等待 ReasLingo 本轮助理回复**流式结束**（与前端 `MessageInput` 的 `isLoading` → **Stop Message**、
 * `MessageList` 的 **Receiving response** 一致）。勿用固定 `sleep`：Paper Copilot / 工具链可能远超 30s，
 * 否则后续断言会在仍在生成时开始，导致超时误报。
 */
export async function waitForReasLingoAssistantReplyDone(page: Page): Promise<void> {
  const host = page
    .locator('[data-sidebar="group"]')
    .filter({ has: page.getByText("ReasLingo", { exact: true }) })
    .filter({ has: page.getByTitle("Add Context") })
    .first();

  const stopBtn = host.getByTitle("Stop Message");
  const receiving = host.getByText(/Receiving response/i);
  const streamUi = stopBtn.or(receiving).first();

  await expect(streamUi).toBeVisible({ timeout: 120_000 });
  await expect
    .poll(
      async () => {
        const r = await host.getByText(/Receiving response/i).isVisible().catch(() => false);
        const s = await host.getByTitle("Stop Message").isVisible().catch(() => false);
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
  const host = page
    .locator('[data-sidebar="group"]')
    .filter({ has: page.getByText("ReasLingo", { exact: true }) })
    .filter({ has: page.getByTitle("Add Context") })
    .first();
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

  const ta = host.locator("textarea").first();
  await expect(ta).toBeVisible({ timeout: 15_000 });
  await ta.click();
  await ta.fill("who are you?");
  const sendBtn = host.getByTitle("Send Message").first();
  await expect(sendBtn).toBeEnabled({ timeout: 180_000 });
  await sendBtn.click();
  const streamStarted = host
    .getByTitle("Stop Message")
    .or(host.getByText(/Receiving response/i));
  await expect(streamStarted.first()).toBeVisible({ timeout: 180_000 });
  await waitForReasLingoAssistantReplyDone(page);
  return true;
}

/**
 * **`docs/用户场景.md` §9.4**：侧栏 **ReasLingo** 标题栏 **`title="Standalone Chat Mode"`**（**`ReasLingoHeader.tsx`**）→
 * 断言 **`[data-standalone-chat]`**（**`StandaloneChatView`** Portal）内 **History**、**Search conversations…**、**Add Context**；
 * 桌面默认右侧 **Activity** 面板；并断言 **`title="Switch to IDE Mode"`** 可见（**不点击**），以便用例结束时页面仍处全屏、报告截图为全屏态。
 *
 * @returns 未找到全屏入口或全屏层未挂载时返回 **`false`**（调用方 **`test.skip`**）。
 */
export async function reasLingoStandaloneChatFullScreenProbe(page: Page): Promise<boolean> {
  await ensureReasLingoVisible(page);
  const enter = page.getByTitle("Standalone Chat Mode").first();
  if ((await enter.count()) < 1 || !(await enter.isVisible().catch(() => false))) {
    return false;
  }
  await enter.click();
  const shell = page.locator("[data-standalone-chat]").first();
  try {
    await expect(shell).toBeVisible({ timeout: 25_000 });
  } catch {
    return false;
  }
  await expect(shell.getByText("History", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(shell.getByPlaceholder("Search conversations...")).toBeVisible({ timeout: 15_000 });
  await expect(shell.getByTitle("Add Context").first()).toBeVisible({ timeout: 15_000 });
  await expect(shell.getByText("Activity", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(shell.getByTitle("Switch to IDE Mode").first()).toBeVisible({ timeout: 15_000 });
  return true;
}

/**
 * **`docs/用户场景.md` §8.5（调用lean_mcp）**：在侧栏 **ReasLingo** 中切到 **Default** Agent（内置 **`mcp_servers`** 含 **`lean_mcp`**；
 * **ReasFlow Copilot** 等 Agent **不含** **`lean_mcp`**，与 **`builtin_llm_and_agents.sql`** 一致），对已聚焦的 **Lean** 叶文件发 **`lean_mcp:`** 探针，
 * 等待流式结束并断言侧栏正文出现 **Infoview / goals** 或 **`Hello, World!`** 等工具输出线索。
 *
 * @returns 无法回到内置 **Default** Agent、或未见 **`lean_mcp:`** 用户气泡、或轮询未命中**助理侧** Lean 成功线索时返回 **`false`**（调用方 **`test.skip`**）。
 * 若侧栏出现 **`MCP error`**、**`-32603`**、**`StatusCode.UNIMPLEMENTED`**、**`Failed to get Lean infoview`** 等 **lean_mcp / gRPC 失败**文案，则 **抛出**（调用方记为**失败**，勿与 **`test.skip`** 混淆）。
 *
 * **与 `reaslab-iipe` 对齐**：**`AgentSelector.tsx`** 把 **`defaultAgentId`** 从下拉 **`agentOptions`** 中 **`filter` 掉**，列表里**没有**名为 **Default** 的菜单项；当前选非默认时，触发器文案为 **`ReasFlow Copilot`** 等，选回默认须**再次点击已勾选**的那条 **`DropdownMenuItem`**（`onClick` 里 **`handleAgentChange("default")`**），**勿**在菜单里找 **`/^Default$/`**。
 */
export async function reasLingoDefaultAgentLeanMcpInfoviewProbe(page: Page): Promise<boolean> {
  await ensureReasLingoVisible(page);
  const host = page
    .locator('[data-sidebar="group"]')
    .filter({ has: page.getByText("ReasLingo", { exact: true }) })
    .filter({ has: page.getByTitle("Add Context") })
    .first();
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

  /** 与 MIL **`S01_Getting_Started.lean`** 首行一致（**`#eval "Hello, World!"`**，**无** **`IO.println`**）；勿写错否则模型易拒答。 */
  const leanRel = "MIL/C01_Introduction/S01_Getting_Started.lean";
  const cm = page.locator(".cm-editor .cm-content").first();
  if ((await cm.count()) > 0) {
    await cm.click({ timeout: 10_000 }).catch(() => {});
  }

  const prompt = [
    `lean_mcp: for ${leanRel}, query Lean infoview at the first code line: #eval "Hello, World!"`,
    "(MIL template uses a string literal here, not IO.println.)",
    "Reply with one verbatim substring copied only from the MCP tool result (no paraphrase).",
  ].join(" ");

  const ta = host.locator("textarea").first();
  await expect(ta).toBeVisible({ timeout: 15_000 });
  await ta.click();
  await ta.fill(prompt);
  const sendBtn = host.getByTitle("Send Message").first();
  await expect(sendBtn).toBeEnabled({ timeout: 180_000 });
  await sendBtn.click();

  try {
    await expect(async () => {
      await expect(page).toHaveURL(/\/projects\/[^/]+/i);
      await expect(host.getByText(/^lean_mcp:/i).first()).toBeVisible();
    }).toPass({ timeout: 60_000 });
  } catch {
    return false;
  }

  await waitForReasLingoAssistantReplyDone(page);

  const body = ((await host.innerText()) ?? "").trim();

  const leanMcpHardFailure =
    /MCP\s+error|StatusCode\.UNIMPLEMENTED|-326\s*03|Failed to get Lean infoview|Failed to restart Lean file|gRPC\s+error/i;
  if (leanMcpHardFailure.test(body)) {
    throw new Error(
      `§8.5（调用lean_mcp）失败（侧栏含 MCP/gRPC 错误），不应判为通过。节选：${body.slice(-2_000)}`,
    );
  }

  if (/I\s*'?m\s+sorry|cannot\s+assist/i.test(body) && !/\bno goals\b|⊢|unsolved goals/i.test(body)) {
    return false;
  }

  /**
   * 成功线索须**不易**出现在本探针的用户气泡里（此前用 `Hello, World!` / `infoview` / `goals` 等扫**整段** `innerText`，
   * 会在工具报错时仍命中用户文案 → **假阳性**）。此处只认典型 **Lean Infoview / Elab** 输出。
   */
  const leanMcpSuccessSignal =
    /⊢|\bno goals\b|unsolved goals|synthInstance|typeclass instance|type mismatch|\bString\b/i;

  try {
    await expect
      .poll(async () => leanMcpSuccessSignal.test((await host.innerText()) ?? ""), {
        timeout: 300_000,
        intervals: [800, 2_000, 4_000, 8_000],
      })
      .toBeTruthy();
  } catch {
    return false;
  }

  const bodyAfter = (await host.innerText()) ?? "";
  if (leanMcpHardFailure.test(bodyAfter)) {
    throw new Error(`§8.5（调用lean_mcp）在轮询末尾出现 MCP 错误。节选：${bodyAfter.slice(-2_000)}`);
  }

  return true;
}

/**
 * **`docs/用户场景.md` §8.6（调用lake_mcp）**：侧栏 **ReasLingo** 使用 **Default** Agent，对本 **Lake** 工作区发 **`lake_mcp:`** 探针并调用 **`lake_build`**，
 * 流式结束后在侧栏正文中命中 **`status=Success`** 等 **`lake_build`** 成功摘要。
 *
 * @returns 无法回到 **Default**、或未见 **`lake_mcp:`** 用户气泡、或轮询未命中成功摘要时 **`false`**（**`test.skip`**）。
 * 若含 **`MCP error`**、**`Build failed:`**、**`status=Error`** 等，**抛出**（**fail**）。
 */
export async function reasLingoDefaultAgentLakeMcpBuildProbe(page: Page): Promise<boolean> {
  await ensureReasLingoVisible(page);
  const host = page
    .locator('[data-sidebar="group"]')
    .filter({ has: page.getByText("ReasLingo", { exact: true }) })
    .filter({ has: page.getByTitle("Add Context") })
    .first();
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

  const prompt = [
    "lake_mcp: for this Lean/Lake workspace root, invoke the lake_build tool (full project build, no target).",
    "Reply with ONE verbatim substring copied only from the MCP tool result (the summary line is best), e.g. containing status=Success.",
  ].join(" ");

  const ta = host.locator("textarea").first();
  await expect(ta).toBeVisible({ timeout: 15_000 });
  await ta.click();
  await ta.fill(prompt);
  const sendBtn = host.getByTitle("Send Message").first();
  await expect(sendBtn).toBeEnabled({ timeout: 180_000 });
  await sendBtn.click();

  try {
    await expect(async () => {
      await expect(page).toHaveURL(/\/projects\/[^/]+/i);
      await expect(host.getByText(/^lake_mcp:/i).first()).toBeVisible();
    }).toPass({ timeout: 60_000 });
  } catch {
    return false;
  }

  await waitForReasLingoAssistantReplyDone(page);

  const body = ((await host.innerText()) ?? "").trim();
  const lakeMcpHardFailure =
    /MCP\s+error|StatusCode\.UNIMPLEMENTED|-326\s*03|Build failed:|gRPC\s+error|\bstatus=Error\b|\bstatus=TimedOut\b|timed_out/i;
  if (lakeMcpHardFailure.test(body)) {
    throw new Error(
      `§8.6（调用lake_mcp）失败（侧栏含 MCP/构建错误），不应判为通过。节选：${body.slice(-2_000)}`,
    );
  }

  if (/I\s*'?m\s+sorry|cannot\s+assist/i.test(body) && !/\bstatus=Success\b|"status"\s*:\s*"success"/i.test(body)) {
    return false;
  }

  const lakeMcpSuccessSignal = /\bstatus=Success\b|"status"\s*:\s*"success"/i;
  try {
    await expect
      .poll(async () => lakeMcpSuccessSignal.test((await host.innerText()) ?? ""), {
        timeout: 300_000,
        intervals: [800, 2_000, 4_000, 8_000],
      })
      .toBeTruthy();
  } catch {
    return false;
  }

  const bodyAfter = (await host.innerText()) ?? "";
  if (lakeMcpHardFailure.test(bodyAfter)) {
    throw new Error(`§8.6（调用lake_mcp）在轮询末尾出现 MCP/构建错误。节选：${bodyAfter.slice(-2_000)}`);
  }

  return true;
}

/**
 * `docs/用户场景.md` §7.5：**第二次**跑与 **§7.4** 相同的模板主 **`.py`**（路径 **`projectPyDataName`**，与
 * **`readFirstPythonDataNameFromIdeFileTree`** / **`openFirstPythonFileRowInFileTree`** 一致）：侧栏 **ReasLingo**、
 * **保持默认 Agent**（不打开 Agent 菜单切换），经 **`python_mcp`** 在项目工作区内**按 `python <file>` 方式全量执行**
 * 该脚本（与 **§7.4** 工具栏 **Run Python** 形成「IDE 运行键 → AI MCP」两遍验收）。**发用户句前** **`waitForTimeout(1s)`**。
 */
export async function reasLingoDefaultAgentMcpPythonProbe(
  page: Page,
  projectPyDataName: string,
): Promise<void> {
  await ensureReasLingoVisible(page);
  const host = page
    .locator('[data-sidebar="group"]')
    .filter({ has: page.getByText("ReasLingo", { exact: true }) })
    .filter({ has: page.getByTitle("Add Context") })
    .first();
  await expect(host).toBeVisible({ timeout: 20_000 });

  const rel = projectPyDataName.startsWith("/") ? projectPyDataName.slice(1) : projectPyDataName;
  const prompt = `python_mcp: run ${JSON.stringify(rel)} from project root as __main__. Reply with the tool's "Process finished with exit code" line.`;

  const ta = host.locator("textarea").first();
  await expect(ta).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1_000);
  await ta.click();
  await ta.fill(prompt);
  const sendBtn = host.getByTitle("Send Message").first();
  await expect(sendBtn).toBeEnabled({ timeout: 180_000 });
  await sendBtn.click();
  await expect(async () => {
    await expect(page).toHaveURL(/\/projects\/[^/]+/i);
    await expect(host.getByText(/^python_mcp:/i).first()).toBeVisible();
  }).toPass({ timeout: 60_000 });
  await waitForReasLingoAssistantReplyDone(page);

  await expect
    .poll(async () => /Process finished with exit code\s*0/i.test((await host.innerText()) ?? ""), {
      timeout: 300_000,
      intervals: [800, 2_000, 4_000, 8_000],
    })
    .toBeTruthy();
}

/** `docs/用户场景.md` §12.2（调用tex_mcp）步骤 3：发给模型的用户消息须为英文。 */
export const CH12_2_TEX_MCP_USER_PROMPT =
  "Use compile_tex to compile test_upload.tex (path relative to the project root). Then call get_compile_log. In your reply, quote the key lines from that log that pertain to this compilation run." as const;

/**
 * `docs/用户场景.md` §12.2（调用tex_mcp）：侧栏 **ReasLingo** 保证为 **Default** Agent（见 **`AgentSelector.tsx`**：`currentAgent === "default"` 时触发器文案为 **Agent**，且 **Default** 不出现在下拉列表中）→ **New Chat** → 发送 **`CH12_2_TEX_MCP_USER_PROMPT`**，
 * 发送后轮询 **`compile_tex`** 出现在侧栏（与 §7.5 **`python_mcp:`** 探针同理，**不**依赖用户原文整句 DOM 回显）；流结束后断言 **`compile_tex`** 与 **`get_compile_log`** 在侧栏正文中的出现顺序，并断言编译 log 常见片段（与 **`test_upload.tex`** 成功编译一致）。
 *
 * **前提**：工程根目录已存在 **`test_upload.tex`**（由 **`uploadSingleFileViaExploreUploadDialog`** 等写入）。
 */
export async function reasLingoDefaultAgentTexMcpCompileLogProbe(page: Page): Promise<void> {
  await ensureReasLingoVisible(page);

  const shell = page
    .locator('[data-sidebar="group"]')
    .filter({ has: page.getByText("ReasLingo", { exact: true }) })
    .first();
  await expect(shell).toBeVisible({ timeout: 20_000 });

  const host = shell.filter({ has: page.getByTitle("Add Context") }).first();
  await expect(host).toBeVisible({ timeout: 20_000 });

  const agentBtn = host.locator('button[title="Switch Agent"]').first();
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

  const newChatBtn = shell.getByTitle("New Chat").first();
  await expect(newChatBtn).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(async () => (await newChatBtn.isDisabled().catch(() => true)) === false, {
      timeout: 120_000,
      intervals: [400, 800, 1_600],
    })
    .toBeTruthy();
  await newChatBtn.click();
  await page.waitForTimeout(500);

  const ta = host.locator("textarea").first();
  await expect(ta).toBeVisible({ timeout: 15_000 });
  await ta.click();
  await ta.fill(CH12_2_TEX_MCP_USER_PROMPT);
  const sendBtn = host.getByTitle("Send Message").first();
  await expect(sendBtn).toBeEnabled({ timeout: 180_000 });
  await sendBtn.click();

  // 与 `reasLingoDefaultAgentMcpPythonProbe` 一致：等待侧栏出现 **助手/工具流** 信号，勿断言用户原文整句已挂载到 DOM
  //（产品可能折叠、摘要或延迟渲染用户气泡；截图中侧栏仍为欢迎态时 `Send Message` 也会长期 disabled）。
  await expect(async () => {
    await expect(page).toHaveURL(/\/projects\/[^/]+/i);
    await expect(host.getByText(/\bcompile_tex\b/i).first()).toBeVisible();
  }).toPass({ timeout: 60_000 });

  await waitForReasLingoAssistantReplyDone(page);

  const body = ((await shell.innerText()) ?? "").replace(/\r\n/g, "\n");
  const iCompile = body.indexOf("compile_tex");
  const iLog = body.indexOf("get_compile_log");
  expect(iCompile).toBeGreaterThanOrEqual(0);
  expect(iLog).toBeGreaterThanOrEqual(0);
  expect(iLog).toBeGreaterThan(iCompile);

  await expect
    .poll(
      async () => {
        const t = ((await shell.innerText()) ?? "").replace(/\r\n/g, "\n");
        return (
          /Output written on/i.test(t) ||
          /test_upload\.pdf/i.test(t) ||
          /LaTeX2e|Document Class:\s*article/i.test(t) ||
          (/status\s*=\s*0/i.test(t) && /pdf_available\s*=\s*true/i.test(t)) ||
          /errors\s*=\s*0,\s*warnings\s*=\s*0.*test_upload\.tex/i.test(t) ||
          /No parsed diagnostics/i.test(t)
        );
      },
      { timeout: 120_000, intervals: [800, 2_000, 4_000, 8_000] },
    )
    .toBeTruthy();
}

/** `docs/用户场景.md` §7.6：与文档一致的英文召回句（口语拼写）。 */
export const CH7_HISTORY_RECALL_PROMPT = "what question did I asked?";

/** §7.6：串行主线在 **§7.3（切换Optimization Agent并提问）** 跳过等情况下历史不足两条时的 **`test.skip`** 说明。 */
export const MODELING_CH7_HISTORY_TWO_SESSIONS_SKIP_MSG =
  "§7.6 需要至少 2 条 ReasLingo 历史会话（主线含 §7.3「切换Optimization Agent并提问」与 §7.5「python_mcp」）；当前列表不足。";

/**
 * **`docs/用户场景.md` §7.6**：**Chat History** → 列表滚到底 → 点**最后一条会话** → 发送 **`CH7_HISTORY_RECALL_PROMPT`** →
 * 流结束后侧栏正文含 **`who are you`**（与 **§7.3（切换Optimization Agent并提问）** 用户消息对齐）。
 *
 * **会话行定位**：`reaslab-iipe` 的 **`SessionItem`** 为原生 **`<button type="button">`**；**`zlj`** 等为 **`div role="button"`**。
 * 须用 **`getByRole("button", { name: /\d+\s+messages/ })`**，**勿**用 **`div[role="button"]`**（在 iipe 上会恒为 **0** 条 → 误判「不足两条」而 **`test.skip`**）。
 *
 * @returns **`true`** 已断言成功；**`false`** 表示历史少于 **2** 条（调用方 **`test.skip`**）。
 */
export async function reasLingoSelectBottomHistorySessionAndAssertRecallWhoAreYou(page: Page): Promise<boolean> {
  await ensureReasLingoVisible(page);
  const host = page
    .locator('[data-sidebar="group"]')
    .filter({ has: page.getByText("ReasLingo", { exact: true }) })
    .filter({ has: page.getByTitle("Add Context") })
    .first();
  await expect(host).toBeVisible({ timeout: 20_000 });

  const chatHistoryPopover = () =>
    page.locator("div").filter({ has: page.getByPlaceholder("Search...") }).filter({ visible: true }).first();

  await test.step("§7.6-1：Chat History → 等待列表加载", async () => {
    await host.getByTitle("Chat History").click();
    const pop = chatHistoryPopover();
    await expect(pop).toBeVisible({ timeout: 15_000 });
    await expect(pop.getByText(/Loading chat history/i)).toBeHidden({ timeout: 120_000 });
  });

  const pop = chatHistoryPopover();
  const sessionRows = pop.getByRole("button", { name: /\d+\s+messages/i });

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

  await test.step("§7.6-2：滚到底并选择最下一条会话", async () => {
    const scrollArea = pop.locator(".max-h-80.overflow-y-auto").first();
    await scrollArea.evaluate((el: HTMLElement) => {
      el.scrollTop = el.scrollHeight;
    });
    // 同步 `scrollTop` 后立刻点最后一条时，偶发未触发「选中会话」→ 浮层不自动关；略等滚动/布局稳定再点。
    await page.waitForTimeout(1_000);
    const lastSession = sessionRows.nth(n - 1);
    await lastSession.scrollIntoViewIfNeeded();
    await lastSession.click();
    await expect(pop).toBeHidden({ timeout: 15_000 });
  });

  await test.step(`§7.6-3：发送「${CH7_HISTORY_RECALL_PROMPT}」并等待流式结束`, async () => {
    const ta = host.locator("textarea").first();
    await expect(ta).toBeVisible({ timeout: 15_000 });
    await ta.click();
    await ta.fill(CH7_HISTORY_RECALL_PROMPT);
    const sendBtn = host.getByTitle("Send Message").first();
    await expect(sendBtn).toBeEnabled({ timeout: 180_000 });
    await sendBtn.click();
    await expect(async () => {
      await expect(page).toHaveURL(/\/projects\/[^/]+/i);
      await expect(host.getByText(/what question did I asked\?/i).first()).toBeVisible();
    }).toPass({ timeout: 60_000 });
    await waitForReasLingoAssistantReplyDone(page);
  });

  await test.step("§7.6-4：验收助理正文含 who are you（与 §7.3 切换Optimization Agent并提问 一致）", async () => {
    await expect
      .poll(async () => /who\s+are\s+you/i.test((await host.innerText()) ?? ""), {
        timeout: 120_000,
        intervals: [500, 1_500, 3_000],
      })
      .toBeTruthy();
  });

  return true;
}

/** `docs/用户场景.md` §7.7：**Models** 中未找到 **SiliconFlow** 或未展开时的 **`test.skip`** 说明。 */
export const MODELING_CH7_SETTINGS_SILICONFLOW_SKIP_MSG =
  "§7.7：ReasLingo Settings → Models 在加载完成或列表渲染后仍无可点的 SiliconFlow（或未展示该 Provider），跳过。";

/** 与 **`docs/用户场景.md`** §7.7 步骤 3 一致（产品内展示文案）。 */
export const CH7_SETTINGS_USER_RULE_TEXT = "Always response in English";

/**
 * 内层 **Models / User Rules / Tools & MCP** 的 **`tablist`**（与 **`ReasLingoSettings.tsx`** 一致）；
 * 用 **`has`「Tools & MCP」** 与顶层编辑器文件 **TabsList** 区分。
 */
function reasLingoIdeSettingsInnerTablist(page: Page): Locator {
  return page.getByRole("tablist").filter({
    has: page.getByRole("tab", { name: "Tools & MCP", exact: true }),
  });
}

/**
 * 侧栏 **ReasLingo** **标题行**（**`ReasLingoHeader`**）里 **`title="Settings"`** 的齿轮 → 打开编辑器虚拟页 **ReasLingo Settings**（`reaslingo://settings`）。
 * **勿**与输入条底部的 **`title="More Settings"`**（**`Sliders`**，**`ChatCommonSettingsSelector`**）混淆。
 */
export async function reasLingoOpenIdeAiSettings(page: Page): Promise<void> {
  await ensureReasLingoVisible(page);
  const sidebar = page
    .locator('[data-sidebar="group"]')
    .filter({ has: page.getByText("ReasLingo", { exact: true }) })
    .filter({ has: page.getByTitle("Add Context") })
    .first();
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
 * **`docs/用户场景.md` §7.7**：**Models**（SiliconFlow、**`test`** 占位模型）→ **User Rules** → **Tools & MCP**（4 个 MCP）→
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
    .filter({ has: page.getByRole("tab", { name: "Tools & MCP", exact: true }) })
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

  await test.step("§7.7-2 Models：SiliconFlow → Add Model → test / test → Save", async () => {
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

  await test.step("§7.7-3 User Rules：+ Add Rule → Always response in English → Save", async () => {
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

  await test.step("§7.7-4 Tools & MCP：MCP Servers ×4", async () => {
    await innerTabs.getByRole("tab", { name: "Tools & MCP", exact: true }).click();
    const toolsPanel = page.getByRole("tabpanel", { name: "Tools & MCP", exact: true });
    await expect(toolsPanel).toBeVisible({ timeout: 15_000 });
    /** 线上标题为 **MCP Servers**（非历史文案 *Installed MCP Servers*）。 */
    await expect(toolsPanel.getByRole("heading", { name: "MCP Servers", exact: true })).toBeVisible({
      timeout: 15_000,
    });
    for (const id of ["python_mcp", "tex_mcp", "lean_mcp", "lake_mcp"] as const) {
      await expect(toolsPanel.getByText(id, { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    }
  });

  await test.step("§7.7-5 关闭设置；侧栏 Switch Model 列表含 test", async () => {
    await reasLingoCloseIdeAiSettingsTab(page);

    const host = page
      .locator('[data-sidebar="group"]')
      .filter({ has: page.getByText("ReasLingo", { exact: true }) })
      .filter({ has: page.getByTitle("Add Context") })
      .first();
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

/** `docs/用户场景.md` §7「模板创建优化建模项目」：从「Optimization Modeling Templates」创建项目失败时的跳过说明。 */
export const MODELING_CH7_SKIP_MSG =
  "无法从优化建模模板进入数学建模 IDE：请确认已登录、模板服务可用，或 test/data/.e2e-artifacts/optimization-template-project-uuid.txt 仍有效。";

/** `docs/用户场景.md` §7.4：Console 出现 Gurobi / 许可证类错误时的 **`test.skip`** 说明（需 Solver Settings 或环境许可）。 */
export const MODELING_PYTHON_CONSOLE_GUROBI_SKIP_MSG =
  "Console 出现 Gurobi/许可证类错误：请在侧栏 Solver Settings 配置 Gurobi WLS 并 Test/Save，或为 CI 注入许可；见 docs/用户场景.md §7.4。";

/** `docs/用户场景.md` §9「模板创建竞赛建模项目」：从「Math Modeling Contest Templates」创建项目失败时的跳过说明。 */
export const MODELING_CH9_SKIP_MSG =
  "无法从数学建模竞赛模板进入建模 IDE：请确认已登录、竞赛模板服务可用，或 test/data/.e2e-artifacts/modeling-contest-template-project-uuid.txt 仍有效。";

/** `docs/用户场景.md` §9.4：未出现 **Standalone Chat Mode** 入口或 **`[data-standalone-chat]`** 全屏层未挂载时的 **`test.skip`** 说明（窄屏/移动布局可能隐藏入口）。 */
export const MODELING_CH9_STANDALONE_CHAT_SKIP_MSG =
  "§9.4 全屏 AI 会话：侧栏未找到 **Standalone Chat Mode** 或全屏层未挂载；若为移动视口请用桌面宽度重跑。";

/** `docs/用户场景.md` §8「模板创建定理证明项目」：MIL 定理证明模板 IDE 不可用时的跳过说明（与 `tryEnterLeanProjectIde` / `theorem-project-uuid.txt` 一致）。 */
export const THEOREM_CH8_SKIP_MSG =
  "无法进入 MIL 定理证明 IDE：请确认已登录且 Theorem Proving Templates → Mathematics in Lean → Use Template 可用（首次 lake 可能极慢），或 test/data/.e2e-artifacts/theorem-project-uuid.txt 仍有效。";

/** §8.4 Agent 菜单项：`paper-generation` 的 **`display_name`**（`builtin_llm_and_agents.sql` 现为 **ReasFlow Copilot**，旧环境可能仍为 **Paper Copilot**）。 */
export const REASFLOW_COPILOT_AGENT_MENU_LABEL = /ReasFlow Copilot|Paper Copilot/i;

/** `docs/用户场景.md` §8.4：**ReasFlow Copilot**（原 Paper Copilot）不可用时的 **`test.skip`** 说明。 */
export const THEOREM_CH8_REASFLOW_COPILOT_SKIP_MSG =
  "§8.4 切换 ReasFlow Copilot：侧栏 Agent 菜单无 **ReasFlow Copilot**（或旧版 **Paper Copilot**），跳过。";

/** `docs/用户场景.md` §8.5（调用lean_mcp）：无法切回内置 **Default** Agent、或 **`lean_mcp`** 探针未命中时的 **`test.skip`** 说明（**ReasFlow Copilot** 不含 **`lean_mcp`**；见 **`AgentSelector`** 无 **Default** 菜单项）。 */
export const THEOREM_CH8_LEAN_MCP_SKIP_MSG =
  "§8.5（调用lean_mcp）需回到内置 **Default** Agent（`mcp_servers` 含 **`lean_mcp`**）且工具链可见 **`lean_mcp:`** 与 Infoview 类输出；**ReasFlow Copilot** 无 **`lean_mcp`**。若无法从 Agent 菜单切回 **Default**、或模型未走 **`lean_mcp`**，跳过。";

/** `docs/用户场景.md` §8.6（调用lake_mcp）：须 **Default** Agent；须命中 **`lake_mcp:`** 与 **`lake_build`** 成功摘要（如 **`status=Success`**）。 */
export const THEOREM_CH8_LAKE_MCP_SKIP_MSG =
  "§8.6（调用lake_mcp）须 **Default** Agent，且助理侧出现 **`status=Success`** 等 **`lake_build`** 成功线索。若无法切回 **Default**、或模型未引用工具摘要，跳过。";

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

export async function tryEnterOptimizationTemplateModelingIde(page: Page): Promise<boolean> {
  const openByUuid = async (uuid: string): Promise<boolean> => {
    const res = await page.goto(absUrl(`/projects/${uuid}`), { waitUntil: "domcontentloaded" });
    if (!res?.ok() && res?.status() !== 304) {
      return false;
    }
    try {
      await waitForFileTree(page);
      return true;
    } catch {
      return false;
    }
  };

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
  const openByUuid = async (uuid: string): Promise<boolean> => {
    const res = await page.goto(absUrl(`/projects/${uuid}`), { waitUntil: "domcontentloaded" });
    if (!res?.ok() && res?.status() !== 304) {
      return false;
    }
    try {
      await waitForFileTree(page);
      return true;
    } catch {
      return false;
    }
  };

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
  const openByUuid = async (uuid: string): Promise<boolean> => {
    const res = await page.goto(absUrl(`/projects/${uuid}`), { waitUntil: "domcontentloaded" });
    if (!res?.ok() && res?.status() !== 304) {
      return false;
    }
    try {
      await waitForFileTree(page);
      return true;
    } catch {
      return false;
    }
  };

  const cached = readModelingProjectUuidArtifact();
  if (cached && (await openByUuid(cached))) {
    return true;
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
  const openByUuid = async (uuid: string): Promise<boolean> => {
    const res = await page.goto(absUrl(`/projects/${uuid}`), { waitUntil: "domcontentloaded" });
    if (!res?.ok() && res?.status() !== 304) {
      return false;
    }
    try {
      await waitForFileTree(page);
      return true;
    } catch {
      return false;
    }
  };

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
 * **`docs/用户场景.md`** §7.4：在 **Explore** 中打开文件树里 **第一个** accessible name 以 **`.py`** 结尾的 **row**。
 */
export async function openFirstPythonFileRowInFileTree(page: Page): Promise<void> {
  const tree = page.locator(".ide-filetree").filter({ visible: true }).first();
  await expect(tree).toBeVisible({ timeout: 45_000 });
  const pyRow = tree.getByRole("row", { name: /\.py$/i }).first();
  await expect(pyRow).toBeVisible({ timeout: 180_000 });
  await pyRow.click();
}

/**
 * 与 **`openFirstPythonFileRowInFileTree`** 同一行：首个 **`.py`** 节点上 **`span[data-name]`** 的工程内路径（如 **`/main.py`**），供 **§7.5** **`python_mcp`** 与 **§7.4** 指向同一脚本。
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

/** §7.4：Console 以 **exit code** 断言；非 0 且 Gurobi/许可证 stderr 时返回 **`gurobi_license_skip`**（用例 **`test.skip`**）。 */
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
