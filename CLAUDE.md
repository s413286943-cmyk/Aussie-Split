# Aussie-Split（澳新 2027 行程与两人记账；澳洲 2026 分账存档）

Next.js 应用：同源 API、服务端密钥、私有票据短期签名 URL、离线优先的本机存储与同步。远端 `s413286943-cmyk/Aussie-Split`，以 `main` 为准。正式站 https://aussie-split.vercel.app。

## 页面

- **澳新 2027（首页）**：`/` 日程、`/nz2027/checklist` 出发前清单、`/nz2027/ledger` 两人记账（`/nz2027` 跳到首页）。说明见 `docs/operations/nz2027-tab.md`。
- **澳洲 2026（已结束，存档）**：`/itinerary`、`/ledger`、`/expenses`、`/add`、`/settlement`、`/activity`，收在首页底部“已结束的旅行”。页面、数据和行为保持不变。

## 运行版本与检查

- Node 24（`package.json` `engines` 为 `24.x`，`.nvmrc` 为 24）。本机默认 Node 26 加载失败，先 `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`。
- `npm ci` → `npm test` → `npm run lint` → `npm run build` → `npm run test:e2e`
- `test:e2e` 只跑本地构建 + mock API，可放心运行。**不要运行 `test:e2e:production`**，除非用户本轮明确要求线上冒烟。
- 7 个数据库集成测试在没有 `AUSSIE_TEST_PG*` 环境变量时跳过，属正常；要跑就用临时、隔离的本地 PostgreSQL 17，用完删除。本机启动时要 `export LC_ALL=C LANG=C`（否则 postmaster 报 multithreaded 退出），并用 `-c listen_addresses=127.0.0.1 -c unix_socket_directories=''` 走 TCP。

## 不可破坏的约束

- **2027 业务模型**：两人共同记账，不分摊；NZD / CNY / AUD 按原币种分别累计已付和待付，不换算合并。机票价格监控（Codex 那边）的数据不要导入这里。
- **2026 业务模型**：两对同行者，按币种分别结算，两组各 50%，机票排除在共享账目外。旧页面、旧表和旧行为不改。
- **两次旅行的数据完全分开**：2027 用 `nz2027_*` 表、`/api/nz2027/*` 接口、localStorage `nz2027-*` 键；2026 用 `expenses` / `expense_activity` 等表、`/api/sync`、IndexedDB `aussie-chill-v2`。只共用访问码和登录会话。
- 只在服务端配置 `TRIP_CODE`、`SESSION_SECRET`、`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`；不沿用旧 README 的公开密钥方案。
- 不对现存生产库重跑初始化 schema / seed。新迁移只做新增，执行前先做只读快照（`.backups/`，不进仓库）。
- 部署顺序：先保护 API，再收紧数据库。改部署前读 `docs/operations/deploy-and-rollback.md`。
- 2027 面向用户的文字一律用旅行者视角，不出现开发、数据库、规划者口吻（有 e2e 断言）。
- 账本完整分页修复（PR #2）已合并，不要重做。

## 内容更新

- **2027 行程**：改 `scripts/nz2027/itinerarySeedData.mjs` 后 `npm run nz2027:seed -- --force` 再 `npm run nz2027:import`；或直接改 `content/nz2027-itinerary.xlsx` 后只跑 `npm run nz2027:import`。清单条目的 `todo_id` 是勾选状态的主键，改文字可以，不要改 id。
- **2027 每日主题图**：`public/nz2027/d01.jpg` … `d17.jpg`、`cover.jpg`，换图后跑 `npm run nz2027:import`。prompt 在 `docs/nz2027-day-image-prompts.md`。
- **2026 行程**：`content/aussie-itinerary.xlsx` 用 `npm run itinerary:import` 导入。

## 生产环境

- **Supabase**：项目 `ycbkpkqrucukyyfjphiu`（`aussie-split-bill`，ap-southeast-2）。已应用迁移：`20260710080657 shared_ledger_compatibility`、`20260711134547 private_receipts`、`20260711134644 lock_down_shared_ledger`、`20261025110407 create_nz2027_ledger`（仓库文件 `20261025090000_create_nz2027_ledger.sql`）。
- **Vercel**：团队 `silhouette2`，只有项目 `aussie-split`，从 `main` 自动部署生产。重复项目 `aussie-split-bill`（无服务端密钥、无法登录）已于 2026-10-25 删除。
- Vercel MCP 连接器对 `silhouette2` 返回 403；只读查询改用本机 CLI：`node $(readlink -f /opt/homebrew/bin/vercel) …`（在 Node 24 下运行）。

## 本地工作副本

主目录在最新 `main`。以下旧分支只在本机、未推到 GitHub，按用户要求只用最新版本，**保留但不在其上继续开发，也不要删除**：`codex/aussie-reliability-hardening`、`.worktrees/reliability-implementation`、`.worktrees/deploy-d13-d15`、`/Users/SeanSun/Documents/Aussie/.codex-worktrees/protected-recovery`。`feat/nz-2027-ledger-schedule` 已经合并（PR #3）。未跟踪的 `outputs/` 和带 ` 2.sql` 的重复 migration / rollback 文件保留，先比较再处理。

## 状态（2026-10-26）

`main` = `origin/main` `c8dc40b`（PR #9 合并），已部署生产 `dpl_3nFeRV2BWY3L82Kx5sDiVQYm9bEv`；线上只读检查和 `test:e2e:production` 冒烟通过，未登录时数据接口返回 401，公开页面和脚本不含私密行程内容。

近期合并：
- PR #3 上线 2027 首页，#4 更新本文件，#5 换成沉浸式深色界面。
- PR #6 写入已订机票、南岛租车、悉尼三晚。
- PR #8 按日落时间安排每天傍晚（悉尼 20:00、南岛 21:00 前后、奥克兰 20:18），加 Kelvin 半岛、Diamond Lake、Moke Lake 等；写明租车合同禁开 Glenorchy–Paradise Road。
- PR #9 取消 Te Anau 萤火虫洞和 Hobbiton 普通话团，2/15 改为 Klook Waitomo + Hobbiton 一日团（06:00–17:30），去掉导航11；清单 25 项。

Node 24 下 354 个单测（含 7 个数据库测试，在 PR #8 上全部通过；PR #9 未改 SQL，跑 347 个、跳过数据库测试），lint、tsc、build 通过，32 个本地 e2e 全部通过。

生产账本 `nz2027_expenses` 共 14 条，有效 13 条：
- 2026-10-25 补记南航往返 ¥16,800、NZ224+JQ296 ¥3,153、租车 ¥3,636（均已付），悉尼 Great Southern 改为三晚 ¥2,027.36 待付；备份在 `.backups/20261025-before-booking-ledger/`。
- 2026-10-26 Hobbiton 普通话团 NZ$260 全额退款，标记删除；新增 Klook 一日团 ¥3,138（已付）；备份在 `.backups/20261026-before-klook-ledger/`。
- 合计：CNY 已付 ¥26,727、待付 ¥2,628.79；NZD 已付 NZ$1,286.31、待付 NZ$1,454.87。

待办：
- `aussie-split` 还留着旧的 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`，代码已不用，可在 Vercel 删除。
