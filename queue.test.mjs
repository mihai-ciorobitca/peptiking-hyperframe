import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('PostgreSQL routes legacy and HyperFrames jobs separately and prevents duplicate claims', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE "User" (id TEXT PRIMARY KEY, email TEXT);
      CREATE TABLE "AiVideoEditJob" (
        id TEXT PRIMARY KEY, "userId" TEXT, operation TEXT, payload JSONB, status TEXT DEFAULT 'QUEUED',
        "workerId" TEXT, attempts INTEGER DEFAULT 0, "progressStage" TEXT, "progressMessage" TEXT,
        "progressPercent" INTEGER, "progressUpdatedAt" TIMESTAMP, "claimedAt" TIMESTAMP,
        "leaseExpiresAt" TIMESTAMP, "startedAt" TIMESTAMP, "updatedAt" TIMESTAMP, "createdAt" TIMESTAMP DEFAULT NOW()
      );
      INSERT INTO "User" VALUES ('u', 'test@example.test');
      INSERT INTO "AiVideoEditJob" (id, "userId", operation, payload) VALUES
        ('legacy','u','EDIT_VIDEO','{}'),
        ('borumi','u','LIST_PROJECTS','{"editor":"borumi"}'),
        ('hyper1','u','EDIT_VIDEO','{"editor":"hyperframes"}'),
        ('hyper2','u','LIST_PROJECTS','{"editor":"hyperframes"}'),
        ('unknown','u','EDIT_VIDEO','{"editor":"other"}');
    `)
    await db.exec(await readFile(new URL('./queue.sql', import.meta.url), 'utf8'))
    const claim = async (editor, worker) => (await db.query(`SELECT * FROM claim_${editor}_video_edit_job($1, 900)`, [worker])).rows
    const borumi = [...await claim('borumi', 'b1'), ...await claim('borumi', 'b2')]
    assert.deepEqual(new Set(borumi.map((job) => job.job_id)), new Set(['legacy','borumi']))
    assert.deepEqual(await claim('borumi', 'b3'), [])
    const results = await Promise.all([claim('hyperframes','h1'), claim('hyperframes','h2')])
    assert.deepEqual(new Set(results.flat().map((job) => job.job_id)), new Set(['hyper1','hyper2']))
    assert.deepEqual(await claim('hyperframes','h3'), [])
    await db.exec(`UPDATE "AiVideoEditJob" SET "leaseExpiresAt" = NOW() - INTERVAL '1 minute' WHERE id='hyper1'`)
    assert.deepEqual(await claim('borumi','b4'), [], 'Borumi cannot reclaim an expired HyperFrames lease')
    assert.equal((await claim('hyperframes','h4'))[0].attempts, 2)
    for (const role of ['anon','authenticated']) {
      const permissions = await db.query(`SELECT has_function_privilege($1, 'claim_hyperframes_video_edit_job(text,integer)', 'EXECUTE') AS allowed`, [role])
      assert.equal(permissions.rows[0].allowed, false)
    }
    assert.equal((await db.query(`SELECT has_function_privilege('service_role', 'claim_hyperframes_video_edit_job(text,integer)', 'EXECUTE') AS allowed`)).rows[0].allowed, true)
  } finally { await db.close() }
})
