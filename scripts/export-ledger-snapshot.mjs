import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const defaultOutputPath = path.join("content", "ledger-snapshot.json");

export function buildLedgerSnapshot(payload, options = {}) {
  if (!payload || !Array.isArray(payload.expenses) || !Array.isArray(payload.activity)) {
    throw new TypeError("Invalid protected ledger payload");
  }
  const exportedAt = validIsoTimestamp(payload.serverTime, "ledger server time");
  const expenses = payload.expenses.map(normalizeExpense).sort((left, right) => left.id.localeCompare(right.id));
  const totals = new Map();

  for (const expense of expenses) {
    if (expense.deletedAt || expense.status !== "confirmed") continue;
    const current = totals.get(expense.currency) || {
      confirmed: 0,
      pendingSettlement: 0,
      splitSettled: 0,
    };
    current.confirmed = roundMoney(current.confirmed + expense.amount);
    if (expense.splitSettled) {
      current.splitSettled = roundMoney(current.splitSettled + expense.amount);
    } else {
      current.pendingSettlement = roundMoney(current.pendingSettlement + expense.amount);
    }
    totals.set(expense.currency, current);
  }

  return {
    schemaVersion: 1,
    exportedAt,
    source: options.source || "protected-api",
    activityCount: payload.activity.length,
    totalsByCurrency: Object.fromEntries([...totals.entries()].sort(([left], [right]) => left.localeCompare(right))),
    expenses,
  };
}

export async function fetchProtectedLedger(options) {
  const baseUrl = String(options?.baseUrl || "").replace(/\/$/, "");
  const tripCode = String(options?.tripCode || "");
  const fetchImpl = options?.fetch || globalThis.fetch;
  if (!baseUrl || !tripCode || typeof fetchImpl !== "function") {
    throw new TypeError("Protected ledger URL and trip code are required");
  }
  const origin = new URL(baseUrl).origin;
  const accessResponse = await fetchImpl(`${baseUrl}/api/access`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: origin,
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify({ code: tripCode }),
  });
  const access = await readJsonResponse(accessResponse);
  if (!accessResponse.ok || access?.authenticated !== true) {
    throw new Error("Protected ledger access failed");
  }
  const setCookie = accessResponse.headers.getSetCookie?.()[0]
    || accessResponse.headers.get("set-cookie")
    || "";
  const cookie = setCookie.split(";", 1)[0];
  if (!cookie.includes("=")) throw new Error("Protected ledger session cookie is missing");

  const syncResponse = await fetchImpl(`${baseUrl}/api/sync`, {
    headers: { Accept: "application/json", Cookie: cookie },
  });
  const payload = await readJsonResponse(syncResponse);
  if (!syncResponse.ok) throw new Error("Protected ledger export failed");
  return payload;
}

export async function writeLedgerSnapshot(outputPath, snapshot) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
}

function normalizeExpense(expense) {
  if (!expense || typeof expense !== "object" || typeof expense.id !== "string" || !expense.id) {
    throw new TypeError("Invalid snapshot expense");
  }
  const amount = Number(expense.amount);
  if (!Number.isFinite(amount) || amount < 0) throw new TypeError(`Invalid amount for ${expense.id}`);
  return {
    id: expense.id,
    category: String(expense.category || ""),
    item: String(expense.item || ""),
    date: String(expense.date || ""),
    currency: String(expense.currency || ""),
    amount: roundMoney(amount),
    payer: String(expense.payer || ""),
    status: String(expense.status || ""),
    note: String(expense.note || ""),
    splitSettled: Boolean(expense.splitSettled),
    mutationVersion: String(expense.mutationVersion || ""),
    updatedAt: expense.updatedAt ? validIsoTimestamp(expense.updatedAt, `${expense.id} updatedAt`) : "",
    deletedAt: expense.deletedAt ? validIsoTimestamp(expense.deletedAt, `${expense.id} deletedAt`) : null,
  };
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    throw new Error("Protected ledger returned invalid JSON");
  }
}

function validIsoTimestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`Invalid ${label}`);
  }
  return new Date(value).toISOString();
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

async function main() {
  const baseUrl = process.env.AUSSIE_LEDGER_URL || "https://aussie-split.vercel.app";
  const tripCode = process.env.AUSSIE_TRIP_CODE || "";
  const outputPath = process.argv[2] || defaultOutputPath;
  const payload = await fetchProtectedLedger({ baseUrl, tripCode });
  const snapshot = buildLedgerSnapshot(payload);
  await writeLedgerSnapshot(outputPath, snapshot);
  console.log(`Exported ${snapshot.expenses.length} expenses to ${outputPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
