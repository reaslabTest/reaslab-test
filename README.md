# reaslab-test

在仓库根目录 **`reaslab-test`** 下执行（例如 `/home/root/code/reaslab-test`）。

目录职责、E2E 主流程与 Mermaid 图见 **`docs/测试程序.md`** 开头的 **「架构」** 一节。

## 安装依赖（首次或依赖变更后）

```bash
pnpm install
```

（会安装 Playwright Chromium 等。）

## 运行 E2E

所有命令均基于 **`common/playwright.config.ts`**（`testDir` 为仓库根；**`globalSetup`** 在跑用例前执行一次登录并写入 **`common/.auth/storage-state.json`**）。

WSL 访问 beta 若出现 **`ERR_CONNECTION_CLOSED`**，见 **`docs/本地E2E-reaslab-iipe.md`**（推荐 **`export E2E_BASE_URL=http://127.0.0.1:3000`** 联调 **`reaslab-iipe`** 本地前端）；导航已含 **`common/e2e-nav.ts`** 重试，本地非 CI 用例默认 **`retries: 1`**。

约定：**无后缀** = 无头 Chromium；**`:headed`** = 有界面（等价于再给 Playwright 传 **`--headed`**）。

### 1）完整链路（Playwright → Vercel 报告 → 飞书）

入口 **`run.mjs`**：先按 **`common/run-scope-beta.txt`**（**`common/parse-run-scope.mjs`**：两列 **`脚本名<TAB>执行顺序`**，章节号由 **`test/NN-<slug>.test.ts`** 反查；**`-1`** 最后跑）解析出有序章节号并跑对应用例（**`pnpm run reaslab-test`**），再上传 **`playwright-report`** 并通知飞书；**用例失败也会继续发报告**。默认**退出码**反映测试是否通过（以及后续 Vercel / 飞书是否成功）。定时 workflow 使用 **`pnpm run reaslab-test -- --exit-zero-on-e2e-failure`**，使 **`run.mjs`** 收到 **`--exit-zero-on-e2e-failure`** 时**始终以 0 退出**——各用例绿/红仍体现在 **HTML 报告**（及 Vercel 若部署成功）；飞书在能发时仍会发。

| 目的 | 命令 |
|------|------|
| 按 **`common/run-scope-beta.txt`** 列 **`脚本名<TAB>执行顺序`**（见 **`common/parse-run-scope.mjs`**）+ 报告 + 飞书；**测挂则非 0**（编辑该文件即可改跑哪些用例；环境变量 **`E2E_SCOPE_FILE`** 可覆盖列表路径） | `pnpm run reaslab-test` |

### 2）单个测试程序

命名规则：**`test:<编号>`**——源文件以 **两位数字** 开头，与场景章节编号一致（如 `01-playground.test.ts` → **`test:01`**，`05-blankModeling.test.ts` → **`test:05`**）；有界面再加 **`:headed`**。

| 文件 | 无头 | 有界面 |
|------|------|--------|
| `test/01-playground.test.ts` | `pnpm run test:01` | `pnpm run test:01:headed` |
| `test/02-signup.test.ts` | `pnpm run test:02` | `pnpm run test:02:headed` |
| `test/03-loginOut.test.ts` | `pnpm run test:03` | `pnpm run test:03:headed` |
| `test/04-account-settings.test.ts` | `pnpm run test:04` | `pnpm run test:04:headed` |
| `test/05-blankModeling.test.ts` | `pnpm run test:05` | `pnpm run test:05:headed` |
| `test/06-import-git.test.ts`（长耗时） | `pnpm run test:06` | `pnpm run test:06:headed` |
| `test/07-optimizationTemplateModeling.test.ts` | `pnpm run test:07` | `pnpm run test:07:headed` |
| `test/08-theoremTemplateMil.test.ts` | `pnpm run test:08` | `pnpm run test:08:headed` |
| `test/09-modelingContestTemplate.test.ts` | `pnpm run test:09` | `pnpm run test:09:headed` |
| `test/10-feedback.test.ts` | `pnpm run test:10` | `pnpm run test:10:headed` |
| `test/11-footer-links.test.ts` | `pnpm run test:11` | `pnpm run test:11:headed` |
| `test/12-latex.test.ts` | `pnpm run test:12` | `pnpm run test:12:headed` |
| `test/13-project-list.test.ts` | `pnpm run test:13` | `pnpm run test:13:headed` |
| `test/14-browse-templates.test.ts` | `pnpm run test:14` | `pnpm run test:14:headed` |
| `test/15-reaslingo-home.test.ts` | `pnpm run test:15` | `pnpm run test:15:headed` |

新增 **`test/`** 下的测试文件时，请在 **`package.json`** 按 **`test:<编号>`** 补成对脚本（无头 + `:headed`），`playwright` 命令里写路径如 **`test/05-foo.test.ts`**。

