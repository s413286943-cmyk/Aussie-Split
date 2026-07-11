"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  calculateLedger,
  formatMoney,
  seedExpenses,
  setExpenseSplitSettled,
} from "@/lib/ledger";
import {
  actionFeedbackMessage,
  createActivityEntry,
} from "@/lib/activity";
import { formatSettlementDirection } from "@/lib/couples";
import { createLedgerBackup } from "@/lib/backup";
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
import { uploadReceiptRecord } from "@/lib/receiptUpload";
import { createSerialLedgerActionQueue } from "@/lib/sync";
import { syncStateLabel } from "@/lib/syncEngine";
import UnlockGate from "@/components/UnlockGate";
import ActivityFeed from "@/components/ledger/ActivityFeed";
import BackupPanel from "@/components/ledger/BackupPanel";
import ExpenseForm from "@/components/ledger/ExpenseForm";
import ExpenseList, { ExpenseListPage } from "@/components/ledger/ExpenseList";
import LedgerShell from "@/components/ledger/LedgerShell";

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

  async function exportBackup() {
    const context = offlineContextRef.current;
    if (!context) throw new Error("Offline ledger is unavailable");
    const state = await context.load();
    const backup = createLedgerBackup({
      expenses: state.expenses,
      activity: state.activity,
    });
    showActionNotice(`已导出 ${backup.expenses.length} 条费用`, "success");
    return backup;
  }

  async function mergeBackup(acceptedExpenses) {
    if (!Array.isArray(acceptedExpenses) || !acceptedExpenses.length) return;
    try {
      for (const expense of acceptedExpenses) {
        const exists = expensesRef.current.some((item) => item.id === expense.id);
        await commitLedgerMutation(
          () => expense,
          { activityAction: exists ? "edit" : "add" },
        );
      }
      showActionNotice(`已合并 ${acceptedExpenses.length} 条备份记录`, "success");
      playFeedback("backup-panel", "success");
      requestLedgerSync();
    } catch {
      showActionNotice("备份合并失败，现有账本未被清空", "danger");
      playFeedback("backup-panel", "danger");
      throw new Error("backup-merge-failed");
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
    <LedgerShell
      view={view}
      syncState={syncState}
      onSync={requestLedgerSync}
      notice={actionNotice}
      shellRef={shellRef}
    >
      {view === "dashboard" && (
        <Dashboard
          expenses={expenses}
          ledger={ledger}
          activity={activity}
          syncState={syncState}
          onUpdate={updateExpense}
          onConfirm={confirmExpense}
          onViewReceipt={viewReceipt}
          onInvalid={showFormWarning}
        />
      )}
      {view === "expenses" && (
        <ExpenseListPage expenses={expenses} onUpdate={updateExpense} onConfirm={confirmExpense} onDelete={removeExpense} onViewReceipt={viewReceipt} onInvalid={showFormWarning} />
      )}
      {view === "add" && <ExpenseForm onAdd={addExpense} onInvalid={showFormWarning} expenses={expenses} />}
      {view === "settlement" && <Settlement ledger={ledger} />}
      {view === "activity" && (
        <>
          <ActivityFeed activity={activity} fullPage syncState={syncState} />
          <BackupPanel expenses={expenses} onExport={exportBackup} onMerge={mergeBackup} />
        </>
      )}
    </LedgerShell>
  );
}

function Dashboard({ expenses, ledger, activity, syncState, onUpdate, onConfirm, onViewReceipt, onInvalid }) {
  const recent = expenses.slice(0, 5);
  const stats = dashboardStats(expenses, activity);

  return (
    <>
      <DashboardDocket stats={stats} />
      <SummaryCards ledger={ledger} />
      <ActivityFeed activity={activity} syncState={syncState} />
      <section className="section ledger-section">
        <div className="section-head" data-motion="section">
          <h2>最近记录</h2>
          <Link href="/expenses" className="button small">全部</Link>
        </div>
        <ExpenseList expenses={recent} allExpenses={expenses} onUpdate={onUpdate} onConfirm={onConfirm} onViewReceipt={onViewReceipt} onInvalid={onInvalid} />
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

function findFeedbackTarget(root, targetId) {
  if (!root) return null;
  if (["expense-form", "expense-list", "backup-panel"].includes(targetId)) {
    return root.querySelector(`[data-feedback-target='${targetId}']`);
  }
  return root.querySelector(`[data-feedback-id='${escapeFeedbackSelector(targetId)}']`) || root.querySelector("[data-motion='activity-panel']");
}

function escapeFeedbackSelector(value) {
  return String(value || "").replaceAll("\\", "\\\\").replaceAll("'", "\\'");
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

function newOperationId() {
  if (!globalThis.crypto?.randomUUID) throw new Error("Web Crypto randomUUID is unavailable");
  return `op-${globalThis.crypto.randomUUID()}`;
}
