import fs from "node:fs/promises";
import path from "node:path";

import { expect, type Locator, type Page } from "@playwright/test";

import { gotoWithRetry } from "../common/e2e-nav";
import { absUrl } from "../common/global-setup";

const MARKETING_HOME_NAV_OPTIONS = {
  waitUntil: "domcontentloaded" as const,
  timeout: 120_000,
  attempts: 6,
  backoffMs: 2_000,
};

async function gotoMarketingHome(page: Page): Promise<void> {
  let res = await gotoWithRetry(page, absUrl("/home"), MARKETING_HOME_NAV_OPTIONS);
  if (!res?.ok()) {
    res = await gotoWithRetry(page, absUrl("/"), MARKETING_HOME_NAV_OPTIONS);
  }
  expect(res?.ok(), `首屏导航状态 ${res?.status()}`).toBeTruthy();
}

/**
 * **`reaslab-iipe` `ide-agent.tsx`**：`IdeAgentWelcome` 仅在 **`messages.length === 0`** 时渲染；
 * `/reaslingo` 进入全局工作区后常会**恢复上次会话**（侧栏已有历史条目），此时中间区为消息流而非欢迎页。
 */
export async function ensureIdeAgentWelcomeScreen(page: Page): Promise<void> {
  const welcomeBot = page.getByRole("img", { name: "ReasLingo AI Bot" });
  if (await welcomeBot.isVisible().catch(() => false)) {
    await expect(page.getByText(/Welcome to\s+ReasLingo chat mode/i)).toBeVisible({ timeout: 15_000 });
    return;
  }
  const newChat = page.getByTitle("New Chat").first();
  await expect(newChat).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => (await newChat.isDisabled().catch(() => true)) === false, {
      timeout: 120_000,
      intervals: [400, 800, 1_600],
    })
    .toBeTruthy();
  await newChat.click();
  await expect(welcomeBot).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Welcome to\s+ReasLingo chat mode/i)).toBeVisible({ timeout: 15_000 });
}

export async function openGlobalReasLingoFromHome(page: Page): Promise<void> {
  await gotoMarketingHome(page);
  const link = page.locator("header").locator('a[href="/reaslingo"]').first();
  await expect(link).toBeVisible({ timeout: 60_000 });
  // 场景 §15.1：点击顶栏 ReasLingo（比直接 goto 更贴近用户路径，且减少 ERR_ABORTED）
  await link.click();
  try {
    await expect(page).toHaveURL(/\/reaslingo(?:\/|\?|$)/, { timeout: 45_000 });
  } catch {
    await gotoWithRetry(page, absUrl("/reaslingo"), {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
      attempts: 6,
      backoffMs: 2_000,
    });
  }
  await expect(page.getByPlaceholder("Search conversations...")).toBeVisible({ timeout: 120_000 });
  await expect(ideAgentHeader(page)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTitle("Send Message").first()).toBeVisible({ timeout: 30_000 });
  await ensureIdeAgentWelcomeScreen(page);
  await ensureIdeAgentRightPanelOpen(page);
  await expect(page.getByText("Activity", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
}

function isOnReasLingoUrl(page: Page): boolean {
  return /\/reaslingo(?:\/|\?|$)/.test(page.url());
}

/**
 * 已在 `/reaslingo` 时仅校验 IdeAgent 壳层；否则走 §15.1 完整首页导航。
 * 供 §15 串行用例在 15.1 通过后复用同一 `page`。
 */
export async function ensureIdeAgentOnReasLingo(page: Page): Promise<void> {
  if (!isOnReasLingoUrl(page)) {
    await openGlobalReasLingoFromHome(page);
    return;
  }
  await expect(page.getByPlaceholder("Search conversations...")).toBeVisible({ timeout: 60_000 });
  await expect(ideAgentHeader(page)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTitle("Send Message").first()).toBeVisible({ timeout: 30_000 });
}

export function ideAgentShell(page: Page): Locator {
  return page.locator("div.flex.h-screen.w-full.bg-background").first();
}

function ideAgentInputHost(page: Page): Locator {
  return ideAgentShell(page).filter({ has: page.getByTitle("Send Message") });
}

export function ideAgentHeader(page: Page): Locator {
  return page
    .locator("div.flex.h-10.shrink-0.items-center.justify-between.border-b.px-3")
    .filter({ has: page.getByText("ReasLingo", { exact: true }) })
    .first();
}

/** 右栏顶栏（含 **Activity**；与中间 **IdeAgentHeader** 区分）。 */
export function rightPanelHeader(page: Page): Locator {
  return page
    .locator("div.flex.h-10.shrink-0.items-center.justify-between.border-b.px-3")
    .filter({ has: page.getByText("Activity", { exact: true }) })
    .first();
}

async function isFileTreeToolbarVisible(page: Page): Promise<boolean> {
  return page
    .getByTitle("Create New File")
    .first()
    .isVisible()
    .catch(() => false);
}

/** `toolbarToggleButtonClass(active)`：`border-indigo` / `bg-sidebar-accent` 表示该侧栏已展开。 */
async function isIdeAgentSideToggleActive(toggle: Locator): Promise<boolean> {
  return toggle
    .evaluate((el) => /border-indigo|bg-sidebar-accent/.test(el.className))
    .catch(() => false);
}

async function ensureIdeAgentRightPanelOpen(page: Page): Promise<void> {
  if (await rightPanelHeader(page).isVisible().catch(() => false)) {
    return;
  }
  const showToggle = ideAgentHeader(page).getByTitle("Show Right Panel");
  await expect(showToggle).toBeVisible({ timeout: 30_000 });
  await showToggle.click();
  await expect(rightPanelHeader(page)).toBeVisible({ timeout: 30_000 });
}

/** 右栏壳层（`right-panel.tsx` 根 `border-l`）；与 §19 `agentRightPanel` 同思路。 */
function ideAgentRightPanelShell(page: Page): Locator {
  return rightPanelHeader(page).locator("xpath=ancestor::div[contains(@class,'border-l')][1]");
}

async function isIdeAgentEditorMounted(page: Page): Promise<boolean> {
  if ((await page.locator("[data-filetree-scroll]").count()) > 0) {
    return true;
  }
  if ((await page.getByPlaceholder("Enter to search").count()) > 0) {
    return true;
  }
  return (await ideAgentSideToolbar(page).count()) > 0;
}

/** IdeAgentEditor 仅在右栏 **Files** 标签下挂载；默认常在 **Activity**。 */
async function ensureIdeAgentEditorTab(page: Page): Promise<void> {
  if (await isIdeAgentEditorMounted(page)) {
    return;
  }
  const filesTab = page.getByRole("button", { name: "Files", exact: true });
  if (await filesTab.isVisible().catch(() => false)) {
    await filesTab.click();
  } else {
    const openFileTab = rightPanelHeader(page).locator("button[type='button']").filter({
      hasNot: page.getByText("Activity", { exact: true }),
    });
    if ((await openFileTab.count()) > 0) {
      await openFileTab.first().click();
    }
  }
  await expect
    .poll(async () => isIdeAgentEditorMounted(page), { timeout: 30_000, intervals: [200, 400, 800] })
    .toBe(true);
}

export async function ensureIdeAgentFilesPanel(page: Page): Promise<void> {
  await ensureIdeAgentRightPanelOpen(page);

  if (await isFileTreeToolbarVisible(page)) {
    return;
  }

  await ensureIdeAgentEditorTab(page);

  // jotai 持久化 `sidePanel=filetree` 时，切到 Files 标签后树已可见，无需再点内侧切换钮。
  if (await fileTreeScrollHost(page).isVisible().catch(() => false)) {
    await expect(page.getByTitle("Create New File").first()).toBeVisible({ timeout: 60_000 });
    return;
  }

  const filesToggle = ideAgentFilesToggle(page);
  await expect(filesToggle).toBeVisible({ timeout: 15_000 });
  const toggleActive = await isIdeAgentSideToggleActive(filesToggle);
  // 已 active 时勿再点 Files 钮——`toggleFileTree` 会在 filetree ↔ null 间切换并折叠侧栏。
  if (!toggleActive) {
    await filesToggle.click();
  }

  await expect(page.getByTitle("Create New File").first()).toBeVisible({ timeout: 60_000 });
}

type FileTreeNodeKind = "file" | "directory" | "any";

/** 从 pathname 或裸 basename 取出文件树节点的 `data-node-basename`。 */
function fileTreeBasename(nameOrPath: string): string {
  const trimmed = nameOrPath.replace(/^\/+/, "");
  const segments = trimmed.split("/").filter(Boolean);
  return segments.at(-1) ?? trimmed;
}

/** gRPC / 文件树 `data-node-pathname`，如 `/my-dir/file.txt`。 */
function fileTreePathname(...segments: string[]): string {
  return `/${segments.map((s) => fileTreeBasename(s)).filter(Boolean).join("/")}`;
}

/** 文件夹内文件（按完整 pathname，避免历史残留同名文件干扰 `.first()`）。 */
export function fileTreeFileInFolder(
  page: Page,
  folderBasename: string,
  fileBasename: string,
): Locator {
  const pathname = fileTreePathname(folderBasename, fileBasename);
  return fileTreeScrollHost(page)
    .locator(`[data-node-type="file"][data-node-pathname="${pathname}"]`)
    .first();
}

function fileTreeNodeByBasename(page: Page, basename: string, kind: FileTreeNodeKind = "any"): Locator {
  const base = fileTreeBasename(basename);
  const host = fileTreeScrollHost(page);
  if (kind === "file") {
    return host.locator(`[data-node-basename="${base}"][data-node-type="file"]`).first();
  }
  if (kind === "directory") {
    return host.locator(`[data-node-basename="${base}"][data-node-type="directory"]`).first();
  }
  return host.locator(`[data-node-basename="${base}"]`).first();
}

/** 按 `data-node-basename` 精确定位，避免 `pathname*=` 误命中历史目录或子路径。 */
export function fileTreeNode(page: Page, basename: string): Locator {
  return fileTreeNodeByBasename(page, basename, "file");
}

/** 文件树中的文件夹节点（`data-node-type="directory"`）。 */
export function fileTreeFolderNode(page: Page, folderBasename: string): Locator {
  return fileTreeNodeByBasename(page, folderBasename, "directory");
}

export async function ensureFileTreeFolderExpanded(page: Page, folderBasename: string): Promise<void> {
  const folder = fileTreeFolderNode(page, folderBasename);
  await expect(folder).toBeVisible({ timeout: 60_000 });
  await folder.scrollIntoViewIfNeeded();

  const chevron = folder.locator("[data-tree-chevron]").first();
  if ((await chevron.count()) === 0) {
    return;
  }

  const chevronIcon = chevron.locator("span").first();
  if (await chevronIcon.evaluate((el) => el.classList.contains("rotate-90")).catch(() => false)) {
    return;
  }

  await chevron.click();
  await expect(chevronIcon).toHaveClass(/rotate-90/, { timeout: 15_000 });
}

export async function clickFileTreeFolder(page: Page, folderBasename: string): Promise<void> {
  await ensureIdeAgentFilesPanel(page);
  const node = fileTreeFolderNode(page, folderBasename);
  await expect(node).toBeVisible({ timeout: 60_000 });
  await node.scrollIntoViewIfNeeded();
  await node.click({ timeout: 30_000 });
  await ensureFileTreeFolderExpanded(page, folderBasename);
}

/** §15 E2E 在全局工作区根下创建的目录前缀；失败重跑会累积，需用例前后清扫。 */
export const CH15_E2E_DIR_PREFIX = "e2e-ch15-dir-";

const CH15_E2E_DIR_NAME_PATTERN = /^e2e-ch15-dir-\d+$/;

function fileTreeScrollHost(page: Page): Locator {
  return page.locator("[data-filetree-scroll]");
}

async function listCh15E2eFolderNames(page: Page): Promise<string[]> {
  const nodes = fileTreeScrollHost(page).locator(
    `[data-node-type="directory"][data-node-basename^="${CH15_E2E_DIR_PREFIX}"]`,
  );
  const count = await nodes.count();
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    const basename = await nodes.nth(i).getAttribute("data-node-basename");
    if (basename && CH15_E2E_DIR_NAME_PATTERN.test(basename)) {
      names.add(basename);
    }
  }
  return [...names].sort();
}

export type CleanupCh15E2eOptions = {
  /** 单次清扫最多删除多少个目录。 */
  maxFolders?: number;
  /** 总时间预算（ms），防止历史过多时阻塞用例。 */
  timeBudgetMs?: number;
  /** 为 true 时若仍有残留则断言失败。 */
  requireEmpty?: boolean;
};

export async function confirmDeleteFileTreeDialog(page: Page): Promise<void> {
  const deleteDialog = page.locator('[data-slot="alert-dialog-content"]').filter({
    hasText: /Are you sure you want to delete/i,
  });
  await expect(deleteDialog).toBeVisible({ timeout: 20_000 });
  await deleteDialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(deleteDialog).toBeHidden({ timeout: 60_000 });
}

/** 删除文件树中的文件夹（含其下文件）。 */
export async function deleteFileTreeFolder(page: Page, folderBasename: string): Promise<void> {
  await ensureIdeAgentFilesPanel(page);
  const node = fileTreeFolderNode(page, folderBasename);
  if ((await node.count().catch(() => 0)) === 0) {
    return;
  }
  await expect(node).toBeVisible({ timeout: 15_000 });
  await node.scrollIntoViewIfNeeded();
  await node.click({ button: "right", timeout: 15_000 });
  await expect(fileTreeContextMenu(page)).toBeVisible({ timeout: 10_000 });
  await fileTreeContextMenuItem(page, "Delete").click();
  await confirmDeleteFileTreeDialog(page);
  await expect(fileTreeFolderNode(page, folderBasename)).toHaveCount(0, { timeout: 60_000 });
}

/**
 * 清理全局工作区中历次 §15.2 残留的 `e2e-ch15-dir-*` 目录。
 * 在 15.2 开始前/结束后调用，避免文件树与项目搜索被历史数据拖慢。
 */
export async function cleanupCh15E2eArtifacts(
  page: Page,
  options: CleanupCh15E2eOptions = {},
): Promise<void> {
  const { maxFolders = 80, timeBudgetMs = 240_000, requireEmpty = false } = options;
  await ensureIdeAgentFilesPanel(page);

  const deadline = Date.now() + timeBudgetMs;
  const skipped = new Set<string>();

  for (let i = 0; i < maxFolders && Date.now() < deadline; i++) {
    const folders = (await listCh15E2eFolderNames(page)).filter((name) => !skipped.has(name));
    if (folders.length === 0) {
      break;
    }
    const target = folders[folders.length - 1]!;
    try {
      await deleteFileTreeFolder(page, target);
    } catch {
      skipped.add(target);
      if (skipped.size >= folders.length) {
        break;
      }
    }
  }

  if (!requireEmpty) {
    return;
  }
  const remaining = await listCh15E2eFolderNames(page);
  expect(
    remaining,
    `仍有 ${remaining.length} 个 §15 E2E 目录未清理：${remaining.slice(0, 5).join(", ")}${remaining.length > 5 ? "…" : ""}`,
  ).toHaveLength(0);
}

export function chatsLeftPanel(page: Page): Locator {
  return page
    .getByPlaceholder("Search conversations...")
    .locator("xpath=ancestor::div[contains(@class,'flex-col')][1]");
}

function chatSessionButtons(page: Page): Locator {
  return chatsLeftPanel(page)
    .locator("div.min-h-0.flex-1.overflow-y-auto")
    .getByRole("button")
    .filter({ has: page.locator("svg.lucide-message-square") });
}

export async function createTreeNode(
  page: Page,
  title: "Create New File" | "Create new folder",
  name: string,
  options?: { parentFolderBasename?: string },
): Promise<void> {
  const { parentFolderBasename } = options ?? {};
  if (parentFolderBasename) {
    await clickFileTreeFolder(page, parentFolderBasename);
  }

  await page.getByTitle(title).first().click();
  const input = page.locator('[data-filetree-node="true"] input').first();
  await expect(input).toBeVisible({ timeout: 15_000 });
  await input.fill(name);
  await input.press("Enter");
  const kind: FileTreeNodeKind = title === "Create new folder" ? "directory" : "file";
  const createdNode =
    parentFolderBasename && kind === "file"
      ? fileTreeFileInFolder(page, parentFolderBasename, name)
      : fileTreeNodeByBasename(page, name, kind);
  await expect(createdNode).toBeVisible({ timeout: 60_000 });
}

function fileTreeRenameInput(page: Page): Locator {
  return page.locator("[data-filetree-scroll]").getByRole("textbox").last();
}

export async function renameFileTreeNode(
  page: Page,
  basename: string,
  newName: string,
  options?: { parentFolderBasename?: string },
): Promise<void> {
  const { parentFolderBasename } = options ?? {};
  if (parentFolderBasename) {
    await ensureFileTreeFolderExpanded(page, parentFolderBasename);
  }

  const node = parentFolderBasename
    ? fileTreeFileInFolder(page, parentFolderBasename, basename)
    : fileTreeNode(page, basename);
  await expect(node).toBeVisible({ timeout: 30_000 });
  await node.scrollIntoViewIfNeeded();
  await node.click({ button: "right" });
  await expect(fileTreeContextMenu(page)).toBeVisible({ timeout: 10_000 });
  await fileTreeContextMenuItem(page, "Rename").click();
  const renameInput = fileTreeRenameInput(page);
  await expect(renameInput).toBeVisible({ timeout: 10_000 });
  await renameInput.fill(newName);
  await renameInput.press("Enter");

  const renamedNode = parentFolderBasename
    ? fileTreeFileInFolder(page, parentFolderBasename, newName)
    : fileTreeNode(page, newName);
  await expect(renamedNode).toBeVisible({ timeout: 60_000 });
}

/**
 * `editor.tsx` L138–157：Files/Search 切换钮在 `IdeAgentEditor` 顶栏，与 `ResizablePanel#ide-agent-side` **平级**。
 * 从 `#ide-agent-side` 往上 xpath 找不到该工具栏；须从右栏 `border-l` 壳层定位。
 */
function ideAgentEditorColumn(page: Page): Locator {
  return ideAgentRightPanelShell(page).locator("div.flex.min-h-0.flex-1.flex-col").first();
}

function ideAgentSideToolbar(page: Page): Locator {
  return ideAgentRightPanelShell(page)
    .locator("div.flex.h-8.shrink-0.items-center.border-b")
    .locator('div[class*="gap-0.5"]')
    .first();
}

/** `editor.tsx` L144–155：Files 为第一个 `TooltipIconButton`（lucide 0.575 的 svg 无 `lucide-*` class）。 */
function ideAgentFilesToggle(page: Page): Locator {
  return ideAgentSideToolbar(page).locator("button").nth(0);
}

function ideAgentSearchToggle(page: Page): Locator {
  return ideAgentSideToolbar(page).locator("button").nth(1);
}

function ideAgentSearchPanel(page: Page): Locator {
  // `GlobalSearchPanel`：`h3` Search + `placeholder="Enter to search"`（`type=text` → role textbox，非 searchbox）
  return ideAgentEditorColumn(page)
    .locator("div.flex.min-h-0.flex-col")
    .filter({ has: page.getByRole("heading", { name: "Search", exact: true }) })
    .filter({ has: page.getByPlaceholder("Enter to search") })
    .first();
}

function ideAgentSearchInput(panel: Locator): Locator {
  return panel.getByPlaceholder("Enter to search");
}

async function openIdeAgentGlobalSearch(page: Page): Promise<void> {
  await ensureIdeAgentRightPanelOpen(page);
  await ensureIdeAgentEditorTab(page);

  const searchInput = page.getByPlaceholder("Enter to search");
  if (await searchInput.isVisible().catch(() => false)) {
    return;
  }

  const toolbar = ideAgentSideToolbar(page);
  await expect(toolbar).toBeVisible({ timeout: 15_000 });
  const searchToggle = toolbar.locator("button").nth(1);
  await expect(searchToggle).toBeVisible({ timeout: 15_000 });
  const toggleActive = await isIdeAgentSideToggleActive(searchToggle);
  if (!toggleActive) {
    await searchToggle.click();
  }
  // Search 为 toggle：已 active 时勿再点（会关掉面板）；输入框未识别时只等待展开。
  await expect(searchInput).toBeVisible({ timeout: 15_000 });
}

/**
 * React 受控 `<input value={query} onChange=…>`：`fill()` 常不更新 jotai，`search()` 见空 pattern 直接 return。
 * `search-input.tsx` 右侧 `absolute top-1/2 right-2` 的 Aa/ab/* 钮叠在 input 上，`click()` 会被拦截。
 */
async function syncControlledSearchPattern(searchInput: Locator, query: string): Promise<void> {
  await searchInput.evaluate((el, value) => {
    const input = el as HTMLInputElement;
    input.focus();
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
  }, query);
  await expect(searchInput).toHaveValue(query, { timeout: 5_000 });
}

async function waitForIdeAgentSearchHits(
  panel: Locator,
  timeoutMs = 90_000,
  query?: string,
  fileBasename?: string,
): Promise<void> {
  const summary = panel.getByText(/[1-9]\d* results? in \d+ files?/i);
  const searching = panel.getByText("Searching...");
  const fileResultRow = fileBasename
    ? panel.locator("span.truncate.text-xs").filter({ hasText: fileBasename })
    : panel.locator("span.truncate.text-xs").first();
  const matchLine = query
    ? panel.locator("pre").filter({ hasText: query }).first()
    : panel.locator("pre").first();
  await expect
    .poll(
      async () => {
        if (await searching.isVisible().catch(() => false)) {
          return "searching";
        }
        if ((await summary.count()) > 0 && (await summary.first().isVisible().catch(() => false))) {
          return "ready";
        }
        if (
          query &&
          (await matchLine.count()) > 0 &&
          (await matchLine.isVisible().catch(() => false))
        ) {
          return "ready";
        }
        if (
          fileBasename &&
          (await fileResultRow.count()) > 0 &&
          (await fileResultRow.first().isVisible().catch(() => false))
        ) {
          return "ready";
        }
        return "empty";
      },
      { timeout: timeoutMs, intervals: [400, 800, 1_500, 2_500, 4_000] },
    )
    .toBe("ready");
}

/** Loro 协同编辑异步写盘；项目搜索读磁盘。重试间隔覆盖 autosave 防抖（约 3s）与落盘延迟。 */
const PROJECT_SEARCH_DISK_SYNC_BACKOFF_MS = [3_000, 4_000, 5_000, 6_000, 8_000, 10_000] as const;

type IdeAgentProjectSearchOptions = {
  timeoutMs?: number;
};

/** 清空 Include/Exclude 过滤，避免历史 `dir/**` 导致 0 个文件被扫描。 */
async function clearIdeAgentSearchFileFilters(page: Page): Promise<void> {
  const panel = ideAgentSearchPanel(page);
  const trigger = panel.getByText("Files to Include/Exclude", { exact: true });
  if (!(await trigger.isVisible().catch(() => false))) {
    return;
  }
  const includeInput = panel.locator("#global-search-include-pattern");
  const excludeInput = panel.locator("#global-search-exclude-pattern");
  if (!(await includeInput.isVisible().catch(() => false))) {
    await trigger.click();
  }
  for (const input of [includeInput, excludeInput]) {
    if (await input.isVisible().catch(() => false)) {
      const value = await input.inputValue();
      if (value.trim().length > 0) {
        await syncControlledSearchPattern(input, "");
      }
    }
  }
}

async function submitIdeAgentSearchQuery(panel: Locator, query: string): Promise<void> {
  // 右侧 CodeMirror 打开时抢焦点；点 Search 标题再写受控输入框
  await panel.getByRole("heading", { name: "Search", exact: true }).click();
  const searchInput = ideAgentSearchInput(panel);
  await syncControlledSearchPattern(searchInput, query);
  await searchInput.press("Enter");
  // 快速 0 结果时 `Searching...` 可能一闪而过；以输入框仍保留 query 作为已提交依据
  await expect
    .poll(
      async () => {
        if (await panel.getByText("Searching...").isVisible().catch(() => false)) {
          return "searching";
        }
        return (await searchInput.inputValue()) === query ? "submitted" : "pending";
      },
      { timeout: 15_000, intervals: [100, 200, 400, 800] },
    )
    .not.toBe("pending");
}

async function runIdeAgentProjectSearch(
  page: Page,
  panel: Locator,
  query: string,
  perAttemptTimeoutMs: number,
  fileBasename?: string,
): Promise<boolean> {
  await clearIdeAgentSearchFileFilters(page);
  await submitIdeAgentSearchQuery(panel, query);
  try {
    await waitForIdeAgentSearchHits(panel, perAttemptTimeoutMs, query, fileBasename);
    return true;
  } catch {
    return false;
  }
}

/** `SearchResultLineDisplay`：有 `position` 的行为 `role=button`，点击后 `openTabWithPosition`。 */
async function clickIdeAgentSearchMatchLine(panel: Locator, query: string, fileBasename: string): Promise<void> {
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedFile = fileBasename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matchButton = panel
    .getByRole("button")
    .filter({ has: panel.locator("pre").filter({ hasText: new RegExp(escapedQuery) }) })
    .first();
  if ((await matchButton.count()) > 0) {
    await expect(matchButton).toBeVisible({ timeout: 15_000 });
    await matchButton.click();
    return;
  }
  const matchPre = panel.locator("pre").filter({ hasText: new RegExp(escapedQuery) }).first();
  await expect(matchPre).toBeVisible({ timeout: 15_000 });
  await matchPre.click();
  const fileRow = panel.locator("span.truncate.text-xs").filter({ hasText: new RegExp(escapedFile) }).first();
  if ((await fileRow.count()) > 0) {
    await fileRow.click();
  }
}

function perAttemptSearchTimeoutMs(remainingMs: number, attempt: number): number {
  return Math.min(remainingMs, attempt < 2 ? 30_000 : attempt < 4 ? 45_000 : 60_000);
}

/**
 * 失焦编辑器并等待 autosave 防抖，促使 Loro 将编辑刷向服务端/磁盘。
 * 项目搜索（gRPC `searchInProject`）读磁盘，须待落盘后再搜。
 */
export async function blurIdeAgentEditorForAutosave(page: Page, folderBasename: string): Promise<void> {
  await clickFileTreeFolder(page, folderBasename);
  await page.waitForTimeout(12_000);
}

export function ideAgentVisibleEditor(page: Page): Locator {
  return ideAgentEditorColumn(page).locator(".cm-content").filter({ visible: true }).first();
}

/**
 * 等待 IdeAgent 右侧 CodeMirror 就绪。`createFile` 会 `setActivePathname`，但 Loro 首 sync 完成前
 * 仅显示 `EditorLoadingOverlay`（「Syncing document…」），无 `.cm-content`。
 */
export async function waitForIdeAgentEditorReady(page: Page, timeoutMs = 120_000): Promise<void> {
  const editorColumn = ideAgentEditorColumn(page);
  await expect
    .poll(
      async () => {
        if (await editorColumn.getByText(/Sync initialization failed/i).isVisible().catch(() => false)) {
          throw new Error("IdeAgent 文档同步失败，编辑器无法加载");
        }
        if (await editorColumn.getByText(/Syncing document/i).isVisible().catch(() => false)) {
          return false;
        }
        if (await editorColumn.getByText(/Loading\.\.\./i).isVisible().catch(() => false)) {
          return false;
        }
        if (
          await editorColumn
            .getByText(/Failed to sync document|Timed out waiting for the first document sync/i)
            .isVisible()
            .catch(() => false)
        ) {
          return false;
        }
        return await ideAgentVisibleEditor(page).isVisible().catch(() => false);
      },
      { timeout: timeoutMs, intervals: [300, 600, 1_000, 2_000] },
    )
    .toBe(true);
}

/** 在 Files 面板打开文件夹内文件；若首 sync 较慢则点击后长等 CodeMirror。 */
export async function openIdeAgentFileInFolder(
  page: Page,
  folderBasename: string,
  fileBasename: string,
): Promise<void> {
  await ensureIdeAgentFilesPanel(page);
  await ensureFileTreeFolderExpanded(page, folderBasename);
  const fileNode = fileTreeFileInFolder(page, folderBasename, fileBasename);
  await expect(fileNode).toBeVisible({ timeout: 60_000 });
  await fileNode.scrollIntoViewIfNeeded();

  const deadline = Date.now() + 120_000;
  for (let attempt = 0; Date.now() < deadline; attempt++) {
    await fileNode.click();
    try {
      await waitForIdeAgentEditorReady(page, Math.max(15_000, deadline - Date.now()));
      return;
    } catch (error) {
      if (attempt >= 2) {
        throw error;
      }
    }
  }
}

/** CodeMirror + Loro：`pressSequentially` 易与协同抢写丢字；`insertText` 一次性写入。 */
export async function fillIdeAgentEditorText(page: Page, text: string): Promise<void> {
  await waitForIdeAgentEditorReady(page);
  const editor = ideAgentVisibleEditor(page);
  await editor.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(text);
  await expect
    .poll(async () => (await editor.innerText()).includes(text), {
      timeout: 15_000,
      intervals: [200, 400, 800, 1_200],
    })
    .toBe(true);
}

/** 重命名/编辑后：重新打开文件、必要时修正正文、Ctrl+S、失焦落盘。 */
export async function saveIdeAgentFileInFolderAndFlushToDisk(
  page: Page,
  folderBasename: string,
  fileBasename: string,
  expectedEditorText?: string,
): Promise<void> {
  await ensureIdeAgentFilesPanel(page);
  await ensureFileTreeFolderExpanded(page, folderBasename);
  await openIdeAgentFileInFolder(page, folderBasename, fileBasename);
  const editor = ideAgentVisibleEditor(page);
  if (expectedEditorText) {
    const current = ((await editor.innerText()) ?? "").replace(/\s+/g, " ").trim();
    if (!current.includes(expectedEditorText)) {
      // 重命名后可能短暂读到磁盘旧内容；修正后再保存。
      await fillIdeAgentEditorText(page, expectedEditorText);
      await expect(editor).toContainText(expectedEditorText, { timeout: 15_000 });
    }
  }
  await editor.click();
  await page.keyboard.press("Control+s");
  await blurIdeAgentEditorForAutosave(page, folderBasename);
}

export async function searchAndOpenFileInIdeAgent(
  page: Page,
  query: string,
  fileBasename: string,
  options?: IdeAgentProjectSearchOptions,
): Promise<void> {
  const { timeoutMs = 120_000 } = options ?? {};
  await openIdeAgentGlobalSearch(page);
  const panel = ideAgentSearchPanel(page);
  await expect(panel).toBeVisible({ timeout: 15_000 });

  const deadline = Date.now() + timeoutMs;
  for (let attempt = 0; Date.now() < deadline; attempt++) {
    const remaining = deadline - Date.now();
    const perAttemptTimeout = perAttemptSearchTimeoutMs(remaining, attempt);
    const hit = await runIdeAgentProjectSearch(page, panel, query, perAttemptTimeout, fileBasename);
    if (hit) {
      await clickIdeAgentSearchMatchLine(panel, query, fileBasename);
      await ensureIdeAgentFilesPanel(page);
      return;
    }
    const waitMs = PROJECT_SEARCH_DISK_SYNC_BACKOFF_MS[Math.min(attempt, PROJECT_SEARCH_DISK_SYNC_BACKOFF_MS.length - 1)];
    if (Date.now() + waitMs >= deadline) {
      break;
    }
    await page.waitForTimeout(waitMs);
  }

  await ensureIdeAgentFilesPanel(page);
  expect(false, `项目搜索未命中「${query}」`).toBeTruthy();
}

function ideAgentFileTreeDropTarget(page: Page): Locator {
  return page.getByTestId("file-tree-root-area").locator("xpath=ancestor::div[contains(@class,'relative')][1]");
}

/** §15.2：将图片拖入 IdeAgent 文件树（落到工作区根目录）。失败不阻塞其余 CRUD 验收。 */
export async function uploadBinaryFileToIdeAgentFolder(page: Page, absoluteFilePath: string): Promise<void> {
  const uploadFileName = path.basename(absoluteFilePath);
  await ensureIdeAgentFilesPanel(page);
  const existingNode = fileTreeNode(page, uploadFileName);
  // 上次 §15.2 已在根目录落盘；`createFile` 冲突会 toast「Failed to upload」并白等超时。
  if (await existingNode.isVisible().catch(() => false)) {
    return;
  }

  const dropTarget = ideAgentFileTreeDropTarget(page);
  await expect(dropTarget).toBeVisible({ timeout: 15_000 });

  const base64 = (await fs.readFile(absoluteFilePath)).toString("base64");
  await dropTarget.evaluate(
    (el, payload) => {
      const bytes = Uint8Array.from(atob(payload.base64), (c) => c.charCodeAt(0));
      const file = new File([bytes], payload.fileName, { type: "image/png" });
      const dt = new DataTransfer();
      dt.items.add(file);
      for (const type of ["dragenter", "dragover", "drop"] as const) {
        el.dispatchEvent(
          new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }),
        );
      }
    },
    { base64, fileName: uploadFileName },
  );

  try {
    await expect(
      page.locator("[data-sonner-toast]").filter({
        hasText: /Successfully uploaded|Uploaded \d+ file/i,
      }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(existingNode).toBeVisible({ timeout: 60_000 });
  } catch {
    // 合成 DragEvent 在部分环境无法触发上传；或同名文件已存在（`use-drag-upload` 409）。
    if (await existingNode.isVisible().catch(() => false)) {
      return;
    }
  }
}

export function fileTreeContextMenu(page: Page): Locator {
  return page.getByRole("menu").last();
}

export function fileTreeContextMenuItem(page: Page, label: "Rename" | "Delete"): Locator {
  return fileTreeContextMenu(page).getByRole("menuitem", { name: new RegExp(`^${label}\\b`) });
}

export async function openContextMenuRenameDelete(
  page: Page,
  basename: string,
  options?: { parentFolderBasename?: string },
): Promise<void> {
  await ensureIdeAgentFilesPanel(page);
  const { parentFolderBasename } = options ?? {};
  if (parentFolderBasename) {
    await ensureFileTreeFolderExpanded(page, parentFolderBasename);
  }
  const node = parentFolderBasename
    ? fileTreeFileInFolder(page, parentFolderBasename, basename)
    : fileTreeNode(page, basename);
  await expect(node).toBeVisible({ timeout: 30_000 });
  await node.scrollIntoViewIfNeeded();
  await node.click();
  await node.click({ button: "right" });
  await expect(fileTreeContextMenu(page)).toBeVisible({ timeout: 10_000 });
  await expect(fileTreeContextMenuItem(page, "Rename")).toBeVisible({ timeout: 10_000 });
  await expect(fileTreeContextMenuItem(page, "Delete")).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press("Escape");
}

async function isIdeAgentInputIdle(page: Page): Promise<boolean> {
  const host = ideAgentInputHost(page);
  if (await host.getByTitle("Stop Message").isVisible().catch(() => false)) {
    return false;
  }
  if (
    await host
      .getByText(/Receiving response|Processing, please wait|^Thinking$/i)
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    return false;
  }
  return host.getByTitle("Send Message").first().isVisible().catch(() => false);
}

async function hasIdeAgentAssistantEcho(page: Page, echoToken: string): Promise<boolean> {
  return (await ideAgentShell(page).getByText(echoToken, { exact: true }).count()) >= 1;
}

async function waitForIdeAgentAssistantReplyDone(page: Page, echoToken?: string): Promise<void> {
  await expect
    .poll(
      async () => {
        if (echoToken && (await hasIdeAgentAssistantEcho(page, echoToken))) {
          return "done";
        }
        if (await ideAgentShell(page).getByRole("button", { name: "Regenerate" }).isVisible().catch(() => false)) {
          return "done";
        }
        if (await isIdeAgentInputIdle(page)) {
          return "done";
        }
        return "pending";
      },
      { timeout: 300_000, intervals: [200, 400, 800, 1_600, 3_200] },
    )
    .toBe("done");
}

export async function ideAgentSendUserMessage(page: Page, text: string, echoToken?: string): Promise<void> {
  const host = ideAgentInputHost(page);
  const ta = host.getByRole("textbox").first();
  await expect(ta).toBeVisible({ timeout: 15_000 });
  await ta.click();
  await ta.fill(text);
  const sendBtn = host.getByTitle("Send Message").first();
  await expect(sendBtn).toBeEnabled({ timeout: 180_000 });
  await sendBtn.click();
  await expect(ideAgentShell(page).getByText(text, { exact: true }).first()).toBeVisible({ timeout: 120_000 });
  await waitForIdeAgentAssistantReplyDone(page, echoToken);
}

export function chatSessionByTitle(page: Page, title: string): Locator {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return chatSessionButtons(page).filter({
    has: page.getByText(new RegExp(`^${escaped}$`)),
  });
}

function normalizeSessionRowText(text: string | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

type ChatSessionsSnapshot = {
  rowTexts: Set<string>;
  buttonCount: number;
};

export async function snapshotChatSessions(page: Page): Promise<ChatSessionsSnapshot> {
  const buttons = chatSessionButtons(page);
  const n = await buttons.count();
  const rowTexts = new Set<string>();
  for (let i = 0; i < n; i++) {
    rowTexts.add(normalizeSessionRowText(await buttons.nth(i).innerText()));
  }
  return { rowTexts, buttonCount: n };
}

function chatSessionsLoadingIndicator(page: Page): Locator {
  return chatsLeftPanel(page).getByText("Loading...", { exact: true });
}

export async function waitForChatSessionsListReady(page: Page, timeoutMs = 120_000): Promise<void> {
  await ensureChatsLeftPanelOpen(page);
  await expect(chatSessionsLoadingIndicator(page)).toBeHidden({ timeout: timeoutMs });
}

function activeChatSessionButton(page: Page): Locator {
  return chatSessionButtons(page).filter({ has: page.locator('[class*="ring-primary"]') }).first();
}

export async function findChatSessionAfterSend(page: Page, before: ChatSessionsSnapshot): Promise<Locator> {
  let found: Locator | undefined;
  await expect
    .poll(
      async () => {
        if (await chatSessionsLoadingIndicator(page).isVisible().catch(() => false)) {
          return false;
        }
        const buttons = chatSessionButtons(page);
        const n = await buttons.count();
        if (n <= before.buttonCount) {
          return false;
        }
        const active = activeChatSessionButton(page);
        if ((await active.count()) > 0) {
          found = active;
          return true;
        }
        for (let i = 0; i < n; i++) {
          const row = normalizeSessionRowText(await buttons.nth(i).innerText());
          if (!before.rowTexts.has(row)) {
            found = buttons.nth(i);
            return true;
          }
        }
        found = buttons.first();
        return true;
      },
      { timeout: 120_000, intervals: [250, 500, 1_000, 2_000] },
    )
    .toBe(true);
  return found!;
}

export async function renameChatSession(page: Page, session: Locator, newTitle: string): Promise<void> {
  await clickChatSessionRowAction(page, session, "Rename");
  const titleInput = session.locator('input[type="text"]');
  await expect(titleInput).toBeVisible({ timeout: 10_000 });
  await titleInput.fill(newTitle);
  await session.getByTitle("Save").click();
  await expect(chatSessionByTitle(page, newTitle)).toBeVisible({ timeout: 30_000 });
}

export function chatSessionSearchInput(page: Page): Locator {
  return page.getByPlaceholder("Search conversations...");
}

export function noMatchingConversations(page: Page): Locator {
  return chatsLeftPanel(page).getByText("No matching conversations", { exact: true });
}

export async function closeShareChatPanel(page: Page): Promise<void> {
  const shareRecipients = page.getByPlaceholder("Search recipients...");
  if (!(await shareRecipients.isVisible({ timeout: 10_000 }).catch(() => false))) {
    return;
  }
  await page
    .locator("div.flex.items-center.justify-between.border-t")
    .filter({ has: page.getByRole("button", { name: "Send Copy" }) })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(shareRecipients).toBeHidden({ timeout: 15_000 });
}

async function isChatsLeftPanelExpanded(page: Page): Promise<boolean> {
  const box = await chatSessionSearchInput(page).boundingBox();
  return box !== null && box.width >= 120;
}

export async function ensureChatsLeftPanelOpen(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        if (await isChatsLeftPanelExpanded(page)) {
          return "open";
        }
        const sidebarToggle = ideAgentHeader(page).getByTitle("Toggle Sidebar");
        if (await sidebarToggle.isVisible().catch(() => false)) {
          await sidebarToggle.click();
        }
        return "pending";
      },
      { timeout: 45_000, intervals: [350, 500, 800, 1_200] },
    )
    .toBe("open");
  await expect(chatsLeftPanel(page).getByText("Chats", { exact: true })).toBeVisible({ timeout: 15_000 });
}

export async function clickChatSessionRowAction(
  page: Page,
  session: Locator,
  actionTitle: "Rename" | "Delete session" | "Send copy to collaborators",
): Promise<void> {
  await ensureChatsLeftPanelOpen(page);
  await session.scrollIntoViewIfNeeded();
  await session.hover({ timeout: 20_000 });
  const action = session.getByTitle(actionTitle);
  await expect(action).toBeVisible({ timeout: 10_000 });
  await action.click();
}

export async function confirmDeleteChatSessionDialog(page: Page): Promise<void> {
  const deleteDialog = page.locator('[data-slot="alert-dialog-content"]').filter({
    hasText: /Delete chat session/i,
  });
  if (await deleteDialog.isVisible().catch(() => false)) {
    await deleteDialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(deleteDialog).toBeHidden({ timeout: 15_000 });
  }
}

export async function switchAwayFromSession(page: Page, sessionTitle: string): Promise<void> {
  await chatSessionSearchInput(page).fill("");
  const others = chatSessionButtons(page).filter({ hasNotText: sessionTitle });
  if ((await others.count()) > 0) {
    await others.first().click();
    return;
  }
  await chatsLeftPanel(page).getByTitle("New Chat").click();
  await expect(page.getByText(/Welcome to\s+ReasLingo chat mode/i)).toBeVisible({ timeout: 30_000 });
}

export function settingsInnerTablist(page: Page): Locator {
  return page.getByRole("tablist").filter({
    has: page.getByRole("tab", { name: "Tools", exact: true }),
  });
}
