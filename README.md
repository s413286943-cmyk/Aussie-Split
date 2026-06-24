# Aussie Chill

澳洲旅行两对夫妻共享站点：

- `/itinerary`：旅行杂志感行程页，含每日安排、图片、链接和天气。
- `/`、`/expenses`、`/add`、`/settlement`：split bill 账本。

机票不纳入账本；默认每笔费用两对夫妻 50/50，按币种分别结算。

## 本地运行

```bash
npm run dev
```

默认访问码是 `aussie`。上线时可以在 Vercel 里设置 `NEXT_PUBLIC_TRIP_CODE` 改成自己的访问码。

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

不配置 Supabase 时，网页会用浏览器本机保存，适合先试用。

上线共享时：

1. 新建 Supabase project。
2. 在 SQL editor 执行 `supabase/schema.sql`。
3. 创建 Storage bucket：`receipts`。
4. 在 Vercel 环境变量中设置：
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_TRIP_CODE`

## 验证

```bash
npm test
npm run build
```

核心测试覆盖：初始 10 条、不含机票、多币种分开结算、双方付款抵扣、银行短信生成待确认草稿、D0-D16 行程导入、资源链接引用、天气 fallback。
