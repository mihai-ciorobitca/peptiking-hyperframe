import test from 'node:test'
import assert from 'node:assert/strict'
import { createLogger, safeLogText } from './logging.mjs'

test('every job log identifies the owner, operation, attempt and elapsed time', () => {
  let time = 0
  const lines = []
  const log = createLogger({ workerId: 'worker' }, { user_email: 'test@example.com', user_id: 'user1', job_id: 'job1', operation: 'EDIT_VIDEO', attempts: 2 }, { now: () => time, sink: line => lines.push(line) })
  log.emit('claimed')
  log.progress('render', 'Rendering', 65)
  time = 29000
  log.progress('render', 'Rendering', 65)
  assert.equal(lines.length, 2)
  time = 30000
  log.progress('render', 'Rendering', 65)
  log.progress('upload', 'Uploading', 92)
  log.emit('completed')
  assert.equal(lines.length, 5)
  for (const line of lines) {
    assert.match(line, /user="test@example.com" userId=user1 job=job1 operation=EDIT_VIDEO attempt=2/)
  }
  assert.match(lines[2], /elapsed=30s/)
  assert.match(lines[4], /status=completed/)
})

test('logs redact configured credentials, signed URLs, tokens and terminal controls', () => {
  const text = safeLogText('\x1b[31mError\nsecret-value https://host/video?token=private Bearer abcdef sk-example', ['secret-value'])
  assert.equal(text, 'Error [redacted] [url] [redacted] [redacted]')
})
