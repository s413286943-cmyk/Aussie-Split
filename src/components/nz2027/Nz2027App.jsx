"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import AppNav from "@/components/AppNav";
import UnlockGate from "@/components/UnlockGate";
import Nz2027Ledger from "@/components/nz2027/Nz2027Ledger";
import Nz2027Schedule from "@/components/nz2027/Nz2027Schedule";
import { fetchNz2027Expenses, fetchNz2027Itinerary, pushNz2027Expenses } from "@/lib/apiClient";
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

export default function Nz2027App({ view }) {
  return (
    <UnlockGate intro="输入旅行访问码后查看 2027 两人行程和账本。">
      <Nz2027Content view={view} />
    </UnlockGate>
  );
}

function Nz2027Content({ view }) {
  const itinerary = useNz2027Itinerary();
  const ledger = useNz2027Ledger();

  return (
    <main className="nz27-shell">
      <header className="nz27-header">
        <div>
          <span className="nz27-kicker">2027 两人行程 · 与 2026 分账账本分开</span>
          <h1>澳新 2027</h1>
          <p>{itinerary.data?.trip.dates || "2027.02.01-02.17"} · {itinerary.data?.trip.travelers || "2位成人"} · 悉尼 + 新西兰南北岛</p>
        </div>
        <nav className="nz27-subnav" aria-label="2027 两人行程导航">
          <Link href="/nz2027" className={view === "schedule" ? "active" : ""} aria-current={view === "schedule" ? "page" : undefined}>日程</Link>
          <Link href="/nz2027/ledger" className={view === "ledger" ? "active" : ""} aria-current={view === "ledger" ? "page" : undefined}>记账</Link>
        </nav>
      </header>

      {view === "schedule" ? (
        itinerary.data
          ? <Nz2027Schedule itinerary={itinerary.data} records={ledger.records} />
          : <LoadState state={itinerary.state} />
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
      <AppNav activeView="nz2027" />
    </main>
  );
}

function LoadState({ state }) {
  return (
    <section className="nz27-card" role="status" aria-live="polite">
      <h2>{state === "loading" ? "正在载入 2027 日程" : "日程暂时无法载入"}</h2>
      <p className="muted">{state === "offline" ? "请先联网打开一次，之后即可离线查看。" : state === "loading" ? "正在读取受保护的旅行资料。" : "网络恢复后会自动重试。"}</p>
    </section>
  );
}

function useNz2027Itinerary() {
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
      if (cached && Array.isArray(cached.days) && !cancelled) {
        setData(cached);
        setState("cached");
      }
      if (!navigator.onLine) {
        if (!cached && !cancelled) setState("offline");
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
          // The online copy still renders when storage is full.
        }
      } catch {
        if (!cached && !cancelled) setState("unavailable");
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

function useNz2027Ledger() {
  const [state, setState] = useState(emptyState);
  const [loaded, setLoaded] = useState(false);
  const [syncStatus, setSyncStatus] = useState("idle");
  const stateRef = useRef(state);
  const syncingRef = useRef(false);
  const rerunRef = useRef(false);

  const commit = useCallback((next) => {
    stateRef.current = next;
    setState(next);
    try {
      saveState(localStorage, next);
    } catch {
      // Records remain in memory for this session if storage is unavailable.
    }
  }, []);

  const sync = useCallback(async () => {
    if (syncingRef.current) {
      rerunRef.current = true;
      return;
    }
    if (!navigator.onLine) {
      setSyncStatus("offline");
      return;
    }
    syncingRef.current = true;
    setSyncStatus("syncing");
    try {
      do {
        rerunRef.current = false;
        const sent = pendingRecords(stateRef.current);
        const response = sent.length ? await pushNz2027Expenses(sent) : await fetchNz2027Expenses();
        commit(applyServerSnapshot(stateRef.current, { sent, expenses: response.expenses, serverTime: response.serverTime }));
      } while (rerunRef.current);
      setSyncStatus("synced");
    } catch {
      setSyncStatus("failed");
    } finally {
      syncingRef.current = false;
    }
  }, [commit]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      const initial = loadState(localStorage);
      stateRef.current = initial;
      setState(initial);
      setLoaded(true);
      sync();
    });
    const handleOnline = () => sync();
    window.addEventListener("online", handleOnline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", handleOnline);
    };
  }, [sync]);

  const save = useCallback((record) => {
    commit(upsertLocal(stateRef.current, record));
    sync();
  }, [commit, sync]);

  const remove = useCallback((id) => {
    commit(deleteLocal(stateRef.current, id));
    sync();
  }, [commit, sync]);

  const restore = useCallback((record) => {
    commit(restoreLocal(stateRef.current, record));
    sync();
  }, [commit, sync]);

  const records = useMemo(() => listRecords(state), [state]);
  const pendingCount = state.pendingIds.length;
  const syncLabel = !loaded
    ? "正在读取本机记录"
    : syncStatus === "syncing"
      ? "正在同步"
      : pendingCount
        ? `已本机保存，待同步（${pendingCount}）${syncStatus === "failed" ? " · 同步失败，可重试" : syncStatus === "offline" ? " · 离线" : ""}`
        : syncStatus === "failed"
          ? "同步失败，可重试"
          : syncStatus === "synced"
            ? "已同步"
            : "本机记录";

  return { records, syncLabel, syncing: syncStatus === "syncing", sync, save, remove, restore };
}
