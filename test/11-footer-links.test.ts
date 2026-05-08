import { expect, test, type Page } from "@playwright/test";

import { absUrl } from "../common/global-setup";

/**
 * **用户场景 §11**：页脚导航链接可正常跳转（见 `docs/用户场景.md`）。
 * 覆盖：`app/home/footer.tsx` 中 **Templates** / **Resources** / **About** 各链接；页脚均为 **`target="_blank"`**，本用例通过 **`popup`** 断言目标页可达且 URL 符合预期。
 *
 * 单文件调试：`pnpm run test:11:headed`
 */
async function gotoMarketingHome(page: Page): Promise<void> {
  let res = await page.goto(absUrl("/home"), { waitUntil: "domcontentloaded" });
  if (!res?.ok()) {
    res = await page.goto(absUrl("/"), { waitUntil: "domcontentloaded" });
  }
  expect(res?.ok(), `首屏导航状态 ${res?.status()}`).toBeTruthy();
}

async function assertFooterLinkOpensPopup(
  page: Page,
  linkText: string,
  urlPredicate: (absoluteUrl: string) => boolean,
): Promise<void> {
  const footer = page.locator("footer");
  await footer.scrollIntoViewIfNeeded();
  const link = footer.getByRole("link", { name: linkText, exact: true });
  await expect(link).toBeVisible({ timeout: 60_000 });
  await expect(link).toHaveAttribute("target", "_blank");

  const [popup] = await Promise.all([page.waitForEvent("popup"), link.click()]);
  try {
    await popup.waitForLoadState("domcontentloaded", { timeout: 120_000 });
    await expect
      .poll(() => urlPredicate(popup.url()), {
        timeout: 20_000,
        message: `弹窗 URL 不符合预期：${popup.url()}`,
      })
      .toBe(true);
  } finally {
    await popup.close();
  }
}

function pathnameMatches(re: RegExp): (u: string) => boolean {
  return (u: string) => {
    try {
      return re.test(new URL(u).pathname);
    } catch {
      return false;
    }
  };
}

function hostnameOneOf(...hosts: string[]): (u: string) => boolean {
  return (u: string) => {
    try {
      const h = new URL(u).hostname.toLowerCase();
      return hosts.some((x) => h === x || h.endsWith(`.${x}`));
    } catch {
      return false;
    }
  };
}

test.describe("11. 页脚导航链接", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.setTimeout(300_000);

  test("11.1 检查模板/资源/关于", async ({ page }) => {
    await gotoMarketingHome(page);

    await test.step("Templates · Optimization Modeling → /modeling-templates", async () => {
      await assertFooterLinkOpensPopup(page, "Optimization Modeling", pathnameMatches(/^\/modeling-templates\/?$/i));
    });

    await test.step("Templates · Theorem Proving → /theorem-proving-templates", async () => {
      await assertFooterLinkOpensPopup(page, "Theorem Proving", pathnameMatches(/^\/theorem-proving-templates\/?$/i));
    });

    await test.step("Templates · Math Modeling Contests → /modeling-competition", async () => {
      await assertFooterLinkOpensPopup(page, "Math Modeling Contests", pathnameMatches(/^\/modeling-competition\/?$/i));
    });

    await test.step("Resources · Playground → /playground", async () => {
      await assertFooterLinkOpensPopup(page, "Playground", pathnameMatches(/^\/playground\/?$/i));
    });

    await test.step("Resources · User Guide → docs.reaslab.io", async () => {
      await assertFooterLinkOpensPopup(
        page,
        "User Guide",
        (u) => hostnameOneOf("docs.reaslab.io")(u) && /\/guides\//i.test(u),
      );
    });

    await test.step("Resources · Lean Documentation → lean-lang.org", async () => {
      await assertFooterLinkOpensPopup(page, "Lean Documentation", hostnameOneOf("lean-lang.org"));
    });

    await test.step("Resources · Mathematical Formalization → PKU 文档站", async () => {
      await assertFooterLinkOpensPopup(
        page,
        "Mathematical Formalization",
        (u) => hostnameOneOf("faculty.bicmr.pku.edu.cn")(u) && /formal/i.test(u),
      );
    });

    await test.step("About · ReasLab → github.com/reaslab", async () => {
      await assertFooterLinkOpensPopup(page, "ReasLab", (u) => {
        try {
          const { hostname, pathname } = new URL(u);
          return (
            hostname.toLowerCase() === "github.com" &&
            pathname.replace(/\/+$/, "").toLowerCase() === "/reaslab"
          );
        } catch {
          return false;
        }
      });
    });
  });
});
