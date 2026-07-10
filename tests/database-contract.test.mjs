import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const testsDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(testsDirectory, "..");
const migration = readSql("supabase/migrations/20260710035744_shared_ledger_compatibility.sql");
const receiptMigration = readSql("supabase/migrations/20260710140534_private_receipts.sql");
const rollback = readSql("supabase/rollback/remove_shared_ledger_compatibility.sql");
const schema = readSql("supabase/schema.sql");

const mutationVersionPattern = "^[0-9]{13}-[0-9]{6}-[a-z0-9]+(?:-[a-z0-9]+)*$";

describe("shared-ledger compatibility migration contract", () => {
  it("adds and deterministically backfills versioned expense columns", () => {
    expectAll(migration, [
      /alter table public\.expenses\s+add column if not exists updated_at timestamptz/i,
      /add column if not exists deleted_at timestamptz/i,
      /add column if not exists mutation_version text/i,
      /update public\.expenses[\s\S]*mutation_version[\s\S]*created_at[\s\S]*000000-server/i,
      /alter column mutation_version set not null/i,
      new RegExp(escapeRegExp(mutationVersionPattern), "i"),
    ]);
  });

  it("uses the client mutation-version grammar in the constraint, trigger, and RPC", () => {
    const exactPattern = new RegExp(escapeRegExp(mutationVersionPattern));

    assert.match(migration, new RegExp(escapeRegExp(`check (mutation_version ~ '${mutationVersionPattern}')`), "i"));
    assert.match(functionBody(migration, "app_private.enforce_expense_mutation"), exactPattern);
    assert.match(functionBody(migration, "public.apply_expense_operation"), exactPattern);
    assert.equal(countOccurrences(migration, mutationVersionPattern), 3);
    assert.equal(countOccurrences(schema, mutationVersionPattern), 3);
  });

  it("keeps attachments canonical and adds required indexes", () => {
    expectAll(migration, [
      /alter table public\.attachments[\s\S]*add column if not exists receipt_id text/i,
      /add column if not exists original_name text not null default ''/i,
      /add column if not exists mime_type text not null default ''/i,
      /add column if not exists size_bytes bigint not null default 0/i,
      /add column if not exists finalized_at timestamptz/i,
      /add column if not exists deleted_at timestamptz/i,
      /size_bytes between 0 and 10485760/i,
      /create unique index if not exists attachments_receipt_id_unique[\s\S]*where receipt_id is not null/i,
      /create unique index if not exists attachments_storage_path_unique[\s\S]*where storage_path is not null/i,
      /create index if not exists attachments_expense_id_idx on public\.attachments \(expense_id\)/i,
      /create index if not exists members_trip_id_idx on public\.members \(trip_id\)/i,
    ]);
  });

  it("isolates private operation and throttling state", () => {
    expectAll(migration, [
      /create schema if not exists app_private/i,
      /revoke all on schema app_private from public, anon, authenticated/i,
      /grant usage on schema app_private to service_role/i,
      /create table app_private\.expense_operations/i,
      /operation jsonb not null/i,
      /result_status text[\s\S]*result_status in \('applied', 'stale'\)/i,
      /create table app_private\.access_attempts/i,
      /alter table app_private\.expense_operations enable row level security/i,
      /alter table app_private\.access_attempts enable row level security/i,
      /revoke all on (?:table )?app_private\.expense_operations from public, anon, authenticated/i,
      /revoke all on (?:table )?app_private\.access_attempts from public, anon, authenticated/i,
      /grant select, insert, update on table app_private\.expense_operations to service_role/i,
      /grant select, insert, update, delete on table app_private\.access_attempts to service_role/i,
    ]);
  });

  it("enforces monotonic expense mutations without changing legacy attachment metadata", () => {
    expectAll(migration, [
      /create or replace function app_private\.enforce_expense_mutation\(\)/i,
      /security invoker/i,
      /set search_path = pg_catalog, pg_temp/i,
      /\(new\.mutation_version collate "C"\) <= \(old\.mutation_version collate "C"\)/i,
      /interval '5 minutes'/i,
      /new\.updated_at := pg_catalog\.now\(\)/i,
      /new\.attachment_name := old\.attachment_name/i,
      /create or replace function app_private\.reject_physical_expense_delete\(\)/i,
      /physical_delete_disabled/i,
      /create trigger enforce_expense_mutation/i,
      /create trigger reject_physical_expense_delete/i,
      /alter function app_private\.enforce_expense_mutation\(\) owner to postgres/i,
      /revoke execute on function app_private\.enforce_expense_mutation\(\) from public, anon, authenticated/i,
    ]);
    const body = functionBody(migration, "app_private.enforce_expense_mutation");
    assert.match(body, /if tg_op = 'INSERT' then[\s\S]*pg_catalog\.pg_advisory_xact_lock\(pg_catalog\.hashtextextended\(new\.id, 0\)\)/i);
    assert.equal(countOccurrences(body, "pg_catalog.pg_advisory_xact_lock"), 1);
  });

  it("exposes only the service-role atomic operation RPC", () => {
    expectAll(migration, [
      /create or replace function public\.apply_expense_operation\(operation jsonb\)\s+returns jsonb/i,
      /security invoker/i,
      /insert into app_private\.expense_operations/i,
      /on conflict \(op_id\) do nothing/i,
      /operation_id_conflict/i,
      /result_status/i,
      /for update/i,
      /\(incoming_version collate "C"\) <= \(existing_version collate "C"\)/i,
      /status', 'stale'/i,
      /deleted_at = pg_catalog\.now\(\)/i,
      /insert into public\.expense_activity/i,
      /activity_id_conflict/i,
      /status', 'applied'/i,
      /revoke execute on function public\.apply_expense_operation\(jsonb\) from public, anon, authenticated/i,
      /grant execute on function public\.apply_expense_operation\(jsonb\) to service_role/i,
    ]);
    const body = functionBody(migration, "public.apply_expense_operation");
    assert.doesNotMatch(body, /attachment_name\s*=/i);
    assert.doesNotMatch(body, /on conflict \(id\) do nothing/i);
    assert.doesNotMatch(body, /status', 'duplicate'/i);
    expectAll(body, [
      /requested_expense_id := operation ->> 'expenseId'/i,
      /expense_payload ->> 'id' is distinct from requested_expense_id/i,
      /activity_payload ->> 'expenseId' is distinct from requested_expense_id/i,
      /op_type = 'delete'[\s\S]*operation \? 'expense'/i,
      /op_type = 'delete'[\s\S]*pg_catalog\.jsonb_typeof\(expense_payload\)[\s\S]*'null'/i,
      /op_type = 'delete'[\s\S]*activity_payload ->> 'action'[\s\S]*'delete'/i,
      /op_type = 'upsert'[\s\S]*activity_payload ->> 'action'[\s\S]*'add', 'edit', 'confirm'/i,
    ]);
  });

  it("implements durable service-only access throttling", () => {
    expectAll(migration, [
      /create or replace function public\.consume_access_attempt\(address_hash text\)\s+returns jsonb/i,
      /create or replace function public\.reset_access_attempt\(address_hash text\)\s+returns jsonb/i,
      /\^\[0-9a-f\]\{64\}\$/i,
      /interval '15 minutes'/i,
      /on conflict (?:\(address_hash\)|on constraint access_attempts_pkey) do update/i,
      /attempt_count[^;]*\+ 1/i,
      /attempts\.attempt_count \+ 1 >= 6/i,
      /delete from app_private\.access_attempts/i,
      /'allowed'/i,
      /'remaining'/i,
      /'blockedUntil'/i,
      /revoke execute on function public\.consume_access_attempt\(text\) from public, anon, authenticated/i,
      /grant execute on function public\.consume_access_attempt\(text\) to service_role/i,
      /revoke execute on function public\.reset_access_attempt\(text\) from public, anon, authenticated/i,
      /grant execute on function public\.reset_access_attempt\(text\) to service_role/i,
    ]);
  });

  it("does not tighten or destroy existing public application tables", () => {
    const publicTables = "trips|members|expenses|attachments|expense_activity";
    assert.doesNotMatch(migration, new RegExp(`alter table public\\.(${publicTables})\\s+enable row level security`, "i"));
    assert.doesNotMatch(migration, new RegExp(`revoke[^;]*on (?:table )?public\\.(${publicTables})`, "i"));
    assert.doesNotMatch(migration, new RegExp(`(?:drop table|truncate|delete from)\\s+public\\.(${publicTables})`, "i"));
  });

  it("rolls back compatibility objects while retaining public data and columns", () => {
    expectAll(rollback, [
      /drop trigger if exists enforce_expense_mutation on public\.expenses/i,
      /drop trigger if exists reject_physical_expense_delete on public\.expenses/i,
      /drop function if exists public\.apply_expense_operation\(jsonb\)/i,
      /drop function if exists public\.consume_access_attempt\(text\)/i,
      /drop function if exists public\.reset_access_attempt\(text\)/i,
      /drop schema if exists app_private cascade/i,
    ]);
    assert.doesNotMatch(rollback, /(?:drop table|truncate|delete from)\s+public\./i);
    assert.doesNotMatch(rollback, /drop column/i);
  });

  it("keeps the schema snapshot compatible with the migration contract", () => {
    expectAll(schema, [
      /mutation_version text/i,
      new RegExp(escapeRegExp(mutationVersionPattern), "i"),
      /receipt_id text/i,
      /create schema if not exists app_private/i,
      /create or replace function public\.apply_expense_operation/i,
      /create or replace function public\.consume_access_attempt/i,
      /create or replace function public\.create_receipt_upload_intent/i,
      /create or replace function public\.finalize_receipt_upload/i,
      /create or replace function public\.claim_receipt_cleanup/i,
      /insert into storage\.buckets/i,
    ]);
  });
});

describe("private receipt migration contract", () => {
  it("enforces canonical active receipt metadata and supporting indexes", () => {
    expectAll(receiptMigration, [
      /add column if not exists cleanup_claimed_at timestamptz/i,
      /add column if not exists cleanup_claim_token text/i,
      /mime_type in \('image\/jpeg', 'image\/png', 'image\/heic', 'image\/heif', 'image\/webp'\)/i,
      /size_bytes between 1 and 10485760/i,
      /create unique index(?: if not exists)? attachments_active_expense_unique[\s\S]*expense_id[\s\S]*receipt_id is not null[\s\S]*deleted_at is null/i,
      /create index(?: if not exists)? attachments_pending_cleanup_idx[\s\S]*finalized_at is null/i,
    ]);
  });

  it("keeps the receipts bucket private with a ten MiB image allowlist", () => {
    expectAll(receiptMigration, [
      /insert into storage\.buckets/i,
      /values \(\s*'receipts',\s*'receipts',\s*false,\s*10485760/i,
      /array\['image\/jpeg', 'image\/png', 'image\/heic', 'image\/heif', 'image\/webp'\]/i,
      /on conflict \(id\) do update/i,
      /public = false/i,
    ]);
  });

  it("claims bounded cleanup work without blocking concurrent workers", () => {
    expectAll(receiptMigration, [
      /create or replace function public\.claim_receipt_cleanup/i,
      /security invoker/i,
      /for update of a skip locked/i,
      /interval '24 hours'/i,
      /interval '7 days'/i,
      /interval '30 minutes'/i,
      /cleanup_claim_token = claim_receipt_cleanup\.claim_token/i,
      /revoke execute on function public\.claim_receipt_cleanup\(text, integer\) from public, anon, authenticated/i,
      /grant execute on function public\.claim_receipt_cleanup\(text, integer\) to service_role/i,
      /create or replace function public\.verify_receipt_cleanup_claim/i,
      /cleanup_claim_token is distinct from requested_claim_token/i,
      /create or replace function public\.finish_receipt_cleanup_claim/i,
      /mark_deleted boolean/i,
      /receipt_cleanup_in_progress/i,
      /create trigger block_expense_restore_during_receipt_cleanup/i,
      /grant execute on function public\.verify_receipt_cleanup_claim\(uuid, text\) to service_role/i,
      /grant execute on function public\.finish_receipt_cleanup_claim\(uuid, text, boolean\) to service_role/i,
    ]);
  });

  it("creates and finalizes receipt intents atomically for active expenses", () => {
    expectAll(receiptMigration, [
      /create or replace function public\.create_receipt_upload_intent\(receipt jsonb\)/i,
      /for update/i,
      /receipt_expense_unavailable/i,
      /receipt_conflict/i,
      /insert into public\.attachments/i,
      /create or replace function public\.finalize_receipt_upload\(\s*requested_expense_id text,\s*requested_receipt_id text\s*\)/i,
      /finalized_at = coalesce\(finalized_at, pg_catalog\.now\(\)\)/i,
      /revoke execute on function public\.create_receipt_upload_intent\(jsonb\) from public, anon, authenticated/i,
      /grant execute on function public\.create_receipt_upload_intent\(jsonb\) to service_role/i,
      /revoke execute on function public\.finalize_receipt_upload\(text, text\) from public, anon, authenticated/i,
      /grant execute on function public\.finalize_receipt_upload\(text, text\) to service_role/i,
    ]);
  });

  it("does not enable RLS or revoke the compatibility bridge", () => {
    assert.doesNotMatch(receiptMigration, /alter table public\.[a-z_]+\s+enable row level security/i);
    assert.doesNotMatch(receiptMigration, /revoke[^;]*on (?:table )?public\.(?:expenses|attachments|expense_activity)/i);
    assert.doesNotMatch(receiptMigration, /(?:drop table|truncate|delete from)\s+public\./i);
  });
});

function readSql(relativePath) {
  return readFileSync(join(projectRoot, relativePath), "utf8");
}

function expectAll(source, patterns) {
  for (const pattern of patterns) assert.match(source, pattern);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function functionBody(source, qualifiedName) {
  const match = source.match(new RegExp(`create or replace function ${escapeRegExp(qualifiedName)}[^$]*\\$function\\$([\\s\\S]*?)\\$function\\$`, "i"));
  assert.ok(match, `missing ${qualifiedName} function body`);
  return match[1];
}

function countOccurrences(source, value) {
  return source.split(value).length - 1;
}
