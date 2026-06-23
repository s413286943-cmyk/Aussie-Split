"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  backlogItems,
  calculateLedger,
  categories,
  formatMoney,
  parseBankMessage,
  seedExpenses,
} from "@/lib/ledger";
import { coupleName, formatPayerLabel, formatSettlementDirection } from "@/lib/couples";
import {
  deleteRemoteExpense,
  fetchRemoteExpenses,
  supabaseConfigured,
  uploadRemoteReceipt,
  upsertRemoteExpense,
} from "@/lib/supabaseRest";

const storageKey = "aussie-chill-expenses-v1";
const accessKey = "aussie-chill-access-v1";
const defaultTripCode = process.env.NEXT_PUBLIC_TRIP_CODE || "aussie";

export default function TripLedgerApp({ view }) {
  const [ready, setReady] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [expenses, setExpenses] = useState(seedExpenses);
  const [syncState, setSyncState] = useState("本机保存");
  const ledger = useMemo(() => calculateLedger(expenses), [expenses]);

  useEffect(() => {
    setUnlocked(localStorage.getItem(accessKey) === "yes");
    const saved = localStorage.getItem(storageKey);
    if (saved) setExpenses(JSON.parse(saved));
    setReady(true);

    fetchRemoteExpenses()
      .then((remote) => {
        if (remote?.length) {
          setExpenses(remote);
          localStorage.setItem(storageKey, JSON.stringify(remote));
          setSyncState("已保存");
        } else if (supabaseConfigured) {
          setSyncState("可一起编辑");
        }
      })
      .catch(() => setSyncState("现在先显示本机内容"));
  }, []);

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

  async function addExpense(expense) {
    const nextExpenses = [expense, ...expenses];
    await persist(nextExpenses, () => upsertRemoteExpense(expense));
  }

  async function updateExpense(expense) {
    const nextExpenses = expenses.map((item) => (item.id === expense.id ? expense : item));
    await persist(nextExpenses, () => upsertRemoteExpense(expense));
  }

  async function removeExpense(id) {
    const nextExpenses = expenses.filter((item) => item.id !== id);
    await persist(nextExpenses, () => deleteRemoteExpense(id));
  }

  if (!ready) {
    return <main className="unlock-wrap" />;
  }

  if (!unlocked) {
    return <Unlock onUnlock={() => setUnlocked(true)} />;
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <h1>Aussie Chill 账本</h1>
          <p>
            2026.07.28-08.13，两对夫妻澳洲旅行账本。机票已单独 split，本账本只记录旅行中共同费用，按币种分别结算。
          </p>
        </div>
        <div className="hero-actions">
          <Link className="button primary" href="/ledger/add">记一笔</Link>
          <Link className="button" href="/ledger/settlement">看结算</Link>
          <span className="button">{syncState}</span>
        </div>
      </header>

      {view === "dashboard" && <Dashboard expenses={expenses} ledger={ledger} />}
      {view === "expenses" && (
        <Expenses expenses={expenses} onUpdate={updateExpense} onDelete={removeExpense} />
      )}
      {view === "add" && <AddExpense expenses={expenses} onAdd={addExpense} />}
      {view === "settlement" && <Settlement ledger={ledger} />}

      <nav className="nav" aria-label="主导航">
        <Link className={view === "dashboard" ? "active" : ""} href="/ledger">总览</Link>
        <Link className={view === "expenses" ? "active" : ""} href="/ledger/expenses">明细</Link>
        <Link className={view === "add" ? "active" : ""} href="/ledger/add">新增</Link>
        <Link className={view === "settlement" ? "active" : ""} href="/ledger/settlement">结算</Link>
      </nav>
    </div>
  );
}

function Unlock({ onUnlock }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  function submit(event) {
    event.preventDefault();
    if (code.trim() === defaultTripCode) {
      localStorage.setItem(accessKey, "yes");
      onUnlock();
      return;
    }
    setError("访问码不对");
  }

  return (
    <main className="unlock-wrap">
      <section className="unlock-card stack">
        <h1>Aussie Chill</h1>
        <p className="muted">输入旅行访问码后进入共享账本。</p>
        <form className="stack" onSubmit={submit}>
          <label>
            访问码
            <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="aussie" />
          </label>
          {error && <p className="muted">{error}</p>}
          <button className="button primary" type="submit">进入账本</button>
        </form>
      </section>
    </main>
  );
}

function Dashboard({ expenses, ledger }) {
  const recent = expenses.slice(0, 5);

  return (
    <>
      <SummaryCards ledger={ledger} />
      <section className="section">
        <div className="section-head">
          <h2>待补项目</h2>
          <span className="muted">旅行中发生后新增</span>
        </div>
        <div className="backlog">
          {backlogItems.map((item) => <span key={item}>{item}</span>)}
        </div>
      </section>
      <section className="section">
        <div className="section-head">
          <h2>最近记录</h2>
          <Link href="/expenses" className="button small">全部</Link>
        </div>
        <ExpenseList expenses={recent} />
      </section>
    </>
  );
}

function SummaryCards({ ledger }) {
  const entries = Object.entries(ledger.currencies);

  return (
    <section className="section summary-grid">
      {entries.map(([currency, bucket]) => (
        <article className="card" key={currency}>
          <span className="muted">{currency} 已确认总额</span>
          <strong>{formatMoney(currency, bucket.total)}</strong>
          <p className="muted">每对夫妻承担 {formatMoney(currency, bucket.eachCoupleShare)}</p>
        </article>
      ))}
      {entries.map(([currency, bucket]) => (
        <article className="card" key={`${currency}-net`}>
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

function Expenses({ expenses, onUpdate, onDelete }) {
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
      <div className="section-head">
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
      <ExpenseList expenses={filtered} onUpdate={onUpdate} onDelete={onDelete} />
    </section>
  );
}

function ExpenseList({ expenses, onUpdate, onDelete }) {
  return (
    <div className="expense-list">
      {expenses.map((expense) => (
        <article className="expense-row" key={expense.id}>
          <div>
            <h3>{expense.item}</h3>
            <p className="muted">{expense.date || "日期待补"} · {expense.note || "无备注"}</p>
            <div className="tags">
              <span className="tag">{expense.category}</span>
              <span className={expense.status === "draft" ? "tag draft" : "tag"}>{expense.status === "draft" ? "待确认" : "已确认"}</span>
              <span className={expense.payer === "them" ? "tag other" : "tag"}>{formatPayerLabel(expense.payer)}</span>
              {expense.attachmentName && <span className="tag">有小票</span>}
            </div>
          </div>
          <div className="stack">
            <strong className="amount">{formatMoney(expense.currency, expense.amount)}</strong>
            {onUpdate && expense.status === "draft" && (
              <button className="button small primary" onClick={() => onUpdate({ ...expense, status: "confirmed" })}>确认</button>
            )}
            {onDelete && (
              <button className="button small danger" onClick={() => onDelete(expense.id)}>删除</button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
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
    <section className="section form-card">
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
          <article className="card" key={currency}>
            <span className="muted">{currency} 结算</span>
            <strong>{formatMoney(currency, Math.abs(bucket.netOtherOwesUs))}</strong>
            <p className="muted">
              {formatSettlementDirection(bucket.netOtherOwesUs)}
            </p>
          </article>
        ))}
      </section>
      <section className="section">
        <div className="section-head">
          <h2>分类小计</h2>
          <span className="muted">只统计已确认费用</span>
        </div>
        <div className="expense-list">
          {entries.flatMap(([currency]) =>
            Object.entries(ledger.categoriesByCurrency[currency] || {}).map(([category, amount]) => (
              <article className="expense-row" key={`${currency}-${category}`}>
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
