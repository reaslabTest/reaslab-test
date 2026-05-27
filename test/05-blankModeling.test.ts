import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { E2E_SHARE_INVITE_EMAIL } from "../common/global-setup";
import { clearModelingProjectUuidArtifact } from "./data/e2e-modeling-project-artifact";
import {
  MODELING_CH5_CHAIN_OF_THOUGHT_SKIP_MSG,
  MODELING_CH5_SKIP_MSG,
  ensureReasLingoVisible,
  expandIdeFileTreeRowByLabel,
  reasLingoAttachProjectFileViaAtMention,
  reasLingoInputHostLocator,
  reaslingoUploadFileForAiChat,
  tryEnterModelingProjectIde,
  waitForFileTree,
  waitForReasLingoAssistantReplyDone,
} from "./helpers";

const TEST_UPLOAD_PNG = path.join(path.dirname(fileURLToPath(import.meta.url)), "data", "test_upload.png");

/** §5.4：默认 Agent（`reaslab-agent`）走 ACP `authenticate`（llm-gateway）；未通过时 `acp-client` toast 且无法发 prompt。 */
const MODELING_CH5_4_ACP_AUTH_SKIP_MSG =
  "§5.4：默认 Agent（ACP）需 llm-gateway 认证；当前环境 authenticate 未通过（toast「Authentication required before sending a prompt」），跳过。";

/** 与 `@reaslab/file-tree` 节点 `data-name` 一致；避免树上另有 `/test_upload.png` 时 `getByText` 触发 strict 双匹配。 */
function chatUploadsTestPngTreeLabel(fileTree: Locator) {
  return fileTree.locator(`span[data-name="/chat-uploads/test_upload.png"]`);
}

/** §5.3 / §5.4：用**全英文**提问（避免非英文与 OCR 组合下乱码 / OCR Failed）；要求只输出数字答案（与 `test_upload.png` 图中「二加二」→ 4 一致）。 */
const CH5_FIXTURE_QUESTION_PROMPT =
  "Answer the question shown in the image. Reply with exactly one Arabic numeral and nothing else.";

function reasLingoHosts(page: Page) {
  return { reasLingoInputHost: reasLingoInputHostLocator(page) };
}

/** `FileReferences.tsx` 附件芯片（`div.rounded-lg`，含 OCR Processing / OCR Failed 标签）。 */
function reasLingoFileReferenceChip(reasLingoInputHost: Locator, fileName: string) {
  return reasLingoInputHost
    .getByText(fileName, { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
}

/**
 * 本轮已结束的助理消息根节点（`Message.tsx` 外层 `div.w-full`）。
 * 勿用 `host.locator('div.w-full').filter({ has: host.locator(...) }).last()`：`has` 以 host 为根时会把
 * `MessageInput` 内大量 `w-full` 也算进去，`.last()` 常落到工具栏内不可见节点；改从 **Regenerate** 上溯。
 */
function reasLingoLastCompleteAssistantTurn(reasLingoInputHost: Locator) {
  return reasLingoInputHost
    .getByRole("button", { name: "Regenerate" })
    .last()
    .locator("xpath=ancestor::*[contains(@class,'w-full')][1]");
}

/**
 * 填写 prompt 并发送，等待本轮流式结束。
 * 勿用 `WelcomeScreen`（`img[alt="ReasLingo AI Bot"]`）隐藏作为「已发送」信号：iipe 在 `messages.length===0` 时
 * 才显示欢迎页，而首条消息写入 overlay 后会话 header/分页未水合前 `useAiCurrentSession` 仍可能为 null，欢迎页会长期可见。
 */
async function sendReasLingoPromptAndWaitForReply(
  page: Page,
  reasLingoInputHost: Locator,
  prompt: string,
): Promise<void> {
  const ta = reasLingoInputHost.locator("textarea").first();
  await expect(ta).toBeVisible({ timeout: 15_000 });
  await ta.click();
  await ta.fill(prompt);

  const sendBtn = reasLingoInputHost.getByTitle("Send Message").first();
  await expect(sendBtn).toBeEnabled({ timeout: 180_000 });
  await sendBtn.click();

  // 与 `ReasLingoChatArea.handleSendMessage` 一致：真正发出后会 `setIsLoading(true)` → Stop / Receiving。
  const streamStarted = reasLingoInputHost
    .getByTitle("Stop Message")
    .or(reasLingoInputHost.getByText(/Receiving response/i));
  await expect(streamStarted.first()).toBeVisible({ timeout: 180_000 });

  await waitForReasLingoAssistantReplyDone(page);
}

/**
 * §5.4：默认 Agent 发 prompt 前须 ACP 已认证；失败时 toast 且不会出现 Stop/Receiving。
 * 勿长时间死等 `sendReasLingoPromptAndWaitForReply` 的 180s 流式信号。
 */
async function sendReasLingoPromptOrSkipOnAcpAuth(
  page: Page,
  reasLingoInputHost: Locator,
  prompt: string,
): Promise<void> {
  const ta = reasLingoInputHost.locator("textarea").first();
  await expect(ta).toBeVisible({ timeout: 15_000 });
  await ta.click();
  await ta.fill(prompt);

  const sendBtn = reasLingoInputHost.getByTitle("Send Message").first();
  await expect(sendBtn).toBeEnabled({ timeout: 180_000 });
  await sendBtn.click();

  const authToast = page.getByText(/Authentication required before sending a prompt/i);
  const streamStarted = reasLingoInputHost
    .getByTitle("Stop Message")
    .or(reasLingoInputHost.getByText(/Receiving response/i));

  await expect(streamStarted.or(authToast).first()).toBeVisible({ timeout: 60_000 });
  if (await authToast.isVisible().catch(() => false)) {
    test.skip(true, MODELING_CH5_4_ACP_AUTH_SKIP_MSG);
  }

  await waitForReasLingoAssistantReplyDone(page);
}

/** §5.3：最后一条助理回复中出现单独数字答案（如 `4`）；答案常在 Markdown `<p>`，Thought 块在前。 */
async function expectLastAssistantNumeralAnswer(
  reasLingoInputHost: Locator,
  numeral: string,
): Promise<void> {
  const row = reasLingoLastCompleteAssistantTurn(reasLingoInputHost);
  await expect(row).toBeVisible({ timeout: 120_000 });
  await expect
    .poll(
      async () => {
        const paragraphs = row.locator("p");
        const n = await paragraphs.count();
        for (let i = n - 1; i >= 0; i--) {
          if ((await paragraphs.nth(i).innerText()).trim() === numeral) {
            return true;
          }
        }
        return (await row.getByText(numeral, { exact: true }).count()) > 0;
      },
      { timeout: 120_000, message: `助理消息中未找到单独数字答案「${numeral}」` },
    )
    .toBe(true);
}

/** §5.9～5.11：侧栏 ReasLingo 工具条在默认 1280×720 下易被裁切；仅这三条加宽视口（不设嵌套 describe，以免报告标题多一层）。 */
async function widenViewportForReasLingoInputToolbar(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1680, height: 900 });
}

/** §5.9～§5.11：`MessageInput` 仅在 **default** Agent 时渲染 Chain of Thought / Web Search / More Settings。 */
async function ensureDefaultAgentForReasLingoInputToolbar(
  page: Page,
  reasLingoInputHost: Locator,
): Promise<void> {
  const defaultAgentTrigger = reasLingoInputHost.getByRole("button", { name: /^Agent$/i });
  if (await defaultAgentTrigger.isVisible().catch(() => false)) {
    return;
  }
  const agentTrigger = reasLingoInputHost.locator('button[title="Switch Agent"]');
  await expect(agentTrigger.first()).toBeVisible({ timeout: 15_000 });
  await agentTrigger.first().click();
  const agentMenuPanel = page.locator('[data-slot="dropdown-menu-content"][class*="w-56"]');
  await expect(agentMenuPanel).toBeVisible({ timeout: 10_000 });
  // `AgentSelector`：默认 Agent 不在菜单中；再次点击当前选中项可切回 default。
  const activeItem = agentMenuPanel.locator('[data-slot="dropdown-menu-item"]').filter({
    has: page.locator("svg.lucide-check"),
  });
  await expect(activeItem.first()).toBeVisible({ timeout: 10_000 });
  await activeItem.first().click();
  await expect(agentMenuPanel).toBeHidden({ timeout: 5_000 });
  await expect(reasLingoInputHost.getByRole("button", { name: /^Agent$/i })).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * §5.9：`ChainOfThoughtSelector` 在**有效解析模型** `supportsReasoning === true` 时渲染。
 * **Auto 开启**时有效模型为系统默认（`resolveStorageModelForCapabilities`）；默认模型支持推理则**无需关 Auto** 即可见灯泡。
 * 仅当当前不可见时，再关 Auto 并遍历启用列表中的各模型行（跳过第 0 行「Auto」）。
 */
/** @returns 已出现 **Chain of Thought** 为 **`true`**；环境无可用推理模型为 **`false`**（调用方 **`test.skip`**）。 */
async function ensureChainOfThoughtControlVisible(page: Page, reasLingoInputHost: Locator): Promise<boolean> {
  const modelBtn = reasLingoInputHost.getByTitle("Switch Model");
  const cot = () => reasLingoInputHost.getByTitle("Chain of Thought");

  if ((await cot().count()) > 0) {
    await expect(cot().first()).toBeVisible({ timeout: 20_000 });
    return true;
  }

  const openModelMenu = async () => {
    await modelBtn.click();
    const panel = page.getByRole("menu").filter({ has: page.getByRole("switch") }).first();
    await expect(panel).toBeVisible({ timeout: 10_000 });
    return panel;
  };

  const panelOffAuto = await openModelMenu();
  const autoSwitch = panelOffAuto.getByRole("switch");
  if (await autoSwitch.isChecked()) {
    await autoSwitch.click();
  }
  await page.keyboard.press("Escape");
  await expect(panelOffAuto).toBeHidden({ timeout: 5_000 });

  if ((await cot().count()) > 0) {
    await expect(cot().first()).toBeVisible({ timeout: 20_000 });
    return true;
  }

  const panelCount = await openModelMenu();
  const menuRows = panelCount.locator('[data-slot="dropdown-menu-item"]');
  const n = await menuRows.count();
  await page.keyboard.press("Escape");
  await expect(panelCount).toBeHidden({ timeout: 5_000 });

  if (n <= 1) {
    return false;
  }

  for (let idx = 1; idx < n; idx++) {
    const panel = await openModelMenu();
    const rows = panel.locator('[data-slot="dropdown-menu-item"]');
    await rows.nth(idx).click();
    await expect(panel).toBeHidden({ timeout: 5_000 });
    if ((await cot().count()) > 0) {
      await expect(cot().first()).toBeVisible({ timeout: 20_000 });
      return true;
    }
  }

  return false;
}

/** §5.3 / §5.4 / §5.10：关闭模型菜单中的 Auto（§5.3 常开启）。 */
async function turnOffReasLingoAutoModel(page: Page, reasLingoInputHost: Locator): Promise<void> {
  const modelBtn = reasLingoInputHost.getByTitle("Switch Model");
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

/** §5.10：默认 Agent 下关闭 Auto 并确认 Web Search 可见（非 default Agent 不渲染该按钮）。 */
async function ensureWebSearchControlReady(page: Page, reasLingoInputHost: Locator): Promise<void> {
  await turnOffReasLingoAutoModel(page, reasLingoInputHost);
  await expect(reasLingoInputHost.getByTitle("Web Search").first()).toBeVisible({ timeout: 20_000 });
}

/** 通过 `@` 提及选中工程内 `chat-uploads/test_upload.png`（不再走 Explore `setInputFiles`，与 §5.2 单次上传一致）。 */
async function attachTestUploadPngViaAtMention(page: Page, reasLingoInputHost: Locator): Promise<void> {
  await ensureReasLingoVisible(page);
  await reasLingoAttachProjectFileViaAtMention(page, reasLingoInputHost, "test_upload.png", "test_upload");
}

test.describe("5. 创建空白项目并使用基础功能", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(600_000);

  test.beforeAll(() => {
    clearModelingProjectUuidArtifact();
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

  test("5.1 创建空白 Modeling 项目", async ({ page }) => {
    test.skip(!(await tryEnterModelingProjectIde(page)), MODELING_CH5_SKIP_MSG);
    await expect(page).toHaveURL(/\/projects\/[^/]+\/?$/i);
    await expect(page.getByTitle("Create New File")).toBeVisible({ timeout: 30_000 });
    // 建模族项目侧栏含 Solver Settings（`side-tab-bar`），定理项目才有 Semantic Search。
    await expect(
      page.locator(".bg-sidebar button").filter({ has: page.locator("svg.lucide-sliders-horizontal") }),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("5.2 上传图片", async ({ page }) => {
    test.skip(!(await tryEnterModelingProjectIde(page)), MODELING_CH5_SKIP_MSG);
    await ensureReasLingoVisible(page);

    const { reasLingoInputHost } = reasLingoHosts(page);

    await reaslingoUploadFileForAiChat(page, reasLingoInputHost, TEST_UPLOAD_PNG);

    const fileTreePanel = page.locator(".ide-filetree").filter({ visible: true }).first();
    await expandIdeFileTreeRowByLabel(page, /chat-uploads/i);
    // Explore 上传只保证进工程树，不保证 ReasLingo 输入条出现文件名芯片。
    await expect(chatUploadsTestPngTreeLabel(fileTreePanel)).toBeVisible({
      timeout: 180_000,
    });
  });

  test("5.3 使用OCR进行AI会话", async ({ page }) => {
    test.skip(!(await tryEnterModelingProjectIde(page)), MODELING_CH5_SKIP_MSG);
    await ensureReasLingoVisible(page);

    const { reasLingoInputHost } = reasLingoHosts(page);

    // §5.2 已 Explore 上传一次；此处不再 `setInputFiles`，仅用 `@` 提及引用工程内文件，避免重复上传。
    await waitForFileTree(page);
    const fileTreePanel = page.locator(".ide-filetree").filter({ visible: true }).first();
    await expandIdeFileTreeRowByLabel(page, /chat-uploads/i);
    await expect(chatUploadsTestPngTreeLabel(fileTreePanel)).toBeVisible({
      timeout: 180_000,
    });
    await attachTestUploadPngViaAtMention(page, reasLingoInputHost);

    const pngChip = reasLingoFileReferenceChip(reasLingoInputHost, "test_upload.png");
    await expect(pngChip.getByText("OCR Processing", { exact: true })).toBeHidden({
      timeout: 120_000,
    });
    await expect(pngChip.getByText("Uploading", { exact: true })).toBeHidden({ timeout: 120_000 });

    const modelBtn = reasLingoInputHost.getByTitle("Switch Model");
    await modelBtn.click();
    const modelPanel = page.getByRole("menu").filter({ has: page.getByRole("switch") }).first();
    await expect(modelPanel).toBeVisible({ timeout: 10_000 });
    const autoSwitch = modelPanel.getByRole("switch");
    if (!(await autoSwitch.isChecked())) {
      await autoSwitch.click();
    }
    await page.keyboard.press("Escape");

    await sendReasLingoPromptAndWaitForReply(page, reasLingoInputHost, CH5_FIXTURE_QUESTION_PROMPT);

    // 成功标准：助理就图中问题给出数字 4（可用 OCR 或 Agent `read_file` 读图）。
    await expectLastAssistantNumeralAnswer(reasLingoInputHost, "4");
  });

  test("5.4 默认 Agent 进行 AI 会话", async ({ page }) => {
    test.skip(!(await tryEnterModelingProjectIde(page)), MODELING_CH5_SKIP_MSG);
    await ensureReasLingoVisible(page);

    const { reasLingoInputHost } = reasLingoHosts(page);

    // `AgentSelector` 过滤 defaultAgentId，菜单仅列 Math Modeling / ReasFlow Copilot 等；默认态按钮文案为 **Agent**。
    await ensureDefaultAgentForReasLingoInputToolbar(page, reasLingoInputHost);
    const agentTrigger = reasLingoInputHost.getByRole("button", { name: /^Agent$/i });
    await expect(agentTrigger).toBeVisible({ timeout: 15_000 });
    await agentTrigger.click();
    const agentMenuPanel = page.locator('[data-slot="dropdown-menu-content"][class*="w-56"]');
    await expect(agentMenuPanel).toBeVisible({ timeout: 10_000 });
    await expect(agentMenuPanel.getByRole("menuitem").first()).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await expect(agentMenuPanel).toBeHidden({ timeout: 5_000 });

    // §5.3 常开 Auto；关闭后再发（默认 Agent 下可走 Web Search，此处勿依赖 ensureWebSearchControlReady）。
    await turnOffReasLingoAutoModel(page, reasLingoInputHost);

    // 图片/OCR 在 §5.3 已覆盖；默认 Agent 走 ACP，未认证时 skip（勿死等 180s 流式）。
    await sendReasLingoPromptOrSkipOnAcpAuth(page, reasLingoInputHost, "who are you?");
  });

  test("5.5 邀请他人共同编辑项目", async ({ page }) => {
    test.skip(!(await tryEnterModelingProjectIde(page)), MODELING_CH5_SKIP_MSG);
    await page.getByRole("button", { name: "Share", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Sharing Project" })).toBeVisible({
      timeout: 15_000,
    });
    // `InviteMember`：`#emails-input`，Enter/逗号将当前输入收为 chip 后再点 Invite。
    const emailInput = dialog.locator("#emails-input");
    await expect(emailInput).toBeVisible({ timeout: 10_000 });
    await emailInput.fill(E2E_SHARE_INVITE_EMAIL);
    await emailInput.press("Enter");
    await expect(dialog.getByText(E2E_SHARE_INVITE_EMAIL, { exact: true }).first()).toBeVisible({
      timeout: 5_000,
    });
    await dialog.getByRole("button", { name: "Invite", exact: true }).click();
    await expect(
      page.getByText(/user\(s\) has been successfully invited|already members of this project/i).first(),
    ).toBeVisible({ timeout: 60_000 });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10_000 });
  });

  test("5.6 查看项目的修改历史", async ({ page }) => {
    test.skip(!(await tryEnterModelingProjectIde(page)), MODELING_CH5_SKIP_MSG);
    const historyBtn = page.getByRole("button", { name: "History", exact: true });
    await expect(historyBtn).toBeVisible({ timeout: 15_000 });
    await historyBtn.click();
    // reaslab-iipe `menubar.tsx` → `ProjectHistoryDialog`：覆盖式对话框，不跳 `/projects/.../history`。
    const historyDialog = page.getByRole("dialog", { name: "Project History" });
    await expect(historyDialog).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/projects\/[^/]+\/?$/i);
    await expect(historyDialog.getByRole("heading", { name: "Project History" })).toBeVisible();
    await expect(historyDialog.getByText("Changed Files").first()).toBeVisible();
    await expect(historyDialog.getByText("Diff").first()).toBeVisible();
    await expect(historyDialog.getByText("Snapshots").first()).toBeVisible();
    await historyDialog.getByRole("button", { name: "Close" }).click();
    await expect(historyDialog).toBeHidden({ timeout: 10_000 });
  });

  test("5.7 项目内搜索关键字", async ({ page }) => {
    test.skip(!(await tryEnterModelingProjectIde(page)), MODELING_CH5_SKIP_MSG);
    await page.getByRole("button", { name: "Project Search" }).click();
    const searchInput = page.getByPlaceholder("Enter to search");
    await expect(searchInput).toBeVisible({ timeout: 15_000 });
    // reaslab-iipe `SearchView`：`SidebarGroup` 内直接挂 `GlobalSearchPanel`，已无 `SidebarGroupContent`。
    const projectSearchPanel = page.locator('[data-sidebar="group"]').filter({ has: searchInput });
    await expect(projectSearchPanel).toBeVisible({ timeout: 5_000 });
    await searchInput.fill("e");
    await searchInput.press("Enter");
    await expect(
      projectSearchPanel.getByText(/[1-9]\d* results? in \d+ files?/i),
    ).toBeVisible({ timeout: 20_000 });

    const noHitToken = `CH5_NOHIT_${Date.now()}_zzzz`;
    await searchInput.fill(noHitToken);
    await searchInput.press("Enter");
    await expect
      .poll(
        async () => {
          const searching = await projectSearchPanel.getByText("Searching...").isVisible();
          if (searching) {
            return "searching";
          }
          const hitSummary = await projectSearchPanel.getByText(/[1-9]\d* results? in \d+ files?/i).count();
          return hitSummary > 0 ? "has_hits" : "empty";
        },
        { timeout: 60_000 },
      )
      .toBe("empty");

    await page.getByRole("button", { name: /Explorer/i }).first().click();
  });

  test("5.8 导出项目", async ({ page }) => {
    test.skip(!(await tryEnterModelingProjectIde(page)), MODELING_CH5_SKIP_MSG);
    await page.getByRole("button", { name: "Menu" }).click();
    const zipBtn = page.getByRole("button", { name: /Source \(ZIP\)/ });
    await expect(zipBtn).toBeVisible({ timeout: 15_000 });
    const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
    await zipBtn.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename().toLowerCase().endsWith(".zip")).toBeTruthy();
  });

  test("5.9 AI会话设置（Chain of Thought）", async ({ page }) => {
    test.skip(!(await tryEnterModelingProjectIde(page)), MODELING_CH5_SKIP_MSG);
    await widenViewportForReasLingoInputToolbar(page);
    await ensureReasLingoVisible(page);

    const { reasLingoInputHost } = reasLingoHosts(page);
    await ensureDefaultAgentForReasLingoInputToolbar(page, reasLingoInputHost);
    const cotReady = await ensureChainOfThoughtControlVisible(page, reasLingoInputHost);
    test.skip(!cotReady, MODELING_CH5_CHAIN_OF_THOUGHT_SKIP_MSG);

    const cotBtn = reasLingoInputHost.getByTitle("Chain of Thought");
    await expect(cotBtn.first()).toBeVisible({ timeout: 5_000 });
    await cotBtn.first().click();
    const cotPanel = page
      .locator('[data-slot="dropdown-menu-content"]')
      .filter({ visible: true })
      .filter({ has: page.getByText("None", { exact: true }) })
      .first();
    await expect(cotPanel).toBeVisible({ timeout: 10_000 });
    await cotPanel.getByRole("menuitem").first().click();
    await expect(cotPanel).toBeHidden({ timeout: 5_000 });
  });

  test("5.10 AI会话设置（Web Search）", async ({ page }) => {
    test.skip(!(await tryEnterModelingProjectIde(page)), MODELING_CH5_SKIP_MSG);
    await widenViewportForReasLingoInputToolbar(page);
    await ensureReasLingoVisible(page);

    const { reasLingoInputHost } = reasLingoHosts(page);
    await ensureDefaultAgentForReasLingoInputToolbar(page, reasLingoInputHost);
    await ensureWebSearchControlReady(page, reasLingoInputHost);

    const scrollFab = reasLingoInputHost.getByRole("button", { name: /Scroll to bottom/i });
    if (await scrollFab.isVisible().catch(() => false)) {
      await scrollFab.click();
    }

    const webSearchBtn = reasLingoInputHost.getByTitle("Web Search").first();
    await webSearchBtn.scrollIntoViewIfNeeded();
    await expect(webSearchBtn).toBeVisible({ timeout: 15_000 });
    await webSearchBtn.click();
    const webSearchPanel = page
      .locator('[data-slot="dropdown-menu-content"]')
      .filter({ visible: true })
      .filter({ has: page.getByText("Baidu", { exact: true }) })
      .last();
    await expect(webSearchPanel).toBeVisible({ timeout: 10_000 });
    // `WebSearchSelector`：`ProviderIcon` 的 img alt + span 文案 → a11y 名为「Baidu Baidu」，勿用 /^Baidu$/。
    const baiduItem = webSearchPanel
      .getByRole("menuitem")
      .filter({ has: page.getByText("Baidu", { exact: true }) })
      .first();
    await expect(baiduItem).toBeVisible({ timeout: 5_000 });
    await baiduItem.click();
    await expect(webSearchPanel).toBeHidden({ timeout: 5_000 });
  });

  test("5.11 AI会话设置（More Settings）", async ({ page }) => {
    test.skip(!(await tryEnterModelingProjectIde(page)), MODELING_CH5_SKIP_MSG);
    await widenViewportForReasLingoInputToolbar(page);
    await ensureReasLingoVisible(page);

    const { reasLingoInputHost } = reasLingoHosts(page);
    await ensureDefaultAgentForReasLingoInputToolbar(page, reasLingoInputHost);

    const moreSettingsBtn = reasLingoInputHost.getByTitle("More Settings").first();
    await expect(moreSettingsBtn).toBeVisible({ timeout: 10_000 });
    await moreSettingsBtn.click();
    const morePanel = page
      .locator('[data-slot="dropdown-menu-content"]')
      .filter({ visible: true })
      .filter({ has: page.getByText("More Settings", { exact: true }) })
      .first();
    await expect(morePanel).toBeVisible({ timeout: 10_000 });

    /**
     * `reaslab-iipe` `ChatCommonSettingsSelector`：`maxOutputTokens` 随 `useModelData` 就绪会从默认 8192 变为模型上限，
     * 触发 `useEffect` 将三项重置为 `DEFAULT_CHAT_COMMON_SETTINGS`（均为 enabled: false）。须先等 **Max: …** 文案出现并略作稳定。
     */
    await expect(morePanel.getByText(/Max:\s*[\d,]+/)).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(800);

    const settingRow = (label: string) =>
      morePanel.locator("div.space-y-2").filter({ has: page.getByText(label, { exact: true }) });

    const tempBlock = settingRow("Temperature");
    const maxTokensBlock = settingRow("Max output tokens");
    const topPBlock = settingRow("Top P");
    await expect(tempBlock).toHaveCount(1);
    await expect(maxTokensBlock).toHaveCount(1);
    await expect(topPBlock).toHaveCount(1);

    /** 开关打开后才挂载控件；以 **slider / spinbutton / data-slot=input** 可见为准（勿单靠 `toBeChecked`，Base UI Switch 与 React 状态可能不同步）。 */
    const ensureSettingSwitchOn = async (block: Locator, control: "slider" | "number") => {
      const sw = block.getByRole("switch");
      const controlLocator =
        control === "slider"
          ? block.getByRole("slider")
          : block.getByRole("spinbutton").or(block.locator('[data-slot="input"]')).first();
      await expect(sw).toBeVisible({ timeout: 5_000 });
      await expect
        .poll(
          async () => {
            if (await controlLocator.isVisible().catch(() => false)) {
              return true;
            }
            await sw.click();
            await page.waitForTimeout(400);
            return controlLocator.isVisible().catch(() => false);
          },
          { timeout: 20_000, intervals: [200, 400, 800, 1_600] },
        )
        .toBeTruthy();
    };

    await ensureSettingSwitchOn(tempBlock, "slider");
    await ensureSettingSwitchOn(maxTokensBlock, "number");
    await ensureSettingSwitchOn(topPBlock, "slider");

    const tempSlider = tempBlock.getByRole("slider");
    const maxInput = maxTokensBlock
      .getByRole("spinbutton")
      .or(maxTokensBlock.locator('[data-slot="input"]'))
      .first();
    const topPSlider = topPBlock.getByRole("slider");

    await tempSlider.fill("0.7");
    await expect(tempBlock.getByText("0.70", { exact: true })).toBeVisible({ timeout: 5_000 });

    await maxInput.fill("1024");
    await expect(maxInput).toHaveValue("1024");

    await topPSlider.fill("1");
    await expect(topPBlock.getByText("1.00", { exact: true })).toBeVisible({ timeout: 5_000 });

    // 配置为 `screenshot: "on"` 时，用例结束截图在 `Escape` 之后，只能得到收起后的工具条（图1）。
    // 在关闭菜单前附加「展开 More Settings」的截图，便于报告与验收对齐图2（三项开关与数值可见）。
    await test.info().attach(
      "5-11-more-settings-open.png",
      {
        body: await page.screenshot({ type: "png" }),
        contentType: "image/png",
      },
    );

    await page.keyboard.press("Escape");
    await expect(morePanel).toBeHidden({ timeout: 5_000 });
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test("5.12 Menu：更改主题为 Dark", async ({ page }) => {
    test.skip(!(await tryEnterModelingProjectIde(page)), MODELING_CH5_SKIP_MSG);

    await page.getByRole("button", { name: "Menu" }).click();
    const settingsSheet = page
      .locator('[data-slot="sheet-content"], [role="dialog"]')
      .filter({ visible: true })
      .filter({ has: page.getByText("Theme", { exact: true }) })
      .first();
    await expect(settingsSheet.getByRole("heading", { name: "Settings" })).toBeVisible({
      timeout: 15_000,
    });
    await settingsSheet.getByRole("heading", { name: "Settings" }).scrollIntoViewIfNeeded();

    await expect(settingsSheet.getByText("Theme", { exact: true })).toBeVisible({ timeout: 10_000 });
    await settingsSheet.getByText("Theme", { exact: true }).scrollIntoViewIfNeeded();

    const themeTrigger = settingsSheet.locator("#editorTheme");
    await expect(themeTrigger).toBeVisible({ timeout: 10_000 });
    await themeTrigger.click();

    // reaslab-iipe `ThemeSetting`：`IdeThemeMode` 为 light/dark，UI 文案为 Light / Dark（暗色对应 shiki `one-dark-pro`）。
    const darkOption = page
      .getByRole("option", { name: "Dark", exact: true })
      .or(page.locator('[data-slot="select-item"]').filter({ hasText: /^Dark$/ }).first());
    await expect(darkOption.first()).toBeVisible({ timeout: 10_000 });
    await darkOption.first().click();

    await expect(themeTrigger).toContainText("Dark", { timeout: 10_000 });
    await expect(page.locator("html")).toHaveAttribute("data-ide-theme-mode", "dark");

    await settingsSheet.getByRole("button", { name: "Close" }).click();
    await expect(settingsSheet).toBeHidden({ timeout: 10_000 });
  });

  test("5.13 Solver Settings：展开 Gurobi WLS License", async ({ page }) => {
    test.skip(!(await tryEnterModelingProjectIde(page)), MODELING_CH5_SKIP_MSG);

    await page.getByTitle("Solver Settings").click();
    await expect(
      page.getByRole("heading", { name: "Solver Settings", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    const solverPanel = page
      .locator('[data-sidebar="group"]')
      .filter({ has: page.getByRole("heading", { name: "Solver Settings", exact: true }) })
      .first();
    await expect(solverPanel).toBeVisible({ timeout: 5_000 });

    await solverPanel.getByRole("button", { name: /Gurobi WLS License/i }).click();
    // 与 `environment-settings-view` 一致：展开后展示三项输入与 Test/Save（无有效 license 时 Test 为 disabled，不测连通性）。
    await expect(solverPanel.locator("#wlsAccessId")).toBeVisible({ timeout: 15_000 });
    await expect(solverPanel.locator("#wlsSecret")).toBeVisible();
    await expect(solverPanel.locator("#licenseId")).toBeVisible();
    await expect(solverPanel.getByLabel("WLSACCESSID")).toBeVisible();
    await expect(solverPanel.getByRole("button", { name: "Test", exact: true })).toBeVisible();
    await expect(solverPanel.getByRole("button", { name: "Save", exact: true })).toBeVisible();

    await page.getByRole("button", { name: /Explorer/i }).first().click();
  });
});
