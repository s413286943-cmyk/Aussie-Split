"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  applyExpenseEdit,
  applyExpenseTemplate,
  calculateLedger,
  categories,
  createCapturedExpense,
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
} from "@/lib/activity";
import { coupleName, formatPayerLabel, formatSettlementDirection } from "@/lib/couples";
import { pulseElement, revealPage, shakeElement } from "@/lib/motion";
import { applyLedgerOperations, fetchReceipt } from "@/lib/apiClient";
import {
  closeOfflineLedger,
  commitOfflineMutation,
  initializeOfflineLedger,
  syncOfflineLedger,
  syncOfflineReceipts,
  undoOfflineDelete,
} from "@/lib/offlineLedger";
import { createReceiptBlobRecord } from "@/lib/receipt";
import { uploadReceiptRecord } from "@/lib/receiptUpload";
import { createSerialLedgerActionQueue } from "@/lib/sync";
import { syncStateLabel } from "@/lib/syncEngine";
import UnlockGate from "@/components/UnlockGate";

const addDefaultsStorageKey = "aussie-chill-add-defaults-v1";
const undoDeleteMs = 5000;

export default function TripLedgerApp({ view }) {
  return (
    <UnlockGate intro="输入旅行访问码后进入共享账本和行程。">
      <TripLedgerContent view={view} />
    </UnlockGate>
  );
}

function TripLedgerContent({ view }) {
  const shellRef = useRef(null);
  const noticeTimerRef = useRef(null);
  const pendingDeleteRef = useRef(null);
  const deferredReceiptFailureRef = useRef(false);
  const mountedRef = useRef(false);
  const offlineContextRef = useRef(null);
  const expensesRef = useRef(seedExpenses);
  const ledgerActionQueueRef = useRef(null);
  const syncPromiseRef = useRef(null);
  const syncRequestedRef = useRef(false);
  const syncRetryTimerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [expenses, setExpenses] = useState(seedExpenses);
  const [activity, setActivity] = useState([]);
  const [activityPulseKey, setActivityPulseKey] = useState(0);
  const [actionNotice, setActionNotice] = useState(null);
  const [feedbackAnimation, setFeedbackAnimation] = useState(null);
  const [syncState, setSyncState] = useState("正在同步");
  const ledger = useMemo(() => calculateLedger(expenses), [expenses]);

  const showActionNotice = useCallback((message, tone = "success", options = {}) => {
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    setActionNotice({
      id: Date.now(),
      message,
      tone,
      actionLabel: options.actionLabel,
      onAction: options.onAction,
    });
    noticeTimerRef.current = window.setTimeout(() => setActionNotice(null), options.duration ?? 3200);
  }, []);

  const applyOfflineState = useCallback((state) => {
    if (!mountedRef.current) return;
    expensesRef.current = state.expenses;
    setExpenses(state.expenses);
    setActivity(state.activity);
  }, []);

  const requestLedgerSync = useCallback(function requestLedgerSync() {
    if (syncRetryTimerRef.current) {
      window.clearTimeout(syncRetryTimerRef.current);
      syncRetryTimerRef.current = null;
    }
    syncRequestedRef.current = true;
    if (syncPromiseRef.current || !offlineContextRef.current) {
      return syncPromiseRef.current ?? Promise.resolve();
    }

    const promise = (async () => {
      while (syncRequestedRef.current && offlineContextRef.current) {
        syncRequestedRef.current = false;
        const context = offlineContextRef.current;
        const before = await context.load();

        if (!navigator.onLine) {
          if (mountedRef.current) {
            setSyncState(before.meta.lastSyncAt
              ? syncStateLabel({ pendingCount: before.outboxCount })
              : before.outboxCount > 0
                ? syncStateLabel({ pendingCount: before.outboxCount })
                : "同步失败，可重试");
          }
          continue;
        }

        if (mountedRef.current) {
          setSyncState(syncStateLabel({ pendingCount: before.outboxCount, syncing: true }));
        }

        try {
          const synced = await syncOfflineLedger(context, {
            sendOperations: applyLedgerOperations,
            now: Date.now,
          });
          const receiptSync = await syncOfflineReceipts(context, {
            uploadReceipt: uploadReceiptRecord,
            now: Date.now,
          });
          applyOfflineState(receiptSync.state);
          if (!mountedRef.current) continue;
          if (synced.result.reason === "lease_unavailable") {
            syncRetryTimerRef.current = window.setTimeout(requestLedgerSync, 500);
          }
          const failed = !synced.result.completed && synced.result.reason !== "lease_unavailable";
          if (receiptSync.failed > 0) {
            if (failed) setSyncState("同步失败，可重试");
            else setSyncState("小票待重试");
            if (pendingDeleteRef.current) {
              deferredReceiptFailureRef.current = true;
            } else {
              showActionNotice("账单已保存，小票待重试", "warning");
            }
          } else {
            setSyncState(syncStateLabel({ pendingCount: receiptSync.state.outboxCount, failed }));
          }
        } catch {
          if (mountedRef.current) setSyncState("同步失败，可重试");
        }
      }
    })()
      .catch(() => {
        if (mountedRef.current) setSyncState("同步失败，可重试");
      })
      .finally(() => {
        syncPromiseRef.current = null;
        if (syncRequestedRef.current && offlineContextRef.current) {
          queueMicrotask(() => requestLedgerSync());
        }
      });

    syncPromiseRef.current = promise;
    return promise;
  }, [applyOfflineState, showActionNotice]);

  useEffect(() => {
    let cancelled = false;
    mountedRef.current = true;
    ledgerActionQueueRef.current = ledgerActionQueueRef.current ?? createSerialLedgerActionQueue();

    async function initializeLedger() {
      let initialized = false;
      try {
        const context = await initializeOfflineLedger({
          storage: localStorage,
        });
        if (cancelled) {
          closeOfflineLedger(context);
          return;
        }

        offlineContextRef.current = context;
        applyOfflineState(context.state);
        setSyncState(syncStateLabel({ pendingCount: context.state.outboxCount }));
        initialized = true;
      } catch {
        if (!cancelled) {
          expensesRef.current = [];
          setExpenses([]);
          setActivity([]);
          setSyncState("保存失败");
        }
      } finally {
        if (!cancelled) {
          setReady(true);
          if (initialized) requestLedgerSync();
        }
      }
    }

    initializeLedger();

    const handleOnline = () => requestLedgerSync();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") requestLedgerSync();
    };
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      mountedRef.current = false;
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibility);
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
      if (syncRetryTimerRef.current) window.clearTimeout(syncRetryTimerRef.current);
      if (pendingDeleteRef.current?.timer) window.clearTimeout(pendingDeleteRef.current.timer);
      const context = offlineContextRef.current;
      offlineContextRef.current = null;
      Promise.resolve(syncPromiseRef.current)
        .catch(() => {})
        .finally(() => closeOfflineLedger(context));
    };
  }, [applyOfflineState, requestLedgerSync]);

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

  function playFeedback(targetId, tone = "success") {
    setFeedbackAnimation({ id: Date.now(), targetId, tone });
  }

  function showPersistNotice(action, expense, targetId = expense.id) {
    showActionNotice(actionFeedbackMessage(action, expense), "success");
    playFeedback(targetId, "success");
  }

  function showFormWarning(message) {
    showActionNotice(message, "warning");
    playFeedback("expense-form", "warning");
  }

  async function commitLedgerMutation(createCandidate, options) {
    return ledgerActionQueueRef.current(async () => {
      const mutationOptions = options ?? {};
      const context = offlineContextRef.current;
      if (!context) throw new Error("Offline ledger is unavailable");
      const currentExpenses = expensesRef.current;
      const candidate = createCandidate(currentExpenses);
      if (!candidate) return null;
      const previousExpense = currentExpenses.find((item) => item.id === candidate.id) ?? null;
      const now = mutationOptions.now ?? Date.now();
      const entry = createActivityEntry(
        mutationOptions.activityAction ?? "edit",
        candidate,
        new Date(now),
        mutationOptions.activityAction === "edit" ? previousExpense : null,
      );
      const opId = mutationOptions.opId ?? newOperationId();
      const nextState = await commitOfflineMutation(context, {
        type: mutationOptions.type ?? "upsert",
        expense: candidate,
        activity: entry,
        opId,
        now,
        createdAt: entry.createdAt,
        receipt: mutationOptions.receipt,
      });
      const versionedExpense = nextState.rawExpenses.find((item) => item.id === candidate.id);
      applyOfflineState(nextState);
      setSyncState(syncStateLabel({ pendingCount: nextState.outboxCount }));
      setActivityPulseKey((key) => key + 1);
      return {
        expense: versionedExpense,
        entry,
        opId,
        previousExpense,
        previousExpenses: currentExpenses,
        state: nextState,
      };
    });
  }

  async function addExpense(expense, receipt) {
    try {
      const committed = await commitLedgerMutation(
        () => expense,
        { activityAction: "add", receipt },
      );
      const versionedExpense = committed.expense;
      showPersistNotice("add", versionedExpense, "expense-form");
      requestLedgerSync();
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
        { activityAction: "edit" },
      );
      if (!committed) return;
      const versionedExpense = committed.expense;
      const previousExpense = committed.previousExpense;
      const feedbackAction = previousExpense && Boolean(previousExpense.splitSettled) !== Boolean(versionedExpense.splitSettled) ? "split" : "edit";
      showPersistNotice(feedbackAction, versionedExpense);
      requestLedgerSync();
    } catch {
      showActionNotice(`保存修改失败：${expense.item || "这笔费用"}`, "danger");
      playFeedback(expense.id, "danger");
      throw new Error("expense-update-failed");
    }
  }

  async function viewReceipt(expense) {
    const popup = window.open("", "_blank");
    if (popup) popup.opener = null;
    try {
      const result = await fetchReceipt(expense.id);
      if (popup) popup.location.replace(result.signedUrl);
      else window.location.assign(result.signedUrl);
    } catch {
      popup?.close();
      showActionNotice(`小票打开失败：${expense.item}`, "danger");
      playFeedback(expense.id, "danger");
    }
  }

  async function confirmExpense(expense) {
    try {
      const committed = await commitLedgerMutation(
        (currentExpenses) => {
          const latestExpense = currentExpenses.find((item) => item.id === expense.id);
          return latestExpense ? { ...latestExpense, status: "confirmed" } : null;
        },
        { activityAction: "confirm" },
      );
      if (!committed) return;
      const confirmed = committed.expense;
      showPersistNotice("confirm", confirmed);
      requestLedgerSync();
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
      const opId = newOperationId();
      const committed = await commitLedgerMutation(
        (currentExpenses) => currentExpenses.find((item) => item.id === id) ?? null,
        { type: "delete", activityAction: "delete", opId },
      );
      if (!committed) return;
      removed = committed.previousExpense;
      const tombstone = committed.expense;
      const timer = window.setTimeout(() => finalizePendingDelete(id), undoDeleteMs);
      pendingDeleteRef.current = {
        id,
        expense: removed,
        tombstone,
        opId,
        deleteActivityId: committed.entry.id,
        timer,
      };
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
    const receiptFailureDeferred = deferredReceiptFailureRef.current;
    deferredReceiptFailureRef.current = false;

    try {
      const now = Date.now();
      const activity = {
        ...createActivityEntry("edit", pending.expense, new Date(now), pending.tombstone),
        summary: `恢复了 ${pending.expense.item || "未命名费用"}`,
      };
      const result = await ledgerActionQueueRef.current(async () => {
        const context = offlineContextRef.current;
        if (!context) throw new Error("Offline ledger is unavailable");
        return undoOfflineDelete(context, {
          deleteOpId: pending.opId,
          expense: pending.expense,
          deleteActivityId: pending.deleteActivityId,
          activity,
          opId: newOperationId(),
          now,
        });
      });
      applyOfflineState(result.state);
      setSyncState(syncStateLabel({ pendingCount: result.state.outboxCount }));
      if (result.requiresSync) requestLedgerSync();
    } catch {
      showActionNotice(
        `恢复失败：${pending.expense.item}${receiptFailureDeferred ? "；小票待重试" : ""}`,
        "danger",
      );
      playFeedback(pending.expense.id, "danger");
      return;
    }
    showActionNotice(
      `已恢复：${pending.expense.item}${receiptFailureDeferred ? "；小票待重试" : ""}`,
      receiptFailureDeferred ? "warning" : "success",
    );
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
    requestLedgerSync();
    if (deferredReceiptFailureRef.current) {
      deferredReceiptFailureRef.current = false;
      showActionNotice("账单已保存，小票待重试", "warning");
    }
  }

  if (!ready) {
    return <main className="unlock-wrap" />;
  }

  return (
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
            <button
              className="button"
              type="button"
              onClick={requestLedgerSync}
              disabled={syncState === "正在同步"}
              aria-label={syncState === "同步失败，可重试" ? "重试同步" : "立即同步账本"}
            >
              {syncState}
            </button>
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
            onViewReceipt={viewReceipt}
            onInvalid={showFormWarning}
          />
        )}
        {view === "expenses" && (
          <Expenses expenses={expenses} onUpdate={updateExpense} onConfirm={confirmExpense} onDelete={removeExpense} onViewReceipt={viewReceipt} onInvalid={showFormWarning} />
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

function Dashboard({ expenses, ledger, activity, onUpdate, onConfirm, onViewReceipt, onInvalid }) {
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
        <ExpenseList expenses={recent} onUpdate={onUpdate} onConfirm={onConfirm} onViewReceipt={onViewReceipt} onInvalid={onInvalid} />
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

function Expenses({ expenses, onUpdate, onConfirm, onDelete, onViewReceipt, onInvalid }) {
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
      <ExpenseList expenses={filtered} onUpdate={onUpdate} onConfirm={onConfirm} onDelete={onDelete} onViewReceipt={onViewReceipt} onInvalid={onInvalid} highlightId={urlFilters.highlightId} />
    </section>
  );
}

function ExpenseList({ expenses, onUpdate, onConfirm, onDelete, onViewReceipt, onInvalid, highlightId = "" }) {
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
        const receiptPending = expense.attachmentStatus === "pending";
        const receiptUploaded = expense.attachmentStatus === "uploaded" || Boolean(expense.attachmentPath);

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
                {receiptPending && <span className="tag draft">小票待上传</span>}
                {receiptUploaded && <span className="tag">有小票</span>}
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
              {onViewReceipt && receiptUploaded && (
                <button className="button small" type="button" onClick={() => onViewReceipt(expense)} disabled={isBusy}>
                  查看小票
                </button>
              )}
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
    splitSettled: false,
    ...defaults,
  };
}

function removeEmptyValues(values) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value));
}

function newOperationId() {
  if (!globalThis.crypto?.randomUUID) throw new Error("Web Crypto randomUUID is unavailable");
  return `op-${globalThis.crypto.randomUUID()}`;
}
