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

it("enforces private receipt metadata and claims only eligible cleanup work", {
  skip: missingDatabaseEnv.length > 0
    ? `set ${missingDatabaseEnv.join(", ")} to run the PostgreSQL integration test`
    : false,
  timeout: 120_000,
}, async () => {
  const database = `aussie_receipts_${process.pid}_${Date.now()}`;

  await adminSql(`create database ${quoteIdentifier(database)} template template0`);
  try {
    await runFile(database, "tests/fixtures/supabase-compatibility-base.sql");
    await runFile(database, "supabase/migrations/20260710035744_shared_ledger_compatibility.sql");
    await sql(database, `
      create schema storage;
      create table storage.buckets (
        id text primary key,
        name text not null,
        public boolean not null default false,
        file_size_limit bigint,
        allowed_mime_types text[]
      )
    `);
    await runFile(database, "supabase/migrations/20260710140534_private_receipts.sql");
    await runFile(database, "supabase/migrations/20260710140534_private_receipts.sql");

    assert.equal(
      await scalar(database, `
        select public || '|' || file_size_limit || '|' || array_to_string(allowed_mime_types, ',')
        from storage.buckets
        where id = 'receipts'
      `),
      "false|10485760|image/jpeg,image/png,image/heic,image/heif,image/webp",
    );
    assert.equal(
      await scalar(database, `
        select has_function_privilege('service_role', 'public.claim_receipt_cleanup(text,integer)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.claim_receipt_cleanup(text,integer)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.claim_receipt_cleanup(text,integer)', 'EXECUTE')
      `),
      "t",
    );
    assert.equal(
      await scalar(database, `
        select has_function_privilege('service_role', 'public.create_receipt_upload_intent(jsonb)', 'EXECUTE')
          and has_function_privilege('service_role', 'public.finalize_receipt_upload(text,text)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.create_receipt_upload_intent(jsonb)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.finalize_receipt_upload(text,text)', 'EXECUTE')
      `),
      "t",
    );

    await insertExpense(database, "rpc-expense");
    const rpcReceipt = {
      expenseId: "rpc-expense",
      receiptId: "rpc-receipt",
      originalName: "RPC.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 2048,
      storagePath: "rpc-expense/rpc-receipt-rpc.jpg",
    };
    const createdIntent = JSON.parse(await scalar(database, `
      set role service_role;
      select public.create_receipt_upload_intent(${literal(JSON.stringify(rpcReceipt))}::jsonb)
    `));
    assert.equal(createdIntent.receipt_id, "rpc-receipt");
    assert.equal(createdIntent.finalized_at, null);
    assert.deepEqual(
      JSON.parse(await scalar(database, `
        set role service_role;
        select public.create_receipt_upload_intent(${literal(JSON.stringify(rpcReceipt))}::jsonb)
      `)),
      createdIntent,
    );
    await expectSqlFailure(database, `
      set role service_role;
      select public.create_receipt_upload_intent(${literal(JSON.stringify({
        ...rpcReceipt,
        receiptId: "rpc-receipt-other",
        storagePath: "rpc-expense/rpc-receipt-other-rpc.jpg",
      }))}::jsonb)
    `, /receipt_conflict/);
    const finalizedIntent = JSON.parse(await scalar(database, `
      set role service_role;
      select public.finalize_receipt_upload('rpc-expense', 'rpc-receipt')
    `));
    assert.ok(finalizedIntent.finalized_at);
    assert.deepEqual(
      JSON.parse(await scalar(database, `
        set role service_role;
        select public.finalize_receipt_upload('rpc-expense', 'rpc-receipt')
      `)),
      finalizedIntent,
    );

    await insertExpense(database, "rpc-deleted", "pg_catalog.now() - interval '1 day'");
    await expectSqlFailure(database, `
      set role service_role;
      select public.create_receipt_upload_intent(${literal(JSON.stringify({
        ...rpcReceipt,
        expenseId: "rpc-deleted",
        receiptId: "rpc-deleted-receipt",
        storagePath: "rpc-deleted/rpc-deleted-receipt-rpc.jpg",
      }))}::jsonb)
    `, /receipt_expense_unavailable/);

    await insertExpense(database, "active-expense");
    await insertAttachment(database, {
      id: "00000000-0000-0000-0000-000000000001",
      expenseId: "active-expense",
      receiptId: "receipt-active",
      createdAt: "pg_catalog.now() - interval '2 days'",
    });
    await expectSqlFailure(database, `
      insert into public.attachments (
        id, expense_id, receipt_id, original_name, mime_type, size_bytes, storage_path
      ) values (
        '00000000-0000-0000-0000-000000000002', 'active-expense', 'receipt-second',
        'second.png', 'image/png', 2, 'active-expense/receipt-second-second.png'
      )
    `, /attachments_active_expense_unique/);

    await insertExpense(database, "invalid-expense");
    await expectSqlFailure(database, invalidAttachmentSql({
      id: "00000000-0000-0000-0000-000000000003",
      expenseId: "invalid-expense",
      receiptId: "receipt-pdf",
      originalName: "receipt.pdf",
      mimeType: "application/pdf",
      sizeBytes: 500,
      storagePath: "invalid-expense/receipt-pdf-receipt.pdf",
    }), /attachments_receipt_metadata_check/);
    await expectSqlFailure(database, invalidAttachmentSql({
      id: "00000000-0000-0000-0000-000000000004",
      expenseId: "invalid-expense",
      receiptId: "receipt-large",
      originalName: "large.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 10485761,
      storagePath: "invalid-expense/receipt-large-large.jpg",
    }), /attachments_(?:size_bytes|receipt_metadata)_check/);
    await expectSqlFailure(database, invalidAttachmentSql({
      id: "00000000-0000-0000-0000-000000000005",
      expenseId: "invalid-expense",
      receiptId: "receipt-path",
      originalName: "path.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 500,
      storagePath: "../path.jpg",
    }), /attachments_receipt_metadata_check/);

    await insertExpense(database, "recent-expense");
    await insertAttachment(database, {
      id: "00000000-0000-0000-0000-000000000006",
      expenseId: "recent-expense",
      receiptId: "receipt-recent",
      createdAt: "pg_catalog.now() - interval '1 hour'",
    });
    await insertExpense(database, "finalized-active");
    await insertAttachment(database, {
      id: "00000000-0000-0000-0000-000000000007",
      expenseId: "finalized-active",
      receiptId: "receipt-finalized-active",
      finalizedAt: "pg_catalog.now() - interval '10 days'",
      createdAt: "pg_catalog.now() - interval '11 days'",
    });
    await insertExpense(database, "old-tombstone", "pg_catalog.now() - interval '8 days'");
    await insertAttachment(database, {
      id: "00000000-0000-0000-0000-000000000008",
      expenseId: "old-tombstone",
      receiptId: "receipt-old-tombstone",
      finalizedAt: "pg_catalog.now() - interval '9 days'",
      createdAt: "pg_catalog.now() - interval '10 days'",
    });
    await insertExpense(database, "restored-expense", "pg_catalog.now() - interval '8 days'");
    await insertAttachment(database, {
      id: "00000000-0000-0000-0000-000000000009",
      expenseId: "restored-expense",
      receiptId: "receipt-restored",
      finalizedAt: "pg_catalog.now() - interval '9 days'",
      createdAt: "pg_catalog.now() - interval '10 days'",
    });
    await sql(database, `
      update public.expenses
      set deleted_at = null,
          mutation_version = mutationVersion(1)
      where id = 'restored-expense'
    `.replace("mutationVersion(1)", versionSql(1)));
    await insertExpense(database, "claimed-then-restored", "pg_catalog.now() - interval '8 days'");
    await insertAttachment(database, {
      id: "00000000-0000-0000-0000-000000000010",
      expenseId: "claimed-then-restored",
      receiptId: "receipt-claimed-then-restored",
      finalizedAt: "pg_catalog.now() - interval '9 days'",
      createdAt: "pg_catalog.now() - interval '10 days'",
    });

    assert.deepEqual(
      JSON.parse(await scalar(database, `
        set role service_role;
        select coalesce(jsonb_agg(jsonb_build_object(
          'receiptId', receipt_id,
          'reason', cleanup_reason
        ) order by receipt_id), '[]'::jsonb)
        from public.claim_receipt_cleanup('cleanup-worker-1', 25)
      `)),
      [
        { receiptId: "receipt-active", reason: "pending" },
        { receiptId: "receipt-claimed-then-restored", reason: "tombstoned" },
        { receiptId: "receipt-old-tombstone", reason: "tombstoned" },
      ],
    );

    const verifiedPending = JSON.parse(await scalar(database, `
      set role service_role;
      select public.verify_receipt_cleanup_claim(
        '00000000-0000-0000-0000-000000000001',
        'cleanup-worker-1'
      )
    `));
    assert.equal(verifiedPending.receipt_id, "receipt-active");
    await expectSqlFailure(database, `
      set role service_role;
      select public.finalize_receipt_upload('active-expense', 'receipt-active')
    `, /receipt_cleanup_in_progress/);
    assert.equal(await scalar(database, `
      set role service_role;
      select public.finish_receipt_cleanup_claim(
        '00000000-0000-0000-0000-000000000001',
        'cleanup-worker-1',
        true
      )
    `), "t");
    assert.equal(await scalar(database, `
      select deleted_at is not null
        and cleanup_claim_token is null
      from public.attachments
      where id = '00000000-0000-0000-0000-000000000001'
    `), "t");
    const resurrectedPending = JSON.parse(await scalar(database, `
      set role service_role;
      select public.create_receipt_upload_intent(${literal(JSON.stringify({
        expenseId: "active-expense",
        receiptId: "receipt-active",
        originalName: "receipt-active.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 1024,
        storagePath: "active-expense/receipt-active-receipt-active.jpg",
      }))}::jsonb)
    `));
    assert.equal(resurrectedPending.id, "00000000-0000-0000-0000-000000000001");
    assert.equal(resurrectedPending.deleted_at, null);
    assert.equal(resurrectedPending.finalized_at, null);

    const verifiedTombstone = JSON.parse(await scalar(database, `
      set role service_role;
      select public.verify_receipt_cleanup_claim(
        '00000000-0000-0000-0000-000000000008',
        'cleanup-worker-1'
      )
    `));
    assert.equal(verifiedTombstone.receipt_id, "receipt-old-tombstone");
    assert.equal(await scalar(database, `
      set role service_role;
      select public.finish_receipt_cleanup_claim(
        '00000000-0000-0000-0000-000000000008',
        'cleanup-worker-1',
        true
      )
    `), "t");
    assert.equal(await scalar(database, `
      select deleted_at is not null
      from public.attachments
      where id = '00000000-0000-0000-0000-000000000008'
    `), "t");

    await expectSqlFailure(database, `
      update public.expenses
      set deleted_at = null,
          mutation_version = mutationVersion(2)
      where id = 'claimed-then-restored'
    `.replace("mutationVersion(2)", versionSql(2)), /receipt_cleanup_in_progress/);
    const verifiedClaimedTombstone = JSON.parse(await scalar(database, `
      set role service_role;
      select public.verify_receipt_cleanup_claim(
        '00000000-0000-0000-0000-000000000010',
        'cleanup-worker-1'
      )
    `));
    assert.equal(verifiedClaimedTombstone.receipt_id, "receipt-claimed-then-restored");
    assert.equal(await scalar(database, `
      set role service_role;
      select public.finish_receipt_cleanup_claim(
        '00000000-0000-0000-0000-000000000010',
        'cleanup-worker-1',
        false
      )
    `), "t");
    await sql(database, `
      update public.expenses
      set deleted_at = null,
          mutation_version = mutationVersion(2)
      where id = 'claimed-then-restored'
    `.replace("mutationVersion(2)", versionSql(2)));
    assert.equal(await scalar(database, `
      select cleanup_claim_token is null and deleted_at is null
      from public.attachments
      where id = '00000000-0000-0000-0000-000000000010'
    `), "t");
    assert.equal(
      await scalar(database, `
        select count(*)
        from public.attachments
        where receipt_id in ('receipt-recent', 'receipt-finalized-active', 'receipt-restored')
          and cleanup_claim_token is not null
      `),
      "0",
    );

    await expectSqlFailure(database, `
      set role service_role;
      select * from public.claim_receipt_cleanup('../bad', 10)
    `, /invalid_cleanup_claim_token/);
    await expectSqlFailure(database, `
      set role service_role;
      select * from public.claim_receipt_cleanup('cleanup-worker-2', 26)
    `, /invalid_cleanup_batch_size/);
  } finally {
    await adminSql(`drop database if exists ${quoteIdentifier(database)} with (force)`);
  }
});

async function insertExpense(database, id, deletedAt = "null") {
  await sql(database, `
    insert into public.expenses (
      id, category, item, currency, amount, payer, status, mutation_version, deleted_at
    ) values (
      ${literal(id)}, 'dining', ${literal(id)}, 'AUD', 12.50, 'us', 'confirmed',
      ${versionSql(0)}, ${deletedAt}
    )
  `);
}

async function insertAttachment(database, {
  id,
  expenseId,
  receiptId,
  createdAt,
  finalizedAt = "null",
}) {
  await sql(database, `
    insert into public.attachments (
      id, expense_id, receipt_id, original_name, mime_type, size_bytes,
      storage_path, created_at, finalized_at
    ) values (
      ${literal(id)}, ${literal(expenseId)}, ${literal(receiptId)}, ${literal(`${receiptId}.jpg`)},
      'image/jpeg', 1024, ${literal(`${expenseId}/${receiptId}-${receiptId}.jpg`)},
      ${createdAt}, ${finalizedAt}
    )
  `);
}

function invalidAttachmentSql({
  id,
  expenseId,
  receiptId,
  originalName,
  mimeType,
  sizeBytes,
  storagePath,
}) {
  return `
    insert into public.attachments (
      id, expense_id, receipt_id, original_name, mime_type, size_bytes, storage_path
    ) values (
      ${literal(id)}, ${literal(expenseId)}, ${literal(receiptId)}, ${literal(originalName)},
      ${literal(mimeType)}, ${sizeBytes}, ${literal(storagePath)}
    )
  `;
}

function versionSql(counter) {
  return `lpad((floor(extract(epoch from pg_catalog.clock_timestamp()) * 1000)::bigint)::text, 13, '0') || '-${String(counter).padStart(6, "0")}-receipt-test'`;
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
