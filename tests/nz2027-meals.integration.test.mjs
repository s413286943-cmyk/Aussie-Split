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

it("adds synced meal notes with last-write-wins, locked to the server, and rolls back cleanly", {
  skip: missingDatabaseEnv.length > 0
    ? `set ${missingDatabaseEnv.join(", ")} to run the PostgreSQL integration test`
    : false,
  timeout: 120_000,
}, async () => {
  const database = `aussie_nz2027_meals_${process.pid}_${Date.now()}`;

  await adminSql(`create database ${quoteIdentifier(database)} template template0`);
  try {
    await runFile(database, "tests/fixtures/supabase-compatibility-base.sql");
    await runFile(database, "supabase/migrations/20260710035744_shared_ledger_compatibility.sql");
    await psql(database, ["-c", `
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    `]);
    await runFile(database, "supabase/migrations/20261025090000_create_nz2027_ledger.sql");
    const ledgerBefore = await scalar(database, "select md5(string_agg(row_to_json(e)::text, ',' order by id)) from public.nz2027_expenses e");

    await runFile(database, "supabase/migrations/20261107090000_create_nz2027_meal_notes.sql");
    await runFile(database, "supabase/migrations/20261107090000_create_nz2027_meal_notes.sql");
    assert.equal(await scalar(database, "select md5(string_agg(row_to_json(e)::text, ',' order by id)) from public.nz2027_expenses e"), ledgerBefore);

    assert.equal(await scalar(database, `
      select relrowsecurity
        and has_table_privilege('service_role', 'public.nz2027_meal_notes', 'SELECT')
        and has_function_privilege('service_role', 'public.nz2027_set_meal_note(jsonb)', 'EXECUTE')
        and not has_table_privilege('service_role', 'public.nz2027_meal_notes', 'DELETE')
        and not has_table_privilege('anon', 'public.nz2027_meal_notes', 'SELECT')
        and not has_table_privilege('authenticated', 'public.nz2027_meal_notes', 'SELECT')
        and not has_function_privilege('anon', 'public.nz2027_set_meal_note(jsonb)', 'EXECUTE')
      from pg_class where oid = 'public.nz2027_meal_notes'::regclass
    `), "t");

    const now = () => scalar(database, "select to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')");
    const setNote = async (role, value) => lastLine(await scalar(database, `set role ${role}; select public.nz2027_set_meal_note(${literal(JSON.stringify(value))}::jsonb) ->> 'status'`));
    const kika = { id: "d9-dinner", note: "羊肩很好吃", rating: 5 };

    assert.equal(await setNote("service_role", { ...kika, updatedAt: await now() }), "applied");
    assert.equal(await setNote("service_role", { ...kika, note: "older", updatedAt: "2026-01-01T00:00:00.000Z" }), "stale");
    assert.equal(await scalar(database, "select note || '|' || rating from public.nz2027_meal_notes where id = 'd9-dinner'"), "羊肩很好吃|5");
    assert.equal(await setNote("service_role", { id: "d9-dinner", note: "", rating: null, updatedAt: await now() }), "applied");
    assert.equal(await scalar(database, "select coalesce(rating::text, 'none') from public.nz2027_meal_notes where id = 'd9-dinner'"), "none");

    await expectFailure(database, `set role service_role; select public.nz2027_set_meal_note('{"id":"d18-dinner","note":"","updatedAt":"2026-11-01T00:00:00Z"}'::jsonb)`, /invalid_nz2027_meal_note/);
    await expectFailure(database, `set role service_role; select public.nz2027_set_meal_note('{"id":"d9-dinner","note":"","rating":6,"updatedAt":"2026-11-01T00:00:00Z"}'::jsonb)`, /invalid_nz2027_meal_note/);
    await expectFailure(database, `set role service_role; select public.nz2027_set_meal_note('{"id":"d9-dinner","note":"","rating":2.5,"updatedAt":"2026-11-01T00:00:00Z"}'::jsonb)`, /invalid_nz2027_meal_note/);
    await expectFailure(database, `set role service_role; select public.nz2027_set_meal_note('{"id":"d9-dinner","note":"","updatedAt":"2099-01-01T00:00:00Z"}'::jsonb)`, /nz2027_meal_note_in_future/);
    await expectFailure(database, `set role anon; select public.nz2027_set_meal_note('{"id":"d9-dinner","note":"","updatedAt":"2026-11-01T00:00:00Z"}'::jsonb)`, /permission denied/);

    await runFile(database, "supabase/rollback/drop_nz2027_meal_notes.sql");
    assert.equal(await scalar(database, "select to_regclass('public.nz2027_meal_notes') is null and to_regprocedure('public.nz2027_set_meal_note(jsonb)') is null"), "t");
    assert.equal(await scalar(database, "select md5(string_agg(row_to_json(e)::text, ',' order by id)) from public.nz2027_expenses e"), ledgerBefore);
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
