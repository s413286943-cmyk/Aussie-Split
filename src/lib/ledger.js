import { formatCurrencyAmount, supportedCurrencies } from "./currency.js";
import { createRecordId } from "./recordId.js";

// Two-person ledger: every record is a shared household expense. The database still
// requires `payer` and `splitSettled`, so new records always carry payer "us" and
// splitSettled false; the UI never shows either field.
export const DEFAULT_PAYER = "us";
export const DEFAULT_CURRENCY = "NZD";

export const categories = [
  "酒店",
  "机票",
  "租车",
  "交通",
  "活动",
  "dining",
  "购物",
  "其他",
];

const categoryLabels = {
  dining: "餐饮",
  酒店: "住宿",
};

export function formatCategoryLabel(category) {
  return categoryLabels[category] || category;
}

export const statusLabels = {
  confirmed: "已付",
  draft: "待付",
};

export function formatStatusLabel(status) {
  return statusLabels[status] || status || "未填";
}

export const expenseTemplates = [
  { id: "dining", label: "餐饮", category: "dining", item: "餐饮" },
  { id: "groceries", label: "超市补给", category: "购物", item: "超市补给" },
  { id: "fuel", label: "油费", category: "交通", item: "油费" },
  { id: "parking", label: "停车", category: "交通", item: "停车" },
  { id: "taxi", label: "打车 / Uber", category: "交通", item: "打车 / Uber" },
  { id: "tour", label: "门票 / 活动", category: "活动", item: "门票 / 活动" },
];

export function calculateLedger(expenses) {
  const currencies = {};
  const categoriesByCurrency = {};

  for (const expenseItem of expenses || []) {
    if (expenseItem.deletedAt) continue;
    const currency = expenseItem.currency;
    const amount = roundMoney(Number(expenseItem.amount || 0));
    const bucket = currencies[currency] ?? { total: 0, paid: 0, pending: 0, count: 0, pendingCount: 0 };
    const categoryBucket = categoriesByCurrency[currency] ?? {};

    bucket.total = roundMoney(bucket.total + amount);
    bucket.count += 1;
    if (expenseItem.status === "draft") {
      bucket.pending = roundMoney(bucket.pending + amount);
      bucket.pendingCount += 1;
    } else {
      bucket.paid = roundMoney(bucket.paid + amount);
    }
    categoryBucket[expenseItem.category] = roundMoney((categoryBucket[expenseItem.category] ?? 0) + amount);

    currencies[currency] = bucket;
    categoriesByCurrency[currency] = categoryBucket;
  }

  return {
    currencies: sortByCurrency(currencies),
    categoriesByCurrency: sortByCurrency(categoriesByCurrency),
  };
}

export function parseBankMessage(message, now = new Date()) {
  const text = message.trim().replace(/\s+/g, " ");
  const currency = /NZ\$|NZD/i.test(text) ? "NZD" : /A\$|AUD/i.test(text) ? "AUD" : /¥|￥|CNY|RMB|人民币/i.test(text) ? "CNY" : DEFAULT_CURRENCY;
  const amountMatch =
    text.match(/(?:NZ\$|NZD|A\$|AUD|¥|￥|CNY|RMB)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i) ??
    text.match(/([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
  const dateMatch = text.match(/(\d{1,2})[/-](\d{1,2})/);
  const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, "")) : 0;
  const item = text
    .replace(/^\d{1,2}[/-]\d{1,2}\s*/, "")
    .replace(/(?:NZ\$|NZD|A\$|AUD|¥|￥|CNY|RMB)?\s*[0-9][0-9,]*(?:\.[0-9]{1,2})?/gi, "")
    .replace(/\b(card purchase|purchase|消费|交易|支付|付款)\b/gi, "")
    .trim() || "待确认消费";

  return {
    id: createRecordId("draft"),
    category: guessCategory(item),
    item,
    date: dateMatch ? `${tripYearFor(Number(dateMatch[1]), now)}-${dateMatch[1].padStart(2, "0")}-${dateMatch[2].padStart(2, "0")}` : "",
    currency,
    amount,
    payer: DEFAULT_PAYER,
    status: "draft",
    note: "由短信粘贴生成，核对后标记已付",
    attachmentName: "",
    splitSettled: false,
  };
}

export function expenseToEditableForm(expense) {
  return {
    category: expense.category || "其他",
    item: expense.item || "",
    date: expense.date || "",
    currency: expense.currency || DEFAULT_CURRENCY,
    amount: String(expense.amount || ""),
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
    payer: expense.payer || DEFAULT_PAYER,
    status: form.status,
    note: form.note,
  };
}

export function createCapturedExpense(form, options = {}) {
  return {
    ...form,
    id: options.id || form.id,
    amount: Number(form.amount),
    payer: DEFAULT_PAYER,
    attachmentName: options.attachmentName ?? form.attachmentName ?? "",
    splitSettled: false,
  };
}

export function applyExpenseTemplate(form, templateId, now = new Date()) {
  const template = expenseTemplates.find((item) => item.id === templateId);
  if (!template) return form;

  return {
    ...form,
    category: template.category,
    item: template.item,
    date: form.date || localDateInputValue(now),
    payer: DEFAULT_PAYER,
    status: "confirmed",
    splitSettled: false,
  };
}

export function formatMoney(currency, amount) {
  return formatCurrencyAmount(currency, amount);
}

export function formatTotals(totalsByCurrency, field) {
  const entries = Object.entries(totalsByCurrency || {})
    .map(([currency, value]) => [currency, typeof value === "number" ? value : value?.[field] ?? 0])
    .filter(([, value]) => value);
  if (!entries.length) return "—";
  return entries.map(([currency, value]) => formatMoney(currency, value)).join(" + ");
}

export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function sortByCurrency(record) {
  const order = (currency) => {
    const index = supportedCurrencies.indexOf(currency);
    return index === -1 ? supportedCurrencies.length : index;
  };
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => order(left) - order(right)));
}

function tripYearFor(month, now) {
  // The trip runs in February 2027; messages from late in the year belong to the booking period.
  const year = now.getFullYear();
  if (year <= 2026 && month <= 6) return 2027;
  return year;
}

function guessCategory(item) {
  if (/\b(hotel|motel|apartment|apartments|villa|villas|inn|holiday park|airbnb)\b|酒店|住宿/i.test(item)) return "酒店";
  if (/airline|airways|jetstar|air new zealand|qantas|flight|机票|航班/i.test(item)) return "机票";
  if (/rental|car hire|租车/i.test(item)) return "租车";
  if (/uber|taxi|ferry|train|bus|交通|停车|parking|油费|fuel|petrol|z energy|bp\b|toll/i.test(item)) return "交通";
  if (/tour|cruise|hobbiton|milford|ticket|活动|门票/i.test(item)) return "活动";
  if (/countdown|woolworths|new world|pak.?n.?save|four square|supermarket|超市/i.test(item)) return "购物";
  if (/dinner|lunch|cafe|coffee|restaurant|bakery|bar|market|dining|餐|咖啡/i.test(item)) return "dining";
  return "其他";
}

function localDateInputValue(value) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
