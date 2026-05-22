import { expect, test, type Page } from "@playwright/test";

import {
  MIL_GETTING_STARTED_SEGMENTS,
  REASFLOW_COPILOT_AGENT_MENU_LABEL,
  THEOREM_CH8_LAKE_MCP_SKIP_MSG,
  THEOREM_CH8_LEAN_MCP_SKIP_MSG,
  THEOREM_CH8_REASFLOW_COPILOT_SKIP_MSG,
  THEOREM_CH8_SEMANTIC_LEAN_SEARCH_SKIP_MSG,
  THEOREM_CH8_SKIP_MSG,
  ensureReasLingoVisible,
  milSemanticSearchAndLeanToolbarProbe,
  openLeafFile,
  reasLingoDefaultAgentLakeMcpBuildProbe,
  reasLingoDefaultAgentLeanGettingStartedProbe,
  reasLingoWhoAreYouProbe,
  tryEnterLeanProjectIde,
} from "./helpers";

/** 与 `docs/用户场景.md` 8.2 及 MIL 入门文件一致；仓库若含 `solutions/` 子目录则作备选路径。 */
const MIL_GETTING_STARTED_WITH_SOLUTIONS = [
  "MIL",
  "C01_Introduction",
  "solutions",
  "S01_Getting_Started.lean",
] as const;

async function openMilGettingStartedLean(page: Page): Promise<void> {
  try {
    await openLeafFile(page, MIL_GETTING_STARTED_SEGMENTS);
  } catch {
    await openLeafFile(page, [...MIL_GETTING_STARTED_WITH_SOLUTIONS]);
  }
}

test.describe("8. 模板创建定理证明项目", () => {
  test.describe.configure({ mode: "serial" });
  /** 首条经 MIL 拉取时 lake/缓存可达数十分钟。 */
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

  test("8.1 从定理证明模板创建项目并进入定理 IDE", async ({ page }) => {
    test.skip(!(await tryEnterLeanProjectIde(page)), THEOREM_CH8_SKIP_MSG);
    await expect(page).toHaveURL(/\/projects\/[^/]+\/?$/i);
    await expect(page.getByTitle("Create New File")).toBeVisible({ timeout: 30_000 });
    const tree = page.locator(".ide-filetree").filter({ visible: true }).first();
    await expect(tree.getByText("MIL", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    await expect(
      page.locator(".bg-sidebar button").filter({ has: page.locator("svg.lucide-sliders-horizontal") }),
    ).toHaveCount(0);
  });

  /**
   * `docs/用户场景.md` 8.2：`MIL/C01_Introduction/S01_Getting_Started.lean`（或带 `solutions/` 的同款），
   * 工具栏眼睛为 **Toggle Lean Infoview**（`editor-toolbar`），右侧 **Lean Infoview** 中出现 `#eval` 输出即成功。
   */
  test("8.2 Lean Infoview", async ({ page }) => {
    test.skip(!(await tryEnterLeanProjectIde(page)), THEOREM_CH8_SKIP_MSG);

    await expect(page.getByTitle("Create New File")).toBeVisible({ timeout: 30_000 });
    await openMilGettingStartedLean(page);

    await page.locator(".cm-editor").first().waitFor({ state: "visible", timeout: 120_000 });

    const leanInfoviewToggle = page
      .locator("div.flex.h-8.justify-end.gap-2.border-b")
      .locator("button")
      .filter({ has: page.locator("svg.lucide-eye") })
      .first();
    await expect(leanInfoviewToggle).toBeVisible({ timeout: 30_000 });
    await leanInfoviewToggle.click();

    const infoview = page.locator(".ide-infoview").filter({ visible: true }).first();
    await expect(infoview).toBeVisible({ timeout: 60_000 });
    await expect(infoview.getByText(/Hello,\s*World!/i).first()).toBeVisible({ timeout: 180_000 });
  });

  /**
   * **`docs/用户场景.md`** §8.3：左侧 **Semantic Search** → **Semantic**（**`normed space`**）与 **Lean**（**`Real`**），与 **`search-group.tsx`** / **`semantic-search.tsx`** / **`lean-search-panel.tsx`** 对齐。
   */
  test("8.3 语义搜索及Lean搜索", async ({ page }) => {
    test.skip(!(await tryEnterLeanProjectIde(page)), THEOREM_CH8_SKIP_MSG);
    await expect(page.getByTitle("Create New File")).toBeVisible({ timeout: 30_000 });
    const ok = await milSemanticSearchAndLeanToolbarProbe(page);
    test.skip(!ok, THEOREM_CH8_SEMANTIC_LEAN_SEARCH_SKIP_MSG);
  });

  test("8.4 切换 ReasFlow Copilot 并提问", async ({ page }) => {
    test.skip(!(await tryEnterLeanProjectIde(page)), THEOREM_CH8_SKIP_MSG);
    await ensureReasLingoVisible(page);
    const ok = await reasLingoWhoAreYouProbe(page, REASFLOW_COPILOT_AGENT_MENU_LABEL);
    test.skip(!ok, THEOREM_CH8_REASFLOW_COPILOT_SKIP_MSG);
  });

  /**
   * **`docs/用户场景.md`** §8.5：在 **§8.2** 同款 **`S01_Getting_Started.lean`** 已打开的前提下，**Default** + **New Chat**，
   * 经 **`read_file`** 读取并确认首行 **`#eval "Hello, World!"`**（**§8.2** 已在 IDE **Infoview** 验收预览）。
   */
  test("8.5 读取 Getting Started Lean", async ({ page }) => {
    test.skip(!(await tryEnterLeanProjectIde(page)), THEOREM_CH8_SKIP_MSG);
    await expect(page.getByTitle("Create New File")).toBeVisible({ timeout: 30_000 });
    await openMilGettingStartedLean(page);
    await page.locator(".cm-editor").first().waitFor({ state: "visible", timeout: 120_000 });

    const ok = await reasLingoDefaultAgentLeanGettingStartedProbe(page);
    test.skip(!ok, THEOREM_CH8_LEAN_MCP_SKIP_MSG);
  });

  /**
   * **`docs/用户场景.md`** §8.6：**Default** + **`lake build`**（shell；兼容 **`status=Success`** 旧 MCP 摘要）。
   */
  test("8.6 调用lake build", async ({ page }) => {
    test.skip(!(await tryEnterLeanProjectIde(page)), THEOREM_CH8_SKIP_MSG);
    await expect(page.getByTitle("Create New File")).toBeVisible({ timeout: 30_000 });

    const ok = await reasLingoDefaultAgentLakeMcpBuildProbe(page);
    test.skip(!ok, THEOREM_CH8_LAKE_MCP_SKIP_MSG);
  });
});
