# Aussie-Split（澳洲行程与分账）

Next.js 应用：同源 API、服务端密钥、私有票据短期签名 URL、IndexedDB 离线账本与上传队列。页面 `/`、`/itinerary`、`/ledger`、`/expenses`、`/add`、`/settlement`。远端 `s413286943-cmyk/Aussie-Split`，以 `main` 为准。

## 运行版本与检查

- Node 24（`package.json` `engines` 为 `24.x`，`.nvmrc` 为 24）。本机默认 Node 26，先 `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`。
- `npm ci` → `npm test` → `npm run lint` → `npm run build` → `npm run test:e2e`
- `test:e2e` 只跑本地构建 + mock API，可放心运行。**不要运行 `test:e2e:production`**，除非用户本轮明确要求线上冒烟。
- 6 个数据库相关单测在无数据库时跳过，属正常。

## 不可破坏的约束

- 业务模型：两对同行者，按币种分别结算，两组各 50%，机票排除在共享账目外。不要与 2027 年两成人澳新机票监控的数据混用。
- 只在服务端配置 `TRIP_CODE`、`SESSION_SECRET`、`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`；不沿用旧 README 的公开密钥方案。
- 不对现存生产库重跑初始化 schema / seed。行程原表 `content/aussie-itinerary.xlsx` 用 `npm run itinerary:import` 导入。
- 部署顺序：先保护 API，再收紧数据库。改部署前读 `docs/operations/deploy-and-rollback.md`。
- 账本完整分页修复（PR #2）已合并，不要重做。

## 本地工作副本

主目录已切到最新 `main`。以下旧分支只在本机、未推到 GitHub，按用户要求只用最新版本，**保留但不在其上继续开发，也不要删除**：`codex/aussie-reliability-hardening`、`.worktrees/reliability-implementation`、`.worktrees/deploy-d13-d15`、`/Users/SeanSun/Documents/Aussie/.codex-worktrees/protected-recovery`。未跟踪的 `outputs/` 和带 ` 2.sql` 的重复 migration / rollback 文件保留，先比较再处理。

## 状态（2026-10-21）

`main` = `origin/main` `9e5524d`；Node 24 下 318 单测通过 / 6 跳过，lint、build 通过，23 个本地 e2e 全部通过。正式域名与所属 Vercel 账户未重新核实。
