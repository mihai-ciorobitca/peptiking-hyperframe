import test from 'node:test'
import assert from 'node:assert/strict'
import { handleJob } from './worker.mjs'

test('job failure remains visible when the database cannot record it', async t => {
  const lines = []
  t.mock.method(console, 'log', line => lines.push(line))
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.endsWith('/update_borumi_video_edit_job_progress')) return Response.json(true)
    return new Response('', { status: 503 })
  })
  const result = await handleJob({ job_id: 'job1', user_id: 'user1', user_email: 'test@example.com', operation: 'INVALID', attempts: 1 }, { supabaseUrl: 'https://example.com', serviceRoleKey: 'secret', workerId: 'worker' }, new AbortController().signal)
  assert.equal(result, false)
  assert.ok(lines.some(line => line.includes('status=failed')))
  assert.ok(lines.some(line => line.includes('status=failure-update-error')))
  assert.ok(lines.every(line => line.includes('user="test@example.com"')))
  assert.ok(lines.every(line => !line.includes('status=completed')))
})

test('rejected lease progress reports abort and rejected failure update', async t => {
  const lines = []
  t.mock.method(console, 'log', line => lines.push(line))
  t.mock.method(globalThis, 'fetch', async () => Response.json(false))
  await handleJob({ job_id: 'job2', user_id: 'user2', operation: 'EDIT_VIDEO', attempts: 1 }, { supabaseUrl: 'https://example.com', serviceRoleKey: 'secret', workerId: 'worker' }, new AbortController().signal)
  assert.ok(lines.some(line => line.includes('status=aborted')))
  assert.ok(lines.some(line => line.includes('status=failure-update-rejected')))
  assert.ok(lines.every(line => !line.includes('status=completed')))
})
