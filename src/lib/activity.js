import { formatMoney } from "./ledger.js";
import { formatPayerLabel } from "./couples.js";

const actionLabels = {
  add: "新增了",
  edit: "编辑了",
  confirm: "确认了",
  delete: "删除了",
};

export function createActivityEntry(action, expense, now = new Date(), previousExpense = null) {
  const createdAt = now.toISOString();
  const item = expense.item || "未命名费用";
  const amount = Number(expense.amount || 0);
  const currency = expense.currency || "CNY";
  const verb = actionLabels[action] || "更新了";

  return {
    id: `activity-${createdAt}-${action}-${expense.id}`,
    expenseId: expense.id,
    action,
    item,
    amount,
    currency,
    summary: activitySummary({ action, verb, expense, previousExpense, item, amount, currency }),
    createdAt,
  };
}

export function activityDisplaySummary(entry) {
  const item = entry.item || "未命名费用";
  const amount = Number(entry.amount || 0);
  const currency = entry.currency || "CNY";
  const summary = entry.summary || "";
  const genericEditSummary = `${actionLabels.edit} ${item}`;

  if (entry.action !== "edit" || (summary && summary !== genericEditSummary)) return summary;
  return editFallbackSummary({ verb: actionLabels.edit, item, amount, currency });
}

export function recentActivity(entries, limit = 8) {
  return [...(entries || [])]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, limit);
}

function activitySummary({ action, verb, expense, previousExpense, item, amount, currency }) {
  if (action === "add") return `${verb} ${formatMoney(currency, amount)} ${item}`;
  if (action !== "edit") return `${verb} ${item}`;
  if (!previousExpense) return editFallbackSummary({ verb, item, amount, currency });

  const changes = describeExpenseChanges(previousExpense, expense);
  return changes.length ? `${verb} ${item}：${changes.join("，")}` : editFallbackSummary({ verb, item, amount, currency });
}

function editFallbackSummary({ verb, item, amount, currency }) {
  return `${verb} ${item}：金额 ${formatMoney(currency, amount)}`;
}

function describeExpenseChanges(previousExpense, expense) {
  const changes = [];
  if (Number(previousExpense.amount || 0) !== Number(expense.amount || 0) || previousExpense.currency !== expense.currency) {
    changes.push(`金额 ${formatMoney(previousExpense.currency || "CNY", previousExpense.amount)} → ${formatMoney(expense.currency || "CNY", expense.amount)}`);
  }
  if ((previousExpense.date || "") !== (expense.date || "")) {
    changes.push(`日期 ${previousExpense.date || "未填"} → ${expense.date || "未填"}`);
  }
  if ((previousExpense.category || "") !== (expense.category || "")) {
    changes.push(`类别 ${previousExpense.category || "未填"} → ${expense.category || "未填"}`);
  }
  if ((previousExpense.payer || "") !== (expense.payer || "")) {
    changes.push(`付款方 ${formatPayerLabel(previousExpense.payer || "us")} → ${formatPayerLabel(expense.payer || "us")}`);
  }
  if ((previousExpense.status || "") !== (expense.status || "")) {
    changes.push(`状态 ${statusLabel(previousExpense.status)} → ${statusLabel(expense.status)}`);
  }
  if ((previousExpense.item || "") !== (expense.item || "")) {
    changes.push(`项目 ${previousExpense.item || "未命名费用"} → ${expense.item || "未命名费用"}`);
  }
  if ((previousExpense.note || "") !== (expense.note || "")) {
    changes.push("备注已更新");
  }
  if ((previousExpense.attachmentName || "") !== (expense.attachmentName || "")) {
    changes.push("小票已更新");
  }
  return changes;
}

function statusLabel(status) {
  if (status === "draft") return "待确认";
  if (status === "confirmed") return "已确认";
  return status || "未填";
}
