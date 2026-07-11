import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const testsDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(testsDirectory, "..");
const migration = readSql("supabase/migrations/20260711065642_lock_down_shared_ledger.sql");
const rollback = readSql("supabase/rollback/restore_legacy_shared_access.sql");
const schema = readSql("supabase/schema.sql");

const applicationTables = [
  "trips",
  "members",
  "expenses",
  "attachments",
  "expense_activity",
];

const applicationRpcs = [
  "public.apply_expense_operation(jsonb)",
  "public.consume_access_attempt(text)",
  "public.reset_access_attempt(text)",
  "public.create_receipt_upload_intent(jsonb)",
  "public.finalize_receipt_upload(text, text)",
  "public.claim_receipt_cleanup(text, integer)",
  "public.verify_receipt_cleanup_claim(uuid, text)",
  "public.finish_receipt_cleanup_claim(uuid, text, boolean)",
];

describe("shared-ledger lockdown migration contract", () => {
  it("enables RLS and removes every existing application-table policy", () => {
    for (const table of applicationTables) {
      assert.match(
        migration,
        new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, "i"),
      );
    }

    expectAll(migration, [
      /from\s+pg_catalog\.pg_policy/i,
      /join\s+pg_catalog\.pg_class/i,
      /join\s+pg_catalog\.pg_namespace/i,
      /namespace\.nspname\s*=\s*'public'/i,
      /relation\.relname\s*=\s*any\s*\(/i,
      /pg_catalog\.format\(\s*'drop policy if exists %I on %I\.%I'/i,
    ]);
    assert.doesNotMatch(migration, /create\s+policy/i);
  });

  it("replaces inherited table access with the exact service-role matrix", () => {
    expectAll(migration, [
      /revoke\s+all\s+privileges\s+on\s+table[\s\S]*public\.trips[\s\S]*public\.members[\s\S]*public\.expenses[\s\S]*public\.attachments[\s\S]*public\.expense_activity[\s\S]*from\s+public,\s*anon,\s*authenticated,\s*service_role/i,
      /revoke\s+all\s+privileges\s+on\s+schema\s+public\s+from\s+public,\s*anon,\s*authenticated/i,
      /grant\s+usage\s+on\s+schema\s+public\s+to\s+service_role/i,
      /grant\s+select\s+on\s+table\s+public\.trips,\s*public\.members\s+to\s+service_role/i,
      /grant\s+select,\s*insert,\s*update\s+on\s+table\s+public\.expenses,\s*public\.attachments\s+to\s+service_role/i,
      /grant\s+select,\s*insert\s+on\s+table\s+public\.expense_activity\s+to\s+service_role/i,
    ]);

    assert.doesNotMatch(migration, /grant[^;]*\bdelete\b[^;]*to\s+service_role/i);
    assert.doesNotMatch(migration, /grant[^;]*\b(?:truncate|references|trigger)\b[^;]*to\s+service_role/i);
  });

  it("keeps every application RPC service-only with explicit signatures", () => {
    for (const rpc of applicationRpcs) {
      const escapedRpc = escapeRegExp(rpc).replaceAll("\\ ", "\\s*");
      assert.match(
        migration,
        new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+${escapedRpc}\\s+from\\s+public,\\s*anon,\\s*authenticated`, "i"),
      );
      assert.match(
        migration,
        new RegExp(`grant\\s+execute\\s+on\\s+function\\s+${escapedRpc}\\s+to\\s+service_role`, "i"),
      );
    }
  });

  it("cancels postgres default grants for future public objects", () => {
    assert.match(
      migration,
      /alter\s+default\s+privileges\s+for\s+role\s+postgres\s+revoke\s+execute\s+on\s+functions\s+from\s+public/i,
    );
    for (const objectType of ["tables", "sequences", "functions"]) {
      assert.match(
        migration,
        new RegExp(`alter\\s+default\\s+privileges\\s+for\\s+role\\s+postgres\\s+in\\s+schema\\s+public\\s+revoke\\s+all\\s+privileges\\s+on\\s+${objectType}\\s+from\\s+public,\\s*anon,\\s*authenticated,\\s*service_role`, "i"),
      );
    }
  });

  it("forces the private receipts bucket limits and selectively removes unsafe Storage policies", () => {
    expectAll(migration, [
      /insert\s+into\s+storage\.buckets/i,
      /values\s*\(\s*'receipts',\s*'receipts',\s*false,\s*10485760/i,
      /array\['image\/jpeg',\s*'image\/png',\s*'image\/heic',\s*'image\/heif',\s*'image\/webp'\]/i,
      /on\s+conflict\s*\(id\)\s+do\s+update/i,
      /public\s*=\s*false/i,
      /relation\.relrowsecurity/i,
      /message\s*=\s*'storage_objects_rls_required'/i,
      /relation\.relname\s*=\s*'objects'/i,
      /namespace\.nspname\s*=\s*'storage'/i,
      /0\s*=\s*any\s*\(policy\.polroles\)/i,
      /role\.rolname\s+in\s*\(\s*'anon',\s*'authenticated'\s*\)/i,
      /pg_catalog\.pg_get_expr\(policy\.polqual,\s*policy\.polrelid\)/i,
      /pg_catalog\.pg_get_expr\(policy\.polwithcheck,\s*policy\.polrelid\)/i,
      /pg_catalog\.format\(\s*'drop policy if exists %I on storage\.objects'/i,
    ]);
    assert.match(migration, /bucket_id/i);
  });

  it("contains no destructive ledger-data operation or compatibility-object removal", () => {
    const source = stripSqlComments(migration);
    const tables = applicationTables.join("|");

    assert.doesNotMatch(source, new RegExp(`(?:delete\\s+from|truncate(?:\\s+table)?)\\s+public\\.(?:${tables})`, "i"));
    assert.doesNotMatch(source, new RegExp(`drop\\s+table(?:\\s+if\\s+exists)?\\s+public\\.(?:${tables})`, "i"));
    assert.doesNotMatch(source, /drop\s+column/i);
    assert.doesNotMatch(source, /drop\s+(?:function|schema|trigger)/i);
  });
});

describe("legacy shared-access emergency rollback contract", () => {
  it("keeps RLS enabled and restores only the two bridge tables", () => {
    for (const table of applicationTables) {
      assert.match(
        rollback,
        new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, "i"),
      );
    }

    expectAll(rollback, [
      /grant\s+usage\s+on\s+schema\s+public\s+to\s+anon,\s*authenticated/i,
      /grant\s+select,\s*insert,\s*update\s+on\s+table\s+public\.expenses\s+to\s+anon,\s*authenticated/i,
      /grant\s+select,\s*insert\s+on\s+table\s+public\.expense_activity\s+to\s+anon,\s*authenticated/i,
    ]);
    assert.doesNotMatch(rollback, /grant[^;]*on\s+table\s+public\.(?:trips|members|attachments)/i);
    assert.doesNotMatch(rollback, /grant[^;]*\bdelete\b/i);
  });

  it("uses tombstone-aware expense policies and minimal activity policies", () => {
    const selectPolicy = policyStatement(rollback, "legacy_shared_expenses_select");
    const insertPolicy = policyStatement(rollback, "legacy_shared_expenses_insert");
    const updatePolicy = policyStatement(rollback, "legacy_shared_expenses_update");
    const activitySelectPolicy = policyStatement(rollback, "legacy_shared_expense_activity_select");
    const activityInsertPolicy = policyStatement(rollback, "legacy_shared_expense_activity_insert");

    expectAll(selectPolicy, [
      /for\s+select/i,
      /to\s+anon,\s*authenticated/i,
      /deleted_at\s+is\s+null/i,
      /pg_catalog\.current_setting\(\s*'request\.method',\s*true\s*\)\s*=\s*'PATCH'/i,
      /pg_catalog\.current_setting\(\s*'request\.headers',\s*true\s*\)\s+ilike\s+'%return=minimal%'/i,
    ]);
    expectAll(insertPolicy, [
      /for\s+insert/i,
      /with\s+check\s*\(\s*deleted_at\s+is\s+null\s*\)/i,
    ]);
    expectAll(updatePolicy, [
      /for\s+update/i,
      /using\s*\(\s*deleted_at\s+is\s+null\s*\)/i,
      /with\s+check\s*\(\s*true\s*\)/i,
    ]);
    expectAll(activitySelectPolicy, [/for\s+select/i, /using\s*\(\s*true\s*\)/i]);
    expectAll(activityInsertPolicy, [/for\s+insert/i, /with\s+check\s*\(\s*true\s*\)/i]);
  });

  it("does not reopen Storage, closed tables, physical delete, or service RPCs", () => {
    const source = stripSqlComments(rollback);

    assert.doesNotMatch(source, /storage\.(?:objects|buckets)/i);
    assert.doesNotMatch(source, /create\s+policy[^;]*on\s+(?:table\s+)?storage\.objects/i);
    assert.doesNotMatch(source, /grant\s+execute[^;]*to\s+(?:public|anon|authenticated)/i);
    assert.doesNotMatch(source, /(?:delete\s+from|truncate(?:\s+table)?)\s+public\./i);
    assert.doesNotMatch(source, /drop\s+(?:table|column|function|schema|trigger)/i);
  });
});

describe("lockdown schema snapshot", () => {
  it("keeps the complete schema in one transaction", () => {
    assert.equal((schema.match(/^begin;$/gmi) || []).length, 1);
    assert.equal((schema.match(/^commit;$/gmi) || []).length, 1);
    assert.match(schema, /^begin;/i);
    assert.match(schema, /commit;\s*$/i);
  });

  it("records the final RLS, grants, RPC, default-privilege, bucket, and policy-cleanup state", () => {
    expectAll(schema, [
      /shared-ledger lockdown snapshot/i,
      /alter\s+table\s+public\.expenses\s+enable\s+row\s+level\s+security/i,
      /revoke\s+all\s+privileges\s+on\s+table[\s\S]*public\.expense_activity[\s\S]*from\s+public,\s*anon,\s*authenticated,\s*service_role/i,
      /grant\s+select,\s*insert,\s*update\s+on\s+table\s+public\.expenses,\s*public\.attachments\s+to\s+service_role/i,
      /revoke\s+execute\s+on\s+function\s+public\.apply_expense_operation\(jsonb\)/i,
      /alter\s+default\s+privileges\s+for\s+role\s+postgres/i,
      /storage_objects_rls_required/i,
      /drop policy if exists %I on storage\.objects/i,
    ]);
  });

  it("keeps the lockdown snapshot body identical to the deployable migration", () => {
    const marker = "-- Shared-ledger lockdown snapshot.";
    const markerIndex = schema.indexOf(marker);
    assert.notEqual(markerIndex, -1);

    const schemaBody = schema.slice(markerIndex + marker.length).trim().replace(/\s*commit;\s*$/i, "").trim();
    const migrationBody = migration.trim().replace(/^begin;\s*/i, "").replace(/\s*commit;\s*$/i, "").trim();
    assert.equal(schemaBody, migrationBody);
  });
});

function readSql(relativePath) {
  const path = join(projectRoot, relativePath);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function expectAll(source, patterns) {
  for (const pattern of patterns) assert.match(source, pattern);
}

function policyStatement(source, policyName) {
  const match = source.match(new RegExp(`create\\s+policy\\s+${escapeRegExp(policyName)}[\\s\\S]*?;`, "i"));
  assert.ok(match, `missing ${policyName} policy`);
  return match[0];
}

function stripSqlComments(source) {
  return source.replaceAll(/--.*$/gm, "");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
