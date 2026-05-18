import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { E2E_SHARE_INVITE_EMAIL } from "../common/global-setup";
import { clearModelingProjectUuidArtifact } from "./data/e2e-modeling-project-artifact";
import {
  MODELING_CH5_SKIP_MSG,
  ensureReasLingoVisible,
  expandIdeFileTreeRowByLabel,
  reaslingoUploadFileForAiChat,
  tryEnterModelingProjectIde,
  waitForFileTree,
  waitForReasLingoAssistantReplyDone,
} from "./helpers";

const TEST_UPLOAD_PNG = path.join(path.dirname(fileURLToPath(import.meta.url)), "data", "test_upload.png");

/** §5.13：无服务端已存 Gurobi WLS 且未注入三项环境变量时，前端禁用 Test，用例跳过。 */
const MODELING_CH5_13_GUROBI_SKIP_MSG =
  "§5.13：Gurobi WLS 三项未填（项目无已存凭据）且未设置 E2E_GUROBI_WLS_ACCESS_ID / E2E_GUROBI_WLS_SECRET / E2E_GUROBI_LICENSE_ID，Test 不可用；跳过。";

/** 与 `@reaslab/file-tree` 节点 `data-name` 一致；避免树上另有 `/test_upload.png` 时 `getByText` 触发 strict 双匹配。 */
function chatUploadsTestPngTreeLabel(fileTree: Locator) {
  return fileTree.locator(`span[data-name="/chat-uploads/test_upload.png"]`);
}

/** §5.3 / §5.4：用**全英文**提问（避免非英文与 OCR 组合下乱码 / OCR Failed）；要求只输出数字答案（与 `test_upload.png` 图中「二加二」→ 4 一致）。 */
const CH5_FIXTURE_QUESTION_PROMPT =
  "Answer the question shown in the image. Reply with exactly one Arabic numeral and nothing else.";

function reasLingoHosts(page: Page) {
  // 与输入区强绑定：勿依赖 `title="Switch Agent"`（线上多为「Agent」按钮，无该 title）。
  const reasLingoInputHost = page
    .locator('[data-sidebar="group"]')
    .filter({ has: page.getByText("ReasLingo", { exact: true }) })
    .filter({ has: page.getByTitle("Add Context") })
    .first();
  return { reasLingoInputHost };
}

/** `FileReferences` 中单个附件芯片（含 OCR Processing / OCR Failed 标签）。 */
function reasLingoFileReferenceChip(reasLingoInputHost: Locator, fileName: string) {
  return reasLingoInputHost.locator("button").filter({ has: reasLingoInputHost.getByText(fileName) });
}

/** 本轮最后一条助理消息气泡（`MessageList` 内带 AI Bot 头像的块）。 */
function reasLingoLastAssistantMessage(reasLingoInputHost: Locator) {
  return reasLingoInputHost
    .locator("button")
    .filter({ has: reasLingoInputHost.locator('img[alt="AI Bot"]') })
    .last();
}

/** §5.9～5.11：侧栏 ReasLingo 工具条在默认 1280×720 下易被裁切；仅这三条加宽视口（不设嵌套 describe，以免报告标题多一层）。 */
async function widenViewportForReasLingoInputToolbar(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1680, height: 900 });
}

/** §5.9～§5.11：`MessageInput` 仅在 **default** Agent 时渲染 Chain of Thought / Web Search / More Settings；§5.4 后须切回默认。 */
async function ensureDefaultAgentForReasLingoInputToolbar(
  page: Page,
  reasLingoInputHost: Locator,
): Promise<void> {
  const defaultAgentTrigger = reasLingoInputHost.getByRole("button", { name: /^Agent$/i });
  if (await defaultAgentTrigger.isVisible().catch(() => false)) {
    return;
  }
  const nonDefaultAgentTrigger = reasLingoInputHost
    .getByRole("button", { name: /ReasLab Agent/i })
    .or(reasLingoInputHost.locator('button[title="Switch Agent"]'));
  await expect(nonDefaultAgentTrigger.first()).toBeVisible({ timeout: 15_000 });
  await nonDefaultAgentTrigger.first().click();
  const agentMenuPanel = page.locator('[data-slot="dropdown-menu-content"][class*="w-56"]');
  await expect(agentMenuPanel).toBeVisible({ timeout: 10_000 });
  const reasLabRow = agentMenuPanel.locator('[data-slot="dropdown-menu-item"]').filter({
    hasText: /ReasLab Agent/i,
  });
  await expect(reasLabRow.first()).toBeVisible({ timeout: 10_000 });
  await reasLabRow.first().click();
  await expect(agentMenuPanel).toBeHidden({ timeout: 5_000 });
  await expect(reasLingoInputHost.getByRole("button", { name: /^Agent$/i })).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * §5.9：§5.3 常把模型切到 **Auto**；reaslab-iipe `ChainOfThoughtSelector` 仅在解析模型 `supportsReasoning === true` 时渲染。
 * 先关闭 Auto（与 `ModelSelector` 内开关一致）；若仍无按钮，再依次点选启用列表中的各模型行（跳过第 0 行「Auto」）。
 */
async function ensureChainOfThoughtControlVisible(page: Page, reasLingoInputHost: Locator): Promise<void> {
  const modelBtn = reasLingoInputHost.getByTitle("Switch Model");
  const cot = () => reasLingoInputHost.getByTitle("Chain of Thought");

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
    return;
  }

  const panelCount = await openModelMenu();
  const menuRows = panelCount.locator('[data-slot="dropdown-menu-item"]');
  const n = await menuRows.count();
  await page.keyboard.press("Escape");
  await expect(panelCount).toBeHidden({ timeout: 5_000 });

  if (n <= 1) {
    throw new Error(
      "§5.9：模型菜单除 Auto 外无其它启用模型，无法展示 Chain of Thought（请在环境启用至少一枚 supportsReasoning 的模型）。",
    );
  }

  for (let idx = 1; idx < n; idx++) {
    const panel = await openModelMenu();
    const rows = panel.locator('[data-slot="dropdown-menu-item"]');
    await rows.nth(idx).click();
    await expect(panel).toBeHidden({ timeout: 5_000 });
    if ((await cot().count()) > 0) {
      await expect(cot().first()).toBeVisible({ timeout: 20_000 });
      return;
    }
  }

  throw new Error(
    "§5.9：已关闭 Auto 并遍历启用模型，仍无 Chain of Thought（当前列表可能均无 supportsReasoning）。",
  );
}

/** 通过 Add Context 选中工程内 `chat-uploads/test_upload.png`（不再走 Explore `setInputFiles`，与 §5.2 单次上传一致）。 */
async function attachTestUploadPngViaAddContext(page: Page, reasLingoInputHost: Locator): Promise<void> {
  await ensureReasLingoVisible(page);
  const addContext = reasLingoInputHost.getByTitle("Add Context").first();
  await expect(addContext).toBeVisible({ timeout: 20_000 });
  await addContext.scrollIntoViewIfNeeded();
  await addContext.click();
  const ctxSearch = page.getByPlaceholder("Add files, folders, docs...");
  await expect(ctxSearch).toBeVisible({ timeout: 10_000 });
  // 搜 `test_upload` 会同时命中 `test_upload.md` / `test_upload.png`；勿用 ArrowDown+Enter（首项常为 .md）——必须点选 **.png**。
  await ctxSearch.fill("test_upload");
  const addCtxPopper = page
    .locator("[data-radix-popper-content-wrapper]")
    .filter({ visible: true })
    .filter({ has: page.getByPlaceholder("Add files, folders, docs...") })
    .last();
  const resultInPopper = addCtxPopper.getByText("test_upload.png", { exact: true }).first();
  const listboxRow = page
    .getByRole("listbox")
    .filter({ visible: true })
    .filter({ hasNot: page.locator(".ide-filetree") })
    .first()
    .getByText("test_upload.png", { exact: true })
    .first();
  const looseResultRow = page
    .locator("div")
    .filter({ visible: true })
    .filter({ has: ctxSearch })
    .filter({ has: page.getByText("test_upload.png", { exact: true }) })
    .getByText("test_upload.png", { exact: true })
    .first();
  const pngHit = resultInPopper.or(listboxRow).or(looseResultRow).first();
  await expect(pngHit).toBeVisible({ timeout: 30_000 });
  await pngHit.click();
  await ctxSearch.waitFor({ state: "detached", timeout: 15_000 }).catch(() =>
    ctxSearch.waitFor({ state: "hidden", timeout: 15_000 }),
  );
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

    // §5.2 已 Explore 上传一次；此处不再 `setInputFiles`，仅用 Add Context 引用工程内文件，避免重复上传。
    await waitForFileTree(page);
    const fileTreePanel = page.locator(".ide-filetree").filter({ visible: true }).first();
    await expandIdeFileTreeRowByLabel(page, /chat-uploads/i);
    await expect(chatUploadsTestPngTreeLabel(fileTreePanel)).toBeVisible({
      timeout: 180_000,
    });
    await attachTestUploadPngViaAddContext(page, reasLingoInputHost);

    const pngChip = reasLingoFileReferenceChip(reasLingoInputHost, "test_upload.png");
    await expect(pngChip.getByText("OCR Processing", { exact: true })).toBeHidden({
      timeout: 120_000,
    });

    const modelBtn = reasLingoInputHost.getByTitle("Switch Model");
    await modelBtn.click();
    const modelPanel = page.getByRole("menu").filter({ has: page.getByRole("switch") }).first();
    await expect(modelPanel).toBeVisible({ timeout: 10_000 });
    const autoSwitch = modelPanel.getByRole("switch");
    if (!(await autoSwitch.isChecked())) {
      await autoSwitch.click();
    }
    await page.keyboard.press("Escape");

    const ta = reasLingoInputHost.locator("textarea").first();
    await expect(ta).toBeVisible({ timeout: 15_000 });
    await ta.click();
    await ta.fill(CH5_FIXTURE_QUESTION_PROMPT);
    const sendBtn = reasLingoInputHost.getByTitle("Send Message").first();
    await expect(sendBtn).toBeEnabled({ timeout: 180_000 });
    await sendBtn.click();
    await expect(async () => {
      await expect(page).toHaveURL(/\/projects\/[^/]+/i);
      await expect(reasLingoInputHost.getByText(CH5_FIXTURE_QUESTION_PROMPT).first()).toBeVisible();
    }).toPass({ timeout: 30_000 });
    await waitForReasLingoAssistantReplyDone(page);

    // 成功标准：助理就图中问题给出数字 4（可用 OCR 文本或 Agent `read_file` 读图，见快照）。
    // 勿在整侧栏搜「OCR Failed」：芯片失败时仍可能通过 read_file 答对，会误报。
    const lastAssistant = reasLingoLastAssistantMessage(reasLingoInputHost);
    await expect(lastAssistant.getByText(/^4$/)).toBeVisible({ timeout: 120_000 });
  });

  test("5.4 切换 ReasLab Agent 进行 AI 会话", async ({ page }) => {
    test.skip(!(await tryEnterModelingProjectIde(page)), MODELING_CH5_SKIP_MSG);
    await ensureReasLingoVisible(page);

    const { reasLingoInputHost } = reasLingoHosts(page);

    const agentTrigger = reasLingoInputHost
      .getByRole("button", { name: /^Agent$/i })
      .or(reasLingoInputHost.locator('button[title="Switch Agent"]'));
    await expect(agentTrigger.first()).toBeVisible({ timeout: 15_000 });
    await agentTrigger.first().click();
    const agentMenuPanel = page.locator('[data-slot="dropdown-menu-content"][class*="w-56"]');
    await expect(agentMenuPanel).toBeVisible({ timeout: 10_000 });
    const reasLabAgent = agentMenuPanel.locator('[data-slot="dropdown-menu-item"]').filter({
      hasText: /ReasLab Agent/i,
    });
    await expect(
      reasLabAgent.first(),
      [
        "§5.4：Agent 菜单中未找到「ReasLab Agent」项（须在正式环境提供）。",
        "若为菜单结构或展示名变更，请同步更新本用例的 locator / 文案匹配。",
      ].join(" "),
    ).toBeVisible({ timeout: 15_000 });
    await reasLabAgent.first().click();
    await expect(agentMenuPanel).toBeHidden({ timeout: 5_000 });
    await page.waitForTimeout(2_000);

    // 图片/OCR 在 §5.3 已覆盖；此处仅验证 ReasLab Agent 下纯文本对话与流式结束。
    const ta = reasLingoInputHost.locator("textarea").first();
    await expect(ta).toBeVisible({ timeout: 15_000 });
    await ta.click();
    await ta.fill("who are you?");
    const sendBtn = reasLingoInputHost.getByTitle("Send Message").first();
    await expect(sendBtn).toBeEnabled({ timeout: 180_000 });
    await sendBtn.click();
    await expect(async () => {
      await expect(page).toHaveURL(/\/projects\/[^/]+/i);
      await expect(reasLingoInputHost.getByText(/^who are you\?$/i).first()).toBeVisible();
    }).toPass({ timeout: 30_000 });
    await waitForReasLingoAssistantReplyDone(page);
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
    await page.getByRole("button", { name: "History", exact: true }).click();
    await expect(page).toHaveURL(/\/projects\/[^/]+\/history/i, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Project History" })).toBeVisible();
    await expect(page.getByText("Changed Files").first()).toBeVisible();
    await expect(page.getByText("Diff").first()).toBeVisible();
    await expect(page.getByText("Snapshots").first()).toBeVisible();
  });

  test("5.7 项目内搜索关键字", async ({ page }) => {
    test.skip(!(await tryEnterModelingProjectIde(page)), MODELING_CH5_SKIP_MSG);
    await page.getByRole("button", { name: "Project Search" }).click();
    const searchInput = page.getByPlaceholder("Enter to search");
    await expect(searchInput).toBeVisible({ timeout: 15_000 });
    const projectSearchContent = page
      .locator('[data-sidebar="group"]')
      .filter({ has: searchInput })
      .locator("[data-sidebar='group-content']");
    await expect(projectSearchContent).toBeVisible({ timeout: 5_000 });
    await searchInput.fill("e");
    await searchInput.press("Enter");
    await expect(
      projectSearchContent.getByText(/[1-9]\d* results? in \d+ files?/i),
    ).toBeVisible({ timeout: 20_000 });

    const noHitToken = `CH5_NOHIT_${Date.now()}_zzzz`;
    await searchInput.fill(noHitToken);
    await searchInput.press("Enter");
    await expect
      .poll(
        async () => {
          const searching = await projectSearchContent.getByText("Searching...").isVisible();
          if (searching) {
            return "searching";
          }
          const hitSummary = await projectSearchContent.getByText(/[1-9]\d* results? in \d+ files?/i).count();
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
    await ensureChainOfThoughtControlVisible(page, reasLingoInputHost);

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
    await reasLingoInputHost.scrollIntoViewIfNeeded();

    const webSearchBtn = reasLingoInputHost.getByTitle("Web Search").first();
    await webSearchBtn.scrollIntoViewIfNeeded();
    await expect(webSearchBtn).toBeVisible({ timeout: 15_000 });
    await webSearchBtn.click();
    const webSearchPanel = page
      .locator('[data-slot="dropdown-menu-content"]')
      .filter({ visible: true })
      .filter({ has: page.getByText("Baidu", { exact: true }) })
      .first();
    await expect(webSearchPanel).toBeVisible({ timeout: 10_000 });
    await webSearchPanel.getByRole("menuitem").first().click();
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

    const settingRows = morePanel.locator("div.space-y-3 > div.space-y-2");
    await expect(settingRows).toHaveCount(3);

    const tempBlock = settingRows.nth(0);
    const maxTokensBlock = settingRows.nth(1);
    const topPBlock = settingRows.nth(2);
    await expect(tempBlock.getByText("Temperature", { exact: true })).toBeVisible();
    await expect(maxTokensBlock.getByText("Max output tokens", { exact: true })).toBeVisible();
    await expect(topPBlock.getByText("Top P", { exact: true })).toBeVisible();

    for (const block of [tempBlock, maxTokensBlock, topPBlock]) {
      const sw = block.getByRole("switch");
      if (!(await sw.isChecked())) {
        await sw.click();
      }
      await expect(sw).toBeChecked();
    }

    await expect(tempBlock.locator('input[type="range"]')).toBeVisible({ timeout: 5_000 });
    // Switch 内含 `input[type="checkbox"]`（aria-hidden），勿用 `input` 的 first。
    const maxInput = maxTokensBlock.locator('input[type="number"]');
    await expect(maxInput).toBeVisible({ timeout: 5_000 });
    await expect(topPBlock.locator('input[type="range"]')).toBeVisible({ timeout: 5_000 });

    await tempBlock.locator('input[type="range"]').fill("0.7");
    await expect(tempBlock.getByText("0.70", { exact: true })).toBeVisible({ timeout: 5_000 });

    await maxInput.fill("1024");
    await expect(maxInput).toHaveValue("1024");

    await topPBlock.locator('input[type="range"]').fill("1");
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

  test("5.12 Menu：更改主题为 One Dark", async ({ page }) => {
    test.skip(!(await tryEnterModelingProjectIde(page)), MODELING_CH5_SKIP_MSG);

    await page.getByRole("button", { name: "Menu" }).click();
    const settingsSheet = page
      .locator('[data-slot="sheet-content"]')
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

    const oneDarkOption = page
      .getByRole("option", { name: "One Dark", exact: true })
      .or(page.locator('[data-slot="select-item"]').filter({ hasText: /^One Dark$/ }).first());
    await expect(oneDarkOption.first()).toBeVisible({ timeout: 10_000 });
    await oneDarkOption.first().click();

    await expect(themeTrigger).toContainText("One Dark", { timeout: 10_000 });

    await settingsSheet.getByRole("button", { name: "Close" }).click();
    await expect(settingsSheet).toBeHidden({ timeout: 10_000 });
  });

  test("5.13 Solver Settings：Gurobi WLS License 点 Test 成功", async ({ page }) => {
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
    const accessInput = solverPanel.locator("#wlsAccessId");
    await expect(accessInput).toBeVisible({ timeout: 15_000 });

    const wlsAccess = process.env.E2E_GUROBI_WLS_ACCESS_ID?.trim();
    const wlsSecret = process.env.E2E_GUROBI_WLS_SECRET?.trim();
    const licenseId = process.env.E2E_GUROBI_LICENSE_ID?.trim();
    if (wlsAccess && wlsSecret && licenseId) {
      await accessInput.fill(wlsAccess);
      await solverPanel.locator("#wlsSecret").fill(wlsSecret);
      await solverPanel.locator("#licenseId").fill(licenseId);
    }

    const testBtn = solverPanel.getByRole("button", { name: "Test", exact: true });
    await expect(testBtn).toBeVisible({ timeout: 10_000 });
    if (await testBtn.isDisabled()) {
      test.skip(true, MODELING_CH5_13_GUROBI_SKIP_MSG);
    }

    await testBtn.click();
    const successMsg = solverPanel.getByText("Test successfully", { exact: true });
    await expect(successMsg).toBeVisible({
      timeout: 120_000,
    });
    await successMsg.scrollIntoViewIfNeeded();
    // `screenshot: "on"` 时默认可在切回 Explorer 之后截屏，看不到成功文案；在离开 Solver 前附加「Test 成功」侧栏图。
    await test.info().attach("5-13-gurobi-wls-test-success.png", {
      body: await solverPanel.screenshot({ type: "png" }),
      contentType: "image/png",
    });

    await page.getByRole("button", { name: /Explorer/i }).first().click();
  });
});
