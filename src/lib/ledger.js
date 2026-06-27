import { couples } from "./couples.js";

export const members = couples.map((couple) => ({
  id: couple.id,
  name: couple.shortName,
}));

export const categories = [
  "酒店",
  "租车",
  "活动",
  "dining",
  "交通",
  "购物",
  "其他",
];

export const backlogItems = [
  "dining",
  "凯恩斯租车保险",
  "大洋路油费、停车费、toll",
  "凯恩斯阿瑟顿油费",
  "BBQ 食材采购",
  "大堡礁外礁一日游",
  "悉尼歌剧院 tour",
  "悉尼南海岸租车 / 一日游",
  "市内交通 / Uber / Ferry / Train",
];

export const seedExpenses = [
  expense("hotel-oaks-melbourne", "酒店", "Oaks Melbourne on Market Hotel", "2026-07-29", "CNY", 2534.86, "墨尔本 CBD，2晚"),
  expense("hotel-seaview", "酒店", "Seaview Motel & Apartments", "2026-07-31", "CNY", 906.28, "Apollo Bay，1晚"),
  expense("hotel-southern-ocean", "酒店", "Southern Ocean Villas", "2026-08-01", "CNY", 1691.52, "Port Campbell，1晚"),
  expense("hotel-holiday-inn", "酒店", "Holiday Inn Melbourne Airport", "2026-08-02", "CNY", 1581.12, "墨尔本机场，1晚，2间房"),
  expense("hotel-southern-cross", "酒店", "Southern Cross Atrium Apartments", "2026-08-03", "CNY", 9669.66, "凯恩斯，5晚"),
  expense("hotel-oaks-sydney", "酒店", "Oaks Sydney Goldsbrough Suites", "2026-08-08", "CNY", 9661.82, "悉尼，5晚"),
  expense("car-great-ocean", "租车", "墨尔本—大洋路租车，含保险", "2026-07-31", "CNY", 2746, "已锁定，含保险"),
  expense("car-atherton", "租车", "凯恩斯阿瑟顿租车，不含保险", "2026-08-06", "CNY", 752, "不含保险，后续如补保险另算"),
  expense("tour-daintree", "活动", "Billy Tea Daintree Rainforest & Cape Tribulation Tour", "2026-08-05", "AUD", 956, "4 adults，按原币记录"),
  expense("tour-whale", "活动", "Captain Cook Whale Watching", "2026-08-11", "AUD", 340.2, "已付款，含 fuel surcharge / card surcharge"),
];

function expense(id, category, item, date, currency, amount, note) {
  return {
    id,
    category,
    item,
    date,
    currency,
    amount,
    payer: "us",
    status: "confirmed",
    note,
    attachmentName: "",
    splitSettled: false,
  };
}

export function calculateLedger(expenses) {
  const currencies = {};
  const categoriesByCurrency = {};

  for (const expenseItem of expenses.filter((item) => item.status === "confirmed")) {
    const currency = expenseItem.currency;
    const amount = roundMoney(Number(expenseItem.amount || 0));
    const bucket = currencies[currency] ?? {
      total: 0,
      paidByUs: 0,
      paidByThem: 0,
      eachCoupleShare: 0,
      netOtherOwesUs: 0,
    };
    const categoryBucket = categoriesByCurrency[currency] ?? {};

    bucket.total = roundMoney(bucket.total + amount);
    if (expenseItem.payer === "them") {
      bucket.paidByThem = roundMoney(bucket.paidByThem + amount);
    } else {
      bucket.paidByUs = roundMoney(bucket.paidByUs + amount);
    }
    categoryBucket[expenseItem.category] = roundMoney((categoryBucket[expenseItem.category] ?? 0) + amount);

    currencies[currency] = bucket;
    categoriesByCurrency[currency] = categoryBucket;
  }

  for (const bucket of Object.values(currencies)) {
    bucket.eachCoupleShare = roundMoney(bucket.total / 2);
    bucket.netOtherOwesUs = roundMoney(bucket.paidByUs / 2 - bucket.paidByThem / 2);
  }

  return { currencies, categoriesByCurrency };
}

export function parseBankMessage(message) {
  const text = message.trim().replace(/\s+/g, " ");
  const currency = /A\$|AUD/i.test(text) ? "AUD" : "CNY";
  const amountMatch =
    text.match(/(?:A\$|AUD|¥|￥|CNY|RMB)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i) ??
    text.match(/([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
  const dateMatch = text.match(/(\d{1,2})[/-](\d{1,2})/);
  const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, "")) : 0;
  const item = text
    .replace(/^\d{1,2}[/-]\d{1,2}\s*/, "")
    .replace(/(?:A\$|AUD|¥|￥|CNY|RMB)?\s*[0-9][0-9,]*(?:\.[0-9]{1,2})?/gi, "")
    .replace(/\b(card purchase|purchase|消费|交易|支付|付款)\b/gi, "")
    .trim() || "待确认消费";

  return {
    id: `draft-${Date.now()}`,
    category: guessCategory(item),
    item,
    date: dateMatch ? `2026-${dateMatch[1].padStart(2, "0")}-${dateMatch[2].padStart(2, "0")}` : "",
    currency,
    amount,
    payer: "us",
    status: "draft",
    note: "由短信粘贴生成，确认后入账",
    attachmentName: "",
    splitSettled: false,
  };
}

export function expenseToEditableForm(expense) {
  return {
    category: expense.category || "其他",
    item: expense.item || "",
    date: expense.date || "",
    currency: expense.currency || "CNY",
    amount: String(expense.amount || ""),
    payer: expense.payer || "us",
    status: expense.status || "confirmed",
    note: expense.note || "",
  };
}

export function applyExpenseEdit(expense, form) {
  return {
    ...expense,
    category: form.category,
    item: form.item,
    date: form.date,
    currency: form.currency,
    amount: Number(form.amount || 0),
    payer: form.payer,
    status: form.status,
    note: form.note,
  };
}

export function setExpenseSplitSettled(expense, splitSettled) {
  return {
    ...expense,
    splitSettled,
  };
}

export function formatMoney(currency, amount) {
  const value = Number(amount || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency === "AUD" ? `A$${value}` : `¥${value}`;
}

export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function guessCategory(item) {
  if (/\b(hotel|motel|apartment|apartments|villa|villas|inn)\b|oaks|酒店/i.test(item)) return "酒店";
  if (/car|uber|taxi|ferry|train|租车|交通|停车|油费|toll/i.test(item)) return "交通";
  if (/tour|reef|watching|opera|活动|一日游/i.test(item)) return "活动";
  if (/dinner|lunch|cafe|restaurant|bbq|market|dining|餐|食材|咖啡/i.test(item)) return "dining";
  return "其他";
}
