import { expect, type Locator, type Page } from "@playwright/test";

import { gotoWithRetry } from "../common/e2e-nav";
import { absUrl } from "../common/global-setup";

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

async function ensureIdeAgentRightPanelOpen(page: Page): Promise<void> {
  if (await rightPanelHeader(page).isVisible().catch(() => false)) {
    return;
  }
  const headerToggle = ideAgentHeader(page).getByTitle("Toggle Right Panel");
  await expect(headerToggle).toBeVisible({ timeout: 30_000 });
  await headerToggle.click();
  await expect(rightPanelHeader(page)).toBeVisible({ timeout: 30_000 });
}

export async function ensureIdeAgentFilesPanel(page: Page): Promise<void> {
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

export function fileTreeNode(page: Page, basename: string): Locator {
  return page.locator(`[data-node-pathname*="${basename}"]`).first();
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
): Promise<void> {
  await page.getByTitle(title).first().click();
  const input = page.locator('[data-filetree-node="true"] input').first();
  await expect(input).toBeVisible({ timeout: 15_000 });
  await input.fill(name);
  await input.press("Enter");
  await expect(fileTreeNode(page, name)).toBeVisible({ timeout: 60_000 });
}

/** 项目 IDE / IdeAgent **Explore** 根目录新建文件（与 **`createTreeNode`** 一致）。 */
export async function createProjectIdeRootFile(page: Page, fileName: string): Promise<void> {
  await createTreeNode(page, "Create New File", fileName);
}

function fileTreeRenameInput(page: Page): Locator {
  return page.locator("[data-filetree-scroll]").getByRole("textbox").last();
}

export async function renameFileTreeNode(page: Page, basename: string, newName: string): Promise<void> {
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

function ideAgentSearchPanel(page: Page): Locator {
  const searchInput = page.getByPlaceholder("Enter to search");
  return page
    .locator("div.flex.min-h-0.flex-col")
    .filter({ has: searchInput })
    .filter({ has: page.getByRole("heading", { name: "Search", exact: true }) })
    .first();
}

async function waitForIdeAgentSearchHits(panel: Locator, timeoutMs = 90_000): Promise<void> {
  const summary = panel.getByText(/[1-9]\d* results? in \d+ files?/i);
  const searching = panel.getByText("Searching...");
  await expect
    .poll(
      async () => {
        if (await searching.isVisible().catch(() => false)) {
          return "searching";
        }
        if ((await summary.count()) > 0 && (await summary.first().isVisible().catch(() => false))) {
          return "ready";
        }
        return "empty";
      },
      { timeout: timeoutMs, intervals: [400, 800, 1_500, 2_500, 4_000] },
    )
    .toBe("ready");
}

export async function searchAndOpenFileInIdeAgent(
  page: Page,
  query: string,
  fileBasename: string,
): Promise<void> {
  await openIdeAgentGlobalSearch(page);
  const searchInput = page.getByPlaceholder("Enter to search");
  const panel = ideAgentSearchPanel(page);
  await expect(panel).toBeVisible({ timeout: 15_000 });

  const escaped = fileBasename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let ready = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    await searchInput.fill(query);
    await searchInput.press("Enter");
    try {
      await waitForIdeAgentSearchHits(panel, attempt === 2 ? 120_000 : 45_000);
      ready = true;
      break;
    } catch {
      if (attempt < 2) {
        await page.waitForTimeout(2_000);
      }
    }
  }
  expect(ready, `项目搜索未命中「${query}」（保存/重命名后索引可能尚未就绪）`).toBeTruthy();

  const fileHit = panel.getByText(new RegExp(escaped)).first();
  await expect(fileHit).toBeVisible({ timeout: 15_000 });
  await fileHit.click();
}

function ideAgentFileTreeToolbar(page: Page): Locator {
  return page
    .locator("div.flex.items-center.justify-between.gap-2")
    .filter({ has: page.getByTitle("Create New File") })
    .first();
}

export function fileTreeUploadButton(page: Page): Locator {
  return ideAgentFileTreeToolbar(page).getByTitle("Upload Files", { exact: true });
}

export function fileTreeContextMenu(page: Page): Locator {
  return page.getByRole("menu").last();
}

export function fileTreeContextMenuItem(page: Page, label: "Rename" | "Delete"): Locator {
  return fileTreeContextMenu(page).getByRole("menuitem", { name: new RegExp(`^${label}\\b`) });
}

export async function openContextMenuRenameDelete(page: Page, basename: string): Promise<void> {
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
