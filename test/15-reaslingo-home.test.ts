import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { gotoWithRetry } from "../common/e2e-nav";
import { absUrl } from "../common/global-setup";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TEST_UPLOAD_PNG = path.join(REPO_ROOT, "test/data/test_upload.png");

/**
 * **用户场景 §15**：登录后从 **`/home`** 顶栏 **ReasLingo** 进入 **`/reaslingo`**，验收 Files / Settings / 会话历史（见 `docs/用户场景.md`）。
 *
 * 单文件调试：`pnpm run test:15:headed`
 */
async function gotoMarketingHome(page: Page): Promise<void> {
  let res = await gotoWithRetry(page, absUrl("/home"), { waitUntil: "domcontentloaded" });
  if (!res?.ok()) {
    res = await gotoWithRetry(page, absUrl("/"), { waitUntil: "domcontentloaded" });
  }
  expect(res?.ok(), `首屏导航状态 ${res?.status()}`).toBeTruthy();
}

/**
 * **`reaslab-iipe` `ide-agent.tsx`**：`IdeAgentWelcome` 仅在 **`messages.length === 0`** 时渲染；
 * `/reaslingo` 进入全局工作区后常会**恢复上次会话**（侧栏已有历史条目），此时中间区为消息流而非欢迎页。
 */
async function ensureIdeAgentWelcomeScreen(page: Page): Promise<void> {
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

async function openGlobalReasLingoFromHome(page: Page): Promise<void> {
  await gotoMarketingHome(page);
  const link = page.locator("header").locator('a[href="/reaslingo"]').first();
  await expect(link).toBeVisible({ timeout: 60_000 });
  // 与 `header-nav` 一致；直接 `goto` 比 `click` 等待导航更抗 WSL/CF 瞬时断连（`reaslab-iipe` `app/home/header-nav.tsx`）。
  await gotoWithRetry(page, absUrl("/reaslingo"), {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  await expect(page.getByPlaceholder("Search conversations...")).toBeVisible({ timeout: 120_000 });
  await expect(ideAgentHeader(page)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTitle("Send Message").first()).toBeVisible({ timeout: 30_000 });
  await ensureIdeAgentWelcomeScreen(page);
  await ensureIdeAgentRightPanelOpen(page);
  await expect(page.getByText("Activity", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
}

function ideAgentShell(page: Page): Locator {
  return page.locator("div.flex.h-screen.w-full.bg-background").first();
}

function ideAgentInputHost(page: Page): Locator {
  return ideAgentShell(page).filter({ has: page.getByTitle("Send Message") });
}

function ideAgentHeader(page: Page): Locator {
  return page
    .locator("div.flex.h-10.shrink-0.items-center.justify-between.border-b.px-3")
    .filter({ has: page.getByText("ReasLingo", { exact: true }) })
    .first();
}

/** 右栏顶栏（含 **Activity**；与中间 **IdeAgentHeader** 区分）。 */
function rightPanelHeader(page: Page): Locator {
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

/** 右栏已收起时，仅点**中间顶栏**的 **Toggle Right Panel** 展开；勿点右栏头上的同名按钮（会收起）。 */
async function ensureIdeAgentRightPanelOpen(page: Page): Promise<void> {
  if (await rightPanelHeader(page).isVisible().catch(() => false)) {
    return;
  }
  const headerToggle = ideAgentHeader(page).getByTitle("Toggle Right Panel");
  await expect(headerToggle).toBeVisible({ timeout: 30_000 });
  await headerToggle.click();
  await expect(rightPanelHeader(page)).toBeVisible({ timeout: 30_000 });
}

/**
 * 进入右栏 **Files** 编辑区并露出文件树工具栏。
 * 已有打开的文件 Tab 时顶栏无 **Files** 字样，需点编辑器内 **Files** 图标或某一文件 Tab。
 */
async function ensureIdeAgentFilesPanel(page: Page): Promise<void> {
  await ensureIdeAgentRightPanelOpen(page);

  if (await isFileTreeToolbarVisible(page)) {
    return;
  }

  const filesToggle = ideAgentFilesToggle(page);
  if (await filesToggle.isVisible().catch(() => false)) {
    await filesToggle.click();
  } else {
    const openFileTab = rightPanelHeader(page).locator("button[type='button']").filter({
      hasNot: page.getByText("Activity", { exact: true }),
    });
    if ((await openFileTab.count()) > 0) {
      await openFileTab.first().click();
    }
  }

  await expect(page.getByTitle("Create New File").first()).toBeVisible({ timeout: 60_000 });
}

function fileTreeNode(page: Page, basename: string): Locator {
  return page.locator(`[data-node-pathname*="${basename}"]`).first();
}

/** 左栏收起时外层为 `w-0` 且无 `border-r`；从搜索框向上锚定，勿依赖 `border-r`。 */
function chatsLeftPanel(page: Page): Locator {
  return page
    .getByPlaceholder("Search conversations...")
    .locator("xpath=ancestor::div[contains(@class,'flex-col')][1]");
}

/** 左栏会话行（`SessionItem`：`role=button` + MessageSquare 图标；勿用 `\\d+ messages` 过滤——重命名编辑态会隐藏 meta）。 */
function chatSessionButtons(page: Page): Locator {
  return chatsLeftPanel(page)
    .locator("div.min-h-0.flex-1.overflow-y-auto")
    .getByRole("button")
    .filter({ has: page.locator("svg.lucide-message-square") });
}

async function createTreeNode(page: Page, title: "Create New File" | "Create new folder", name: string): Promise<void> {
  await page.getByTitle(title).first().click();
  const input = page.locator('[data-filetree-node="true"] input').first();
  await expect(input).toBeVisible({ timeout: 15_000 });
  await input.fill(name);
  await input.press("Enter");
  await expect(fileTreeNode(page, name)).toBeVisible({ timeout: 60_000 });
}

/** 重命名：`RenameOverlay` 在 `[data-filetree-scroll]` 内渲染为 role=textbox，非 new-file-input。 */
function fileTreeRenameInput(page: Page): Locator {
  return page.locator("[data-filetree-scroll]").getByRole("textbox").last();
}

async function renameFileTreeNode(page: Page, basename: string, newName: string): Promise<void> {
  await fileTreeNode(page, basename).click({ button: "right" });
  await expect(fileTreeContextMenu(page)).toBeVisible({ timeout: 10_000 });
  await fileTreeContextMenuItem(page, "Rename").click();
  const renameInput = fileTreeRenameInput(page);
  await expect(renameInput).toBeVisible({ timeout: 10_000 });
  await renameInput.fill(newName);
  await renameInput.press("Enter");
  await expect(fileTreeNode(page, newName)).toBeVisible({ timeout: 60_000 });
}

function ideAgentSideToolbar(page: Page): Locator {
  return page
    .locator("div.flex.h-8.shrink-0.items-center.border-b")
    .locator('div[class*="gap-0.5"]')
    .first();
}

function ideAgentFilesToggle(page: Page): Locator {
  return ideAgentSideToolbar(page).locator("button").nth(0);
}

function ideAgentSearchToggle(page: Page): Locator {
  return ideAgentSideToolbar(page).locator("button").nth(1);
}

async function openIdeAgentGlobalSearch(page: Page): Promise<void> {
  const searchToggle = ideAgentSearchToggle(page);
  await expect(searchToggle).toBeVisible({ timeout: 15_000 });
  await searchToggle.click();
  const searchInput = page.getByPlaceholder("Enter to search");
  if (!(await searchInput.isVisible().catch(() => false))) {
    await searchToggle.click();
  }
  await expect(searchInput).toBeVisible({ timeout: 15_000 });
}

async function searchAndOpenFileInIdeAgent(page: Page, query: string, fileBasename: string): Promise<void> {
  await openIdeAgentGlobalSearch(page);
  const searchInput = page.getByPlaceholder("Enter to search");
  await searchInput.fill(query);
  await searchInput.press("Enter");
  await expect(page.getByText(/[1-9]\d* results? in \d+ files?/i).first()).toBeVisible({ timeout: 60_000 });
  await page.getByText(new RegExp(fileBasename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).first().click();
}

function ideAgentFileTreeToolbar(page: Page): Locator {
  return page
    .locator("div.flex.items-center.justify-between.gap-2")
    .filter({ has: page.getByTitle("Create New File") })
    .first();
}

function fileTreeUploadButton(page: Page): Locator {
  // IdeAgent 文件树工具栏为 exact title；勿用 substring，否则会点到输入区「Upload Files for AI Chat」。
  return ideAgentFileTreeToolbar(page).getByTitle("Upload Files", { exact: true });
}

function fileTreeContextMenu(page: Page): Locator {
  return page.getByRole("menu").last();
}

function fileTreeContextMenuItem(page: Page, label: "Rename" | "Delete"): Locator {
  return fileTreeContextMenu(page).getByRole("menuitem", { name: new RegExp(`^${label}\\b`) });
}

async function openContextMenuRenameDelete(page: Page, basename: string): Promise<void> {
  const node = fileTreeNode(page, basename);
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

/** 助理气泡内出现与探针一致的纯 token 文本（用户气泡为整句指令，不会 exact 匹配 token）。 */
async function hasIdeAgentAssistantEcho(page: Page, echoToken: string): Promise<boolean> {
  return (await ideAgentShell(page).getByText(echoToken, { exact: true }).count()) >= 1;
}

/** 极短回复可能在断言前已结束流式阶段，勿要求先看到 Stop / Processing。 */
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

async function ideAgentSendUserMessage(page: Page, text: string, echoToken?: string): Promise<void> {
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

function chatSessionByTitle(page: Page, title: string): Locator {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return chatSessionButtons(page).filter({
    has: page.getByText(new RegExp(`^${escaped}$`)),
  });
}

function normalizeSessionRowText(text: string | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

type ChatSessionsSnapshot = {
  /** 各行 `innerText` 归一化后集合（重复标题会折叠，勿单独用于判断「是否新增」）。 */
  rowTexts: Set<string>;
  /** `chatSessionButtons` 数量（发消息前应记录）。 */
  buttonCount: number;
};

async function snapshotChatSessions(page: Page): Promise<ChatSessionsSnapshot> {
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

/** `useChatSessions` 在 `refetchSessions` 时会短暂替换列表为 Loading…，须等其结束再点选行。 */
async function waitForChatSessionsListReady(page: Page, timeoutMs = 120_000): Promise<void> {
  await ensureChatsLeftPanelOpen(page);
  await expect(chatSessionsLoadingIndicator(page)).toBeHidden({ timeout: timeoutMs });
}

/** 当前选中会话（`SessionItem` **`isActive`** → **`ring-1 ring-primary/20`**）。 */
function activeChatSessionButton(page: Page): Locator {
  return chatSessionButtons(page).filter({ has: page.locator('[class*="ring-primary"]') }).first();
}

/**
 * 发消息后定位待重命名会话：等列表非 Loading 且条数增加；优先 **active** 行，其次文案 diff，最后 **首条**（与 `upsertSession` 置顶一致，应对多个 **New Chat · 1 messages** 文案相同）。
 */
async function findChatSessionAfterSend(page: Page, before: ChatSessionsSnapshot): Promise<Locator> {
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

async function renameChatSession(page: Page, session: Locator, newTitle: string): Promise<void> {
  await clickChatSessionRowAction(page, session, "Rename");
  // `SessionItem.tsx` 编辑态为 `<input type="text">`；须限定在当前行内（勿用全局 textbox）。
  const titleInput = session.locator('input[type="text"]');
  await expect(titleInput).toBeVisible({ timeout: 10_000 });
  await titleInput.fill(newTitle);
  await session.getByTitle("Save").click();
  await expect(chatSessionByTitle(page, newTitle)).toBeVisible({ timeout: 30_000 });
}

function chatSessionSearchInput(page: Page): Locator {
  return page.getByPlaceholder("Search conversations...");
}

function noMatchingConversations(page: Page): Locator {
  return chatsLeftPanel(page).getByText("No matching conversations", { exact: true });
}

/** Share 会 `openTab(reaslingo://share)` 并 **`closeLeftPanel`** 收起左栏；须点 **Cancel** 关闭 Share Chat Tab（Escape 无效）。 */
async function closeShareChatPanel(page: Page): Promise<void> {
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

/** 左栏 **Search conversations…** 输入框有足够宽度（`ResizablePanel` 已展开，非 `collapsedSize=0` 叠在中间区下）。 */
async function isChatsLeftPanelExpanded(page: Page): Promise<boolean> {
  const box = await chatSessionSearchInput(page).boundingBox();
  return box !== null && box.width >= 120;
}

/**
 * **`ide-agent/left-panel.tsx`**：Share 调 **`onClose()`** → **`closeLeftPanel`**；中间顶栏 **Toggle Sidebar** 可再展开。
 * 勿仅用 **Chats** 文案可见——折叠态节点仍在 DOM，hover 会被 **`ide-agent-chat`** 遮挡。
 */
async function ensureChatsLeftPanelOpen(page: Page): Promise<void> {
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

/** `SessionItem` 行内操作钮为 **`group-hover:flex`**；须先保证左栏已展开再 hover。 */
async function clickChatSessionRowAction(
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

async function confirmDeleteChatSessionDialog(page: Page): Promise<void> {
  const deleteDialog = page.locator('[data-slot="alert-dialog-content"]').filter({
    hasText: /Delete chat session/i,
  });
  if (await deleteDialog.isVisible().catch(() => false)) {
    await deleteDialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(deleteDialog).toBeHidden({ timeout: 15_000 });
  }
}

/** §15.4：优先切到其它历史会话；若无则 **New Chat**（不再向 AI 提问）。 */
async function switchAwayFromSession(page: Page, sessionTitle: string): Promise<void> {
  await chatSessionSearchInput(page).fill("");
  const others = chatSessionButtons(page).filter({ hasNotText: sessionTitle });
  if ((await others.count()) > 0) {
    await others.first().click();
    return;
  }
  await chatsLeftPanel(page).getByTitle("New Chat").click();
  await expect(page.getByText(/Welcome to\s+ReasLingo chat mode/i)).toBeVisible({ timeout: 30_000 });
}

function settingsInnerTablist(page: Page): Locator {
  return page.getByRole("tablist").filter({
    has: page.getByRole("tab", { name: "Tools", exact: true }),
  });
}

test.describe("15. 首页顶栏 ReasLingo", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(360_000);

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1680, height: 900 });
  });

  test("15.1 从首页进入全局 ReasLingo", async ({ page }) => {
    await openGlobalReasLingoFromHome(page);
  });

  test("15.2 右栏 Files：增删改查与上传", async ({ page }) => {
    const stamp = Date.now();
    const folderName = `e2e-ch15-dir-${stamp}`;
    const fileName = `e2e-ch15-${stamp}.txt`;
    const renamedFile = `e2e-ch15-renamed-${stamp}.txt`;
    const fileMarker = `marker-ch15-${stamp}`;

    await openGlobalReasLingoFromHome(page);
    await ensureIdeAgentFilesPanel(page);

    await createTreeNode(page, "Create new folder", folderName);
    await fileTreeNode(page, folderName).click();
    await createTreeNode(page, "Create New File", fileName);

    await fileTreeNode(page, fileName).click();
    const editor = page.locator(".cm-content").first();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await editor.click();
    await editor.pressSequentially(fileMarker);
    await page.keyboard.press("Control+s");

    await openContextMenuRenameDelete(page, fileName);

    const uploadBtn = fileTreeUploadButton(page);
    if (await uploadBtn.isVisible().catch(() => false)) {
      await uploadBtn.click();
      const uploadDialog = page.getByRole("dialog", { name: "Upload Files", exact: true });
      await expect(uploadDialog).toBeVisible({ timeout: 15_000 });
      const fileInput = uploadDialog.locator('input[type="file"]:not([webkitdirectory])').first();
      await fileInput.setInputFiles(TEST_UPLOAD_PNG);
      await expect(uploadDialog).toBeHidden({ timeout: 180_000 });
    }

    await renameFileTreeNode(page, fileName, renamedFile);

    await searchAndOpenFileInIdeAgent(page, fileMarker, renamedFile);

    await ensureIdeAgentFilesPanel(page);
    await fileTreeNode(page, folderName).click({ button: "right" });
    await expect(fileTreeContextMenu(page)).toBeVisible({ timeout: 10_000 });
    await fileTreeContextMenuItem(page, "Delete").click();
    const deleteDialog = page.locator('[data-slot="alert-dialog-content"]').filter({
      hasText: /Are you sure you want to delete/i,
    });
    await expect(deleteDialog).toBeVisible({ timeout: 20_000 });
    await deleteDialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(deleteDialog).toBeHidden({ timeout: 60_000 });
  });

  test("15.3 设置：Models / User Rules / Tools", async ({ page }) => {
    await openGlobalReasLingoFromHome(page);
    await ideAgentHeader(page).getByTitle("Settings").click();
    const tabs = settingsInnerTablist(page);
    await expect(tabs.getByRole("tab", { name: "Models", exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(tabs.getByRole("tab", { name: "User Rules", exact: true })).toBeVisible();
    await expect(tabs.getByRole("tab", { name: "Tools", exact: true })).toBeVisible();
    await ideAgentHeader(page).getByTitle("Settings").click();
    await expect(rightPanelHeader(page)).toBeVisible({ timeout: 30_000 });
  });

  test("15.4 左侧会话历史", async ({ page }) => {
    const stamp = Date.now();
    const sessionTokenA = `e2e-ch15-A-${stamp}`;
    const sessionMsgA = `Reply with exactly ${sessionTokenA} and nothing else.`;
    const sessionTitleA = sessionTokenA;

    await openGlobalReasLingoFromHome(page);

    await ensureChatsLeftPanelOpen(page);
    const beforeSessions = await snapshotChatSessions(page);

    await chatsLeftPanel(page).getByTitle("New Chat").click();
    await ensureIdeAgentWelcomeScreen(page);

    await ideAgentSendUserMessage(page, sessionMsgA, sessionTokenA);
    await waitForChatSessionsListReady(page);
    await renameChatSession(page, await findChatSessionAfterSend(page, beforeSessions), sessionTitleA);
    await chatSessionSearchInput(page).fill("");

    await switchAwayFromSession(page, sessionTitleA);

    await chatSessionByTitle(page, sessionTitleA).click();
    await expect(ideAgentShell(page).getByText(sessionTokenA, { exact: true }).first()).toBeVisible({
      timeout: 60_000,
    });

    await chatSessionSearchInput(page).fill(`zzznomatch-${stamp}`);
    await expect(noMatchingConversations(page)).toBeVisible({ timeout: 30_000 });
    await chatSessionSearchInput(page).fill("");

    const targetSession = chatSessionByTitle(page, sessionTitleA);
    await clickChatSessionRowAction(page, targetSession, "Send copy to collaborators");
    await expect(page.getByPlaceholder("Search recipients...")).toBeVisible({ timeout: 30_000 });
    await closeShareChatPanel(page);

    await chatSessionSearchInput(page).fill("");
    const sessionToDelete = chatSessionByTitle(page, sessionTitleA);
    await expect(sessionToDelete).toBeVisible({ timeout: 15_000 });
    await clickChatSessionRowAction(page, sessionToDelete, "Delete session");
    await confirmDeleteChatSessionDialog(page);
    await expect(chatSessionByTitle(page, sessionTitleA)).toBeHidden({ timeout: 30_000 });
  });
});
