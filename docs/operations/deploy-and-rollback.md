# Aussie Chill Deploy And Rollback

这份清单用于受保护 API、离线账本、私密小票和最终 RLS 加固版本。核心顺序不能交换：**先部署并验证服务端版本，再收紧 Supabase 权限**。

## 1. 上线前检查

确认 Vercel Preview 和 Production 都存在以下仅服务端环境变量：

```text
TRIP_CODE
SESSION_SECRET
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

任何 secret 都不能使用 `NEXT_PUBLIC_` 前缀。`SESSION_SECRET` 应为独立随机值；service-role key 只能存在于服务端环境。

本地验证：

```bash
npm ci
npm test
npm run lint
npm run build
npm run test:e2e
```

行程内容如有更新，还要先运行 `npm run itinerary:import`，并确认生成数据与 `content/aussie-itinerary.xlsx` 一致。

## 2. 创建生产快照

每次迁移前新建 `.backups/<UTC timestamp>/`，至少保存：

- `trips`、`members`、`expenses`、`expense_activity`、`attachments` 全量导出。
- 每张表的行数、费用按币种汇总、草稿数、已分摊数和 tombstone 数。
- public schema 的 grants、RLS 状态和 policies。
- `receipts` bucket 配置、对象清单和 Storage policies。
- 已应用 migration 列表、当前 Vercel deployment id、生产 Git commit。
- 所有导出文件的 SHA-256 manifest。

快照必须只读生成。不要在备份流程中执行 `DELETE`、`TRUNCATE`、`DROP` 或覆盖已有备份目录。

迁移前最低核对 SQL：

```sql
select 'trips' as source, count(*) from public.trips
union all select 'members', count(*) from public.members
union all select 'expenses', count(*) from public.expenses
union all select 'expense_activity', count(*) from public.expense_activity
union all select 'attachments', count(*) from public.attachments;

select currency,
       count(*) filter (where deleted_at is null) as active_rows,
       sum(amount) filter (where deleted_at is null) as active_total,
       count(*) filter (where deleted_at is not null) as tombstones
from public.expenses
group by currency
order by currency;
```

## 3. 部署受保护候选版本

在仍保留旧数据库 bridge 权限时部署候选版本。先验证 Preview，再推广到 Production。

必须完成以下真实浏览器检查：

1. 错误访问码不能进入，正确访问码可以进入。
2. 总览、明细、结算、行程能读取同一份账本。
3. 新增、编辑、确认、删除和 5 秒内撤销都能同步。
4. 点击“待分摊”后变为“已分摊”，当前结算立即扣除该笔金额；再次切回后恢复。
5. 最近操作能显示具体改动，总览只显示 3 条，完整记录在单独页面。
6. 断网后仍可新增和编辑，恢复网络后显示“已同步”。
7. 小票上传、刷新后查看和失败重试都通过受保护 API；浏览器网络中不能出现 Supabase service-role key。
8. 导出备份、预览导入和拒绝损坏备份均正常。
9. 未输入访问码时，HTML 和 `_next/static` 脚本均不能包含真实酒店、Tour、账单或完整行程文字；首次在线解锁后，行程仍能离线重开。

候选版本未通过时停止，不执行数据库迁移。

## 4. 应用 Supabase 迁移

按以下顺序连续执行，不要在两次迁移之间继续使用旧网页：

1. `supabase/migrations/20260710140534_private_receipts.sql`
2. `supabase/migrations/20260711065642_lock_down_shared_ledger.sql`

第二个迁移会在同一事务中：

- 为五张 public 应用表启用 RLS。
- 移除 anon/authenticated 的直接表访问和应用 RPC 权限。
- 只给 service role 保留受保护 API 所需的最小权限。
- 保持 `receipts` 为私密 bucket，并限制为 10 MiB 的受支持图片格式。
- 清理可能开放 receipts 的 Storage policies，同时保留明确属于其他 bucket 的 scoped policy。

迁移包含 Storage RLS guard。guard 不满足时事务会整体回滚，不会留下半加固状态。

## 5. 迁移后验证

立即重复第 3 节的浏览器流程，并核对：

- 快照前后的业务行数、活动数、币种总额一致。
- 直接使用 anon key 访问 public Data API 被拒绝。
- 已登录网页仍可通过同源 `/api/*` 读取和写入。
- `receipts` 仍为 private；查看小票得到短期签名 URL。
- Supabase Security Advisor 不再报告五张应用表 `rls_disabled_in_public`。
- Vercel Function 日志没有 secret、原始访问码或小票签名内容。
- 桌面、手机和第二台设备都能看到同一笔测试修改，随后清除测试数据。

将最终 deployment id、migration 结果、Advisor 结果和备份目录写回生产基线记录。

## 6. 回退路径

### 仅网页版本异常，数据库尚未加固

直接将生产 alias 回退到上一个已验证 deployment。不要改数据库。

### 数据库已加固，受保护 API 无法使用

1. 在 Supabase SQL Editor 执行 `supabase/rollback/restore_legacy_shared_access.sql`。
2. 将 Vercel 回退到兼容 bridge deployment。
3. 验证旧网页可读取、创建和软删除费用，并能新增活动。

紧急 bridge 有意保持受限：

- RLS 仍开启。
- 只临时开放 `expenses` 和 `expense_activity` 的必要 anon/authenticated 操作。
- 不开放物理删除、Storage、attachments、trips、members 或 service-only RPC。
- GET 会隐藏 tombstone；旧版软删除必须使用 `return=minimal`。

恢复服务后应修复受保护版本，重新部署并再次执行最终 lockdown migration。不要把紧急 bridge 当作长期状态。

### 数据内容不一致

停止写入并保留现场。先对比 SHA-256 manifest、表行数、币种总额、mutation version 和 tombstone，再决定逐行恢复。未经确认不要整库覆盖；优先恢复缺失或较新的记录。

## 7. 完成标准

只有以下条件全部满足，才算上线完成：

- 本地单元、集成、lint、build、E2E 全部通过。
- 生产候选在迁移前和迁移后各完成一次真实浏览器回归。
- 生产数据核对无差异，匿名直连已关闭，私密小票可用。
- 紧急 rollback 脚本已在本机 PostgreSQL 验证。
- 最新 backup、deployment id、migration id 和 Git commit 已记录。
