/**
 * 解析 **`common/`** 下 scope 列表文件（如 **`run-scope-beta.txt`** / **`run-scope-test.txt`**；与 **`run.mjs`**、**`send-feishu.mjs`** 共用）。
 *
 * - **两列（Tab）**：`脚本名<TAB>执行顺序`。脚本名与 **`test/NN-<slug>.test.ts`** 中的 **`<slug>`** 一致（如 **`playground`**）；章节号由 **`options.testDir`** 下文件名反查。**执行顺序**为整数，**`-1` 表示最后执行**。
 * - **无 Tab**：整行仅由章节号与空白组成（如 `01 05`），顺序规则同前。
 *
 * 同一章节号出现两次 → **抛错**。返回值为**去重后**按执行顺序排列的章节号数组。
 *
 * @param {string} raw 文件全文
 * @param {{ testDir?: string }} [options] 含 Tab 的数据行须传 **`testDir`**（一般为仓库根下 **`test`** 的绝对路径）。
 * @returns {string[]} 如 `['01','05','13']`
 */
import { readdirSync } from "node:fs";
import path from "node:path";

/**
 * @param {string} testDirAbs **`test`** 目录绝对路径
 * @param {string} slug **`NN-<slug>.test.ts`** 中的 **`<slug>`**
 */
function chapterIdFromSlug(testDirAbs, slug) {
  const abs = path.resolve(testDirAbs);
  let files;
  try {
    files = readdirSync(abs).filter((f) => /^\d{2}-.+\.test\.ts$/.test(f));
  } catch (e) {
    throw new Error(`run-scope: 无法读取 test 目录 ${abs}: ${/** @type {Error} */ (e).message}`);
  }
  const hit = files.find((f) => {
    const m = f.match(/^(\d{2})-(.+)\.test\.ts$/);
    return m !== null && m[2] === slug;
  });
  if (!hit) {
    throw new Error(
      `run-scope: 未找到与脚本名 "${slug}" 对应的用例（期望 ${abs} 下存在 NN-${slug}.test.ts）`,
    );
  }
  const m = hit.match(/^(\d{2})-/);
  return /** @type {string} */ (m?.[1]);
}

export function parseScopeToOrderedChapterIds(raw, options = {}) {
  const testDir = (options.testDir ?? "").trim();

  /** @type {{ chapterId: string, order: number, seq: number }[]} */
  const entries = [];
  let seq = 0;
  let dataLine = 0;

  for (const line of raw.split(/\r?\n/)) {
    const cut = line.replace(/#.*$/, "").trim();
    if (!cut) {
      continue;
    }
    dataLine += 1;

    if (cut.includes("\t")) {
      const parts = cut
        .split("\t")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (parts.length < 2) {
        throw new Error(`run-scope: 含制表符的行须为两列: "${line.trim()}"`);
      }
      if (parts.length > 2) {
        throw new Error(
          `run-scope: 禁止三列及以上，仅允许「脚本名<TAB>执行顺序」: "${line.trim()}"`,
        );
      }

      const slug = parts[0];
      const orderStr = parts[1];
      if (!/^-?\d+$/.test(orderStr)) {
        throw new Error(`run-scope: 两列时第二列须为整数执行顺序: "${line.trim()}"`);
      }
      const order = Number.parseInt(orderStr, 10);
      if (!Number.isFinite(order)) {
        throw new Error(`run-scope: 非法执行顺序: "${line.trim()}"`);
      }
      if (!testDir) {
        throw new Error(
          'run-scope: 两列「脚本名<TAB>执行顺序」须在 parseScopeToOrderedChapterIds(raw, { testDir }) 中传入 test 目录',
        );
      }
      const chapterId = chapterIdFromSlug(testDir, slug);
      entries.push({ chapterId, order, seq: seq++ });
      continue;
    }

    let col = 0;
    for (const token of cut.split(/\s+/)) {
      if (!/^\d{1,2}$/.test(token)) {
        throw new Error(`run-scope: 非法项 "${token}"（须为 1～99 的章节号，如 01、5）`);
      }
      const n = Number.parseInt(token, 10);
      if (n < 1 || n > 99) {
        throw new Error(`run-scope: 章节号越界 "${token}"`);
      }
      const chapterId = String(n).padStart(2, "0");
      const order = dataLine * 1000 + col;
      col += 1;
      entries.push({ chapterId, order, seq: seq++ });
    }
  }

  if (entries.length === 0) {
    throw new Error("run-scope: 未配置任何章节（文件为空或仅注释）");
  }

  const byChapter = new Map();
  for (const e of entries) {
    if (byChapter.has(e.chapterId)) {
      throw new Error(`run-scope: 章节 ${e.chapterId} 重复出现，请合并为一行`);
    }
    byChapter.set(e.chapterId, e);
  }
  const list = [...byChapter.values()];
  const primary = list.filter((e) => e.order !== -1);
  const lastGroup = list.filter((e) => e.order === -1);
  primary.sort((a, b) => a.order - b.order || a.seq - b.seq);
  lastGroup.sort((a, b) => a.seq - b.seq);
  return [...primary, ...lastGroup].map((e) => e.chapterId);
}
