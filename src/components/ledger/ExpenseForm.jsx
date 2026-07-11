"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  applyExpenseTemplate,
  categories,
  createCapturedExpense,
  expenseTemplates,
  parseBankMessage,
} from "@/lib/ledger";
import { findDuplicateExpense, validateExpense } from "@/lib/expenseValidation";
import { formatPayerLabel } from "@/lib/couples";
import { createReceiptBlobRecord } from "@/lib/receipt";

const addDefaultsStorageKey = "aussie-chill-add-defaults-v1";

export default function ExpenseForm({ onAdd, onInvalid, expenses }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [form, setForm] = useState(emptyForm());
  const [receipt, setReceipt] = useState(null);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const validation = useMemo(() => validateExpense(form), [form]);
  const duplicate = useMemo(() => findDuplicateExpense(form, expenses), [form, expenses]);

  useEffect(() => {
    let savedDefaults = {};
    try {
      savedDefaults = JSON.parse(localStorage.getItem(addDefaultsStorageKey) || "{}");
    } catch {
      savedDefaults = {};
    }

    const params = new URLSearchParams(window.location.search);
    const queryDefaults = {
      date: params.get("date") || "",
      category: params.get("category") || "",
      item: params.get("item") || "",
      currency: params.get("currency") || "",
      payer: params.get("payer") || "",
    };

    setForm(emptyForm({ ...savedDefaults, ...removeEmptyValues(queryDefaults) }));
  }, []);

  function useMessage() {
    if (!message.trim()) return;
    setForm({ ...emptyForm(), ...parseBankMessage(message) });
    setSubmitted(false);
  }

  async function submit() {
    setSubmitted(true);
    if (!validation.valid) {
      onInvalid?.(validation.errors.item || validation.errors.amount);
      return;
    }

    setSaving(true);
    try {
      const expenseId = form.id || `expense-${Date.now()}`;
      let receiptRecord;
      if (receipt) {
        try {
          receiptRecord = createReceiptBlobRecord({
            expenseId,
            receiptId: `receipt-${globalThis.crypto.randomUUID()}`,
            file: receipt,
            createdAt: new Date().toISOString(),
          });
        } catch {
          onInvalid?.("小票仅支持 JPG、PNG、HEIC、HEIF、WebP，且不能超过 10 MB");
          return;
        }
      }
      const nextExpense = createCapturedExpense(form, {
        id: expenseId,
        attachmentName: receiptRecord?.originalName || form.attachmentName || "",
      });
      await onAdd(nextExpense, receiptRecord);

      const nextDefaults = {
        category: form.category,
        date: form.date,
        currency: form.currency,
        payer: form.payer,
      };
      try {
        localStorage.setItem(addDefaultsStorageKey, JSON.stringify(nextDefaults));
      } catch {
        // Saving defaults is optional; the committed expense must still complete.
      }
      setForm(emptyForm(nextDefaults));
      setMessage("");
      setReceipt(null);
      setSubmitted(false);
      router.push(`/expenses?highlight=${encodeURIComponent(nextExpense.id)}`);
    } catch {
      // The parent surfaces persistence failures.
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={saving ? "section form-card expense-form-card capture-card is-busy" : "section form-card expense-form-card capture-card"} data-motion="section" data-feedback-target="expense-form" aria-busy={saving}>
      <div className="section-head">
        <div>
          <span className="section-kicker">Quick capture</span>
          <h2>记一笔</h2>
        </div>
        <span className="muted">默认 50/50 split</span>
      </div>
      <div className="stack">
        <label>
          粘贴银行短信
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="例如：08/11 Captain Cook Whale Watching card purchase A$340.20" />
        </label>
        <button className="button" type="button" onClick={useMessage}>从短信生成待确认草稿</button>
        <div className="quick-templates" aria-label="常用模板">
          {expenseTemplates.map((template) => (
            <button
              className="button small"
              key={template.id}
              type="button"
              onClick={() => {
                setForm(applyExpenseTemplate(form, template.id));
                setSubmitted(false);
              }}
            >
              {template.label}
            </button>
          ))}
        </div>
        <div className="form-grid">
          <label className="full">
            项目
            <input value={form.item} onChange={(event) => setForm({ ...form, item: event.target.value })} aria-invalid={submitted && Boolean(validation.errors.item)} required />
            {submitted && validation.errors.item && <span className="field-error">{validation.errors.item}</span>}
          </label>
          <label>
            类别
            <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
              {categories.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>
            日期
            <input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
          </label>
          <label>
            币种
            <select value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value })}>
              <option value="CNY">CNY</option>
              <option value="AUD">AUD</option>
            </select>
          </label>
          <label>
            金额
            <input type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} aria-invalid={submitted && Boolean(validation.errors.amount)} required />
            {submitted && validation.errors.amount && <span className="field-error">{validation.errors.amount}</span>}
          </label>
          <label>
            付款方
            <select value={form.payer} onChange={(event) => setForm({ ...form, payer: event.target.value })}>
              <option value="us">{formatPayerLabel("us")}</option>
              <option value="them">{formatPayerLabel("them")}</option>
            </select>
          </label>
          <label>
            状态
            <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              <option value="confirmed">已确认</option>
              <option value="draft">待确认</option>
            </select>
          </label>
          <label className="full">
            小票图片
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.heic,.heif,.webp,image/jpeg,image/png,image/heic,image/heif,image/webp"
              onChange={(event) => setReceipt(event.target.files?.[0] || null)}
            />
          </label>
          <label className="full">
            备注
            <textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
          </label>
        </div>
        {duplicate && (
          <p className="duplicate-warning" role="status">
            可能重复：{duplicate.item}。仍可保存，请先核对日期、币种和金额。
          </p>
        )}
        <button className="button primary" type="button" onClick={submit} disabled={saving}>
          {saving ? "保存中" : "保存"}
        </button>
      </div>
    </section>
  );
}

function emptyForm(defaults = {}) {
  return {
    id: "",
    category: "dining",
    item: "",
    date: "",
    currency: "CNY",
    amount: "",
    payer: "us",
    status: "confirmed",
    note: "",
    attachmentName: "",
    splitSettled: false,
    ...defaults,
  };
}

function removeEmptyValues(values) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value));
}
