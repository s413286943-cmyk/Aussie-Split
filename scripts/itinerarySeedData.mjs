// Source rows for content/aussie-itinerary.xlsx (澳新 2027 最终行程，2026-10-25 版本).
// Rebuild the workbook with `node scripts/create-itinerary-workbook.mjs --force`,
// then regenerate the app data with `npm run itinerary:import`.

const gmSearch = (query) => `https://www.google.com/maps/search/?api=1&query=${query}`;

export const trip = [
  kv("title", "澳新 2027"),
  kv("subtitle", "悉尼 + 新西兰南北岛十七日"),
  kv("dates", "2027.02.01-02.17"),
  kv("start_date", "2027-02-01"),
  kv("end_date", "2027-02-17"),
  kv("travelers", "2位成人"),
  kv("route", "悉尼3晚 → 基督城1晚 → Twizel3晚 → Wānaka2晚 → Te Anau2晚 → Queenstown2晚 → Auckland2晚 → 夜航回国"),
  kv("summary", "每天保留一个主要体验：悉尼街区与艺术、湖区公路与星空、Mt Cook徒步、Wānaka的一顿晚餐、Milford峡湾、Glenorchy公路、Hobbiton中文导览。"),
  kv("status_note", "已有6笔住宿订单共12晚，另有Milford和Hobbiton两项活动；四段机票均未购买，悉尼2/1一晚、Auckland 2/14–16两晚待订。所有日期时间均为当地时间。"),
  kv("updated_at", "2026-10-25"),
  kv("cover_image_url", ""),
  kv("cover_image_alt", ""),
];

export const stages = [
  stage("sydney", "悉尼城市街区", "d1,d2,d3", "/itinerary/sydney-harbor-evening.png", "Haymarket、Newtown、White Rabbit与Surry Hills，公共交通加步行。"),
  stage("mackenzie", "基督城 + Mackenzie湖区", "d4,d5,d6,d7", "", "取车后经Tekapo、Pukaki到Twizel连住三晚，Mt Cook与观星。"),
  stage("southern-lakes", "Wānaka · 峡湾 · 皇后镇", "d8,d9,d10,d11,d12,d13", "", "Lindis Pass、Wānaka慢一天、Milford大巴游船、Glenorchy湖边公路。"),
  stage("north-return", "Auckland + 返程", "d14,d15,d16,d17", "", "南岛还车飞Auckland，Hobbiton中文团，城市日后夜航回国。"),
];

export const days = [
  day({
    id: "d1", label: "D01", date: "2027-02-01", weekday: "周一", city: "抵达Sydney · Haymarket", base: "Sydney",
    lat: -33.8797, lon: 151.2048, title: "抵达悉尼，慢慢进入假期", focus: "先休息好，再在住宿周边找回悉尼的城市节奏。",
    lodging: "悉尼新增一晚（待订）", lodgingStatus: "待订", lodgingResource: "sydney-extra-night-note",
    climate: "2月悉尼盛夏，约20–27°C，湿热，午后可能有雷阵雨。", clothing: "轻薄夏装、防晒、帽子；机舱和室内空调带一件薄外套。",
    transport: "国际航班抵达SYD · 市内公共交通", leaveBy: "航班须在2/1悉尼当地抵达", primary: "haymarket-map", ticket: "no-fixed-ticket",
    notes: [
      "住宿｜2/1–2/2待订。优先补Great Southern同一家，并确认2/2是否需要换房。",
      "航班要求｜无论从沪杭哪天出发，都须在2/1悉尼当地抵达。",
    ],
  }),
  day({
    id: "d2", label: "D02", date: "2027-02-02", weekday: "周二", city: "Sydney · Newtown", base: "Sydney",
    lat: -33.8981, lon: 151.1749, title: "Newtown街区日", focus: "书店、古着、小店和一顿不赶时间的午餐。",
    lodging: "Great Southern Hotel Sydney", lodgingStatus: "已订", lodgingResource: "great-southern-map",
    climate: "2月悉尼盛夏，约20–27°C，湿热，午后可能有雷阵雨。", clothing: "好走的鞋、轻薄夏装、防晒；备一把折叠伞。",
    transport: "市内公共交通＋步行", leaveBy: "09:00–10:00早餐后出门", primary: "king-street-official", ticket: "no-fixed-ticket",
    notes: [
      "住宿｜Great Southern Hotel Sydney，原订单2/2开始，14:00后办理入住。",
      "交通｜本日公共交通和步行为主。",
    ],
  }),
  day({
    id: "d3", label: "D03", date: "2027-02-03", weekday: "周三", city: "Sydney · Chippendale / Surry Hills", base: "Sydney",
    lat: -33.8862, lon: 151.1990, title: "当代艺术、餐饮巷与Surry Hills", focus: "White Rabbit加一段有生活感的城市散步。",
    lodging: "Great Southern Hotel Sydney", lodgingStatus: "已订", lodgingResource: "great-southern-map",
    climate: "2月悉尼盛夏，约20–27°C，湿热，午后可能有雷阵雨。", clothing: "夏装＋美术馆空调用薄外套；晚上整理行李。",
    transport: "步行＋公共交通", leaveBy: "美术馆10:00开门", primary: "white-rabbit-map", ticket: "no-fixed-ticket",
    notes: [
      "住宿｜Great Southern Hotel Sydney，第二晚。",
      "开放时间｜美术馆现行周三至周日10:00–17:00，因此放在周三；2027展览按届时安排。",
    ],
  }),
  day({
    id: "d4", label: "D04", date: "2027-02-04", weekday: "周四", city: "Sydney → Christchurch", base: "Christchurch",
    lat: -43.5309, lon: 172.6045, title: "悉尼飞基督城，取车和补给", focus: "把南岛自驾第一天准备好。",
    lodging: "Metropolitan Motel on Riccarton", lodgingStatus: "已订", lodgingResource: "metropolitan-map",
    climate: "基督城2月约12–22°C，早晚凉，常有东北风。", clothing: "短袖加抓绒或薄羽绒；机舱随身带外套。",
    transport: "航班SYD→CHC（待购）· 机场取车", leaveBy: "Great Southern 10:00前退房；Metropolitan前台21:00结束", primary: "chc-airport-route", ticket: "no-fixed-ticket",
    drive: "nav01",
    notes: [
      "住宿｜Metropolitan Motel on Riccarton，175 Riccarton Road；14:00后入住，前台07:30–21:00。",
      "晚到处理｜若航班导致21:00后到店，提前取得晚到入住指引。",
    ],
  }),
  day({
    id: "d5", label: "D05", date: "2027-02-05", weekday: "周五", city: "Christchurch → Tekapo → Twizel", base: "Twizel",
    lat: -44.2581, lon: 170.0995, title: "两座湖串起的转场日", focus: "从城市平原进入Tekapo和Pukaki的湖区。",
    lodging: "Twizel Holiday Park", lodgingStatus: "已订", lodgingResource: "twizel-holiday-park-map",
    climate: "Mackenzie盆地约8–24°C，昼夜温差大，紫外线很强，午后常起风。", clothing: "防晒霜、墨镜、帽子必备；早晚加抓绒。",
    transport: "自驾 · 纯驾驶约4–4.5小时", leaveBy: "08:30–09:00从Riccarton出发", primary: "fairlie-bakehouse-official", ticket: "no-fixed-ticket",
    drive: "nav02",
    notes: [
      "住宿｜Twizel Holiday Park，122 Mackenzie Drive；One Bedroom Unit，连住3晚。",
      "驾驶安排｜纯驾驶约4–4.5小时，连停靠按6–8小时。",
      "长周末｜2/6 Waitangi Day当天部分商店限制营业，今天在Geraldine/Fairlie/Twizel把2/6的早餐、路餐和饮水买齐。",
    ],
  }),
  day({
    id: "d6", label: "D06", date: "2027-02-06", weekday: "周六", city: "Twizel ↔ Aoraki / Mount Cook", base: "Twizel",
    lat: -43.7186, lon: 170.0952, title: "Aoraki / Mount Cook完整一天", focus: "把主要体力留给Hooker Valley。",
    lodging: "Twizel Holiday Park", lodgingStatus: "已订", lodgingResource: "twizel-holiday-park-map",
    climate: "Aoraki山区约5–18°C，风大，天气变化快，可能下雨。", clothing: "防风防水外套、保暖中层、防滑徒步鞋；帽子手套和足量饮水。",
    transport: "自驾往返Mt Cook · 单程约1小时", leaveBy: "08:00左右出发（长周末建议提前到07:15–07:30）", primary: "white-horse-hill-route", ticket: "no-fixed-ticket",
    drive: "nav03",
    notes: [
      "住宿｜Twizel Holiday Park，第二晚。",
      "天气备选｜2/6与2/7可互换；体力不足时改Kea Point短线。Hooker现行全程10km、官方3小时往返，2027出发前看开放提醒。",
      "长周末｜今天是Waitangi Day（周六），White Horse Hill停车场可能很早停满，建议07:15–07:30出发；餐厅可能收公众假期附加费。",
    ],
  }),
  day({
    id: "d7", label: "D07", date: "2027-02-07", weekday: "周日", city: "Twizel湖区", base: "Twizel",
    lat: -44.2581, lon: 170.0995, title: "湖区慢生活，晚上看星星", focus: "为天气留空间，也给长途旅行留恢复时间。",
    lodging: "Twizel Holiday Park", lodgingStatus: "已订", lodgingResource: "twizel-holiday-park-map",
    climate: "Mackenzie盆地约8–24°C，夜间可降到个位数，晴夜星空最好。", clothing: "白天防晒；观星按冬装准备：羽绒、帽子、手套。",
    transport: "自驾湖区小环线 · 30–45分钟", leaveBy: "睡到自然醒；观星按确认单场次", primary: "ruataniwha-map", ticket: "stargazing-note",
    drive: "nav04",
    notes: [
      "住宿｜Twizel Holiday Park，第三晚。",
      "观星待订｜可选Silver River的Twizel产品，约75分钟；使用该产品指定集合点。若改选Tekapo Mount John，要另外增加夜间往返驾驶。主案保留Twizel观星。长周末场次紧，尽早预约。",
    ],
  }),
  day({
    id: "d8", label: "D08", date: "2027-02-08", weekday: "周一", city: "Twizel → Lindis Pass → Wānaka", base: "Wānaka",
    lat: -44.6943, lon: 169.1417, title: "穿过Lindis Pass去Wānaka", focus: "山口公路、午后湖岸，然后入住两晚。",
    lodging: "Hikuwai Haven 1", lodgingStatus: "已订", lodgingResource: "hikuwai-map",
    climate: "Wānaka约10–25°C，晴天日照强；Lindis Pass垭口风大、气温低几度。", clothing: "夏装＋防风外套；山口停车拍照时加一层。",
    transport: "自驾 · 纯驾驶约2.5–3小时", leaveBy: "09:00左右出发；16:00后入住", primary: "lindis-pass-route", ticket: "no-fixed-ticket",
    drive: "nav05",
    notes: [
      "住宿｜Hikuwai Haven 1，1 Outlet Road；16:00后入住、2/10 10:00前退房。",
      "位置影响｜住宿到镇上按开车安排。纯驾驶约2.5–3小时，留出午餐和停靠。",
      "长周末｜今天是Waitangi Day补休日，Wānaka餐厅和超市人多，晚餐提前订或早点吃。",
    ],
  }),
  day({
    id: "d9", label: "D09", date: "2027-02-09", weekday: "周二", city: "Wānaka", base: "Wānaka",
    lat: -44.6943, lon: 169.1417, title: "Wānaka慢慢过一天", focus: "上午轻徒步，晚上认真吃一顿。",
    lodging: "Hikuwai Haven 1", lodgingStatus: "已订", lodgingResource: "hikuwai-map",
    climate: "Wānaka约10–25°C，晴天日照强，傍晚湖边转凉。", clothing: "徒步鞋、防晒；晚餐带一件外套。",
    transport: "市内短途自驾 · 合计30–60分钟", leaveBy: "09:00出发去Mount Iron；Kika约18:00", primary: "mount-iron-route", ticket: "kika-note",
    drive: "nav06",
    notes: [
      "住宿｜Hikuwai Haven 1，第二晚。",
      "备选｜不想爬坡就用湖边Waterfall Creek方向散步60–90分钟替换Mount Iron；电影依当周场次，不叠加硬预约。Rippon只在想品酒且约到场次时加入，驾驶者不饮酒。",
    ],
  }),
  day({
    id: "d10", label: "D10", date: "2027-02-10", weekday: "周三", city: "Wānaka → Cromwell → Kingston → Te Anau", base: "Te Anau",
    lat: -45.4145, lon: 167.7180, title: "经Cromwell去Te Anau", focus: "完成最长的一次南岛转场，为Milford留足体力。",
    lodging: "Private Ensuite in the Heart of Te Anau", lodgingStatus: "已订", lodgingResource: "te-anau-ensuite-map",
    climate: "Central Otago晴热干燥；Te Anau约9–19°C，Fiordland多雨、云层变化快。", clothing: "车上备外套和雨具；到Te Anau后气温明显降低。",
    transport: "自驾 · 纯驾驶约4–5小时", leaveBy: "09:00左右出发；10:00前退房", primary: "nav07-leg1-route", ticket: "no-fixed-ticket",
    drive: "nav07",
    notes: [
      "住宿｜Private Ensuite in the Heart of Te Anau，3 Thomson Place；15:00后入住。",
      "驾驶安排｜主路线保留Cromwell途经点，纯驾按约4–5小时、加停靠留5–7小时；抵达时间随休息调整。",
      "路线建议｜可改走Crown Range并顺路Arrowtown，纯驾驶少约20–30分钟，见“路线建议”。不涉及任何订单。",
    ],
  }),
  day({
    id: "d11", label: "D11", date: "2027-02-11", weekday: "周四", city: "Te Anau ↔ Milford Sound", base: "Te Anau",
    lat: -44.6414, lon: 167.8974, title: "Milford Sound大巴与游船日", focus: "把今天交给已订RealNZ，坐在车窗和船边看峡湾。",
    lodging: "Private Ensuite in the Heart of Te Anau", lodgingStatus: "已订", lodgingResource: "te-anau-ensuite-map",
    climate: "Milford Sound全年多雨，约8–17°C，船头风大、水雾重。", clothing: "防水外套＋保暖层、防滑鞋；雨天瀑布反而更壮观。",
    transport: "RealNZ大巴＋游船（已订，2成人）", leaveBy: "09:15到前台，09:30前完成报到", primary: "realnz-map", ticket: "realnz-booking",
    notes: [
      "住宿｜Private Ensuite，第二晚。",
      "集合｜按约15–20分钟步行窗口留量，09:15到前台；有行李或下雨时打车提前到。订单没有写含午餐。",
    ],
  }),
  day({
    id: "d12", label: "D12", date: "2027-02-12", weekday: "周五", city: "Te Anau → Kingston → Queenstown", base: "Queenstown",
    lat: -45.0312, lon: 168.6626, title: "进入Queenstown，住进Fernhill", focus: "下午湖边散步，晚上用一顿饭开启皇后镇。",
    lodging: "山景独立单间公寓Fernhill", lodgingStatus: "已订", lodgingResource: "fernhill-map",
    climate: "Queenstown约10–24°C，晴天干燥、紫外线强，傍晚转凉。", clothing: "夏装＋晚间外套；Fernhill上坡穿好走的鞋。",
    transport: "自驾 · 纯驾驶约2–2.5小时", leaveBy: "09:30左右出发；最迟10:00前退房", primary: "nav08-route", ticket: "no-fixed-ticket",
    drive: "nav08",
    notes: [
      "住宿｜山景独立单间公寓Fernhill，房东Coral；15 Greenstone Place，15:00后入住。",
      "位置影响｜Fernhill有上坡，晚餐往返安排车或打车；若两人都喝酒，往返均打车。房源停车按房东入住指引。",
    ],
  }),
  day({
    id: "d13", label: "D13", date: "2027-02-13", weekday: "周六", city: "Queenstown ↔ Glenorchy", base: "Queenstown",
    lat: -44.8496, lon: 168.3870, title: "沿湖开去Glenorchy", focus: "公路、红船屋、湿地步道和小镇午餐。",
    lodging: "山景独立单间公寓Fernhill", lodgingStatus: "已订", lodgingResource: "fernhill-map",
    climate: "Wakatipu湖区约10–24°C，晴天日照强，湖边风大。", clothing: "防晒＋防风外套；Lagoon步道雨后可能积水，穿防水鞋。",
    transport: "自驾往返Glenorchy · 往返约2小时", leaveBy: "09:00左右出发", primary: "nav09-out-route", ticket: "no-fixed-ticket",
    drive: "nav09",
    notes: [
      "住宿｜Fernhill山景单间，第二晚。",
      "天气备选｜小雨时缩短Lagoon段；大雨、路况或能见度不适合时留Queenstown城市活动。主行程止于Glenorchy，不延伸碎石支路。",
    ],
  }),
  day({
    id: "d14", label: "D14", date: "2027-02-14", weekday: "周日", city: "Queenstown → Auckland", base: "Auckland",
    lat: -36.8442, lon: 174.7676, title: "飞到Auckland，下午看海港", focus: "南岛收车，北岛连住同一处。",
    lodging: "Auckland同一家酒店（待订）", lodgingStatus: "待订", lodgingResource: "auckland-lodging-note",
    climate: "Auckland约18–25°C，潮湿，阵雨来得快去得快。", clothing: "夏装＋轻薄防雨外套。",
    transport: "还车 · 航班ZQN→AKL（待购）", leaveBy: "10:00前退房；按航班倒推加油还车", primary: "nav10-route", ticket: "no-fixed-ticket",
    drive: "nav10",
    notes: [
      "住宿｜Auckland待订。优先CBD/Britomart/SkyCity附近，确认2/16退房后可寄存行李。",
      "当天交通｜2/14恰为情人节，正式餐厅订位与最终航班衔接后再落实。",
    ],
  }),
  day({
    id: "d15", label: "D15", date: "2027-02-15", weekday: "周一", city: "Auckland ↔ Hobbiton", base: "Auckland",
    lat: -37.8722, lon: 175.6830, title: "Hobbiton中文团，一天往返", focus: "保留已付13:50普通话导览，把往返时间留宽。",
    lodging: "Auckland同一家酒店（待订）", lodgingStatus: "待订", lodgingResource: "auckland-lodging-note",
    climate: "Waikato约15–26°C，午后日晒强，偶有阵雨。", clothing: "防晒、帽子、好走的鞋；车上备一件薄外套。",
    transport: "一日租车自驾 · 往返约5–6小时", leaveBy: "09:30左右离开市区；13:30前报到", primary: "nav11-out-route", ticket: "hobbiton-booking",
    drive: "nav11",
    notes: [
      "住宿｜回同一家Auckland住宿，第二晚。",
      "交通主案｜单日租车，须支持晚间还车。现票只含Shire’s Rest至片场巴士，不含Auckland接送；找到适配13:50的纯接送后可替换自驾。",
      "回程｜Hobbiton约16:20结束，随后返程，约19:00–20:00回到Auckland。",
    ],
  }),
  day({
    id: "d16", label: "D16", date: "2027-02-16", weekday: "周二", city: "Auckland城市日 · 夜航", base: "Auckland",
    lat: -36.8509, lon: 174.7645, title: "Auckland城市日，晚间返程", focus: "美术馆、一顿完整午餐，然后从容去机场。",
    lodging: "飞机上", lodgingStatus: "无需住宿", lodgingResource: "overnight-flight-note",
    climate: "Auckland约18–25°C，潮湿，阵雨来得快去得快。", clothing: "城市夏装；随身包放厚外套，落地国内是冬天。",
    transport: "市内步行 · 晚间国际航班（待购）", leaveBy: "目标起飞前约3小时到机场", primary: "art-gallery-map", ticket: "amano-note",
    notes: [
      "住宿｜飞机；通常无需增加2/16酒店住宿。",
      "若最终买22:00航班｜可按17:00取包、17:30前离开市区、19:00前到机场规划；这是示例，出票后整体平移。",
    ],
  }),
  day({
    id: "d17", label: "D17", date: "2027-02-17", weekday: "周三", city: "抵达国内 · 返家", base: "返程 / 国内",
    lat: 31.1443, lon: 121.8083, title: "早晨抵达国内，返家", focus: "完成最后一段接驳，留时间休息。",
    lodging: "-", lodgingStatus: "无需住宿", lodgingResource: "overnight-flight-note",
    climate: "2月中旬上海/杭州约2–10°C，湿冷。", clothing: "落地前换上厚外套，羽绒服放随身包。",
    transport: "航班抵达国内（待购）· 接驳回杭州", leaveBy: "按购得航班", primary: "pvg-map", ticket: "no-fixed-ticket",
    notes: [
      "购票条件｜2/16晚从Auckland离境，2/17早晨抵达国内；具体起降机场和时间尚未锁定。",
    ],
  }),
];

export const blocks = [
  // D01
  block("d1", 10, "抵达后", "Sydney Airport → Haymarket", "入境、取行李、进Haymarket。根据实际航班安排午餐和休息，不设置固定活动预约。", "落地先休息", "", "haymarket-map"),
  block("d1", 20, "下午", "Chinatown / Haymarket", "优先入住新增一晚住宿；体力允许时逛Chinatown、Haymarket。", "住宿周边轻活动", "早到的寄存或提前入住以酒店答复为准。", "haymarket-map"),
  block("d1", 30, "傍晚", "Haymarket", "附近吃饭，短距离散步后回酒店休息。", "第一晚以方便为主", ""),
  block("d1", 90, "饮食", "Haymarket / Chinatown", "早餐：随落地时刻；午餐：随落地时刻；晚餐：Haymarket或Chinatown", "第一晚以方便为主", ""),
  // D02
  block("d2", 10, "09:00–10:00", "Haymarket → Newtown", "Haymarket吃早餐；如不能同房续住，先按新增订单要求退房、寄存行李，再乘公共交通前往Newtown。", "换房日先处理行李", ""),
  block("d2", 20, "10:00–12:30", "King Street", "沿King Street走走停停，重点看独立书店、小店和街头艺术。", "书店、古着、街头艺术", "", "king-street-official"),
  block("d2", 30, "12:30–14:00", "Newtown", "在Newtown安排完整午餐，午后喝咖啡。", "不赶时间的午餐", ""),
  block("d2", 40, "14:00–16:30", "Enmore Road", "沿Enmore Road继续逛；疲惫时提前回酒店。", "街区慢逛", ""),
  block("d2", 50, "晚上", "Great Southern Hotel", "回酒店取行李、办理原订单入住，在Haymarket附近晚餐。", "原订单14:00后入住", "", "great-southern-map"),
  block("d2", 90, "饮食", "Newtown / Haymarket", "早餐：住宿附近咖啡店；午餐：Newtown坐下来慢慢吃；晚餐：Haymarket", "", ""),
  // D03
  block("d3", 10, "10:00–12:00", "White Rabbit Gallery", "White Rabbit Gallery，30 Balfour Street。按当期展览参观约1.5–2小时。", "当代艺术", "周三至周日10:00–17:00开放。", "white-rabbit-map,white-rabbit-official"),
  block("d3", 20, "12:00–13:30", "Kensington Street / Spice Alley", "步行去Kensington Street / Spice Alley午餐。", "餐饮巷", "", "spice-alley-official"),
  block("d3", 30, "14:00–16:30", "Surry Hills · Crown Street", "Surry Hills、Crown Street散步喝咖啡；有购物需求就在今天完成。", "有生活感的街区", ""),
  block("d3", 40, "晚上", "Surry Hills / Haymarket", "早点晚餐、整理行李，按次日待购航班决定起床和去机场时间。", "为飞基督城做准备", ""),
  block("d3", 90, "饮食", "Spice Alley / Surry Hills", "早餐：咖啡＋简单早餐；午餐：Spice Alley；晚餐：Surry Hills或回Haymarket", "", ""),
  // D04
  block("d4", 10, "出发前", "Great Southern → Sydney Airport", "Great Southern于10:00前退房；按航班时刻前往悉尼机场。", "退房赶飞机", ""),
  block("d4", 20, "落地后", "Christchurch Airport", "入境、取车并熟悉车辆。南岛用车按Christchurch取、Queenstown还规划，车行和网点待落实。", "南岛取车", "不能把机场到达口当所有公司的取车点。", "chc-airport-route"),
  block("d4", 30, "下午/傍晚", "Riccarton", "入住Riccarton汽车旅馆，在附近商场或超市采购早餐、路餐、饮水。", "补给", "", "metropolitan-map"),
  block("d4", 40, "若落地较早", "Christchurch Botanic Gardens", "可选植物园短走；晚到则直接入住和晚餐。", "可选", ""),
  block("d4", 90, "饮食", "Riccarton", "早餐：随航班；午餐：随航班；晚餐：Riccarton附近，备好2/5路上零食", "", ""),
  // D05
  block("d5", 10, "08:30–09:00", "Riccarton → Geraldine", "从Riccarton出发；Geraldine短休息。", "自驾移动日", ""),
  block("d5", 20, "中午前后", "Fairlie", "Fairlie买派或简餐，再前往Tekapo。", "Fairlie派", "", "fairlie-bakehouse-official"),
  block("d5", 30, "下午", "Lake Tekapo / Lake Pukaki", "Tekapo湖畔、好牧羊人教堂外观；随后经Pukaki南岸观景停靠。", "两座湖", "", "nav02-a-route,nav02-b-route"),
  block("d5", 40, "16:00–17:00左右", "Twizel", "抵Twizel，办理入住、补给，附近晚餐。", "连住三晚", "", "twizel-holiday-park-map"),
  block("d5", 90, "饮食", "Fairlie / Twizel", "早餐：出发前吃；午餐：Fairlie Bakehouse或Tekapo；晚餐：Twizel镇上", "", ""),
  // D06
  block("d6", 10, "08:00左右", "Twizel → White Horse Hill", "Twizel出发，沿SH80进山，尽早到White Horse Hill停车场。", "长周末建议更早出发", "", "white-horse-hill-route"),
  block("d6", 20, "09:15–14:00左右", "Hooker Valley Track", "Hooker Valley徒步，含拍照、路餐和休息预留4–5小时。", "全天主角", "全程10km，官方约3小时往返。", "doc-hooker-official"),
  block("d6", 30, "下午", "Mount Cook Village / Peter’s Lookout", "村内咖啡休息；返程在Peter’s Lookout短停看Pukaki。", "Pukaki回望", "", "peters-lookout-route"),
  block("d6", 40, "16:30–18:00左右", "Twizel", "回Twizel吃晚餐，晚上放松。", "", ""),
  block("d6", 90, "饮食", "随身路餐 / Twizel", "早餐：出发前吃足；午餐：随身路餐；晚餐：Twizel", "", ""),
  // D07
  block("d7", 10, "上午", "Lake Ruataniwha", "慢早餐；若前一天已完成Mt Cook，安排Lake Ruataniwha湖边轻走。", "恢复日", "", "ruataniwha-map"),
  block("d7", 20, "中午", "High Country Salmon", "High Country Salmon / Logans吃一顿鲑鱼午餐。", "鲑鱼午餐", "", "logans-official"),
  block("d7", 30, "下午", "住宿 / Pukaki南岸", "回住宿休息、洗衣或整理行李；视天气短去Pukaki南岸。", "", "", "pukaki-visitor-route"),
  block("d7", 40, "夜间", "Twizel观星", "优先预约Twizel当地观星，具体集合点、语言和时间以确认单为准。", "星空", "观星待订。", "silver-river-official"),
  block("d7", 90, "饮食", "Twizel", "早餐：镇上或住宿；午餐：High Country Salmon；晚餐：观星前在Twizel吃", "", ""),
  // D08
  block("d8", 10, "09:00左右", "Twizel → Omarama", "Twizel出发，Omarama短休息。", "", ""),
  block("d8", 20, "上午后段", "Lindis Pass Lookout", "Lindis Pass正规观景停车场停15–20分钟。", "山口公路", "", "lindis-pass-route,doc-lindis-official"),
  block("d8", 30, "午后", "Tarras → Luggate → Wānaka", "经Tarras、Luggate到Wānaka，湖边午餐或咖啡。", "午后湖岸", ""),
  block("d8", 40, "16:00后", "Hikuwai Haven 1", "入住Hikuwai Haven 1，再按体力安排湖边散步和晚餐。", "入住两晚", "", "hikuwai-map"),
  block("d8", 90, "饮食", "途中 / Wānaka", "早餐：Twizel；午餐：途中或Wānaka；晚餐：Wānaka镇上", "", ""),
  // D09
  block("d9", 10, "09:00–11:00", "Mount Iron", "Mount Iron步道，按1.5–2小时准备，有上下坡。", "轻徒步", "", "mount-iron-official,mount-iron-route"),
  block("d9", 20, "中午", "Wānaka湖边", "湖边午餐，之后咖啡和休息。", "", "", "wanaka-lakefront-route"),
  block("d9", 30, "下午", "湖边 / Cinema Paradiso", "沿湖走走；喜欢电影时查看Cinema Paradiso实际片单。", "可选电影", "", "paradiso-official"),
  block("d9", 40, "18:00左右", "Kika", "Kika分享式晚餐，待预约。之后回住宿休息。", "认真吃一顿", "Kika待预约。", "kika-official,kika-route"),
  block("d9", 90, "饮食", "湖畔 / Kika", "早餐：出发前；午餐：湖畔简餐；晚餐：Kika", "", ""),
  // D10
  block("d10", 10, "09:00左右", "Wānaka → Cromwell", "退房出发，沿SH6去Cromwell。", "最长转场日", ""),
  block("d10", 20, "上午", "Cromwell → Kawarau Gorge", "Cromwell历史街区短停、咖啡；穿Kawarau Gorge到Frankton方向。", "峡谷公路", "", "nav07-leg1-route"),
  block("d10", 30, "中午至下午", "Kingston → Five Rivers → Mossburn", "经Kingston、Five Rivers、Mossburn到Te Anau；途中吃午餐、分段休息。", "分段休息", "", "nav07-leg2-route"),
  block("d10", 40, "15:00–16:30左右", "Te Anau", "入住，去湖边走走，购买翌日路餐、检查活动集合点。", "为Milford准备", "", "te-anau-ensuite-map"),
  block("d10", 90, "饮食", "Frankton / Kingston / Te Anau", "早餐：Wānaka；午餐：Frankton或Kingston；晚餐：Te Anau镇上，早点结束", "", ""),
  // D11
  block("d11", 10, "08:00左右", "Te Anau", "早餐，带好防水外套、保暖层、防滑鞋、路餐和饮水。", "装备检查", ""),
  block("d11", 20, "09:15左右到，09:30前完成报到", "RealNZ Visitor Centre", "RealNZ Visitor Centre前台，85 Lakefront Drive, Te Anau。", "已订集合", "", "realnz-map,realnz-walk-route"),
  block("d11", 30, "09:50–17:00", "Milford Sound", "已订蒂阿瑙往返大巴＋Milford特色游船，2成人。以运营商安排的沿途停靠为准。", "峡湾", "", "realnz-booking"),
  block("d11", 40, "18:30左右", "Te Anau", "回镇上吃晚餐，可预约The Redcliff，之后回住宿。", "", "", "redcliff-official"),
  block("d11", 90, "饮食", "路餐 / The Redcliff", "早餐：住宿/镇上；午餐：自备路餐，船上饮品小吃可刷卡购买；晚餐：The Redcliff", "", ""),
  // D12
  block("d12", 10, "09:30左右", "Te Anau → Kingston", "Te Anau退房出发；最迟10:00前退房。", "", "", "nav08-route"),
  block("d12", 20, "中午", "Queenstown", "经Kingston到Queenstown，先吃午餐。", "", "", "boundary-street-map"),
  block("d12", 30, "15:00后", "15 Greenstone Place", "入住15 Greenstone Place，放下行李休息。", "入住Fernhill", "", "fernhill-map"),
  block("d12", 40, "16:30–晚上", "Queenstown Gardens / Blue Kanu", "Queenstown Gardens或湖边轻走；可把Blue Kanu作为今天的晚餐。", "湖边与晚餐", "", "blue-kanu-official"),
  block("d12", 90, "饮食", "Queenstown / Blue Kanu", "早餐：Te Anau；午餐：Queenstown；晚餐：Blue Kanu", "", ""),
  // D13
  block("d13", 10, "09:00左右", "Fernhill → Glenorchy Road", "Fernhill出发，沿Queenstown–Glenorchy Road向西。", "湖边公路", "", "nav09-out-route"),
  block("d13", 20, "上午", "Bennetts Bluff / Glenorchy码头", "Bennetts Bluff正规停车场停靠；到Glenorchy后看码头和红船屋。", "红船屋", "", "bennetts-bluff-official"),
  block("d13", 30, "中午前后", "Glenorchy Lagoon Walkway", "Glenorchy Lagoon Walkway，按1–2小时走；随后小镇午餐。", "湿地步道", "官方路线3.2km，雨后注意积水提示。", "glenorchy-lagoon-official,glenorchy-lagoon-map"),
  block("d13", 40, "下午", "Glenorchy → Queenstown", "沿原路返回，选择一个合适的正规观景点短停。16:00–17:00左右回Queenstown。", "", "", "nav09-back-route"),
  block("d13", 50, "晚上", "Queenstown", "湖边晚餐，整理行李、准备次日加油还车。", "", ""),
  block("d13", 90, "饮食", "Glenorchy / Queenstown", "早餐：Queenstown/住宿；午餐：Glenorchy镇上；晚餐：Queenstown", "", ""),
  // D14
  block("d14", 10, "上午", "Fernhill → Frankton → Queenstown Airport", "10:00前退房；按最终航班倒推加油、还车和机场到场。", "南岛收车", "", "nav10-route"),
  block("d14", 20, "飞行", "ZQN → AKL", "选择2/14出发、下午抵Auckland的班次，航班号待购后填入。", "航班待购", ""),
  block("d14", 30, "抵达后", "Auckland CBD", "取行李、进CBD酒店，入住2/14–16连续两晚。", "连住两晚", ""),
  block("d14", 40, "傍晚", "Britomart / Viaduct Harbour", "Britomart、Quay Street、Viaduct Harbour散步；时间充裕再延伸Wynyard Quarter。", "海港散步", ""),
  block("d14", 90, "饮食", "Queenstown / Auckland", "早餐：Queenstown；午餐：随航班；晚餐：Auckland市中心，预留落地弹性", "", ""),
  // D15
  block("d15", 10, "08:30–09:30", "Auckland市区取车", "办理一日租车；09:30左右从Auckland市区出发。租车和取还车地点待订。", "一日租车", "", "nav11-out-route"),
  block("d15", 20, "12:30–13:00", "The Shire’s Rest", "到The Shire’s Rest，吃简餐、上洗手间。", "", "", "shire-rest-map"),
  block("d15", 30, "13:30前", "The Shire’s Rest Ticketing Office", "在The Shire’s Rest Ticketing Office报到。", "已订报到", "", "hobbiton-booking"),
  block("d15", 40, "13:50–约16:20", "Hobbiton Movie Set", "已订Mandarin Language Tour；片场游览约2.5小时。", "中文导览", ""),
  block("d15", 50, "16:30–17:00左右返程", "Hobbiton → Auckland", "回Auckland，按约19:00–20:00抵城安排晚餐及还车。", "晚间回城", "", "nav11-back-route"),
  block("d15", 90, "饮食", "Shire’s Rest / Auckland", "早餐：出发前；午餐：现场简餐或自备；晚餐：Auckland，避免绑定太早的餐厅时段", "", ""),
  // D16
  block("d16", 10, "早餐后", "酒店", "退房并寄存行李；如租车留到今天，先完成市区还车。", "", ""),
  block("d16", 20, "10:00–12:00", "Auckland Art Gallery", "Auckland Art Gallery Toi o Tāmaki，按1.5–2小时安排。", "美术馆", "", "art-gallery-map,art-gallery-official"),
  block("d16", 30, "12:30–14:00", "Britomart · Amano", "Britomart午餐，首选Amano，待预约。", "完整午餐", "", "amano-map,amano-official"),
  block("d16", 40, "下午", "Britomart", "GIAPO甜点或咖啡、短距离购物；按航班倒推结束城市活动。", "", ""),
  block("d16", 50, "晚上", "Auckland Airport", "取行李、赴机场、办理国际出发。目标起飞前约3小时抵机场，按最终航司要求执行。", "夜航回国", "", "akl-intl-map,akl-departure-official"),
  block("d16", 90, "饮食", "市区 / Amano", "早餐：市区；午餐：Amano；晚餐：按起飞时刻在市区或机场安排", "", ""),
  // D17
  block("d17", 10, "早晨", "国内机场", "按购得航班抵达中国目的机场，入境、取行李。", "", ""),
  block("d17", 20, "之后", "上海 → 杭州", "若落地上海，再衔接回杭州；具体车次等机票确定后安排。", "", ""),
  block("d17", 90, "饮食", "落地后", "早餐：落地早餐；午餐：返家简餐；晚餐：在家休息", "按航班实际到达时间", ""),
];

export const drives = [
  drive("nav01", "d4", "导航01 · 基督城机场 → Riccarton", "落地后完成入境与取车；机场到住宿约20–30分钟，车行接驳另算。",
    "Christchurch Airport / 实际租车点 → Riccarton → 175 Riccarton Road",
    "今天只做市内适应和补给。若晚间才落地，先落实租车点营业时间和住宿晚到手续。",
    "chc-airport-route,metropolitan-map"),
  drive("nav02", "d5", "导航02 · 基督城 → Twizel", "08:30–09:00离开住宿；纯驾驶约4–4.5小时，连午餐及湖边停靠留6–8小时。",
    "Riccarton → SH1南行 / Ashburton → SH79 / Geraldine → Fairlie → SH8 / Tekapo → Pukaki南岸 → Twizel",
    "Geraldine和Fairlie各短停即可，优先保留Tekapo、Pukaki的湖边时间。Tekapo、Fairlie和Twizel公共车位有P10/P30/P60/P120等限制，免费不代表不限时；现场牌为准。",
    "nav02-a-route,nav02-b-route,mackenzie-parking-official"),
  drive("nav03", "d6", "导航03 · Twizel ↔ Mt Cook", "08:00左右出发；单程约1小时，观景停车另加；主要体力留给4–5小时徒步窗口。",
    "Twizel → SH8北行 → SH80沿Pukaki西岸 → Hooker Valley Road → White Horse Hill Car Park；返程停Peter’s Lookout",
    "White Horse Hill现行NZ$2.50/半小时、NZ$25/天封顶，刷卡支付；完整徒步暂留NZ$20–25。短线备选：同一停车区域走Kea Point约1小时。Tasman Valley是另一停车场，从White Horse Hill开车约20–30分钟；只有体力和时间充足才加。大风雨不适合进山时与2/7交换。",
    "white-horse-hill-route,peters-lookout-route,tasman-route,doc-parking-official,kea-point-official,tasman-valley-official"),
  drive("nav04", "d7", "导航04 · Twizel湖区小环线", "睡到自然醒；基础小环线纯驾驶约30–45分钟，去Pukaki另加约30–40分钟往返驾驶，观景停留另计。",
    "住宿 → Lake Ruataniwha Reserve → High Country Salmon → 住宿；Pukaki是可选支线",
    "如这天改走Mt Cook，直接使用导航03，湖区小环线取消即可。观星是否改期按未来所订条款，不能保证免费调整。",
    "lake-loop-route,pukaki-visitor-route"),
  drive("nav05", "d8", "导航05 · Twizel → Wānaka", "09:00左右出发；纯驾驶约2.5–3小时，停靠与午餐后配合16:00入住。",
    "Twizel → SH8 / Omarama → Lindis Pass → Tarras → SH8A / Luggate → SH6 / Albert Town → 1 Outlet Road",
    "山口段以正规停车场停靠；出发前在Twizel补油，Omarama可再检查。Wānaka入住后的车位按房东说明。",
    "lindis-pass-route,nav05-a-route,nav05-b-route,doc-lindis-official"),
  drive("nav06", "d9", "导航06 · Wānaka市内", "上午09:00左右出发；全天按短距离开车衔接，合计约30–60分钟，视所选步道而定。",
    "1 Outlet Road → Mount Iron停车场 → Wānaka湖滨 → 住宿休息 → Kika → 住宿",
    "轻松版：上午改Waterfall Creek方向湖畔散步，其余保持。若晚餐两人都饮酒，住宿往返餐厅改打车；不要只解决去程。",
    "mount-iron-route,wanaka-lakefront-route,kika-route,waterfall-creek-route"),
  drive("nav07", "d10", "导航07 · Wānaka经Cromwell → Te Anau", "09:00左右出发；纯驾驶按约4–5小时准备，加午餐休息留5–7小时，入住后不再远行。",
    "1 Outlet Road → SH6 / Cromwell → Kawarau Gorge → Frankton → SH6 / Kingston → Five Rivers → SH97 / Mossburn → SH94 / Te Anau → 3 Thomson Place",
    "必须保留的途经点：Cromwell。这是本次主线选择；只输入Wānaka到Te Anau时，导航可能给出Crown Range方案。Frankton补油后继续南下，皇后镇中心游览留给2/12。",
    "nav07-leg1-route,nav07-leg2-route,crown-range-route,nzta-five-rivers-official"),
  drive("nav08", "d12", "导航08 · Te Anau → Queenstown Fernhill", "09:30左右出发、10:00前退房；纯驾驶约2–2.5小时，加休息午餐留3–4小时；15:00后入住。",
    "3 Thomson Place → SH94 / Mossburn → SH97 / Five Rivers → SH6 / Kingston → Frankton → SH6A / Queenstown → Fernhill → 15 Greenstone Place",
    "住处在山坡，回房要考虑上坡和天气。晚餐若打车，按往返安排；若开车，使用有明确收费/限时标识的市区车位。",
    "nav08-route,boundary-street-map,fernhill-map,qldc-parking-official"),
  drive("nav09", "d13", "导航09 · Fernhill ↔ Glenorchy", "09:00左右出发；单程约50–70分钟，往返按约2小时，连步道午餐留5–6小时。",
    "15 Greenstone Place → Queenstown–Glenorchy Road → Bennetts Bluff Viewpoint → Glenorchy Waterfront / Wharf → Lagoon步道 → 原路回Fernhill",
    "Bennetts Bluff是途中观景站；Glenorchy Waterfront/Wharf是小镇主停车区域。Paradise及未铺装支线不纳入本日主路线。",
    "nav09-out-route,glenorchy-lagoon-map,nav09-back-route,bennetts-bluff-official,glenorchy-lagoon-official"),
  drive("nav10", "d14", "导航10 · Fernhill → Queenstown机场", "10:00前退房；住宿至机场方向约20–35分钟，另计加油、验车和车行摆渡。",
    "Fernhill → Queenstown / SH6A → Frankton加油 → 实际还车网点 → Queenstown Airport",
    "先满足最终航司的到场要求；规划可留起飞前约90分钟到国内航站楼，再向前加约45–60分钟还车/摆渡及路程。车行若要求更早，按其说明调整。今天不插入Arrowtown等专门绕路的游览。",
    "nav10-route,zqn-map,qt-airport-rental-official"),
  drive("nav11", "d15", "导航11 · Auckland ↔ Hobbiton", "08:30–09:00提车，09:30左右离开市区；去回各预留约3小时交通窗口含短休息，13:30前报到。",
    "Auckland市区实际取车点 → SH1南行 → 按当日导航经SH2 / SH27到Matamata → 501 Buckland Road / The Shire’s Rest；返程回实际还车点",
    "取还车点尚未确定，地图先以Britomart作CBD参考；实际使用时替换成车行地址。优先支持晚间自助还车的网点；若必须次晨还，另计过夜停车和租期，2/16先还车再城市活动。现有票不含Auckland接送；纯接送只有确认接受自购票、13:30前送达且16:20后接回才可替代本页自驾。",
    "nav11-out-route,nav11-matamata-route,nav11-back-route,shire-rest-map,hobbiton-faq-official,hobbiton-transfers-official"),
];

export const driveLegs = [
  leg("nav01", 10, "机场 → 租车网点", "按订单", "先确认柜台在航站楼内还是需摆渡；不能把机场到达口当所有公司的取车点。"),
  leg("nav01", 20, "实际网点 → 175 Riccarton Road", "机场起算约20–30分钟", "入住后按住宿指引停车。前台21:00结束，晚到提前安排钥匙。"),
  leg("nav01", 30, "住宿 → Riccarton商场/超市", "短距离市内移动", "买早餐、路餐、水；购物停车依车场限时牌。"),
  leg("nav02", 10, "Riccarton → Geraldine", "约1小时45分–2小时", "镇上短休息15–20分钟，活动一下再开。"),
  leg("nav02", 20, "Geraldine → Fairlie Bakehouse", "约40–50分钟", "派/简餐30–45分钟；停车看限时标识。"),
  leg("nav02", 30, "Fairlie → Tekapo / Pioneer Drive", "约35–45分钟", "教堂外观与湖边留60–90分钟，停正规公共车位后步行。"),
  leg("nav02", 40, "Tekapo → Pukaki Visitor Centre", "约40–50分钟", "南岸看湖20–30分钟；此处与SH80上的Peter’s Lookout不同。"),
  leg("nav02", 50, "Pukaki → Twizel Holiday Park", "约15–20分钟", "终点122 Mackenzie Drive；预计下午抵达，按原订单完成入住。"),
  leg("nav03", 10, "Twizel → White Horse Hill Car Park", "约50–70分钟", "不要只导航Mount Cook Village；Hooker Valley起点在White Horse Hill。"),
  leg("nav03", 20, "停车场 → Hooker Valley → 停车场", "步行，不是开车", "全程10km，官方约3小时；含拍照、路餐与休息留4–5小时。"),
  leg("nav03", 30, "White Horse Hill → Peter’s Lookout", "约35–45分钟", "正规停车场短停15–20分钟；视能见度决定是否停。"),
  leg("nav03", 40, "Peter’s Lookout → Twizel", "约25–35分钟", "回住宿吃饭休息。"),
  leg("nav04", 10, "住宿 → Lake Ruataniwha Reserve", "约10–15分钟", "找标识的湖边公共车位，散步30–60分钟。"),
  leg("nav04", 20, "湖边 → High Country Salmon", "约10–15分钟", "目的地2602 Twizel–Omarama Highway；午餐留60–90分钟。"),
  leg("nav04", 30, "午餐 → 住宿", "约10–15分钟", "下午休息，为晚间观星留精力。"),
  leg("nav04", 40, "住宿 → 观星集合点", "待观星确认单", "Twizel产品集合点尚未确定，不用Tekapo办公室地址代替。"),
  leg("nav05", 10, "Twizel → Omarama", "约30–40分钟", "咖啡、洗手间、检查油量；休息15–30分钟。"),
  leg("nav05", 20, "Omarama → Lindis Pass Lookout", "约30–40分钟", "用垭口南侧标识停车场，停15–20分钟；选择Lookout，不选Lindis Peak长徒步。"),
  leg("nav05", 30, "Lindis Pass → Tarras → Luggate", "约60–75分钟", "沿SH8、SH8A，不向Cromwell绕行；午餐可在途中或Wānaka安排。"),
  leg("nav05", 40, "Luggate → 1 Outlet Road", "约20–30分钟", "终点用房东地址；若早到先去湖边，16:00后入房。"),
  leg("nav06", 10, "住宿 → Mount Iron Track Car Park", "约10–15分钟", "停步道停车场后走1.5–2小时；当天不再叠加另一座山。"),
  leg("nav06", 20, "步道 → Wānaka湖滨", "约5–10分钟", "市区停车按限时牌，午餐和湖边活动安排在同一区域。"),
  leg("nav06", 30, "湖滨 → 住宿 → Kika", "各约10–15分钟", "回房休息后晚餐；2 Dunmore Street，停车后步行到店。"),
  leg("nav07", 10, "Wānaka → Cromwell", "约45–60分钟", "历史街区附近正规停车，咖啡及短走30–45分钟。"),
  leg("nav07", 20, "Cromwell → Kawarau Gorge → Frankton", "约50–70分钟", "弯道峡谷段按实际路况行驶；可在Frankton午餐、补油。"),
  leg("nav07", 30, "Frankton → Kingston", "约40–50分钟", "湖边短休息10–20分钟；今天以转场为主。"),
  leg("nav07", 40, "Kingston → Five Rivers → Mossburn → Te Anau", "约1.5–2小时", "Five Rivers转SH97，Mossburn接SH94；不必默认绕到Lumsden。"),
  leg("nav07", 50, "Te Anau → 3 Thomson Place", "镇内短距离", "15:00后入住，随后买翌日路餐。"),
  leg("nav08", 10, "Te Anau → Mossburn / Five Rivers", "约50–65分钟", "需要时短休息，按SH97接SH6北行。"),
  leg("nav08", 20, "Five Rivers → Kingston", "约30–40分钟", "湖边短停；若2/10已充分看过，今天只休息即可。"),
  leg("nav08", 30, "Kingston → Queenstown中心", "约45–60分钟", "市区午餐；停车可查Boundary Street等正规车场，按牌付费。"),
  leg("nav08", 40, "中心 → 15 Greenstone Place", "约10–15分钟", "上Fernhill后按房东说明停车，15:00前不默认能入房。"),
  leg("nav09", 10, "Fernhill → Bennetts Bluff", "约25–35分钟", "使用新正规观景停车场，步行观景20–30分钟，不停旧盲弯路肩。"),
  leg("nav09", 20, "Bennetts Bluff → Glenorchy Wharf", "约25–35分钟", "停湖滨正规车位；码头、红船屋拍照20–30分钟。"),
  leg("nav09", 30, "码头/湖滨停车 → Lagoon Walkway", "步行", "按标识接入，留1–2小时；官方路线3.2km，雨后注意积水提示。"),
  leg("nav09", 40, "Glenorchy → Fernhill", "约50–70分钟", "午餐后原路返；途中最多选一处正规停车点，下午回城。"),
  leg("nav10", 10, "住宿 → Frankton加油", "约20–30分钟", "按租车油量要求加油，保留凭证。"),
  leg("nav10", 20, "加油 → 实际还车网点", "按车行位置", "导航改用订单网点；场外店与机场停车区不能互换。"),
  leg("nav10", 30, "还车 → 航站楼", "按车行流程", "把验车、搬行李、摆渡时间另计；不要把抵还车店当作已到值机柜台。"),
  leg("nav11", 10, "取车点 → Matamata", "约2–2.5小时，路况另留量", "可在Matamata短休息；i-SITE只是途中停靠参考，并非这张票的报到点。"),
  leg("nav11", 20, "Matamata → The Shire’s Rest", "约15–25分钟", "最终目的地501 Buckland Road。乡村道路跟当日导航与标识，不套用旧攻略出口号。"),
  leg("nav11", 30, "现场停车、午餐、报到", "约30–60分钟缓冲", "目标12:30–13:00到；停访客停车区，13:30前到Ticketing Office。"),
  leg("nav11", 40, "13:50 → 约16:20", "已订导览约2.5小时", "乘运营商巴士进出片场，私家车停在Shire’s Rest。"),
  leg("nav11", 50, "约16:30–17:00 → Auckland", "约2.5–3小时规划窗口", "按19:00–20:00抵城安排；堵车、离场晚时顺延，不在当天衔接国际航班。"),
];

export const lodgings = [
  lodging(10, "2027-02-01", "2027-02-02", "悉尼新增一晚", "优先Great Southern；同房续住待确认", "—", "sydney-extra-night-note", "待订", "", ""),
  lodging(20, "2027-02-02", "2027-02-04", "Great Southern Hotel Sydney", "无房务服务标准大床房", "14:00–次日00:00入住；10:00前退房；717 George St, Haymarket", "great-southern-map", "已订2晚", "2027-02-01 14:00", "之后不可取消；未入住收全额"),
  lodging(30, "2027-02-04", "2027-02-05", "Metropolitan Motel on Riccarton", "行政开间、按摩浴缸", "14:00后入住；07:30–10:00退房；175 Riccarton Road", "metropolitan-map", "已订1晚", "2027-02-03 14:00", "之后不可取消；未入住收全额"),
  lodging(40, "2027-02-05", "2027-02-08", "Twizel Holiday Park", "One Bedroom Unit", "入退房时间按原凭证；122 Mackenzie Drive", "twizel-holiday-park-map", "已订3晚，已付", "", "原确认凭证未在本次展开，不预设免费取消"),
  lodging(50, "2027-02-08", "2027-02-10", "Hikuwai Haven 1", "", "16:00后入住；10:00前退房；1 Outlet Road, Wānaka", "hikuwai-map", "已订2晚", "2027-02-03 16:00", "入住前部分退款，比例按订单"),
  lodging(60, "2027-02-10", "2027-02-12", "Private Ensuite in the Heart of Te Anau", "", "15:00后入住；10:00前退房；3 Thomson Place", "te-anau-ensuite-map", "已订2晚", "2027-02-05 15:00", "入住前部分退款，比例按订单"),
  lodging(70, "2027-02-12", "2027-02-14", "山景独立单间公寓Fernhill", "房东Coral", "15:00后入住；10:00前退房；15 Greenstone Place", "fernhill-map", "已订2晚", "2027-01-13 15:00", "2/5 15:00前取消可获部分退款，具体金额按订单"),
  lodging(80, "2027-02-14", "2027-02-16", "Auckland同一家酒店连续两晚", "优先CBD/Britomart/SkyCity", "须确认退房后寄存", "auckland-lodging-note", "待订2晚", "", ""),
];

export const todos = [
  todo(10, "booking", "", "尽早", "四段机票", "2/1抵SYD；2/4当日SYD→CHC；2/14下午抵AKL；2/16晚AKL离境、2/17早晨抵国内。出票后补准确航班号及机场到场时间。"),
  todo(20, "booking", "", "尽早", "悉尼新增一晚", "2/1–2/2；优先补同一家，确认续住是否要换房。"),
  todo(30, "booking", "", "尽早", "Auckland两晚", "2/14入住、2/16退房；同一家连住，确认寄存及取包时段。最好选附近有支持晚间还车租车网点的位置，方便2/15。"),
  todo(40, "booking", "", "定机票后", "南岛租车", "Christchurch取、Queenstown还；按航班确定实际取还车时间、网点及异地还车条件。"),
  todo(50, "booking", "", "定机票后", "Hobbiton当天交通", "主案一日自驾，支持晚还；若有适配现票的纯接送，再以已确认班次替换。"),
  todo(60, "booking", "", "尽早", "Twizel观星", "优先2/7当地产品；核准确集合点、语言、天气改期条件。2/6–2/8是长周末，场次更紧。"),
  todo(70, "booking", "", "按计划时间", "重点餐厅", "Kika 2/9、The Redcliff 2/11、Blue Kanu 2/12、Amano 2/16，按计划时间查询和预约。"),
  todo(80, "prep", "", "出发前", "房东入住说明", "三处Airbnb的停车位置、门锁/钥匙、晚到要求；Fernhill尤其确认停车和回程方式。"),
  todo(110, "payment", "2027-01-05", "1/5", "Queenstown Fernhill付款 NZ$721.63", "Apple Pay付款。付款日早于免费取消截止（1/13），付款日与取消截止分别管理。"),
  todo(120, "deadline", "2027-01-13", "1/13 15:00", "Queenstown Fernhill免费取消截止", "之后至2/5 15:00前取消可获部分退款，具体金额按订单。"),
  todo(130, "payment", "2027-01-26", "1/26", "Wānaka Hikuwai尾款 NZ$346.84", "Apple Pay扣款；订金NZ$86.71已付。"),
  todo(140, "payment", "2027-01-28", "1/28", "Te Anau尾款 NZ$386.40", "Apple Pay扣款；订金NZ$96.60已付。"),
  todo(150, "deadline", "2027-02-01", "2/1 14:00", "悉尼Great Southern免费取消截止", "之后不可取消；未入住收全额。房费¥1,361.31离店扣款。"),
  todo(160, "deadline", "2027-02-03", "2/3 14:00", "基督城Metropolitan免费取消截止", "之后不可取消；未入住收全额。房费¥601.43离店扣款，另有NZ$200可退押金。"),
  todo(170, "deadline", "2027-02-03", "2/3 16:00", "Wānaka Hikuwai免费取消截止", "入住前部分退款，比例按订单。"),
  todo(180, "deadline", "2027-02-05", "2/5 15:00", "Te Anau Private Ensuite免费取消截止", "入住前部分退款，比例按订单。"),
  todo(190, "prep", "2027-02-05", "2/5", "2/6长周末补给", "2/6 Waitangi Day是限制营业日，部分超市和商店不开；2/5在途中把早餐、路餐和饮水买齐。"),
];

export const advice = [
  advice_(10, "2/10 Wānaka → Te Anau：可改走Crown Range，顺路Arrowtown", "可选优化 · 不涉及订单", "d10",
    "行程文件主线经Cromwell + Kawarau Gorge到Frankton（约110公里）。改走Cardrona Valley Road翻Crown Range到Frankton约60公里，少约50公里、纯驾驶省约20–30分钟；Crown Range下山就是Arrow Junction，Arrowtown只需绕5分钟，可在这里吃午饭或喝咖啡。两条路线从Frankton起完全相同（Kingston → Five Rivers → Mossburn → Te Anau）。",
    "Crown Range是新西兰海拔最高的铺装主干道之一（约1,076米），Queenstown一侧有连续急弯；驾驶者不熟悉山路、起雾或大风时仍走Cromwell。Cromwell路线更平缓，2月沿途有水果摊。两条都可以，按当天天气和精神状态选；导航时把Cardrona和Arrowtown设为途经点，否则手机可能自动选其中一条。",
    "crown-range-route"),
  advice_(20, "2/10与2/12重复Frankton–Kingston–Five Rivers路段", "保持住宿不变", "d10,d12",
    "这是Te Anau作为Milford大巴起点带来的固定代价：2/11已订RealNZ从Te Anau出发，从Queenstown当天往返Milford会变成12小时以上的大巴日。两天重复约2小时车程，换来Milford当天从容出发。",
    "执行上把湖边停留只放在一天：2/10在Kingston停10–20分钟，2/12经过Kingston不再停，直接到Queenstown早点吃午饭，下午多一点湖边时间。",
    ""),
  advice_(30, "2/15 Hobbiton当天往返约5–6小时驾驶", "保持当天往返，调整执行", "d15",
    "Auckland到The Shire’s Rest单程约175公里，去回纯驾驶约4.5–5小时，加2.5小时导览和缓冲，全天约10–11小时，前一天还刚从Queenstown飞来。Auckland两晚尚未预订，理论上可改成2/15住Matamata/Cambridge，但会多一次搬行李，2/16早上还要开2小时回城，城市日被压缩，所以不建议。",
    "建议：两人轮流开，去程和回程各换一次人；09:00出发比09:30更稳，周一早上出城方向不堵；2/14晚上早点休息；午饭在Shire’s Rest解决；晚餐订20:00以后或不订；租车选支持晚间自助还车、离酒店近的网点。",
    ""),
  advice_(40, "2/6–2/8 Waitangi长周末", "保持顺序，提前出发和预订", "d5,d6,d7,d8",
    "2027/2/6（周六）是Waitangi Day，2/8（周一）是补休日，2/5–2/8全程在Mackenzie和Wānaka的热门段。主要影响：White Horse Hill停车场周末上午很早停满；2/6是限制营业日，部分超市和商店不开门；不少餐厅在2/6和2/8收公众假期附加费（常见10–15%）；观星和Wānaka晚餐更难订。",
    "建议：2/5在途中买齐2/6的补给；2/6提前到07:15–07:30出发去Mt Cook，天气不好就和2/7互换（两天都在长周末内）；观星和2/8晚餐尽早订；Kika放在2/9周二不受影响，保持。",
    ""),
  advice_(50, "已订住宿：不建议改订", "不改订单", "",
    "对照路线后，没有哪一笔已订住宿改了会明显更好：Te Anau是Milford的必要基地，Twizel连住三晚兼顾Mt Cook和观星，Wānaka和Fernhill的位置与当天安排吻合。可以优化的只有待订部分：悉尼2/1尽量订Great Southern同一家免得换房；Auckland两晚选CBD/Britomart、可寄存行李且附近有晚间还车网点的酒店。",
    "如果之后仍想调整，免费取消截止（当地时间）依次为：Queenstown Fernhill 2027/1/13 15:00、悉尼Great Southern 2/1 14:00、基督城Metropolitan 2/3 14:00、Wānaka Hikuwai 2/3 16:00、Te Anau 2/5 15:00；Twizel未展开条款，不预设可免费取消。",
    ""),
];

export const resources = [
  // Lodging and booking
  resource("sydney-extra-night-note", "悉尼新增一晚（待订）", "note", "", "优先Great Southern同一家"),
  resource("great-southern-map", "Great Southern Hotel Sydney", "map", gmSearch("Great+Southern+Hotel+Sydney%2C+717+George+Street%2C+Haymarket+NSW+2000%2C+Australia"), "确认邮件地址"),
  resource("metropolitan-map", "Metropolitan Motel on Riccarton", "map", gmSearch("175+Riccarton+Road%2C+Riccarton%2C+Christchurch%2C+New+Zealand"), "确认邮件地址"),
  resource("twizel-holiday-park-map", "Twizel Holiday Park", "map", gmSearch("Twizel+Holiday+Park%2C+122+Mackenzie+Drive%2C+Twizel%2C+New+Zealand"), "住宿官网地址"),
  resource("twizel-park-official", "Twizel Holiday Park 位置", "official", "https://twizelholidaypark.co.nz/park-contact-location/", "住宿官网"),
  resource("hikuwai-map", "Hikuwai Haven 1", "map", gmSearch("1+Outlet+Road%2C+Wanaka%2C+New+Zealand"), "确认邮件地址"),
  resource("te-anau-ensuite-map", "Private Ensuite in the Heart of Te Anau", "map", gmSearch("3+Thomson+Place%2C+Te+Anau%2C+New+Zealand"), "确认邮件地址"),
  resource("fernhill-map", "山景独立单间公寓Fernhill", "map", gmSearch("15+Greenstone+Place%2C+Fernhill%2C+Queenstown%2C+New+Zealand"), "确认邮件地址"),
  resource("auckland-lodging-note", "Auckland两晚（待订）", "note", "", "优先CBD/Britomart/SkyCity"),
  resource("overnight-flight-note", "夜航 / 返程", "note", "", "无需住宿"),
  resource("no-fixed-ticket", "当天无固定票券", "note", "", "每日明确票券状态"),
  resource("stargazing-note", "Twizel观星（待订）", "note", "", "优先Silver River Twizel产品"),
  resource("kika-note", "Kika晚餐（待预约）", "note", "", "约18:00"),
  resource("amano-note", "Amano午餐（待预约）", "note", "", "12:30–14:00"),
  resource("realnz-booking", "RealNZ 蒂阿瑙往返大巴＋Milford游船（已订）", "booking", gmSearch("RealNZ+Visitor+Centre%2C+85+Lakefront+Drive%2C+Te+Anau%2C+New+Zealand"), "09:30前报到，09:50–17:00"),
  resource("hobbiton-booking", "Hobbiton Mandarin Language Tour 13:50（已订）", "booking", gmSearch("The+Shire%27s+Rest%2C+501+Buckland+Road%2C+Hinuera%2C+Matamata+3472%2C+New+Zealand"), "13:30前在Ticketing Office报到"),
  // Places
  resource("haymarket-map", "Haymarket / Chinatown", "map", gmSearch("Haymarket%2C+Sydney+NSW%2C+Australia"), "Google Maps"),
  resource("king-street-official", "King Street街区资料", "official", "https://www.sydney.com/destinations/sydney/inner-sydney/newtown/attractions/king-street-newtown", "Destination NSW"),
  resource("white-rabbit-map", "White Rabbit Gallery", "map", gmSearch("White+Rabbit+Gallery%2C+30+Balfour+Street%2C+Chippendale%2C+Australia"), "Google Maps"),
  resource("white-rabbit-official", "White Rabbit参观信息", "official", "https://whiterabbitcollection.org/visit/", "官网"),
  resource("spice-alley-official", "Spice Alley", "restaurant", "https://spicealley.com.au/contact/", "官网"),
  resource("fairlie-bakehouse-official", "Fairlie Bakehouse", "restaurant", "https://www.fairliebakehouse.co.nz/", "官网"),
  resource("doc-hooker-official", "DOC Hooker Valley步道", "official", "https://www.doc.govt.nz/hooker-valley-track", "DOC"),
  resource("doc-parking-official", "DOC收费停车场", "official", "https://www.doc.govt.nz/parks-and-recreation/know-before-you-go/paid-car-parks/", "DOC"),
  resource("kea-point-official", "Kea Point步道", "official", "https://www.doc.govt.nz/parks-and-recreation/places-to-go/canterbury/places/aoraki-mount-cook-national-park/things-to-do/tracks/kea-point-track/", "DOC"),
  resource("tasman-valley-official", "Tasman Glacier View步道", "official", "https://www.doc.govt.nz/parks-and-recreation/places-to-go/canterbury/places/aoraki-mount-cook-national-park/things-to-do/tracks/tasman-glacier-view-track/", "DOC"),
  resource("ruataniwha-map", "Lake Ruataniwha Reserve", "map", gmSearch("Lake+Ruataniwha+Reserve%2C+Twizel%2C+New+Zealand"), "Google Maps"),
  resource("logans-official", "High Country Salmon / Logans", "restaurant", "https://www.highcountrysalmon.co.nz/pages/about-us-1", "官网"),
  resource("silver-river-official", "Silver River观星", "booking", "https://silverriverstargazing.com/", "待预约"),
  resource("doc-lindis-official", "DOC Lindis停车说明", "official", "https://www.doc.govt.nz/parks-and-recreation/places-to-go/canterbury/places/lindis-conservation-area/", "DOC"),
  resource("mount-iron-official", "Mount Iron步道", "official", "https://www.wanaka.co.nz/explore/mount-iron-walk/", "Lake Wānaka Tourism"),
  resource("kika-official", "Kika", "restaurant", "https://kika.nz/", "待预约"),
  resource("paradiso-official", "Cinema Paradiso", "official", "https://www.paradiso.nz/", "官网"),
  resource("rippon-official", "Rippon品酒预约说明", "official", "https://rippon.co.nz/pages/tastings", "官网"),
  resource("realnz-map", "RealNZ Visitor Centre", "map", gmSearch("RealNZ+Visitor+Centre%2C+85+Lakefront+Drive%2C+Te+Anau%2C+New+Zealand"), "集合点"),
  resource("realnz-walk-route", "住宿步行到RealNZ集合点", "map", "https://www.google.com/maps/dir/?api=1&origin=3+Thomson+Place%2C+Te+Anau%2C+New+Zealand&destination=RealNZ+Visitor+Centre%2C+85+Lakefront+Drive%2C+Te+Anau%2C+New+Zealand&travelmode=walking", "步行约15–20分钟"),
  resource("redcliff-official", "The Redcliff", "restaurant", "https://theredcliff.co.nz/", "待预约"),
  resource("blue-kanu-official", "Blue Kanu", "restaurant", "https://www.queenstownnz.co.nz/listing/blue-kanu-restaurant/1436/", "待预约"),
  resource("boundary-street-map", "Boundary Street停车场", "map", gmSearch("Boundary+Street+Car+Park%2C+Queenstown%2C+New+Zealand"), "中心停车参考"),
  resource("qldc-parking-official", "QLDC停车地图与规则", "official", "https://www.qldc.govt.nz/parking", "QLDC"),
  resource("bennetts-bluff-official", "Bennetts Bluff观景步道", "official", "https://www.doc.govt.nz/parks-and-recreation/places-to-go/otago/places/glenorchy-area/things-to-do/bennetts-bluff-view-point-walk/", "DOC"),
  resource("glenorchy-lagoon-official", "Glenorchy Lagoon路线", "official", "https://www.queenstownnz.co.nz/listing/glenorchy-lagoon-walkway/9102/", "Destination Queenstown"),
  resource("glenorchy-lagoon-map", "Glenorchy Lagoon步道入口", "map", gmSearch("Glenorchy+Lagoon+Walkway%2C+Glenorchy%2C+New+Zealand"), "Google Maps"),
  resource("zqn-map", "Queenstown Airport", "map", gmSearch("Queenstown+Airport%2C+New+Zealand"), "Google Maps"),
  resource("qt-airport-rental-official", "Queenstown机场租车网点说明", "official", "https://www.queenstownairport.co.nz/parking-transport/transport-options/car-rentals/", "机场官网"),
  resource("shire-rest-map", "The Shire’s Rest报到点", "map", gmSearch("The+Shire%27s+Rest%2C+501+Buckland+Road%2C+Hinuera%2C+Matamata+3472%2C+New+Zealand"), "Google Maps"),
  resource("hobbiton-faq-official", "Hobbiton官方FAQ", "official", "https://www.hobbitontours.com/plan-visit/frequently-asked-questions/", "官网"),
  resource("hobbiton-transfers-official", "Hobbiton官方交通伙伴", "official", "https://www.hobbitontours.com/plan-visit/transfers/", "官网"),
  resource("art-gallery-map", "Auckland Art Gallery Toi o Tāmaki", "map", gmSearch("Auckland+Art+Gallery+Toi+o+Tamaki%2C+1+Kitchener+Street%2C+Auckland%2C+New+Zealand"), "Google Maps"),
  resource("art-gallery-official", "Auckland Art Gallery参观信息", "official", "https://www.aucklandartgallery.com/visit/plan-your-visit", "官网"),
  resource("amano-map", "Amano", "restaurant", gmSearch("Amano%2C+68+Tyler+Street%2C+Auckland%2C+New+Zealand"), "Google Maps"),
  resource("amano-official", "Amano预约", "restaurant", "https://savor.co.nz/amano", "官网"),
  resource("akl-intl-map", "Auckland Airport国际航站楼", "map", gmSearch("Auckland+Airport+International+Terminal%2C+New+Zealand"), "Google Maps"),
  resource("akl-departure-official", "Auckland机场出发指南", "official", "https://www.aucklandairport.co.nz/information/departure-information", "机场官网"),
  resource("pvg-map", "上海浦东国际机场", "map", gmSearch("Shanghai+Pudong+International+Airport"), "落地机场以出票为准"),
  resource("mackenzie-parking-official", "Mackenzie停车规则", "official", "https://www.mackenzie.govt.nz/services/roading-and-transport/parking", "Mackenzie District Council"),
  resource("nzta-journey-official", "NZTA路况", "official", "https://www.journeys.nzta.govt.nz/journey-planner", "NZTA"),
  resource("nzta-five-rivers-official", "NZTA Five Rivers路口资料", "official", "https://www.nzta.govt.nz/driving-skills/safe-driving-habits/following-speed-limits/state-highway-speed-management/speed-limit-reviews-under-the-2024-rule/targeted-speed-limit-reviews-canterbury-west-coast-southland/sh6-five-riverssh97-isz-approved-speed-limit-change-100kmh-100-60kmh-variable", "NZTA"),
  resource("govt-holidays-official", "新西兰政府假期表", "official", "https://www.govt.nz/browse/work/public-holidays-and-work/public-holidays-and-anniversary-dates/", "govt.nz"),
  // Driving routes (Google Maps directions)
  resource("chc-airport-route", "基督城机场至住宿参考路线", "map", "https://www.google.com/maps/dir/?api=1&origin=Christchurch+Airport%2C+New+Zealand&destination=175+Riccarton+Road%2C+Riccarton%2C+Christchurch%2C+New+Zealand&travelmode=driving", "导航01"),
  resource("nav02-a-route", "前半程至Tekapo", "map", "https://www.google.com/maps/dir/?api=1&origin=175+Riccarton+Road%2C+Riccarton%2C+Christchurch%2C+New+Zealand&destination=Church+of+the+Good+Shepherd%2C+Pioneer+Drive%2C+Lake+Tekapo%2C+New+Zealand&travelmode=driving&waypoints=Ashburton%2C+New+Zealand%7CGeraldine%2C+Canterbury%2C+New+Zealand%7CFairlie+Bakehouse%2C+Fairlie%2C+New+Zealand", "导航02"),
  resource("nav02-b-route", "后半程至Twizel", "map", "https://www.google.com/maps/dir/?api=1&origin=Church+of+the+Good+Shepherd%2C+Pioneer+Drive%2C+Lake+Tekapo%2C+New+Zealand&destination=Twizel+Holiday+Park%2C+122+Mackenzie+Drive%2C+Twizel%2C+New+Zealand&travelmode=driving&waypoints=Lake+Pukaki+Visitor+Centre%2C+New+Zealand", "导航02"),
  resource("white-horse-hill-route", "先到Hooker起点停车场", "map", "https://www.google.com/maps/dir/?api=1&origin=Twizel+Holiday+Park%2C+122+Mackenzie+Drive%2C+Twizel%2C+New+Zealand&destination=White+Horse+Hill+Car+Park%2C+Hooker+Valley+Road%2C+New+Zealand&travelmode=driving", "导航03"),
  resource("peters-lookout-route", "返程经Peter’s Lookout", "map", "https://www.google.com/maps/dir/?api=1&origin=White+Horse+Hill+Car+Park%2C+Hooker+Valley+Road%2C+New+Zealand&destination=Twizel+Holiday+Park%2C+122+Mackenzie+Drive%2C+Twizel%2C+New+Zealand&travelmode=driving&waypoints=Peter%27s+Lookout%2C+Lake+Pukaki%2C+New+Zealand", "导航03"),
  resource("tasman-route", "可选Tasman停车场", "map", "https://www.google.com/maps/dir/?api=1&origin=White+Horse+Hill+Car+Park%2C+Hooker+Valley+Road%2C+New+Zealand&destination=Tasman+Valley+Car+Park%2C+New+Zealand&travelmode=driving", "导航03"),
  resource("lake-loop-route", "湖区午餐小环线", "map", "https://www.google.com/maps/dir/?api=1&origin=Twizel+Holiday+Park%2C+122+Mackenzie+Drive%2C+Twizel%2C+New+Zealand&destination=Twizel+Holiday+Park%2C+122+Mackenzie+Drive%2C+Twizel%2C+New+Zealand&travelmode=driving&waypoints=Lake+Ruataniwha+Reserve%2C+Twizel%2C+New+Zealand%7CHigh+Country+Salmon%2C+2602+Twizel-Omarama+Highway%2C+Twizel%2C+New+Zealand", "导航04"),
  resource("pukaki-visitor-route", "可选Pukaki南岸", "map", "https://www.google.com/maps/dir/?api=1&origin=Twizel+Holiday+Park%2C+122+Mackenzie+Drive%2C+Twizel%2C+New+Zealand&destination=Lake+Pukaki+Visitor+Centre%2C+New+Zealand&travelmode=driving", "导航04"),
  resource("lindis-pass-route", "完整山口路线", "map", "https://www.google.com/maps/dir/?api=1&origin=Twizel+Holiday+Park%2C+122+Mackenzie+Drive%2C+Twizel%2C+New+Zealand&destination=1+Outlet+Road%2C+Wanaka%2C+New+Zealand&travelmode=driving&waypoints=Omarama%2C+New+Zealand%7CLindis+Pass+Lookout%2C+New+Zealand%7CLuggate%2C+New+Zealand", "导航05"),
  resource("nav05-a-route", "前半程到Lindis Pass", "map", "https://www.google.com/maps/dir/?api=1&origin=Twizel+Holiday+Park%2C+122+Mackenzie+Drive%2C+Twizel%2C+New+Zealand&destination=Lindis+Pass+Lookout%2C+New+Zealand&travelmode=driving&waypoints=Omarama%2C+New+Zealand", "导航05"),
  resource("nav05-b-route", "后半程到已订住宿", "map", "https://www.google.com/maps/dir/?api=1&origin=Lindis+Pass+Lookout%2C+New+Zealand&destination=1+Outlet+Road%2C+Wanaka%2C+New+Zealand&travelmode=driving&waypoints=Luggate%2C+New+Zealand", "导航05"),
  resource("mount-iron-route", "去Mount Iron", "map", "https://www.google.com/maps/dir/?api=1&origin=1+Outlet+Road%2C+Wanaka%2C+New+Zealand&destination=Mount+Iron+Track+Car+Park%2C+Wanaka%2C+New+Zealand&travelmode=driving", "导航06"),
  resource("wanaka-lakefront-route", "去湖滨", "map", "https://www.google.com/maps/dir/?api=1&origin=Mount+Iron+Track+Car+Park%2C+Wanaka%2C+New+Zealand&destination=Wanaka+Lakefront%2C+Ardmore+Street%2C+Wanaka%2C+New+Zealand&travelmode=driving", "导航06"),
  resource("kika-route", "去Kika晚餐", "map", "https://www.google.com/maps/dir/?api=1&origin=1+Outlet+Road%2C+Wanaka%2C+New+Zealand&destination=Kika%2C+2+Dunmore+Street%2C+Wanaka%2C+New+Zealand&travelmode=driving", "导航06"),
  resource("waterfall-creek-route", "平缓备选Waterfall Creek", "map", "https://www.google.com/maps/dir/?api=1&origin=1+Outlet+Road%2C+Wanaka%2C+New+Zealand&destination=Waterfall+Creek+Car+Park%2C+Wanaka%2C+New+Zealand&travelmode=driving", "导航06"),
  resource("nav07-leg1-route", "第一段经Cromwell到Frankton", "map", "https://www.google.com/maps/dir/?api=1&origin=1+Outlet+Road%2C+Wanaka%2C+New+Zealand&destination=Frankton%2C+Queenstown%2C+New+Zealand&travelmode=driving&waypoints=Cromwell+Heritage+Precinct%2C+Cromwell%2C+New+Zealand", "导航07"),
  resource("nav07-leg2-route", "第二段到Te Anau", "map", "https://www.google.com/maps/dir/?api=1&origin=Frankton%2C+Queenstown%2C+New+Zealand&destination=3+Thomson+Place%2C+Te+Anau%2C+New+Zealand&travelmode=driving&waypoints=Kingston%2C+Otago%2C+New+Zealand%7CFive+Rivers%2C+Southland%2C+New+Zealand%7CMossburn%2C+New+Zealand", "导航07"),
  resource("crown-range-route", "备选：Crown Range + Arrowtown到Frankton", "map", "https://www.google.com/maps/dir/?api=1&origin=1+Outlet+Road%2C+Wanaka%2C+New+Zealand&destination=Frankton%2C+Queenstown%2C+New+Zealand&travelmode=driving&waypoints=Cardrona+Hotel%2C+Cardrona%2C+New+Zealand%7CArrowtown%2C+New+Zealand", "路线建议，非原行程主线"),
  resource("nav08-route", "完整路线到Fernhill", "map", "https://www.google.com/maps/dir/?api=1&origin=3+Thomson+Place%2C+Te+Anau%2C+New+Zealand&destination=15+Greenstone+Place%2C+Fernhill%2C+Queenstown%2C+New+Zealand&travelmode=driving&waypoints=Mossburn%2C+New+Zealand%7CFive+Rivers%2C+Southland%2C+New+Zealand%7CKingston%2C+Otago%2C+New+Zealand", "导航08"),
  resource("nav09-out-route", "去程经Bennetts Bluff", "map", "https://www.google.com/maps/dir/?api=1&origin=15+Greenstone+Place%2C+Fernhill%2C+Queenstown%2C+New+Zealand&destination=Glenorchy+Wharf%2C+Glenorchy%2C+New+Zealand&travelmode=driving&waypoints=Bennetts+Bluff+Viewpoint%2C+Queenstown-Glenorchy+Road%2C+New+Zealand", "导航09"),
  resource("nav09-back-route", "Glenorchy回住宿", "map", "https://www.google.com/maps/dir/?api=1&origin=Glenorchy+Wharf%2C+Glenorchy%2C+New+Zealand&destination=15+Greenstone+Place%2C+Fernhill%2C+Queenstown%2C+New+Zealand&travelmode=driving", "导航09"),
  resource("nav10-route", "机场方向参考路线", "map", "https://www.google.com/maps/dir/?api=1&origin=15+Greenstone+Place%2C+Fernhill%2C+Queenstown%2C+New+Zealand&destination=Queenstown+Airport%2C+New+Zealand&travelmode=driving", "导航10"),
  resource("nav11-out-route", "市区参考起点经Matamata到现场", "map", "https://www.google.com/maps/dir/?api=1&origin=Britomart%2C+Auckland%2C+New+Zealand&destination=The+Shire%27s+Rest%2C+501+Buckland+Road%2C+Hinuera%2C+Matamata+3472%2C+New+Zealand&travelmode=driving&waypoints=Matamata+i-SITE+Visitor+Information+Centre%2C+Matamata%2C+New+Zealand", "导航11"),
  resource("nav11-matamata-route", "Matamata休息后到现场", "map", "https://www.google.com/maps/dir/?api=1&origin=Matamata+i-SITE+Visitor+Information+Centre%2C+Matamata%2C+New+Zealand&destination=The+Shire%27s+Rest%2C+501+Buckland+Road%2C+Hinuera%2C+Matamata+3472%2C+New+Zealand&travelmode=driving", "导航11"),
  resource("nav11-back-route", "现场回Auckland市中心参考", "map", "https://www.google.com/maps/dir/?api=1&origin=The+Shire%27s+Rest%2C+501+Buckland+Road%2C+Hinuera%2C+Matamata+3472%2C+New+Zealand&destination=Britomart%2C+Auckland%2C+New+Zealand&travelmode=driving", "导航11"),
];

function kv(key, value) {
  return { key, value };
}

function stage(stage_id, title, day_ids, image_url, summary) {
  return { stage_id, title, day_ids, image_url, summary };
}

function day(values) {
  return {
    day_id: values.id,
    day_label: values.label,
    date: values.date,
    weekday: values.weekday,
    city: values.city,
    base: values.base,
    lat: values.lat,
    lon: values.lon,
    title: values.title,
    focus: values.focus,
    lodging: values.lodging,
    lodging_status: values.lodgingStatus,
    climate_note: values.climate,
    clothing_note: values.clothing,
    cover_image_url: values.coverImageUrl || "",
    cover_image_alt: values.coverImageAlt || "",
    transport: values.transport,
    leave_by: values.leaveBy,
    lodging_resource_id: values.lodgingResource,
    primary_resource_id: values.primary,
    ticket_resource_id: values.ticket,
    drive_id: values.drive || "",
    notes: (values.notes || []).join("\n"),
  };
}

function block(day_id, sort_order, period, place, activity, highlight, tip, resource_ids = "") {
  return { day_id, sort_order, period, place, activity, highlight, tip, resource_ids };
}

function drive(drive_id, day_id, title, duration, sequence, notes, resource_ids) {
  return { drive_id, day_id, title, duration, sequence, notes, resource_ids };
}

function leg(drive_id, sort_order, segment, drive_time, stop_note) {
  return { drive_id, sort_order, segment, drive_time, stop_note };
}

function lodging(sort_order, check_in, check_out, name, room, detail, resource_id, status, free_cancel_until, after_deadline) {
  return { sort_order, check_in, check_out, name, room, detail, resource_id, status, free_cancel_until, after_deadline };
}

function todo(sort_order, kind, due_date, due_label, title, detail) {
  return { sort_order, kind, due_date, due_label, title, detail };
}

function advice_(sort_order, title, verdict, day_ids, detail, action, resource_ids) {
  return { sort_order, title, verdict, day_ids, detail, action, resource_ids };
}

function resource(resource_id, title, type, url, source_note) {
  return { resource_id, title, type, url, image_url: "", image_alt: "", source_note };
}
