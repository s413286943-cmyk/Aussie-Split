const quickResourceTypes = new Set(["map", "booking", "restaurant", "official"]);

const baseCarryItems = [
  {
    id: "power",
    label: "手机电量 / 充电宝",
    detail: "地图、支付、票据都靠手机，出门前确认满电。",
  },
  {
    id: "booking-screenshots",
    label: "预订截图",
    detail: "酒店、门票、租车资料放在离线相册里。",
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
    lodging: day?.lodging && day.lodging !== "-" ? day.lodging : "飞机上 / 返程",
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
  const dayExpenses = expenses.filter((expense) => expense.date === day?.date);
  const lodgingExpense = findMatchingExpense(dayExpenses, ["酒店"], day?.lodging);
  const transportExpense = findMatchingExpense(dayExpenses, ["租车", "交通"], day?.title);
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
      status: lodgingResource?.type === "map" ? "已订" : "核对",
      href: lodgingResource?.url || "",
    },
    {
      id: "transport",
      label: "交通",
      title: day?.transport || "",
      detail: transportExpense ? `账本已记 ${moneyLabel(transportExpense)}` : day?.leaveBy || "",
      status: /自驾|租车/.test(day?.transport || "") ? "看车况" : "看时间",
      href: primaryResource?.url || "",
    },
    {
      id: "ticket",
      label: "门票 / Tour",
      title: activityExpense?.item || ticketResource?.title || "当天无固定票券",
      detail: activityExpense ? `账本已记 ${moneyLabel(activityExpense)}` : "有预订就提前截图",
      status: activityExpense || (ticketResource && ticketResource.type !== "note") ? "已付款/待核" : "机动",
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
  const transit = resources.find((resource) => /airport|wharf|ferry|parking|station|机场|码头|停车|车站/i.test(resource.title));

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

  if (/自驾|租车|停车|toll|车|大洋路|阿瑟顿|南海岸|road|drive|car/i.test(text)) {
    items.push({
      id: "drive-kit",
      label: "驾照翻译件 / 车钥匙",
      detail: "确认停车票、导航路线和加油计划。",
    });
  }

  if (/大堡礁|外礁|reef|船|观鲸|whale|ferry|游船/i.test(text)) {
    items.push({
      id: "sea-kit",
      label: "晕船药 / 防水袋",
      detail: "船上风大，手机和证件单独防水。",
    });
  }

  if (/泳|snorkel|浮潜|大堡礁|外礁|Bondi|海滩|beach/i.test(text)) {
    items.push({
      id: "swim-kit",
      label: "泳衣 / 毛巾 / 换洗衣物",
      detail: "下水或海边日提前放进包里。",
    });
  }

  if (/雨|防水|瀑布|雨林|Daintree|丹翠|Atherton|阿瑟顿|海岸|Bondi|大洋路|whale|观鲸/i.test(text)) {
    items.push({
      id: "weather-shell",
      label: "防风防雨外套",
      detail: "澳洲冬天海边和雨林温差明显。",
    });
  }

  if (/防晒|海岸|海滩|reef|大堡礁|Daintree|丹翠|Atherton|阿瑟顿|Bondi|蓝山|南海岸|观鲸/i.test(text)) {
    items.push({
      id: "sun-kit",
      label: "防晒 / 墨镜",
      detail: "冬天紫外线也强，户外日不要省。",
    });
  }

  if (day?.lodging && day.lodging !== "-" && !/飞机上/.test(day.lodging)) {
    items.push({
      id: "hotel-key",
      label: "房卡 / 住宿地址",
      detail: `今晚住 ${day.lodging}`,
    });
  }

  return dedupeById(items).slice(0, 7);
}

export function summarizeDayLedger(day, expenses = []) {
  const dayExpenses = expenses.filter((expense) => expense.date === day?.date);
  const totalsByCurrency = {};

  for (const expense of dayExpenses) {
    const currency = expense.currency || "CNY";
    totalsByCurrency[currency] = roundMoney((totalsByCurrency[currency] || 0) + Number(expense.amount || 0));
  }

  return {
    date: day?.date || "",
    count: dayExpenses.length,
    pendingSplitCount: dayExpenses.filter((expense) => expense.status === "confirmed" && !expense.splitSettled).length,
    draftCount: dayExpenses.filter((expense) => expense.status === "draft").length,
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
    ...(day?.blocks || []).flatMap((block) => [block.period, block.place, block.activity, block.highlight, block.tip]),
  ].filter(Boolean).join(" ");
}

function classifyTimelineSlot(block) {
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
  if (/自驾|租车|大洋路|阿瑟顿/i.test(daySearchText(day))) notes.push("上车前确认油量、停车和 toll");
  if (/大堡礁|观鲸|船|reef|whale/i.test(daySearchText(day))) notes.push("海上日优先防风、防晒和晕船药");
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
  const ignoredWords = new Set(["sydney", "melbourne", "cairns"]);
  const words = String(title || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/gu)
    .filter((word) => word.length >= 4 && !ignoredWords.has(word));
  return words.length > 0 && words.slice(0, 2).every((word) => normalizedText.includes(word));
}

function moneyLabel(expense) {
  const value = Number(expense.amount || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return expense.currency === "AUD" ? `A$${value}` : `¥${value}`;
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
