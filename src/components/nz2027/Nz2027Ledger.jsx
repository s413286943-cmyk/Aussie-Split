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
  const formRef = useRef(null);

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
    showNotice(`记好了：${record.item} ${formatMoney(record.currency, record.amount)}`);
  }

  function handleDelete(record) {
    onDelete(record.id);
    showNotice(`删掉了：${record.item}`, { label: "撤销", run: () => { onRestore(record); setNotice(null); } });
  }

  function startEdit(record) {
    setEditing(record);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function exportCsv() {
    const blob = new Blob([toCsv(visible)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `澳新2027账本-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <section className="nz-ledger-head" aria-label="账本合计">
        <h1>账本</h1>
        <p className="nz-ledger-sync" role="status" aria-live="polite">{syncLabel}</p>
        <div className="nz-totals">
          {Object.entries(totals).map(([currency, bucket]) => (
            <article className={`nz-total currency-${currency.toLowerCase()}`} key={currency}>
              <span>{currency} · {bucket.count} 笔</span>
              <strong>{formatMoney(currency, bucket.total)}</strong>
              <small>已付 {formatMoney(currency, bucket.paid)}{bucket.pending ? ` · 待付 ${formatMoney(currency, bucket.pending)}` : ""}</small>
            </article>
          ))}
          {!Object.keys(totals).length && <article className="nz-total"><span>还没有记账</span><small>下面记第一笔。</small></article>}
        </div>
        <p className="nz-ledger-note">每种货币单独合计，不换算。</p>
        <div className="nz-ledger-tools">
          <button className="nz-button" type="button" onClick={onSync} disabled={syncing}>立即同步</button>
          <button className="nz-button" type="button" onClick={exportCsv} disabled={!visible.length}>导出表格</button>
        </div>
      </section>

      <div ref={formRef}>
        <RecordForm key={editing?.id || `new-${initialDate}`} record={editing} initialDate={initialDate} onSave={handleSave} onCancel={() => setEditing(null)} />
      </div>

      {notice && (
        <div className="nz-toast" role="status">
          <span>{notice.message}</span>
          {notice.action && <button type="button" onClick={notice.action.run}>{notice.action.label}</button>}
        </div>
      )}

      <section className="nz-section" aria-label="明细">
        <header className="nz-section-head">
          <h2>明细</h2>
          <span>{filtered.length} 笔</span>
        </header>
        <div className="nz-filters">
          <label>
            付款
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">全部</option>
              <option value="paid">已付</option>
              <option value="pending">待付</option>
            </select>
          </label>
          <label>
            货币
            <select value={currencyFilter} onChange={(event) => setCurrencyFilter(event.target.value)}>
              <option value="all">全部</option>
              {currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
            </select>
          </label>
        </div>
        <ul className="nz-records">
          {filtered.map((record) => (
            <li key={record.id} className={record.status === "pending" ? "is-pending" : ""}>
              <div className="nz-record-main">
                <strong>{record.item}</strong>
                <small>{record.date ? shortDate(record.date) : "日期待补"} · {categoryLabel(record.category)} · {statusLabel(record.status)}{record.note ? ` · ${record.note}` : ""}</small>
              </div>
              <span className="nz-record-amount">{formatMoney(record.currency, record.amount)}</span>
              <div className="nz-record-actions">
                {record.status === "pending" && (
                  <button className="nz-button is-primary" type="button" onClick={() => handleSave({ ...record, status: "paid" })}>标为已付</button>
                )}
                <button className="nz-button" type="button" onClick={() => startEdit(record)}>编辑</button>
                <button className="nz-button is-quiet" type="button" onClick={() => handleDelete(record)}>删除</button>
              </div>
            </li>
          ))}
          {!filtered.length && <li className="nz-empty-row">没有符合条件的记录。</li>}
        </ul>
      </section>

      <Summary title="按城市" hint="按当晚住的城市算" rows={cityRows} />
      <Summary title="按天" hint={days.length ? "2/1–2/17" : "按日期"} rows={dayRows} />
    </>
  );
}

function Summary({ title, hint, rows }) {
  return (
    <section className="nz-section" aria-label={title}>
      <header className="nz-section-head">
        <h2>{title}</h2>
        <span>{hint}</span>
      </header>
      <ul className="nz-summary">
        {rows.map((row) => (
          <li key={row.key}>
            <div>
              <strong>{row.label}</strong>
              <small>{[row.detail, `${row.count} 笔`].filter(Boolean).join(" · ")}</small>
            </div>
            <div className="nz-summary-amounts">
              <span>{formatTotals(row.totals, "total")}</span>
              {Object.values(row.totals).some((bucket) => bucket.pending) && <small>待付 {formatTotals(row.totals, "pending")}</small>}
            </div>
          </li>
        ))}
        {!rows.length && <li className="nz-empty-row">还没有记账。</li>}
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
    if (!form.item.trim()) return setError("写一下花在哪儿了");
    if (!Number.isFinite(amount) || amount <= 0 || !/^\d+(\.\d{1,2})?$/.test(String(form.amount).trim())) {
      return setError("金额要大于 0，最多两位小数");
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
    <form className="nz-form" onSubmit={submit} aria-label={record ? "改这一笔" : "记一笔"}>
      <h2>{record ? "改这一笔" : "记一笔"}</h2>
      <label className="is-wide">项目<input value={form.item} onChange={update("item")} maxLength={200} placeholder="比如 Fergburger 午饭" /></label>
      <label>金额<input inputMode="decimal" value={form.amount} onChange={update("amount")} placeholder="0.00" /></label>
      <label>币种<select value={form.currency} onChange={update("currency")}>{currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label>
      <label>类别<select value={form.category} onChange={update("category")}>{categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label>
      <label>日期<input type="date" value={form.date} onChange={update("date")} /></label>
      <label>状态<select value={form.status} onChange={update("status")}><option value="paid">已付</option><option value="pending">待付</option></select></label>
      <label className="is-wide">备注<textarea value={form.note} onChange={update("note")} maxLength={1000} rows={2} /></label>
      {error && <p className="nz-form-error is-wide" role="alert">{error}</p>}
      <div className="nz-form-actions is-wide">
        <button className="nz-button is-primary" type="submit">保存</button>
        {record && <button className="nz-button" type="button" onClick={onCancel}>取消</button>}
      </div>
    </form>
  );
}

function shortDate(date) {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}
