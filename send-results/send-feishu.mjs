#!/usr/bin/env node
/** 飞书自定义机器人 https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot
 * Webhook：默认自 **`common/global-setup.ts`** 中的 **`FEISHU_WEBHOOK_URL_DEFAULT`**（脚本启动时解析）；可用环境变量 **`FEISHU_WEBHOOK_URL`** 覆盖。**不支持签名校验**。
 * 报告链接：可选 `node send-results/send-feishu.mjs <报告URL>`（有 URL 时发 **interactive** 卡片，带「打开报告」按钮；摘要正文不再含可点击 URL 行）。
 * 摘要 JSON：固定 `test-results/e2e-results.json`。
 * **被测网站 URL**：环境变量 **`E2E_BASE_URL`**（未设置时读 **`common/global-setup.ts`** 的 **`E2E_BASE_URL_DEFAULT`**）用于 **卡片 header 副标题**；摘要正文不再写「被测网站:…」与「--- 报告摘要 ---」。测 `localhost:3000` 时请先 `export E2E_BASE_URL=…` 再跑 `run.mjs`（子进程会继承）。
 * **场景范围（run-scope）**：`run.mjs` 使用 **`--scope-file`** 时注入 **`E2E_SCOPE_FILE`**。摘要含 **场景汇总**；有报告 URL 的 **interactive** 卡片用飞书 **`table`** 展示「场景｜功能点」（首列 **约 40%**、次列 **约 60%**，随卡片宽度伸缩，避免固定 px 在窄端占满挤压功能点；**左对齐**、**顶对齐**，**`row_height: auto`** + **`row_max_height`** 以免多行功能点被默认 124px 裁切；**`msg_type: text`** 或无 scope 场景数据时仍可用 **GFM 表**（`| :--- | :--- |`）。多行功能点用 **`<br/>`** 换行（无额外空行）；每条功能点后附 **运行时间**（与 HTML 报告一致，取自 Playwright JSON **`results` 末条**的 **`duration`**，如 **`20.2s`** / **`1.2m`**）。第二列着色；第一列场景汇总色：**有红则红**、**全灰则灰**、**否则绿**。**无报告 URL** 时为 **`msg_type: text`**。**失败（场景级）** = 该文件下至少一条用例为 failed/timedOut/interrupted。
 * **飞书 `code=11232` 频率限制**：自动退避重试（默认最多 **6** 次发送，可用 **`FEISHU_WEBHOOK_MAX_ATTEMPTS`** 覆盖，上限 12）。 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseScopeToOrderedSceneIds } from "../common/parse-run-scope.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

/** 由仓库根目录 `run.mjs` 传入线上报告 URL；单独跑 `pnpm run report:feishu` 时可省略。 */
const CLI_REPORT_URL = (process.argv[2] ?? "").trim();

const MAX_BODY_BYTES = 18_000;

/**
 * 从 `common/global-setup.ts` 解析单行默认值（须保持 `const *_DEFAULT = "…";` 格式）。
 * @returns {{ feishuWebhook: string, e2eBaseUrl: string }}
 */
function readDefaultsFromGlobalSetupTs() {
  const p = path.join(REPO_ROOT, "common", "global-setup.ts");
  if (!fs.existsSync(p)) {
    return { feishuWebhook: "", e2eBaseUrl: "" };
  }
  const text = fs.readFileSync(p, "utf8");
  // 必须匹配「整行源码」：若用全局 .match，会误命中 JSDoc 反引号里的示例 `const … = "https://...";`，得到 `https://…` 进而 DNS 解析主机名 `...`（ENOTFOUND）。
  const feishuWebhook =
    text
      .match(/^\s*const\s+FEISHU_WEBHOOK_URL_DEFAULT\s*=\s*"(https:\/\/[^"]+)"\s*;\s*$/m)?.[1]
      ?.trim() ?? "";
  const e2eBaseUrl =
    text
      .match(/^\s*const\s+E2E_BASE_URL_DEFAULT\s*=\s*"(https?:\/\/[^"]+)"\s*;\s*$/m)?.[1]
      ?.trim() ?? "";
  return { feishuWebhook, e2eBaseUrl };
}

const _gs = readDefaultsFromGlobalSetupTs();

const FEISHU_WEBHOOK_URL = (process.env.FEISHU_WEBHOOK_URL ?? "").trim() || _gs.feishuWebhook;
if (!FEISHU_WEBHOOK_URL) {
  console.error(
    "未配置飞书 Webhook：请设置环境变量 FEISHU_WEBHOOK_URL，或确认 common/global-setup.ts 中存在单行 `const FEISHU_WEBHOOK_URL_DEFAULT = \"https://...\";`。",
  );
  process.exit(1);
}
const PLAYWRIGHT_JSON = path.join(REPO_ROOT, "test-results", "e2e-results.json");
const POST_TITLE = "Reaslab test";

/** Playwright JSON 中标识「一个测试文件」的 suite.title（相对仓库根的 `test/NN-*.test.ts`）。 */
const TEST_FILE_TITLE_RE = /^test\/\d{2}-.+\.(test|spec)\.[cm]?[jt]sx?$/i;

/** 与 `common/global-setup.ts` 中 `E2E_BASE_URL` / `E2E_BASE_URL_DEFAULT` 对齐；仅用于飞书文案。 */
const E2E_BASE_URL_DISPLAY = (
  (process.env.E2E_BASE_URL ?? "").trim() || _gs.e2eBaseUrl
).replace(/\/+$/, "");
if (!E2E_BASE_URL_DISPLAY) {
  console.error(
    "未解析被测网站 URL：请设置环境变量 E2E_BASE_URL，或确认 common/global-setup.ts 中存在单行 `const E2E_BASE_URL_DEFAULT = \"https://...\";`。",
  );
  process.exit(1);
}

function loadPlaywrightReportObject() {
  const jsonPath = PLAYWRIGHT_JSON;
  if (!fs.existsSync(jsonPath)) {
    return { path: jsonPath, data: null };
  }
  try {
    return { path: jsonPath, data: JSON.parse(fs.readFileSync(jsonPath, "utf8")) };
  } catch {
    return { path: jsonPath, data: null, broken: true };
  }
}

/** 仅当 `run.mjs` 注入 **`E2E_SCOPE_FILE`** 时读取 scope 文件，返回与 **`run.mjs`** 一致的**执行顺序**场景号列表（见 **`common/parse-run-scope.mjs`**）。 */
function loadScopeOrderedSceneIds() {
  const fromEnv = (process.env.E2E_SCOPE_FILE ?? "").trim();
  if (!fromEnv) {
    return [];
  }
  const tryPath = path.isAbsolute(fromEnv) ? fromEnv : path.join(REPO_ROOT, fromEnv);
  if (!fs.existsSync(tryPath)) {
    return [];
  }
  try {
    return parseScopeToOrderedSceneIds(fs.readFileSync(tryPath, "utf8"), {
      testDir: path.join(REPO_ROOT, "test"),
    });
  } catch {
    return [];
  }
}

/** Playwright JSON 根 suite 的 title 多为相对路径如 `test/01-playground.test.ts`，飞书摘要里省略该段。 */
function stripLeadingTestFileFromTitle(full) {
  const sep = " › ";
  const i = full.indexOf(sep);
  if (i === -1) {
    return full;
  }
  const first = full.slice(0, i).trim();
  if (!/\.(test|spec)\.[cm]?[jt]sx?$/i.test(first)) {
    return full;
  }
  const rest = full.slice(i + sep.length).trim();
  return rest || full;
}

function normalizeSuiteTitle(t) {
  return String(t ?? "")
    .trim()
    .replace(/\\/g, "/");
}

/** 从 `test/01-x.test.ts › …` 前缀链取所属测试文件路径。 */
function programKeyFromWalkName(fullName) {
  if (!fullName) {
    return null;
  }
  const sep = " › ";
  const i = fullName.indexOf(sep);
  const first = (i === -1 ? fullName : fullName.slice(0, i)).trim();
  return TEST_FILE_TITLE_RE.test(first) ? first : null;
}

/** `test/NN-*.test.ts` 基名 → 飞书概要括号内短名（如 `13-project-list`）。 */
function shortSlugFromTestPath(fileKey) {
  const base = path.basename(fileKey).replace(/\.(test|spec)\.[cm]?[jt]sx?$/i, "");
  return base || fileKey;
}

function sortedSceneIdsFromProgramMap(programMap) {
  const ids = [];
  for (const k of programMap.keys()) {
    const m = /^test\/(\d{2})-/i.exec(k);
    if (m) {
      ids.push(m[1]);
    }
  }
  return [...new Set(ids)].sort();
}

function findProgramFileKeyForSceneId(sceneId, programMap) {
  const prefix = `test/${sceneId}-`;
  for (const k of programMap.keys()) {
    if (k.startsWith(prefix)) {
      return k;
    }
  }
  return null;
}

/** 失败用例行已含顶层 describe 时，去掉与场景标题重复的前缀 `标题 › `。 */
function stripLeadingProgramHeadingFromCaseTitle(title, programHeading) {
  const t = String(title ?? "").trim();
  const h = String(programHeading ?? "").trim();
  if (!t || !h) {
    return t;
  }
  const prefix = `${h} › `;
  if (t.startsWith(prefix)) {
    return t.slice(prefix.length).trim() || t;
  }
  return t;
}

/** 每条用例最多列出的功能点条数（超出则提示见 HTML）。 */
const MAX_FEATURE_ROWS_PER_PROGRAM = 40;

/**
 * Playwright JSON **`TestResult.duration`**（毫秒）→ 与 HTML 报告相近的 **`25.7s`** / **`1.2m`** / **`1.5h`**。
 * @param {number | null | undefined} ms
 * @returns {string} 无法格式化时为空串。
 */
function formatPlaywrightLikeDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) {
    return "";
  }
  if (n >= 3_600_000) {
    return `${(n / 3_600_000).toFixed(1)}h`;
  }
  if (n >= 60_000) {
    return `${(n / 60_000).toFixed(1)}m`;
  }
  return `${(n / 1000).toFixed(1)}s`;
}

/**
 * 按 `test/NN-*.test.ts` 收集各功能点标题与结果色类（与 Playwright JSON suite 树一致）。
 * @returns {Map<string, { programHeading: string | null, items: { title: string, tone: "red" | "green" | "grey", flaky: boolean, durationMs: number | null }[] }>}
 */
function collectFeaturePointsByProgramFile(data) {
  /** @type {Map<string, { programHeading: string | null, items: { title: string, tone: "red" | "green" | "grey", flaky: boolean, durationMs: number | null }[] }>} */
  const map = new Map();
  function ensure(key) {
    if (!map.has(key)) {
      map.set(key, { programHeading: null, items: [] });
    }
    return map.get(key);
  }
  function walk(suite, prefix, fileKeyInherit) {
    const segment = normalizeSuiteTitle(suite.title);
    const name = [prefix, segment].filter(Boolean).join(" › ");
    let fileKey = fileKeyInherit;
    if (segment && TEST_FILE_TITLE_RE.test(segment)) {
      fileKey = segment;
      const bucket = ensure(fileKey);
      if (!bucket.programHeading && Array.isArray(suite.suites)) {
        for (const child of suite.suites) {
          const t = normalizeSuiteTitle(child.title);
          if (t && !TEST_FILE_TITLE_RE.test(t)) {
            bucket.programHeading = t;
            break;
          }
        }
      }
    } else if (!fileKey) {
      fileKey = programKeyFromWalkName(name);
    }
    for (const spec of suite.specs || []) {
      const specTitle = spec.title || "";
      for (const test of spec.tests || []) {
        const results = test.results || [];
        const last = results[results.length - 1];
        if (!last || !fileKey) {
          continue;
        }
        const bucket = ensure(fileKey);
        const status = last.status;
        const durationMs = typeof last.duration === "number" && Number.isFinite(last.duration) ? last.duration : null;
        const full = [name, specTitle].filter(Boolean).join(" › ");
        let label = stripLeadingTestFileFromTitle(full || specTitle || "(未命名用例)");
        label = stripLeadingProgramHeadingFromCaseTitle(label, bucket.programHeading);
        if (status === "skipped") {
          bucket.items.push({ title: label, tone: "grey", flaky: false, durationMs });
        } else if (status === "failed" || status === "timedOut" || status === "interrupted") {
          bucket.items.push({ title: label, tone: "red", flaky: false, durationMs });
        } else if (status === "passed") {
          const flaky =
            results.length > 1 &&
            results.slice(0, -1).some((r) =>
              r.status === "failed" || r.status === "timedOut" || r.status === "interrupted",
            );
          bucket.items.push({ title: label, tone: "green", flaky, durationMs });
        } else {
          bucket.items.push({ title: label, tone: "grey", flaky: false, durationMs });
        }
      }
    }
    for (const child of suite.suites || []) {
      walk(child, name, fileKey);
    }
  }
  for (const root of data.suites || []) {
    walk(root, "", null);
  }
  return map;
}

/** 摘要单行展示：换行压成空格；过长截断；`|` 换成全角 `｜` 以免被误读为表格列。 */
function sanitizeMarkdownTableCell(s, maxLen) {
  let x = String(s ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "｜")
    .replace(/[ \t\f\v]+/g, " ")
    .trim();
  if (maxLen > 0 && x.length > maxLen) {
    x = `${x.slice(0, Math.max(0, maxLen - 1))}…`;
  }
  return x || "—";
}

/** 卡片 `<font>` 内文案：防断标签、防拆表列。 */
function escapeInnerForFeishuFont(s, maxLen) {
  let x = String(s ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/</g, "＜")
    .replace(/>/g, "＞")
    .replace(/\|/g, "｜")
    .replace(/&/g, "＆")
    .replace(/[ \t\f\v]+/g, " ")
    .trim();
  if (maxLen > 0 && x.length > maxLen) {
    x = `${x.slice(0, Math.max(0, maxLen - 1))}…`;
  }
  return x || "—";
}

/** Playwright `stats.startTime`（UTC ISO）→ 东八区墙钟，便于飞书阅读。 */
function formatStatsStartTimeBeijing(startTime) {
  const raw = String(startTime ?? "").trim();
  if (!raw) {
    return "";
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    return raw;
  }
  const local = d.toLocaleString("sv-SE", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
  return `${local.replace("T", " ")}（北京时间，UTC+8）`;
}

/** @param {{ title: string, tone: "red" | "green" | "grey", flaky: boolean, durationMs: number | null }} item */
function wrapFeatureLineForCard(item) {
  const t = escapeInnerForFeishuFont(item.title, 240);
  let inner;
  if (item.tone === "red") {
    inner = `<font color='red'>${t}</font>`;
  } else if (item.tone === "grey") {
    inner = `<font color='grey'>${t}</font>`;
  } else {
    inner = `<font color='green'>${t}</font>`;
  }
  const dur = item.durationMs != null ? formatPlaywrightLikeDuration(item.durationMs) : "";
  if (dur) {
    inner += `<font color='grey'> · ${escapeInnerForFeishuFont(dur, 24)}</font>`;
  }
  if (item.flaky) {
    inner += "<font color='grey'>（不稳）</font>";
  }
  return inner;
}

/**
 * 第一列「场景」颜色：有失败（红）→红；功能点全未执行（全灰）→灰；否则（含全成功或绿+灰）→绿。
 * @param {{ programHeading: string | null, items: { title: string, tone: "red" | "green" | "grey", flaky: boolean, durationMs: number | null }[] }} entry
 * @returns {"red" | "green" | "grey"}
 */
function scenarioRollupToneFromItems(entry) {
  const items = entry?.items;
  if (!items || items.length === 0) {
    return "grey";
  }
  if (items.some((it) => it.tone === "red")) {
    return "red";
  }
  if (items.every((it) => it.tone === "grey")) {
    return "grey";
  }
  return "green";
}

/** 卡片表首列场景名着色（内文已转义）。 */
function wrapScenarioTitleForCard(heading, tone) {
  const escaped = escapeInnerForFeishuFont(heading, 280);
  if (tone === "red") {
    return `<font color='red'>${escaped}</font>`;
  }
  if (tone === "grey") {
    return `<font color='grey'>${escaped}</font>`;
  }
  return `<font color='green'>${escaped}</font>`;
}

/** 纯文本模式下场景行前缀，与 `scenarioRollupToneFromItems` 一致。 */
function plainScenarioPrefixFromTone(tone) {
  if (tone === "red") {
    return "[失败] ";
  }
  if (tone === "grey") {
    return "[未执行] ";
  }
  return "[成功] ";
}

function plainTagForFeatureItem(item) {
  if (item.tone === "red") {
    return "[失败]";
  }
  if (item.tone === "grey") {
    return "[跳过]";
  }
  if (item.flaky) {
    return "[成功·不稳]";
  }
  return "[成功]";
}

/** 纯文本摘要：功能点标题后附耗时（与卡片一致）。 */
function plainDurationSuffix(item) {
  const dur =
    item.durationMs != null && Number.isFinite(item.durationMs)
      ? formatPlaywrightLikeDuration(item.durationMs)
      : "";
  return dur ? ` · ${dur}` : "";
}

/**
 * 功能点列：行内 `<font color>` 着色；多条之间仅用 **`<br/>`** 换行（不插入空行）。
 * @param {{ programHeading: string | null, items: { title: string, tone: "red" | "green" | "grey", flaky: boolean, durationMs: number | null }[] }} entry
 */
function buildFeatureColumnMarkdownInline(entry) {
  const { items } = entry;
  if (items.length === 0) {
    return "<font color='grey'>—（无执行记录）</font>";
  }
  const cap =
    items.length > MAX_FEATURE_ROWS_PER_PROGRAM
      ? items.slice(0, MAX_FEATURE_ROWS_PER_PROGRAM)
      : items;
  const lines = cap.map((it) => wrapFeatureLineForCard(it));
  const omitted = items.length - cap.length;
  const suffix =
    omitted > 0
      ? `<br/><font color='grey'>（另 ${omitted} 条见 HTML 报告）</font>`
      : "";
  return `${lines.join("<br/>")}${suffix}`;
}

/**
 * 飞书卡片 Markdown（JSON 2.0）支持 GFM 表；**勿**用 `<center>`（会原样显示）。
 * 列对齐：`| :--- | :--- |` → 两列左对齐（用于纯文本 Webhook 等无 **`table`** 组件时）。
 * @param {{ heading: string, entry: { programHeading: string | null, items: { title: string, tone: "red" | "green" | "grey", flaky: boolean, durationMs: number | null }[] } }[]} scenarioRows
 */
function buildProgramSummaryMarkdownTable(scenarioRows) {
  const lines = [
    "| 场景 | 功能点 |",
    "| :--- | :--- |",
  ];
  for (const { heading, entry } of scenarioRows) {
    const tone = scenarioRollupToneFromItems(entry);
    const col1 = wrapScenarioTitleForCard(heading, tone);
    const col2 = buildFeatureColumnMarkdownInline(entry);
    lines.push(`| ${col1} | ${col2} |`);
  }
  return lines.join("\n");
}

/**
 * 与 `formatPlaywrightSummary` 中 `N > 0` 分支一致：按 scope / JSON 得到有序场景行。
 * @param {object} data Playwright JSON
 * @returns {{ scenarioRows: { heading: string, entry: { programHeading: string | null, items: { title: string, tone: "red" | "green" | "grey", flaky: boolean, durationMs: number | null }[] } }[], N: number, failedProg: number } | null}
 */
function computeScenarioBlock(data) {
  if (!data || typeof data !== "object") {
    return null;
  }
  const scopeSceneIds = loadScopeOrderedSceneIds();
  const featureMap = collectFeaturePointsByProgramFile(data);
  const fromJson = sortedSceneIdsFromProgramMap(featureMap);
  const sceneIdsOrdered =
    scopeSceneIds.length > 0 ? [...scopeSceneIds].sort() : fromJson.length > 0 ? fromJson : [];
  const N = sceneIdsOrdered.length;
  if (N <= 0) {
    return null;
  }
  /** @type {{ heading: string, entry: { programHeading: string | null, items: { title: string, tone: "red" | "green" | "grey", flaky: boolean, durationMs: number | null }[] } }[]} */
  const scenarioRows = [];
  let failedProg = 0;
  for (const sceneId of sceneIdsOrdered) {
    const key = findProgramFileKeyForSceneId(sceneId, featureMap);
    const rawEntry = key ? featureMap.get(key) : undefined;
    const entry = rawEntry ?? { programHeading: null, items: [] };
    const shortName = key ? shortSlugFromTestPath(key) : sceneId;
    const heading =
      (entry.programHeading && String(entry.programHeading).trim()) ||
      `${sceneId}（${shortName}）`;
    if (entry.items.some((it) => it.tone === "red")) {
      failedProg++;
    }
    scenarioRows.push({ heading, entry });
  }
  return { scenarioRows, N, failedProg };
}

/**
 * 飞书卡片 JSON 2.0 **`table`**：列宽与顶对齐可控，比 GFM 表更易压缩首列与行内留白。
 * @param {{ heading: string, entry: { programHeading: string | null, items: { title: string, tone: "red" | "green" | "grey", flaky: boolean, durationMs: number | null }[] } }[]} scenarioRows
 */
function buildFeishuProgramSummaryTableElement(scenarioRows) {
  const n = scenarioRows.length;
  const pageSize = Math.min(10, Math.max(1, n));
  const rows = scenarioRows.map(({ heading, entry }) => {
    const tone = scenarioRollupToneFromItems(entry);
    return {
      scenario: wrapScenarioTitleForCard(heading, tone),
      features: buildFeatureColumnMarkdownInline(entry),
    };
  });
  return {
    tag: "table",
    element_id: "e2e_summary_tbl",
    margin: "2px 0px 0px 0px",
    page_size: pageSize,
    // auto：行高随第二列多行内容增高；须配合 row_max_height，否则默认 max 124px 会裁切出单元格内滚动条（见飞书 table 文档）
    row_height: "auto",
    row_max_height: "999px",
    header_style: {
      text_align: "left",
      text_size: "normal",
      background_style: "none",
      text_color: "default",
      bold: true,
      lines: 1,
    },
    columns: [
      {
        name: "scenario",
        display_name: "场景",
        width: "40%",
        data_type: "markdown",
        vertical_align: "top",
        horizontal_align: "left",
      },
      {
        name: "features",
        display_name: "功能点",
        width: "60%",
        data_type: "markdown",
        vertical_align: "top",
        horizontal_align: "left",
      },
    ],
    rows,
  };
}

/** 场景色图例：卡片 markdown 仅对「红/绿/灰」上色；`-失败 / -成功 / -未执行` 为默认字色。`msg_type: text` 时用纯文本。 */
function scenarioColorLegendLine(htmlLegend) {
  if (htmlLegend === false) {
    return "红色-失败，绿色-成功，灰色-未执行";
  }
  // 仅「红/绿/灰」二字上色；「-失败 / -成功 / -未执行」保持默认色（用户可读语义、不整段染色）
  return (
    "<font color='red'>红色</font>-失败，<font color='green'>绿色</font>-成功，<font color='grey'>灰色</font>-未执行"
  );
}

/**
 * @param {object | null} data
 * @param {{ failureTable?: boolean, nativeFeishuTable?: boolean, htmlLegend?: boolean }} [options]
 *   `failureTable` 为 `true` 时用表格式摘要；`nativeFeishuTable` 为 `true` 时**不**写入 GFM 表（由卡片 **`table`** 组件单独渲染，仅在有报告 URL 的 interactive 路径使用）。
 *   `htmlLegend` 为 `false` 时图例不用 HTML 着色（用于纯文本 Webhook）。
 */
function formatPlaywrightSummary(data, options = {}) {
  const failureTable = options.failureTable === true;
  const nativeFeishuTable = options.nativeFeishuTable === true;
  if (!data || typeof data !== "object") {
    return null;
  }
  const parts = [];
  const block = computeScenarioBlock(data);

  if (block) {
    const { scenarioRows, N, failedProg } = block;
    const successProg = N - failedProg;
    parts.push(
      `场景汇总：成功 **${successProg}** 个，失败 **${failedProg}** 个（共 **${N}** 个）`,
    );
    parts.push(scenarioColorLegendLine(options.htmlLegend));
    if (failureTable && !nativeFeishuTable) {
      parts.push(buildProgramSummaryMarkdownTable(scenarioRows));
    } else if (!failureTable) {
      for (const { heading, entry } of scenarioRows) {
        const tone = scenarioRollupToneFromItems(entry);
        parts.push(
          `场景：${plainScenarioPrefixFromTone(tone)}${sanitizeMarkdownTableCell(heading, 100)}`,
        );
        if (entry.items.length === 0) {
          parts.push("  （无执行记录）");
        } else {
          for (const it of entry.items) {
            const tag = plainTagForFeatureItem(it);
            const line = escapeInnerForFeishuFont(it.title, 200);
            parts.push(`  ${tag} ${line}${plainDurationSuffix(it)}`);
          }
        }
        parts.push("");
      }
    }
  } else if (data.stats && typeof data.stats === "object") {
    const s = data.stats;
    const passed = Number(s.expected) || 0;
    const failed = Number(s.unexpected) || 0;
    const skipped = Number(s.skipped) || 0;
    const flaky = Number(s.flaky) || 0;
    const totalOutcomes = passed + failed + skipped + flaky;
    parts.push(
      `（未解析到按文件分组的场景列表）功能点（全 run）共 ${totalOutcomes} 条：通过 ${passed}，失败 ${failed}，跳过 ${skipped}，不稳定 ${flaky}`,
    );
  }

  if (data.stats && typeof data.stats === "object") {
    const s = data.stats;
    const durationMs = s.duration;
    const dur =
      typeof durationMs === "number" && Number.isFinite(durationMs)
        ? `${(durationMs / 1000).toFixed(1)}s`
        : "—";
    parts.push(`执行耗时: ${dur}`);
    if (s.startTime) {
      parts.push(`测试时间：${formatStatsStartTimeBeijing(s.startTime)}`);
    }
    const passed = Number(s.expected) || 0;
    const failed = Number(s.unexpected) || 0;
    const skipped = Number(s.skipped) || 0;
    if (skipped > 0 && passed === 0 && failed === 0) {
      parts.push("说明: 通过 0 且有跳过，多为项目列表无行，或主线用例中 test.skip（如新建项目不可用等）。");
    }
  }

  if (Array.isArray(data.errors) && data.errors.length > 0) {
    parts.push(`执行错误 ${data.errors.length} 条（节选）:`);
    for (const err of data.errors.slice(0, 5)) {
      const line = String(err.message ?? err.error ?? "")
        .split("\n")[0]
        .trim()
        .slice(0, 280);
      if (line) {
        parts.push(`  · ${escapeInnerForFeishuFont(line, 400)}`);
      }
    }
  }

  if (parts.length === 0) {
    return null;
  }
  return parts.join("\n");
}

/**
 * @param {{ failureTable?: boolean, htmlLegend?: boolean }} [options] 与 `formatPlaywrightSummary` 的 `failureTable` / `htmlLegend` 一致。
 */
function buildPlainText(options = {}) {
  const { path: jsonPath, data, broken } = loadPlaywrightReportObject();
  const summary = data ? formatPlaywrightSummary(data, options) : null;
  if (summary) {
    return summary;
  }
  if (broken) {
    return `（无法解析 JSON：${jsonPath}）`;
  }
  return `（未找到 ${jsonPath}；请先执行 Playwright 生成报告，例如 pnpm exec playwright test --config common/playwright.config.ts）`;
}

function truncateText(text, reserveBytes) {
  let s = text;
  while (Buffer.byteLength(s, "utf8") > reserveBytes && s.length > 1) {
    s = s.slice(0, Math.floor(s.length * 0.9));
  }
  return s;
}

/** 卡片正文已用受控 `<font>` 与内文转义；此处仅统一换行，勿再全局替换 `<`，否则会破坏着色标签。 */
function finalizeFeishuCardMarkdownBody(s) {
  return String(s ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

/**
 * 飞书同一 `markdown` 块里长表格易把后续「执行耗时」等挤在一起；在 `\n执行耗时:` 处拆成两段，第二段单独组件以落在表下。
 * 须与 `formatPlaywrightSummary` 中 `执行耗时:` 文案保持一致。
 */
function splitMarkdownForStatsBelowTable(raw) {
  const s = String(raw ?? "");
  const idx = s.search(/\n执行耗时:/);
  if (idx < 0) {
    return [s];
  }
  const head = s.slice(0, idx).trimEnd();
  const tail = s.slice(idx + 1).trimStart();
  if (!tail) {
    return [s];
  }
  return [head, tail];
}

/**
 * 自定义机器人 Webhook：`msg_type: interactive` + 卡片 JSON 2.0（与官方示例一致）。
 * @param {string | null | undefined} markdownBody
 * @param {object | null | undefined} feishuTableElement 场景汇总表；插在首段 Markdown 之后、统计段 Markdown 之前。
 * @see https://open.feishu.cn/document/feishu-cards/quick-start/send-message-cards-with-custom-bot?lang=zh-CN
 */
function buildInteractiveCardPayload(reportUrl, markdownBody, feishuTableElement = null) {
  const chunks = splitMarkdownForStatsBelowTable(markdownBody.trim() || "测试已完成");
  /** @type {object[]} */
  const markdownElements = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    markdownElements.push({
      tag: "markdown",
      content: finalizeFeishuCardMarkdownBody(chunk.length > 0 ? chunk : "\u00a0"),
      text_align: "left",
      text_size: "normal_v2",
      margin: i === 0 ? "0px 0px 0px 0px" : "8px 0px 0px 0px",
    });
    if (i === 0 && feishuTableElement) {
      markdownElements.push(feishuTableElement);
    }
  }
  const sub = sanitizeMarkdownTableCell(E2E_BASE_URL_DISPLAY, 120);
  return {
    msg_type: "interactive",
    card: {
      schema: "2.0",
      config: {
        update_multi: true,
        style: {
          text_size: {
            normal_v2: {
              default: "normal",
              pc: "normal",
              mobile: "heading",
            },
          },
        },
      },
      body: {
        direction: "vertical",
        padding: "12px 12px 12px 12px",
        elements: [
          ...markdownElements,
          {
            tag: "button",
            text: { tag: "plain_text", content: "打开报告" },
            type: "default",
            width: "default",
            size: "medium",
            behaviors: [
              {
                type: "open_url",
                default_url: reportUrl,
                pc_url: "",
                ios_url: "",
                android_url: "",
              },
            ],
            margin: "0px 0px 0px 0px",
          },
        ],
      },
      header: {
        title: { tag: "plain_text", content: POST_TITLE },
        subtitle: { tag: "plain_text", content: sub },
        template: "blue",
        padding: "12px 12px 12px 12px",
      },
    },
  };
}

function buildPayload() {
  const reportUrl = CLI_REPORT_URL;

  if (reportUrl) {
    const { data } = loadPlaywrightReportObject();
    const summaryMd = data
      ? formatPlaywrightSummary(data, { failureTable: true, nativeFeishuTable: true })
      : null;
    const rawMarkdown = summaryMd ?? buildPlainText({ failureTable: true });
    const block = data ? computeScenarioBlock(data) : null;
    const tableEl =
      block?.scenarioRows?.length && data
        ? buildFeishuProgramSummaryTableElement(block.scenarioRows)
        : null;
    const reserve = tableEl ? 7200 : 5600;
    const md = truncateText(rawMarkdown, Math.max(2048, MAX_BODY_BYTES - reserve));
    return buildInteractiveCardPayload(reportUrl, md, tableEl);
  }

  const truncated = truncateText(
    buildPlainText({ failureTable: false, htmlLegend: false }),
    MAX_BODY_BYTES - 512,
  );
  return {
    msg_type: "text",
    content: { text: truncated },
  };
}

function shrinkPayloadIfNeeded(body) {
  const ts = body.timestamp;
  const sg = body.sign;
  const withSign = (partial) =>
    ts !== undefined && sg !== undefined ? { timestamp: ts, sign: sg, ...partial } : partial;
  let b = { ...body };
  let encoded = JSON.stringify(b);
  for (let i = 0; i < 80 && Buffer.byteLength(encoded, "utf8") > MAX_BODY_BYTES; i++) {
    if (b.msg_type === "text" && b.content?.text) {
      const byteBudget = Math.max(256, Math.floor(Buffer.byteLength(b.content.text, "utf8") * 0.85));
      b = withSign({ msg_type: "text", content: { text: truncateText(b.content.text, byteBudget) } });
      encoded = JSON.stringify(b);
      continue;
    }
    if (b.msg_type === "interactive" && Array.isArray(b.card?.body?.elements)) {
      for (const el of b.card.body.elements) {
        if (el?.tag === "markdown" && el.content) {
          const byteBudget = Math.max(
            512,
            Math.floor(Buffer.byteLength(el.content, "utf8") * 0.88),
          );
          el.content = truncateText(el.content, byteBudget);
        }
        if (el?.tag === "table" && Array.isArray(el.rows)) {
          for (const row of el.rows) {
            if (row && typeof row === "object") {
              for (const k of Object.keys(row)) {
                const v = row[k];
                if (typeof v === "string" && v.length > 0) {
                  const byteBudget = Math.max(
                    400,
                    Math.floor(Buffer.byteLength(v, "utf8") * 0.88),
                  );
                  row[k] = truncateText(v, byteBudget);
                }
              }
            }
          }
        }
      }
      b = withSign({ msg_type: "interactive", card: b.card });
      encoded = JSON.stringify(b);
      continue;
    }
    break;
  }
  return b;
}

function explainFeishuError(body) {
  const c = body.code ?? body.StatusCode;
  const m = body.msg ?? body.StatusMessage ?? "";
  const hints = {
    19002: "请求体缺少 msg_type 或格式不对",
    19021: "签名校验失败（本脚本不发送签名；请在飞书机器人安全设置中关闭签名校验）",
    19022: "IP 不在白名单",
    19024: "未命中自定义关键词（请检查飞书机器人关键词设置与正文）",
    9499: "请求体 Bad Request，对照官方 msg_type 示例",
    11232: "触发频率限制，稍后再发",
  };
  const hint = hints[c] ? ` — ${hints[c]}` : "";
  return `code=${c} msg=${m}${hint}`;
}

function isFeishuOk(body) {
  return (
    Object.keys(body).length === 0 ||
    body.StatusCode === 0 ||
    body.code === 0 ||
    body.errcode === 0
  );
}

async function postToFeishu(payload) {
  const res = await fetch(FEISHU_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

const core = buildPayload();

async function sendOnce() {
  return postToFeishu(shrinkPayloadIfNeeded(core));
}

/** 自定义机器人偶发 `code=11232` frequency limited；HTTP 仍 200。退避重试以提高定时 job 送达率。 */
function isFeishuFrequencyLimited(body) {
  const c = body?.code ?? body?.StatusCode;
  return c === 11232;
}

async function sendWith11232Backoff() {
  const maxAttempts = Number.parseInt(process.env.FEISHU_WEBHOOK_MAX_ATTEMPTS ?? "6", 10);
  const safeMax = Number.isFinite(maxAttempts) && maxAttempts >= 1 ? Math.min(maxAttempts, 12) : 6;
  let last = await sendOnce();
  for (let attempt = 1; attempt < safeMax; attempt++) {
    if (last.res.ok && isFeishuOk(last.body)) {
      return last;
    }
    if (!isFeishuFrequencyLimited(last.body)) {
      return last;
    }
    const waitMs = Math.min(120_000, 30_000 * attempt);
    console.warn(
      `飞书 frequency limited (code=11232)，${waitMs / 1000}s 后重试 (${attempt}/${safeMax - 1})…`,
    );
    await new Promise((r) => setTimeout(r, waitMs));
    last = await sendOnce();
  }
  return last;
}

const { res, body } = await sendWith11232Backoff();
const ok = res.ok && isFeishuOk(body);

if (!ok) {
  const extra =
    body.code === 19021
      ? "（请在飞书自定义机器人「安全设置」中关闭签名校验。）"
      : body.code === 11232
        ? "（多次重试后仍频率限制：请拉长定时间隔、换 Webhook 或联系飞书侧配额。）"
        : "";
  console.error("飞书返回异常:", res.status, explainFeishuError(body), extra, body);
  process.exit(1);
}

console.log("已发送到飞书:", body.msg ?? body.StatusMessage ?? "success");
