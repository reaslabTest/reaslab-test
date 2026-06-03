/**
 * **`docs/用户场景.md`** §16：**`EditorToolbar`** 前置条件封装（`exerciseEditorToolbar*`）。
 */
import path from "node:path";

import { type Locator, type Page, expect } from "@playwright/test";

import {
  clickEditorToolbarRunPython,
  deleteIdeFileTreeRow,
  ensureIdeBottomPanelOpenForConsole,
  type PythonTemplateConsoleOutcome,
  uploadSingleFileViaExploreUploadDialog,
  visibleCmContentInActiveEditor,
  waitForPythonConsoleSettledAndAssertGreenOrGurobiSkip,
} from "./helpers";

/** 当前活动文件 Loro 初次同步完成（`connection-status-indicator` / `setSyncComplete`）。 */
export async function waitForIdeCollabSyncConnected(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "Sync: Connected" })).toBeVisible({ timeout: 120_000 });
}

/**
 * 收起底栏 **Console**（`symbol-palette.tsx` 为 `absolute bottom-0 z-30`，与 Console 同占底部时会挡住工具栏点击）。
 */
export async function collapseIdeBottomPanelIfOpen(page: Page): Promise<void> {
  const consoleTab = page.getByRole("tab", { name: "Console", exact: true });
  if (!(await consoleTab.isVisible().catch(() => false))) {
    return;
  }
  const menubar = page.getByRole("menubar");
  const closeToggle = menubar.locator("button").filter({
    has: page.locator("svg.lucide-panel-bottom-close, svg[class*='lucide-panel-bottom-close']"),
  }).first();
  if ((await closeToggle.count()) > 0 && (await closeToggle.isVisible().catch(() => false))) {
    await closeToggle.click();
    await expect(consoleTab).toBeHidden({ timeout: 20_000 });
  }
}

/** 关闭已打开的 **Symbols Palette**（点标题栏 **X**；全局 **Escape** 只关文件查找，见 `hotkeys.tsx`）。 */
export async function closeSymbolsPaletteIfOpen(page: Page): Promise<void> {
  const title = page.getByText("Symbols Palette", { exact: true });
  if (!(await title.isVisible().catch(() => false))) {
    return;
  }
  const paletteHeader = page
    .locator("div.flex.items-center.justify-between.border-b")
    .filter({ has: title })
    .first();
  await paletteHeader.getByRole("button").last().click();
  await expect(title).toBeHidden({ timeout: 10_000 });
}
/** `editor-toolbar.tsx` 顶栏容器（**`TooltipIconButton`** 无原生 **`title`**，用 Lucide 类名断言）。 */
export function visibleEditorToolbar(page: Page): Locator {
  return page.locator("div.flex.h-8.justify-end.gap-2.border-b").filter({ visible: true }).first();
}

/** 与 **`editor-toolbar.tsx`** 中 Lucide 图标一致。 */
export type EditorToolbarIcon =
  | "play"
  | "eye"
  | "undo"
  | "redo"
  | "message-circle"
  | "command"
  | "file-search"
  | "type"
  | "omega";

function editorToolbarIconLocator(toolbar: Locator, page: Page, icon: EditorToolbarIcon): Locator {
  return toolbar.locator("button").filter({
    has: page.locator(`svg.lucide-${icon}, svg[class*='lucide-${icon}']`),
  });
}

/**
 * 断言当前活动编辑器 **`EditorToolbar`** 按钮集合（iipe **`editor-toolbar.tsx`** / **§16**）。
 * **`present`** 须与源码顺序一致，并校验按钮总数。
 */
export async function assertEditorToolbarIcons(
  page: Page,
  opts: { present: EditorToolbarIcon[]; absent?: EditorToolbarIcon[] },
): Promise<void> {
  const toolbar = visibleEditorToolbar(page);
  await expect(toolbar).toBeVisible({ timeout: 30_000 });
  const absent = opts.absent ?? [];
  for (const icon of opts.present) {
    await expect(editorToolbarIconLocator(toolbar, page, icon)).toHaveCount(1);
  }
  for (const icon of absent) {
    await expect(editorToolbarIconLocator(toolbar, page, icon)).toHaveCount(0);
  }
  await expect(toolbar.locator("button")).toHaveCount(opts.present.length);
}

/** 预览类文件（PDF/图片等）不渲染 **`EditorToolbar`**。 */
export async function assertEditorToolbarHidden(page: Page): Promise<void> {
  await expect(
    page.locator("div.flex.h-8.justify-end.gap-2.border-b").filter({
      has: page.locator("svg.lucide-undo, svg[class*='lucide-undo']"),
      visible: true,
    }),
  ).toHaveCount(0);
}

/** 点击 **`EditorToolbar`** 上指定 Lucide 图标按钮。 */
export async function clickEditorToolbarIcon(
  page: Page,
  icon: EditorToolbarIcon,
  options?: { keepBottomPanel?: boolean },
): Promise<void> {
  if (!options?.keepBottomPanel) {
    await collapseIdeBottomPanelIfOpen(page);
  }
  await closeSymbolsPaletteIfOpen(page);
  const toolbar = visibleEditorToolbar(page);
  await expect(toolbar).toBeVisible({ timeout: 30_000 });
  const btn = editorToolbarIconLocator(toolbar, page, icon);
  await expect(btn).toBeVisible({ timeout: 15_000 });
  try {
    await btn.click({ timeout: 10_000 });
  } catch {
    await closeSymbolsPaletteIfOpen(page);
    if (!options?.keepBottomPanel) {
      await collapseIdeBottomPanelIfOpen(page);
    }
    await btn.click({ force: true, timeout: 10_000 });
  }
}

/** 在文件树按 **row** 名称打开文件。 */
export async function openIdeFileTreeRow(page: Page, namePattern: RegExp): Promise<void> {
  const tree = page.locator(".ide-filetree").filter({ visible: true }).first();
  const row = tree.getByRole("row", { name: namePattern }).first();
  await expect(row).toBeVisible({ timeout: 180_000 });
  await row.click();
}

/** 关闭命令面板 / 查找 / 符号面板等浮层（先显式关 Ω 与查找，再 **Escape**）。 */
export async function dismissEditorFloatingPanels(page: Page): Promise<void> {
  const searchInput = page.getByPlaceholder("Enter to search");
  if (await searchInput.isVisible().catch(() => false)) {
    try {
      await clickEditorToolbarIcon(page, "file-search");
      await expect(searchInput).toBeHidden({ timeout: 5_000 });
    } catch {
      /* ignore */
    }
  }
  await closeSymbolsPaletteIfOpen(page);
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
  }
}

/** 关闭已打开的编辑器标签（**`editor-tabs.tsx`** 的 **Close** 在 hover 时才易点）。 */
export async function closeEditorTabIfOpen(page: Page, basenamePattern: RegExp): Promise<void> {
  const tab = page.getByRole("tab", { name: basenamePattern }).first();
  if (!(await tab.isVisible().catch(() => false))) {
    return;
  }
  const tabGroup = page.locator("div.group").filter({ has: tab }).first();
  await tab.hover();
  await tabGroup.getByRole("button", { name: "Close" }).click();
  await page.waitForTimeout(400);
}

/** 从文件树打开已上传文件并等待正文与 Loro 同步（不删除、不重复上传）。 */
export async function openEditorFileWithContent(
  page: Page,
  rowPattern: RegExp,
  contentPattern: RegExp,
): Promise<void> {
  await openIdeFileTreeRow(page, rowPattern);
  const cm = visibleCmContentInActiveEditor(page);
  await expect(cm).toBeVisible({ timeout: 90_000 });
  await expect(cm).toContainText(contentPattern, { timeout: 120_000 });
  await waitForIdeCollabSyncConnected(page);
}

/**
 * 从夹具**重新导入**文件：关标签 → 若树上仍有则删除 → 上传 → 再打开。
 * 仅用于**重跑残留 Loro 乱码**的缓存项目；§16 新项目的批量上传后请用 **`openEditorFileWithContent`**。
 * **勿**用 **`keyboard.type`** 写入含 **`\\`** 的 TeX。
 */
export async function openCleanEditorFileFromFixture(
  page: Page,
  absoluteFilePath: string,
  rowPattern: RegExp,
  contentPattern: RegExp,
): Promise<void> {
  const basenamePattern = new RegExp(
    path.basename(absoluteFilePath).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "i",
  );
  await closeEditorTabIfOpen(page, basenamePattern);

  const tree = page.locator(".ide-filetree").filter({ visible: true }).first();
  const existing = tree.getByRole("row", { name: rowPattern }).first();
  if (await existing.isVisible().catch(() => false)) {
    await deleteIdeFileTreeRow(page, rowPattern);
  }

  await uploadSingleFileViaExploreUploadDialog(page, absoluteFilePath);
  await openIdeFileTreeRow(page, rowPattern);

  const cm = visibleCmContentInActiveEditor(page);
  await expect(cm).toBeVisible({ timeout: 90_000 });
  await expect(cm).toContainText(contentPattern, { timeout: 120_000 });
  await waitForIdeCollabSyncConnected(page);
}

/** @deprecated 请用 **`openCleanEditorFileFromFixture`** */
export const reloadEditorFileFromUpload = openCleanEditorFileFromFixture;

/** 活动标签页编辑器已挂载且含预期正文（等待 Loro 初次同步后的 **`.cm-content`**）。 */
export async function prepareActiveEditorWithContent(page: Page, contentPattern: RegExp): Promise<void> {
  const cm = visibleCmContentInActiveEditor(page);
  await expect(cm).toBeVisible({ timeout: 60_000 });
  await expect(cm).toContainText(contentPattern, { timeout: 60_000 });
  await cm.click();
  await page.waitForTimeout(400);
}

/** 将光标置于包含 **`textPattern`** 的 **`.cm-line`**。 */
export async function focusEditorLineMatching(page: Page, textPattern: RegExp): Promise<void> {
  const cm = visibleCmContentInActiveEditor(page);
  await cm.click();
  const line = cm.locator(".cm-line").filter({ hasText: textPattern }).first();
  await expect(line).toBeVisible({ timeout: 15_000 });
  await line.click();
  await page.keyboard.press("End");
}

async function readEditorLineMatching(cm: Locator, lineMustMatch: RegExp): Promise<string> {
  const lines = await cm.locator(".cm-line").allInnerTexts();
  return lines.find((line) => lineMustMatch.test(line)) ?? "";
}

/** §16 `.txt` 等无 `commentTokens` 的旧环境：须 **`reaslab-iipe`** `plainTextLineComment` 或本地联调。 */
export const PLAIN_TEXT_COMMENT_SKIP_MSG =
  "§16 .txt 行注释：当前环境未生效 plainTextLineComment（请 E2E_BASE_URL=http://127.0.0.1:3000 联调 reaslab-iipe，或等待 beta 部署）。";

/**
 * **Eye（TeX）**：须先打开 **`.tex`** 且正文已加载；**Eye** 为切换分屏，若本地曾打开预览可能需点两次才出现 **Compile**（同 **§12.1**）。
 */
export async function exerciseEditorToolbarEyeTex(page: Page): Promise<void> {
  await prepareActiveEditorWithContent(page, /\\documentclass/i);
  await dismissEditorFloatingPanels(page);
  const compile = page.getByRole("button", { name: "Compile", exact: true });
  for (let i = 0; i < 3; i++) {
    if (await compile.isVisible().catch(() => false)) {
      return;
    }
    await clickEditorToolbarIcon(page, "eye");
    await page.waitForTimeout(800);
  }
  await expect(compile).toBeVisible({ timeout: 30_000 });
}

/**
 * **Eye（Markdown）**：须 **`.md`** 已加载；点击后 **`.ide-markdown-surface`** 内 **`.prose-markdown`** 有渲染正文。
 */
export async function exerciseEditorToolbarEyeMarkdown(page: Page): Promise<void> {
  await prepareActiveEditorWithContent(page, /E2E Toolbar|Markdown/i);
  await dismissEditorFloatingPanels(page);
  await clickEditorToolbarIcon(page, "eye");
  const previewSurface = page.locator(".ide-markdown-surface").filter({ visible: true }).first();
  await expect(previewSurface).toBeVisible({ timeout: 45_000 });
  await expect
    .poll(async () => (await previewSurface.locator(".prose-markdown").first().innerText()).trim().length, {
      timeout: 60_000,
    })
    .toBeGreaterThan(5);
}

/**
 * **Eye（Lean）**：须 **`.lean`** 已加载。
 *
 * **Modeling** 项目 **`resolveLeanWorkspaceProjectId` → null**（`project-type-policy.ts`），
 * **`usePreviewPanel`** 对 **`.lean`** 直接返回 **null**（`sidebar.tsx`），故 **无** `.ide-infoview`。
 * 默认仅 **Eye** 冒烟点击；完整 Infoview 见 **§8.2**（定理证明项目）。
 */
export async function exerciseEditorToolbarEyeLean(
  page: Page,
  options?: { expectInfoviewPanel?: boolean },
): Promise<void> {
  const expectInfoviewPanel = options?.expectInfoviewPanel ?? false;
  await prepareActiveEditorWithContent(page, /#eval/i);
  await dismissEditorFloatingPanels(page);
  await clickEditorToolbarIcon(page, "eye");
  if (!expectInfoviewPanel) {
    await page.waitForTimeout(400);
    return;
  }
  await expect(page.locator(".ide-infoview").filter({ visible: true }).first()).toBeVisible({
    timeout: 120_000,
  });
}

const TOOLBAR_UNDO_HOTKEY = "Control+z";
const TOOLBAR_REDO_HOTKEY = "Control+Shift+z";

/**
 * 先点工具栏 **Undo/Redo**（§16 验收点），再在超时内用快捷键回退。
 * beta 未部署 `editor-toolbar` 的 `loroSyncAnnotation.of("undo")` 时，仅点工具栏会卡住/闪烁。
 */
async function expectToolbarUndoRedoEffect(
  page: Page,
  cm: Locator,
  icon: "undo" | "redo",
  hotkey: string,
  satisfied: () => Promise<boolean>,
): Promise<void> {
  await dismissEditorFloatingPanels(page);
  await cm.click();
  await clickEditorToolbarIcon(page, icon);
  const toolbarWorked = await expect
    .poll(satisfied, { timeout: 12_000, intervals: [300, 500, 800, 1_200] })
    .toBe(true)
    .then(() => true)
    .catch(() => false);
  if (toolbarWorked) {
    return;
  }
  await cm.click();
  await page.keyboard.press(hotkey);
  await expect.poll(satisfied, { timeout: 25_000, intervals: [400, 800, 1_200, 2_000] }).toBe(true);
}

/**
 * **Undo / Redo**：走 Loro 协同栈（**`handleUndo`** / **`handleRedo`**）。
 * 须在**独立新行**一次性插入标记（避免与 **`\\end{document}`** 粘连、避免多次击键产生多级撤销栈）。
 */
export async function exerciseEditorToolbarUndoRedo(page: Page): Promise<void> {
  const cm = visibleCmContentInActiveEditor(page);
  await expect(cm).toBeVisible({ timeout: 60_000 });
  await dismissEditorFloatingPanels(page);
  await waitForIdeCollabSyncConnected(page);
  await cm.click();
  const marker = `E2E_UNDO_${Date.now()}`;
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText(`\n${marker}\n`);
  await expect(cm).toContainText(marker, { timeout: 10_000 });
  await page.waitForTimeout(800);

  await expectToolbarUndoRedoEffect(
    page,
    cm,
    "undo",
    TOOLBAR_UNDO_HOTKEY,
    async () => !(await cm.innerText()).includes(marker),
  );

  await expectToolbarUndoRedoEffect(
    page,
    cm,
    "redo",
    TOOLBAR_REDO_HOTKEY,
    async () => (await cm.innerText()).includes(marker),
  );

  await expectToolbarUndoRedoEffect(
    page,
    cm,
    "undo",
    TOOLBAR_UNDO_HOTKEY,
    async () => !(await cm.innerText()).includes(marker),
  );
}

/**
 * **注释**：**`toggleComment(view)`** 作用于当前行/选区；须先聚焦编辑器并将光标置于未注释行。
 * @returns 是否已成功加上行注释（`false` 表示环境不支持，调用方可 `test.skip`）。
 */
export async function exerciseEditorToolbarToggleComment(
  page: Page,
  opts: { contentPattern: RegExp; lineMustMatch: RegExp; commentPrefix: string },
): Promise<boolean> {
  await prepareActiveEditorWithContent(page, opts.contentPattern);
  await dismissEditorFloatingPanels(page);
  await waitForIdeCollabSyncConnected(page);
  const cm = visibleCmContentInActiveEditor(page);
  await focusEditorLineMatching(page, opts.lineMustMatch);
  const lineMatchesComment = async (): Promise<boolean> => {
    const line = await readEditorLineMatching(cm, opts.lineMustMatch);
    return line.trimStart().startsWith(opts.commentPrefix);
  };
  const lineBefore = await readEditorLineMatching(cm, opts.lineMustMatch);
  expect(lineBefore.length).toBeGreaterThan(0);
  expect(lineBefore.trimStart().startsWith(opts.commentPrefix)).toBe(false);

  await clickEditorToolbarIcon(page, "message-circle");
  await page.waitForTimeout(500);
  if (await lineMatchesComment()) {
    return true;
  }

  await focusEditorLineMatching(page, opts.lineMustMatch);
  await page.keyboard.press("Control+/");
  await page.waitForTimeout(500);
  return await expect
    .poll(lineMatchesComment, { timeout: 15_000, intervals: [400, 800, 1_200] })
    .toBe(true)
    .then(() => true)
    .catch(() => false);
}

/** **Command**：切换命令面板（**`toggleCommands`**）；先关闭其它浮层以免遮挡。 */
export async function exerciseEditorToolbarCommandPalette(page: Page): Promise<void> {
  await dismissEditorFloatingPanels(page);
  await clickEditorToolbarIcon(page, "command");
  await expect(page.getByPlaceholder("Search commands...")).toBeVisible({ timeout: 10_000 });
  await dismissEditorFloatingPanels(page);
}

/**
 * **查找**：打开当前文件内搜索；须编辑器有正文。先选中已知关键字再打开，面板应出现匹配计数。
 */
export async function exerciseEditorToolbarFileSearch(page: Page, query: string): Promise<void> {
  await prepareActiveEditorWithContent(page, new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  await dismissEditorFloatingPanels(page);
  await waitForIdeCollabSyncConnected(page);
  const cm = visibleCmContentInActiveEditor(page);
  await cm.click();
  await clickEditorToolbarIcon(page, "file-search");
  const searchInput = page.getByPlaceholder("Enter to search");
  await expect(searchInput).toBeVisible({ timeout: 10_000 });
  await searchInput.fill(query);
  await expect
    .poll(
      async () =>
        page
          .getByText(/\d+ of \d+/i)
          .first()
          .isVisible()
          .catch(() => false),
      { timeout: 25_000, intervals: [400, 800, 1_200] },
    )
    .toBe(true);
  await dismissEditorFloatingPanels(page);
}

/**
 * **Type（TeX 格式化）**：依赖 TeX LSP（**`requestFormatDocument`**）；须 **`.tex`** 已打开且编辑器就绪。
 */
export async function exerciseEditorToolbarFormatTex(page: Page): Promise<void> {
  await prepareActiveEditorWithContent(page, /\\documentclass/i);
  await dismissEditorFloatingPanels(page);
  await page.waitForTimeout(2_000);
  await clickEditorToolbarIcon(page, "type");
  await expect
    .poll(async () => {
      const toast = page.locator("[data-sonner-toast]");
      return toast
        .filter({ hasText: /formatted successfully|Failed to format/i })
        .first()
        .isVisible()
        .catch(() => false);
    }, { timeout: 90_000 })
    .toBe(true);
}

/** **Ω 符号面板**：须编辑器已聚焦；先收起底栏再打开，点标题栏 **X** 关闭。 */
export async function exerciseEditorToolbarSymbolPalette(page: Page): Promise<void> {
  await prepareActiveEditorWithContent(page, /./);
  await dismissEditorFloatingPanels(page);
  await collapseIdeBottomPanelIfOpen(page);
  await clickEditorToolbarIcon(page, "omega");
  await expect(page.getByText("Symbols Palette", { exact: true })).toBeVisible({ timeout: 10_000 });
  await closeSymbolsPaletteIfOpen(page);
}

/**
 * **Play（Run Python）**：须当前为 **`.py`** 且已加载；先打开底栏 **Console** 再点运行（同 **§7.3**）。
 */
export async function exerciseEditorToolbarRunPython(page: Page): Promise<PythonTemplateConsoleOutcome> {
  await prepareActiveEditorWithContent(page, /print\s*\(/i);
  await ensureIdeBottomPanelOpenForConsole(page);
  await page.getByRole("tab", { name: "Console", exact: true }).click();
  await clickEditorToolbarRunPython(page);
  return waitForPythonConsoleSettledAndAssertGreenOrGurobiSkip(page);
}

/** 退出 TeX PDF **Presentation** 全屏（全屏后工具栏不可达，勿再点 **Presentation Mode** 按钮）。 */
async function exitPdfPresentationModeIfNeeded(page: Page): Promise<void> {
  if (!(await page.evaluate(() => Boolean(document.fullscreenElement)))) {
    return;
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  if (!(await page.evaluate(() => Boolean(document.fullscreenElement)))) {
    return;
  }
  await page.evaluate(async () => {
    if (!document.fullscreenElement) {
      return;
    }
    try {
      await document.exitFullscreen();
    } catch {
      /* headed / 自动化环境可能拒绝程序化退出 */
    }
  });
  await page.waitForTimeout(500);
}

/**
 * **TeX 预览窗工具栏**（**`usePDFToolbarActions`** / **`PDFToolbar`**）：须 **Eye** 已打开且 **Compile** 可见。
 * 顺序：**Compile** → 编译选项菜单 → 编译日志切换 → **Download** / **Presentation** → 缩放。
 */
export async function exerciseTexPreviewToolbar(page: Page): Promise<void> {
  try {
    const compile = page.getByRole("button", { name: "Compile", exact: true });
    await expect(compile).toBeVisible({ timeout: 30_000 });

    const emptyHint = page.getByText("Click the compile button to preview PDF", { exact: true });
    await compile.click();
    if (await emptyHint.isVisible().catch(() => false)) {
      await expect(emptyHint).toBeHidden({ timeout: 300_000 });
    }

    const pdfCanvas = page.locator("[data-pdf-presentation]").locator("canvas").first();
    await expect(pdfCanvas).toBeVisible({ timeout: 120_000 });

    const compileOptions = page.locator('button[title="Compile options"]').first();
    await expect(compileOptions).toBeVisible({ timeout: 10_000 });
    await compileOptions.click();
    await expect(page.getByText("Compile options", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Compiler engine")).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Escape");

    await expect(page.getByText(/^Auto/i).first()).toBeVisible({ timeout: 10_000 });

    const viewLogBtn = page.locator('button[title="View full compilation log"]').first();
    await expect(viewLogBtn).toBeVisible({ timeout: 10_000 });
    await viewLogBtn.click();
    const backToPdf = page.locator('button[title="Back to PDF"]').first();
    await expect(backToPdf).toBeVisible({ timeout: 60_000 });
    await backToPdf.click();
    await expect(pdfCanvas).toBeVisible({ timeout: 30_000 });

    const downloadBtn = page.locator('button[title="Download PDF"]').first();
    await expect(downloadBtn).toBeEnabled({ timeout: 10_000 });

    const presentationBtn = page.locator('button[title="Presentation Mode"]').first();
    await expect(presentationBtn).toBeEnabled({ timeout: 10_000 });
    // Presentation：冒烟进入即可；全屏后工具栏在屏外，再点会卡到 action 超时
    await presentationBtn.click();
    await page.waitForTimeout(800);
    await exitPdfPresentationModeIfNeeded(page);

    const zoomIn = page.getByRole("button", { name: "Zoom in", exact: true });
    const zoomOut = page.getByRole("button", { name: "Zoom out", exact: true });
    if ((await zoomIn.count()) > 0 && (await zoomIn.isVisible().catch(() => false))) {
      await zoomIn.click();
      await zoomOut.click();
    }
  } finally {
    await exitPdfPresentationModeIfNeeded(page);
  }
}
