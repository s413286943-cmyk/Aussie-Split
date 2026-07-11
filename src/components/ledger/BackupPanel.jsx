"use client";

import { useState } from "react";

import { previewBackupMerge } from "@/lib/backup";
import { formatMoney } from "@/lib/ledger";

export default function BackupPanel({ expenses, onExport, onMerge }) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function exportBackup() {
    setBusy(true);
    setError("");
    try {
      const backup = await onExport();
      downloadJson(backup, backupFileName(backup.exportedAt));
    } catch {
      setError("备份导出失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function chooseBackup(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    try {
      setPreview(previewBackupMerge(await file.text(), expenses));
    } catch (backupError) {
      setPreview(null);
      setError(backupError instanceof Error ? backupError.message : "无法读取备份文件");
    }
  }

  async function mergeBackup() {
    if (!preview?.accepted.length) return;
    setBusy(true);
    setError("");
    try {
      await onMerge(preview.accepted);
      setPreview(null);
    } catch {
      setError("备份合并失败，当前账本没有被清空，请重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section backup-panel" data-motion="section" data-feedback-target="backup-panel" aria-labelledby="backup-title">
      <div className="section-head">
        <div>
          <span className="section-kicker">Recovery kit</span>
          <h2 id="backup-title">账本备份</h2>
        </div>
        <span className="muted">只合并，不清空</span>
      </div>
      <div className="backup-actions">
        <button className="button" type="button" onClick={exportBackup} disabled={busy}>导出备份</button>
        <label className="button backup-file-button">
          选择备份
          <input type="file" accept="application/json,.json" onChange={chooseBackup} disabled={busy} />
        </label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {preview && (
        <div className="backup-preview" role="status">
          <div>
            <span>可合并</span>
            <strong>{preview.accepted.length} 条</strong>
          </div>
          <div>
            <span>已跳过</span>
            <strong>{preview.skipped.length} 条</strong>
          </div>
          <div>
            <span>合并金额</span>
            <strong>{formatTotals(preview.acceptedTotalsByCurrency)}</strong>
          </div>
          <button className="button primary" type="button" onClick={mergeBackup} disabled={busy || !preview.accepted.length}>
            {busy ? "合并中" : "合并备份"}
          </button>
        </div>
      )}
    </section>
  );
}

function formatTotals(totals) {
  const entries = Object.entries(totals);
  return entries.length ? entries.map(([currency, amount]) => formatMoney(currency, amount)).join(" / ") : "无新记录";
}

function backupFileName(exportedAt) {
  return `aussie-chill-ledger-${String(exportedAt).slice(0, 10)}.json`;
}

function downloadJson(value, fileName) {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
