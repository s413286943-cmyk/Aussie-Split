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

it("adds the separate 2027 ledger without touching the 2026 tables, and rolls back cleanly", {
  skip: missingDatabaseEnv.length > 0
    ? `set ${missingDatabaseEnv.join(", ")} to run the PostgreSQL integration test`
    : false,
  timeout: 120_000,
}, async () => {
  const database = `aussie_nz2027_${process.pid}_${Date.now()}`;

  await adminSql(`create database ${quoteIdentifier(database)} template template0`);
  try {
    await runFile(database, "tests/fixtures/supabase-compatibility-base.sql");
    await runFile(database, "supabase/migrations/20260710035744_shared_ledger_compatibility.sql");
    const legacyBefore = await legacyState(database);
    // Mirror Supabase: new objects in public are granted to every API role by default.
    await psql(database, ["-c", `
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    `]);

    await runFile(database, "supabase/migrations/20261025090000_create_nz2027_ledger.sql");
    await runFile(database, "supabase/migrations/20261025090000_create_nz2027_ledger.sql");

    assert.deepEqual(await legacyState(database), legacyBefore, "2026 ledger tables, rows and functions are unchanged");
    assert.equal(await scalar(database, "select count(*) from public.nz2027_expenses"), "10");
    assert.equal(
      await scalar(database, `
        select string_agg(currency || ':' || status || ':' || total::text, ',' order by currency, status)
        from (select currency, status, sum(amount) as total from public.nz2027_expenses group by currency, status) totals
      `),
      "CNY:pending:1962.74,NZD:paid:1546.31,NZD:pending:1454.87",
    );

    assert.equal(await scalar(database, "select relrowsecurity from pg_class where oid = 'public.nz2027_expenses'::regclass"), "t");
    assert.equal(await scalar(database, `
      select has_table_privilege('anon', 'public.nz2027_expenses', 'SELECT')
        or has_table_privilege('authenticated', 'public.nz2027_expenses', 'SELECT')
        or has_function_privilege('anon', 'public.nz2027_upsert_expense(jsonb)', 'EXECUTE')
        or has_table_privilege('service_role', 'public.nz2027_expenses', 'DELETE')
    `), "f");
    assert.equal(await scalar(database, `
      select has_table_privilege('service_role', 'public.nz2027_expenses', 'SELECT')
        and has_function_privilege('service_role', 'public.nz2027_upsert_expense(jsonb)', 'EXECUTE')
    `), "t");

    const now = await scalar(database, "select to_char(now() at time zone 'utc', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')");
    const record = {
      id: "nz27-test-kika", date: "2027-02-09", category: "dining", item: "Kika", currency: "NZD",
      amount: 186.5, status: "paid", note: "", updatedAt: now, deletedAt: null,
    };
    assert.equal(await rpc(database, "service_role", record), "applied");
    assert.equal(await rpc(database, "service_role", { ...record, item: "older", updatedAt: "2026-01-01T00:00:00.000Z" }), "stale");
    assert.equal(await scalar(database, "select item from public.nz2027_expenses where id = 'nz27-test-kika'"), "Kika");
    await expectFailure(database, rpcSql("service_role", { ...record, currency: "USD" }), /invalid_nz2027_expense/);
    await expectFailure(database, rpcSql("service_role", { ...record, updatedAt: "2099-01-01T00:00:00.000Z" }), /nz2027_expense_in_future/);
    await expectFailure(database, rpcSql("anon", record), /permission denied/);
    await expectFailure(database, "set role service_role; delete from public.nz2027_expenses", /permission denied/);

    await runFile(database, "supabase/rollback/drop_nz2027_ledger.sql");
    assert.equal(await scalar(database, "select to_regclass('public.nz2027_expenses') is null"), "t");
    assert.equal(await scalar(database, "select to_regprocedure('public.nz2027_upsert_expense(jsonb)') is null"), "t");
    assert.deepEqual(await legacyState(database), legacyBefore);
  } finally {
    await adminSql(`drop database if exists ${quoteIdentifier(database)} with (force)`);
  }
});

async function legacyState(database) {
  return scalar(database, `
    select concat_ws('|',
      (select coalesce(string_agg(id || ':' || currency || ':' || amount::text || ':' || mutation_version, ',' order by id), '') from public.expenses),
      (select count(*) from public.expense_activity),
      (select count(*) from public.trips),
      (select count(*) from public.members),
      (select md5(pg_get_functiondef('public.apply_expense_operation(jsonb)'::regprocedure))),
      (select string_agg(conname || '=' || pg_get_constraintdef(oid), ',' order by conname) from pg_constraint where conrelid = 'public.expenses'::regclass)
    )
  `);
}

function rpcSql(role, record) {
  return `set role ${role}; select public.nz2027_upsert_expense(${literal(JSON.stringify(record))}::jsonb) ->> 'status'`;
}

async function rpc(database, role, record) {
  const lines = (await scalar(database, rpcSql(role, record))).split("\n").filter(Boolean);
  return lines.at(-1);
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

async function expectFailure(database, statement, expectedMessage) {
  await assert.rejects(psql(database, ["-c", statement]), (error) => {
    assert.match(`${error.stderr || ""}\n${error.stdout || ""}`, expectedMessage);
    return true;
  });
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
