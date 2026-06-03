import path from "node:path";

import { expect, type Locator, type Page } from "@playwright/test";

import { absUrl } from "../common/global-setup";

/** 与 iipe `LOCAL_STORAGE_KEY` 一致。 */
export const PLAYGROUND_LS_KEY = "reaslab-playground";
/** Jotai `viewStateAtomFamily("playground-cacheState")` 键。 */
export const PLAYGROUND_VIEW_STATE_KEY = "playground-cacheState";

/** §17.1：Basic Math 已由 §1 覆盖，此处依次测其余四类。 */
export const PLAYGROUND_REMAINING_EXAMPLES = [
  {
    title: "List Operations",
    codeSnippet: "def myList",
    evalLine: "#eval myList.length",
    infoPattern: /\b5\b/,
  },
  {
    title: "Simple Proofs",
    codeSnippet: "theorem add_comm",
    evalLine: "#check add_comm",
    infoPattern: /add_comm/,
  },
  {
    title: "Inductive Types",
    codeSnippet: "inductive MyNat",
    evalLine: "#eval treeSize exampleTree",
    infoPattern: /\b3\b/,
  },
  {
    title: "Tactics",
    codeSnippet: "theorem example1",
    evalLine: "#eval isEven 4",
    infoPattern: /true/i,
  },
] as const;

export function playgroundLoadFixturePath(ext: "lean" | "txt"): string {
  return path.join(import.meta.dirname, "data", `e2e-playground-load.${ext}`);
}

export async function installPlaygroundInitScript(
  page: Page,
  options?: { resetCta?: boolean },
): Promise<void> {
  await page.addInitScript(
    (keys: { doc: string; view: string; resetCta: boolean }) => {
      try {
        globalThis.localStorage.removeItem(keys.doc);
        globalThis.localStorage.removeItem(keys.view);
        globalThis.sessionStorage.removeItem("playground-session-id");
        globalThis.localStorage.removeItem("playground.fontSize");
        globalThis.localStorage.removeItem("playground.tabSize");
        globalThis.localStorage.removeItem("playground.lineNumber");
        globalThis.localStorage.removeItem("playground.wordWrap");
        if (keys.resetCta) {
          globalThis.localStorage.removeItem("hasClosedPlaygroundCta");
        } else {
          globalThis.localStorage.setItem("hasClosedPlaygroundCta", "true");
        }
      } catch {
        /* ignore */
      }
    },
    { doc: PLAYGROUND_LS_KEY, view: PLAYGROUND_VIEW_STATE_KEY, resetCta: options?.resetCta ?? false },
  );
}

export async function navigateToPlayground(page: Page): Promise<void> {
  let res = await page.goto(absUrl("/playground"), { waitUntil: "domcontentloaded" });
  if (!res?.ok()) {
    res = await page.goto(absUrl("/home"), { waitUntil: "domcontentloaded" });
    expect(res?.ok(), `navigation status ${res?.status()}`).toBeTruthy();
    const pgLink = page.getByRole("link", { name: "Playground" }).first();
    await expect(pgLink).toBeVisible({ timeout: 60_000 });
    await pgLink.click();
  }
  await page.waitForURL(/\/playground\/?$/i, { timeout: 60_000 });
}

export async function waitForPlaygroundLeanEditor(page: Page): Promise<void> {
  const connecting = page.getByText(/Connecting to Lean Server/i);
  if (await connecting.isVisible().catch(() => false)) {
    await connecting.waitFor({ state: "hidden", timeout: 120_000 });
  }
  const cm = page.locator(".cm-editor").first();
  await expect(cm).toBeVisible({ timeout: 120_000 });
  await expect(cm.locator(".cm-content").first()).toBeAttached();
}

export function playgroundInfoviewPanel(page: Page) {
  return page.locator("div.relative.h-full.overflow-auto.bg-sidebar.p-4").first();
}

export async function expectPlaygroundInfoviewForEvalLine(
  page: Page,
  evalLineText: string,
  infoPattern: RegExp,
): Promise<void> {
  const infoviewPanel = playgroundInfoviewPanel(page);
  await expect(infoviewPanel).toBeVisible({ timeout: 60_000 });
  await page.locator(".cm-line").filter({ hasText: evalLineText }).first().click();
  await expect
    .poll(
      async () => {
        const txt = (await infoviewPanel.innerText()) ?? "";
        if (/loading\s*messages/i.test(txt)) {
          return false;
        }
        return infoPattern.test(txt);
      },
      { timeout: 120_000, intervals: [250, 500, 1_000, 2_000] },
    )
    .toBeTruthy();
}

export async function selectPlaygroundExample(page: Page, exampleTitle: string): Promise<void> {
  await page.getByRole("button", { name: /Examples/i }).click();
  await page.getByRole("menuitem").filter({ hasText: exampleTitle }).click();
  await expect(page.getByText(`Example "${exampleTitle}" loaded successfully`)).toBeVisible({
    timeout: 30_000,
  });
}

export async function loadPlaygroundFileFromDisk(page: Page, filePath: string): Promise<void> {
  const fileName = path.basename(filePath);
  await page.getByRole("button", { name: "Load", exact: true }).click();
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("menuitem", { name: "Load file from disk" }).click(),
  ]);
  await fileChooser.setFiles(filePath);
  await expect(page.getByText(`File "${fileName}" loaded successfully`, { exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

export async function exportPlaygroundToUrlAndReadLink(page: Page): Promise<string> {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export content to URL" }).click();
  await expect(page.getByText("Link copied to clipboard!")).toBeVisible({ timeout: 15_000 });
  const url = await page.evaluate(async () => globalThis.navigator.clipboard.readText());
  expect(url).toContain("#codez=");
  return url;
}

export async function loadPlaygroundContentFromUrl(page: Page, url: string): Promise<void> {
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await page.getByRole("menuitem", { name: "Load content from URL" }).click();
  const dialog = page.getByRole("dialog", { name: "Load content from URL" });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.locator("input").fill(url);
  await dialog.getByRole("button", { name: "Load", exact: true }).click();
  await expect(page.getByText("Content loaded successfully")).toBeVisible({ timeout: 30_000 });
}

/** beta Editor Settings 内 combobox 顺序：Font Size → Tab Size → Font Family（`header.tsx`）。 */
const PLAYGROUND_SETTINGS_COMBO_INDEX: Record<string, number> = {
  "Font Size": 0,
  "Tab Size": 1,
  "Font Family": 2,
};

const PLAYGROUND_SETTINGS_LS_KEY: Record<"Show line numbers" | "Word wrap", string> = {
  "Show line numbers": "playground.lineNumber",
  "Word wrap": "playground.wordWrap",
};

async function openPlaygroundEditorSettingsDialog(page: Page): Promise<Locator> {
  const dialog = page.getByRole("dialog", { name: "Editor Settings" });
  if (await dialog.isVisible().catch(() => false)) {
    return dialog;
  }
  const settingsBtn = page.getByRole("button", { name: "Settings", exact: true });
  await settingsBtn.scrollIntoViewIfNeeded();
  await settingsBtn.click();
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  return dialog;
}

async function dismissPlaygroundSelectPopup(page: Page, dialog: Locator): Promise<void> {
  // 勿用 Escape：beta Base UI Dialog 会把整个 Editor Settings 关掉。
  await dialog.getByRole("heading", { name: "Editor Settings" }).click();
  await page.waitForTimeout(200);
}

async function clickPlaygroundSelectOption(page: Page, optionText: string): Promise<void> {
  const escaped = optionText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const option = page
    .getByRole("option", { name: optionText, exact: true })
    .or(page.getByRole("listbox").last().getByText(optionText, { exact: true }))
    .or(page.locator('[data-slot="select-item"]').filter({ hasText: new RegExp(`^${escaped}$`) }))
    .first();
  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click();
}

async function pickPlaygroundSelectOption(
  page: Page,
  fieldLabel: string,
  optionText: string,
): Promise<void> {
  const dialog = await openPlaygroundEditorSettingsDialog(page);
  const index = PLAYGROUND_SETTINGS_COMBO_INDEX[fieldLabel];
  if (index === undefined) {
    throw new Error(`Unknown playground settings field: ${fieldLabel}`);
  }
  const trigger = dialog
    .getByRole("combobox")
    .nth(index)
    .or(dialog.locator('[data-slot="select-trigger"]').nth(index))
    .first();
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  const current = ((await trigger.textContent()) ?? "").trim();
  if (current.includes(optionText)) {
    return;
  }
  await trigger.click();
  await clickPlaygroundSelectOption(page, optionText);
  await expect(trigger).toContainText(optionText, { timeout: 10_000 });
  await dismissPlaygroundSelectPopup(page, dialog);
}

async function readPlaygroundSettingBool(page: Page, lsKey: string): Promise<boolean | null> {
  return page.evaluate((key) => {
    try {
      const raw = globalThis.localStorage.getItem(key);
      return raw === null ? null : JSON.parse(raw) === true;
    } catch {
      return null;
    }
  }, lsKey);
}

/** iipe `header.tsx`：`id="line-numbers"` / `id="word-wrap"`；beta 界面仅 2 个 checkbox（`nth(0)` / `nth(1)`）。 */
async function setPlaygroundCheckbox(
  page: Page,
  labelText: "Show line numbers" | "Word wrap",
  checked: boolean,
): Promise<void> {
  const dialog = await openPlaygroundEditorSettingsDialog(page);
  const lsKey = PLAYGROUND_SETTINGS_LS_KEY[labelText];
  const stored = await readPlaygroundSettingBool(page, lsKey);
  if (stored === checked) {
    return;
  }
  const checkboxId = labelText === "Show line numbers" ? "line-numbers" : "word-wrap";
  const cb = dialog
    .getByRole("checkbox", { name: labelText, exact: true })
    .or(dialog.locator(`#${checkboxId}`))
    .or(dialog.getByRole("checkbox").nth(labelText === "Show line numbers" ? 0 : 1))
    .first();
  await expect(cb).toBeVisible({ timeout: 15_000 });
  await cb.click();
  await expect
    .poll(async () => await readPlaygroundSettingBool(page, lsKey), { timeout: 10_000 })
    .toBe(checked);
}

/** 打开 Settings → 改项 → 点 Close（`header.tsx` / Base UI Dialog）。 */
export async function applyPlaygroundEditorSettings(
  page: Page,
  settings: {
    fontSize?: string;
    tabSize?: string;
    showLineNumbers?: boolean;
    wordWrap?: boolean;
  },
): Promise<void> {
  if (settings.fontSize) {
    await pickPlaygroundSelectOption(page, "Font Size", settings.fontSize);
  }
  if (settings.tabSize) {
    await pickPlaygroundSelectOption(page, "Tab Size", settings.tabSize);
  }
  if (settings.showLineNumbers !== undefined) {
    await setPlaygroundCheckbox(page, "Show line numbers", settings.showLineNumbers);
  }
  if (settings.wordWrap !== undefined) {
    await setPlaygroundCheckbox(page, "Word wrap", settings.wordWrap);
  }

  const dialog = page.getByRole("dialog", { name: "Editor Settings" });
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  }
}

export async function readPlaygroundEditorSettings(page: Page): Promise<{
  fontSize: number;
  tabSize: number;
  lineNumber: boolean;
  wordWrap: boolean;
}> {
  return page.evaluate(() => {
    const readBool = (key: string, fallback: boolean): boolean => {
      try {
        const raw = globalThis.localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw) === true;
      } catch {
        return fallback;
      }
    };
    const readNum = (key: string, fallback: number): number => {
      try {
        const raw = globalThis.localStorage.getItem(key);
        return raw === null ? fallback : Number(JSON.parse(raw));
      } catch {
        return fallback;
      }
    };
    return {
      fontSize: readNum("playground.fontSize", 14),
      tabSize: readNum("playground.tabSize", 2),
      lineNumber: readBool("playground.lineNumber", true),
      wordWrap: readBool("playground.wordWrap", false),
    };
  });
}
