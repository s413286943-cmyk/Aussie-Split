import { formatMoney } from "./ledger.js";

const actionLabels = {
  add: "新增了",
  edit: "编辑了",
  confirm: "确认了",
  delete: "删除了",
};

export function createActivityEntry(action, expense, now = new Date()) {
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
    summary: action === "add" ? `${verb} ${formatMoney(currency, amount)} ${item}` : `${verb} ${item}`,
    createdAt,
  };
}

export function recentActivity(entries, limit = 8) {
  return [...(entries || [])]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, limit);
}
