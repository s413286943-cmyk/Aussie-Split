# 2027 两人行程 tab

2026-10-25 新增。原有的澳洲 2026 行程、两对夫妻分账、成员、结算和全部旧数据保持原样，行为不变。新 tab 在主导航最后一项“2027两人”，有两个页面：

- `/nz2027`：日程。2027/2/1–2/17 每日时间线、住宿、11 段自驾导航（Google Maps 链接）、住宿免费取消截止、付款日期、出发前待办和路线建议。
- `/nz2027/ledger`：两人记账。不分摊，按原币种（NZD / CNY / AUD）分别累计已付和待付，按城市、按天汇总，可导出 CSV。

## 数据完全分开

| 内容 | 2026 原有 | 2027 新 tab |
|---|---|---|
| 行程源文件 | `content/aussie-itinerary.xlsx` → `src/data/itinerary.generated.json` | `content/nz2027-itinerary.xlsx` → `src/data/nz2027-itinerary.generated.json` |
| 行程接口 | `/api/itinerary` | `/api/nz2027/itinerary` |
| 账本接口 | `/api/sync`、`/api/activity` | `/api/nz2027/expenses` |
| 数据库 | `expenses`、`expense_activity` 等 | 新表 `nz2027_expenses` + 函数 `nz2027_upsert_expense` |
| 浏览器本机存储 | IndexedDB `aussie-chill-v2` | localStorage `nz2027-ledger-v1`、`nz2027-itinerary-v1` |

两个 tab 共用同一个访问码和登录会话。

行程更新：改 `scripts/nz2027/itinerarySeedData.mjs` 后运行 `npm run nz2027:seed -- --force` 和 `npm run nz2027:import`；或直接改 Excel 后只运行 `npm run nz2027:import`。

## 需要用户确认的迁移（尚未在生产执行）

`supabase/migrations/20261025090000_create_nz2027_ledger.sql`，只新增：

- 新表 `public.nz2027_expenses`，开启 RLS；先撤销 Supabase 默认给 anon / authenticated / service_role 的全部权限，再只给 service_role `select, insert, update`（不给 delete，删除是软删除）。
- 新函数 `public.nz2027_upsert_expense(jsonb)`：后写覆盖先写；拒绝无效币种和超过当前时间 5 分钟的时间戳；只有 service_role 能执行。
- 10 条已订费用作为初始记录：CNY 待付 ¥1,962.74；NZD 已付 NZ$1,546.31、待付 NZ$1,454.87。
- 不修改任何现有表、函数、权限、RLS 或数据。重复执行安全。

执行顺序：迁移和网页部署谁先都可以。网页先上线时，2027 账本会显示“已本机保存，待同步”，记录留在手机里；迁移执行后点“同步”即可补上。建议先执行迁移再部署，这样初始记录一打开就能看到。

回退：`supabase/rollback/drop_nz2027_ledger.sql` 删除新表和函数，会永久删除 2027 账本记录；先在页面导出 CSV。2026 数据不受影响。

## 已验证

- 本机临时 PostgreSQL 17（模拟 Supabase 默认权限）：迁移执行两次、权限、RPC 新增 / 过期写入 / 非法币种 / 未来时间、2026 表和函数前后一致、回退，全部通过。
- 生产 Supabase 和 Vercel 均未连接、未修改。
