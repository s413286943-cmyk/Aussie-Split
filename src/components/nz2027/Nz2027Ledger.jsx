"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useMemo, useRef, useState } from "react";

import {
  activeRecords,
  calculateTotals,
  categories,
  categoryLabel,
  currencies,
  formatMoney,
  formatTotals,
  statusLabel,
  summarizeByBase,
  summarizeByDay,
  toCsv,
} from "@/lib/nz2027/ledger";

export default function Nz2027Ledger({ records, days, syncLabel, syncing, onSync, onSave, onDelete, onRestore }) {
  const visible = useMemo(() => activeRecords(records), [records]);
  const totals = useMemo(() => calculateTotals(visible), [visible]);
  const cityRows = useMemo(() => summarizeByBase(visible, days), [visible, days]);
  const dayRows = useMemo(() => summarizeByDay(visible, days), [visible, days]);
  const [editing, setEditing] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [currencyFilter, setCurrencyFilter] = useState("all");
  const [notice, setNotice] = useState(null);
  const [initialDate, setInitialDate] = useState("");
  const noticeTimer = useRef(null);

  useEffect(() => {
    setInitialDate(new URLSearchParams(window.location.search).get("date") || "");
    return () => window.clearTimeout(noticeTimer.current);
  }, []);

  const filtered = visible.filter((record) => (
    (statusFilter === "all" || record.status === statusFilter)
    && (currencyFilter === "all" || record.currency === currencyFilter)
  ));

  function showNotice(message, action) {
    window.clearTimeout(noticeTimer.current);
    setNotice({ message, action });
    noticeTimer.current = window.setTimeout(() => setNotice(null), action ? 5000 : 3000);
  }

  function handleSave(record) {
    onSave(record);
    setEditing(null);
    showNotice(`已保存：${record.item} ${formatMoney(record.currency, record.amount)}`);
  }

  function handleDelete(record) {
    onDelete(record.id);
    showNotice(`已删除：${record.item}`, { label: "撤销", run: () => { onRestore(record); setNotice(null); } });
  }

  function exportCsv() {
    const blob = new Blob([toCsv(visible)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `nz2027-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <section className="nz27-card nz27-sync" aria-label="2027 账本同步">
        <p role="status" aria-live="polite">{syncLabel}</p>
        <div>
          <button className="button small" type="button" onClick={onSync} disabled={syncing}>同步</button>
          <button className="button small" type="button" onClick={exportCsv} disabled={!visible.length}>导出 CSV</button>
        </div>
      </section>

      <section className="nz27-totals" aria-label="按币种合计">
        {Object.entries(totals).map(([currency, bucket]) => (
          <article className={`nz27-total currency-${currency.toLowerCase()}`} key={currency}>
            <span>{currency} 合计 · {bucket.count} 笔</span>
            <strong>{formatMoney(currency, bucket.total)}</strong>
            <small>已付 {formatMoney(currency, bucket.paid)}{bucket.pending ? ` · 待付 ${formatMoney(currency, bucket.pending)}` : ""}</small>
          </article>
        ))}
        {!Object.keys(totals).length && <article className="nz27-total"><span>还没有记账</span><small>下面记第一笔。</small></article>}
      </section>
      <p className="muted nz27-hint">两个人一本账，不分摊；各币种分开累计，不换算合并。</p>

      <RecordForm key={editing?.id || `new-${initialDate}`} record={editing} initialDate={initialDate} onSave={handleSave} onCancel={() => setEditing(null)} />

      {notice && (
        <div className="action-toast success" role="status">
          <span>{notice.message}</span>
          {notice.action && <button className="toast-action" type="button" onClick={notice.action.run}>{notice.action.label}</button>}
        </div>
      )}

      <section className="nz27-card" aria-label="2027 费用明细">
        <div className="nz27-section-head">
          <h2>明细</h2>
          <span className="muted">{filtered.length} 条</span>
        </div>
        <div className="nz27-filters">
          <label>
            付款状态
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">全部</option>
              <option value="paid">已付</option>
              <option value="pending">待付</option>
            </select>
          </label>
          <label>
            币种筛选
            <select value={currencyFilter} onChange={(event) => setCurrencyFilter(event.target.value)}>
              <option value="all">全部</option>
              {currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
            </select>
          </label>
        </div>
        <ul className="nz27-records">
          {filtered.map((record) => (
            <li key={record.id} className={record.status === "pending" ? "is-pending" : ""}>
              <div>
                <strong>{record.item}</strong>
                <small>{record.date || "日期待补"} · {categoryLabel(record.category)} · {statusLabel(record.status)}{record.note ? ` · ${record.note}` : ""}</small>
              </div>
              <div className="nz27-record-actions">
                <span className="amount">{formatMoney(record.currency, record.amount)}</span>
                {record.status === "pending" && (
                  <button className="button small primary" type="button" onClick={() => handleSave({ ...record, status: "paid" })}>标为已付</button>
                )}
                <button className="button small" type="button" onClick={() => { setEditing(record); window.scrollTo({ top: 0, behavior: "smooth" }); }}>编辑</button>
                <button className="button small danger" type="button" onClick={() => handleDelete(record)}>删除</button>
              </div>
            </li>
          ))}
          {!filtered.length && <li className="nz27-empty">没有符合条件的记录</li>}
        </ul>
      </section>

      <SummarySection title="按城市" hint="按当晚住宿城市归类" rows={cityRows} />
      <SummarySection title="按天" hint={days.length ? "2/1–2/17 行程日" : "日程未载入，仅按日期分组"} rows={dayRows} />
    </>
  );
}

function SummarySection({ title, hint, rows }) {
  return (
    <section className="nz27-card" aria-label={title}>
      <div className="nz27-section-head">
        <h2>{title}</h2>
        <span className="muted">{hint}</span>
      </div>
      <ul className="nz27-summary">
        {rows.map((row) => (
          <li key={row.key}>
            <div>
              <strong>{row.label}</strong>
              <small>{[row.detail, `${row.count} 笔`].filter(Boolean).join(" · ")}</small>
            </div>
            <div className="nz27-summary-amounts">
              <span>{formatTotals(row.totals, "total")}</span>
              {Object.values(row.totals).some((bucket) => bucket.pending) && <small>待付 {formatTotals(row.totals, "pending")}</small>}
            </div>
          </li>
        ))}
        {!rows.length && <li className="nz27-empty">还没有记账</li>}
      </ul>
    </section>
  );
}

function RecordForm({ record, initialDate, onSave, onCancel }) {
  const [form, setForm] = useState(() => (record
    ? { ...record, amount: String(record.amount) }
    : { id: "", item: "", category: "dining", date: initialDate || "", currency: "NZD", amount: "", status: "paid", note: "" }));
  const [error, setError] = useState("");

  function submit(event) {
    event.preventDefault();
    const amount = Number(form.amount);
    if (!form.item.trim()) return setError("请填写项目");
    if (!Number.isFinite(amount) || amount <= 0 || !/^\d+(\.\d{1,2})?$/.test(String(form.amount).trim())) {
      return setError("金额必须大于 0，最多两位小数");
    }
    setError("");
    onSave({
      ...form,
      id: form.id || `nz27-${globalThis.crypto.randomUUID()}`,
      item: form.item.trim(),
      amount,
      deletedAt: null,
    });
  }

  const update = (field) => (event) => setForm({ ...form, [field]: event.target.value });

  return (
    <form className="nz27-card nz27-form" onSubmit={submit} aria-label={record ? "编辑这笔" : "记一笔"}>
      <h2>{record ? "编辑这笔" : "记一笔"}</h2>
      <label className="full">项目<input value={form.item} onChange={update("item")} maxLength={200} /></label>
      <label>类别<select value={form.category} onChange={update("category")}>{categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label>
      <label>日期<input type="date" value={form.date} onChange={update("date")} /></label>
      <label>币种<select value={form.currency} onChange={update("currency")}>{currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label>
      <label>金额<input inputMode="decimal" value={form.amount} onChange={update("amount")} /></label>
      <label>状态<select value={form.status} onChange={update("status")}><option value="paid">已付</option><option value="pending">待付</option></select></label>
      <label className="full">备注<textarea value={form.note} onChange={update("note")} maxLength={1000} /></label>
      {error && <p className="field-error full" role="alert">{error}</p>}
      <div className="full nz27-form-actions">
        <button className="button primary" type="submit">保存</button>
        {record && <button className="button" type="button" onClick={onCancel}>取消</button>}
      </div>
    </form>
  );
}
