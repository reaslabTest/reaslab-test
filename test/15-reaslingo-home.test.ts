import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import {
  chatSessionByTitle,
  chatSessionSearchInput,
  chatsLeftPanel,
  clickChatSessionRowAction,
  closeShareChatPanel,
  confirmDeleteChatSessionDialog,
  createTreeNode,
  ensureChatsLeftPanelOpen,
  ensureIdeAgentFilesPanel,
  ensureIdeAgentWelcomeScreen,
  fileTreeContextMenu,
  fileTreeContextMenuItem,
  fileTreeNode,
  fileTreeUploadButton,
  findChatSessionAfterSend,
  ideAgentHeader,
  ideAgentSendUserMessage,
  ideAgentShell,
  noMatchingConversations,
  openContextMenuRenameDelete,
  openGlobalReasLingoFromHome,
  renameChatSession,
  renameFileTreeNode,
  rightPanelHeader,
  searchAndOpenFileInIdeAgent,
  settingsInnerTablist,
  snapshotChatSessions,
  switchAwayFromSession,
  waitForChatSessionsListReady,
} from "./15-reaslingo-home-helper";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TEST_UPLOAD_PNG = path.join(REPO_ROOT, "test/data/test_upload.png");

/**
 * **用户场景 §15**：登录后从 **`/home`** 顶栏 **ReasLingo** 进入 **`/reaslingo`**，验收 Files / Settings / 会话历史（见 `docs/用户场景.md`）。
 *
 * 单文件调试：`pnpm run test:15:headed`
 */

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
    await expect(editor).toContainText(fileMarker, { timeout: 30_000 });

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
    await expect(fileTreeNode(page, renamedFile)).toBeVisible({ timeout: 30_000 });

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
