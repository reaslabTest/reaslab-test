/**
 * **`docs/用户场景.md`** §16：单 Modeling 项目上传多类文件；各 **`EditorToolbar`** 按钮须满足前置条件后再点击（非裸点）。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import {
  MODELING_CH5_SKIP_MSG,
  MODELING_PYTHON_CONSOLE_GUROBI_SKIP_MSG,
  tryEnterModelingProjectIde,
  uploadSingleFileViaExploreUploadDialog,
  visibleCmContentInActiveEditor,
} from "./helpers";
import {
  type EditorToolbarIcon,
  assertEditorToolbarHidden,
  assertEditorToolbarIcons,
  clickEditorToolbarIcon,
  dismissEditorFloatingPanels,
  exerciseEditorToolbarCommandPalette,
  exerciseEditorToolbarEyeLean,
  exerciseEditorToolbarLeanCodeLenses,
  exerciseEditorToolbarEyeMarkdown,
  exerciseEditorToolbarEyeTex,
  exerciseEditorToolbarFileSearch,
  exerciseEditorToolbarFormatTex,
  exerciseEditorToolbarRunPython,
  exerciseEditorToolbarSymbolPalette,
  exerciseEditorToolbarToggleComment,
  exerciseEditorToolbarUndoRedo,
  exerciseTexPreviewToolbar,
  openIdeFileTreeRow,
  PLAIN_TEXT_COMMENT_SKIP_MSG,
  waitForIdeCollabSyncConnected,
} from "./16-editor-toolbar-helper";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "data");

const FIXTURE_TEX = path.join(DATA_DIR, "test_upload.tex");
const FIXTURE_MD = path.join(DATA_DIR, "e2e-toolbar-sample.md");

const UPLOAD_FIXTURES = [
  FIXTURE_TEX,
  path.join(DATA_DIR, "e2e-toolbar-sample.md"),
  path.join(DATA_DIR, "e2e-toolbar-sample.py"),
  path.join(DATA_DIR, "e2e-toolbar-sample.lean"),
  path.join(DATA_DIR, "e2e-toolbar-sample.txt"),
  path.join(DATA_DIR, "test_upload.png"),
] as const;

const TEX_PRESENT: EditorToolbarIcon[] = [
  "eye",
  "undo",
  "redo",
  "message-circle",
  "command",
  "file-search",
  "type",
];
const MD_PRESENT: EditorToolbarIcon[] = ["eye", "undo", "redo", "command", "file-search"];
const LEAN_PRESENT: EditorToolbarIcon[] = [
  "eye",
  "captions",
  "undo",
  "redo",
  "message-circle",
  "command",
  "file-search",
  "omega",
];
const PY_PRESENT: EditorToolbarIcon[] = [
  "play",
  "undo",
  "redo",
  "message-circle",
  "command",
  "file-search",
  "omega",
];
const TXT_PRESENT: EditorToolbarIcon[] = [
  "undo",
  "redo",
  "message-circle",
  "command",
  "file-search",
  "omega",
];

async function openFileAndAssertToolbar(
  page: Parameters<typeof openIdeFileTreeRow>[0],
  rowPattern: RegExp,
  present: EditorToolbarIcon[],
  absent?: EditorToolbarIcon[],
): Promise<void> {
  await openIdeFileTreeRow(page, rowPattern);
  await expect(visibleCmContentInActiveEditor(page)).toBeVisible({ timeout: 60_000 });
  await waitForIdeCollabSyncConnected(page);
  await assertEditorToolbarIcons(page, { present, absent });
}

test.describe("16. 文件编辑的快捷操作栏", () => {
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

  test("16.1 单项目上传多类文件并按前置条件验收工具栏", async ({ page }) => {
    test.skip(!(await tryEnterModelingProjectIde(page)), MODELING_CH5_SKIP_MSG);
    await expect(page.getByTitle("Create New File")).toBeVisible({ timeout: 30_000 });

    await test.step("上传 tex / md / py / lean / txt / png", async () => {
      for (const filePath of UPLOAD_FIXTURES) {
        await uploadSingleFileViaExploreUploadDialog(page, filePath);
      }
    });

    await test.step(".tex：编辑器工具栏 + TeX 预览窗工具栏", async () => {
      await openFileAndAssertToolbar(page, /test_upload\.tex/i, [...TEX_PRESENT], ["play", "omega"]);
      await test.step("Undo / Redo", async () => {
        await exerciseEditorToolbarUndoRedo(page);
      });
      await test.step("注释（Hello 行）", async () => {
        expect(
          await exerciseEditorToolbarToggleComment(page, {
            contentPattern: /Hello from ReasLab E2E/i,
            lineMustMatch: /Hello from ReasLab E2E/i,
            commentPrefix: "%",
          }),
        ).toBe(true);
        await clickEditorToolbarIcon(page, "message-circle");
      });
      await test.step("Command / 查找 / Type / 预览栏", async () => {
        await exerciseEditorToolbarCommandPalette(page);
        await exerciseEditorToolbarFileSearch(page, "documentclass");
        await exerciseEditorToolbarFormatTex(page);
        await exerciseEditorToolbarEyeTex(page);
        await exerciseTexPreviewToolbar(page);
        await dismissEditorFloatingPanels(page);
      });
    });

    await test.step(".md：图标 + Eye→预览 / Loro Undo / Command / 查找", async () => {
      await openFileAndAssertToolbar(page, /e2e-toolbar-sample\.md/i, [...MD_PRESENT], [
        "play",
        "message-circle",
        "type",
        "omega",
      ]);
      await exerciseEditorToolbarUndoRedo(page);
      await exerciseEditorToolbarEyeMarkdown(page);
      await exerciseEditorToolbarCommandPalette(page);
      await exerciseEditorToolbarFileSearch(page, "Markdown");
      await dismissEditorFloatingPanels(page);
    });

    await test.step(".lean：图标 + Eye / Code Lenses 冒烟（Modeling 无 Infoview）/ Undo / --注释 / Command / 查找 / Ω", async () => {
      await openFileAndAssertToolbar(page, /e2e-toolbar-sample\.lean/i, [...LEAN_PRESENT], ["play", "type"]);
      await exerciseEditorToolbarEyeLean(page);
      await exerciseEditorToolbarLeanCodeLenses(page);
      await exerciseEditorToolbarUndoRedo(page);
      expect(
        await exerciseEditorToolbarToggleComment(page, {
          contentPattern: /#eval/i,
          lineMustMatch: /#eval/i,
          commentPrefix: "--",
        }),
      ).toBe(true);
      await exerciseEditorToolbarCommandPalette(page);
      await exerciseEditorToolbarFileSearch(page, "e2e-toolbar");
      await exerciseEditorToolbarSymbolPalette(page);
      await dismissEditorFloatingPanels(page);
    });

    await test.step(".py：图标 + Console→Play / Loro Undo / #注释 / Command / 查找 / Ω", async () => {
      await openFileAndAssertToolbar(page, /e2e-toolbar-sample\.py/i, [...PY_PRESENT], ["eye", "type"]);
      const runOutcome = await test.step("Play（先 Console）", async () => {
        return exerciseEditorToolbarRunPython(page);
      });
      if (runOutcome === "gurobi_license_skip") {
        test.skip(true, MODELING_PYTHON_CONSOLE_GUROBI_SKIP_MSG);
      }
      await exerciseEditorToolbarUndoRedo(page);
      expect(
        await exerciseEditorToolbarToggleComment(page, {
          contentPattern: /print/i,
          lineMustMatch: /print/i,
          commentPrefix: "#",
        }),
      ).toBe(true);
      await exerciseEditorToolbarCommandPalette(page);
      await exerciseEditorToolbarFileSearch(page, "e2e-toolbar");
      await exerciseEditorToolbarSymbolPalette(page);
      await dismissEditorFloatingPanels(page);
    });

    await test.step(".txt：图标 + Loro Undo / 注释 / Command / 查找 / Ω", async () => {
      await openFileAndAssertToolbar(page, /e2e-toolbar-sample\.txt/i, [...TXT_PRESENT], ["play", "eye", "type"]);
      await exerciseEditorToolbarUndoRedo(page);
      await test.step("注释", async () => {
        const txtCommented = await exerciseEditorToolbarToggleComment(page, {
          contentPattern: /plain text/i,
          lineMustMatch: /plain text/i,
          commentPrefix: "//",
        });
        if (!txtCommented) {
          test.info().annotations.push({
            type: "known limitation",
            description: PLAIN_TEXT_COMMENT_SKIP_MSG,
          });
        }
      });
      await exerciseEditorToolbarCommandPalette(page);
      await exerciseEditorToolbarFileSearch(page, "plain");
      await exerciseEditorToolbarSymbolPalette(page);
      await dismissEditorFloatingPanels(page);
    });

    await test.step("test_upload.png：无编辑器工具栏", async () => {
      await openIdeFileTreeRow(page, /test_upload\.png/i);
      await expect(page.locator(".cm-content").filter({ visible: true })).toHaveCount(0);
      await assertEditorToolbarHidden(page);
    });
  });
});
