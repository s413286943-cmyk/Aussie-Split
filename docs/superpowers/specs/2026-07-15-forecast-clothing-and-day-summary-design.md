# Forecast Clothing And Day Summary Design

## Summary

Make the day-card overview easier to trust and scan without changing the itinerary structure.

Two related changes are in scope:

1. When a day is inside the weather API forecast window, generate clothing advice from that day's forecast instead of silently reusing the workbook's seasonal note.
2. Replace each long day-card focus paragraph with one short sentence that describes the day's rhythm. Full stops, bookings, prices, and execution details remain in the existing route chips and expanded timeline.

## Weather Advice

### Source Labels

The clothing line must identify its source explicitly:

- `预报穿衣建议`: generated from the Open-Meteo forecast returned for that date.
- `季节穿衣参考`: the workbook's static `clothingNote`, used outside the forecast window or when live forecast data is unavailable.

The existing weather-state label (`实时天气`, `天气预报`, or `天气参考`) remains unchanged. The new clothing-source label appears with the clothing advice so a traveler can distinguish current forecast guidance from seasonal planning guidance at a glance.

### Forecast Inputs

Extend the existing daily Open-Meteo request with:

- apparent-temperature minimum and maximum;
- maximum wind speed.

Continue using the existing daily temperature minimum/maximum, precipitation probability, UV index, and weather code. For today, current conditions may enrich the summary, but the clothing recommendation should still describe the full day rather than only the temperature at the moment the page was opened.

### Deterministic Clothing Rules

Build one concise base recommendation from the daily apparent-temperature range, falling back to the actual temperature range if apparent temperature is missing:

| Daily apparent minimum | Base recommendation |
|---|---|
| `<= 5°C` | 轻薄羽绒 + 保暖中层 |
| `6–10°C` | 毛衣 / 抓绒 + 防风外套 |
| `11–15°C` | 长袖 + 薄外套 |
| `16–20°C` | 短袖或长袖叠穿，带薄外套 |
| `> 20°C` | 短袖为主 |

Append only forecast-relevant modifiers:

- precipitation probability `>= 50%`: `带防水外层或雨具`;
- maximum wind speed `>= 25 km/h`: `海边优先防风`;
- UV index `>= 6`: `做好防晒`.

Keep the result to one short line. If all three modifiers apply, preserve them in the order rain, wind, UV; do not repeat garments already named in the base recommendation.

### Fallback And Cache

- Keep the current six-hour cache and request deduplication behavior.
- If the forecast request fails, the date is outside the available forecast window, or the required daily temperature range is absent, show the workbook note with `季节穿衣参考`.
- Do not present a static workbook note as a live recommendation.
- Apply the same source label and advice text in both the day card and Today Console.

## Day-Card Focus Copy

The `focus` field remains workbook-backed. Update it in `content/aussie-itinerary.xlsx`, then regenerate `src/data/itinerary.generated.json` through the existing importer.

Each focus line must be one sentence, describe the day's rhythm, and avoid prices, booking-state prose, pickup addresses, and exhaustive stop lists.

| Day | New focus sentence |
|---|---|
| D0 | 经香港转机，夜航前往墨尔本。 |
| D1 | 落地恢复，轻走 CBD；晚间逛 QVM 冬季夜市。 |
| D2 | 蒸汽小火车半日，下午漫步 Fitzroy。 |
| D3 | 机场取车轻装上路，沿海开到 Apollo Bay。 |
| D4 | 穿过雨林走向十二使徒岩，傍晚抵达 Port Campbell。 |
| D5 | 清晨补拍海岸，走内陆线返回墨尔本机场。 |
| D6 | 从冬季飞进热带，傍晚漫步凯恩斯海滨。 |
| D7 | 全天留给大堡礁外礁平台与海上体验。 |
| D8 | 沿丹翠河深入雨林，在 Cape Tribulation 看雨林入海。 |
| D9 | 轻量自驾串联火山湖、巨树、高原小镇与瀑布。 |
| D10 | 逛 Rusty’s Market，休整后去 Palm Cove 看海。 |
| D11 | 飞抵悉尼休息后，经 Barangaroo 走向海港夜景。 |
| D12 | 从歌剧院导览一路步行到花园、经典机位与 QVB。 |
| D13 | 沿 Grand Pacific Drive 南下，串联海崖桥与南海岸小镇。 |
| D14 | 上午看澳洲动物，下午走 Bondi 海岸，晚上吃 Totti’s。 |
| D15 | 早上按状态决定 Manly，下午采购整理，傍晚 Cafe Sydney。 |
| D16 | 完成 TRS 与机场手续，启程回家。 |

Keep the existing focus paragraph styling unless a minimal spacing adjustment is required after the copy becomes shorter. Do not introduce a new card section or decorative label solely for this change.

## Non-Goals

- Do not change day titles, itinerary blocks, route chips, tickets, resources, food recommendations, hotel data, or day order.
- Do not change ledger calculations, splitting, Supabase, receipts, synchronization, offline recovery, or service-worker behavior.
- Do not redesign the day cards or weather strip.
- Do not change forecast providers or add another API.

## Verification

1. Weather unit tests cover each temperature band, rain/wind/UV modifiers, missing-field fallbacks, and explicit advice-source labels.
2. The importer regenerates JSON from the workbook, and all D0–D16 focus strings match the approved table above.
3. Existing tests, lint, and production build pass.
4. Desktop and mobile browser checks confirm:
   - day cards remain compact and readable;
   - forecast days show `预报穿衣建议`;
   - unavailable or out-of-window days show `季节穿衣参考`;
   - Today Console uses the same advice and label;
   - expanded-card layout, checklist, ledger, tickets, and offline behavior are unchanged.
5. After local verification, deploy the exact tested commit and repeat the key checks on the public site.
