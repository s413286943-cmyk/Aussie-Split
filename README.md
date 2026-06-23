# Aussie Chill

2026 澳洲旅行共享工作台：今日安排、D0-D16 行程、住宿/待订/预算/美食/活动清单，以及孙张、胡董两对夫妻的 split bill 账本。

## 能做什么

- `今日`：看当天重点、时间段、穿衣提醒和相关清单。
- `行程`：直接改每天的城市、标题、住宿、提醒、备选安排和时间段。
- `清单`：维护住哪里、还要订什么、预算、美食和活动。
- `账本`：继续记录共同垫付，CNY/AUD 分开结算，机票仍不放进本账本。
- `导入新版攻略`：大改动上传 MD，先看新增、会更新、保留不变、可能没识别，再确认导入。

小改动直接在网页里改；整份攻略更新再用 MD 导入。

## 本地运行

```bash
npm run dev
```

默认访问码是 `aussie`。上线时可以在 Vercel 里设置 `NEXT_PUBLIC_TRIP_CODE` 改成自己的访问码。

## 共享保存

不配置 Supabase 时，网页会先保存在当前浏览器里，适合试用。

要让四个人看到同一份内容：

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
npm run lint
npm run build
```

核心检查覆盖：账本计算、孙张/胡董显示、多币种结算、旅行种子内容、MD 导入预览与保守合并、共享内容映射、天气和穿衣提醒。
