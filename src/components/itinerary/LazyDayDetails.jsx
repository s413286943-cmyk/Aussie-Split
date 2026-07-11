"use client";

import { useState } from "react";

export default function LazyDayDetails({ defaultOpen = false, onOpen, children }) {
  const [mounted, setMounted] = useState(defaultOpen);
  const [open, setOpen] = useState(defaultOpen);

  function handleToggle(event) {
    const nextOpen = event.currentTarget.open;
    setOpen(nextOpen);
    if (!nextOpen) return;
    if (!mounted) setMounted(true);
    onOpen?.(event.currentTarget);
  }

  return (
    <details open={open} onToggle={handleToggle}>
      <summary>{defaultOpen ? "当天完整安排" : "查看当天安排"}</summary>
      {mounted ? children : null}
    </details>
  );
}
