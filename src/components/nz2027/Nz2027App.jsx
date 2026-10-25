"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import UnlockGate from "@/components/UnlockGate";
import Nz2027Checklist from "@/components/nz2027/Nz2027Checklist";
import Nz2027Ledger from "@/components/nz2027/Nz2027Ledger";
import Nz2027Schedule from "@/components/nz2027/Nz2027Schedule";
import {
  fetchNz2027Checklist,
  fetchNz2027Expenses,
  fetchNz2027Itinerary,
  pushNz2027Checklist,
  pushNz2027Expenses,
} from "@/lib/apiClient";
import {
  applyChecklistSnapshot,
  emptyChecklist,
  loadChecklist,
  pendingChecks,
  saveChecklist,
  setCheck,
} from "@/lib/nz2027/checklist";
import {
  applyServerSnapshot,
  deleteLocal,
  emptyState,
  listRecords,
  loadState,
  pendingRecords,
  restoreLocal,
  saveState,
  upsertLocal,
} from "@/lib/nz2027/store";

const itineraryCacheKey = "nz2027-itinerary-v1";

const tabs = [
  { id: "schedule", href: "/", label: "日程" },
  { id: "checklist", href: "/nz2027/checklist", label: "清单" },
  { id: "ledger", href: "/nz2027/ledger", label: "记账" },
];

export default function Nz2027App({ view }) {
  return (
    <UnlockGate title="澳新 2027" intro="输入访问码，打开我们的澳新行程。">
      <Nz2027Content view={view} />
    </UnlockGate>
  );
}

function Nz2027Content({ view }) {
  const itinerary = useItinerary();
  const ledger = useLedger();
  const checklist = useChecklist();
  const openCount = itinerary.data ? itinerary.data.todos.filter((todo) => !checklist.isDone(todo.id)).length : 0;

  return (
    <div className={`nz nz-view-${view}`}>
      {view !== "schedule" && (
        <header className="nz-top">
          <Link href="/" className="nz-mark" aria-label="澳新 2027 日程">澳新 2027</Link>
          <span>2月1日 – 17日 · 悉尼 + 新西兰</span>
        </header>
      )}
      <nav className="nz-tabs" aria-label="主导航">
        {tabs.map((tab) => (
          <Link key={tab.id} href={tab.href} className={tab.id === view ? "is-active" : ""} aria-current={tab.id === view ? "page" : undefined}>
            {tab.label}
            {tab.id === "checklist" && openCount > 0 && <span className="nz-tab-count" aria-label={`还有 ${openCount} 件`}>{openCount}</span>}
          </Link>
        ))}
      </nav>

      <main className="nz-main">
        {!itinerary.data && view !== "ledger" ? (
          <LoadState state={itinerary.state} />
        ) : view === "schedule" ? (
          <Nz2027Schedule itinerary={itinerary.data} records={ledger.records} checklist={checklist} />
        ) : view === "checklist" ? (
          <Nz2027Checklist todos={itinerary.data.todos} checklist={checklist} />
        ) : (
          <Nz2027Ledger
            records={ledger.records}
            days={itinerary.data?.days || []}
            syncLabel={ledger.syncLabel}
            syncing={ledger.syncing}
            onSync={ledger.sync}
            onSave={ledger.save}
            onDelete={ledger.remove}
            onRestore={ledger.restore}
          />
        )}
      </main>
    </div>
  );
}

function LoadState({ state }) {
  return (
    <section className="nz-empty" role="status" aria-live="polite">
      <h2>{state === "loading" ? "正在打开行程" : "行程暂时打不开"}</h2>
      <p>{state === "offline" ? "第一次需要联网打开，之后没信号也能看。" : state === "loading" ? "稍等一下。" : "联网后会自动重试。"}</p>
    </section>
  );
}

function useItinerary() {
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      await Promise.resolve();
      let cached = null;
      try {
        cached = JSON.parse(localStorage.getItem(itineraryCacheKey) || "null");
      } catch {
        cached = null;
      }
      const usable = cached && Array.isArray(cached.days) && Array.isArray(cached.todos) && cached.todos.every((todo) => todo.id);
      if (usable && !cancelled) {
        setData(cached);
        setState("cached");
      }
      if (!navigator.onLine) {
        if (!usable && !cancelled) setState("offline");
        return;
      }
      try {
        const response = await fetchNz2027Itinerary();
        if (cancelled || !Array.isArray(response?.itinerary?.days)) return;
        setData(response.itinerary);
        setState("current");
        try {
          localStorage.setItem(itineraryCacheKey, JSON.stringify(response.itinerary));
        } catch {
          // Still usable online when storage is full.
        }
      } catch {
        if (!usable && !cancelled) setState("unavailable");
      }
    }
    load();
    window.addEventListener("online", load);
    return () => {
      cancelled = true;
      window.removeEventListener("online", load);
    };
  }, []);

  return { data, state };
}

// Shared local-first sync loop: keep a ref of the latest state, persist on every
// change, push queued items when online and merge the server snapshot back.
function useSyncedState({ initial, load, save, pending, push, fetchAll, merge }) {
  const [state, setState] = useState(initial);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState("idle");
  const stateRef = useRef(state);
  const busyRef = useRef(false);
  const againRef = useRef(false);

  const commit = useCallback((next) => {
    stateRef.current = next;
    setState(next);
    try {
      save(localStorage, next);
    } catch {
      // Kept in memory for this visit if storage is unavailable.
    }
  }, [save]);

  const sync = useCallback(async () => {
    if (busyRef.current) {
      againRef.current = true;
      return;
    }
    if (!navigator.onLine) {
      setStatus("offline");
      return;
    }
    busyRef.current = true;
    setStatus("syncing");
    try {
      do {
        againRef.current = false;
        const sent = pending(stateRef.current);
        const response = sent.length ? await push(sent) : await fetchAll();
        commit(merge(stateRef.current, sent, response));
      } while (againRef.current);
      setStatus("synced");
    } catch {
      setStatus("failed");
    } finally {
      busyRef.current = false;
    }
  }, [commit, fetchAll, merge, pending, push]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      const initialState = load(localStorage);
      stateRef.current = initialState;
      setState(initialState);
      setLoaded(true);
      sync();
    });
    const handleOnline = () => sync();
    window.addEventListener("online", handleOnline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", handleOnline);
    };
  }, [load, sync]);

  const update = useCallback((change) => {
    commit(change(stateRef.current));
    sync();
  }, [commit, sync]);

  return { state, loaded, status, sync, update };
}

function syncText(loaded, status, pendingCount, noun) {
  if (!loaded) return "正在读取";
  if (status === "syncing") return "正在同步";
  if (pendingCount) {
    return status === "failed"
      ? `没连上，${pendingCount} ${noun}稍后自动重试`
      : `已存在手机上，联网后同步（${pendingCount} ${noun}）`;
  }
  if (status === "failed") return "没连上，稍后自动重试";
  return status === "synced" ? "已同步" : "已存在手机上";
}

const ledgerSync = {
  initial: emptyState,
  load: loadState,
  save: saveState,
  pending: pendingRecords,
  push: pushNz2027Expenses,
  fetchAll: fetchNz2027Expenses,
  merge: (state, sent, response) => applyServerSnapshot(state, { sent, expenses: response.expenses, serverTime: response.serverTime }),
};

function useLedger() {
  const synced = useSyncedState(ledgerSync);
  const { update } = synced;
  const records = useMemo(() => listRecords(synced.state), [synced.state]);
  return {
    records,
    syncLabel: syncText(synced.loaded, synced.status, synced.state.pendingIds.length, "笔"),
    syncing: synced.status === "syncing",
    sync: synced.sync,
    save: useCallback((record) => update((state) => upsertLocal(state, record)), [update]),
    remove: useCallback((id) => update((state) => deleteLocal(state, id)), [update]),
    restore: useCallback((record) => update((state) => restoreLocal(state, record)), [update]),
  };
}

const checklistSync = {
  initial: emptyChecklist,
  load: loadChecklist,
  save: saveChecklist,
  pending: pendingChecks,
  push: pushNz2027Checklist,
  fetchAll: fetchNz2027Checklist,
  merge: (state, sent, response) => applyChecklistSnapshot(state, { sent, items: response.items }),
};

function useChecklist() {
  const synced = useSyncedState(checklistSync);
  const { update, state } = synced;
  return {
    isDone: useCallback((id) => Boolean(state.items[id]?.done), [state]),
    toggle: useCallback((id, done) => update((current) => setCheck(current, id, done)), [update]),
    syncLabel: syncText(synced.loaded, synced.status, state.pendingIds.length, "项"),
  };
}
