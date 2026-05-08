import { expect, test } from "@playwright/test";

import { absUrl } from "../common/global-setup";

/** 与前端 `playground` 路由中 `LOCAL_STORAGE_KEY` 一致（iipe / uni）。 */
const PLAYGROUND_LS_KEY = "reaslab-playground";
/** Jotai `viewStateAtomFamily("playground-cacheState")` 的 localStorage 键；仅清草稿不清此项会导致选区超出短文档而崩溃。 */
const PLAYGROUND_VIEW_STATE_KEY = "playground-cacheState";

/**
 * **用户场景 §1**：免登录在线体验 Playground（见 `docs/用户场景.md`）。
 * 覆盖：首页顶栏进入 Playground、**Examples** 第一项、**Lean** 编码区展示示例代码、**Infoview** 展示与光标位置对应的内容。
 * 说明：前端在 Lean WebSocket 未就绪时右侧 **Infoview 会渲染为空白**（`PlaygroundInfoview` 返回 `null`），此时 **不会出现** 带 `InfoviewFc` 的外层 `div.relative…bg-sidebar.p-4`。本用例对该容器做**硬性断言**；Infoview 就绪后会出现 **Loading messages / No info found** 等中间态，**不得以**其与最终 `#eval` 输出做「或」短路通过，须等到 **`#eval double 21` → `42`** 稳定出现。
 *
 * 有界面调试：Playwright 使用 **`--headed`**（无 `--head`）。例如：
 * `pnpm run test:01:headed`，或
 * `npx playwright test --config common/playwright.config.ts test/01-playground.test.ts --headed`。
 */
test.describe("1. 免登录在线体验 Playground", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.setTimeout(180_000);

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(
      (keys: { doc: string; view: string }) => {
        try {
          globalThis.localStorage.removeItem(keys.doc);
          globalThis.localStorage.removeItem(keys.view);
          globalThis.sessionStorage.removeItem("playground-session-id");
        } catch {
          /* ignore */
        }
      },
      { doc: PLAYGROUND_LS_KEY, view: PLAYGROUND_VIEW_STATE_KEY },
    );
  });

  test("1.1 选样例，检查Lean与Infoview", async ({ page }) => {
    await test.step("在首页、顶栏经 Playground 链进入（免登录，非登录页）", async () => {
      let res = await page.goto(absUrl("/home"), { waitUntil: "domcontentloaded" });
      if (!res?.ok()) {
        res = await page.goto(absUrl("/"), { waitUntil: "domcontentloaded" });
      }
      expect(res?.ok(), `navigation status ${res?.status()}`).toBeTruthy();

      const pgLink = page.getByRole("link", { name: "Playground" }).first();
      await expect(pgLink).toBeVisible({ timeout: 60_000 });
      await pgLink.click();
      await page.waitForURL(/\/playground\/?$/i, { timeout: 60_000 });
      await expect(page).not.toHaveURL(/unauthenticated\/login/i);
    });

    await test.step("Lean 编码区就绪", async () => {
      const connecting = page.getByText(/Connecting to Lean Server/i);
      if (await connecting.isVisible().catch(() => false)) {
        await connecting.waitFor({ state: "hidden", timeout: 120_000 });
      }
      const cm = page.locator(".cm-editor").first();
      await expect(cm).toBeVisible({ timeout: 120_000 });
      await expect(cm.locator(".cm-content").first()).toBeAttached();
    });

    await test.step("在 Examples 中选择第一项；编码区显示该示例代码", async () => {
      await page.getByRole("button", { name: /Examples/i }).click();
      await page.getByRole("menuitem").first().click();
      // 与 `reaslab-fe/.../state/playground/index.ts` 中 `examples[0]`（Basic Math）一致；第一项变更时请同步改断言。
      await expect(page.locator(".cm-content").first()).toContainText("def double (n : Nat) : Nat := n * 2", {
        timeout: 60_000,
      });
      await expect(page.locator(".cm-content").first()).toContainText("#eval double 21");
    });

    await test.step("Infoview 区显示与选中代码对应的内容", async () => {
      // 与 `components/playground/playground-infoview.tsx` 中挂载 `InfoviewFc` 的外层一致；WS 未就绪时组件为 null，右侧空白且**不存在**此节点——不得判为通过。
      const infoviewPanel = page.locator("div.relative.h-full.overflow-auto.bg-sidebar.p-4").first();
      await expect(infoviewPanel).toBeVisible({ timeout: 60_000 });

      await page.locator(".cm-line").filter({ hasText: "#eval double 21" }).first().click();

      // Infoview 会先出现 Loading messages / No info / 结构标题等，不能与最终 #eval 结果做 .or() 短路；轮询直到面板内出现 42 且不在「加载消息」态。
      await expect
        .poll(
          async () => {
            const txt = (await infoviewPanel.innerText()) ?? "";
            if (/loading\s*messages/i.test(txt)) return false;
            return /\b42\b/.test(txt);
          },
          { timeout: 120_000, intervals: [250, 500, 1_000, 2_000] },
        )
        .toBeTruthy();
      await expect(infoviewPanel.getByText(/\b42\b/).first()).toBeVisible();
    });
  });
});
