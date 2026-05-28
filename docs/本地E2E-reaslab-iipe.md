# 本地 E2E（结合 reaslab-iipe）

WSL 等环境访问 **`https://beta.reaslab.io`** 时可能出现 **`net::ERR_CONNECTION_CLOSED`** / **`ERR_TIMED_OUT`**（与 Cloudflare、IPv6 有关）。除 **`common/e2e-nav.ts`** 导航重试与 Linux **`--disable-ipv6`** 外，推荐在联调 **`reaslab-iipe`** 时用本机前端跑 **`reaslab-test`**。

## 1. 启动 reaslab-iipe 本地栈

与 **`reaslab-iipe/reaslab-fe/reaslab-ide/tests/e2e/global-setup.ts`** 一致：需本机 **PostgreSQL**（容器名常为 **`reaslab_pg`**）及后端 API 可用。

```bash
# 示例：在 reaslab-iipe 仓库按你们现有文档启动 DB + BE + FE
cd /path/to/reaslab-iipe/reaslab-fe/reaslab-ide
pnpm install
pnpm dev   # 默认 http://127.0.0.1:3000
```

确保浏览器能打开 **`http://127.0.0.1:3000/unauthenticated/login`**。

## 2. 测试账号

**`reaslab-test`** 的 **`common/global-setup.ts`** 默认使用 **`reaslabTest@proton.me`**（与 beta 一致）。本地库中须存在该用户且邮箱已验证，或先在本地完成一次注册/导入。

**`reaslab-iipe`** 自带 E2E 用户为 **`e2e-test@reaslab.test`**（见 **`tests/e2e/global-setup.ts`**），与 **`reaslab-test`** 默认账号**不同**；本地跑 **`reaslab-test`** 时请沿用 **`reaslabTest@proton.me`** 或自行在 DB 中创建等价账号。

## 3. 跑 reaslab-test（指向本地）

```bash
cd /path/to/reaslab-test
export E2E_BASE_URL=http://127.0.0.1:3000
pnpm run test:15:headed
# 或
pnpm run test:16:headed
```

本地 origin **不会**注入 **`x-testing-auth`**（见 **`isLocalE2EOrigin()`**）。

## 4. 仍测 beta 时

```bash
# 默认即 beta；无需设置 E2E_BASE_URL
pnpm run test:15:headed
```

若仍频繁断连，可检查网络/代理，或改用上一节的本地 **`E2E_BASE_URL`**。
