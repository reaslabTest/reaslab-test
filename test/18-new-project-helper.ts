import { expect, type Page } from "@playwright/test";

import { navigateToHomeProjects, openLeafFile, waitForFileTree } from "./helpers";

export const NEW_PROJECT_CH18_TOOLCHAIN_SKIP_MSG =
  "§18：Lean Toolchain 列表加载失败（Could not load toolchain versions），跳过。";

const NEW_LEAN_IDE_SHELL_TIMEOUT_MS = 600_000;
const NEW_LEAN_WITH_MATHLIB_IDE_SHELL_TIMEOUT_MS = 900_000;
const NEW_MODELING_IDE_SHELL_TIMEOUT_MS = 120_000;
const NEW_LATEX_IDE_SHELL_TIMEOUT_MS = 120_000;

/** 当前可见编辑区内的 CodeMirror 内容（与 `12-latex.test.ts` 一致）。 */
export function visibleCmContent(page: Page) {
  return page.locator(".cm-content").filter({ visible: true }).first();
}

export async function openNewProjectForm(page: Page): Promise<void> {
  await navigateToHomeProjects(page);
  await page.getByRole("button", { name: "New Project" }).first().click();
  await expect(page.getByRole("heading", { name: "New Project" })).toBeVisible({
    timeout: 120_000,
  });
}

export async function toolchainVersionsLoadFailed(page: Page): Promise<boolean> {
  const toolchainErr = page.getByText(/Could not load toolchain versions/i);
  return (await toolchainErr.count()) > 0 && (await toolchainErr.isVisible().catch(() => false));
}

export async function selectProjectTypeToggle(
  page: Page,
  label: "Modeling" | "Theorem Proving" | "LaTeX",
): Promise<void> {
  const btn = page.getByRole("button", { name: label, exact: true });
  await expect(btn).toBeVisible({ timeout: 60_000 });
  const pressed = await btn.getAttribute("aria-pressed");
  const dataState = await btn.getAttribute("data-state");
  const on = pressed === "true" || dataState === "on";
  if (!on) {
    await btn.click();
  }
}

export async function selectFirstLeanToolchain(page: Page): Promise<void> {
  const loading = page.getByText(/Loading toolchain versions/i);
  if (await loading.isVisible().catch(() => false)) {
    await expect(loading).toBeHidden({ timeout: 120_000 });
  }

  const toolchainSelect = page.locator("#toolchain-select");
  await expect(toolchainSelect).toBeVisible({ timeout: 60_000 });

  const currentValue = (await toolchainSelect.innerText()).trim();
  if (/Select a Lean toolchain/i.test(currentValue)) {
    await toolchainSelect.click();
    const firstOption = page.getByRole("option").first();
    await expect(firstOption).toBeVisible({ timeout: 30_000 });
    await firstOption.click();
    await page.keyboard.press("Escape");
  }

  await expect(toolchainSelect).not.toHaveText(/Select a Lean toolchain/i, { timeout: 10_000 });
}

export async function fillNewProjectName(page: Page, name: string): Promise<void> {
  const nameInput = page.locator("input#projectName, input#project-name").first();
  await expect(nameInput).toBeVisible({ timeout: 60_000 });
  await nameInput.fill(name);
  await expect(nameInput).toHaveValue(name);
  // `new-project.tsx` 300ms debounce 后才更新 `isNameValid`
  await page.waitForTimeout(500);
  await expect(page.getByText("✗ Invalid project name")).toBeHidden({ timeout: 10_000 });
}

export async function submitCreateProject(page: Page): Promise<void> {
  const createBtn = page.getByRole("button", { name: "Create Project" });
  await expect(createBtn).toBeEnabled({ timeout: 90_000 });
  await createBtn.click();
  await page.waitForURL(/\/projects\/[^/]+\/?$/i, { timeout: 120_000 });
}

export async function waitForProjectIdeShell(
  page: Page,
  timeoutMs = NEW_LEAN_IDE_SHELL_TIMEOUT_MS,
): Promise<void> {
  const createNewFile = page.getByTitle("Create New File");
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await createNewFile.isVisible().catch(() => false)) {
      await waitForFileTree(page);
      return;
    }

    const onSetup =
      (await page.getByText("Toolchain", { exact: true }).isVisible().catch(() => false)) ||
      (await page.getByText("Packages", { exact: true }).isVisible().catch(() => false)) ||
      (await page.getByText("Cache", { exact: true }).isVisible().catch(() => false));
    if (onSetup) {
      await page.waitForTimeout(2_000);
      continue;
    }

    await page.waitForTimeout(1_000);
  }

  throw new Error(`等待项目 IDE 超时（${timeoutMs}ms）；Setup 可能仍在进行（含 Mathlib 时更久）。`);
}

function includeMathlibCheckbox(page: Page) {
  return page
    .locator("div.flex.items-center.gap-2")
    .filter({ has: page.getByText("Include Mathlib", { exact: true }) })
    .locator('[data-slot="checkbox"]')
    .first();
}

async function isIncludeMathlibChecked(page: Page): Promise<boolean> {
  const checkbox = includeMathlibCheckbox(page);
  if ((await checkbox.getAttribute("data-checked")) !== null) {
    return true;
  }
  return (await checkbox.getAttribute("aria-checked")) === "true";
}

export async function setIncludeMathlib(page: Page, include: boolean): Promise<void> {
  // `#include-mathlib` 是 Base UI 隐藏的 `<input>`，无 `aria-checked`；须点可见的 `[data-slot="checkbox"]`。
  await expect(page.locator("#toolchain-select")).toBeVisible({ timeout: 30_000 });
  const checkbox = includeMathlibCheckbox(page);
  await expect(checkbox).toBeVisible({ timeout: 30_000 });

  if (include !== (await isIncludeMathlibChecked(page))) {
    await checkbox.click();
  }

  await expect
    .poll(async () => isIncludeMathlibChecked(page), { timeout: 5_000 })
    .toBe(include);
}

/**
 * 打开 **TeX / PDF** 侧栏并等待 **Compile** 可见（与 `12-latex.test.ts` 对齐）。
 */
export async function openTexPreviewThenCompileButton(page: Page): Promise<void> {
  const editorToolbar = page
    .locator("div.flex.h-8.justify-end.gap-2.border-b")
    .filter({ visible: true })
    .first();
  await expect(editorToolbar).toBeVisible({ timeout: 30_000 });

  const eyeBtn = editorToolbar
    .locator("button")
    .filter({
      has: page.locator("svg.lucide-eye, svg[class*='lucide-eye']"),
    })
    .first();
  await expect(eyeBtn).toBeVisible({ timeout: 30_000 });

  const compile = page.getByRole("button", { name: "Compile", exact: true });
  for (let i = 0; i < 3; i++) {
    if (await compile.isVisible().catch(() => false)) {
      return;
    }
    await eyeBtn.click();
    await page.waitForTimeout(800);
  }
  await expect(compile).toBeVisible({ timeout: 30_000 });
}

export async function compileTexAndExpectPdfCanvas(page: Page): Promise<void> {
  await openTexPreviewThenCompileButton(page);
  const emptyHint = page.getByText("Click the compile button to preview PDF", { exact: true });
  if (await emptyHint.isVisible().catch(() => false)) {
    await expect(emptyHint).toBeVisible();
  }

  await page.getByRole("button", { name: "Compile", exact: true }).click();
  await expect(emptyHint).toBeHidden({ timeout: 300_000 });

  const pdfCanvas = page.locator("[data-pdf-presentation]").locator("canvas").first();
  await expect(pdfCanvas).toBeVisible({ timeout: 120_000 });
}

export async function createTheoremProvingProject(
  page: Page,
  projectName: string,
  options: { includeMathlib: boolean },
): Promise<boolean> {
  try {
    await openNewProjectForm(page);
    if (await toolchainVersionsLoadFailed(page)) {
      return false;
    }

    await selectProjectTypeToggle(page, "Theorem Proving");
    await selectFirstLeanToolchain(page);
    if (options.includeMathlib) {
      await setIncludeMathlib(page, true);
    }
    await fillNewProjectName(page, projectName);
    await submitCreateProject(page);

    const shellTimeout = options.includeMathlib
      ? NEW_LEAN_WITH_MATHLIB_IDE_SHELL_TIMEOUT_MS
      : NEW_LEAN_IDE_SHELL_TIMEOUT_MS;
    await waitForProjectIdeShell(page, shellTimeout);
    return true;
  } catch (err) {
    console.error("[18-new-project] createTheoremProvingProject failed:", err);
    return false;
  }
}

export async function createTheoremProvingProjectWithoutMathlib(
  page: Page,
  projectName: string,
): Promise<boolean> {
  return createTheoremProvingProject(page, projectName, { includeMathlib: false });
}

export async function createTheoremProvingProjectWithMathlib(
  page: Page,
  projectName: string,
): Promise<boolean> {
  return createTheoremProvingProject(page, projectName, { includeMathlib: true });
}

export async function createModelingProjectAndEnterIde(page: Page, projectName: string): Promise<boolean> {
  try {
    await openNewProjectForm(page);
    await selectProjectTypeToggle(page, "Modeling");
    await fillNewProjectName(page, projectName);
    await submitCreateProject(page);
    await waitForProjectIdeShell(page, NEW_MODELING_IDE_SHELL_TIMEOUT_MS);
    return true;
  } catch {
    return false;
  }
}

export async function createLatexProjectAndEnterIde(page: Page, projectName: string): Promise<boolean> {
  try {
    await openNewProjectForm(page);
    await selectProjectTypeToggle(page, "LaTeX");
    await fillNewProjectName(page, projectName);
    await submitCreateProject(page);
    await waitForProjectIdeShell(page, NEW_LATEX_IDE_SHELL_TIMEOUT_MS);
    return true;
  } catch {
    return false;
  }
}

export async function openLeanInfoviewPanel(page: Page): Promise<void> {
  const leanInfoviewToggle = page
    .locator("div.flex.h-8.justify-end.gap-2.border-b")
    .locator("button")
    .filter({ has: page.locator("svg.lucide-eye") })
    .first();
  await expect(leanInfoviewToggle).toBeVisible({ timeout: 30_000 });
  await leanInfoviewToggle.click();

  const infoview = page.locator(".ide-infoview").filter({ visible: true }).first();
  await expect(infoview).toBeVisible({ timeout: 120_000 });
}

export async function assertMainLeanEditorVisible(page: Page): Promise<void> {
  await openLeafFile(page, ["Main.lean"]);
  const editor = visibleCmContent(page);
  await expect(editor).toBeVisible({ timeout: 60_000 });
  await expect(editor).toContainText(/def\s+main/i, { timeout: 60_000 });
}

export async function assertLeanInfoviewLspReady(page: Page): Promise<void> {
  await page.locator(".cm-editor").first().waitFor({ state: "visible", timeout: 120_000 });
  await openLeanInfoviewPanel(page);

  const infoview = page.locator(".ide-infoview").filter({ visible: true }).first();
  await expect
    .poll(
      async () => {
        const text = (await infoview.innerText().catch(() => "")).trim();
        if (text.length === 0) {
          return false;
        }
        if (/Server\s+not\s+connected|Connection\s+failed|LSP\s+error/i.test(text)) {
          return false;
        }
        return true;
      },
      { timeout: 180_000 },
    )
    .toBe(true);
}

export async function assertModelingIdeShell(page: Page): Promise<void> {
  await expect(page.getByTitle("Create New File")).toBeVisible({ timeout: 30_000 });
  await expect(
    page.locator(".bg-sidebar button").filter({ has: page.locator("svg.lucide-sliders-horizontal") }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTitle("Semantic Search")).toHaveCount(0);
}
