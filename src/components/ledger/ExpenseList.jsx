"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useMemo, useState } from "react";

import {
  applyExpenseEdit,
  categories,
  expenseToEditableForm,
  formatCategoryLabel,
  formatMoney,
  formatStatusLabel,
} from "@/lib/ledger";
import { supportedCurrencies } from "@/lib/currency";
import { findDuplicateExpense, validateExpense } from "@/lib/expenseValidation";

export function ExpenseListPage({ expenses, legacyCount = 0, onUpdate, onConfirm, onDelete, onViewReceipt, onInvalid }) {
  const [highlightId, setHighlightId] = useState("");
  const [category, setCategory] = useState("全部");
  const [currency, setCurrency] = useState("全部");
  const [statusFilter, setStatusFilter] = useState("全部");
  const [search, setSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status") === "draft" ? "待付" : params.get("status") === "confirmed" ? "已付" : "全部";
    setHighlightId(params.get("highlight") || "");
    setStatusFilter(status);
  }, []);

  const filtered = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("zh-CN");
    return expenses.filter((expense) => (
      (category === "全部" || expense.category === category)
      && (currency === "全部" || expense.currency === currency)
      && (statusFilter === "全部"
        || (statusFilter === "待付" && expense.status === "draft")
        || (statusFilter === "已付" && expense.status !== "draft"))
      && (!normalizedSearch || `${expense.item} ${expense.note}`.toLocaleLowerCase("zh-CN").includes(normalizedSearch))
      && (!startDate || expense.date >= startDate)
      && (!endDate || expense.date <= endDate)
    ));
  }, [category, currency, endDate, expenses, search, statusFilter, startDate]);

  const activeFilters = [
    search && `搜索“${search}”`,
    category !== "全部" && `类别：${formatCategoryLabel(category)}`,
    currency !== "全部" && `币种：${currency}`,
    statusFilter !== "全部" && `状态：${statusFilter}`,
    startDate && `从 ${startDate}`,
    endDate && `到 ${endDate}`,
  ].filter(Boolean);
  const advancedFilterCount = [
    category !== "全部",
    currency !== "全部",
    statusFilter !== "全部",
    Boolean(startDate),
    Boolean(endDate),
  ].filter(Boolean).length;

  function clearFilters() {
    setCategory("全部");
    setCurrency("全部");
    setStatusFilter("全部");
    setSearch("");
    setStartDate("");
    setEndDate("");
  }

  return (
    <section className="section ledger-section expenses-section">
      <div className="section-head" data-motion="section">
        <div>
          <span className="section-kicker">Receipt stream</span>
          <h2>费用明细</h2>
        </div>
        <span className="muted">{filtered.length} 条{legacyCount ? ` · 已隐藏 ${legacyCount} 条 2026 旧记录` : ""}</span>
      </div>
      <div className="filter-toolbar">
        <label className="filter-search">
          <span>搜索项目或备注</span>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="酒店、晚餐、Uber…" />
        </label>
        <button
          className="button filter-disclosure"
          type="button"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((current) => !current)}
        >
          {filtersOpen ? "收起筛选" : `更多筛选${advancedFilterCount ? ` · ${advancedFilterCount}` : ""}`}
        </button>
      </div>
      <div className={filtersOpen ? "filters ledger-filters advanced-filters is-open" : "filters ledger-filters advanced-filters"}>
        <SelectField label="类别" value={category} onChange={setCategory} options={["全部", ...categories]} formatOption={formatCategoryLabel} />
        <SelectField label="币种" value={currency} onChange={setCurrency} options={["全部", ...supportedCurrencies]} />
        <SelectField label="付款状态" value={statusFilter} onChange={setStatusFilter} options={["全部", "已付", "待付"]} />
        <label>
          <span>开始日期</span>
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>
        <label>
          <span>结束日期</span>
          <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </label>
      </div>
      {!filtered.length ? (
        <div className="filter-empty-state" data-feedback-target="expense-list">
          <span className="section-kicker">No matching receipts</span>
          <h3>没有符合条件的费用</h3>
          <p>{activeFilters.length ? activeFilters.join(" · ") : "账本里还没有费用。"}</p>
          {activeFilters.length > 0 && <button className="button" type="button" onClick={clearFilters}>清除筛选</button>}
        </div>
      ) : (
        <ExpenseList
          expenses={filtered}
          allExpenses={expenses}
          onUpdate={onUpdate}
          onConfirm={onConfirm}
          onDelete={onDelete}
          onViewReceipt={onViewReceipt}
          onInvalid={onInvalid}
          highlightId={highlightId}
        />
      )}
    </section>
  );
}

export default function ExpenseList({ expenses, allExpenses = expenses, onUpdate, onConfirm, onDelete, onViewReceipt, onInvalid, highlightId = "" }) {
  const [editingId, setEditingId] = useState("");
  const [editForm, setEditForm] = useState(null);
  const [busyId, setBusyId] = useState("");
  const [submitted, setSubmitted] = useState(false);

  function startEdit(expense) {
    setEditingId(expense.id);
    setEditForm(expenseToEditableForm(expense));
    setSubmitted(false);
  }

  function cancelEdit() {
    setEditingId("");
    setEditForm(null);
    setSubmitted(false);
  }

  async function saveEdit(expense) {
    const validation = validateExpense(editForm);
    setSubmitted(true);
    if (!validation.valid) {
      onInvalid?.(validation.errors.item || validation.errors.amount);
      return;
    }

    setBusyId(expense.id);
    try {
      await onUpdate(applyExpenseEdit(expense, editForm));
      cancelEdit();
    } catch {
      // Parent action handlers already surface failure feedback.
    } finally {
      setBusyId("");
    }
  }

  async function runRowAction(expense, action) {
    setBusyId(expense.id);
    try {
      await action();
    } catch {
      // Parent action handlers already surface failure feedback.
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="expense-list" data-feedback-target="expense-list">
      {expenses.map((expense) => {
        const isEditing = editingId === expense.id && editForm;
        const isBusy = busyId === expense.id;
        const receiptPending = expense.attachmentStatus === "pending";
        const receiptUploaded = expense.attachmentStatus === "uploaded" || Boolean(expense.attachmentPath);

        if (isEditing) {
          const validation = validateExpense(editForm);
          const duplicate = findDuplicateExpense({ ...editForm, id: expense.id }, allExpenses);
          return (
            <article className={rowClassName("expense-row editing", expense, isBusy, highlightId)} key={expense.id} data-motion="row" data-feedback-id={expense.id} aria-busy={isBusy}>
              <div className="form-grid">
                <label className="full">
                  项目
                  <input value={editForm.item} onChange={(event) => setEditForm({ ...editForm, item: event.target.value })} aria-invalid={submitted && Boolean(validation.errors.item)} />
                  {submitted && validation.errors.item && <span className="field-error">{validation.errors.item}</span>}
                </label>
                <SelectInput label="类别" value={editForm.category} onChange={(value) => setEditForm({ ...editForm, category: value })} options={categories} formatOption={formatCategoryLabel} />
                <label>
                  日期
                  <input type="date" value={editForm.date} onChange={(event) => setEditForm({ ...editForm, date: event.target.value })} />
                </label>
                <SelectInput label="币种" value={editForm.currency} onChange={(value) => setEditForm({ ...editForm, currency: value })} options={supportedCurrencies} />
                <label>
                  金额
                  <input type="number" min="0.01" step="0.01" value={editForm.amount} onChange={(event) => setEditForm({ ...editForm, amount: event.target.value })} aria-invalid={submitted && Boolean(validation.errors.amount)} />
                  {submitted && validation.errors.amount && <span className="field-error">{validation.errors.amount}</span>}
                </label>
                <label>
                  状态
                  <select value={editForm.status} onChange={(event) => setEditForm({ ...editForm, status: event.target.value })}>
                    <option value="confirmed">已付</option>
                    <option value="draft">待付</option>
                  </select>
                </label>
                <label className="full">
                  备注
                  <textarea value={editForm.note} onChange={(event) => setEditForm({ ...editForm, note: event.target.value })} />
                </label>
              </div>
              {duplicate && <p className="duplicate-warning">可能重复：{duplicate.item}。仍可保存，请先核对。</p>}
              <div className="row">
                <button className="button small primary" type="button" onClick={() => saveEdit(expense)} disabled={isBusy}>{isBusy ? "保存中" : "保存"}</button>
                <button className="button small" type="button" onClick={cancelEdit} disabled={isBusy}>取消</button>
              </div>
            </article>
          );
        }

        return (
          <article className={rowClassName("expense-row receipt-row", expense, isBusy, highlightId)} key={expense.id} data-motion="row" data-feedback-id={expense.id} aria-busy={isBusy}>
            <div>
              <h3>{expense.item}</h3>
              <p className="muted">{expense.date || "日期待补"} · {expense.note || "无备注"}</p>
              <div className="tags">
                <span className="tag">{formatCategoryLabel(expense.category)}</span>
                <span className={expense.status === "draft" ? "tag draft" : "tag"}>{formatStatusLabel(expense.status)}</span>
                {receiptPending && <span className="tag draft">小票待上传</span>}
                {receiptUploaded && <span className="tag">有小票</span>}
              </div>
            </div>
            <div className="stack row-actions">
              <strong className="amount">{formatMoney(expense.currency, expense.amount)}</strong>
              {onUpdate && <button className="button small" type="button" onClick={() => startEdit(expense)} disabled={isBusy}>编辑</button>}
              {onViewReceipt && receiptUploaded && <button className="button small" type="button" onClick={() => runRowAction(expense, () => onViewReceipt(expense))} disabled={isBusy}>查看小票</button>}
              {onConfirm && expense.status === "draft" && <button className="button small primary" type="button" onClick={() => runRowAction(expense, () => onConfirm(expense))} disabled={isBusy}>标为已付</button>}
              {onDelete && <button className="button small danger" type="button" onClick={() => runRowAction(expense, () => onDelete(expense.id))} disabled={isBusy}>删除</button>}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function SelectField({ label, value, onChange, options, formatOption = (option) => option }) {
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option} value={option}>{formatOption(option)}</option>)}
      </select>
    </label>
  );
}

function SelectInput({ label, value, onChange, options, formatOption = (option) => option }) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option} value={option}>{formatOption(option)}</option>)}
      </select>
    </label>
  );
}

function rowClassName(baseClassName, expense, isBusy, highlightId) {
  return [
    baseClassName,
    expense.status === "draft" ? "is-draft" : "is-paid",
    isBusy ? "is-busy" : "",
    highlightId && expense.id === highlightId ? "is-highlighted" : "",
  ].filter(Boolean).join(" ");
}
