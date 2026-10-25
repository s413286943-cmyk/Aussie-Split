import { formatCurrencyAmount } from "./currency.js";

const quickResourceTypes = new Set(["map", "booking", "restaurant", "official"]);

const baseCarryItems = [
  {
    id: "power",
    label: "手机电量 / 充电宝",
    detail: "地图、支付、票据都靠手机，出门前确认满电。",
  },
  {
    id: "booking-screenshots",
    label: "预订截图 / 离线地图",
    detail: "住宿、门票、租车确认单和当天导航提前离线保存。",
  },
];

export function findTodayDay(days, now = new Date()) {
  if (!days.length) return null;

  const today = startOfLocalDay(now).getTime();
  const first = dayTime(days[0]);
  const last = dayTime(days.at(-1));

  if (today <= first) return days[0];
  if (today >= last) return days.at(-1);

  return days.find((day) => dayTime(day) === today) || days.find((day) => dayTime(day) > today) || days.at(-1);
}

export function travelMode(days, stages, now = new Date()) {
  if (!Array.isArray(days) || !days.length) {
    return { phase: "before", currentDay: null, currentStage: null, nextDay: null };
  }
  const today = startOfLocalDay(now).getTime();
  const first = dayTime(days[0]);
  const last = dayTime(days.at(-1));
  const phase = today < first ? "before" : today > last ? "after" : "during";
  const currentDay = findTodayDay(days, now);
  const currentIndex = days.findIndex((day) => day.id === currentDay?.id);
  const currentStage = (stages || []).find((stage) => stage.dayIds.includes(currentDay?.id)) || null;
  const nextDay = phase === "after" ? null : days[currentIndex + (phase === "during" ? 1 : 0)] || null;

  return { phase, currentDay, currentStage, nextDay };
}

export function collectTodayResources(day) {
  const seen = new Set();
  const resources = [];

  for (const block of day?.blocks || []) {
    for (const resource of block.resources || []) {
      if (!quickResourceTypes.has(resource.type) || seen.has(resource.id)) continue;
      seen.add(resource.id);
      resources.push(resource);
    }
  }

  return resources;
}

export function buildTodayCommand(day) {
  const meals = parseMealPlan(day);
  const mapActions = collectMapActions(day);
  const bookedItems = buildBookedItems(day);

  return {
    transport: day.transport,
    leaveBy: day.leaveBy,
    lodging: day?.lodging && day.lodging !== "-" ? day.lodging : "返程，无需住宿",
    bookedItems,
    meals,
    notes: buildExecutionNotes(day, bookedItems, mapActions),
    mapActions,
  };
}

export function buildDayTimeline(day) {
  const slots = [
    { id: "morning", label: "上午", blocks: [] },
    { id: "noon", label: "中午", blocks: [] },
    { id: "afternoon", label: "下午", blocks: [] },
    { id: "night", label: "晚上", blocks: [] },
    { id: "flex", label: "机动 / 备选", blocks: [] },
  ];

  for (const block of day?.blocks || []) {
    if (block.period === "饮食") continue;
    slots.find((slot) => slot.id === classifyTimelineSlot(block))?.blocks.push(block);
  }

  return slots.filter((slot) => slot.blocks.length);
}

export function buildDayDocket(day, expenses = []) {
  const dayExpenses = expenses.filter((expense) => expense.date === day?.date && !expense.deletedAt);
  const lodgingExpense = findMatchingExpense(dayExpenses, ["酒店"], day?.lodging);
  const transportExpense = findMatchingExpense(dayExpenses, ["租车", "交通", "机票"], day?.title);
  const activityExpense = findMatchingActivityExpense(dayExpenses, day);
  const lodgingResource = day?.lodgingResource;
  const primaryResource = day?.primaryResource;
  const ticketResource = day?.ticketResource;

  return [
    {
      id: "lodging",
      label: "住宿",
      title: day?.lodging && day.lodging !== "-" ? day.lodging : "无住宿",
      detail: lodgingExpense ? `账本已记 ${moneyLabel(lodgingExpense)}` : "看当天入住 / 返程安排",
      status: day?.lodgingStatus || (lodgingResource?.type === "map" ? "已订" : "核对"),
      href: lodgingResource?.url || "",
    },
    {
      id: "transport",
      label: "交通",
      title: day?.transport || "",
      detail: transportExpense ? `账本已记 ${moneyLabel(transportExpense)}` : day?.leaveBy || "",
      status: /自驾|租车/.test(day?.transport || "") ? "看路况" : /待购/.test(day?.transport || "") ? "待购" : "看时间",
      href: primaryResource?.url || "",
    },
    {
      id: "ticket",
      label: "门票 / Tour",
      title: activityExpense?.item || ticketResource?.title || "当天无固定票券",
      detail: activityExpense ? `账本已记 ${moneyLabel(activityExpense)}` : ticketResource?.sourceNote || "有预订就提前截图",
      status: ticketResource?.type === "booking" ? "已订" : /待订|待预约/.test(ticketResource?.title || "") ? "待订" : "机动",
      href: ticketResource?.url || "",
    },
  ];
}

export function collectMapActions(day) {
  const resources = collectTodayResources(day);
  const actions = [];
  const lodging = day?.lodgingResource;
  const primary = day?.primaryResource;
  const dinner = findDinnerResource(day);
  const transit = resources.find((resource) => /airport|wharf|ferry|parking|station|visitor centre|机场|码头|停车|车站|集合/i.test(resource.title));

  if (lodging?.type === "map" && day?.lodging && day.lodging !== "-") {
    actions.push({ id: `lodging-${lodging.id}`, label: "打开酒店地图", title: lodging.title, url: lodging.url });
  }
  if (primary?.url && !actions.some((action) => action.url === primary.url)) {
    actions.push({ id: `first-${primary.id}`, label: "打开第一站", title: primary.title, url: primary.url });
  }
  if (dinner) actions.push({ id: `dinner-${dinner.id}`, label: "打开晚餐", title: dinner.title, url: dinner.url });
  if (transit && !actions.some((action) => action.url === transit.url)) {
    actions.push({ id: `transit-${transit.id}`, label: "打开交通点", title: transit.title, url: transit.url });
  }

  return dedupeById(actions).slice(0, 4);
}

export function parseMealPlan(day) {
  const foodBlock = (day?.blocks || []).find((block) => block.period === "饮食");
  const text = foodBlock?.activity || "";
  const meals = {};

  for (const part of text.split(/[；;]/)) {
    const [rawLabel, ...rawValue] = part.split(/[：:]/);
    const label = rawLabel?.trim();
    const value = rawValue.join("：").trim();
    if (!value) continue;
    if (/早餐/.test(label)) meals.breakfast = value;
    if (/午餐/.test(label)) meals.lunch = value;
    if (/晚餐/.test(label)) meals.dinner = value;
  }

  return {
    breakfast: meals.breakfast || "按当天出门节奏就近解决",
    lunch: meals.lunch || "行程中就近轻食",
    dinner: meals.dinner || "看体力和动线决定",
    note: foodBlock?.tip || "餐食按体力和排队情况机动。",
  };
}

export function buildDayCarryChecklist(day) {
  const text = daySearchText(day);
  const items = [...baseCarryItems];

  if (/飞机|机场|转机|返程|入境|出发|航班/i.test(text)) {
    items.unshift({
      id: "passport-flight",
      label: "护照 / 登机资料",
      detail: "护照、签证、航班和入境材料放随身包。",
    });
  } else {
    items.push({
      id: "passport-copy",
      label: "护照照片 / 证件备份",
      detail: "不用每天拿出护照，但手机里要能快速找到。",
    });
  }

  if (/自驾|租车|取车|还车|停车|加油|drive|car/i.test(text)) {
    items.push({
      id: "drive-kit",
      label: "驾照 + 翻译件 / 车钥匙",
      detail: "出发前看NZTA路况、油量和停车限时牌。",
    });
  }

  if (/徒步|步道|Track|Walk|Hooker|Mount Iron|Lagoon/i.test(text)) {
    items.push({
      id: "hike-kit",
      label: "徒步鞋 / 路餐 / 饮水",
      detail: "步道没有补给，水和零食按全程准备。",
    });
  }

  if (/游船|船|峡湾|Milford|cruise/i.test(text)) {
    items.push({
      id: "sea-kit",
      label: "晕船药 / 防水袋",
      detail: "船头风大水雾重，手机和证件单独防水。",
    });
  }

  if (/雨|防水|防风|山区|Mt Cook|Aoraki|Milford|Fiordland|山口|Lindis/i.test(text)) {
    items.push({
      id: "weather-shell",
      label: "防风防雨外套 / 保暖层",
      detail: "新西兰山区和峡湾天气变化快，夏天也要带。",
    });
  }

  if (/防晒|紫外线|湖|Tekapo|Pukaki|Wānaka|Glenorchy|Hobbiton|日晒/i.test(text)) {
    items.push({
      id: "sun-kit",
      label: "防晒霜 / 墨镜 / 帽子",
      detail: "新西兰紫外线很强，阴天也要涂。",
    });
  }

  if (/观星|星空/i.test(text)) {
    items.push({
      id: "night-kit",
      label: "观星保暖外套",
      detail: "夜里气温可降到个位数，按冬装准备。",
    });
  }

  if (day?.lodging && day.lodging !== "-" && !/飞机上/.test(day.lodging) && day.lodgingStatus !== "无需住宿") {
    items.push({
      id: "hotel-key",
      label: "房卡 / 住宿地址",
      detail: `今晚住 ${day.lodging}`,
    });
  }

  return dedupeById(items).slice(0, 7);
}

export function summarizeDayLedger(day, expenses = []) {
  const dayExpenses = expenses.filter((expense) => expense.date === day?.date && !expense.deletedAt);
  const totalsByCurrency = {};

  for (const expense of dayExpenses) {
    const currency = expense.currency || "NZD";
    totalsByCurrency[currency] = roundMoney((totalsByCurrency[currency] || 0) + Number(expense.amount || 0));
  }

  return {
    date: day?.date || "",
    count: dayExpenses.length,
    pendingCount: dayExpenses.filter((expense) => expense.status === "draft").length,
    totalsByCurrency,
    recentExpenses: dayExpenses.slice(0, 3),
  };
}

function dayTime(day) {
  const [year, month, date] = day.date.split("-").map(Number);
  return new Date(year, month - 1, date).getTime();
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daySearchText(day) {
  return [
    day?.title,
    day?.focus,
    day?.city,
    day?.lodging,
    day?.climateNote,
    day?.clothingNote,
    day?.transport,
    ...(day?.notes || []).map((note) => note.text),
    ...(day?.blocks || []).flatMap((block) => [block.period, block.place, block.activity, block.highlight, block.tip]),
  ].filter(Boolean).join(" ");
}

function classifyTimelineSlot(block) {
  const clock = String(block.period || "").match(/^(\d{1,2}):\d{2}/);
  if (clock) {
    const hour = Number(clock[1]);
    if (hour < 11) return "morning";
    if (hour < 14) return "noon";
    if (hour < 18) return "afternoon";
    return "night";
  }
  const text = `${block.period} ${block.place} ${block.activity}`;
  if (/早|上午|出发|抵达|入境/i.test(text)) return "morning";
  if (/午|中午|午餐/i.test(text)) return "noon";
  if (/下午|傍晚/i.test(text)) return "afternoon";
  if (/晚|夜/i.test(text)) return "night";
  return "flex";
}

function buildBookedItems(day) {
  const resources = collectTodayResources(day).filter((resource) => ["booking", "official"].includes(resource.type));
  return resources.slice(0, 3).map((resource) => resource.title);
}

function buildExecutionNotes(day, bookedItems, mapActions) {
  const notes = [];
  if (bookedItems.length) notes.push("预订截图提前离线保存");
  if (mapActions.length) notes.push("出门前先打开第一站地图");
  if (/自驾|租车/i.test(daySearchText(day))) notes.push("上车前看NZTA路况、油量和停车限时");
  if (/游船|Milford|峡湾/i.test(daySearchText(day))) notes.push("峡湾日优先防水、保暖和晕船药");
  if (/已订|报到/i.test(daySearchText(day))) notes.push("报到时间比游览时间更重要，留足缓冲");
  if (!notes.length) notes.push("今天主打轻松执行，不要把行程塞满");
  return notes.slice(0, 4);
}

function findMatchingExpense(expenses, categories, text = "") {
  const normalizedText = normalizeText(text);
  return expenses.find((expense) => categories.includes(expense.category) && normalizedText && normalizeText(`${expense.item} ${expense.note}`).includes(normalizedText.slice(0, 8))) ||
    expenses.find((expense) => categories.includes(expense.category));
}

function findMatchingActivityExpense(expenses, day) {
  const normalizedDay = normalizeText(daySearchText(day));

  return expenses.find((expense) => {
    if (expense.category !== "活动") return false;
    const normalizedItem = normalizeText(expense.item);
    const matchKey = normalizedItem.slice(0, 8);
    return matchKey.length >= 4 && normalizedDay.includes(matchKey);
  });
}

function findDinnerResource(day) {
  const dinner = parseMealPlan(day).dinner;
  return (day?.blocks || [])
    .flatMap((block) => block.resources || [])
    .find((resource) => resource.type === "restaurant" && resourceTitleMatchesText(resource.title, dinner));
}

function resourceTitleMatchesText(title, text) {
  const normalizedText = normalizeText(text).replace(/[^\p{L}\p{N}]+/gu, "");
  const ignoredWords = new Set(["sydney", "queenstown", "wanaka", "auckland", "anau"]);
  const words = String(title || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/gu)
    .filter((word) => word.length >= 4 && !ignoredWords.has(word));
  return words.length > 0 && words.slice(0, 2).every((word) => normalizedText.includes(word));
}

function moneyLabel(expense) {
  return formatCurrencyAmount(expense.currency, expense.amount);
}

function normalizeText(value = "") {
  return String(value).toLowerCase().replace(/\s+/g, "");
}

function dedupeById(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}
