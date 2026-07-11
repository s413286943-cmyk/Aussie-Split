export function validateExpense(expense) {
  const errors = {};
  if (!String(expense?.item || "").trim()) errors.item = "请填写项目";
  if (!validMoneyAmount(expense?.amount)) {
    errors.amount = "金额必须大于 0，且最多保留两位小数";
  }
  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export function findDuplicateExpense(candidate, expenses, threshold = 0.75) {
  const amount = Number(candidate?.amount);
  return (expenses || []).find((expense) => (
    expense.id !== candidate?.id
    && !expense.deletedAt
    && expense.date === candidate?.date
    && expense.currency === candidate?.currency
    && Number(expense.amount) === amount
    && itemSimilarity(expense.item, candidate?.item) >= threshold
  )) || null;
}

export function itemSimilarity(left, right) {
  const normalizedLeft = normalizeExpenseItem(left);
  const normalizedRight = normalizeExpenseItem(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;
  const longest = Math.max(normalizedLeft.length, normalizedRight.length);
  return (longest - levenshteinDistance(normalizedLeft, normalizedRight)) / longest;
}

export function normalizeExpenseItem(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function validMoneyAmount(value) {
  if (typeof value === "number") {
    return Number.isFinite(value)
      && value > 0
      && Math.abs(value * 100 - Math.round(value * 100)) < 1e-8;
  }
  const text = String(value ?? "").trim();
  if (!/^(?:\d+|\d*\.\d{1,2})$/.test(text)) return false;
  const amount = Number(text);
  return Number.isFinite(amount) && amount > 0;
}

function levenshteinDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}
