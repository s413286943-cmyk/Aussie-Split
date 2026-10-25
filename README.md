# 澳新 2027 · 日程与记账

2027/2/1–2/17 两人（悉尼 + 新西兰南北岛）旅行站点，只有两部分：

- `/`、`/itinerary`：日程。每日时间线、11 段自驾分段导航（Google Maps 链接）、住宿与免费取消截止、付款日期、出发前待办和路线建议。
- `/ledger`、`/expenses`、`/add`、`/summary`、`/activity`：两人共同记账。金额、币种（NZD / CNY / AUD）、类别、日期、备注，按原币种分别累计，可按天和按城市汇总。

不再分账：没有付款方、分摊和结算。数据库仍保留 `payer` / `split_settled` 字段以兼容现有数据，新记录固定写 `us` / `false`。`/settlement` 只做跳转到 `/summary`。2026 年澳洲旅行的旧记录（日期早于 2026-09-01）保留在数据库和备份中，但不在 2027 账本里显示或累计。

## 本地运行

使用 Node.js 24 LTS，并先安装锁定版本的依赖：

```bash
nvm use
npm ci
```

再配置仅服务端可见的环境变量：

```bash
TRIP_CODE=your-shared-code
SESSION_SECRET=your-random-session-secret
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

不要把访问码、session secret 或 service-role key 放进 `NEXT_PUBLIC_*`。

```bash
npm run dev
```

账本和完整行程都通过受保护的同源 API 读取。验证访问码后，行程会在本机缓存；IndexedDB 会保存账本、待同步操作和待上传小票。断网时仍可看行程和继续记账，恢复网络后自动重试。

## 行程快捷更新

行程不需要后台管理，内容由 Excel 维护：

1. 修改 `content/aussie-itinerary.xlsx`（工作表：Trip、Stages、Days、Blocks、Drives、DriveLegs、Lodgings、Todos、Advice、Resources）。
2. 重新生成网页数据：

```bash
npm run itinerary:import
```

3. 本地检查：

```bash
npm run build
```

4. 提交并部署到 Vercel。

这份 Excel 由 `scripts/itinerarySeedData.mjs` 生成（来源：`澳新2027-最终行程与自驾导航-20261025.md`）。改了种子数据后重建 Excel：

```bash
npm run itinerary:seed -- --force
```

2026 澳洲行程的旧 Excel 归档在 `content/archive/aussie-chill-2026-itinerary.xlsx`。

天气使用 Open-Meteo。旅行日期还太远或接口失败时，页面会显示 Excel 里的气候和穿衣提醒。

## Supabase

上线共享时：

1. 新建 Supabase project。
2. 全新项目在 SQL editor 执行 `supabase/schema.sql`。
3. 后续升级按时间顺序执行 `supabase/migrations/` 中未应用的迁移。
4. `schema.sql` / 私密小票迁移会创建并锁定 `receipts` bucket；不要改成 public。
5. 在 Vercel 的 Preview 和 Production 环境设置 `TRIP_CODE`、`SESSION_SECRET`、`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`。

现有项目从兼容 bridge 升级时，必须先部署并验证受保护 API，再依次执行：

1. `20260710140534_private_receipts.sql`
2. `20260711065642_lock_down_shared_ledger.sql`

不要先锁数据库。完整上线、快照和紧急回退顺序见 `docs/operations/deploy-and-rollback.md`。

2027 两人账本需要再执行两个迁移（先 NZD，后录入已订费用），顺序、验证和回退见 `docs/operations/nz2027-two-person-ledger.md`。全新项目在 `schema.sql` 之后也要执行这两个迁移。

浏览器不会持有 Supabase key。小票先写入本机队列，账单同步确认后通过短期签名凭证直传私密 Storage；查看时使用 5 分钟有效的签名链接。

## 验证

```bash
npm test
npm run lint
npm run build
npm run test:e2e
```

`npm run test:e2e` 会构建本地生产版本，使用本机 Chrome 和隔离的同源 API 模拟运行，不会接触线上 Supabase。只读线上冒烟测试需显式运行：

```bash
npm run test:e2e:production
```

核心测试覆盖：多币种分开累计、按天/城市汇总、NZD 迁移和已订费用录入（含回退）、服务端访问控制、RLS 迁移和回退、幂等同步、离线新增/编辑/删除/撤销、私密小票上传与清理、备份导入、D01-D17 行程导入与自驾导航、桌面/手机裁切、资源链接和天气 fallback。
