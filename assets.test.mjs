import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile } from 'node:fs/promises'
import { validateAssetPlan, planAssets } from './asset-plan.mjs'
import { generateScenes, loadFlowConnection } from './flow.mjs'
import { PGlite } from '@electric-sql/pglite'
import { validTrackUrl } from './pixabay.mjs'

const scene = { title: 'Fashion detail', prompt: 'Cinematic silk fabric moving in warm studio light', durationSeconds: 4 }
const context = { brollCount: 0, hasMusic: false, muteOutput: false, projectDir: '/test', isRevision: false }
test('Flow connection is available only to the trusted worker role', async () => {
  const db = new PGlite()
  try {
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA vault; CREATE TABLE vault.decrypted_secrets(name text, decrypted_secret text); INSERT INTO vault.decrypted_secrets VALUES ('peptiking_hyperframes_flow', '{\"url\":\"https://flow.example.test\",\"key\":\"test\"}');")
    await db.exec(await readFile(new URL('./asset-connection.sql', import.meta.url), 'utf8'))
    const result = await db.query("SELECT has_function_privilege('anon','public.get_hyperframes_flow_connection()','EXECUTE') AS anon, has_function_privilege('authenticated','public.get_hyperframes_flow_connection()','EXECUTE') AS member, has_function_privilege('service_role','public.get_hyperframes_flow_connection()','EXECUTE') AS worker")
    assert.deepEqual(result.rows[0], { anon: false, member: false, worker: true })
    await db.exec('SET ROLE service_role')
    assert.equal((await db.query('SELECT public.get_hyperframes_flow_connection() AS connection')).rows[0].connection.url, 'https://flow.example.test')
  } finally { await db.close() }
})
test('worker loads the stored connection without mutating config or exposing it to prompts', async () => {
  const cfg = { supabaseUrl: 'https://example.supabase.co', serviceRoleKey: 'test' }
  const loaded = await loadFlowConnection(cfg, undefined, async () => ({ ok: true, json: async () => ({ url: 'https://flow.example.test/', key: 'test-key' }) }))
  assert.equal(loaded.flowUrl, 'https://flow.example.test')
  assert.equal(cfg.flowKey, undefined)
  await assert.rejects(loadFlowConnection(cfg, undefined, async () => ({ ok: false })), /not installed/)
})
test('asset plan caps generation and never acquires duplicate or muted music', () => {
  const value = { scenes: [scene], music: true, musicBrief: 'Quiet instrumental fashion' }
  assert.equal(validateAssetPlan(value, context).music, true)
  assert.equal(validateAssetPlan(value, { ...context, hasMusic: true }).music, false)
  assert.equal(validateAssetPlan(value, { ...context, muteOutput: true }).music, false)
  assert.throws(() => validateAssetPlan({ ...value, scenes: Array(4).fill(scene) }, context))
  assert.throws(() => validateAssetPlan(value, { ...context, brollCount: 20 }))
  assert.throws(() => validateAssetPlan({ ...value, scenes: [{ ...scene, durationSeconds: 9 }] }, context))
})
test('asset planner preserves explicit opt-outs and revision context in instructions', async () => {
  let prompt
  await planAssets({ ...context, instructions: 'No music or new footage', isRevision: true }, {}, undefined,
    async input => { prompt = input.prompt; return { scenes: [], music: false, musicBrief: '' } })
  assert.match(prompt, /no music, no new footage/)
  assert.match(prompt, /"isRevision":true/)
})
test('Flow adapter respects quota, maps generation output and persists provenance', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hyperframes-assets-'))
  const file = path.join(dir, 'flow.json')
  const routes = []
  const result = await generateScenes([scene], { email: 'test@example.test', projectId: 'project' }, {}, AbortSignal.timeout(5000), async () => {}, file,
    async (cfg, route, body) => {
      routes.push(route)
      if (route.endsWith('generation-quota')) return { dailyQuota: { remaining: 3 } }
      if (route === '/v1/generate') { assert.equal(body.count, 1); assert.equal(body.aspectRatio, '9:16'); return { jobs: [{ jobId: 'video-job' }] } }
      if (route === '/v1/jobs/video-job') return { status: 'done', result: { mediaType: 'video' } }
      return { executions: [{ job_id: 'video-job', media_url: 'https://labs.google/video' }] }
    })
  assert.equal(result[0].url, 'https://labs.google/video')
  assert.equal(JSON.parse(await readFile(file, 'utf8'))[0].status, 'done')
  assert.equal(routes.filter(route => route === '/v1/generate').length, 1)
})
test('Flow does not submit when quota is exhausted and cancels a known failed generation', async () => {
  let submitted = false
  await assert.rejects(generateScenes([scene], { email: 'test', projectId: 'p' }, {}, AbortSignal.timeout(5000), async () => {}, '/unused', async (cfg, route) => {
    if (route.endsWith('generation-quota')) return { dailyQuota: { remaining: 0 } }
    submitted = true
  }), /allowance/)
  assert.equal(submitted, false)
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hyperframes-cancel-'))
  let cancelled = false
  await assert.rejects(generateScenes([scene], { email: 'test', projectId: 'p' }, {}, AbortSignal.timeout(5000), async () => {}, path.join(dir,'flow.json'), async (cfg, route) => {
    if (route.endsWith('generation-quota')) return { dailyQuota: { remaining: 2 } }
    if (route === '/v1/generate') return { jobId: 'job' }
    if (route.endsWith('/cancel')) { cancelled = true; return {} }
    return { status: 'failed', error: 'Provider failed' }
  }), /Provider failed/)
  assert.equal(cancelled, true)
})
test('music selection permits real Pixabay track pages only', () => {
  assert.equal(validTrackUrl('https://pixabay.com/music/soft-house-fashion-507165/'), true)
  for (const url of ['https://evil.test/music/track-123/', 'https://pixabay.com/music/search/fashion/', 'https://pixabay.com@evil.test/music/track-123/', 'https://pixabay.com/music/track-123/?next=evil']) assert.equal(validTrackUrl(url), false)
})
