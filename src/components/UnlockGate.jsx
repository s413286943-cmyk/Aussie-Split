"use client";

import { useEffect, useRef, useState } from "react";

import {
  ACCESS_REQUIRED_EVENT,
  checkAccessSession,
  fetchItinerary,
  shouldReopenCachedAccess,
  unlockAccessSession,
} from "@/lib/apiClient";
import { offlineAccessKey } from "@/lib/access";
import { readCachedItinerary, writeCachedItinerary } from "@/lib/itineraryCache";

let itineraryPrimePromise = null;

export default function UnlockGate({ children, intro = "输入旅行访问码后进入 Aussie Chill。" }) {
  const [ready, setReady] = useState(false);
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function checkSession() {
      if (!navigator.onLine) {
        if (!cancelled) {
          setUnlocked(localStorage.getItem(offlineAccessKey) === "yes");
          setReady(true);
        }
        return;
      }

      try {
        const session = await checkAccessSession();
        if (!cancelled) {
          const authenticated = session.authenticated === true;
          if (authenticated) {
            localStorage.setItem(offlineAccessKey, "yes");
            await primeProtectedItinerary();
          }
          if (!cancelled) setUnlocked(authenticated);
        }
      } catch (error) {
        if (!cancelled) {
          const hasOfflineAccess = localStorage.getItem(offlineAccessKey) === "yes";
          setUnlocked(shouldReopenCachedAccess(error, hasOfflineAccess));
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    function requireAccess() {
      setUnlocked(false);
      setReady(true);
    }

    checkSession();
    window.addEventListener("online", checkSession);
    window.addEventListener(ACCESS_REQUIRED_EVENT, requireAccess);
    return () => {
      cancelled = true;
      window.removeEventListener("online", checkSession);
      window.removeEventListener(ACCESS_REQUIRED_EVENT, requireAccess);
    };
  }, []);

  if (!ready) return <main className="unlock-wrap" />;
  if (!unlocked) return <Unlock intro={intro} onUnlock={() => setUnlocked(true)} />;
  return children;
}

function Unlock({ intro, onUnlock }) {
  const inputRef = useRef(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const errorId = "access-code-error";

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function submit(event) {
    event.preventDefault();
    if (!code.trim() || submitting) return;

    setSubmitting(true);
    setError("");
    try {
      const session = await unlockAccessSession(code.trim());
      if (session.authenticated !== true) throw new Error("access-denied");
      localStorage.setItem(offlineAccessKey, "yes");
      await primeProtectedItinerary();
      onUnlock();
    } catch {
      setError("访问码不对或暂时无法验证");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="unlock-wrap">
      <section className="unlock-card stack">
        <h1>Aussie Chill</h1>
        <p className="muted">{intro}</p>
        <form className="stack" onSubmit={submit}>
          <label>
            访问码
            <input
              ref={inputRef}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="输入访问码"
              autoComplete="current-password"
              aria-describedby={error ? errorId : undefined}
              aria-invalid={Boolean(error)}
            />
          </label>
          {error && <p id={errorId} className="muted" role="alert" aria-live="assertive">{error}</p>}
          <button className="button primary" type="submit" disabled={submitting}>
            {submitting ? "验证中" : "进入"}
          </button>
        </form>
      </section>
    </main>
  );
}

async function primeProtectedItinerary() {
  if (!navigator.onLine || readCachedItinerary(localStorage)) return;
  if (!itineraryPrimePromise) {
    itineraryPrimePromise = fetchItinerary()
      .then((response) => {
        if (response?.itinerary) writeCachedItinerary(localStorage, response.itinerary);
      })
      .catch(() => undefined)
      .finally(() => {
        itineraryPrimePromise = null;
      });
  }
  await itineraryPrimePromise;
}
