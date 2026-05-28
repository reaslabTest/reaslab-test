import { expect, test } from "@playwright/test";

import { clearReasFlowCopilotTheoremProjectUuidArtifact } from "./data/e2e-reasflow-copilot-theorem-project-artifact";
import {
  CH16_REASFLOW_WRITING_PROBE,
  REASFLOW_CH16_AGENT_SKIP_MSG,
  REASFLOW_CH16_MODEL_SKIP_MSG,
  REASFLOW_CH16_SKIP_MSG,
  REASFLOW_COPILOT_AGENT_MENU_LABEL,
  REASFLOW_COPILOT_INPUT_PLACEHOLDER,
  ensureReasLingoVisible,
  reasLingoClickNewChatWhenIdle,
  reasLingoInputHostLocator,
  reasLingoPromptInput,
  reasLingoReasFlowWritingOutlineSuccess,
  reasLingoSidebarShellLocator,
  selectReasLingoReasProModel,
  sendReasLingoPromptAndWaitForReply,
  switchReasLingoAgentByMenuLabel,
  tryEnterReasFlowCopilotTheoremIde,
  turnOffReasLingoAutoModel,
  waitForReasLingoAssistantReplyDone,
  waitForReasLingoStreamStarted,
} from "./helpers";

test.describe("16. ReasFlow Copilot 专项测试", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(600_000);

  test.beforeAll(() => {
    clearReasFlowCopilotTheoremProjectUuidArtifact();
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        globalThis.localStorage.removeItem("rl---navigation-rail-item");
        globalThis.localStorage.removeItem("reaslingo-chat-view-mode");
      } catch {
        /* ignore */
      }
    });
  });

  test("16.1 从定理证明模板创建项目并进入定理 IDE", async ({ page }) => {
    test.skip(!(await tryEnterReasFlowCopilotTheoremIde(page)), REASFLOW_CH16_SKIP_MSG);
    await expect(page).toHaveURL(/\/projects\/[^/]+\/?$/i);
    await expect(page.getByTitle("Create New File")).toBeVisible({ timeout: 30_000 });
    const tree = page.locator(".ide-filetree").filter({ visible: true }).first();
    await expect(tree.getByText("MIL", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    await expect(
      page.locator(".bg-sidebar button").filter({ has: page.locator("svg.lucide-sliders-horizontal") }),
    ).toHaveCount(0);
  });

  /**
   * **`docs/用户场景.md` §16.2**：切换 **ReasFlow Copilot**、placeholder、隐藏 Default 专属控件、**ReasPro** 系模型、**who are you?**。
   */
  test("16.2 切换 ReasFlow Copilot 并验收输入条", async ({ page }) => {
    test.skip(!(await tryEnterReasFlowCopilotTheoremIde(page)), REASFLOW_CH16_SKIP_MSG);
    await ensureReasLingoVisible(page);
    const host = reasLingoInputHostLocator(page);
    await expect(host).toBeVisible({ timeout: 20_000 });

    await turnOffReasLingoAutoModel(page, host);
    const switched = await switchReasLingoAgentByMenuLabel(page, REASFLOW_COPILOT_AGENT_MENU_LABEL, host);
    test.skip(!switched, REASFLOW_CH16_AGENT_SKIP_MSG);

    await expect(host.locator('button[title="Switch Agent"]').first()).toBeVisible({ timeout: 15_000 });
    await expect(host.getByTitle("Chain of Thought")).toHaveCount(0);
    await expect(host.getByTitle("Web Search")).toHaveCount(0);
    await expect(host.getByTitle("More Settings")).toHaveCount(0);

    const ta = reasLingoPromptInput(host);
    await expect(ta).toHaveAttribute("placeholder", REASFLOW_COPILOT_INPUT_PLACEHOLDER, { timeout: 10_000 });

    const modelOk = await selectReasLingoReasProModel(page, host);
    test.skip(!modelOk, REASFLOW_CH16_MODEL_SKIP_MSG);

    await ta.click();
    await ta.fill("who are you?");
    const sendBtn = host.getByTitle("Send Message").first();
    await expect(sendBtn).toBeEnabled({ timeout: 180_000 });
    await sendBtn.click();
    await waitForReasLingoStreamStarted(page);
    await waitForReasLingoAssistantReplyDone(page);
  });

  /** **`docs/用户场景.md` §16.3**：**New Chat** 后发送轻量写作探针，验收结构化大纲。 */
  test("16.3 轻量科研写作探针", async ({ page }) => {
    test.skip(!(await tryEnterReasFlowCopilotTheoremIde(page)), REASFLOW_CH16_SKIP_MSG);
    await ensureReasLingoVisible(page);
    const host = reasLingoInputHostLocator(page);
    await expect(host).toBeVisible({ timeout: 20_000 });

    await turnOffReasLingoAutoModel(page, host);
    const switched = await switchReasLingoAgentByMenuLabel(page, REASFLOW_COPILOT_AGENT_MENU_LABEL, host);
    test.skip(!switched, REASFLOW_CH16_AGENT_SKIP_MSG);
    const modelOk = await selectReasLingoReasProModel(page, host);
    test.skip(!modelOk, REASFLOW_CH16_MODEL_SKIP_MSG);

    await reasLingoClickNewChatWhenIdle(page);
    await sendReasLingoPromptAndWaitForReply(page, host, CH16_REASFLOW_WRITING_PROBE);

    const shell = reasLingoSidebarShellLocator(page);
    await expect
      .poll(async () => reasLingoReasFlowWritingOutlineSuccess(await shell.innerText()), {
        timeout: 30_000,
      })
      .toBe(true);
  });
});
