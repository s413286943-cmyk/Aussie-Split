export function shouldUploadLocalCache(localExpenses, remoteExpenses) {
  if (!Array.isArray(localExpenses) || localExpenses.length === 0) return false;
  if (!Array.isArray(remoteExpenses) || remoteExpenses.length === 0) return true;
  if (localExpenses.length !== remoteExpenses.length) return false;

  const localIds = localExpenses.map((expense) => expense.id).sort();
  const remoteIds = remoteExpenses.map((expense) => expense.id).sort();
  if (localIds.some((id, index) => id !== remoteIds[index])) return false;

  return JSON.stringify(normalizeExpenses(localExpenses)) !== JSON.stringify(normalizeExpenses(remoteExpenses));
}

function normalizeExpenses(expenses) {
  return expenses
    .map((expense) => ({
      ...expense,
      amount: Number(expense.amount),
      note: expense.note || "",
      attachmentName: expense.attachmentName || "",
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
