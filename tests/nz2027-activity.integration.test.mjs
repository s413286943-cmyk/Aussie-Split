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

it("logs every 2027 ledger and checklist change, backfills once, and rolls back cleanly", {
  skip: missingDatabaseEnv.length > 0
    ? `set ${missingDatabaseEnv.join(", ")} to run the PostgreSQL integration test`
    : false,
  timeout: 120_000,
}, async () => {
  const database = `aussie_nz2027_activity_${process.pid}_${Date.now()}`;

  await adminSql(`create database ${quoteIdentifier(database)} template template0`);
  try {
    await runFile(database, "tests/fixtures/supabase-compatibility-base.sql");
    await runFile(database, "supabase/migrations/20260710035744_shared_ledger_compatibility.sql");
    await psql(database, ["-c", `
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    `]);
    await runFile(database, "supabase/migrations/20261025090000_create_nz2027_ledger.sql");

    // State before the log exists: one refunded booking and one ticked item.
    const now = () => scalar(database, "select to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')");
    await psql(database, ["-c", `
      update public.nz2027_expenses set deleted_at = now(), updated_at = now() where id = 'nz27-tour-hobbiton';
      insert into public.nz2027_checklist (item_id, done, updated_at) values ('licence', true, now()), ('visa', false, now());
    `]);
    const ledgerBefore = await scalar(database, "select md5(string_agg(row_to_json(e)::text, ',' order by id)) from public.nz2027_expenses e");

    await runFile(database, "supabase/migrations/20261026090000_create_nz2027_activity.sql");
    await runFile(database, "supabase/migrations/20261026090000_create_nz2027_activity.sql");

    assert.equal(
      await scalar(database, "select md5(string_agg(row_to_json(e)::text, ',' order by id)) from public.nz2027_expenses e"),
      ledgerBefore,
      "ledger rows are untouched",
    );
    assert.equal(await scalar(database, `
      select string_agg(kind || ':' || action, ',' order by kind, action) from (
        select kind, action, count(*) from public.nz2027_activity group by kind, action
      ) t
    `), "check:done,expense:added,expense:removed");
    assert.equal(await scalar(database, "select count(*) from public.nz2027_activity"), "11", "backfilled once, not twice");
    assert.equal(await scalar(database, "select detail ->> 'item' from public.nz2027_activity where ref_id = 'nz27-tour-hobbiton'"), "Hobbiton 普通话团 13:50（2人）");

    assert.equal(await scalar(database, `
      select relrowsecurity
        and has_table_privilege('service_role', 'public.nz2027_activity', 'SELECT')
        and not has_table_privilege('service_role', 'public.nz2027_activity', 'INSERT')
        and not has_table_privilege('service_role', 'public.nz2027_activity', 'UPDATE')
        and not has_table_privilege('service_role', 'public.nz2027_activity', 'DELETE')
        and not has_table_privilege('anon', 'public.nz2027_activity', 'SELECT')
        and not has_table_privilege('authenticated', 'public.nz2027_activity', 'SELECT')
      from pg_class where oid = 'public.nz2027_activity'::regclass
    `), "t");
    await expectFailure(database, "set role service_role; insert into public.nz2027_activity (kind, action, ref_id) values ('check', 'done', 'x')", /permission denied/);

    const base = { id: "nz27-test-skyline", date: "2027-02-12", category: "activity", item: "Skyline", currency: "CNY", amount: 644, status: "paid", note: "", deletedAt: null };
    const upsert = async (record) => lastLine(await scalar(database, `set role service_role; select public.nz2027_upsert_expense(${literal(JSON.stringify(record))}::jsonb) ->> 'status'`));
    const latest = () => scalar(database, "select action || ':' || ref_id from public.nz2027_activity order by id desc limit 1");
    const count = () => scalar(database, "select count(*) from public.nz2027_activity");

    assert.equal(await upsert({ ...base, updatedAt: await now() }), "applied");
    assert.equal(await latest(), "added:nz27-test-skyline");

    const beforeStale = await count();
    assert.equal(await upsert({ ...base, item: "old", updatedAt: "2026-01-01T00:00:00.000Z" }), "stale");
    assert.equal(await count(), beforeStale, "stale writes are not logged");

    assert.equal(await upsert({ ...base, amount: 700, updatedAt: await now() }), "applied");
    assert.equal(await latest(), "changed:nz27-test-skyline");
    assert.equal(await scalar(database, "select (detail -> 'before' ->> 'amount') || '>' || (detail ->> 'amount') from public.nz2027_activity order by id desc limit 1"), "644.00>700.00");

    const beforeSame = await count();
    assert.equal(await upsert({ ...base, amount: 700, updatedAt: await now() }), "applied");
    assert.equal(await count(), beforeSame, "re-sending the same values is not logged");

    assert.equal(await upsert({ ...base, amount: 700, updatedAt: await now(), deletedAt: await now() }), "applied");
    assert.equal(await latest(), "removed:nz27-test-skyline");
    assert.equal(await upsert({ ...base, amount: 700, updatedAt: await now(), deletedAt: null }), "applied");
    assert.equal(await latest(), "restored:nz27-test-skyline");

    const check = async (id, done) => lastLine(await scalar(database, `set role service_role; select public.nz2027_set_check(${literal(JSON.stringify({ id, done, updatedAt: await now() }))}::jsonb) ->> 'status'`));
    assert.equal(await check("nztd", true), "applied");
    assert.equal(await latest(), "done:nztd");
    const beforeRepeat = await count();
    assert.equal(await check("nztd", true), "applied");
    assert.equal(await count(), beforeRepeat, "ticking an already ticked item is not logged");
    assert.equal(await check("nztd", false), "applied");
    assert.equal(await latest(), "undone:nztd");
    const beforeFreshUntick = await count();
    assert.equal(await check("hooker-alerts", false), "applied");
    assert.equal(await count(), beforeFreshUntick, "an item that was never ticked is not logged as unticked");

    await runFile(database, "supabase/rollback/drop_nz2027_activity.sql");
    assert.equal(await scalar(database, `
      select to_regclass('public.nz2027_activity') is null
        and to_regprocedure('public.nz2027_log_expense()') is null
        and to_regprocedure('public.nz2027_log_check()') is null
        and not exists (select 1 from pg_trigger where tgname in ('nz2027_expenses_activity', 'nz2027_checklist_activity'))
    `), "t");
    assert.equal(await upsert({ ...base, amount: 800, updatedAt: await now() }), "applied", "ledger still works without the log");
  } finally {
    await adminSql(`drop database if exists ${quoteIdentifier(database)} with (force)`);
  }
});

function lastLine(output) {
  return output.split("\n").filter(Boolean).at(-1);
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
