# 澳新 2027 两人账本上线说明

2026-10-25 起，应用从“两对夫妻分账 + 澳洲 2026 行程”改为“两人记账 + 澳新 2027 日程”。本页记录数据库评估、上线顺序和回退。**两个迁移都还没有在生产执行**，生产 Supabase（`ycbkpkqrucukyyfjphiu`）需要用户确认后才动。

## 数据库评估：不删表、不删字段

| 对象 | 处理 | 原因 |
|---|---|---|
| `trips`、`members` | 保留不动 | 只读表，新界面不再读取；删除没有收益，还会破坏现有 lockdown 契约和回退脚本。 |
| `expenses.payer` | 保留，新记录固定 `us` | `apply_expense_operation` 和检查约束要求 `us/them`；改约束要重写 RPC，收益为零。 |
| `expenses.split_settled` | 保留，新记录固定 `false` | 同上；旧记录的值原样保存。 |
| 币种检查 `CNY/AUD` | **需要迁移**：加 `NZD` | 新西兰段大部分费用是纽币，必须按原币种记录。 |
| 2026 澳洲旅行的 13 条旧记录 | 保留不动 | 界面只显示日期在 2026-09-01 及以后（或未填日期）的记录；旧记录仍在数据库、同步快照和备份导出里。 |

## 两个迁移

1. `supabase/migrations/20261025090000_allow_nzd_currency.sql`
   - 把 `expenses`、`expense_activity` 的币种检查改为 `CNY/AUD/NZD`。
   - 在原函数定义上把 `apply_expense_operation` 的两处币种白名单加上 `NZD`（保留 owner、grant 和其它逻辑；若函数已被改动导致白名单不是两处，会整体回滚并报错）。
   - 只放宽检查，不改任何数据、权限或 RLS。旧网页不会发送 NZD，因此可以在部署新网页之前执行。重复执行无副作用。
2. `supabase/migrations/20261025091000_seed_nz2027_bookings.sql`
   - 录入 10 条已订费用，保留原币种：CNY 待付 ¥1,962.74；NZD 已付 NZ$1,546.31、待付 NZ$1,454.87（合计 NZ$3,001.18）。
   - 已付记为 `confirmed`（界面显示“已付”），离店扣款或之后扣款的记为 `draft`（“待付”）。Wānaka、Te Anau 的订金和尾款分成两条。
   - 每条同时写入一条“新增了 …”操作记录。`on conflict do nothing`，重复执行不会重复录入。

## 上线顺序

1. 按 `deploy-and-rollback.md` 第 2 节做一次只读生产快照，记录 13 条旧记录的行数和币种总额。
2. 执行迁移 1（NZD）。核对：旧记录行数、总额不变；`select pg_get_functiondef('public.apply_expense_operation(jsonb)'::regprocedure)` 中出现 `'NZD'`。
3. 部署新网页（先 Preview 验证，再 Production；需要用户本人确认）。
4. 执行迁移 2（已订费用）。**要在新网页上线之后执行**：旧网页把非 AUD 金额都显示成 ¥，还会把这些记录算进分账结算。
5. 浏览器检查：总览显示 NZD/CNY 两张卡片和上面的总额；“按城市”出现 Sydney、Christchurch、Twizel、Wānaka、Te Anau、Queenstown、Auckland；新增一笔 NZD 后显示“已同步”；`/settlement` 跳到 `/summary`。

如果新网页先于迁移 1 上线：数据库拒绝 NZD 写入，同步接口返回 503，NZD 记录会留在本机待同步队列（显示“同步失败，可重试”），不会丢；但同一批里排在后面的其它记录也会一起卡住。执行迁移 1 后自动补同步。所以坚持先迁移 1、再部署。

## 回退

- 只撤回已订费用：`supabase/rollback/remove_nz2027_booking_seed.sql`。把种子记录改成软删除（物理删除被触发器禁止）；已在网页里编辑过的种子记录不动。
- 撤回 NZD：`supabase/rollback/remove_nzd_currency.sql`。只要还有任何 NZD 记录（含软删除）就拒绝执行，先导出并处理这些记录。
- 网页回退：把 Vercel 生产 alias 指回上一个已验证部署。迁移 1 对旧网页无影响；如果迁移 2 已执行，旧网页会把这些 NZD 记录显示成 ¥ 并算进结算，所以回退网页时先执行种子回退。

## 已验证

- 本机临时 PostgreSQL 17：`tests/nzd-migration.integration.test.mjs` 在“基础表 + 兼容迁移”上依次执行两个迁移（各执行两次）、NZD RPC 写入、USD 拒绝、权限不变、旧记录不变、两个回退脚本，全部通过；原有 6 个数据库集成测试同时通过。
- 生产库没有连接、没有查询、没有执行任何语句。
