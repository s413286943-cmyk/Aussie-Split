# Aussie Chill Split Bill

澳洲旅行两对夫妻 split bill 账本。机票不纳入本账本；默认每笔费用两对夫妻 50/50，按币种分别结算。

## 本地运行

```bash
npm run dev
```

默认访问码是 `aussie`。上线时可以在 Vercel 里设置 `NEXT_PUBLIC_TRIP_CODE` 改成自己的访问码。

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

核心测试覆盖：初始 10 条、不含机票、多币种分开结算、双方付款抵扣、银行短信生成待确认草稿。
