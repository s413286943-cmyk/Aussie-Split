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

it("migrates, enforces, rolls back, and reapplies shared-ledger compatibility", {
  skip: missingDatabaseEnv.length > 0
    ? `set ${missingDatabaseEnv.join(", ")} to run the PostgreSQL integration test`
    : false,
  timeout: 120_000,
}, async () => {
  const database = `aussie_compat_${process.pid}_${Date.now()}`;

  await adminSql(`create database ${quoteIdentifier(database)} template template0`);
  try {
    await runFile(database, "tests/fixtures/supabase-compatibility-base.sql");
    await runFile(database, "supabase/migrations/20260710035744_shared_ledger_compatibility.sql");

    await assertMigrationMetadata(database);
    await assertCoreBehavior(database, "initial");

    const retainedBeforeRollback = await retainedPublicState(database);
    await runFile(database, "supabase/rollback/remove_shared_ledger_compatibility.sql");
    assert.equal(await retainedPublicState(database), retainedBeforeRollback);
    assert.equal(await scalar(database, "select to_regnamespace('app_private') is null"), "t");
    assert.equal(await scalar(database, "select to_regprocedure('public.apply_expense_operation(jsonb)') is null"), "t");
    assert.equal(await scalar(database, columnCountSql()), "9");

    await runFile(database, "supabase/migrations/20260710035744_shared_ledger_compatibility.sql");
    await assertMigrationMetadata(database);
    await assertCoreBehavior(database, "reapplied");
  } finally {
    await adminSql(`drop database if exists ${quoteIdentifier(database)} with (force)`);
  }
});

async function assertMigrationMetadata(database) {
  assert.equal(
    await scalar(database, `
      select count(*)
      from public.expenses
      where mutation_version !~ '^[0-9]{13}-[0-9]{6}-[a-z0-9]+(?:-[a-z0-9]+)*$'
         or updated_at is null
    `),
    "0",
  );
  assert.equal(
    await scalar(database, "select mutation_version from public.expenses where id = 'legacy-expense'"),
    "1782864000000-000000-server",
  );
  assert.equal(await scalar(database, columnCountSql()), "9");
  assert.equal(
    await scalar(database, `
      select count(*)
      from information_schema.columns
      where table_schema = 'app_private'
        and table_name = 'expense_operations'
        and column_name in ('operation', 'result_status')
    `),
    "2",
  );
  assert.equal(
    await scalar(database, `
      select count(*)
      from pg_catalog.pg_indexes
      where schemaname = 'public'
        and indexname in (
          'attachments_receipt_id_unique',
          'attachments_storage_path_unique',
          'attachments_expense_id_idx',
          'members_trip_id_idx'
        )
    `),
    "4",
  );
  assert.equal(
    await scalar(database, `
      select count(*)
      from pg_catalog.pg_class
      where relnamespace = 'public'::regnamespace
        and relname in ('trips', 'members', 'expenses', 'attachments', 'expense_activity')
        and relrowsecurity
    `),
    "0",
  );
  assert.equal(
    await scalar(database, `
      select count(*)
      from pg_catalog.pg_proc procedure
      join pg_catalog.pg_roles owner on owner.oid = procedure.proowner
      where procedure.pronamespace = 'app_private'::regnamespace
        and procedure.proname in ('enforce_expense_mutation', 'reject_physical_expense_delete')
        and owner.rolname = 'postgres'
        and not procedure.prosecdef
    `),
    "2",
  );
  assert.equal(
    await scalar(database, `
      select has_schema_privilege('anon', 'app_private', 'USAGE')
        or has_function_privilege('anon', 'public.apply_expense_operation(jsonb)', 'EXECUTE')
        or has_function_privilege('anon', 'public.consume_access_attempt(text)', 'EXECUTE')
        or has_function_privilege('authenticated', 'public.reset_access_attempt(text)', 'EXECUTE')
    `),
    "f",
  );
  assert.equal(
    await scalar(database, `
      select has_schema_privilege('service_role', 'app_private', 'USAGE')
        and has_function_privilege('service_role', 'public.apply_expense_operation(jsonb)', 'EXECUTE')
        and has_function_privilege('service_role', 'public.consume_access_attempt(text)', 'EXECUTE')
        and has_function_privilege('service_role', 'public.reset_access_attempt(text)', 'EXECUTE')
    `),
    "t",
  );
}

async function assertCoreBehavior(database, phase) {
  const expenseId = `expense-${phase}`;
  const physical = await scalar(database, `
    select lpad((floor(extract(epoch from pg_catalog.clock_timestamp()) * 1000)::bigint)::text, 13, '0')
  `);
  const version = (counter, client) => `${physical}-${String(counter).padStart(6, "0")}-${client}`;
  const anonInsertVersion = version(1, "anon");
  const anonUpdateVersion = version(2, "anon");
  const serviceVersion = version(10, "service");
  const deleteVersion = version(11, "service");

  await assertMutationVersionGrammar(database, phase, physical);
  await assertCollatedMutationOrdering(database, phase, physical);

  await sql(database, `
    set role anon;
    insert into public.expenses (
      id, category, item, date, currency, amount, payer, status, note,
      attachment_name, mutation_version
    ) values (
      ${literal(expenseId)}, 'dining', 'Anon dinner', '2026-07-10', 'AUD', 75.00,
      'us', 'confirmed', 'Inserted by anon', 'legacy-${phase}.jpg', ${literal(anonInsertVersion)}
    )
  `);

  await sql(database, `
    set role service_role;
    insert into public.attachments (
      expense_id, storage_path, receipt_id, original_name, mime_type, size_bytes, finalized_at
    ) values (
      ${literal(expenseId)}, 'receipts/${phase}.jpg', 'receipt-${phase}',
      'server-${phase}.jpg', 'image/jpeg', 2048, pg_catalog.now()
    )
  `);

  await sql(database, `
    set role anon;
    update public.expenses
    set item = 'Anon dinner updated',
        attachment_name = 'client-overwrite.jpg',
        mutation_version = ${literal(anonUpdateVersion)}
    where id = ${literal(expenseId)}
  `);
  assert.equal(
    await scalar(database, `
      select item || '|' || attachment_name
      from public.expenses
      where id = ${literal(expenseId)}
    `),
    `Anon dinner updated|legacy-${phase}.jpg`,
  );
  assert.equal(
    await scalar(database, `
      select receipt_id || '|' || original_name || '|' || mime_type || '|' || size_bytes
      from public.attachments
      where expense_id = ${literal(expenseId)}
    `),
    `receipt-${phase}|server-${phase}.jpg|image/jpeg|2048`,
  );

  await expectSqlFailure(database, `
    set role anon;
    update public.expenses set note = 'Missing version' where id = ${literal(expenseId)}
  `, /stale_mutation_version/);
  await expectSqlFailure(database, `
    set role anon;
    update public.expenses
    set mutation_version = ${literal(anonInsertVersion)}
    where id = ${literal(expenseId)}
  `, /stale_mutation_version/);
  await expectSqlFailure(database, `
    set role anon;
    delete from public.expenses where id = ${literal(expenseId)}
  `, /physical_delete_disabled/);

  await expectSqlFailure(database, "set role anon; select * from app_private.expense_operations", /permission denied/);
  await expectSqlFailure(database, "set role anon; alter table app_private.expense_operations add column denied text", /permission denied/);
  await expectSqlFailure(database, "set role anon; select public.apply_expense_operation('{}'::jsonb)", /permission denied/);
  await expectSqlFailure(database, `set role anon; select public.consume_access_attempt($hash$${"f".repeat(64)}$hash$)`, /permission denied/);

  const upsertOperation = operationPayload({
    phase,
    expenseId,
    opId: `op-${phase}-upsert`,
    mutationVersion: serviceVersion,
    activityId: `activity-${phase}-upsert`,
    item: "Service dinner",
    action: "edit",
  });
  assert.deepEqual(await applyOperation(database, upsertOperation), {
    opId: `op-${phase}-upsert`,
    status: "applied",
  });

  assert.deepEqual(await applyOperation(database, upsertOperation), {
    opId: `op-${phase}-upsert`,
    status: "applied",
  });
  assert.equal(
    await scalar(database, `
      select result_status || '|' || (operation = ${literal(JSON.stringify(upsertOperation))}::jsonb)::text
      from app_private.expense_operations
      where op_id = 'op-${phase}-upsert'
    `),
    "applied|true",
  );
  assert.equal(
    await scalar(database, `select item from public.expenses where id = ${literal(expenseId)}`),
    "Service dinner",
  );
  assert.equal(
    await scalar(database, `
      select count(*) from public.expense_activity
      where id = 'activity-${phase}-upsert'
    `),
    "1",
  );

  const conflictingOperation = cloneOperation(upsertOperation);
  conflictingOperation.expense.item = "Conflicting retry";
  conflictingOperation.activity.item = "Conflicting retry";
  await expectOperationFailure(database, conflictingOperation, /operation_id_conflict/);
  assert.equal(
    await scalar(database, `select item from public.expenses where id = ${literal(expenseId)}`),
    "Service dinner",
  );

  const staleOperation = operationPayload({
    phase,
    expenseId,
    opId: `op-${phase}-stale`,
    mutationVersion: serviceVersion,
    activityId: `activity-${phase}-stale`,
    item: "Stale must not win",
    action: "edit",
  });
  assert.deepEqual(await applyOperation(database, staleOperation), {
    opId: `op-${phase}-stale`,
    status: "stale",
  });
  assert.deepEqual(await applyOperation(database, staleOperation), {
    opId: `op-${phase}-stale`,
    status: "stale",
  });
  assert.equal(
    await scalar(database, `
      select result_status || '|' || (operation = ${literal(JSON.stringify(staleOperation))}::jsonb)::text
      from app_private.expense_operations
      where op_id = 'op-${phase}-stale'
    `),
    "stale|true",
  );
  assert.equal(
    await scalar(database, `select count(*) from public.expense_activity where id = 'activity-${phase}-stale'`),
    "0",
  );

  const deleteOperation = operationPayload({
    phase,
    expenseId,
    opId: `op-${phase}-delete`,
    mutationVersion: deleteVersion,
    activityId: `activity-${phase}-delete`,
    item: "Service dinner",
    action: "delete",
    type: "delete",
  });
  assert.equal(deleteOperation.expense, null);
  assert.deepEqual(await applyOperation(database, deleteOperation), {
    opId: `op-${phase}-delete`,
    status: "applied",
  });
  assert.equal(
    await scalar(database, `
      select (deleted_at is not null) || '|' || mutation_version || '|' || attachment_name
      from public.expenses
      where id = ${literal(expenseId)}
    `),
    `true|${deleteVersion}|legacy-${phase}.jpg`,
  );

  await assertInvalidPayloadsRejected(database, phase, physical);
  await assertOperationShapeAndActivityValidation(database, phase, physical);
  await assertActivityConflictRollsBack(database, phase, physical);
  await assertConcurrentOperationDeduplication(database, phase, physical);
  await assertDirectUpsertRpcRace(database, phase, physical);
  await assertThrottling(database, phase);
}

async function assertMutationVersionGrammar(database, phase, physical) {
  const validVersion = `${physical}-000050-device-a`;
  await sql(database, `
    set role anon;
    insert into public.expenses (
      id, category, item, currency, amount, payer, status, mutation_version
    ) values (
      'version-valid-${phase}', 'dining', 'Valid device version', 'AUD', 1, 'us', 'confirmed',
      ${literal(validVersion)}
    )
  `);

  for (const [index, clientId] of ["device_a", "device--a", "device-"].entries()) {
    await expectSqlFailure(database, `
      set role anon;
      insert into public.expenses (
        id, category, item, currency, amount, payer, status, mutation_version
      ) values (
        'version-invalid-${phase}-${index}', 'dining', 'Invalid device version',
        'AUD', 1, 'us', 'confirmed', ${literal(`${physical}-00005${index + 1}-${clientId}`)}
      )
    `, /invalid_mutation_version/);
  }

  const invalidRpcVersion = operationPayload({
    phase,
    expenseId: `version-rpc-invalid-${phase}`,
    opId: `op-${phase}-version-invalid`,
    mutationVersion: `${physical}-000059-device_a`,
    activityId: `activity-${phase}-version-invalid`,
    item: "Invalid RPC version",
    action: "add",
  });
  await expectOperationFailure(database, invalidRpcVersion, /invalid_mutation_version/);
}

async function assertCollatedMutationOrdering(database, phase, physical) {
  const higherClientVersion = `${physical}-000060-device0`;
  const lowerClientVersion = `${physical}-000060-device-a`;

  await sql(database, `
    set role anon;
    insert into public.expenses (
      id, category, item, currency, amount, payer, status, mutation_version
    ) values (
      'collation-high-${phase}', 'dining', 'Higher client id', 'AUD', 1, 'us', 'confirmed',
      ${literal(higherClientVersion)}
    )
  `);
  await expectSqlFailure(database, `
    set role anon;
    update public.expenses
    set item = 'Must stay stale', mutation_version = ${literal(lowerClientVersion)}
    where id = 'collation-high-${phase}'
  `, /stale_mutation_version/);

  await sql(database, `
    set role anon;
    insert into public.expenses (
      id, category, item, currency, amount, payer, status, mutation_version
    ) values (
      'collation-low-${phase}', 'dining', 'Lower client id', 'AUD', 1, 'us', 'confirmed',
      ${literal(lowerClientVersion)}
    );
    update public.expenses
    set item = 'Higher client wins', mutation_version = ${literal(higherClientVersion)}
    where id = 'collation-low-${phase}'
  `);
  assert.equal(
    await scalar(database, `select mutation_version from public.expenses where id = 'collation-low-${phase}'`),
    higherClientVersion,
  );
}

async function assertInvalidPayloadsRejected(database, phase, physical) {
  const invalidActivity = operationPayload({
    phase,
    expenseId: `invalid-activity-${phase}`,
    opId: `op-${phase}-invalid-activity`,
    mutationVersion: `${physical}-000040-service`,
    activityId: `activity-${phase}-invalid`,
    item: "Invalid activity",
    action: "add",
  });
  delete invalidActivity.activity.action;
  await expectOperationFailure(database, invalidActivity, /invalid_activity_payload/);

  const invalidExpense = operationPayload({
    phase,
    expenseId: `invalid-expense-${phase}`,
    opId: `op-${phase}-invalid-expense`,
    mutationVersion: `${physical}-000041-service`,
    activityId: `activity-${phase}-invalid-expense`,
    item: "Invalid expense",
    action: "add",
  });
  delete invalidExpense.expense.currency;
  await expectOperationFailure(database, invalidExpense, /invalid_expense_payload/);
}

async function assertOperationShapeAndActivityValidation(database, phase, physical) {
  const invalidUpserts = [
    {
      label: "expense-id",
      expected: /invalid_expense_payload/,
      mutate: (operation) => { operation.expense.id = `${operation.expenseId}-other`; },
    },
    {
      label: "activity-expense-id",
      expected: /invalid_activity_payload/,
      mutate: (operation) => { operation.activity.expenseId = `${operation.expenseId}-other`; },
    },
    {
      label: "action",
      expected: /invalid_activity_payload/,
      mutate: (operation) => { operation.activity.action = "delete"; },
    },
    {
      label: "item",
      expected: /invalid_activity_payload/,
      mutate: (operation) => { operation.activity.item = "Wrong item"; },
    },
    {
      label: "amount",
      expected: /invalid_activity_payload/,
      mutate: (operation) => { operation.activity.amount = 999; },
    },
    {
      label: "currency",
      expected: /invalid_activity_payload/,
      mutate: (operation) => { operation.activity.currency = "CNY"; },
    },
  ];

  for (const [index, testCase] of invalidUpserts.entries()) {
    const expenseId = `shape-${phase}-${testCase.label}`;
    const opId = `op-${phase}-shape-${testCase.label}`;
    const operation = operationPayload({
      phase,
      expenseId,
      opId,
      mutationVersion: `${physical}-${String(140 + index).padStart(6, "0")}-service`,
      activityId: `activity-${phase}-shape-${testCase.label}`,
      item: "Shape validation",
      action: "add",
    });
    testCase.mutate(operation);
    await expectOperationFailure(database, operation, testCase.expected);
    assert.equal(await scalar(database, `select count(*) from public.expenses where id = ${literal(expenseId)}`), "0");
    assert.equal(await scalar(database, `select count(*) from app_private.expense_operations where op_id = ${literal(opId)}`), "0");
  }

  const deleteExpenseId = `delete-validation-${phase}`;
  const deleteVersion = `${physical}-000150-device-a`;
  await sql(database, `
    set role anon;
    insert into public.expenses (
      id, category, item, currency, amount, payer, status, mutation_version
    ) values (
      ${literal(deleteExpenseId)}, 'dining', 'Delete target', 'AUD', 22.50, 'us', 'confirmed',
      ${literal(deleteVersion)}
    )
  `);

  const invalidDeletes = [
    ["action", (operation) => { operation.activity.action = "edit"; }],
    ["item", (operation) => { operation.activity.item = "Wrong item"; }],
    ["amount", (operation) => { operation.activity.amount = 23; }],
    ["currency", (operation) => { operation.activity.currency = "CNY"; }],
  ];
  for (const [index, [label, mutate]] of invalidDeletes.entries()) {
    const opId = `op-${phase}-delete-${label}`;
    const operation = operationPayload({
      phase,
      expenseId: deleteExpenseId,
      opId,
      mutationVersion: `${physical}-${String(151 + index).padStart(6, "0")}-service`,
      activityId: `activity-${phase}-delete-${label}`,
      item: "Delete target",
      action: "delete",
      type: "delete",
    });
    operation.activity.amount = 22.5;
    mutate(operation);
    await expectOperationFailure(database, operation, /invalid_activity_payload/);
    assert.equal(await scalar(database, `select count(*) from app_private.expense_operations where op_id = ${literal(opId)}`), "0");
  }
  assert.equal(
    await scalar(database, `
      select item || '|' || amount || '|' || currency || '|' || mutation_version || '|' || (deleted_at is null)
      from public.expenses
      where id = ${literal(deleteExpenseId)}
    `),
    `Delete target|22.50|AUD|${deleteVersion}|true`,
  );
}

async function assertActivityConflictRollsBack(database, phase, physical) {
  const expenseId = `activity-conflict-${phase}`;
  const activityId = `activity-${phase}-occupied`;
  const opId = `op-${phase}-activity-conflict`;
  const originalVersion = `${physical}-000070-device-a`;

  await sql(database, `
    set role anon;
    insert into public.expenses (
      id, category, item, currency, amount, payer, status, mutation_version
    ) values (
      ${literal(expenseId)}, 'dining', 'Original item', 'AUD', 10, 'us', 'confirmed',
      ${literal(originalVersion)}
    )
  `);
  await sql(database, `
    set role service_role;
    insert into public.expense_activity (
      id, expense_id, action, item, amount, currency, summary
    ) values (
      ${literal(activityId)}, ${literal(expenseId)}, 'add', 'Occupied activity',
      10, 'AUD', 'Pre-existing activity'
    )
  `);

  const operation = operationPayload({
    phase,
    expenseId,
    opId,
    mutationVersion: `${physical}-000071-service`,
    activityId,
    item: "Must roll back",
    action: "edit",
  });
  await expectOperationFailure(database, operation, /activity_id_conflict/);

  assert.equal(
    await scalar(database, `
      select item || '|' || mutation_version
      from public.expenses
      where id = ${literal(expenseId)}
    `),
    `Original item|${originalVersion}`,
  );
  assert.equal(
    await scalar(database, `select count(*) from app_private.expense_operations where op_id = ${literal(opId)}`),
    "0",
  );
  assert.equal(
    await scalar(database, `select count(*) from public.expense_activity where id = ${literal(activityId)}`),
    "1",
  );
}

async function assertConcurrentOperationDeduplication(database, phase, physical) {
  const expenseId = `concurrent-${phase}`;
  const operation = operationPayload({
    phase,
    expenseId,
    opId: `op-${phase}-concurrent`,
    mutationVersion: `${physical}-000030-service`,
    activityId: `activity-${phase}-concurrent`,
    item: "Concurrent dinner",
    action: "add",
  });
  const results = await Promise.all([
    applyOperation(database, operation),
    applyOperation(database, operation),
  ]);
  assert.deepEqual(results.map(({ status }) => status), ["applied", "applied"]);
  assert.equal(
    await scalar(database, `select count(*) from public.expense_activity where id = 'activity-${phase}-concurrent'`),
    "1",
  );
  assert.equal(
    await scalar(database, `
      select count(*)
      from app_private.expense_operations
      where op_id = 'op-${phase}-concurrent'
        and result_status = 'applied'
    `),
    "1",
  );
}

async function assertDirectUpsertRpcRace(database, phase, physical) {
  const expenseId = `direct-rpc-race-${phase}`;
  const directVersion = `${physical}-000160-direct-client`;
  const rpcVersion = `${physical}-000161-service`;
  const operation = operationPayload({
    phase,
    expenseId,
    opId: `op-${phase}-direct-rpc-race`,
    mutationVersion: rpcVersion,
    activityId: `activity-${phase}-direct-rpc-race`,
    item: "RPC winner",
    action: "edit",
  });

  const directWrite = sql(database, `
    begin;
    set role anon;
    insert into public.expenses (
      id, category, item, currency, amount, payer, status, note, split_settled, mutation_version
    ) values (
      ${literal(expenseId)}, 'dining', 'Direct insert', 'AUD', 12, 'us', 'confirmed',
      'Direct writer', false, ${literal(directVersion)}
    )
    on conflict (id) do update
    set
      category = excluded.category,
      item = excluded.item,
      currency = excluded.currency,
      amount = excluded.amount,
      payer = excluded.payer,
      status = excluded.status,
      note = excluded.note,
      split_settled = excluded.split_settled,
      mutation_version = excluded.mutation_version;
    select pg_catalog.pg_sleep(0.4);
    commit;
  `);
  await delay(75);
  const rpcWrite = applyOperation(database, operation);
  const [directResult, rpcResult] = await Promise.allSettled([directWrite, rpcWrite]);

  for (const result of [directResult, rpcResult]) {
    if (result.status === "rejected") {
      assert.doesNotMatch(databaseError(result.reason), /23505|duplicate key/i);
    }
  }
  assert.equal(directResult.status, "fulfilled", databaseError(directResult.reason));
  assert.equal(rpcResult.status, "fulfilled", databaseError(rpcResult.reason));
  assert.deepEqual(rpcResult.value, {
    opId: `op-${phase}-direct-rpc-race`,
    status: "applied",
  });
  assert.equal(
    await scalar(database, `select item || '|' || mutation_version from public.expenses where id = ${literal(expenseId)}`),
    `RPC winner|${rpcVersion}`,
  );
  assert.equal(
    await scalar(database, `select count(*) from public.expense_activity where id = 'activity-${phase}-direct-rpc-race'`),
    "1",
  );
  assert.equal(
    await scalar(database, `
      select count(*)
      from app_private.expense_operations
      where op_id = 'op-${phase}-direct-rpc-race'
        and result_status = 'applied'
    `),
    "1",
  );
}

async function assertThrottling(database, phase) {
  const sequentialHash = phase === "initial" ? "a".repeat(64) : "b".repeat(64);
  const attempts = [];
  for (let index = 0; index < 6; index += 1) {
    attempts.push(await serviceJson(database, `public.consume_access_attempt(${literal(sequentialHash)})`));
  }
  assert.deepEqual(attempts.map(({ allowed }) => allowed), [true, true, true, true, true, false]);
  assert.deepEqual(attempts.map(({ remaining }) => remaining), [4, 3, 2, 1, 0, 0]);
  assert.deepEqual(attempts.slice(0, 5).map(({ blockedUntil }) => blockedUntil), [null, null, null, null, null]);
  assert.ok(attempts[5].blockedUntil);

  assert.deepEqual(await serviceJson(database, `public.reset_access_attempt(${literal(sequentialHash)})`), {
    allowed: true,
    remaining: 5,
    blockedUntil: null,
  });
  assert.equal(
    await scalar(database, `select count(*) from app_private.access_attempts where address_hash = ${literal(sequentialHash)}`),
    "0",
  );

  const concurrentHash = phase === "initial" ? "c".repeat(64) : "d".repeat(64);
  const concurrentAttempts = await Promise.all(
    Array.from({ length: 6 }, () => serviceJson(database, `public.consume_access_attempt(${literal(concurrentHash)})`)),
  );
  assert.deepEqual(concurrentAttempts.map(({ remaining }) => remaining).sort((left, right) => left - right), [0, 0, 1, 2, 3, 4]);
  assert.equal(concurrentAttempts.filter(({ allowed }) => allowed).length, 5);
  assert.equal(concurrentAttempts.filter(({ allowed }) => !allowed).length, 1);
  assert.equal(
    (await serviceJson(database, `public.consume_access_attempt(${literal(concurrentHash)})`)).allowed,
    false,
  );
  assert.equal(
    await scalar(database, `select attempt_count from app_private.access_attempts where address_hash = ${literal(concurrentHash)}`),
    "6",
  );
}

function operationPayload({
  phase,
  expenseId,
  opId,
  mutationVersion,
  activityId,
  item,
  action,
  type = "upsert",
}) {
  return {
    opId,
    type,
    expenseId,
    mutationVersion,
    expense: type === "delete" ? null : {
      id: expenseId,
      category: "dining",
      item,
      date: "2026-07-10",
      currency: "AUD",
      amount: 88.25,
      payer: "them",
      status: "confirmed",
      note: `Service operation ${phase}`,
      splitSettled: true,
      attachmentName: "rpc-must-not-write.jpg",
      receiptId: "rpc-must-not-write",
    },
    activity: {
      id: activityId,
      expenseId,
      action,
      item,
      amount: 88.25,
      currency: "AUD",
      summary: `${action} ${item}`,
      createdAt: "2026-07-10T00:00:00.000Z",
    },
  };
}

async function applyOperation(database, operation) {
  return serviceJson(database, `public.apply_expense_operation(${literal(JSON.stringify(operation))}::jsonb)`);
}

async function expectOperationFailure(database, operation, expectedMessage) {
  await expectSqlFailure(
    database,
    `set role service_role; select public.apply_expense_operation(${literal(JSON.stringify(operation))}::jsonb)`,
    expectedMessage,
  );
}

async function serviceJson(database, expression) {
  return JSON.parse(await scalar(database, `set role service_role; select ${expression}`));
}

async function retainedPublicState(database) {
  return scalar(database, `
    select jsonb_build_object(
      'expenses', (select count(*) from public.expenses),
      'activities', (select count(*) from public.expense_activity),
      'attachments', (select count(*) from public.attachments),
      'tombstones', (select count(*) from public.expenses where deleted_at is not null),
      'attachmentBytes', (select coalesce(sum(size_bytes), 0) from public.attachments)
    )
  `);
}

function columnCountSql() {
  return `
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and (
        (table_name = 'expenses' and column_name in ('updated_at', 'deleted_at', 'mutation_version'))
        or
        (table_name = 'attachments' and column_name in (
          'receipt_id', 'original_name', 'mime_type', 'size_bytes', 'finalized_at', 'deleted_at'
        ))
      )
  `;
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

function cloneOperation(operation) {
  return JSON.parse(JSON.stringify(operation));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function databaseError(error) {
  return `${error?.stderr || ""}\n${error?.stdout || ""}\n${error?.message || ""}`;
}
