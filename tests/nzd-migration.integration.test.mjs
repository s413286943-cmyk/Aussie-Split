import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { it } from "node:test";

const execFileAsync = promisify(execFile);
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const psqlBinary = process.env.AUSSIE_TEST_PSQL
  || "/opt/homebrew/Cellar/postgresql@17/17.10/bin/psql";
const requiredDatabaseEnv = [
  "AUSSIE_TEST_PGHOST",
  "AUSSIE_TEST_PGPORT",
  "AUSSIE_TEST_PGUSER",
  "AUSSIE_TEST_PGDATABASE",
];
const missingDatabaseEnv = requiredDatabaseEnv.filter((name) => !process.env[name]);

it("adds NZD, seeds the 2027 bookings idempotently, and rolls both back", {
  skip: missingDatabaseEnv.length > 0
    ? `set ${missingDatabaseEnv.join(", ")} to run the PostgreSQL integration test`
    : false,
  timeout: 120_000,
}, async () => {
  const database = `aussie_nzd_${process.pid}_${Date.now()}`;

  await adminSql(`create database ${quoteIdentifier(database)} template template0`);
  try {
    await runFile(database, "tests/fixtures/supabase-compatibility-base.sql");
    await runFile(database, "supabase/migrations/20260710035744_shared_ledger_compatibility.sql");
    const legacyBefore = await legacySnapshot(database);

    await expectSqlFailure(database, nzdOperationSql("before"), /invalid_(activity|expense)_payload/);

    await runFile(database, "supabase/migrations/20261025090000_allow_nzd_currency.sql");
    await runFile(database, "supabase/migrations/20261025090000_allow_nzd_currency.sql");
    assert.equal(
      await scalar(database, "select public.apply_expense_operation(" + literal(nzdOperation("after")) + "::jsonb) ->> 'status'"),
      "applied",
    );
    await expectSqlFailure(database, nzdOperationSql("usd", "USD"), /invalid_(activity|expense)_payload/);
    assert.equal(
      await scalar(database, "select has_function_privilege('service_role', 'public.apply_expense_operation(jsonb)', 'EXECUTE')"),
      "t",
    );
    assert.equal(
      await scalar(database, "select has_function_privilege('anon', 'public.apply_expense_operation(jsonb)', 'EXECUTE')"),
      "f",
    );

    await runFile(database, "supabase/migrations/20261025091000_seed_nz2027_bookings.sql");
    await runFile(database, "supabase/migrations/20261025091000_seed_nz2027_bookings.sql");
    assert.equal(await scalar(database, "select count(*) from public.expenses where id like 'nz27-%'"), "10");
    assert.equal(await scalar(database, "select count(*) from public.expense_activity where expense_id like 'nz27-%'"), "10");
    assert.equal(
      await scalar(database, `
        select string_agg(currency || ':' || status || ':' || total::text, ',' order by currency, status)
        from (
          select currency, status, sum(amount) as total
          from public.expenses
          where id like 'nz27-%'
          group by currency, status
        ) totals
      `),
      "CNY:draft:1962.74,NZD:confirmed:1546.31,NZD:draft:1454.87",
    );
    assert.equal(
      await scalar(database, "select summary from public.expense_activity where expense_id = 'nz27-hotel-twizel'"),
      "新增了 NZ$525.00 Twizel Holiday Park 2/5–8（3晚）",
    );
    assert.deepEqual(await legacySnapshot(database), legacyBefore, "legacy 2026 rows are untouched");

    await assert.rejects(runFile(database, "supabase/rollback/remove_nzd_currency.sql"), (error) => {
      assert.match(`${error.stderr || ""}`, /NZD rows exist/);
      return true;
    });

    await runFile(database, "supabase/rollback/remove_nz2027_booking_seed.sql");
    assert.equal(await scalar(database, "select count(*) from public.expenses where id like 'nz27-%' and deleted_at is null"), "0");
    assert.equal(await scalar(database, "select count(*) from public.expenses where id like 'nz27-%'"), "10");
    assert.deepEqual(await legacySnapshot(database), legacyBefore);
  } finally {
    await adminSql(`drop database if exists ${quoteIdentifier(database)} with (force)`);
  }
});

function nzdOperation(suffix, currency = "NZD") {
  const physical = String(Date.now()).padStart(13, "0");
  const expenseId = `nzd-check-${suffix}`;
  return JSON.stringify({
    opId: `op-nzd-${suffix}`,
    type: "upsert",
    expenseId,
    mutationVersion: `${physical}-000001-test`,
    expense: {
      id: expenseId,
      category: "dining",
      item: "Kika dinner",
      date: "2027-02-09",
      currency,
      amount: 186.5,
      payer: "us",
      status: "confirmed",
      note: "",
      splitSettled: false,
    },
    activity: {
      id: `activity-nzd-${suffix}`,
      expenseId,
      action: "add",
      item: "Kika dinner",
      amount: 186.5,
      currency,
      summary: "新增了 NZ$186.50 Kika dinner",
      createdAt: new Date().toISOString(),
    },
  });
}

function nzdOperationSql(suffix, currency) {
  return `select public.apply_expense_operation(${literal(nzdOperation(suffix, currency))}::jsonb)`;
}

async function legacySnapshot(database) {
  return scalar(database, `
    select coalesce(string_agg(id || ':' || currency || ':' || amount::text || ':' || mutation_version, ',' order by id), '')
    from public.expenses
    where id not like 'nz27-%' and id not like 'nzd-check-%'
  `);
}

async function runFile(database, relativePath) {
  await psql(database, ["-f", join(projectRoot, relativePath)]);
}

async function adminSql(statement) {
  await psql(process.env.AUSSIE_TEST_PGDATABASE, ["-c", statement]);
}

async function scalar(database, statement) {
  const { stdout } = await psql(database, ["-A", "-t", "-c", statement]);
  return stdout.trim();
}

async function expectSqlFailure(database, statement, expectedMessage) {
  await assert.rejects(
    psql(database, ["-c", statement]),
    (error) => {
      assert.match(`${error.stderr || ""}\n${error.stdout || ""}`, expectedMessage);
      return true;
    },
  );
}

async function psql(database, args) {
  return execFileAsync(psqlBinary, ["-X", "--set=ON_ERROR_STOP=1", "-q", "-d", database, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PGHOST: process.env.AUSSIE_TEST_PGHOST,
      PGPORT: process.env.AUSSIE_TEST_PGPORT,
      PGUSER: process.env.AUSSIE_TEST_PGUSER,
      PGOPTIONS: "-c statement_timeout=20000 -c lock_timeout=5000",
    },
    maxBuffer: 10 * 1024 * 1024,
  });
}

function literal(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}
