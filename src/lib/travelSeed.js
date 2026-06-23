export const tripItemStatuses = ["已订好", "还没订", "到时再看"];

export const listSections = [
  { kind: "lodging", title: "住哪里" },
  { kind: "booking", title: "还要订什么" },
  { kind: "budget", title: "预算心里有数" },
  { kind: "food", title: "想吃什么" },
  { kind: "activity", title: "活动和门票" },
];

export const initialTravelDays = [
  day("d0", 0, "2026-07-28", "周二", "上海 -> 香港 -> 墨尔本", "出发日", "香港转机 1h35m，夜航飞墨尔本。", "飞机上", "长途飞行，注意休息。", "飞机上和机场空调冷，带薄外套。", [
    block("d0-flight", "全天", "上海 -> 香港 -> 墨尔本", "出发，香港转机后夜航飞墨尔本", "旅程开始", "随身带证件、充电线、薄外套"),
  ]),
  day("d1", 1, "2026-07-29", "周三", "墨尔本", "抵达墨尔本", "恢复日，不硬玩。", "Oaks Melbourne on Market Hotel", "墨尔本冬季约 6-14C，早晚冷，多风，偶有阵雨。", "羽绒服或防风外套、毛衣、长裤、防水鞋。", [
    block("d1-morning", "早上", "墨尔本机场 -> CBD", "入境、取行李，打车或 SkyBus 进城", "初到澳洲，适应气候", "4 人同行和行李较多时，打车或 Uber 更舒服"),
    block("d1-breakfast", "上午", "CBD", "咖啡早餐，酒店寄存行李", "墨尔本咖啡文化开场", "不要急着开始暴走"),
    block("d1-rest", "下午", "酒店", "入住、补觉、洗澡", "调整时差", "这是保证后面自驾状态的关键"),
    block("d1-river", "傍晚", "Southbank / Yarra River", "河边散步", "墨尔本夜景、城市氛围", "轻松走走即可"),
    block("d1-dinner", "晚上", "Southbank", "河畔晚餐", "冬日城市感", "可看 Riverland Bar、Ponyfish Island 或 Southbank 河边餐厅"),
  ]),
  day("d2", 2, "2026-07-30", "周四", "墨尔本市区", "墨尔本城市漫步", "城市适应、咖啡、市集、巷弄艺术和轻量文化体验。", "Oaks Melbourne on Market Hotel", "墨尔本冬季约 6-14C，早晚冷，多风，偶有阵雨。", "防风外套、毛衣、长裤、防水鞋。", [
    block("d2-library", "上午", "State Library / Queen Victoria Market", "看州立图书馆经典阅览室，再逛 QVM 市场", "历史建筑和市井生活", "QVM 周四开放；图书馆短暂停留即可"),
    block("d2-lunch", "中午", "Degraves Street / Hardware Lane", "Brunch 或简餐，体验咖啡巷弄", "laneway culture", "如果 QVM 吃多了，这里只喝咖啡也可以"),
    block("d2-ngv", "下午", "Hosier Lane / NGV", "涂鸦巷拍照，再去 NGV 看展或休息", "街头艺术和文艺墨尔本", "Hosier Lane 20-30 分钟即可"),
    block("d2-skydeck", "傍晚", "Southbank / Melbourne Skydeck", "天气好上 Skydeck，否则回 Southbank 晚餐", "河岸夜景或高空视角", "Skydeck 不提前锁死，按天气决定"),
    block("d2-ready", "晚上", "CBD", "晚餐，检查取车信息和驾照材料", "为大洋路自驾准备", "提前准备车上零食和水"),
  ], "可用 Melbourne Museum 替代 NGV 或 Skydeck；晴天想放慢节奏可去 Royal Botanic Gardens；坏天气优先保留室内点。"),
  day("d3", 3, "2026-07-31", "周五", "墨尔本 -> Apollo Bay", "大洋路 Road Trip Day 1", "正式开始海边公路，不赶路，享受驾驶。", "Seaview Motel & Apartments", "维州南海岸冬季多风，约 6-14C，海边体感更冷。", "防风外套、长裤、防水鞋，车上备水和零食。", [
    block("d3-car", "上午", "墨尔本 -> Torquay", "提车出发，开往大洋路起点", "Road trip 正式开始", "右舵第一天，不要赶"),
    block("d3-bells", "上午", "Bells Beach", "停车看冲浪海岸", "经典冲浪海滩", "风大，短暂停留即可"),
    block("d3-lorne", "中午", "Lorne", "小镇午餐、咖啡", "大洋路舒服小镇", "作为今日主要休息点"),
    block("d3-koala", "下午", "Kennett River", "找野生考拉", "轻松、有趣", "抬头看桉树，不保证但机会不错"),
    block("d3-apollo", "傍晚", "Apollo Bay", "抵达入住", "海边小镇，节奏慢", "天黑前抵达最理想"),
    block("d3-dinner", "晚上", "Apollo Bay", "海鲜晚餐", "安静的南部海岸夜晚", "可考虑 Apollo Bay Fishermen's Co-Op"),
  ]),
  day("d4", 4, "2026-08-01", "周六", "Apollo Bay -> Port Campbell", "大洋路 Road Trip Day 2", "大洋路景观最强的一天。", "Southern Ocean Villas", "南海岸冬季湿冷多风，雨林和海岸都可能有阵雨。", "防风防水外套、防滑鞋，海边注意风浪。", [
    block("d4-maits", "上午", "Maits Rest Rainforest Walk", "雨林短步道", "冬日湿润雨林", "步道轻松，适合作为早晨活动"),
    block("d4-apostles", "中午", "Twelve Apostles", "前往十二使徒岩观景", "世界级海岸地貌", "停车场到观景台方便"),
    block("d4-gibson", "下午", "Gibson Steps / Loch Ard Gorge", "下到海滩或峡谷观景", "比十二使徒更有沉浸感", "按开放情况和风浪决定"),
    block("d4-port", "傍晚", "Port Campbell", "入住小镇", "方便第二天补拍", "不要当天回墨尔本"),
    block("d4-dinner", "晚上", "Port Campbell", "小镇晚餐或 villa BBQ", "安静、实用", "餐厅选择有限，尽早吃；BBQ 需确认可用"),
  ]),
  day("d5", 5, "2026-08-02", "周日", "Port Campbell -> 墨尔本机场", "早晨补拍和内陆回程", "早晨补拍，内陆高速回墨尔本机场，还车休整。", "Holiday Inn Melbourne Airport", "维州冬季早晚冷，内陆回程风雨变化快。", "外套继续随身，回到机场酒店后整理热带段衣物。", [
    block("d5-photos", "早上", "Twelve Apostles / Loch Ard Gorge", "早晨补拍", "光线柔和，人相对少", "如果 D4 天气不好，这天可补救"),
    block("d5-checkout", "上午", "Port Campbell", "早餐、退房", "海边小镇慢节奏", "不要拖太晚"),
    block("d5-colac", "中午", "Colac", "午餐、加油", "内陆牧场风光", "回程中段休息点"),
    block("d5-airport", "下午", "墨尔本机场附近", "抵达、还车、入住", "为次日早班机准备", "建议住 Tullamarine 附近"),
    block("d5-pack", "晚上", "机场酒店", "整理行李，厚衣服收好", "准备热带段", "洗衣、补给、早睡"),
  ]),
  day("d6", 6, "2026-08-03", "周一", "墨尔本 -> 凯恩斯", "飞进热带", "从冬天飞进热带，轻松适应。", "Southern Cross Atrium Apartments", "凯恩斯约 17-26C，旱季阳光足，室内空调可能很冷。", "短袖、泳装、防晒衣、墨镜、帽子、薄外套。", [
    block("d6-flight", "上午", "墨尔本机场", "VA1291 飞往凯恩斯", "气候切换明显", "国内航班建议预留行李额"),
    block("d6-transfer", "中午", "凯恩斯", "打车或 Uber 到酒店", "降低疲劳", "酒店可先寄存行李"),
    block("d6-lagoon", "下午", "Esplanade Lagoon", "免费泻湖泳池、海滨散步", "度假感拉满", "泳衣可提前放随身包"),
    block("d6-market", "晚上", "Cairns Night Markets", "夜市、简餐、纪念品", "热闹轻松", "今日不安排正式大餐"),
  ]),
  day("d7", 7, "2026-08-04", "周二", "凯恩斯", "大堡礁外礁一日游", "凯恩斯最重要的一天，优先 Reef Magic Outer Reef Pontoon。", "Southern Cross Atrium Apartments", "海上日晒强，船舱空调冷，海况影响体感。", "防晒衣、泳装、帽子、墨镜、薄外套，提前吃晕船药。", [
    block("d7-boat", "早上", "凯恩斯码头", "登船出海前往外堡礁", "外礁平台体验开始", "提前吃晕船药，不要卡点到码头"),
    block("d7-reef", "全天", "Outer Reef Pontoon", "浮潜、半潜艇、玻璃底船、可选深潜", "珊瑚、热带鱼、大堡礁体验", "防晒衣比防晒霜更重要"),
    block("d7-lunch", "中午", "船上 / 平台", "自助午餐", "轻松补给", "不要吃太撑，避免晕船"),
    block("d7-return", "下午", "凯恩斯码头", "返航下船休息", "完成大堡礁主线", "晚上不要订太正式的餐厅"),
    block("d7-dinner", "晚上", "码头附近", "Salt House / Dundee's / Prawn Star 可选", "海边晚餐", "轻松即可"),
  ]),
  day("d8", 8, "2026-08-05", "周三", "丹翠雨林", "丹翠雨林 + Cape Tribulation 小团一日游", "交给当地司机和向导，专心看热带雨林、鳄鱼河道和雨林入海。", "Southern Cross Atrium Apartments", "热带雨林湿热，车内和船舱空调可能偏冷。", "短袖、防晒、防蚊、帽子、雨具和薄外套。", [
    block("d8-pickup", "清晨", "凯恩斯酒店 -> 丹翠方向", "6:55 酒店门口集合，跟团车北上", "不用自驾，沿途可休息", "早上提前吃一点，带水和防晒"),
    block("d8-river", "上午", "Daintree River / Rainforest", "鳄鱼游船、雨林步道", "野生鳄鱼、鸟类、红树林、热带雨林生态", "野生动物不保证，但 Daintree River 是经典鳄鱼河道"),
    block("d8-lunch", "中午", "Daintree Rainforest", "团含午餐", "不用自己找餐厅", "如有忌口提前告知"),
    block("d8-cape", "下午", "Cape Tribulation", "雨林入海、海滩短停留", "这天最特别的画面", "不建议下海游泳，注意鳄鱼、水母和警示牌"),
    block("d8-icecream", "下午后段", "Daintree Ferry / Ice Cream", "渡河、热带水果冰淇淋", "Daintree Ice-Cream Company only here 体验", "冰淇淋已包含在 Billy Tea 行程内"),
    block("d8-return", "傍晚", "凯恩斯", "18:30 后回到市区", "回程可休息", "晚餐简单，不再加夜间项目"),
  ]),
  day("d9", 9, "2026-08-06", "周四", "阿瑟顿高原", "阿瑟顿高原轻量自驾", "用火山湖、巨树、高原小镇和瀑布补足凯恩斯内陆自然体验。", "Southern Cross Atrium Apartments", "高原比凯恩斯海边清凉，日晒仍强。", "短袖加薄外套，穿适合步道和瀑布边的鞋。", [
    block("d9-drive", "早上", "凯恩斯 -> Lake Eacham", "取车后开上 Atherton Tablelands", "从热带海边进入清凉高原", "8:30-9:00 出发比较理想"),
    block("d9-lake", "上午", "Lake Eacham", "火山湖散步、看湖景", "安静、清凉、湖水和雨林包围感", "走一小段湖边步道即可"),
    block("d9-tree", "上午 / 中午", "Curtain Fig Tree", "看巨型帘状无花果树", "热带森林里的自然装置", "停留 20-30 分钟即可"),
    block("d9-lunch", "中午", "Yungaburra / Gallo Dairyland", "小镇午餐、咖啡、奶制品、巧克力", "高原小镇和牧场氛围", "中段坐下来休息，不要拖太久"),
    block("d9-falls", "下午", "Millaa Millaa Falls / Ellinjaa Falls", "瀑布短停留、拍照", "阿瑟顿视觉高潮", "优先 Millaa Millaa，体力够再加 Ellinjaa"),
    block("d9-return", "傍晚", "凯恩斯", "下山回市区，还车或次日早还", "完成高原自然线", "尽量 15:30-16:00 开始回程"),
    block("d9-dinner", "晚上", "凯恩斯", "简单晚餐", "恢复体力", "不安排正式大餐"),
  ]),
  day("d10", 10, "2026-08-07", "周五", "凯恩斯休息日", "凯恩斯休息日 + 市区收尾", "真正的恢复日，休息、洗衣、整理行李、吃好一点但不折腾。", "Southern Cross Atrium Apartments", "凯恩斯约 17-26C，白天热，室内空调冷。", "轻便夏装、防晒用品，夜间带薄外套。", [
    block("d10-rustys", "上午", "Rusty's Market", "买热带水果、咖啡、简单早餐", "周五正好开市", "买能当天吃完或飞前吃完的，不要太多"),
    block("d10-rest", "中午", "酒店 / Esplanade Lagoon", "酒店休息、泳池或泻湖", "热带城市躺平感", "不安排远距离移动"),
    block("d10-pack", "下午", "凯恩斯市区", "洗衣、整理行李、按摩或 Cairns Aquarium 可选", "为次日清晨航班做准备", "Jetstar 行李控制在 20kg 内"),
    block("d10-walk", "傍晚", "Esplanade", "海边散步", "凯恩斯最后一个轻松黄昏", "不要走太远"),
    block("d10-dinner", "晚上", "Prawn Star / Salt House / Night Markets", "海鲜或轻松简餐", "早点吃，早点睡", "不要再临时加长线"),
  ]),
  day("d11", 11, "2026-08-08", "周六", "凯恩斯 -> 悉尼", "转场到悉尼", "清晨转场日，从热带回到大城市，晚上开启悉尼海港夜景。", "Oaks Sydney Goldsbrough Suites", "悉尼约 9-18C，晴天概率较好，早晚凉。", "薄羽绒、风衣或卫衣、长裤；海边防风。", [
    block("d11-airport", "清晨", "凯恩斯酒店 -> 凯恩斯机场 T2", "早起退房，打车或 Uber 前往机场", "转场日开始", "前一晚必须完成打包"),
    block("d11-flight", "上午", "凯恩斯 -> 悉尼", "JQ953 06:45-09:45 飞悉尼", "回到冬季海港城市", "随身带薄外套"),
    block("d11-transfer", "上午 / 中午", "悉尼 T2 -> 酒店", "打车或 Uber 前往 Oaks Sydney Goldsbrough Suites", "4 人加行李省心", "如不能入住，先寄存行李"),
    block("d11-rest", "下午", "Darling Harbour / 酒店周边", "轻松适应，简单午餐或休息", "恢复清晨航班疲劳", "熟悉酒店附近环境"),
    block("d11-rocks", "傍晚", "The Rocks", "岩石区散步、晚餐", "砂岩建筑、老城氛围", "悉尼第一晚适合这里"),
    block("d11-quay", "晚上", "Circular Quay", "看歌剧院、海港大桥夜景", "悉尼开场画面", "轻松看夜景即可"),
  ]),
  day("d12", 12, "2026-08-09", "周日", "悉尼市区", "悉尼经典地标", "悉尼明信片路线。", "Oaks Sydney Goldsbrough Suites", "悉尼冬季早晚凉，海港边有风。", "薄羽绒、风衣或卫衣，适合步行的鞋。", [
    block("d12-opera", "上午", "Circular Quay / Opera House", "歌剧院外观或内部导览", "悉尼核心地标", "中文导览可提前订"),
    block("d12-garden", "中午", "Royal Botanic Garden", "植物园散步", "海港景观非常好", "路线轻松"),
    block("d12-chair", "下午", "Mrs Macquarie's Chair", "拍歌剧院和海港大桥同框", "最经典机位", "晴天很好看"),
    block("d12-qvb", "傍晚", "QVB / Westfield", "购物、室内休息", "建筑漂亮，适合逛", "商店关门较早"),
    block("d12-dinner", "晚上", "CBD / Darling Harbour", "晚餐", "城市夜景", "不要太晚睡，次日弹性日"),
  ]),
  day("d13", 13, "2026-08-10", "周一", "悉尼弹性一日游", "悉尼弹性一日游", "首选南海岸 Grand Pacific Drive；备选蓝山 Blue Mountains，按天气决定。", "Oaks Sydney Goldsbrough Suites", "南海岸海风大；蓝山比悉尼冷约 5C，雾雨会影响景观。", "防风外套、长裤、舒适鞋；蓝山方案多带一层。", [
    block("d13-start", "早上", "悉尼", "按天气选择南海岸自驾或蓝山方案", "不锁死不可退项目", "临近天气明朗后再决定"),
    block("d13-coast-am", "上午", "Royal National Park / Bald Hill Lookout", "若选南海岸，租车南下看海岸线", "Grand Pacific Drive 开场", "尽量避开早高峰，风大注意保暖"),
    block("d13-coast-pm", "中午 / 下午", "Sea Cliff Bridge / Wollongong / Kiama", "驶上海崖桥，午餐、海边散步、看 Kiama Blowhole", "明亮海岸线", "不要危险停车，不建议继续往更南开"),
    block("d13-blue-am", "上午", "Katoomba / Echo Point", "若选蓝山，看 Three Sisters 三姐妹峰", "经典山地景观", "早到人少，山上更冷"),
    block("d13-blue-pm", "中午 / 下午", "Leura / Scenic World", "小镇午餐，缆车、小火车和雨林步道", "蓝山核心体验", "预留 2-3 小时"),
    block("d13-return", "傍晚 / 晚上", "悉尼", "返回市区，简单晚餐", "完成一日自然线", "晚上不要安排正式大餐"),
  ], "Blue Mountains 方案：悉尼到 Katoomba，Echo Point 看 Three Sisters，Leura 小镇午餐，Scenic World 2-3 小时，适合晴朗但海边风大或南海岸天气不佳。优点是澳洲经典自然景观，缺点是冷、风大，阴雨或雾天会明显降级。Grand Pacific Drive 方案：悉尼南下 Royal National Park、Bald Hill Lookout、Sea Cliff Bridge、Wollongong / Kiama，再回悉尼。适合晴天想开海边公路，和大洋路互补；缺点是需要额外租车一天，悉尼出城和停车更麻烦，下雨体验下降。"),
  day("d14", 14, "2026-08-11", "周二", "悉尼", "出海观鲸 + Bondi", "冬季悉尼海洋体验。", "Oaks Sydney Goldsbrough Suites", "海上和 Bondi 海边都要防风，出海看海况。", "防风外套、长裤，提前吃晕船药。", [
    block("d14-whale", "上午", "Circular Quay / Darling Harbour", "出海观鲸", "座头鲸迁徙季", "提前吃晕船药，穿防风外套"),
    block("d14-lunch", "中午", "市区", "返回后简单午餐", "休整", "出海后不要马上安排重体力"),
    block("d14-bondi", "下午", "Bondi Beach", "海滩散步、Icebergs 拍照", "悉尼最有名海滩", "冬天不晒，适合走"),
    block("d14-walk", "傍晚", "Bondi to Coogee Coastal Walk", "走一段海岸步道", "悬崖步道、海岸线", "不必全程走完"),
    block("d14-dinner", "晚上", "Bondi / CBD", "晚餐", "轻松收尾", "看体力决定回市区还是海边吃"),
  ]),
  day("d15", 15, "2026-08-12", "周三", "悉尼", "Manly Ferry + 最后采购 + Cafe Sydney 告别晚餐", "轻松收尾，把所有购物和退税准备完成。", "Oaks Sydney Goldsbrough Suites", "悉尼海港和海边早晚有风。", "薄羽绒或风衣，购物后留出整理行李时间。", [
    block("d15-ferry", "上午", "Circular Quay -> Manly", "坐 Ferry 去 Manly", "渡轮本身就是海港巡游", "看歌剧院和海港大桥角度很好"),
    block("d15-manly", "中午", "Manly Beach", "海边午餐、散步", "比 Bondi 更松弛", "炸鱼薯条或 beach brunch，不要吃太撑"),
    block("d15-shopping", "下午", "QVB / Chemist Warehouse / 超市", "最后采购", "药妆、保健品、伴手礼", "今天必须买完，回酒店整理退税物品"),
    block("d15-cafe", "晚上", "Cafe Sydney / Circular Quay", "告别晚餐", "海港景观和 seafood / modern Australian", "建议提前订 18:00-19:00，注意 dress code 和 surcharge"),
  ]),
  day("d16", 16, "2026-08-13", "周四", "悉尼 -> 香港 -> 上海", "返程日", "10:10 起飞，清晨前往机场，办理退税返程。", "-", "机场室内温差大，返程飞行时间长。", "随身带薄外套，退税物品和票据方便取用。", [
    block("d16-checkout", "清晨", "酒店 -> 悉尼机场", "退房，打车或 Uber 前往机场", "返程开始", "预留退税和国际航班时间"),
    block("d16-trs", "上午", "悉尼机场", "办理 TRS 退税，登机返程", "满载而归", "提前下载 TRS App 填好信息，可走快速通道"),
    block("d16-flight", "全天", "悉尼 -> 香港 -> 上海", "返程航班", "回家", "证件、退税单据、充电线随身带"),
  ]),
];

export const initialTripItems = [
  item("lodging-oaks-melbourne", "lodging", "Oaks Melbourne on Market Hotel", "d1", "墨尔本", "已订好", 2534.86, "CNY", "60 Market St；D1-D2 两晚，适合市区步行和 D3 提车。", "", 10),
  item("lodging-seaview-apollo", "lodging", "Seaview Motel & Apartments", "d3", "Apollo Bay", "已订好", 906.28, "CNY", "6 Thomson Street；大洋路第一晚，靠近小镇和海边。", "", 20),
  item("lodging-southern-ocean", "lodging", "Southern Ocean Villas", "d4", "Port Campbell", "已订好", 1691.52, "CNY", "2-6 McCue Street；靠近十二使徒岩和小镇中心。", "", 30),
  item("lodging-holiday-inn-airport", "lodging", "Holiday Inn Melbourne Airport", "d5", "墨尔本机场", "已订好", 1581.12, "CNY", "10-14 Centre Road；服务 D6 清晨 VA1291 航班。", "", 40),
  item("lodging-southern-cross", "lodging", "Southern Cross Atrium Apartments", "d6", "凯恩斯", "已订好", 9669.66, "CNY", "3-11 Water Street；D6-D10 五晚，靠近 Cairns Central。", "", 50),
  item("lodging-oaks-sydney", "lodging", "Oaks Sydney Goldsbrough Suites", "d11", "悉尼", "已订好", 9661.82, "CNY", "243 Pyrmont Street；D11-D15 五晚，适合 Darling Harbour、CBD 和海港动线。", "", 60),

  item("budget-lodging", "budget", "住宿 15 晚", "", "全程", "已订好", 26045, "CNY", "按目前酒店实际价格更新，4 人合计，人均约 ¥6,511。", "", 110),
  item("budget-international-flights", "budget", "国际机票", "", "全程", "已订好", 29200, "CNY", "国泰航空，4 人合计，人均约 ¥7,300。", "", 120),
  item("budget-domestic-flights", "budget", "澳洲国内机票", "", "全程", "已订好", 7440, "CNY", "VA1291 + JQ953，含托运行李，人均约 ¥1,860。", "", 130),
  item("budget-car-transport", "budget", "租车与交通", "", "全程", "还没订", 11500, "CNY", "大洋路 MPV、阿瑟顿和悉尼南海岸中小 SUV，含油费、停车、toll 和短途交通。", "", 140),
  item("budget-tickets", "budget", "门票活动", "", "全程", "还没订", 15350, "CNY", "Reef Magic、Daintree 小团、观鲸、歌剧院和小门票。", "", 150),
  item("budget-regular-food", "budget", "普通餐饮", "", "全程", "到时再看", 30000, "CNY", "不含 Cafe Sydney；覆盖咖啡、brunch、pub、海鲜、夜市和补给。", "", 160),
  item("budget-cafe-sydney", "budget", "Cafe Sydney 告别晚餐", "d15", "悉尼", "还没订", 4000, "CNY", "按 A$800-850 左右估算，4 人合计，人均约 ¥1,000。", "", 170),
  item("budget-misc", "budget", "杂项", "", "全程", "到时再看", 4500, "CNY", "签证、保险、SIM 卡、洗衣、小费、杂费和应急小额支出。", "", 180),
  item("budget-total", "budget", "总计", "", "全程", "到时再看", 128035, "CNY", "当前较精确执行预算；4 人合计约 ¥128,035，人均约 ¥32,009。", "", 190),

  item("activity-great-ocean-free", "activity", "大洋路免费观景点", "d4", "大洋路", "到时再看", 0, "AUD", "十二使徒岩、Loch Ard Gorge、Gibson Steps 多数免费；主要成本在租车和交通。", "", 210),
  item("activity-reef-magic", "activity", "Reef Magic 大堡礁外礁一日游", "d7", "凯恩斯", "还没订", 5400, "CNY", "参考 A$325/人或约 ¥1,350/人；含外礁平台、午餐、浮潜装备和基础观景项目。", "", 220),
  item("activity-daintree-tour", "activity", "Daintree / Cape Tribulation 小团", "d8", "丹翠雨林", "还没订", 4000, "CNY", "参考 A$190-220/人；优先酒店接送、鳄鱼游船、午餐和 Cape Tribulation。", "", 230),
  item("activity-atherton-free", "activity", "阿瑟顿高原免费自然点", "d9", "阿瑟顿高原", "到时再看", 0, "AUD", "Lake Eacham、Curtain Fig Tree、Millaa Millaa Falls 门票成本低，主要花在租车和油费。", "", 240),
  item("activity-whale", "activity", "悉尼出海观鲸", "d14", "悉尼", "已订好", 340.2, "AUD", "Captain Cook / Fantasea 类 2-2.5 小时产品；提前吃晕船药，穿防风外套。", "", 250),
  item("activity-opera-tour", "activity", "Sydney Opera House 内部导览", "d12", "悉尼", "还没订", 1000, "CNY", "中文或英文导览约 A$45-55/人；只外观拍照则可不买票。", "", 260),
  item("activity-grand-pacific", "activity", "Grand Pacific Drive / Sea Cliff Bridge", "d13", "悉尼南海岸", "到时再看", 0, "AUD", "景点免费，主要成本在悉尼一日租车、油费、toll 和停车。", "", 270),
  item("activity-blue-mountains", "activity", "Blue Mountains Scenic World", "d13", "蓝山", "到时再看", 0, "AUD", "Scenic Railway、Skyway、Cableway、Walkway；临近天气晴朗再买更稳。", "", 280),

  item("booking-great-ocean-car", "booking", "1. 大洋路租车", "d3", "墨尔本", "还没订", 11500, "CNY", "Kia Carnival / 8 座 MPV；确认保险、第二驾驶人、异地还车费、toll 和行李空间。", "", 310),
  item("booking-reef-magic", "booking", "2. 大堡礁外礁一日游", "d7", "凯恩斯", "还没订", 5400, "CNY", "优先 Reef Magic Outer Reef Pontoon；确认午餐、装备、半潜艇、玻璃底船、取消政策。", "", 320),
  item("booking-daintree", "booking", "3. Daintree / Cape Tribulation 小团", "d8", "丹翠雨林", "还没订", 4000, "CNY", "确认酒店接送、Cape Tribulation、Daintree River cruise、Ferry、午餐和回城时间。", "", 330),
  item("booking-whale", "booking", "4. 悉尼观鲸", "d14", "悉尼", "已订好", 2200, "CNY", "优先大船型和 Darling Harbour / Aquarium Wharf；确认海况取消和二次出海保障。", "", 340),
  item("booking-cafe-sydney", "booking", "5. Cafe Sydney 告别晚餐", "d15", "悉尼", "还没订", 4000, "CNY", "建议 18:00-19:00；确认主餐厅、terrace 或靠窗位，注意 dress code 和 surcharge。", "", 350),
  item("booking-opera-tour", "booking", "6. Sydney Opera House 内部导览", "d12", "悉尼", "还没订", 1000, "CNY", "中文班次通常更少；不想进内部可只保留外观拍照。", "", 360),
  item("booking-d13-weather", "booking", "7. D13 南海岸 / 蓝山天气决策", "d13", "悉尼", "到时再看", 0, "", "保持二选一，不锁死不可退项目，等天气更明朗后再决定。", "", 370),
  item("booking-south-coast-car", "booking", "8. 悉尼南海岸一日租车", "d13", "悉尼", "到时再看", 0, "", "若选 Grand Pacific Drive，确认 CBD 取还车、保险、toll、停车、第二驾驶人和雨天价值。", "", 380),
  item("booking-scenic-world", "booking", "9. 蓝山 Scenic World", "d13", "蓝山", "到时再看", 0, "", "建议 Unlimited Discovery Pass；可研究但别太早锁死不可退票。", "", 390),
  item("booking-blue-mountains-transport", "booking", "10. 蓝山交通 / 一日团", "d13", "蓝山", "到时再看", 0, "", "比较一日团、火车加当地巴士、自驾；优先可取消或灵活方案。", "", 400),
  item("booking-skydeck", "booking", "11. 墨尔本 Skydeck", "d2", "墨尔本", "到时再看", 0, "", "看天气决定；晴天、能见度高、体力够再上。", "", 410),
  item("booking-food-moments", "booking", "12. Lune / Prawn Star / Sydney Fish Market 等 food moments", "", "全程", "到时再看", 0, "", "多数不必太早锁死；景观位餐厅可提前看订位，其他保留弹性。", "", 420),

  item("food-lune", "food", "Lune Croissanterie", "d2", "墨尔本", "到时再看", 0, "", "Croissant、pain au chocolat 或 seasonal pastry；CBD Russell St 和 Lonsdale St 店顺路。", "", 510),
  item("food-adk", "food", "American Doughnut Kitchen @ QVM", "d2", "墨尔本", "到时再看", 0, "", "Hot Jam Doughnut；QVM 经典摊位，适合 D2 上午。", "", 520),
  item("food-pellegrinis", "food", "Pellegrini's Espresso Bar", "d2", "墨尔本", "到时再看", 0, "", "老派 espresso bar，适合路过 Bourke St 时喝咖啡或简餐。", "", 530),
  item("food-supernormal", "food", "Supernormal Melbourne", "d2", "墨尔本", "到时再看", 0, "", "Lobster roll、dumplings 和 modern Asian sharing dishes；都市感更强。", "", 540),
  item("food-charrd", "food", "Charrd Burger", "d2", "墨尔本", "到时再看", 0, "", "世界第 14 汉堡；在 Brunswick East，作为 D2 晚餐备选。", "", 550),
  item("food-apollo-coop", "food", "Apollo Bay Fishermen's Co-op / Co-op on Pascoe", "d3", "Apollo Bay", "到时再看", 0, "", "Fish & chips、local fish、Southern Rock Lobster；D3 Apollo Bay 晚餐重点。", "", 560),
  item("food-12-rocks", "food", "12 Rocks Beach Cafe / Beach Bar", "d4", "Port Campbell", "到时再看", 0, "", "Seafood、burger、pub-style dinner；Port Campbell 不折腾晚餐。", "", 570),
  item("food-timboon", "food", "Timboon Fine Ice Cream", "d5", "大洋路", "到时再看", 0, "", "Farm-style ice cream；D5 回墨尔本机场时可小绕补点。", "", 580),
  item("food-prawn-star", "food", "Prawn Star Cairns", "d7", "凯恩斯", "到时再看", 0, "", "Marlin Marina floating seafood restaurant；mixed prawns、oysters、bugs、platter。", "", 590),
  item("food-daintree-icecream", "food", "Daintree Ice Cream Company", "d8", "丹翠雨林", "到时再看", 0, "", "4-flavour tropical fruit signature cup；若小团经过就是强 only here 体验。", "", 600),
  item("food-rustys", "food", "Rusty's Markets Cairns", "d10", "凯恩斯", "到时再看", 0, "", "热带水果、果汁、小吃；D10 周五正好开市。", "", 610),
  item("food-gallo", "food", "Gallo Dairyland", "d9", "阿瑟顿高原", "到时再看", 0, "", "Cheese platter、chocolate、milkshake、cafe；适合阿瑟顿自驾午餐或下午茶。", "", 620),
  item("food-sydney-fish-market", "food", "Sydney Fish Market", "d12", "悉尼", "到时再看", 0, "", "Sydney rock oysters、prawns、seafood platter、fish & chips；住 Pyrmont 很顺。", "", 630),
  item("food-harrys", "food", "Harry's Cafe de Wheels", "d12", "悉尼", "到时再看", 0, "", "Tiger Pie；悉尼街头食物 icon，可作 D12 或 D15 加餐。", "", 640),
  item("food-bills", "food", "bills Sydney", "d12", "悉尼", "到时再看", 0, "", "Ricotta hotcakes 和 Aussie brunch；适合 D12 早餐或 brunch。", "", 650),
  item("food-messina", "food", "Gelato Messina", "d12", "悉尼", "到时再看", 0, "", "Gelato 和 weekly specials；D12、D14 或 D15 晚上都可顺路。", "", 660),
  item("food-gumshara", "food", "Gumshara Ramen, Haymarket", "d12", "悉尼", "到时再看", 0, "", "超浓 tonkotsu ramen；中途想换口味时标记。", "", 670),
  item("food-mamak", "food", "Mamak Haymarket", "d13", "悉尼", "到时再看", 0, "", "Roti canai、satay、Malaysian street food；适合 D12 或 D13 回城晚餐。", "", 680),
  item("food-icebergs", "food", "Icebergs Dining Room and Bar / Bergs Bistro", "d14", "Bondi", "到时再看", 0, "", "Bondi 海景餐、seafood、pasta 或 drinks；D14 下午或晚餐。", "", 690),
  item("food-hugos-felons", "food", "Hugos Manly / Felons Manly", "d15", "Manly", "到时再看", 0, "", "Waterfront pizza、oysters、seafood、beer food；重点是 ferry 后的海边氛围。", "", 700),
  item("food-cafe-sydney", "food", "Cafe Sydney 告别晚餐", "d15", "悉尼", "还没订", 4000, "CNY", "海港景观 + seafood / modern Australian；建议提前订 18:00-19:00。", "", 710),
];

function day(id, dayIndex, date, weekday, city, title, focus, lodging, climateNote, clothingNote, blocks, backupNote = "") {
  return { id, dayIndex, date, weekday, city, title, focus, lodging, climateNote, clothingNote, blocks, backupNote };
}

function block(id, period, place, activity, highlight, tip) {
  return { id, period, place, activity, highlight, tip };
}

function item(id, kind, title, relatedDayId, city, status, amount, currency, note, link, sortOrder) {
  return { id, kind, title, relatedDayId, city, status, amount, currency, note, link, sortOrder };
}
