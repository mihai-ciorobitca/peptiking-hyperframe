import { config, hyperframes, run, ffmpeg, ffprobePath } from './runtime.mjs'
import { verifyCodexLogin } from './codex.mjs'

const failures = []
async function check(label, fn) {
  try { await fn(); console.log(`PASS ${label}`) }
  catch (error) { failures.push(label); console.error(`FAIL ${label}: ${error.message}`) }
}
await check('Node.js 22+', async () => { if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Install Node.js 22 or newer.') })
await check('Bundled FFmpeg', () => run(ffmpeg, ['-version']))
await check('Bundled FFprobe', () => run(ffprobePath, ['-version']))
await check('HyperFrames CLI', () => hyperframes(['--version']))
let cfg
await check('Worker configuration', async () => { cfg = config() })
if (cfg) {
  await check('Codex ChatGPT login (no API key)', () => verifyCodexLogin(cfg, AbortSignal.timeout(15000)))
  await check('Local speech transcription', () => run(cfg.python, ['-c', 'from faster_whisper import WhisperModel; print("ready")']))
  await check('Supabase queue migration (read-only)', async () => {
    const response = await fetch(`${cfg.supabaseUrl}/rest/v1/`, { headers: { apikey: cfg.serviceRoleKey, Authorization: `Bearer ${cfg.serviceRoleKey}`, Accept: 'application/openapi+json' }, signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error(`Supabase returned ${response.status}.`)
    const schema = await response.json()
    if (!schema.paths?.['/rpc/claim_hyperframes_video_edit_job']) throw new Error('Apply the HyperFrames migration to this Supabase project first.')
  })
  await check('Export bucket', async () => {
    const response = await fetch(`${cfg.supabaseUrl}/storage/v1/bucket/${encodeURIComponent(cfg.bucket)}`, { headers: { apikey: cfg.serviceRoleKey, Authorization: `Bearer ${cfg.serviceRoleKey}` }, signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error(`Bucket ${cfg.bucket} could not be read (${response.status}).`)
    const bucket = await response.json()
    if (!bucket.public) throw new Error('Use the existing public video-export bucket configured on the website.')
  })
}
console.log('Run npm run smoke for local rendering. Run npm run smoke:codex to verify Astra/Low with your ChatGPT login (uses Codex limits, no queue jobs or uploads).')
process.exitCode = failures.length ? 1 : 0
