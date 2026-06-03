import { expect, test } from "@playwright/test";

import {
  assertLeanInfoviewLspReady,
  assertMainLeanEditorVisible,
  assertModelingIdeShell,
  compileTexAndExpectPdfCanvas,
  createLatexProjectAndEnterIde,
  createModelingProjectAndEnterIde,
  createTheoremProvingProjectWithoutMathlib,
  fillNewProjectName,
  NEW_PROJECT_CH18_TOOLCHAIN_SKIP_MSG,
  openNewProjectForm,
  selectFirstLeanToolchain,
  selectProjectTypeToggle,
  setIncludeMathlib,
  submitCreateProject,
  toolchainVersionsLoadFailed,
  visibleCmContent,
  waitForProjectIdeShell,
} from "./18-new-project-helper";
import { openLeafFile } from "./helpers";

/**
 * **用户场景 §18**：新建项目（见 `docs/用户场景.md`）。
 * **18.1**：**Modeling** → **README.md** + 建模 IDE 侧栏。
 * **18.2**：**Theorem Proving**（不含 Mathlib）→ **Main.lean** + **Infoview**。
 * **18.3**：**Theorem Proving**（含 Mathlib）→ **Main.lean** + **Infoview**。
 * **18.4**：**LaTeX** → **main.tex** → TeX Preview → PDF **canvas**。
 *
 * 单文件调试：**`pnpm run test:18:headed`**。
 */
test.describe("18. 新建项目", () => {
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

  test.describe("18.1 创建 Modeling 类型项目", () => {
    test.setTimeout(180_000);

    test("18.1 创建 Modeling 类型项目", async ({ page }) => {
      const projectName = `e2e_mod_${Date.now()}`;

      await test.step("New Project → Modeling → Create → 进入 IDE", async () => {
        const ok = await createModelingProjectAndEnterIde(page, projectName);
        expect(ok, "Modeling 项目创建失败").toBeTruthy();
      });

      await test.step("建模 IDE 侧栏与 README.md", async () => {
        await assertModelingIdeShell(page);
        await openLeafFile(page, ["README.md"]);
        await expect(visibleCmContent(page)).toBeVisible({ timeout: 60_000 });
        await expect(visibleCmContent(page)).toContainText(new RegExp(projectName), {
          timeout: 30_000,
        });
      });
    });
  });

  test.describe("18.2 创建 Theorem Proving 类型项目（不含 Mathlib）", () => {
    test.setTimeout(600_000);

    test("18.2 创建 Theorem Proving 类型项目（不含 Mathlib）", async ({ page }) => {
      const projectName = `e2e_tp_${Date.now()}`;

      await test.step("New Project → Theorem Proving → Lean 版本 → 不勾选 Mathlib → Create", async () => {
        const ok = await createTheoremProvingProjectWithoutMathlib(page, projectName);
        test.skip(!ok, NEW_PROJECT_CH18_TOOLCHAIN_SKIP_MSG);
      });

      await test.step("打开 Main.lean 并验收 Lean 编辑器", async () => {
        await expect(page.getByTitle("Create New File")).toBeVisible({ timeout: 30_000 });
        await assertMainLeanEditorVisible(page);
      });

      await test.step("Toggle Lean Infoview 并等待 LSP 就绪", async () => {
        await assertLeanInfoviewLspReady(page);
      });
    });
  });

  test.describe("18.3 创建 Theorem Proving 类型项目（含 Mathlib）", () => {
    test.setTimeout(900_000);

    test("18.3 创建 Theorem Proving 类型项目（含 Mathlib）", async ({ page }) => {
      const projectName = `e2e_tpml_${Date.now()}`;

      await test.step("打开 New Project 并选择 Theorem Proving", async () => {
        await openNewProjectForm(page);
        test.skip(await toolchainVersionsLoadFailed(page), NEW_PROJECT_CH18_TOOLCHAIN_SKIP_MSG);
        await selectProjectTypeToggle(page, "Theorem Proving");
      });

      await test.step("选择 Lean 版本、勾选 Mathlib 并填写项目名", async () => {
        await selectFirstLeanToolchain(page);
        await setIncludeMathlib(page, true);
        await fillNewProjectName(page, projectName);
      });

      await test.step("Create → 等待 Setup（Toolchain / Packages / Cache）→ IDE", async () => {
        await submitCreateProject(page);
        await waitForProjectIdeShell(page, 900_000);
      });

      await test.step("打开 Main.lean 并验收 Lean 编辑器", async () => {
        await expect(page.getByTitle("Create New File")).toBeVisible({ timeout: 30_000 });
        await assertMainLeanEditorVisible(page);
      });

      await test.step("Toggle Lean Infoview 并等待 LSP 就绪", async () => {
        await assertLeanInfoviewLspReady(page);
      });
    });
  });

  test.describe("18.4 创建 LaTeX 类型项目", () => {
    test.setTimeout(600_000);

    test("18.4 创建 LaTeX 类型项目", async ({ page }) => {
      const projectName = `e2e_tex_${Date.now()}`;

      await test.step("New Project → LaTeX → Create → 进入 IDE", async () => {
        const ok = await createLatexProjectAndEnterIde(page, projectName);
        expect(ok, "LaTeX 项目创建失败").toBeTruthy();
      });

      await test.step("文件树打开 main.tex", async () => {
        await expect(page.getByTitle("Create New File")).toBeVisible({ timeout: 30_000 });
        await openLeafFile(page, ["main.tex"]);
        await expect(visibleCmContent(page)).toBeVisible({ timeout: 60_000 });
        await expect(visibleCmContent(page)).toContainText(/\\documentclass/i, {
          timeout: 30_000,
        });
      });

      await test.step("Toggle TeX Preview → Compile → PDF canvas 可见", async () => {
        await compileTexAndExpectPdfCanvas(page);
      });
    });
  });
});
