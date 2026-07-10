"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import Link from "next/link";
import { useRouter } from "next/navigation";
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
import {
  actionFeedbackMessage,
  activityDisplaySummary,
  createActivityEntry,
  dashboardActivityPreview,
  recentActivity,
} from "@/lib/activity";
import { coupleName, formatPayerLabel, formatSettlementDirection } from "@/lib/couples";
import { pulseElement, revealPage, shakeElement } from "@/lib/motion";
import {
  deleteRemoteExpense,
  fetchRemoteActivity,
  fetchRemoteExpenses,
  insertRemoteActivity,
  supabaseConfigured,
  uploadRemoteReceipt,
  upsertRemoteExpense,
} from "@/lib/supabaseRest";
import {
  allocatePersistedExpenseMutation,
  createMutationTabId,
  createSerialLedgerActionQueue,
  createSyncRequestCoordinator,
  parseStoredArray,
  prependExpenseToList,
  preparePersistedBootstrapExpenses,
  removeExpenseFromList,
  replaceExpenseInList,
  restoreExpenseInList,
  shouldUploadLocalCache,
  withTimeout,
} from "@/lib/sync";
import UnlockGate from "@/components/UnlockGate";

const storageKey = "aussie-chill-expenses-v1";
const activityStorageKey = "aussie-chill-activity-v1";
const addDefaultsStorageKey = "aussie-chill-add-defaults-v1";
const undoDeleteMs = 5000;

export default function TripLedgerApp({ view }) {
  const shellRef = useRef(null);
  const noticeTimerRef = useRef(null);
  const pendingDeleteRef = useRef(null);
  const mutationStateRef = useRef(null);
  const mutationTabIdRef = useRef(null);
  const expensesRef = useRef(seedExpenses);
  const ledgerActionQueueRef = useRef(null);
  const syncRequestCoordinatorRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [expenses, setExpenses] = useState(seedExpenses);
  const [activity, setActivity] = useState([]);
  const [activityPulseKey, setActivityPulseKey] = useState(0);
  const [actionNotice, setActionNotice] = useState(null);
  const [feedbackAnimation, setFeedbackAnimation] = useState(null);
  const [syncState, setSyncState] = useState("已本机保存，待同步");
  const ledger = useMemo(() => calculateLedger(expenses), [expenses]);

  useEffect(() => {
    let cancelled = false;
    const savedExpenses = parseStoredArray(localStorage.getItem(storageKey), null);
    const localActivity = recentActivity(parseStoredArray(localStorage.getItem(activityStorageKey), []));
    ledgerActionQueueRef.current = ledgerActionQueueRef.current ?? createSerialLedgerActionQueue();
    syncRequestCoordinatorRef.current = syncRequestCoordinatorRef.current ?? createSyncRequestCoordinator();
    if (localActivity.length) setActivity(localActivity);

    async function initializeLedger() {
      let localRowsPrepared = false;
      try {
        const initialExpenses = savedExpenses ?? seedExpenses;
        const tabId = mutationTabIdRef.current ?? createMutationTabId();
        mutationTabIdRef.current = tabId;
        const prepared = await preparePersistedBootstrapExpenses(initialExpenses, {
          storage: localStorage,
          tabId,
        });
        if (cancelled) return;

        mutationStateRef.current = prepared.state;
        expensesRef.current = prepared.expenses;
        setExpenses(prepared.expenses);
        if (savedExpenses) localStorage.setItem(storageKey, JSON.stringify(prepared.expenses));
        localRowsPrepared = true;

        try {
          const remote = await withTimeout(fetchRemoteExpenses(), { timeoutMs: 7000 });
          if (cancelled) return;

          if (shouldUploadLocalCache(savedExpenses, remote)) {
            await Promise.all(prepared.expenses.map((expense) => upsertRemoteExpense(expense)));
            if (cancelled) return;
            setSyncState("已同步");
            return;
          }
          if (remote?.length) {
            const preparedRemote = await preparePersistedBootstrapExpenses(remote, {
              storage: localStorage,
              tabId,
            });
            if (cancelled) return;
            mutationStateRef.current = preparedRemote.state;
            expensesRef.current = preparedRemote.expenses;
            setExpenses(preparedRemote.expenses);
            localStorage.setItem(storageKey, JSON.stringify(preparedRemote.expenses));
            setSyncState("已同步");
          } else if (supabaseConfigured) {
            setSyncState("已同步");
          }
        } catch {
          if (!cancelled) setSyncState("同步失败，可重试");
        }
      } catch {
        if (!cancelled) setSyncState("保存失败");
      } finally {
        if (!cancelled && localRowsPrepared) setReady(true);
      }
    }

    initializeLedger();

    fetchRemoteActivity()
      .then((remote) => {
        if (cancelled || !remote?.length) return;
        const nextActivity = recentActivity(remote);
        setActivity(nextActivity);
        localStorage.setItem(activityStorageKey, JSON.stringify(nextActivity));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
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

  useEffect(() => {
    if (!feedbackAnimation) return undefined;
    const target = findFeedbackTarget(shellRef.current, feedbackAnimation.targetId);
    const tween = shakeElement(target, feedbackAnimation.tone);
    return () => tween?.kill();
  }, [feedbackAnimation]);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
      const pending = pendingDeleteRef.current;
      if (!pending) return;
      if (pending.timer) window.clearTimeout(pending.timer);
      deleteRemoteExpense(pending.tombstone).catch(() => {});
      insertRemoteActivity(createActivityEntry("delete", pending.expense)).catch(() => {});
    };
  }, []);

  function showActionNotice(message, tone = "success", options = {}) {
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    setActionNotice({
      id: Date.now(),
      message,
      tone,
      actionLabel: options.actionLabel,
      onAction: options.onAction,
    });
    noticeTimerRef.current = window.setTimeout(() => setActionNotice(null), options.duration ?? 3200);
  }

  function playFeedback(targetId, tone = "success") {
    setFeedbackAnimation({ id: Date.now(), targetId, tone });
  }

  function showPersistNotice(action, expense, result) {
    const baseMessage = actionFeedbackMessage(action, expense);
    const tone = result.remoteFailed ? "warning" : "success";
    const message = result.remoteFailed ? `${baseMessage}；已先保存在本机` : baseMessage;
    showActionNotice(message, tone);
    playFeedback(expense.id, tone);
  }

  function showRemoteFallbackNotice(expense, targetId = expense.id) {
    showActionNotice(`同步失败，可重试：${expense.item || "这笔费用"} 已先保存在本机`, "warning");
    playFeedback(targetId, "warning");
  }

  function showFormWarning(message) {
    showActionNotice(message, "warning");
    playFeedback("expense-form", "warning");
  }

  function renderSyncAggregate(state) {
    if (state === "failed") {
      setSyncState("同步失败，可重试");
    } else if (!supabaseConfigured) {
      setSyncState("已本机保存，待同步");
    } else if (state === "syncing") {
      setSyncState("正在同步");
    } else {
      setSyncState("已同步");
    }
  }

  function startRemoteSync(expenseId, remoteAction, onRemoteFailure) {
    const coordinator = syncRequestCoordinatorRef.current;
    const token = coordinator.begin(expenseId);
    renderSyncAggregate(coordinator.current());

    Promise.resolve()
      .then(() => remoteAction())
      .then(() => {
        const settled = coordinator.settle(token, "synced");
        if (!settled.accepted) return;
        renderSyncAggregate(settled.state);
      })
      .catch((error) => {
        const settled = coordinator.settle(token, "failed");
        if (!settled.accepted) return;
        renderSyncAggregate(settled.state);
        onRemoteFailure?.(error);
      });

    return { remoteFailed: false };
  }

  async function commitLedgerMutation(createCandidate, deriveNextExpenses, options) {
    return ledgerActionQueueRef.current(async () => {
      const currentExpenses = expensesRef.current;
      const candidate = createCandidate(currentExpenses);
      if (!candidate) return null;

      const allocated = await allocatePersistedExpenseMutation(candidate, mutationStateRef.current, {
        storage: localStorage,
        ...(options ?? {}),
      });
      const nextExpenses = deriveNextExpenses(currentExpenses, allocated.expense);
      localStorage.setItem(storageKey, JSON.stringify(nextExpenses));
      mutationStateRef.current = allocated.state;
      expensesRef.current = nextExpenses;
      setExpenses(nextExpenses);
      return {
        expense: allocated.expense,
        previousExpenses: currentExpenses,
        nextExpenses,
      };
    });
  }

  async function recordActivity(entry) {
    setActivity((current) => {
      const nextActivity = recentActivity([entry, ...current]);
      try {
        localStorage.setItem(activityStorageKey, JSON.stringify(nextActivity));
      } catch {
        // Activity cache is secondary to the actual ledger state.
      }
      return nextActivity;
    });
    setActivityPulseKey((key) => key + 1);
    try {
      await insertRemoteActivity(entry);
    } catch {
      // Activity is helpful context, but it should never block core expense edits.
    }
  }

  async function addExpense(expense) {
    try {
      const committed = await commitLedgerMutation(
        () => expense,
        (currentExpenses, versionedExpense) => prependExpenseToList(currentExpenses, versionedExpense)
      );
      const versionedExpense = committed.expense;
      const result = startRemoteSync(
        versionedExpense.id,
        () => upsertRemoteExpense(versionedExpense),
        () => showRemoteFallbackNotice(versionedExpense, "expense-form")
      );
      showPersistNotice("add", versionedExpense, result);
      playFeedback("expense-form", result.remoteFailed ? "warning" : "success");
      recordActivity(createActivityEntry("add", versionedExpense));
    } catch {
      showActionNotice(`保存失败：${expense.item || "这笔费用"}`, "danger");
      playFeedback("expense-form", "danger");
      throw new Error("expense-add-failed");
    }
  }

  async function updateExpense(expense, action = "edit") {
    try {
      const committed = await commitLedgerMutation(
        (currentExpenses) => {
          const latestExpense = currentExpenses.find((item) => item.id === expense.id);
          if (!latestExpense) return null;
          if (action === "toggle-split") {
            return setExpenseSplitSettled(latestExpense, !latestExpense.splitSettled);
          }
          return { ...expense, mutationVersion: latestExpense.mutationVersion };
        },
        (currentExpenses, versionedExpense) => replaceExpenseInList(currentExpenses, versionedExpense)
      );
      if (!committed) return;
      const versionedExpense = committed.expense;
      const previousExpense = committed.previousExpenses.find((item) => item.id === expense.id);
      const feedbackAction = previousExpense && Boolean(previousExpense.splitSettled) !== Boolean(versionedExpense.splitSettled) ? "split" : "edit";
      const result = startRemoteSync(
        versionedExpense.id,
        () => upsertRemoteExpense(versionedExpense),
        () => showRemoteFallbackNotice(versionedExpense)
      );
      showPersistNotice(feedbackAction, versionedExpense, result);
      recordActivity(createActivityEntry("edit", versionedExpense, new Date(), previousExpense));
    } catch {
      showActionNotice(`保存修改失败：${expense.item || "这笔费用"}`, "danger");
      playFeedback(expense.id, "danger");
      throw new Error("expense-update-failed");
    }
  }

  async function confirmExpense(expense) {
    try {
      const committed = await commitLedgerMutation(
        (currentExpenses) => {
          const latestExpense = currentExpenses.find((item) => item.id === expense.id);
          return latestExpense ? { ...latestExpense, status: "confirmed" } : null;
        },
        (currentExpenses, confirmed) => replaceExpenseInList(currentExpenses, confirmed)
      );
      if (!committed) return;
      const confirmed = committed.expense;
      const result = startRemoteSync(
        confirmed.id,
        () => upsertRemoteExpense(confirmed),
        () => showRemoteFallbackNotice(confirmed)
      );
      showPersistNotice("confirm", confirmed, result);
      recordActivity(createActivityEntry("confirm", confirmed));
    } catch {
      showActionNotice(`确认失败：${expense.item || "这笔费用"}`, "danger");
      playFeedback(expense.id, "danger");
      throw new Error("expense-confirm-failed");
    }
  }

  async function removeExpense(id) {
    flushPendingDelete();

    let removed = null;
    try {
      const committed = await commitLedgerMutation(
        (currentExpenses) => currentExpenses.find((item) => item.id === id) ?? null,
        (currentExpenses) => removeExpenseFromList(currentExpenses, id),
        { deleted: true }
      );
      if (!committed) return;
      removed = committed.previousExpenses.find((item) => item.id === id);
      const removedIndex = committed.previousExpenses.findIndex((item) => item.id === id);
      const tombstone = committed.expense;
      const timer = window.setTimeout(() => finalizePendingDelete(id), undoDeleteMs);
      pendingDeleteRef.current = { id, expense: removed, tombstone, index: removedIndex, timer };
      const aggregateState = syncRequestCoordinatorRef.current.current();
      if (aggregateState === "synced") {
        setSyncState("已本机保存，待同步");
      } else {
        renderSyncAggregate(aggregateState);
      }
      showActionNotice(actionFeedbackMessage("delete", removed), "warning", {
        actionLabel: "撤销",
        onAction: () => undoDelete(id),
        duration: undoDeleteMs,
      });
      playFeedback("expense-list", "warning");
    } catch {
      showActionNotice(`删除失败：${removed?.item || "这笔费用"}`, "danger");
      playFeedback(id, "danger");
      throw new Error("expense-delete-failed");
    }
  }

  async function undoDelete(id) {
    const pending = pendingDeleteRef.current;
    if (!pending || pending.id !== id) return;

    if (pending.timer) window.clearTimeout(pending.timer);
    pendingDeleteRef.current = null;

    try {
      await ledgerActionQueueRef.current(async () => {
        const nextExpenses = restoreExpenseInList(
          expensesRef.current,
          pending.expense,
          pending.index
        );
        localStorage.setItem(storageKey, JSON.stringify(nextExpenses));
        expensesRef.current = nextExpenses;
        setExpenses(nextExpenses);
      });
    } catch {
      showActionNotice(`恢复失败：${pending.expense.item}`, "danger");
      playFeedback(pending.expense.id, "danger");
      return;
    }
    renderSyncAggregate(syncRequestCoordinatorRef.current.current());
    showActionNotice(`已恢复：${pending.expense.item}`, "success");
    playFeedback(pending.expense.id, "success");
  }

  function flushPendingDelete() {
    const pending = pendingDeleteRef.current;
    if (!pending) return;
    if (pending.timer) window.clearTimeout(pending.timer);
    finalizePendingDelete(pending.id);
  }

  function finalizePendingDelete(id) {
    const pending = pendingDeleteRef.current;
    if (!pending || pending.id !== id) return;
    pendingDeleteRef.current = null;

    startRemoteSync(
      pending.tombstone.id,
      () => deleteRemoteExpense(pending.tombstone),
      () => showRemoteFallbackNotice(pending.expense, "expense-list")
    );
    recordActivity(createActivityEntry("delete", pending.expense));
  }

  if (!ready) {
    return <main className="unlock-wrap" />;
  }

  return (
    <UnlockGate intro="输入旅行访问码后进入共享账本和行程。">
      <div className="app-shell docket-shell" ref={shellRef}>
        <header className="hero ledger-hero" data-motion="hero">
          <div className="hero-copy">
            <span className="hero-kicker">Travel docket · Australia 2026</span>
            <h1>Aussie Chill</h1>
            <p>
              2026.07.28-08.13，好友澳洲旅行账本。机票已单独 split，本账本只记录旅行中共同费用，按币种分别结算。
            </p>
          </div>
          <aside className="hero-ticket" aria-label="旅行摘要">
            <span>共享票夹</span>
            <strong>墨尔本进 · 悉尼出</strong>
            <p>{syncState}</p>
          </aside>
          <div className="hero-actions">
            <Link className="button primary" href="/add">记一笔</Link>
            <Link className="button" href="/settlement">看结算</Link>
            <Link className="button" href="/itinerary">看行程</Link>
            <span className="button">{syncState}</span>
          </div>
        </header>

        <ActionNotice notice={actionNotice} />

        {view === "dashboard" && (
          <Dashboard
            expenses={expenses}
            ledger={ledger}
            activity={activity}
            onUpdate={updateExpense}
            onConfirm={confirmExpense}
            onInvalid={showFormWarning}
          />
        )}
        {view === "expenses" && (
          <Expenses expenses={expenses} onUpdate={updateExpense} onConfirm={confirmExpense} onDelete={removeExpense} onInvalid={showFormWarning} />
        )}
        {view === "add" && <AddExpense onAdd={addExpense} onInvalid={showFormWarning} />}
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

function ActionNotice({ notice }) {
  if (!notice) return null;

  return (
    <div className={`action-toast ${notice.tone}`} role={notice.tone === "danger" ? "alert" : "status"} aria-live="polite" aria-atomic="true">
      <span>{notice.message}</span>
      {notice.actionLabel && (
        <button className="toast-action" type="button" onClick={notice.onAction}>
          {notice.actionLabel}
        </button>
      )}
    </div>
  );
}

function Dashboard({ expenses, ledger, activity, onUpdate, onConfirm, onInvalid }) {
  const recent = expenses.slice(0, 5);
  const stats = dashboardStats(expenses, activity);

  return (
    <>
      <DashboardDocket stats={stats} />
      <SummaryCards ledger={ledger} />
      <RecentActivity activity={dashboardActivityPreview(activity)} action={<Link href="/activity" className="button small">全部</Link>} />
      <section className="section ledger-section">
        <div className="section-head" data-motion="section">
          <h2>最近记录</h2>
          <Link href="/expenses" className="button small">全部</Link>
        </div>
        <ExpenseList expenses={recent} onUpdate={onUpdate} onConfirm={onConfirm} onInvalid={onInvalid} />
      </section>
    </>
  );
}

function DashboardDocket({ stats }) {
  return (
    <section className="section command-deck" data-motion="section" aria-label="旅行账本状态">
      <article className="docket-status">
        <span>{stats.tripLabel}</span>
        <h2>{stats.tripValue}</h2>
        <p>{stats.tripDetail}</p>
      </article>
      <div className="docket-metrics">
        <DocketMetric label="待分摊" value={stats.pendingSplitCount} detail="需要后续处理" href="/expenses?split=pending" />
        <DocketMetric label="待确认" value={stats.draftCount} detail="草稿费用" />
        <DocketMetric label="操作记录" value={stats.activityCount} detail="最近同步" />
      </div>
    </section>
  );
}

function DocketMetric({ label, value, detail, href }) {
  const body = (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );

  if (!href) return body;
  return <Link className="docket-metric-link" href={href}>{body}</Link>;
}

function ActivityPage({ activity }) {
  return <RecentActivity activity={activity} fullPage />;
}

function RecentActivity({ activity, action, fullPage = false }) {
  return (
    <section className={fullPage ? "section activity-section activity-page" : "section activity-section"} data-motion="activity-panel">
      <div className="section-head" data-motion="section">
        <h2>最近操作</h2>
        {action || <span className="muted">{activity.length ? `${activity.length} 条` : "暂无操作"}</span>}
      </div>
      <div className="activity-list">
        {!activity.length && (
          <article className="activity-row empty-state" data-motion="row">
            <div>
              <h3>还没有最近操作</h3>
              <p className="muted">新增、编辑、确认、删除费用后会显示在这里。</p>
            </div>
          </article>
        )}
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
      <section className="section summary-grid ledger-summary">
      {entries.map(([currency, bucket]) => (
        <article className={`card summary-card currency-${currency.toLowerCase()}`} key={currency} data-motion="summary-card">
          <span className="muted">{currency} 已确认总额</span>
          <strong>{formatMoney(currency, bucket.total)}</strong>
          <p className="muted">每对夫妻承担 {formatMoney(currency, bucket.eachCoupleShare)}</p>
        </article>
      ))}
      {entries.map(([currency, bucket]) => (
        <article className={`card summary-card is-net currency-${currency.toLowerCase()}`} key={`${currency}-net`} data-motion="summary-card">
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

function Expenses({ expenses, onUpdate, onConfirm, onDelete, onInvalid }) {
  const [urlFilters, setUrlFilters] = useState({ split: "全部", highlightId: "" });
  const [category, setCategory] = useState("全部");
  const [currency, setCurrency] = useState("全部");
  const [payer, setPayer] = useState("全部");
  const [splitFilter, setSplitFilter] = useState("全部");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const split = params.get("split") === "pending" ? "待分摊" : params.get("split") === "settled" ? "已分摊" : "全部";
    setUrlFilters({ split, highlightId: params.get("highlight") || "" });
    setSplitFilter(split);
  }, []);

  const filtered = expenses.filter((expense) => {
    return (
      (category === "全部" || expense.category === category) &&
      (currency === "全部" || expense.currency === currency) &&
      (payer === "全部" || expense.payer === payer) &&
      (splitFilter === "全部" ||
        (splitFilter === "待分摊" && expense.status === "confirmed" && !expense.splitSettled) ||
        (splitFilter === "已分摊" && expense.splitSettled))
    );
  });

  return (
    <section className="section ledger-section expenses-section">
      <div className="section-head" data-motion="section">
        <div>
          <span className="section-kicker">Receipt stream</span>
          <h2>费用明细</h2>
        </div>
        <span className="muted">{filtered.length} 条</span>
      </div>
      <div className="filters">
        <Select value={category} onChange={setCategory} options={["全部", ...categories]} />
        <Select value={currency} onChange={setCurrency} options={["全部", "CNY", "AUD"]} />
        <Select value={splitFilter} onChange={setSplitFilter} options={["全部", "待分摊", "已分摊"]} />
        <select value={payer} onChange={(event) => setPayer(event.target.value)}>
          <option value="全部">全部付款方</option>
          <option value="us">{coupleName("us")}</option>
          <option value="them">{coupleName("them")}</option>
        </select>
      </div>
      <ExpenseList expenses={filtered} onUpdate={onUpdate} onConfirm={onConfirm} onDelete={onDelete} onInvalid={onInvalid} highlightId={urlFilters.highlightId} />
    </section>
  );
}

function ExpenseList({ expenses, onUpdate, onConfirm, onDelete, onInvalid, highlightId = "" }) {
  const [editingId, setEditingId] = useState("");
  const [editForm, setEditForm] = useState(null);
  const [busyId, setBusyId] = useState("");

  function startEdit(expense) {
    setEditingId(expense.id);
    setEditForm(expenseToEditableForm(expense));
  }

  function cancelEdit() {
    setEditingId("");
    setEditForm(null);
  }

  async function saveEdit(expense) {
    if (!editForm?.item.trim() || !editForm.amount) {
      onInvalid?.("请先填写项目和金额");
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

  async function toggleSplitSettled(expense) {
    setBusyId(expense.id);
    try {
      await onUpdate(expense, "toggle-split");
    } catch {
      // Parent action handlers already surface failure feedback.
    } finally {
      setBusyId("");
    }
  }

  async function confirmRow(expense) {
    setBusyId(expense.id);
    try {
      await onConfirm(expense);
    } catch {
      // Parent action handlers already surface failure feedback.
    } finally {
      setBusyId("");
    }
  }

  async function deleteRow(expense) {
    setBusyId(expense.id);
    try {
      await onDelete(expense.id);
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

        if (isEditing) {
          return (
            <article className={rowClassName("expense-row editing", expense, isBusy, highlightId)} key={expense.id} data-motion="row" data-feedback-id={expense.id} aria-busy={isBusy}>
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
                <button className="button small primary" type="button" onClick={() => saveEdit(expense)} disabled={isBusy}>
                  {isBusy ? "保存中" : "保存"}
                </button>
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
                <span className="tag">{expense.category}</span>
                <span className={expense.status === "draft" ? "tag draft" : "tag"}>{expense.status === "draft" ? "待确认" : "已确认"}</span>
                <span className={expense.payer === "them" ? "tag other" : "tag"}>{formatPayerLabel(expense.payer)}</span>
                {expense.splitSettled && <span className="tag settled">已分摊</span>}
                {expense.attachmentName && <span className="tag">有小票</span>}
              </div>
            </div>
            <div className="stack row-actions">
              <strong className="amount">{formatMoney(expense.currency, expense.amount)}</strong>
              {onUpdate && (
                <button
                  className={expense.splitSettled ? "button small primary" : "button small"}
                  type="button"
                  aria-pressed={Boolean(expense.splitSettled)}
                  disabled={isBusy}
                  onClick={() => toggleSplitSettled(expense)}
                >
                  {splitSettledLabel(expense.splitSettled)}
                </button>
              )}
              {onUpdate && <button className="button small" onClick={() => startEdit(expense)} disabled={isBusy}>编辑</button>}
              {onConfirm && expense.status === "draft" && (
                <button className="button small primary" onClick={() => confirmRow(expense)} disabled={isBusy}>确认</button>
              )}
              {onDelete && (
                <button className="button small danger" onClick={() => deleteRow(expense)} disabled={isBusy}>删除</button>
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

function AddExpense({ onAdd, onInvalid }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [form, setForm] = useState(emptyForm());
  const [receipt, setReceipt] = useState(null);
  const [saving, setSaving] = useState(false);

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
  }

  async function submit() {
    if (!form.item.trim() || !form.amount) {
      onInvalid?.("请先填写项目和金额");
      return;
    }

    setSaving(true);
    try {
      let attachmentName = receipt?.name || form.attachmentName || "";
      if (receipt) {
        try {
          attachmentName = (await uploadRemoteReceipt(receipt)) || receipt.name;
        } catch {
          attachmentName = receipt.name;
        }
      }

      const nextExpense = {
        ...form,
        id: form.id || `expense-${Date.now()}`,
        amount: Number(form.amount),
        attachmentName,
      };
      await onAdd(nextExpense);

      const nextDefaults = {
        category: form.category,
        date: form.date,
        currency: form.currency,
        payer: form.payer,
      };
      localStorage.setItem(addDefaultsStorageKey, JSON.stringify(nextDefaults));
      setForm(emptyForm(nextDefaults));
      setMessage("");
      setReceipt(null);
      router.push(`/expenses?highlight=${encodeURIComponent(nextExpense.id)}`);
    } catch {
      // The parent surfaces the failure toast and animation.
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
          <button className="button primary" type="button" onClick={submit} disabled={saving}>
            {saving ? "保存中" : "保存"}
          </button>
        </div>
      </div>
    </section>
  );
}

function findFeedbackTarget(root, targetId) {
  if (!root) return null;
  if (targetId === "expense-form" || targetId === "expense-list") {
    return root.querySelector(`[data-feedback-target='${targetId}']`);
  }
  return root.querySelector(`[data-feedback-id='${escapeFeedbackSelector(targetId)}']`) || root.querySelector("[data-motion='activity-panel']");
}

function escapeFeedbackSelector(value) {
  return String(value || "").replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

function rowClassName(baseClassName, expense, isBusy, highlightId) {
  return [
    baseClassName,
    isBusy ? "is-busy" : "",
    highlightId && expense.id === highlightId ? "is-highlighted" : "",
  ].filter(Boolean).join(" ");
}

function Settlement({ ledger }) {
  const entries = Object.entries(ledger.currencies);

  return (
    <>
      <section className="section settlement-grid ledger-summary">
        {entries.map(([currency, bucket]) => (
          <article className={`card summary-card settlement-card currency-${currency.toLowerCase()}`} key={currency} data-motion="summary-card">
            <span className="muted">{currency} 结算</span>
            <strong>{formatMoney(currency, Math.abs(bucket.netOtherOwesUs))}</strong>
            <p className="muted">
              {formatSettlementDirection(bucket.netOtherOwesUs)}
            </p>
          </article>
        ))}
      </section>
      <section className="section ledger-section">
        <div className="section-head" data-motion="section">
          <h2>待分摊分类小计</h2>
          <span className="muted">当前待结算</span>
        </div>
        <div className="expense-list">
          {entries.flatMap(([currency]) =>
            Object.entries(ledger.pendingCategoriesByCurrency[currency] || {}).map(([category, amount]) => (
              <article className="expense-row" key={`${currency}-${category}`} data-motion="row">
                <div>
                  <h3>{category}</h3>
                  <p className="muted">{currency}</p>
                </div>
                <strong className="amount">{formatMoney(currency, amount)}</strong>
              </article>
            )),
          )}
          {entries.every(([currency]) => !Object.keys(ledger.pendingCategoriesByCurrency[currency] || {}).length) && (
            <article className="expense-row empty-state" data-motion="row">
              <div>
                <h3>当前没有待分摊费用</h3>
                <p className="muted">两边已结清</p>
              </div>
            </article>
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

function dashboardStats(expenses, activity) {
  const pendingSplitCount = expenses.filter((expense) => expense.status === "confirmed" && !expense.splitSettled).length;
  const draftCount = expenses.filter((expense) => expense.status === "draft").length;
  const tripClock = tripStatus();

  return {
    pendingSplitCount,
    draftCount,
    activityCount: activity.length,
    ...tripClock,
  };
}

function tripStatus(now = new Date()) {
  const start = new Date(2026, 6, 28);
  const end = new Date(2026, 7, 13);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayMs = 24 * 60 * 60 * 1000;

  if (today < start) {
    const days = Math.ceil((start.getTime() - today.getTime()) / dayMs);
    return {
      tripLabel: "行前票夹",
      tripValue: `T-${days}`,
      tripDetail: "先把酒店、租车、门票和预付账单收齐。",
    };
  }

  if (today <= end) {
    const day = Math.floor((today.getTime() - start.getTime()) / dayMs);
    return {
      tripLabel: "旅行中",
      tripValue: `D${day}`,
      tripDetail: "当天发生的共同费用，先记再慢慢补细节。",
    };
  }

  return {
    tripLabel: "返程后",
    tripValue: "收尾",
    tripDetail: "核对待分摊和待确认项目，完成最终结算。",
  };
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
    ...defaults,
  };
}

function removeEmptyValues(values) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value));
}
