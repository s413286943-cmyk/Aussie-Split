# Aussie Chill

澳洲旅行两对夫妻共享站点：

- `/itinerary`：旅行杂志感行程页，含每日安排、图片、链接和天气。
- `/`、`/expenses`、`/add`、`/settlement`：split bill 账本。

机票不纳入账本；默认每笔费用两对夫妻 50/50，按币种分别结算。

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

账本通过受保护的同源 API 访问 Supabase。本机 IndexedDB 会保存账本、待同步操作和待上传小票；断网时可继续记账，恢复网络后自动重试。

## 行程快捷更新

行程不需要后台管理，内容由 Excel 维护：

1. 修改 `content/aussie-itinerary.xlsx`。
2. 重新生成网页数据：

```bash
npm run itinerary:import
```

3. 本地检查：

```bash
npm run build
```

4. 提交并部署到 Vercel。

如果需要重新生成初始 Excel，可运行：

```bash
npm run itinerary:seed
```

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

核心测试覆盖：多币种结算、已分摊排除、服务端访问控制、RLS 迁移和回退、幂等同步、离线新增/编辑/删除/撤销、私密小票上传与清理、备份导入、D0-D16 行程导入、桌面/手机裁切、资源链接和天气 fallback。
