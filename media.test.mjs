import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, access } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { config } from './runtime.mjs'
import { downloadMedia } from './media.mjs'

const env = { SUPABASE_URL: 'https://example.com', SUPABASE_SERVICE_ROLE_KEY: 'test' }
test('source limit defaults to website limit and validates overrides', () => {
  assert.equal(config(env).maxSourceBytes, 2 * 1024 ** 3)
  assert.equal(config({ ...env, HYPERFRAMES_MAX_SOURCE_MB: '4096' }).maxSourceBytes, 4 * 1024 ** 3)
  for (const value of ['0', '-1', 'NaN', 'Infinity', '1.5', '20481']) assert.throws(() => config({ ...env, HYPERFRAMES_MAX_SOURCE_MB: value }), /HYPERFRAMES_MAX_SOURCE_MB/)
})

test('a declared source over the old 500 MiB cap is accepted by the new default', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hyperframes-download-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  t.mock.method(globalThis, 'fetch', async () => new Response('fixture', { headers: { 'content-length': String(600 * 1024 ** 2) } }))
  const file = path.join(dir, 'video.mp4')
  await downloadMedia('https://example.com/video', file, config(env), new AbortController().signal)
  assert.equal(await readFile(file, 'utf8'), 'fixture')
})

test('oversize headers report size and limit before creating a file', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hyperframes-download-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  t.mock.method(globalThis, 'fetch', async () => new Response('fixture', { headers: { 'content-length': String(3 * 1024 ** 3) } }))
  const file = path.join(dir, 'video.mp4')
  await assert.rejects(downloadMedia('https://example.com/video', file, config(env), new AbortController().signal), /3072.0 MiB; limit 2048.0 MiB/)
  await assert.rejects(access(file))
})

test('stream limit rejects missing or understated headers and deletes partial files', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hyperframes-download-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  for (const headers of [{}, { 'content-length': '1' }]) {
    t.mock.method(globalThis, 'fetch', async () => new Response('too many bytes', { headers }))
    const file = path.join(dir, 'video.mp4')
    await assert.rejects(downloadMedia('https://example.com/video', file, config(env), new AbortController().signal, 4), /Source file is too large/)
    await assert.rejects(access(file))
  }
})
