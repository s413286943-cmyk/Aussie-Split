"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState } from "react";

const accessKey = "aussie-chill-access-v1";
const defaultTripCode = process.env.NEXT_PUBLIC_TRIP_CODE || "aussie";

export default function UnlockGate({ children }) {
  const [ready, setReady] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setUnlocked(localStorage.getItem(accessKey) === "yes");
    setReady(true);
  }, []);

  function submit(event) {
    event.preventDefault();

    if (code.trim() === defaultTripCode) {
      localStorage.setItem(accessKey, "yes");
      setUnlocked(true);
      return;
    }

    setError("访问码不对");
  }

  if (!ready) return <main className="unlock-wrap" />;
  if (unlocked) return children;

  return (
    <main className="unlock-wrap">
      <section className="unlock-card stack">
        <h1>Aussie Chill</h1>
        <p className="muted">输入旅行访问码后进入共享行程和账本。</p>
        <form className="stack" onSubmit={submit}>
          <label>
            访问码
            <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="aussie" />
          </label>
          {error && <p className="muted">{error}</p>}
          <button className="button primary" type="submit">进入旅行</button>
        </form>
      </section>
    </main>
  );
}
