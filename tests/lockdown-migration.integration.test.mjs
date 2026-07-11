import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { it } from "node:test";

const execFileAsync = promisify(execFile);
const testsDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(testsDirectory, "..");
const psqlBinary = process.env.AUSSIE_TEST_PSQL
  || "/opt/homebrew/Cellar/postgresql@17/17.10/bin/psql";
const requiredDatabaseEnv = [
  "AUSSIE_TEST_PGHOST",
  "AUSSIE_TEST_PGPORT",
  "AUSSIE_TEST_PGUSER",
  "AUSSIE_TEST_PGDATABASE",
];
const missingDatabaseEnv = requiredDatabaseEnv.filter((name) => !process.env[name]);

const applicationTables = [
  "trips",
  "members",
  "expenses",
  "attachments",
  "expense_activity",
];

const tablePrivileges = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
];

const applicationRpcs = [
  "public.apply_expense_operation(jsonb)",
  "public.consume_access_attempt(text)",
  "public.reset_access_attempt(text)",
  "public.create_receipt_upload_intent(jsonb)",
  "public.finalize_receipt_upload(text,text)",
  "public.claim_receipt_cleanup(text,integer)",
  "public.verify_receipt_cleanup_claim(uuid,text)",
  "public.finish_receipt_cleanup_claim(uuid,text,boolean)",
];

it("locks down shared-ledger access, restores only the tombstone bridge, and locks down again", {
  skip: missingDatabaseEnv.length > 0
    ? `set ${missingDatabaseEnv.join(", ")} to run the PostgreSQL integration test`
    : false,
  timeout: 120_000,
}, async () => {
  const database = `aussie_lockdown_${process.pid}_${Date.now()}`;

  await adminSql(`create database ${quoteIdentifier(database)} template template0`);
  try {
    await runFile(database, "tests/fixtures/supabase-compatibility-base.sql");
    await runFile(database, "supabase/migrations/20260710035744_shared_ledger_compatibility.sql");
    await createStorageFixture(database);
    await runFile(database, "supabase/migrations/20260710140534_private_receipts.sql");
    await exposeLegacyAccess(database);

    const stateBeforeLockdown = await ledgerState(database);
    await runFile(database, "supabase/migrations/20260711065642_lock_down_shared_ledger.sql");
    await runFile(database, "supabase/migrations/20260711065642_lock_down_shared_ledger.sql");

    assert.equal(await ledgerState(database), stateBeforeLockdown);
    await assertLockdown(database, "initial");
    await assertFutureDefaultsAreClosed(database);
    await assertServiceRpcWorks(database, "initial-lockdown");

    const stateBeforeRollback = await ledgerState(database);
    await runFile(database, "supabase/rollback/restore_legacy_shared_access.sql");
    await runFile(database, "supabase/rollback/restore_legacy_shared_access.sql");

    assert.equal(await ledgerState(database), stateBeforeRollback);
    await assertEmergencyRollback(database);

    const stateBeforeFinalLockdown = await ledgerState(database);
    await runFile(database, "supabase/migrations/20260711065642_lock_down_shared_ledger.sql");
    await runFile(database, "supabase/migrations/20260711065642_lock_down_shared_ledger.sql");

    assert.equal(await ledgerState(database), stateBeforeFinalLockdown);
    await assertLockdown(database, "final");
    await assertServiceRpcWorks(database, "final-lockdown");
    assert.equal(
      await scalar(database, "select count(*) from public.expenses where id = 'rollback-tombstone' and deleted_at is not null"),
      "1",
    );
  } finally {
    await adminSql(`drop database if exists ${quoteIdentifier(database)} with (force)`);
  }
});

it("rolls back the entire lockdown when Storage RLS is unavailable", {
  skip: missingDatabaseEnv.length > 0
    ? `set ${missingDatabaseEnv.join(", ")} to run the PostgreSQL integration test`
    : false,
  timeout: 120_000,
}, async () => {
  const database = `aussie_lockdown_atomic_${process.pid}_${Date.now()}`;

  await adminSql(`create database ${quoteIdentifier(database)} template template0`);
  try {
    await runFile(database, "tests/fixtures/supabase-compatibility-base.sql");
    await runFile(database, "supabase/migrations/20260710035744_shared_ledger_compatibility.sql");
    await createStorageFixture(database);
    await runFile(database, "supabase/migrations/20260710140534_private_receipts.sql");
    await exposeLegacyAccess(database);
    await sql(database, "alter table storage.objects disable row level security");

    const ledgerBefore = await ledgerState(database);
    const securityBefore = await securityCatalogState(database);
    await assert.rejects(
      runFile(database, "supabase/migrations/20260711065642_lock_down_shared_ledger.sql"),
      (error) => {
        assert.match(`${error.stderr || ""}\n${error.stdout || ""}`, /storage_objects_rls_required/);
        return true;
      },
    );

    assert.equal(await ledgerState(database), ledgerBefore);
    assert.equal(await securityCatalogState(database), securityBefore);
  } finally {
    await adminSql(`drop database if exists ${quoteIdentifier(database)} with (force)`);
  }
});

it("rolls back the complete schema install when the final Storage guard fails", {
  skip: missingDatabaseEnv.length > 0
    ? `set ${missingDatabaseEnv.join(", ")} to run the PostgreSQL integration test`
    : false,
  timeout: 120_000,
}, async () => {
  const database = `aussie_schema_atomic_${process.pid}_${Date.now()}`;

  await adminSql(`create database ${quoteIdentifier(database)} template template0`);
  try {
    await runFile(database, "tests/fixtures/supabase-compatibility-base.sql");
    await createStorageFixture(database);
    await sql(database, "grant usage, create on schema public to postgres; alter table storage.objects disable row level security");

    const ledgerBefore = await ledgerState(database);
    const securityBefore = await securityCatalogState(database);
    const structureBefore = await schemaStructureState(database);
    await assert.rejects(
      runFile(database, "supabase/schema.sql"),
      (error) => {
        assert.match(`${error.stderr || ""}\n${error.stdout || ""}`, /storage_objects_rls_required/);
        return true;
      },
    );

    assert.equal(await ledgerState(database), ledgerBefore);
    assert.equal(await securityCatalogState(database), securityBefore);
    assert.equal(await schemaStructureState(database), structureBefore);
  } finally {
    await adminSql(`drop database if exists ${quoteIdentifier(database)} with (force)`);
  }
});

it("executes the full schema snapshot into the same locked catalog state", {
  skip: missingDatabaseEnv.length > 0
    ? `set ${missingDatabaseEnv.join(", ")} to run the PostgreSQL integration test`
    : false,
  timeout: 120_000,
}, async () => {
  const database = `aussie_schema_lockdown_${process.pid}_${Date.now()}`;

  await adminSql(`create database ${quoteIdentifier(database)} template template0`);
  try {
    await runFile(database, "tests/fixtures/supabase-compatibility-base.sql");
    await createStorageFixture(database);
    await sql(database, "grant usage, create on schema public to postgres");
    await runFile(database, "supabase/schema.sql");

    assert.equal(await rlsTableCount(database), "5");
    assert.equal(await applicationPolicyNames(database), "");
    assert.equal(await storageRlsEnabled(database), "t");
    assert.equal(await storagePolicyNames(database), "");
    await assertRoleTablePrivileges(database, "anon", {});
    await assertRoleTablePrivileges(database, "authenticated", {});
    await assertRoleTablePrivileges(database, "service_role", {
      trips: ["SELECT"],
      members: ["SELECT"],
      expenses: ["SELECT", "INSERT", "UPDATE"],
      attachments: ["SELECT", "INSERT", "UPDATE"],
      expense_activity: ["SELECT", "INSERT"],
    });
    await assertRpcPrivileges(database);
    await assertFutureDefaultsAreClosed(database);
    await assertServiceRpcWorks(database, "schema-snapshot");
    assert.equal(await bucketConfiguration(database), "false|10485760|image/jpeg,image/png,image/heic,image/heif,image/webp");
  } finally {
    await adminSql(`drop database if exists ${quoteIdentifier(database)} with (force)`);
  }
});

async function createStorageFixture(database) {
  await sql(database, `
    create schema storage;
    create table storage.buckets (
      id text primary key,
      name text not null,
      public boolean not null default false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    create table storage.objects (
      id text primary key,
      bucket_id text not null,
      name text not null
    );
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated, service_role;
    grant select, insert, update, delete on table storage.objects to anon, authenticated, service_role;
    insert into storage.objects (id, bucket_id, name) values
      ('receipt-object', 'receipts', 'legacy.jpg'),
      ('avatar-object', 'avatars', 'avatar.jpg'),
      ('avatar-scoped-object', 'avatars', 'avatars/scoped.jpg')
  `);
}

async function exposeLegacyAccess(database) {
  await sql(database, `
    grant usage on schema public to public, anon, authenticated, service_role;
    grant usage, create on schema public to postgres;
    grant all privileges on table
      public.trips,
      public.members,
      public.expenses,
      public.attachments,
      public.expense_activity
    to public, anon, authenticated, service_role;

    create policy legacy_trips_all on public.trips to anon using (true) with check (true);
    create policy legacy_members_all on public.members to authenticated using (true) with check (true);
    create policy legacy_expenses_all on public.expenses to public using (true) with check (true);
    create policy legacy_attachments_all on public.attachments to anon using (true) with check (true);
    create policy legacy_activity_all on public.expense_activity to authenticated using (true) with check (true);

    create policy public_global_objects on storage.objects for select to public using (true);
    create policy anon_receipts_read on storage.objects for select to anon
      using (bucket_id = 'receipts');
    create policy authenticated_receipts_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'receipts');
    create policy mixed_receipts_read on storage.objects for select to anon, service_role
      using (bucket_id = 'receipts');
    create policy authenticated_other_scoped_read on storage.objects for select to authenticated
      using (bucket_id = 'avatars' and name like 'avatars/%');
    create policy anon_other_insert on storage.objects for insert to anon
      with check (bucket_id = 'avatars');
    create policy service_receipts_read on storage.objects for select to service_role
      using (bucket_id = 'receipts');

    update storage.buckets
    set public = true,
        file_size_limit = null,
        allowed_mime_types = null
    where id = 'receipts';

    grant execute on function public.apply_expense_operation(jsonb) to public, anon, authenticated;
    grant execute on function public.consume_access_attempt(text) to public, anon, authenticated;
    grant execute on function public.reset_access_attempt(text) to public, anon, authenticated;
    grant execute on function public.create_receipt_upload_intent(jsonb) to public, anon, authenticated;
    grant execute on function public.finalize_receipt_upload(text, text) to public, anon, authenticated;
    grant execute on function public.claim_receipt_cleanup(text, integer) to public, anon, authenticated;
    grant execute on function public.verify_receipt_cleanup_claim(uuid, text) to public, anon, authenticated;
    grant execute on function public.finish_receipt_cleanup_claim(uuid, text, boolean) to public, anon, authenticated;

    alter default privileges for role postgres in schema public
      grant all privileges on tables to public, anon, authenticated, service_role;
    alter default privileges for role postgres in schema public
      grant all privileges on sequences to public, anon, authenticated, service_role;
    alter default privileges for role postgres in schema public
      grant all privileges on functions to public, anon, authenticated, service_role
  `);
}

async function assertLockdown(database, phase) {
  assert.equal(await rlsTableCount(database), "5");
  assert.equal(await applicationPolicyNames(database), "");
  assert.equal(
    await scalar(database, `
      select not has_schema_privilege('anon', 'public', 'USAGE')
        and not has_schema_privilege('authenticated', 'public', 'USAGE')
        and has_schema_privilege('service_role', 'public', 'USAGE')
    `),
    "t",
  );

  await assertRoleTablePrivileges(database, "anon", {});
  await assertRoleTablePrivileges(database, "authenticated", {});
  await assertRoleTablePrivileges(database, "service_role", {
    trips: ["SELECT"],
    members: ["SELECT"],
    expenses: ["SELECT", "INSERT", "UPDATE"],
    attachments: ["SELECT", "INSERT", "UPDATE"],
    expense_activity: ["SELECT", "INSERT"],
  });
  await assertRpcPrivileges(database);

  assert.equal(await bucketConfiguration(database), "false|10485760|image/jpeg,image/png,image/heic,image/heif,image/webp");
  assert.equal(
    await storagePolicyNames(database),
    "anon_other_insert,authenticated_other_scoped_read,service_receipts_read",
  );
  assert.equal(
    await scalar(database, "set role anon; select count(*) from storage.objects where bucket_id = 'receipts'"),
    "0",
  );
  assert.equal(
    await scalar(database, "set role authenticated; select count(*) from storage.objects where id = 'avatar-scoped-object'"),
    "1",
  );
  assert.equal(
    await scalar(database, "set role authenticated; select count(*) from storage.objects where id = 'avatar-object'"),
    "0",
  );
  await sql(database, `
    set role anon;
    insert into storage.objects (id, bucket_id, name)
    values ('allowed-avatar-${phase}', 'avatars', 'avatars/allowed-${phase}.jpg')
  `);
  assert.equal(
    await scalar(database, `select count(*) from storage.objects where id = 'allowed-avatar-${phase}'`),
    "1",
  );
  await expectSqlFailure(database, `
    set role anon;
    insert into storage.objects (id, bucket_id, name)
    values ('denied-receipt-${phase}', 'receipts', 'denied-${phase}.jpg')
  `, /row-level security policy|permission denied/i);

  await expectSqlFailure(database, "set role anon; select * from public.expenses", /permission denied/i);
  await expectSqlFailure(database, "set role authenticated; insert into public.expense_activity (id, expense_id, action, item, amount, currency, summary) values ('denied', 'legacy-expense', 'edit', 'Denied', 1, 'AUD', 'Denied')", /permission denied/i);
  await expectSqlFailure(database, "set role service_role; delete from public.expenses where id = 'legacy-expense'", /permission denied|physical_delete_disabled/i);
}

async function assertFutureDefaultsAreClosed(database) {
  await sql(database, `
    set role postgres;
    create table public.lockdown_future_table (
      id bigint generated always as identity primary key
    );
    create sequence public.lockdown_future_sequence;
    create function public.lockdown_future_function()
    returns integer
    language sql
    as $function$ select 1 $function$;
    reset role
  `);

  for (const role of ["anon", "authenticated", "service_role"]) {
    for (const privilege of tablePrivileges) {
      assert.equal(
        await scalar(database, `select has_table_privilege(${literal(role)}, 'public.lockdown_future_table', ${literal(privilege)})`),
        "f",
      );
    }
    assert.equal(
      await scalar(database, `select has_sequence_privilege(${literal(role)}, 'public.lockdown_future_sequence', 'USAGE')`),
      "f",
    );
    assert.equal(
      await scalar(database, `select has_function_privilege(${literal(role)}, 'public.lockdown_future_function()', 'EXECUTE')`),
      "f",
    );
  }
}

async function assertServiceRpcWorks(database, phase) {
  const expenseId = `rpc-${phase}`;
  const operation = operationPayload(phase, expenseId);
  assert.deepEqual(
    JSON.parse(await scalar(database, `
      set role service_role;
      select public.apply_expense_operation(${literal(JSON.stringify(operation))}::jsonb)
    `)),
    { opId: `op-${phase}`, status: "applied" },
  );

  const receipt = {
    expenseId,
    receiptId: `receipt-${phase}`,
    originalName: `${phase}.jpg`,
    mimeType: "image/jpeg",
    sizeBytes: 1024,
    storagePath: `${expenseId}/receipt-${phase}-${phase}.jpg`,
  };
  const intent = JSON.parse(await scalar(database, `
    set role service_role;
    select public.create_receipt_upload_intent(${literal(JSON.stringify(receipt))}::jsonb)
  `));
  assert.equal(intent.receipt_id, receipt.receiptId);
  assert.ok(JSON.parse(await scalar(database, `
    set role service_role;
    select public.finalize_receipt_upload(${literal(expenseId)}, ${literal(receipt.receiptId)})
  `)).finalized_at);

  assert.equal(
    JSON.parse(await scalar(database, `
      set role service_role;
      select public.consume_access_attempt($hash$${"a".repeat(64)}$hash$)
    `)).allowed,
    true,
  );
}

async function assertEmergencyRollback(database) {
  assert.equal(await rlsTableCount(database), "5");
  assert.equal(
    await applicationPolicyNames(database),
    "legacy_shared_expense_activity_insert,legacy_shared_expense_activity_select,legacy_shared_expenses_insert,legacy_shared_expenses_select,legacy_shared_expenses_update",
  );
  assert.equal(
    await scalar(database, `
      select has_schema_privilege('anon', 'public', 'USAGE')
        and has_schema_privilege('authenticated', 'public', 'USAGE')
    `),
    "t",
  );

  const bridgePrivileges = {
    expenses: ["SELECT", "INSERT", "UPDATE"],
    expense_activity: ["SELECT", "INSERT"],
  };
  await assertRoleTablePrivileges(database, "anon", bridgePrivileges);
  await assertRoleTablePrivileges(database, "authenticated", bridgePrivileges);
  await assertRoleTablePrivileges(database, "service_role", {
    trips: ["SELECT"],
    members: ["SELECT"],
    expenses: ["SELECT", "INSERT", "UPDATE"],
    attachments: ["SELECT", "INSERT", "UPDATE"],
    expense_activity: ["SELECT", "INSERT"],
  });
  await assertRpcPrivileges(database);
  assert.equal(await bucketConfiguration(database), "false|10485760|image/jpeg,image/png,image/heic,image/heif,image/webp");
  assert.equal(
    await storagePolicyNames(database),
    "anon_other_insert,authenticated_other_scoped_read,service_receipts_read",
  );

  await expectSqlFailure(database, "set role anon; select * from public.trips", /permission denied/i);
  await expectSqlFailure(database, "set role authenticated; select * from public.members", /permission denied/i);
  await expectSqlFailure(database, "set role anon; select * from public.attachments", /permission denied/i);
  await expectSqlFailure(database, `
    set role anon;
    insert into public.expenses (
      id, category, item, currency, amount, payer, status, mutation_version, deleted_at
    ) values (
      'rollback-invalid-tombstone', 'dining', 'Invalid tombstone', 'AUD', 5, 'us',
      'confirmed', ${literal(mutationVersion(1, "rollback-invalid"))}, pg_catalog.now()
    )
  `, /row-level security policy/i);

  await expectSqlFailure(database, `
    set role anon;
    set request.method = 'PATCH';
    set request.headers = '{"prefer":"return=representation"}';
    update public.expenses
    set deleted_at = pg_catalog.now(),
        mutation_version = ${literal(mutationVersion(1, "rollback-returning"))}
    where id = 'legacy-expense'
  `, /row-level security policy/i);
  assert.equal(
    await scalar(database, "select deleted_at is null from public.expenses where id = 'legacy-expense'"),
    "t",
  );

  await sql(database, `
    set role anon;
    insert into public.expenses (
      id, category, item, currency, amount, payer, status, mutation_version
    ) values (
      'rollback-tombstone', 'dining', 'Rollback dinner', 'AUD', 18, 'us',
      'confirmed', ${literal(mutationVersion(1, "rollback"))}
    )
  `);
  assert.equal(
    await scalar(database, "set role authenticated; select count(*) from public.expenses where id = 'rollback-tombstone'"),
    "1",
  );
  await sql(database, `
    set role authenticated;
    set request.method = 'PATCH';
    set request.headers = '{"prefer":"return=minimal"}';
    update public.expenses
    set deleted_at = pg_catalog.now(),
        mutation_version = ${literal(mutationVersion(2, "rollback"))}
    where id = 'rollback-tombstone'
  `);
  assert.equal(
    await scalar(database, "set role anon; select count(*) from public.expenses where id = 'rollback-tombstone'"),
    "0",
  );
  assert.equal(
    await scalar(database, "select count(*) from public.expenses where id = 'rollback-tombstone' and deleted_at is not null"),
    "1",
  );
  await sql(database, `
    set role anon;
    insert into public.expense_activity (
      id, expense_id, action, item, amount, currency, summary
    ) values (
      'rollback-delete-activity', 'rollback-tombstone', 'delete',
      'Rollback dinner', 18, 'AUD', 'Soft deleted through rollback bridge'
    )
  `);

  await expectSqlFailure(database, "set role anon; delete from public.expenses where id = 'legacy-expense'", /permission denied|physical_delete_disabled/i);
  await expectSqlFailure(database, "set role authenticated; update public.expense_activity set summary = 'Denied' where id = 'legacy-activity'", /permission denied/i);
  await expectSqlFailure(database, "set role anon; select public.apply_expense_operation('{}'::jsonb)", /permission denied/i);
  assert.equal(
    await scalar(database, "set role anon; select count(*) from storage.objects where bucket_id = 'receipts'"),
    "0",
  );
}

async function assertRoleTablePrivileges(database, role, expected) {
  for (const table of applicationTables) {
    const allowed = new Set(expected[table] || []);
    for (const privilege of tablePrivileges) {
      assert.equal(
        await scalar(database, `select has_table_privilege(${literal(role)}, ${literal(`public.${table}`)}, ${literal(privilege)})`),
        allowed.has(privilege) ? "t" : "f",
        `${role} ${privilege} on public.${table}`,
      );
    }
  }
}

async function assertRpcPrivileges(database) {
  for (const rpc of applicationRpcs) {
    assert.equal(
      await scalar(database, `
        select has_function_privilege('service_role', ${literal(rpc)}, 'EXECUTE')
          and not has_function_privilege('anon', ${literal(rpc)}, 'EXECUTE')
          and not has_function_privilege('authenticated', ${literal(rpc)}, 'EXECUTE')
      `),
      "t",
      rpc,
    );
  }
}

async function rlsTableCount(database) {
  return scalar(database, `
    select count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = any (array['trips', 'members', 'expenses', 'attachments', 'expense_activity'])
      and relation.relrowsecurity
  `);
}

async function storageRlsEnabled(database) {
  return scalar(database, [
    "select relation.relrowsecurity",
    "from pg_catalog.pg_class relation",
    "join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace",
    "where namespace.nspname = 'storage'",
    "  and relation.relname = 'objects'",
  ].join("\n"));
}

async function applicationPolicyNames(database) {
  return scalar(database, `
    select coalesce(string_agg(policyname, ',' order by policyname), '')
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = any (array['trips', 'members', 'expenses', 'attachments', 'expense_activity'])
  `);
}

async function storagePolicyNames(database) {
  return scalar(database, `
    select coalesce(string_agg(policyname, ',' order by policyname), '')
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
  `);
}

async function bucketConfiguration(database) {
  return scalar(database, `
    select public || '|' || file_size_limit || '|' || array_to_string(allowed_mime_types, ',')
    from storage.buckets
    where id = 'receipts'
  `);
}

async function securityCatalogState(database) {
  return scalar(database, [
    "select jsonb_build_object(",
    "  'applicationRls', (",
    "    select jsonb_agg(jsonb_build_object('table', relation.relname, 'enabled', relation.relrowsecurity) order by relation.relname)",
    "    from pg_catalog.pg_class relation",
    "    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace",
    "    where namespace.nspname = 'public'",
    "      and relation.relname = any (array['trips', 'members', 'expenses', 'attachments', 'expense_activity'])",
    "  ),",
    "  'storageRls', (",
    "    select relation.relrowsecurity",
    "    from pg_catalog.pg_class relation",
    "    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace",
    "    where namespace.nspname = 'storage' and relation.relname = 'objects'",
    "  ),",
    "  'schemaUsage', jsonb_build_object(",
    "    'anon', has_schema_privilege('anon', 'public', 'USAGE'),",
    "    'authenticated', has_schema_privilege('authenticated', 'public', 'USAGE'),",
    "    'serviceRole', has_schema_privilege('service_role', 'public', 'USAGE')",
    "  ),",
    "  'grants', (",
    "    select coalesce(jsonb_agg(jsonb_build_object('role', grantee, 'table', table_name, 'privilege', privilege_type) order by grantee, table_name, privilege_type), '[]'::jsonb)",
    "    from information_schema.role_table_grants",
    "    where table_schema = 'public'",
    "      and table_name = any (array['trips', 'members', 'expenses', 'attachments', 'expense_activity'])",
    "      and grantee in ('anon', 'authenticated', 'service_role')",
    "  ),",
    "  'policies', (",
    "    select coalesce(jsonb_agg(jsonb_build_object('schema', schemaname, 'table', tablename, 'name', policyname, 'roles', roles, 'command', cmd, 'using', qual, 'check', with_check) order by schemaname, tablename, policyname), '[]'::jsonb)",
    "    from pg_catalog.pg_policies",
    "    where (schemaname = 'public' and tablename = any (array['trips', 'members', 'expenses', 'attachments', 'expense_activity']))",
    "       or (schemaname = 'storage' and tablename = 'objects')",
    "  ),",
    "  'bucket', (select to_jsonb(bucket) from storage.buckets bucket where id = 'receipts'),",
    "  'defaultAcl', (",
    "    select coalesce(jsonb_agg(jsonb_build_object('objectType', defaults.defaclobjtype, 'acl', defaults.defaclacl::text) order by defaults.defaclobjtype), '[]'::jsonb)",
    "    from pg_catalog.pg_default_acl defaults",
    "    where defaults.defaclrole = 'postgres'::regrole",
    "      and (defaults.defaclnamespace = 0 or defaults.defaclnamespace = 'public'::regnamespace)",
    "  )",
    ")::text",
  ].join("\n"));
}

async function schemaStructureState(database) {
  return scalar(database, [
    "select jsonb_build_object(",
    "  'privateSchema', to_regnamespace('app_private')::text,",
    "  'expenseColumns', (",
    "    select jsonb_agg(column_name order by ordinal_position)",
    "    from information_schema.columns",
    "    where table_schema = 'public' and table_name = 'expenses'",
    "  ),",
    "  'attachmentColumns', (",
    "    select jsonb_agg(column_name order by ordinal_position)",
    "    from information_schema.columns",
    "    where table_schema = 'public' and table_name = 'attachments'",
    "  ),",
    "  'applicationFunctions', (",
    "    select coalesce(jsonb_agg(procedure.proname order by procedure.proname), '[]'::jsonb)",
    "    from pg_catalog.pg_proc procedure",
    "    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace",
    "    where namespace.nspname = 'public'",
    "      and procedure.proname = any (array['apply_expense_operation', 'consume_access_attempt', 'create_receipt_upload_intent', 'finalize_receipt_upload'])",
    "  )",
    ")::text",
  ].join("\n"));
}

async function ledgerState(database) {
  return scalar(database, `
    select jsonb_build_object(
      'trips', (select coalesce(jsonb_agg(to_jsonb(row_data) order by id), '[]'::jsonb) from public.trips row_data),
      'members', (select coalesce(jsonb_agg(to_jsonb(row_data) order by id), '[]'::jsonb) from public.members row_data),
      'expenses', (select coalesce(jsonb_agg(to_jsonb(row_data) order by id), '[]'::jsonb) from public.expenses row_data),
      'attachments', (select coalesce(jsonb_agg(to_jsonb(row_data) order by id), '[]'::jsonb) from public.attachments row_data),
      'expenseActivity', (select coalesce(jsonb_agg(to_jsonb(row_data) order by id), '[]'::jsonb) from public.expense_activity row_data)
    )::text
  `);
}

function operationPayload(phase, expenseId) {
  const item = `RPC dinner ${phase}`;
  return {
    opId: `op-${phase}`,
    type: "upsert",
    expenseId,
    mutationVersion: mutationVersion(1, phase),
    expense: {
      id: expenseId,
      category: "dining",
      item,
      date: "2026-07-11",
      currency: "AUD",
      amount: 24.5,
      payer: "us",
      status: "confirmed",
      note: "Lockdown integration test",
      splitSettled: false,
    },
    activity: {
      id: `activity-${phase}`,
      expenseId,
      action: "add",
      item,
      amount: 24.5,
      currency: "AUD",
      summary: "Added by service RPC",
      createdAt: new Date().toISOString(),
    },
  };
}

function mutationVersion(counter, client) {
  return `${Date.now()}-${String(counter).padStart(6, "0")}-${client}`;
}

async function runFile(database, relativePath) {
  await psql(database, ["-f", join(projectRoot, relativePath)]);
}

async function adminSql(statement) {
  await psql(process.env.AUSSIE_TEST_PGDATABASE, ["-c", statement]);
}

async function sql(database, statement) {
  await psql(database, ["-c", statement]);
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
  return execFileAsync(psqlBinary, [
    "-X",
    "--set=ON_ERROR_STOP=1",
    "-q",
    "-d",
    database,
    ...args,
  ], {
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
