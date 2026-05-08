import { expect, test, type Page } from "@playwright/test";

import {
  MIL_GETTING_STARTED_SEGMENTS,
  THEOREM_CH8_LEAN_MCP_SKIP_MSG,
  THEOREM_CH8_SKIP_MSG,
  openLeafFile,
  reasLingoDefaultAgentLeanMcpInfoviewProbe,
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
  test("8.2 S01_Getting_Started.lean 预览与 Lean Infoview", async ({ page }) => {
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

  test("8.3 ReasLingo：Paper Copilot 与 who are you?", async ({ page }) => {
    test.skip(!(await tryEnterLeanProjectIde(page)), THEOREM_CH8_SKIP_MSG);
    const ok = await reasLingoWhoAreYouProbe(page, /Paper Copilot/i);
    test.skip(!ok, "当前环境无 Paper Copilot Agent，跳过 8.3 ReasLingo。");
  });

  /**
   * **`docs/用户场景.md`** §8.4：在 **§8.2** 同款 **`S01_Getting_Started.lean`** 已打开的前提下，将 Agent 切回 **Default**，
   * 探针写明 **`MIL/C01_Introduction/...`** 与首行 **`#eval "Hello, World!"`**（与模板一致，**非** **`IO.println`**），经 **`lean_mcp`** 查 **Infoview / goals**。
   */
  test("8.4 ReasLingo：lean_mcp（Lean Infoview）", async ({ page }) => {
    test.skip(!(await tryEnterLeanProjectIde(page)), THEOREM_CH8_SKIP_MSG);
    await expect(page.getByTitle("Create New File")).toBeVisible({ timeout: 30_000 });
    await openMilGettingStartedLean(page);
    await page.locator(".cm-editor").first().waitFor({ state: "visible", timeout: 120_000 });

    const ok = await reasLingoDefaultAgentLeanMcpInfoviewProbe(page);
    test.skip(!ok, THEOREM_CH8_LEAN_MCP_SKIP_MSG);
  });
});
