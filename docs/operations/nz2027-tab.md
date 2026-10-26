# 澳新 2027（首页）

2026-10-25 起，打开网站首页就是澳新 2027；澳洲 2026 的行程和分账账本收在首页底部“已结束的旅行”里，页面、数据和行为都没变（`/itinerary`、`/ledger` 等原地址照旧可用）。

2027 有四个页面，底部用“日程 / 清单 / 记账 / 更新”切换：

- `/`：日程。今天（出发前是第一天）放在最上面，下面是还没办的事、每晚住哪儿、按阶段排列的 17 天、出行提示、住宿和免费取消时间。`/nz2027` 会跳到这里。
- `/nz2027/checklist`：出发前清单。逐项打勾划掉，两部手机同步。
- `/nz2027/ledger`：两人记账。不分摊，按原币种（NZD / CNY / AUD）分别累计已付和待付，按城市、按天汇总，可导出表格。
- `/nz2027/updates`：更新。最近的改动按时间倒序、按天分组：两部手机上记账（新增 / 修改 / 删除 / 恢复）和勾清单，加上行程调整说明。上次打开之后有新改动时，tab 上显示数字。

每日主题图：把图片按 `d01.jpg` … `d17.jpg`（封面 `cover.jpg`）放进 `public/nz2027/`，运行 `npm run nz2027:import` 即可；prompt 见 `docs/nz2027-day-image-prompts.md`。

## 数据完全分开

| 内容 | 2026 原有 | 2027 新 tab |
|---|---|---|
| 行程源文件 | `content/aussie-itinerary.xlsx` → `src/data/itinerary.generated.json` | `content/nz2027-itinerary.xlsx` → `src/data/nz2027-itinerary.generated.json` |
| 行程接口 | `/api/itinerary` | `/api/nz2027/itinerary` |
| 账本接口 | `/api/sync`、`/api/activity` | `/api/nz2027/expenses`、`/api/nz2027/checklist`、`/api/nz2027/updates`（只读） |
| 数据库 | `expenses`、`expense_activity` 等 | 新表 `nz2027_expenses`、`nz2027_checklist`、`nz2027_activity` + 函数 `nz2027_upsert_expense`、`nz2027_set_check` 和两个记录触发器 |
| 浏览器本机存储 | IndexedDB `aussie-chill-v2` | localStorage `nz2027-ledger-v1`、`nz2027-checklist-v1`、`nz2027-itinerary-v1`、`nz2027-updates-v1`、`nz2027-updates-seen` |

两个 tab 共用同一个访问码和登录会话。

行程更新：改 `scripts/nz2027/itinerarySeedData.mjs` 后运行 `npm run nz2027:seed -- --force` 和 `npm run nz2027:import`；或直接改 Excel 后只运行 `npm run nz2027:import`。**每次行程调整上线，在 `content/nz2027-updates.json` 最上面加一条说明**（`id`、`at`、`title`、`items`，旅行者口吻），它会出现在“更新”页。记账和清单的改动不用手写，数据库触发器自动记录，直接在生产库写入的也会记上。

## 更新记录迁移（待在生产执行）

`supabase/migrations/20261026090000_create_nz2027_activity.sql`，只新增：

- 新表 `public.nz2027_activity`，开启 RLS；service_role 只能 `select`，不能写、改、删。
- 触发器 `nz2027_expenses_activity`、`nz2027_checklist_activity`（security definer 函数 `nz2027_log_expense`、`nz2027_log_check`）：每次记账新增 / 改动 / 删除 / 恢复、清单勾选 / 取消各记一行；过期写入和值没变的重发不记。
- 回填一次：每条现有记账按最新状态记一行，已勾选的清单项各记一行。
- 不改 `nz2027_expenses`、`nz2027_checklist` 的数据，不碰 2026 表。重复执行安全。

执行顺序：网页先上线也可以，记录表不存在时“更新”页只显示行程调整，并提示记账和清单改动暂时读不到；执行迁移后自动有。执行前照例做只读快照。

回退：`supabase/rollback/drop_nz2027_activity.sql` 只删记录表、触发器和函数，账本和清单不受影响。

## 数据库迁移（2026-10-25 已在生产执行，版本 20261025110407）

`supabase/migrations/20261025090000_create_nz2027_ledger.sql`，只新增：

- 新表 `public.nz2027_expenses`，开启 RLS；先撤销 Supabase 默认给 anon / authenticated / service_role 的全部权限，再只给 service_role `select, insert, update`（不给 delete，删除是软删除）。
- 新函数 `public.nz2027_upsert_expense(jsonb)`：后写覆盖先写；拒绝无效币种和超过当前时间 5 分钟的时间戳；只有 service_role 能执行。
- 新表 `public.nz2027_checklist` 和函数 `public.nz2027_set_check(jsonb)`：清单勾选状态，同样后写覆盖先写、只有 service_role 能读写。
- 10 条已订费用作为初始记录：CNY 待付 ¥1,962.74；NZD 已付 NZ$1,546.31、待付 NZ$1,454.87。
- 不修改任何现有表、函数、权限、RLS 或数据。重复执行安全。

已执行：执行前做了只读快照（`.backups/20261025T110211Z-before-nz2027/`，不进仓库），执行后核对 10 条初始记录、清单表、权限和 RLS，旧表的行数、内容指纹、权限和函数定义都与快照一致。

执行顺序（供以后重建环境参考）：迁移和网页部署谁先都可以。网页先上线时，2027 账本和清单会显示“已存在手机上，联网后同步”，记录和勾选留在手机里；迁移执行后会自动补同步。建议先执行迁移再部署，这样初始记录和两人之间的勾选一开始就能同步。

回退：`supabase/rollback/drop_nz2027_ledger.sql` 删除新表和函数，会永久删除 2027 账本记录；先在页面导出 CSV。2026 数据不受影响。

## 已验证

- 本机临时 PostgreSQL 17（模拟 Supabase 默认权限）：迁移执行两次、权限、RPC 新增 / 过期写入 / 非法币种 / 未来时间、2026 表和函数前后一致、回退，全部通过。
- 生产 Supabase 和 Vercel 均未连接、未修改。
