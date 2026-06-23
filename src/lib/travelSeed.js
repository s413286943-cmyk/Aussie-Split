import { parseTravelMarkdown } from "./travelImport.js";

export const tripItemStatuses = ["已订好", "还没订", "到时再看"];

export const listSections = [
  { kind: "lodging", title: "住哪里" },
  { kind: "booking", title: "还要订什么" },
  { kind: "budget", title: "预算心里有数" },
  { kind: "food", title: "想吃什么" },
  { kind: "activity", title: "活动和门票" },
];

export const sourceGuideMarkdown = `# 🇦🇺 Aussie Chill · 南十字星下的十六日
2026.07.28–08.13｜上海出发｜墨尔本进 · 悉尼出
📸 2对夫妻 · 城市风光 · 海岸自驾 · 大洋路 · 大堡礁 · 热带雨林 · 悉尼南海岸

---

# 🧭 一、行程总览

| Day | 日期 | 城市 / 区域 | 核心安排 | 住宿 |
|-----|------|-------------|----------|------|
| D0 | 7/28 | 上海 → 墨尔本 | 出发 | 飞机 |
| D1 | 7/29 | 墨尔本 | 抵达 + Southbank | Oaks |
| D2 | 7/30 | 墨尔本 | 城市漫步 | 同上 |
| D3 | 7/31 | 大洋路 | 自驾 | Apollo Bay |
| D4 | 8/1 | 大洋路 | 十二使徒 | Port Campbell |
| D5 | 8/2 | 回程 | 回墨尔本机场 | 机场酒店 |
| D6 | 8/3 | 凯恩斯 | 转场 + 夜市 | Cairns |
| D7 | 8/4 | 凯恩斯 | 大堡礁 | 同上 |
| D8 | 8/5 | 丹翠 | 雨林 | 同上 |
| D9 | 8/6 | 阿瑟顿 | 高原 | 同上 |
| D10 | 8/7 | 凯恩斯 | 休息日 | 同上 |
| D11 | 8/8 | 悉尼 | 转场 | Sydney |
| D12 | 8/9 | 悉尼 | 城市地标 | 同上 |
| D13 | 8/10 | 蓝山/南海岸 | 弹性日 | 同上 |
| D14 | 8/11 | 悉尼 | 观鲸+Bondi | 同上 |
| D15 | 8/12 | 悉尼 | Manly+告别 | 同上 |
| D16 | 8/13 | 悉尼 → 上海 | 返程 | - |

---

# 📅 二、每日行程（含拍照点位）

---

## D1｜墨尔本抵达

| 时间 | 地点 | 活动 | 亮点 | 贴士 | 📸拍照点位 |
|------|------|------|------|------|------------|
| 上午 | 机场 → CBD | 入境 | 初到澳洲 | 打车更舒适 | - |
| 下午 | 酒店 | 休息 | 调时差 | 关键恢复 | - |
| 傍晚 | Southbank | 河岸散步 | 夜景 | 放松 | 📍Yarra River倒影 |
| 晚上 | Southbank | 晚餐 | 城市氛围 | 轻松 | 📍河岸灯光 |

---

## D2｜墨尔本城市

| 时间 | 地点 | 活动 | 亮点 | 贴士 | 📸拍照点位 |
|------|------|------|------|------|------------|
| 上午 | State Library / QVM | 图书馆+市场 | 城市文化 | QVM必去 | 📍圆顶阅览室 |
| 中午 | Degraves Lane | Brunch | 咖啡文化 | 不要吃撑 | 📍巷道纵深 |
| 下午 | Hosier Lane / NGV | 涂鸦+展览 | 艺术 | 20min足够 | 📍涂鸦墙 |
| 傍晚 | Southbank / Skydeck | 日落 | 城市高空 | 看天气 | 📍全城夜景 |
| 晚上 | CBD | 晚餐 | 收尾 | 准备自驾 | 📍Flinders夜景 |

---

## D3｜大洋路

| 时间 | 地点 | 活动 | 亮点 | 贴士 | 📸拍照点位 |
|------|------|------|------|------|------------|
| 上午 | Torquay | 出发 | 海岸线起点 | 慢开 | 📍冲浪海岸 |
| 中午 | Lorne | 午餐 | 小镇 | 停留 | 📍海湾 |
| 下午 | Kennett River | 看考拉 | 野生动物 | 抬头找 | 📍桉树林 |
| 晚上 | Apollo Bay | 入住 | 海边小镇 | 轻松 | 📍港口 |

---

## D4｜十二使徒

| 时间 | 地点 | 活动 | 亮点 | 贴士 | 📸拍照点位 |
|------|------|------|------|------|------------|
| 上午 | Maits Rest | 雨林 | 原始森林 | 慢走 | 📍森林步道 |
| 中午 | Twelve Apostles | 海岸 | 地标 | 风大 | 📍观景台 |
| 下午 | Loch Ard Gorge | 峡谷 | 最强点 | 必去 | 📍海蚀洞 |
| 晚上 | Port Campbell | 晚餐 | 小镇 | 安静 | 📍海边 |

---

## D5｜回程

| 时间 | 地点 | 活动 | 亮点 | 贴士 | 📸拍照点位 |
|------|------|------|------|------|------------|
| 上午 | 十二使徒 | 补拍 | 早光 | 最佳光线 | 📍日出海岸 |
| 下午 | Colac | 午餐 | 内陆 | 休息 | - |
| 晚上 | 机场酒店 | 收尾 | 转场 | 早睡 | - |

---

## D6｜凯恩斯

| 时间 | 地点 | 活动 | 亮点 | 贴士 | 📸拍照点位 |
|------|------|------|------|------|------------|
| 下午 | Esplanade Lagoon | 泳池 | 热带感 | 放松 | 📍泻湖 |
| 晚上 | Night Market | 夜市 | 轻松 | 不安排重餐 | 📍夜市灯光 |

---

## D7｜大堡礁（🔥）

| 时间 | 地点 | 活动 | 亮点 | 贴士 | 📸拍照点位 |
|------|------|------|------|------|------------|
| 全天 | Reef Magic | 浮潜 | 珊瑚 | 防晒 | 📍海上平台 |
| 晚上 | Prawn Star | 海鲜 | 必吃 | 轻松 | 📍海港船 |

---

## D8｜丹翠

| 时间 | 地点 | 活动 | 亮点 | 贴士 | 📸拍照点位 |
|------|------|------|------|------|------------|
| 全天 | Rainforest | 雨林 | 原始生态 | 跟团 | 📍雨林河道 |
| 下午 | Cape Tribulation | 海岸 | 雨林入海 | 禁下水 | 📍雨林海岸 |

---

## D9｜阿瑟顿

| 时间 | 地点 | 活动 | 亮点 | 贴士 | 📸拍照点位 |
|------|------|------|------|------|------------|
| 上午 | Lake Eacham | 火山湖 | 平静 | 慢走 | 📍湖面 |
| 中午 | Curtain Fig Tree | 巨树 | 奇观 | 停留 | 📍树冠 |
| 下午 | 瀑布 | Millaa Millaa | 经典瀑布 | 拍照 | 📍瀑布 |

---

## D10｜凯恩斯休息

| 时间 | 地点 | 活动 | 亮点 | 贴士 | 📸拍照点位 |
|------|------|------|------|------|------------|
| 上午 | Rusty’s Market | 市场 | 水果 | 必去 | 📍水果摊 |
| 下午 | Lagoon | 休息 | 放松 | 洗衣 | 📍泳池 |

---

## D11｜悉尼转场

| 时间 | 地点 | 活动 | 亮点 | 贴士 | 📸拍照点位 |
|------|------|------|------|------|------------|
| 傍晚 | The Rocks | 老城 | 氛围 | 轻松 | 📍石板路 |
| 晚上 | Circular Quay | 夜景 | 歌剧院 | 必看 | 📍海港桥 |

---

## D12｜悉尼地标（🔥）

| 时间 | 地点 | 活动 | 亮点 | 贴士 | 📸拍照点位 |
|------|------|------|------|------|------------|
| 上午 | Opera House | 导览 | 地标 | 必订 | 📍正面 |
| 中午 | Botanic Garden | 散步 | 海港 | 轻松 | 📍草坪 |
| 下午 | Mrs Macquarie | 拍照 | 明信片 | 必拍 | 📍经典机位 |
| 晚上 | QVB | 购物 | 建筑 | 室内 | 📍穹顶 |

---

## D13｜弹性日

蓝山 / 南海岸（二选一）

---

## D14｜观鲸+Bondi（🔥）

| 时间 | 地点 | 活动 | 亮点 | 贴士 | 📸拍照点位 |
|------|------|------|------|------|------------|
| 上午 | 出海 | 观鲸 | 迁徙 | 防风 | 📍海港远景 |
| 下午 | Bondi | 海滩 | 标志 | 轻松 | 📍Icebergs |
| 傍晚 | Coastal Walk | 步道 | 海岸线 | 一段即可 | 📍悬崖 |

---

## D15｜Manly + 告别（🔥）

| 时间 | 地点 | 活动 | 亮点 | 贴士 | 📸拍照点位 |
|------|------|------|------|------|------------|
| 上午 | Ferry | Manly | 海港巡游 | 必坐 | 📍船上 |
| 下午 | Manly Beach | 午餐 | 松弛 | 不赶 | 📍海滩 |
| 晚上 | Cafe Sydney | 告别餐 | 海港夜景 | 必订 | 📍露台夜景 |

---

## D16｜返程

机场 + TRS退税

---

# 🍽️ 七、美食总表（执行版）

| Day | 早餐 | 午餐 | 晚餐 | 重点 |
|-----|------|------|------|------|
| D1 | café | hotel | Riverland | 轻 |
| D2 | Lune | Degraves | Supernormal | QVM🔥 |
| D3 | coffee | Lorne | Co-op🔥 | fish&chips |
| D4 | café | picnic | 12 Rocks | 控制 |
| D5 | café | Colac | hotel | 冰淇淋🔥 |
| D6 | café | light | Night Market | 放松 |
| D7 | boat | reef | Prawn Star🔥 | 核心 |
| D8 | hotel | tour | casual | 冰淇淋🔥 |
| D9 | café | Gallo | Cairns | 奶制品 |
| D10 | Rusty’s🔥 | light | seafood | 修复 |
| D11 | café | flight | Rocks pub | 转场 |
| D12 | café | Fish Market🔥 | Hello Auntie🔥 | 核心 |
| D13 | café | local | CBD | 机动 |
| D14 | café | Bondi | Icebergs🔥 | 海景 |
| D15 | café | Manly | Cafe Sydney🔥 | 终极 |
| D16 | airport | - | - | 收尾 |
`;

const parsedGuide = parseTravelMarkdown(sourceGuideMarkdown);

export const initialTravelDays = parsedGuide.days.map(withDayDefaults);

export const initialTripItems = [
  item("lodging-oaks", "lodging", "Oaks", "d1", "墨尔本", "已订好", 0, "", "D1-D2 墨尔本住宿，服务抵达、Southbank 和城市漫步。", "", 10),
  item("lodging-apollo-bay", "lodging", "Apollo Bay", "d3", "大洋路", "已订好", 0, "", "D3 大洋路海边小镇住宿。", "", 20),
  item("lodging-port-campbell", "lodging", "Port Campbell", "d4", "大洋路", "已订好", 0, "", "D4 靠近十二使徒，方便补拍和休息。", "", 30),
  item("lodging-airport-hotel", "lodging", "机场酒店", "d5", "墨尔本机场", "已订好", 0, "", "D5 回到墨尔本机场附近，准备次日飞凯恩斯。", "", 40),
  item("lodging-cairns", "lodging", "Cairns", "d6", "凯恩斯", "已订好", 0, "", "D6-D10 凯恩斯住宿，覆盖夜市、大堡礁、丹翠、阿瑟顿和休息日。", "", 50),
  item("lodging-sydney", "lodging", "Sydney", "d11", "悉尼", "已订好", 0, "", "D11-D15 悉尼住宿，覆盖海港、Bondi、Manly 和返程前整理。", "", 60),

  item("booking-great-ocean-car", "booking", "大洋路自驾", "d3", "墨尔本", "还没订", 0, "", "D3-D5 自驾大洋路，确认车型、保险、第二驾驶人、行李空间和还车安排。", "", 110),
  item("booking-reef-magic", "booking", "Reef Magic 大堡礁", "d7", "凯恩斯", "还没订", 0, "", "D7 核心活动，确认出海时间、午餐、浮潜装备、半潜艇、天气取消政策。", "", 120),
  item("booking-daintree", "booking", "丹翠雨林一日游", "d8", "丹翠", "还没订", 0, "", "D8 建议跟团，确认接送、Cape Tribulation、雨林河道和回到凯恩斯时间。", "", 130),
  item("booking-opera-house", "booking", "Opera House 导览", "d12", "悉尼", "还没订", 0, "", "D12 悉尼地标日，若进内部导览需提前看中文或英文班次。", "", 140),
  item("booking-d13-choice", "booking", "D13 蓝山 / 南海岸二选一", "d13", "悉尼", "到时再看", 0, "", "按临近天气决定，不急着锁死不可退项目。", "", 150),
  item("booking-whale", "booking", "出海观鲸", "d14", "悉尼", "已订好", 0, "", "D14 观鲸日，提前吃晕船药，穿防风外套。", "", 160),
  item("booking-cafe-sydney", "booking", "Cafe Sydney 告别餐", "d15", "悉尼", "还没订", 0, "", "D15 晚上，建议提前订位，优先海港夜景位置。", "", 170),

  item("budget-total", "budget", "预算待补", "", "全程", "到时再看", 0, "", "新版攻略暂未写预算表，后续可用新版 MD 或手动补齐。", "", 210),

  item("activity-southbank", "activity", "Southbank 河岸散步", "d1", "墨尔本", "到时再看", 0, "", "抵达日轻松看 Yarra River 倒影和河岸灯光。", "", 310),
  item("activity-great-ocean-road", "activity", "大洋路海岸自驾", "d3", "大洋路", "还没订", 0, "", "Torquay、Lorne、Kennett River、Apollo Bay、十二使徒和 Loch Ard Gorge。", "", 320),
  item("activity-reef", "activity", "大堡礁浮潜", "d7", "凯恩斯", "还没订", 0, "", "Reef Magic 海上平台，防晒和晕船准备优先。", "", 330),
  item("activity-daintree", "activity", "丹翠雨林 + Cape Tribulation", "d8", "丹翠", "还没订", 0, "", "雨林、河道和雨林入海，按攻略不建议下水。", "", 340),
  item("activity-atherton", "activity", "阿瑟顿高原", "d9", "阿瑟顿", "到时再看", 0, "", "Lake Eacham、Curtain Fig Tree、Millaa Millaa 瀑布。", "", 350),
  item("activity-sydney-icons", "activity", "悉尼地标", "d12", "悉尼", "还没订", 0, "", "Opera House、Botanic Garden、Mrs Macquarie、QVB。", "", 360),
  item("activity-bondi", "activity", "Bondi + Coastal Walk", "d14", "悉尼", "到时再看", 0, "", "观鲸后看 Bondi、Icebergs 和一段海岸步道。", "", 370),
  item("activity-manly", "activity", "Manly Ferry", "d15", "悉尼", "到时再看", 0, "", "Ferry 本身就是海港巡游，适合最后一天放松。", "", 380),

  ...parsedGuide.items.map((guideItem, index) => ({
    ...guideItem,
    city: cityForDayId(guideItem.relatedDayId),
    sortOrder: 500 + index * 10,
  })),
];

function withDayDefaults(day) {
  const notes = dayDefaults(day.city);

  return {
    ...day,
    climateNote: notes.climateNote,
    clothingNote: notes.clothingNote,
    focus: day.focus || day.title,
  };
}

function dayDefaults(city) {
  if (/墨尔本|大洋路|回程/.test(city)) {
    return {
      climateNote: "维州冬季偏凉，多风，海边体感更冷。",
      clothingNote: "防风外套、长裤、舒适鞋，海边和清晨多加一层。",
    };
  }

  if (/凯恩斯|丹翠|阿瑟顿/.test(city)) {
    return {
      climateNote: "凯恩斯段白天温暖，雨林潮湿，室内和车上空调可能偏冷。",
      clothingNote: "短袖、防晒、帽子、墨镜，随身带薄外套和防蚊用品。",
    };
  }

  if (/悉尼|蓝山|南海岸/.test(city)) {
    return {
      climateNote: "悉尼冬季早晚凉，海边和出海时风更明显。",
      clothingNote: "薄羽绒或防风外套、长裤、舒适鞋；出海提前准备晕船药。",
    };
  }

  return {
    climateNote: "长途移动日，注意休息和随身物品。",
    clothingNote: "证件、充电线、薄外套和常用药随身。",
  };
}

function cityForDayId(dayId) {
  return initialTravelDays.find((day) => day.id === dayId)?.city || "";
}

function item(id, kind, title, relatedDayId, city, status, amount, currency, note, link, sortOrder) {
  return { id, kind, title, relatedDayId, city, status, amount, currency, note, link, sortOrder };
}
