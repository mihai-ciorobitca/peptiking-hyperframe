import test from 'node:test'
import assert from 'node:assert/strict'
import { validatePlan, plannerPrompt } from './plan.mjs'
import { codexArguments, codexEnvironment } from './codex.mjs'
import { buildComposition } from './composition.mjs'
import { allowedMediaUrl } from './media.mjs'
import { childEnvironment, config } from './runtime.mjs'

const media = { main: { duration: 10 }, brolls: [{ duration: 3 }] }
const plan = () => ({ unsupportedReason: null, summary: 'Trim and caption', segments: [{ sourceStart: 1, sourceEnd: 8, zoom: 1.1 }], brolls: [{ index: 1, start: 2, duration: 2, sourceStart: 0.5 }], captions: [{ text: 'Hello <script>alert(1)</script>', start: 0, end: 2 }], titles: [], captionColor: '#ffffff', accentColor: '#d7af58', speechVolume: 1, musicVolume: 0.1, muteOutput: false })
test('Astra uses ChatGPT login, Low effort and a read-only structured CLI run', () => {
  const cfg = config({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test' })
  assert.equal(cfg.apiKey, undefined)
  const args = codexArguments(cfg, '/test', ['/test/image.jpg'])
  for (const value of ['gpt-6-astra', 'model_reasoning_effort="low"', 'forced_login_method="chatgpt"', 'features.shell_tool=false', 'features.apps=false', 'read-only', '--ignore-user-config', '--ephemeral', '--output-schema', '--image']) assert.ok(args.includes(value), value)
  assert.match(plannerPrompt({ instructions: 'Add captions', media, transcript: {}, previousPlan: null }), /Do not call tools/)
  assert.throws(() => config({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test', HYPERFRAMES_MODEL: 'other' }))
})
test('Codex subprocess inherits the chosen login location but no API or database secrets', () => {
  const env = codexEnvironment({ codexHome: '/chosen/.codex' }, { PATH: 'test', OPENAI_API_KEY: 'secret', CODEX_API_KEY: 'secret', SUPABASE_SERVICE_ROLE_KEY: 'secret' })
  assert.equal(env.CODEX_HOME, '/chosen/.codex')
  for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) assert.equal(env[key], undefined)
})
test('validated plan compiles source offsets and escapes all user-visible text', () => {
  const valid = validatePlan(plan(), media)
  assert.equal(valid.duration, 7)
  const html = buildComposition(valid)
  assert.match(html, /data-media-start="1"/)
  assert.match(html, /src="assets\/broll-1.mp4"/)
  assert.match(html, /&lt;script&gt;/)
  assert.doesNotMatch(html, /<script>alert/)
})
test('invalid cuts, B-roll indexes, timing, colors, gains and unsupported edits fail closed', () => {
  for (const mutate of [
    (p) => { p.segments[0].sourceEnd = 20 },
    (p) => { p.segments[0].zoom = Infinity },
    (p) => { p.brolls[0].index = 2 },
    (p) => { p.brolls[0].sourceStart = 2 },
    (p) => { p.captions[0].end = 100 },
    (p) => { p.accentColor = 'red; background:url(https://bad.test)' },
    (p) => { p.musicVolume = 2 },
    (p) => { p.unsupportedReason = 'Voice dubbing is unavailable' },
  ]) { const value = plan(); mutate(value); assert.throws(() => validatePlan(value, media)) }
})
test('mute omits music and makes every video silent', () => {
  const value = validatePlan({ ...plan(), muteOutput: true }, media)
  const html = buildComposition(value, { hasMusic: true })
  assert.doesNotMatch(html, /<audio|data-has-audio="true"/)
})
test('media downloads only permit explicit HTTPS source hosts', () => {
  const hosts = new Set(['example.supabase.co'])
  assert.equal(allowedMediaUrl('https://example.supabase.co/video.mp4', hosts).hostname, 'example.supabase.co')
  for (const url of ['http://example.supabase.co/x', 'https://example.supabase.co.evil.test/x', 'https://user:pass@example.supabase.co/x', 'https://127.0.0.1/x', 'https://example.supabase.co:444/x']) assert.throws(() => allowedMediaUrl(url, hosts))
})
test('renderer subprocesses never inherit API keys or Supabase credentials', () => {
  const env = childEnvironment({ PATH: 'runtime', SUPABASE_SERVICE_ROLE_KEY: 'secret', OPENAI_API_KEY: 'secret', BORUMI_BRIDGE_TOKEN: 'secret' })
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, undefined)
  assert.equal(env.OPENAI_API_KEY, undefined)
  assert.equal(env.BORUMI_BRIDGE_TOKEN, undefined)
})
