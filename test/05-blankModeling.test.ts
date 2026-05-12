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

    await expect(reasLingoInputHost.getByText("OCR Processing", { exact: true })).toBeHidden({
      timeout: 120_000,
    });
    const ocrUnavailable = await reasLingoInputHost
      .getByText("OCR Failed", { exact: true })
      .isVisible()
      .catch(() => false);

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
    const ocrStillBad = await reasLingoInputHost
      .getByText("OCR Failed", { exact: true })
      .isVisible()
      .catch(() => false);
    expect(
      !(ocrUnavailable || ocrStillBad),
      [
        "§5.3 ReasLingo 图片上下文：界面出现「OCR Failed」或上传后已判定 OCR 不可用。",
        "本条要求成功识别 test_upload.png 并回答图中数字，不得跳过或当作通过。",
        "请检查 OCR 服务、集群配置或该图片的可识别性。",
      ].join(" "),
    ).toBe(true);
    await expect(reasLingoInputHost.getByText(/\b4\b/).last()).toBeVisible({ timeout: 120_000 });
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
});
