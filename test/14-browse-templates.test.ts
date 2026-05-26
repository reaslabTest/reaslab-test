import { expect, test, type Locator, type Page } from "@playwright/test";

import { absUrl } from "../common/global-setup";

/**
 * **用户场景 §14**：顶栏 **Templates** 下拉依次进入三类模板列表页，并验收 **Grid / List** 排列切换（见 `docs/用户场景.md`）。
 * 与 §11 页脚链接、§7～9「从模板创建项目」区分：仅浏览列表，不点 **Use Template**。
 *
 * 单文件调试：`pnpm run test:14:headed`
 */
async function gotoMarketingHome(page: Page): Promise<void> {
  let res = await page.goto(absUrl("/home"), { waitUntil: "domcontentloaded" });
  if (!res?.ok()) {
    res = await page.goto(absUrl("/"), { waitUntil: "domcontentloaded" });
  }
  expect(res?.ok(), `首屏导航状态 ${res?.status()}`).toBeTruthy();
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

/** 顶栏 `header-nav` **Templates** 下拉（与页脚 **Templates** 区分）。 */
async function openTemplatesDropdown(page: Page): Promise<void> {
  const header = page.locator("header").first();
  await expect(header).toBeVisible({ timeout: 60_000 });
  const trigger = header.getByRole("button", { name: /^Templates/i });
  await expect(trigger).toBeVisible({ timeout: 60_000 });
  await trigger.click();
}

async function clickTemplatesMenuItem(page: Page, label: string): Promise<void> {
  await openTemplatesDropdown(page);
  const item = page.getByRole("menuitem", { name: label, exact: true });
  await expect(item).toBeVisible({ timeout: 15_000 });
  await item.click();
}

/** 标题行右侧 **Grid / List** 切换（`modeling-templates` 等组件 `viewMode`）。 */
function viewModeToggle(page: Page): Locator {
  return page
    .locator("div.mb-6.flex.items-center.justify-between")
    .locator("div.flex.rounded-lg.border.p-1");
}

async function clickListView(page: Page): Promise<void> {
  const toggle = viewModeToggle(page);
  await expect(toggle).toBeVisible({ timeout: 30_000 });
  await toggle.locator("button").nth(1).click();
}

/** 优化/竞赛类模板网格卡片（默认 Grid 视图；卡片点进详情，无 **Use Template**）。 */
function modelingCatalogGridCard(page: Page): Locator {
  return page.locator(
    "xpath=//div[contains(@class,'lg:grid-cols-3')]//button[@type='button'][.//img[@alt]]",
  );
}

/** 列表模式：纵向 `space-y-4` + **Use Template** 行。 */
async function expectListLayout(page: Page): Promise<void> {
  const listRoot = page
    .locator("div.space-y-4")
    .filter({ has: page.getByRole("button", { name: "Use Template" }) });
  await expect(listRoot.first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("div.lg\\:grid-cols-3").first()).toHaveCount(0);
}

async function assertTemplatesLoaded(
  page: Page,
  opts: { expectCategoryFilter?: boolean; modelingCatalog?: boolean },
): Promise<void> {
  await expect(page.getByRole("heading", { name: "Failed to load templates", exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole("heading", { name: "Failed to Load Templates", exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("heading", { name: "No templates available", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "No Competition Templates Available", exact: true }),
  ).toHaveCount(0);

  if (opts.expectCategoryFilter) {
    await expect(page.getByText(/\d+\s+templates?\s+in\s+total/i)).toBeVisible({ timeout: 120_000 });
  }

  if (opts.modelingCatalog) {
    const card = modelingCatalogGridCard(page).first();
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible({ timeout: 120_000 });
  } else {
    await expect(page.getByRole("button", { name: "Use Template" }).first()).toBeVisible({
      timeout: 120_000,
    });
  }
}

async function assertSwitchToListLayout(page: Page): Promise<void> {
  await expect(viewModeToggle(page)).toBeVisible({ timeout: 30_000 });
  await clickListView(page);
  await expectListLayout(page);
}

type TemplateBrowseCase = {
  stepLabel: string;
  menuLabel: string;
  pathnameRe: RegExp;
  heading: RegExp;
  expectCategoryFilter?: boolean;
  /** 优化/竞赛列表：Grid 为缩略图卡片，**Use Template** 仅在 List。 */
  modelingCatalog?: boolean;
};

const TEMPLATE_CASES: TemplateBrowseCase[] = [
  {
    stepLabel: "Optimization Modeling → /modeling-templates",
    menuLabel: "Optimization Modeling",
    pathnameRe: /^\/modeling-templates\/?$/i,
    heading: /^Optimization Modeling Templates$/i,
    expectCategoryFilter: true,
    modelingCatalog: true,
  },
  {
    stepLabel: "Theorem Proving → /theorem-proving-templates",
    menuLabel: "Theorem Proving",
    pathnameRe: /^\/theorem-proving-templates\/?$/i,
    heading: /^Theorem Proving Templates$/i,
  },
  {
    stepLabel: "Math Modeling Contests → /modeling-competition",
    menuLabel: "Math Modeling Contests",
    pathnameRe: /^\/modeling-competition\/?$/i,
    heading: /^Mathematical Modeling Contest Templates$/i,
    expectCategoryFilter: true,
    modelingCatalog: true,
  },
];

test.describe("14. 浏览各类模板", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.setTimeout(300_000);

  test("14.1 顶栏 Templates 三类列表页与排列方式切换", async ({ page }) => {
    await gotoMarketingHome(page);

    for (const tc of TEMPLATE_CASES) {
      await test.step(tc.stepLabel, async () => {
        await gotoMarketingHome(page);
        await clickTemplatesMenuItem(page, tc.menuLabel);

        await expect
          .poll(() => pathnameMatches(tc.pathnameRe)(page.url()), {
            timeout: 60_000,
            message: `URL 不符合预期：${page.url()}`,
          })
          .toBe(true);

        await expect(page.getByRole("heading", { name: tc.heading })).toBeVisible({
          timeout: 120_000,
        });

        await assertTemplatesLoaded(page, {
          expectCategoryFilter: tc.expectCategoryFilter ?? false,
          modelingCatalog: tc.modelingCatalog ?? false,
        });

        await assertSwitchToListLayout(page);
      });
    }
  });
});
