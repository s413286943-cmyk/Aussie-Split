"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState } from "react";

import { accessKey, defaultTripCode } from "@/lib/access";

export default function UnlockGate({ children, intro = "输入旅行访问码后进入 Aussie Chill。" }) {
  const [ready, setReady] = useState(false);
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    setUnlocked(localStorage.getItem(accessKey) === "yes");
    setReady(true);
  }, []);

  if (!ready) return <main className="unlock-wrap" />;
  if (!unlocked) return <Unlock intro={intro} onUnlock={() => setUnlocked(true)} />;
  return children;
}

function Unlock({ intro, onUnlock }) {
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
        <p className="muted">{intro}</p>
        <form className="stack" onSubmit={submit}>
          <label>
            访问码
            <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="aussie" />
          </label>
          {error && <p className="muted">{error}</p>}
          <button className="button primary" type="submit">进入</button>
        </form>
      </section>
    </main>
  );
}
