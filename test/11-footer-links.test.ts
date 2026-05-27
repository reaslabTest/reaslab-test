import { expect, test, type Page } from "@playwright/test";

import { absUrl } from "../common/global-setup";

/**
 * **用户场景 §11**：页脚导航链接可正常跳转（见 `docs/用户场景.md`）。
 * 覆盖：`reaslab-iipe` `app/home/footer.tsx` 中 **Products** / **Templates** / **Resources** / **Support**；
 * **Products**、**Templates**、**Playground** 为 React Router **`Link`**（同页跳转）；
 * **Arena** / **Publications** / **GitHub** / **User Guide** / **Blog** 为 **`target="_blank"`**（popup）。
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

/** `footer.tsx` **Products** 使用 React Router `Link`，无 `target="_blank"`。 */
async function assertFooterLinkNavigatesSameTab(
  page: Page,
  linkText: string,
  urlPredicate: (absoluteUrl: string) => boolean,
): Promise<void> {
  const footer = page.locator("footer");
  await footer.scrollIntoViewIfNeeded();
  const link = footer.getByRole("link", { name: linkText, exact: true });
  await expect(link).toBeVisible({ timeout: 60_000 });
  await expect(link).not.toHaveAttribute("target", "_blank");
  await link.click();
  await expect
    .poll(() => urlPredicate(page.url()), {
      timeout: 60_000,
      message: `同页跳转 URL 不符合预期：${page.url()}`,
    })
    .toBe(true);
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

  test("11.1 检查模板/资源/支持", async ({ page }) => {
    await gotoMarketingHome(page);

    await test.step("Products · Mathematical Modeling → /model", async () => {
      await assertFooterLinkNavigatesSameTab(page, "Mathematical Modeling", pathnameMatches(/^\/model\/?$/i));
    });

    await test.step("Products · Theorem Prove → /prove", async () => {
      await assertFooterLinkNavigatesSameTab(page, "Theorem Prove", pathnameMatches(/^\/prove\/?$/i));
      await gotoMarketingHome(page);
    });

    await test.step("Templates · Optimization Modeling → /modeling-templates", async () => {
      await assertFooterLinkNavigatesSameTab(
        page,
        "Optimization Modeling",
        pathnameMatches(/^\/modeling-templates\/?$/i),
      );
      await gotoMarketingHome(page);
    });

    await test.step("Templates · Theorem Proving → /theorem-proving-templates", async () => {
      await assertFooterLinkNavigatesSameTab(
        page,
        "Theorem Proving",
        pathnameMatches(/^\/theorem-proving-templates\/?$/i),
      );
      await gotoMarketingHome(page);
    });

    await test.step("Templates · Math Modeling Contests → /modeling-competition", async () => {
      await assertFooterLinkNavigatesSameTab(
        page,
        "Math Modeling Contests",
        pathnameMatches(/^\/modeling-competition\/?$/i),
      );
      await gotoMarketingHome(page);
    });

    await test.step("Resources · Arena → arena.reaslab.io", async () => {
      await assertFooterLinkOpensPopup(page, "Arena", hostnameOneOf("arena.reaslab.io"));
    });

    await test.step("Resources · Playground → /playground", async () => {
      await assertFooterLinkNavigatesSameTab(page, "Playground", pathnameMatches(/^\/playground\/?$/i));
      await gotoMarketingHome(page);
    });

    await test.step("Resources · Publications → blog.reaslab.io/publications", async () => {
      await assertFooterLinkOpensPopup(
        page,
        "Publications",
        (u) => hostnameOneOf("blog.reaslab.io")(u) && /\/publications/i.test(u),
      );
    });

    await test.step("Support · GitHub → github.com/reaslab", async () => {
      await assertFooterLinkOpensPopup(page, "GitHub", (u) => {
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

    await test.step("Support · User Guide → docs.reaslab.io", async () => {
      await assertFooterLinkOpensPopup(
        page,
        "User Guide",
        (u) => hostnameOneOf("docs.reaslab.io")(u) && /\/guides\//i.test(u),
      );
    });

    await test.step("Support · Blog → blog.reaslab.io", async () => {
      await assertFooterLinkOpensPopup(page, "Blog", hostnameOneOf("blog.reaslab.io"));
    });
  });
});
