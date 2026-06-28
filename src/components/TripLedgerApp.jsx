"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  applyExpenseEdit,
  applyExpenseTemplate,
  calculateLedger,
  categories,
  expenseToEditableForm,
  expenseTemplates,
  formatMoney,
  parseBankMessage,
  seedExpenses,
  setExpenseSplitSettled,
  splitSettledLabel,
} from "@/lib/ledger";
import { activityDisplaySummary, createActivityEntry, dashboardActivityPreview, recentActivity } from "@/lib/activity";
import { coupleName, formatPayerLabel, formatSettlementDirection } from "@/lib/couples";
import { pulseElement, revealPage } from "@/lib/motion";
import {
  deleteRemoteExpense,
  fetchRemoteActivity,
  fetchRemoteExpenses,
  insertRemoteActivity,
  supabaseConfigured,
  uploadRemoteReceipt,
  upsertRemoteExpense,
} from "@/lib/supabaseRest";
import { shouldUploadLocalCache } from "@/lib/sync";
import UnlockGate from "@/components/UnlockGate";

const storageKey = "aussie-chill-expenses-v1";
const activityStorageKey = "aussie-chill-activity-v1";

export default function TripLedgerApp({ view }) {
  const shellRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [expenses, setExpenses] = useState(seedExpenses);
  const [activity, setActivity] = useState([]);
  const [activityPulseKey, setActivityPulseKey] = useState(0);
  const [syncState, setSyncState] = useState("本机保存");
  const ledger = useMemo(() => calculateLedger(expenses), [expenses]);

  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    const savedExpenses = saved ? JSON.parse(saved) : null;
    const savedActivity = localStorage.getItem(activityStorageKey);
    const localActivity = savedActivity ? recentActivity(JSON.parse(savedActivity)) : [];
    if (savedExpenses) setExpenses(savedExpenses);
    if (localActivity.length) setActivity(localActivity);
    setReady(true);

    fetchRemoteExpenses()
      .then(async (remote) => {
        if (shouldUploadLocalCache(savedExpenses, remote)) {
          await Promise.all(savedExpenses.map((expense) => upsertRemoteExpense(expense)));
          setSyncState("已保存");
          return;
        }
        if (remote?.length) {
          setExpenses(remote);
          localStorage.setItem(storageKey, JSON.stringify(remote));
          setSyncState("已保存");
        } else if (supabaseConfigured) {
          setSyncState("可一起编辑");
        }
      })
      .catch(() => setSyncState("现在先显示本机内容"));

    fetchRemoteActivity()
      .then((remote) => {
        if (!remote?.length) return;
        const nextActivity = recentActivity(remote);
        setActivity(nextActivity);
        localStorage.setItem(activityStorageKey, JSON.stringify(nextActivity));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!ready) return undefined;
    return revealPage(shellRef, [
      { selector: "[data-motion='hero']", y: 16 },
      { selector: "[data-motion='nav']", y: 10 },
    ]);
  }, [ready]);

  useEffect(() => {
    if (!ready) return undefined;
    return revealPage(shellRef, [
      { selector: "[data-motion='summary-card']", y: 14, stagger: 0.05 },
      { selector: "[data-motion='section']", y: 16, stagger: 0.08 },
      { selector: "[data-motion='row']", y: 12, stagger: 0.04 },
    ]);
  }, [ready, view]);

  useEffect(() => {
    if (!activityPulseKey) return;
    const tween = pulseElement(shellRef.current?.querySelector("[data-motion='activity-panel']"));
    return () => tween?.kill();
  }, [activityPulseKey]);

  async function persist(nextExpenses, remoteAction) {
    setExpenses(nextExpenses);
    localStorage.setItem(storageKey, JSON.stringify(nextExpenses));
    try {
      await remoteAction?.();
      if (supabaseConfigured) setSyncState("已保存");
    } catch {
      setSyncState("现在先保存在本机");
    }
  }

  async function recordActivity(entry) {
    setActivity((current) => {
      const nextActivity = recentActivity([entry, ...current]);
      localStorage.setItem(activityStorageKey, JSON.stringify(nextActivity));
      return nextActivity;
    });
    try {
      await insertRemoteActivity(entry);
    } catch {
      // Activity is helpful context, but it should never block core expense edits.
    }
    setActivityPulseKey((key) => key + 1);
  }

  async function addExpense(expense) {
    const nextExpenses = [expense, ...expenses];
    await persist(nextExpenses, () => upsertRemoteExpense(expense));
    await recordActivity(createActivityEntry("add", expense));
  }

  async function updateExpense(expense) {
    const previousExpense = expenses.find((item) => item.id === expense.id);
    const nextExpenses = expenses.map((item) => (item.id === expense.id ? expense : item));
    await persist(nextExpenses, () => upsertRemoteExpense(expense));
    await recordActivity(createActivityEntry("edit", expense, new Date(), previousExpense));
  }

  async function confirmExpense(expense) {
    const confirmed = { ...expense, status: "confirmed" };
    const nextExpenses = expenses.map((item) => (item.id === expense.id ? confirmed : item));
    await persist(nextExpenses, () => upsertRemoteExpense(confirmed));
    await recordActivity(createActivityEntry("confirm", confirmed));
  }

  async function removeExpense(id) {
    const removed = expenses.find((item) => item.id === id);
    const nextExpenses = expenses.filter((item) => item.id !== id);
    await persist(nextExpenses, () => deleteRemoteExpense(id));
    if (removed) await recordActivity(createActivityEntry("delete", removed));
  }

  if (!ready) {
    return <main className="unlock-wrap" />;
  }

  return (
    <UnlockGate intro="输入旅行访问码后进入共享账本和行程。">
      <div className="app-shell" ref={shellRef} data-motion="shell">
        <header className="hero" data-motion="hero">
          <div>
            <h1>Aussie Chill Split Bill</h1>
            <p>
              2026.07.28-08.13，两对夫妻澳洲旅行账本。机票已单独 split，本账本只记录旅行中共同费用，按币种分别结算。
            </p>
          </div>
          <div className="hero-actions">
            <Link className="button primary" href="/add">记一笔</Link>
            <Link className="button" href="/settlement">看结算</Link>
            <Link className="button" href="/itinerary">看行程</Link>
            <span className="button">{syncState}</span>
          </div>
        </header>

        {view === "dashboard" && (
          <Dashboard
            expenses={expenses}
            ledger={ledger}
            activity={activity}
            onUpdate={updateExpense}
            onConfirm={confirmExpense}
          />
        )}
        {view === "expenses" && (
          <Expenses expenses={expenses} onUpdate={updateExpense} onConfirm={confirmExpense} onDelete={removeExpense} />
        )}
        {view === "add" && <AddExpense expenses={expenses} onAdd={addExpense} />}
        {view === "settlement" && <Settlement ledger={ledger} />}
        {view === "activity" && <ActivityPage activity={activity} />}

        <nav className="nav" aria-label="主导航" data-motion="nav">
          <Link className={view === "dashboard" ? "active" : ""} href="/">总览</Link>
          <Link className={view === "expenses" ? "active" : ""} href="/expenses">明细</Link>
          <Link className={view === "add" ? "active" : ""} href="/add">新增</Link>
          <Link className={view === "activity" ? "active" : ""} href="/activity">操作</Link>
          <Link className={view === "settlement" ? "active" : ""} href="/settlement">结算</Link>
          <Link href="/itinerary">行程</Link>
        </nav>
      </div>
    </UnlockGate>
  );
}

function Dashboard({ expenses, ledger, activity, onUpdate, onConfirm }) {
  const recent = expenses.slice(0, 5);

  return (
    <>
      <SummaryCards ledger={ledger} />
      <RecentActivity activity={dashboardActivityPreview(activity)} action={<Link href="/activity" className="button small">全部</Link>} />
      <section className="section">
        <div className="section-head" data-motion="section">
          <h2>最近记录</h2>
          <Link href="/expenses" className="button small">全部</Link>
        </div>
        <ExpenseList expenses={recent} onUpdate={onUpdate} onConfirm={onConfirm} />
      </section>
    </>
  );
}

function ActivityPage({ activity }) {
  return <RecentActivity activity={activity} />;
}

function RecentActivity({ activity, action }) {
  return (
    <section className="section" data-motion="activity-panel">
      <div className="section-head" data-motion="section">
        <h2>最近操作</h2>
        {action || <span className="muted">{activity.length ? `${activity.length} 条` : "暂无操作"}</span>}
      </div>
      <div className="activity-list">
        {activity.map((entry) => (
          <article className="activity-row" key={entry.id} data-motion="row">
            <div>
              <h3>{activityDisplaySummary(entry)}</h3>
              <p className="muted">{formatActivityTime(entry.createdAt)}</p>
            </div>
            <span className="tag">{activityActionLabel(entry.action)}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function SummaryCards({ ledger }) {
  const entries = Object.entries(ledger.currencies);

  return (
    <section className="section summary-grid">
      {entries.map(([currency, bucket]) => (
        <article className="card" key={currency} data-motion="summary-card">
          <span className="muted">{currency} 已确认总额</span>
          <strong>{formatMoney(currency, bucket.total)}</strong>
          <p className="muted">每对夫妻承担 {formatMoney(currency, bucket.eachCoupleShare)}</p>
        </article>
      ))}
      {entries.map(([currency, bucket]) => (
        <article className="card" key={`${currency}-net`} data-motion="summary-card">
          <span className="muted">{currency} 当前应收</span>
          <strong>{formatMoney(currency, Math.abs(bucket.netOtherOwesUs))}</strong>
          <p className="muted">
            {formatSettlementDirection(bucket.netOtherOwesUs)}
          </p>
        </article>
      ))}
    </section>
  );
}

function Expenses({ expenses, onUpdate, onConfirm, onDelete }) {
  const [category, setCategory] = useState("全部");
  const [currency, setCurrency] = useState("全部");
  const [payer, setPayer] = useState("全部");
  const filtered = expenses.filter((expense) => {
    return (
      (category === "全部" || expense.category === category) &&
      (currency === "全部" || expense.currency === currency) &&
      (payer === "全部" || expense.payer === payer)
    );
  });

  return (
    <section className="section">
      <div className="section-head" data-motion="section">
        <h2>费用明细</h2>
        <span className="muted">{filtered.length} 条</span>
      </div>
      <div className="filters">
        <Select value={category} onChange={setCategory} options={["全部", ...categories]} />
        <Select value={currency} onChange={setCurrency} options={["全部", "CNY", "AUD"]} />
        <select value={payer} onChange={(event) => setPayer(event.target.value)}>
          <option value="全部">全部付款方</option>
          <option value="us">{coupleName("us")}</option>
          <option value="them">{coupleName("them")}</option>
        </select>
      </div>
      <ExpenseList expenses={filtered} onUpdate={onUpdate} onConfirm={onConfirm} onDelete={onDelete} />
    </section>
  );
}

function ExpenseList({ expenses, onUpdate, onConfirm, onDelete }) {
  const [editingId, setEditingId] = useState("");
  const [editForm, setEditForm] = useState(null);

  function startEdit(expense) {
    setEditingId(expense.id);
    setEditForm(expenseToEditableForm(expense));
  }

  function cancelEdit() {
    setEditingId("");
    setEditForm(null);
  }

  async function saveEdit(expense) {
    if (!editForm?.item.trim() || !editForm.amount) return;
    await onUpdate(applyExpenseEdit(expense, editForm));
    cancelEdit();
  }

  async function toggleSplitSettled(expense) {
    await onUpdate(setExpenseSplitSettled(expense, !expense.splitSettled));
  }

  return (
    <div className="expense-list">
      {expenses.map((expense) => {
        const isEditing = editingId === expense.id && editForm;

        if (isEditing) {
          return (
            <article className="expense-row editing" key={expense.id} data-motion="row">
              <div className="form-grid">
                <label className="full">
                  项目
                  <input value={editForm.item} onChange={(event) => setEditForm({ ...editForm, item: event.target.value })} />
                </label>
                <label>
                  类别
                  <select value={editForm.category} onChange={(event) => setEditForm({ ...editForm, category: event.target.value })}>
                    {categories.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </label>
                <label>
                  日期
                  <input type="date" value={editForm.date} onChange={(event) => setEditForm({ ...editForm, date: event.target.value })} />
                </label>
                <label>
                  币种
                  <select value={editForm.currency} onChange={(event) => setEditForm({ ...editForm, currency: event.target.value })}>
                    <option value="CNY">CNY</option>
                    <option value="AUD">AUD</option>
                  </select>
                </label>
                <label>
                  金额
                  <input type="number" step="0.01" value={editForm.amount} onChange={(event) => setEditForm({ ...editForm, amount: event.target.value })} />
                </label>
                <label>
                  付款方
                  <select value={editForm.payer} onChange={(event) => setEditForm({ ...editForm, payer: event.target.value })}>
                    <option value="us">{formatPayerLabel("us")}</option>
                    <option value="them">{formatPayerLabel("them")}</option>
                  </select>
                </label>
                <label>
                  状态
                  <select value={editForm.status} onChange={(event) => setEditForm({ ...editForm, status: event.target.value })}>
                    <option value="confirmed">已确认</option>
                    <option value="draft">待确认</option>
                  </select>
                </label>
                <label className="full">
                  备注
                  <textarea value={editForm.note} onChange={(event) => setEditForm({ ...editForm, note: event.target.value })} />
                </label>
              </div>
              <div className="row">
                <button className="button small primary" type="button" onClick={() => saveEdit(expense)}>保存</button>
                <button className="button small" type="button" onClick={cancelEdit}>取消</button>
              </div>
            </article>
          );
        }

        return (
          <article className="expense-row" key={expense.id} data-motion="row">
            <div>
              <h3>{expense.item}</h3>
              <p className="muted">{expense.date || "日期待补"} · {expense.note || "无备注"}</p>
              <div className="tags">
                <span className="tag">{expense.category}</span>
                <span className={expense.status === "draft" ? "tag draft" : "tag"}>{expense.status === "draft" ? "待确认" : "已确认"}</span>
                <span className={expense.payer === "them" ? "tag other" : "tag"}>{formatPayerLabel(expense.payer)}</span>
                {expense.splitSettled && <span className="tag settled">已分摊</span>}
                {expense.attachmentName && <span className="tag">有小票</span>}
              </div>
            </div>
            <div className="stack">
              <strong className="amount">{formatMoney(expense.currency, expense.amount)}</strong>
              {onUpdate && (
                <button
                  className={expense.splitSettled ? "button small primary" : "button small"}
                  type="button"
                  aria-pressed={Boolean(expense.splitSettled)}
                  onClick={() => toggleSplitSettled(expense)}
                >
                  {splitSettledLabel(expense.splitSettled)}
                </button>
              )}
              {onUpdate && <button className="button small" onClick={() => startEdit(expense)}>编辑</button>}
              {onConfirm && expense.status === "draft" && (
                <button className="button small primary" onClick={() => onConfirm(expense)}>确认</button>
              )}
              {onDelete && (
                <button className="button small danger" onClick={() => onDelete(expense.id)}>删除</button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function activityActionLabel(action) {
  if (action === "add") return "新增";
  if (action === "edit") return "编辑";
  if (action === "confirm") return "确认";
  if (action === "delete") return "删除";
  return "更新";
}

function formatActivityTime(value) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AddExpense({ onAdd }) {
  const [message, setMessage] = useState("");
  const [form, setForm] = useState(emptyForm());
  const [receipt, setReceipt] = useState(null);

  function useMessage() {
    if (!message.trim()) return;
    setForm({ ...emptyForm(), ...parseBankMessage(message) });
  }

  async function submit() {
    if (!form.item.trim() || !form.amount) return;

    let attachmentName = receipt?.name || form.attachmentName || "";
    if (receipt) {
      try {
        attachmentName = (await uploadRemoteReceipt(receipt)) || receipt.name;
      } catch {
        attachmentName = receipt.name;
      }
    }

    await onAdd({
      ...form,
      id: form.id || `expense-${Date.now()}`,
      amount: Number(form.amount),
      attachmentName,
    });
    setForm(emptyForm());
    setMessage("");
    setReceipt(null);
  }

  return (
    <section className="section form-card" data-motion="section">
      <div className="section-head">
        <h2>记一笔</h2>
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
              onClick={() => setForm(applyExpenseTemplate(form, template.id))}
            >
              {template.label}
            </button>
          ))}
        </div>
        <div>
          <div className="form-grid">
            <label className="full">
              项目
              <input value={form.item} onChange={(event) => setForm({ ...form, item: event.target.value })} required />
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
              <input type="number" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} required />
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
              <input type="file" accept="image/*" onChange={(event) => setReceipt(event.target.files?.[0] || null)} />
            </label>
            <label className="full">
              备注
              <textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
            </label>
          </div>
          <button className="button primary" type="button" onClick={submit}>保存</button>
        </div>
      </div>
    </section>
  );
}

function Settlement({ ledger }) {
  const entries = Object.entries(ledger.currencies);

  return (
    <>
      <section className="section settlement-grid">
        {entries.map(([currency, bucket]) => (
          <article className="card" key={currency} data-motion="summary-card">
            <span className="muted">{currency} 结算</span>
            <strong>{formatMoney(currency, Math.abs(bucket.netOtherOwesUs))}</strong>
            <p className="muted">
              {formatSettlementDirection(bucket.netOtherOwesUs)}
            </p>
          </article>
        ))}
      </section>
      <section className="section">
        <div className="section-head" data-motion="section">
          <h2>分类小计</h2>
          <span className="muted">只统计已确认费用</span>
        </div>
        <div className="expense-list">
          {entries.flatMap(([currency]) =>
            Object.entries(ledger.categoriesByCurrency[currency] || {}).map(([category, amount]) => (
              <article className="expense-row" key={`${currency}-${category}`} data-motion="row">
                <div>
                  <h3>{category}</h3>
                  <p className="muted">{currency}</p>
                </div>
                <strong className="amount">{formatMoney(currency, amount)}</strong>
              </article>
            )),
          )}
        </div>
      </section>
    </>
  );
}

function Select({ value, onChange, options }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
  );
}

function emptyForm() {
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
  };
}
