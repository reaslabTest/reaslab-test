import path from "node:path";
import { fileURLToPath } from "node:url";

import { type BrowserContext, type Page, expect, test } from "@playwright/test";

import { E2E_WAF_BYPASS_CONTEXT } from "../common/global-setup";
import {
  blurIdeAgentEditorForAutosave,
  cleanupCh15E2eArtifacts,
  deleteFileTreeFolder,
  uploadBinaryFileToIdeAgentFolder,
  chatSessionByTitle,
  chatSessionSearchInput,
  chatsLeftPanel,
  clickChatSessionRowAction,
  closeShareChatPanel,
  confirmDeleteChatSessionDialog,
  createTreeNode,
  ensureChatsLeftPanelOpen,
  ensureIdeAgentFilesPanel,
  ensureIdeAgentOnReasLingo,
  ensureIdeAgentWelcomeScreen,
  fillIdeAgentEditorText,
  fileTreeFileInFolder,
  ideAgentVisibleEditor,
  openIdeAgentFileInFolder,
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
  saveIdeAgentFileInFolderAndFlushToDisk,
  searchAndOpenFileInIdeAgent,
  settingsInnerTablist,
  snapshotChatSessions,
  switchAwayFromSession,
  waitForChatSessionsListReady,
} from "./15-reaslingo-home-helper";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TEST_UPLOAD_PNG = path.join(REPO_ROOT, "test/data/test_upload.png");
const STORAGE_STATE_PATH = path.join(REPO_ROOT, "common", ".auth", "storage-state.json");

/**
 * **用户场景 §15**：登录后从 **`/home`** 顶栏 **ReasLingo** 进入 **`/reaslingo`**，验收 Files / Settings / 会话历史（见 `docs/用户场景.md`）。
 *
 * 15.1～15.4 共用同一浏览器页：15.1 完成首页进入后，后续用例不再重复 `/home` 导航。
 *
 * 单文件调试：`pnpm run test:15:headed`
 */

test.describe("15. 首页顶栏 ReasLingo", () => {
  // 共用 beforeAll 的 page；关闭 per-test retry，避免 15.2 失败后 15.1 retry 时 browser 已关闭。
  test.describe.configure({ mode: "serial", retries: 0 });
  test.setTimeout(360_000);

  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({
      storageState: STORAGE_STATE_PATH,
      ...E2E_WAF_BYPASS_CONTEXT,
      viewport: { width: 1680, height: 900 },
    });
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("15.1 从首页进入全局 ReasLingo", async () => {
    await openGlobalReasLingoFromHome(page);
  });

  test("15.2 右栏 Files：增删改查与上传", async () => {
    const stamp = Date.now();
    const folderName = `e2e-ch15-dir-${stamp}`;
    const fileName = `e2e-ch15-${stamp}.txt`;
    const renamedFile = `e2e-ch15-renamed-${stamp}.txt`;
    const fileMarker = `marker-ch15-${stamp}`;
    const fileMarkerEdited = `${fileMarker}-edited`;

    await ensureIdeAgentOnReasLingo(page);
    await ensureIdeAgentFilesPanel(page);
    // 开始前尽力清扫；有总时间预算，删不完也继续跑用例（避免数十个历史目录逐个删导致卡死）。
    await cleanupCh15E2eArtifacts(page, { timeBudgetMs: 60_000, maxFolders: 30, requireEmpty: false });

    try {
      await createTreeNode(page, "Create new folder", folderName);
      await createTreeNode(page, "Create New File", fileName, { parentFolderBasename: folderName });

      await openIdeAgentFileInFolder(page, folderName, fileName);
      await fillIdeAgentEditorText(page, fileMarkerEdited);
      await page.keyboard.press("Control+s");
      await expect(ideAgentVisibleEditor(page)).toContainText(fileMarkerEdited, { timeout: 30_000 });
      await blurIdeAgentEditorForAutosave(page, folderName);

      await openContextMenuRenameDelete(page, fileName, { parentFolderBasename: folderName });
      await renameFileTreeNode(page, fileName, renamedFile, { parentFolderBasename: folderName });
      await expect(fileTreeFileInFolder(page, folderName, renamedFile)).toBeVisible({ timeout: 30_000 });
      await saveIdeAgentFileInFolderAndFlushToDisk(page, folderName, renamedFile, fileMarkerEdited);

      await searchAndOpenFileInIdeAgent(page, fileMarkerEdited, renamedFile, { timeoutMs: 240_000 });

      await uploadBinaryFileToIdeAgentFolder(page, TEST_UPLOAD_PNG);

      await deleteFileTreeFolder(page, folderName);
    } finally {
      // 清扫失败不掩盖用例本体错误；尽量删掉当次及历史残留。
      await cleanupCh15E2eArtifacts(page, { timeBudgetMs: 120_000, requireEmpty: false }).catch(() => undefined);
    }
  });

  test("15.3 设置：Models / User Rules / Tools", async () => {
    await ensureIdeAgentOnReasLingo(page);
    await ideAgentHeader(page).getByTitle("Settings").click();
    const tabs = settingsInnerTablist(page);
    await expect(tabs.getByRole("tab", { name: "Models", exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(tabs.getByRole("tab", { name: "User Rules", exact: true })).toBeVisible();
    await expect(tabs.getByRole("tab", { name: "Tools", exact: true })).toBeVisible();
    await ideAgentHeader(page).getByTitle("Settings").click();
    await expect(rightPanelHeader(page)).toBeVisible({ timeout: 30_000 });
  });

  test("15.4 左侧会话历史", async () => {
    const stamp = Date.now();
    const sessionTokenA = `e2e-ch15-A-${stamp}`;
    const sessionMsgA = `Reply with exactly ${sessionTokenA} and nothing else.`;
    const sessionTitleA = sessionTokenA;

    await ensureIdeAgentOnReasLingo(page);

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
