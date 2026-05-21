/**
 * **`docs/用户场景.md`** §7：**7.1～7.7** E2E（含 **§7.7** **`ReasLingo` → Settings** 与 **`reasLingoIdeSettingsAiFlow`**）。
 */
import { expect, test } from "@playwright/test";

import {
  MODELING_CH7_HISTORY_TWO_SESSIONS_SKIP_MSG,
  MODELING_CH7_SETTINGS_SILICONFLOW_SKIP_MSG,
  MODELING_PYTHON_CONSOLE_GUROBI_SKIP_MSG,
  MODELING_CH7_SKIP_MSG,
  clickEditorToolbarRunPython,
  ensureIdeBottomPanelOpenForConsole,
  openFirstPythonFileRowInFileTree,
  openLeafFile,
  readFirstPythonDataNameFromIdeFileTree,
  ensureReasLingoVisible,
  reasLingoDefaultAgentMcpPythonProbe,
  reasLingoIdeSettingsAiFlow,
  reasLingoSelectBottomHistorySessionAndAssertRecallWhoAreYou,
  reasLingoWhoAreYouProbe,
  tryEnterOptimizationTemplateModelingIde,
  visibleCmContentInActiveEditor,
  waitForPythonConsoleSettledAndAssertGreenOrGurobiSkip,
} from "./helpers";

test.describe("7. 模板创建优化建模项目", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(600_000);

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

  test("7.1 从优化建模模板创建项目并进入建模 IDE", async ({ page }) => {
    test.skip(!(await tryEnterOptimizationTemplateModelingIde(page)), MODELING_CH7_SKIP_MSG);
    await expect(page).toHaveURL(/\/projects\/[^/]+\/?$/i);
    await expect(page.getByTitle("Create New File")).toBeVisible({ timeout: 30_000 });
    await expect(
      page.locator(".bg-sidebar button").filter({ has: page.locator("svg.lucide-sliders-horizontal") }),
    ).toBeVisible({ timeout: 30_000 });
  });

  /**
   * `docs/用户场景.md` 7.2：进入项目后打开 **项目根目录 README.md**（场景文稿中的路径指此文件），
   * 在编辑器工具栏点击 **Markdown 预览**（眼睛图标，`editor-toolbar` 中 `Toggle Markdown Preview`），
   * 右侧/分栏出现 `MarkdownGroup` 的 `.ide-markdown-surface` 即视为成功。
   */
  test("7.2 打开 README.md 并显示 Markdown 预览", async ({ page }) => {
    test.skip(!(await tryEnterOptimizationTemplateModelingIde(page)), MODELING_CH7_SKIP_MSG);

    await expect(page.getByTitle("Create New File")).toBeVisible({ timeout: 30_000 });

    try {
      await openLeafFile(page, ["README.md"]);
    } catch {
      const tree = page.locator(".ide-filetree").filter({ visible: true }).first();
      await expect(tree).toBeVisible({ timeout: 45_000 });
      await tree.getByText(/readme\.md/i).first().click({ timeout: 15_000 });
    }

    await page.locator(".cm-editor").first().waitFor({ state: "visible", timeout: 60_000 });

    const markdownPreviewToggle = page
      .locator("div.flex.h-8.justify-end.gap-2.border-b")
      .locator("button")
      .filter({ has: page.locator("svg.lucide-eye") })
      .first();
    await expect(markdownPreviewToggle).toBeVisible({ timeout: 20_000 });
    await markdownPreviewToggle.click();

    const previewSurface = page.locator(".ide-markdown-surface").filter({ visible: true }).first();
    await expect(previewSurface).toBeVisible({ timeout: 45_000 });
    await expect
      .poll(
        async () => (await previewSurface.locator(".prose-markdown").first().innerText()).trim().length,
        { timeout: 60_000 },
      )
      .toBeGreaterThan(5);
  });

  test("7.3 切换Optimization Agent并提问", async ({ page }) => {
    test.skip(!(await tryEnterOptimizationTemplateModelingIde(page)), MODELING_CH7_SKIP_MSG);
    await ensureReasLingoVisible(page);
    const ok = await reasLingoWhoAreYouProbe(page, /Optimization Agent/i);
    test.skip(!ok, "当前环境无 Optimization Agent，跳过 7.3 切换Optimization Agent并提问。");
  });

  /**
   * **`docs/用户场景.md`** §7.4：在已通过 **§7.1** 进入的优化建模模板项目中，打开主 **`.py`** → **Console** → **Run Python** → 断言 **Console** 绿区（步骤见 **`helpers.ts`**）。
   */
  test("7.4 模板内 Python、Console 与 Run Python 验收", async ({ page }) => {
    test.skip(!(await tryEnterOptimizationTemplateModelingIde(page)), MODELING_CH7_SKIP_MSG);
    await expect(page.getByTitle("Create New File")).toBeVisible({ timeout: 30_000 });

    await test.step("Explore：打开第一个 .py", async () => {
      await openFirstPythonFileRowInFileTree(page);
      const cm = visibleCmContentInActiveEditor(page);
      await expect(cm).toBeVisible({ timeout: 60_000 });
      await expect(cm).toContainText(/\b(def|import|class)\b/, { timeout: 30_000 });
    });

    await test.step("Console → Run Python", async () => {
      await ensureIdeBottomPanelOpenForConsole(page);
      await page.getByRole("tab", { name: "Console", exact: true }).click();
      await clickEditorToolbarRunPython(page);
    });

    await test.step("Console 验收", async () => {
      const outcome = await waitForPythonConsoleSettledAndAssertGreenOrGurobiSkip(page);
      if (outcome === "gurobi_license_skip") {
        test.skip(true, MODELING_PYTHON_CONSOLE_GUROBI_SKIP_MSG);
      }
    });
  });

  /**
   * **`docs/用户场景.md`** §7.5：与 **§7.4** 同一主脚本；**默认 Agent** 下 **第二次**全量执行：**`python_mcp`**
   *（**第一次**为 **§7.4** **Run Python**；`describe` 串行）。
   */
  test("7.5 调用python_mcp", async ({ page }) => {
    test.skip(!(await tryEnterOptimizationTemplateModelingIde(page)), MODELING_CH7_SKIP_MSG);
    await expect(page.getByTitle("Create New File")).toBeVisible({ timeout: 30_000 });
    const pyDataName = await readFirstPythonDataNameFromIdeFileTree(page);
    await reasLingoDefaultAgentMcpPythonProbe(page, pyDataName);
  });

  /**
   * **`docs/用户场景.md`** §7.6（步骤与 **`reasLingoSelectBottomHistorySessionAndAssertRecallWhoAreYou`** 一致）：
   * 1. **Chat History**：`title="Chat History"` → 等待非 **Loading chat history…**
   * 2. 列表滚到底 → 点 **最后一条**会话（`≥2` 条；否则 **`test.skip`**）
   * 3. 发送 **`what question did I asked?`** → `waitForReasLingoAssistantReplyDone`
   * 4. 侧栏正文含 **`who are you`**（与 §7.3 切换Optimization Agent并提问 对齐）
   *
   * 依赖同文件串行 **7.3（切换Optimization Agent并提问）+ 7.5 调用python_mcp** 产生多条会话。
   */
  test("7.6 切换 AI 历史会话", async ({ page }) => {
    test.skip(!(await tryEnterOptimizationTemplateModelingIde(page)), MODELING_CH7_SKIP_MSG);
    await expect(page.getByTitle("Create New File")).toBeVisible({ timeout: 30_000 });
    const ok = await reasLingoSelectBottomHistorySessionAndAssertRecallWhoAreYou(page);
    test.skip(!ok, MODELING_CH7_HISTORY_TWO_SESSIONS_SKIP_MSG);
  });

  /**
   * **`docs/用户场景.md`** §7.7：侧栏 **Settings** → **ReasLingo Settings** 虚拟 Tab → **Models** / **User Rules** / **Tools & MCP**；
   * 与 **`reasLingoIdeSettingsAiFlow`**（**`helpers.ts`**）步骤一致。
   */
  test("7.7 设置 AI（齿轮：模型、用户规则、Tools & MCP）", async ({ page }) => {
    test.skip(!(await tryEnterOptimizationTemplateModelingIde(page)), MODELING_CH7_SKIP_MSG);
    await expect(page.getByTitle("Create New File")).toBeVisible({ timeout: 30_000 });
    const ok = await reasLingoIdeSettingsAiFlow(page);
    test.skip(!ok, MODELING_CH7_SETTINGS_SILICONFLOW_SKIP_MSG);
  });
});
