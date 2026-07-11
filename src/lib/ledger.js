import { couples } from "./couples.js";
import { createRecordId } from "./recordId.js";

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

export const expenseTemplates = [
  { id: "dining", label: "餐饮", category: "dining", item: "餐饮" },
  { id: "taxi", label: "打车 / Uber", category: "交通", item: "打车 / Uber" },
  { id: "parking", label: "停车 / toll", category: "交通", item: "停车 / toll" },
  { id: "fuel", label: "油费", category: "交通", item: "油费" },
  { id: "tour", label: "门票 / tour", category: "活动", item: "门票 / tour" },
  { id: "shopping", label: "购物 / 超市", category: "购物", item: "购物 / 超市" },
];

export function calculateLedger(expenses) {
  const currencies = {};
  const categoriesByCurrency = {};
  const pendingCategoriesByCurrency = {};

  for (const expenseItem of expenses.filter((item) => item.status === "confirmed")) {
    const currency = expenseItem.currency;
    const amount = roundMoney(Number(expenseItem.amount || 0));
    const bucket = currencies[currency] ?? {
      total: 0,
      paidByUs: 0,
      paidByThem: 0,
      eachCoupleShare: 0,
      pendingTotal: 0,
      pendingPaidByUs: 0,
      pendingPaidByThem: 0,
      pendingEachCoupleShare: 0,
      netOtherOwesUs: 0,
    };
    const categoryBucket = categoriesByCurrency[currency] ?? {};
    const pendingCategoryBucket = pendingCategoriesByCurrency[currency] ?? {};

    bucket.total = roundMoney(bucket.total + amount);
    if (expenseItem.payer === "them") {
      bucket.paidByThem = roundMoney(bucket.paidByThem + amount);
    } else {
      bucket.paidByUs = roundMoney(bucket.paidByUs + amount);
    }
    categoryBucket[expenseItem.category] = roundMoney((categoryBucket[expenseItem.category] ?? 0) + amount);
    if (!expenseItem.splitSettled) {
      bucket.pendingTotal = roundMoney(bucket.pendingTotal + amount);
      if (expenseItem.payer === "them") {
        bucket.pendingPaidByThem = roundMoney(bucket.pendingPaidByThem + amount);
      } else {
        bucket.pendingPaidByUs = roundMoney(bucket.pendingPaidByUs + amount);
      }
      pendingCategoryBucket[expenseItem.category] = roundMoney(
        (pendingCategoryBucket[expenseItem.category] ?? 0) + amount
      );
    }

    currencies[currency] = bucket;
    categoriesByCurrency[currency] = categoryBucket;
    pendingCategoriesByCurrency[currency] = pendingCategoryBucket;
  }

  for (const bucket of Object.values(currencies)) {
    bucket.eachCoupleShare = roundMoney(bucket.total / 2);
    bucket.pendingEachCoupleShare = roundMoney(bucket.pendingTotal / 2);
    bucket.netOtherOwesUs = roundMoney(bucket.pendingPaidByUs / 2 - bucket.pendingPaidByThem / 2);
  }

  return { currencies, categoriesByCurrency, pendingCategoriesByCurrency };
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
    id: createRecordId("draft"),
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

export function createCapturedExpense(form, options = {}) {
  return {
    ...form,
    id: options.id || form.id,
    amount: Number(form.amount),
    attachmentName: options.attachmentName ?? form.attachmentName ?? "",
    splitSettled: false,
  };
}

export function setExpenseSplitSettled(expense, splitSettled) {
  return {
    ...expense,
    splitSettled,
  };
}

export function applyExpenseTemplate(form, templateId, now = new Date()) {
  const template = expenseTemplates.find((item) => item.id === templateId);
  if (!template) return form;

  return {
    ...form,
    category: template.category,
    item: template.item,
    date: localDateInputValue(now),
    payer: "us",
    status: "confirmed",
    splitSettled: false,
  };
}

export function splitSettledLabel(splitSettled) {
  return splitSettled ? "已分摊" : "待分摊";
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

function localDateInputValue(value) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
