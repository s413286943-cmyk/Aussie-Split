export function createExpense(overrides = {}) {
  const id = overrides.id || "expense-dinner";
  return {
    id,
    category: "dining",
    item: "Harbour dinner",
    date: "2026-08-09",
    currency: "AUD",
    amount: 120,
    payer: "us",
    status: "confirmed",
    note: "Circular Quay",
    splitSettled: false,
    mutationVersion: "1780000000000-000001-e2e-client",
    updatedAt: "2026-07-01T00:00:00.000Z",
    deletedAt: null,
    attachmentName: "",
    attachmentPath: "",
    receiptId: "",
    attachmentStatus: "none",
    ...overrides,
  };
}

export function createActivity(overrides = {}) {
  const expenseId = overrides.expenseId || "expense-dinner";
  const action = overrides.action || "add";
  const createdAt = overrides.createdAt || "2026-07-01T00:00:00.000Z";
  return {
    id: overrides.id || `activity-${expenseId}-${action}-${createdAt}`,
    expenseId,
    action,
    item: overrides.item || "Harbour dinner",
    amount: overrides.amount ?? 120,
    currency: overrides.currency || "AUD",
    summary: overrides.summary || "新增了 A$120.00 Harbour dinner",
    createdAt,
  };
}

export function defaultSnapshot() {
  const expenses = [
    createExpense(),
    createExpense({
      id: "expense-settled",
      item: "Already shared taxi",
      category: "交通",
      amount: 80,
      splitSettled: true,
      mutationVersion: "1780000000001-000001-e2e-client",
      updatedAt: "2026-07-01T00:00:01.000Z",
    }),
    createExpense({
      id: "expense-draft",
      item: "Draft museum tickets",
      category: "活动",
      amount: 40,
      status: "draft",
      mutationVersion: "1780000000002-000001-e2e-client",
      updatedAt: "2026-07-01T00:00:02.000Z",
    }),
  ];
  const activity = [0, 1, 2, 3, 4].map((index) => createActivity({
    id: `activity-seed-${index}`,
    expenseId: `seed-${index}`,
    item: `Seed operation ${index + 1}`,
    summary: `新增了 A$${index + 1}.00 Seed operation ${index + 1}`,
    amount: index + 1,
    createdAt: `2026-07-01T00:0${index}:00.000Z`,
  }));
  return { expenses, activity };
}
