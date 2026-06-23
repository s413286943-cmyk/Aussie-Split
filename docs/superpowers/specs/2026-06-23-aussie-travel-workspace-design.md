# Aussie Chill Travel Workspace Design

## Purpose

Expand the existing Aussie Chill Split Bill site into a shared travel workspace for the 2026 Australia trip. The site should still handle split bills, but it should also make the itinerary, bookings, lodging, budget, restaurants, and weather practical to use before and during the trip.

The interface must speak from the traveler's point of view. It should say things like "今天去哪", "还没订", "改时间", "加一个餐厅", and "记一笔". It should not expose developer-facing language such as modules, databases, APIs, CRUD, synchronization, or edit state.

## Confirmed Decisions

- The experience is a full editable travel workspace, not a static guidebook.
- All people who enter the shared trip code can view and edit.
- Edited content is saved to Supabase so the four travelers share one current version.
- The main layout is a hybrid workspace:
  - "今日" for fast trip-day use.
  - "行程" for D0-D16 planning and day-by-day edits.
  - "清单" for lodging, bookings, budget, food, and activity planning.
  - "账本" for the existing split-bill flow.
- Ledger labels use the real couple names:
  - "孙张" for 孙晟 and 张心怡.
  - "胡董" for 胡锦康 and 董瑞欣.
- Weather and clothing guidance should be live when forecast data is available, and fall back to the guide's climate notes when the trip date is still too far away.

## Navigation

The bottom navigation should become:

- 今日
- 行程
- 清单
- 账本

"账本" keeps the current ledger features, with its internal pages reorganized behind the account area as needed. The current "明细", "新增", and "结算" actions can live inside the ledger area instead of occupying every bottom-nav slot.

## Today View

The "今日" page is the first place travelers should open during the trip.

It shows:

- Today's trip day, date, city, and short focus.
- Live weather when available: temperature, rain chance, wind, and UV if available.
- A plain clothing reminder derived from weather and trip notes.
- Today's time blocks.
- Things to bring or remember.
- Related bookings and restaurant ideas.
- Quick actions:
  - 改今天安排
  - 加一个提醒
  - 加一个餐厅
  - 记一笔

If the current date is outside the trip dates, the page shows the next upcoming day before the trip, or the trip summary after the trip.

## Itinerary View

The "行程" page shows D0-D16 as a scannable timeline.

Each day has:

- Day number, date, weekday, city or area.
- Short focus line.
- Lodging for that night.
- Weather or climate reminder.
- Time blocks.
- Tips and backup plans.

Travelers can edit:

- Day title and city.
- Focus line.
- Lodging link or note.
- Each time block's time, place, activity, highlight, and tip.
- Backup plan notes.

Adding and removing time blocks should be available, but deleting should ask for confirmation.

## Lists View

The "清单" page is for organizing all trip material that is not best handled as a single day timeline.

It uses traveler-facing sections:

- 住哪里
- 还要订什么
- 预算心里有数
- 想吃什么
- 活动和门票

Each item can include:

- Name.
- Related day or city.
- Status: 已订好, 还没订, 到时再看.
- Price or budget note when relevant.
- Link or booking note.
- Freeform note.

Travelers can add, edit, and delete items. Delete actions ask for confirmation.

## Markdown Import

Large guide revisions can be made by uploading a new Markdown file instead of changing every item by hand. Small day-to-day changes still happen directly in the website.

User-facing behavior:

- In "清单" or "行程", travelers can choose "导入新版攻略".
- The uploaded file should follow roughly the same structure as the supplied Australia guide: D0-D16 daily sections, lodging, budget, booking list, and food map.
- After upload, the site shows a preview of what will change before anything is saved.
- The preview should use plain wording such as:
  - 新增
  - 会更新
  - 保留不变
  - 可能没识别
- Travelers must confirm before the imported changes replace current trip content.
- The import is for larger guide rewrites. Quick fixes such as changing one restaurant status or adding a short note should remain manual edits.

Merge rules:

- Match days by D-number first, then update that day's title, city, focus, lodging, notes, and time blocks from the Markdown.
- Match list items by section and title when possible.
- Preserve existing statuses such as 已订好, 还没订, 到时再看 when the Markdown does not clearly change them.
- Preserve manual links and notes when the new Markdown has no replacement for those fields.
- Items that cannot be confidently matched should appear under "可能没识别" for review instead of being silently discarded.

## Ledger View

The existing split-bill feature remains, but copy changes to use couple names.

Examples:

- "孙张付款"
- "胡董付款"
- "胡董还需给孙张"
- "孙张还需给胡董"

The calculation behavior stays the same:

- Flights remain outside this ledger.
- Common expenses split 50/50 between the two couples.
- CNY and AUD remain separate.
- Draft expenses can still be created from bank messages and confirmed later.
- Receipts can still be attached when Supabase storage is configured.

## Weather Behavior

Weather should feel like part of the travel guide, not a technical widget.

Rules:

- When live forecast data is available for a day's city, show it in "今日" and day cards.
- When the date is too far away for live forecast data, show the original guide's climate note.
- Keep manual trip notes visible, because they include experience-based guidance such as boat cabins being cold or coastal wind being strong.
- Generate simple clothing reminders from weather plus trip notes.

Example traveler-facing wording:

- "凯恩斯白天热，船上空调可能冷，带薄外套。"
- "海边风大，防风外套比厚毛衣更重要。"
- "有雨，鞋子尽量防水。"

## Saving and Offline Behavior

All editable travel content should save to Supabase when configured.

User-facing behavior:

- Changes should save automatically after the traveler finishes editing.
- After saving, show short wording such as "已保存".
- If the network is unavailable, show the last loaded content from this device and a plain warning such as "现在先显示上次保存的内容".
- The interface should not mention Supabase or internal sync details.

Implementation boundary:

- The app can keep using local browser storage as a fallback cache.
- Supabase remains the shared source when configured.
- The existing shared trip code remains the practical access boundary for this private trip app.

## Initial Content

The first version should seed the travel workspace from the supplied Australia itinerary text:

- D0-D16 overview and daily details.
- Budget summary.
- Activity cost references.
- Confirmed lodging.
- Must-book list.
- Food map.

The seeded content should be structured enough to edit in the app, not stored as one long text blob.

## Out of Scope for First Implementation

- Individual user accounts.
- Per-person edit permissions.
- Real-time multi-user cursors or conflict resolution UI.
- Map routing or turn-by-turn navigation.
- Automatic booking from third-party sites.
- Currency conversion beyond the existing explicit CNY/AUD entries.

## Verification

The implementation plan should include checks for:

- D0-D16 content exists and is navigable.
- Seeded lodging, budget, booking, and food items are present.
- Editable content can be saved and loaded.
- Local fallback works when Supabase is not configured.
- Ledger text uses "孙张" and "胡董" everywhere users see payer or settlement labels.
- Existing ledger calculations still pass.
- Production build succeeds.
- Mobile and desktop browser checks show no overlapping text or unusable controls.
