import path from 'node:path'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { serviceDir, run, ffmpeg } from './runtime.mjs'
import { thumbnail } from './media.mjs'
import { requestPlan } from './plan.mjs'

// Explicit check: uses the signed-in Codex account; never touches Supabase.
const output = path.join(serviceDir, 'smoke-output')
await mkdir(output, { recursive: true })
const projectDir = await mkdtemp(path.join(output, 'codex-'))
const signal = AbortSignal.timeout(120000)
const sourceImage = path.join(projectDir, 'source.png')
await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=0x163833:size=360x640', '-frames:v', '1', sourceImage], { signal })
const image = await thumbnail(sourceImage, 0, path.join(projectDir, 'thumbnail.jpg'), signal)
const plan = await requestPlan({ projectDir,
  instructions: 'Keep the full two-second video. Add title Connection ready for the full two seconds. No captions, music or B-roll.',
  media: { main: { duration: 2, hasAudio: false }, brolls: [], music: null },
  transcript: { text: '', words: [] }, previousPlan: null,
  images: [{ label: 'Synthetic connection-test frame', url: image }],
}, { model: 'gpt-6-astra', effort: 'low', codexHome: process.env.HYPERFRAMES_CODEX_HOME || process.env.CODEX_HOME }, signal)
if (Math.abs(plan.duration - 2) > 0.05 || !plan.titles.some(title => title.text === 'Connection ready')) throw new Error('Astra returned an unexpected connection-test plan.')
console.log('PASS: GPT-6 Astra / Low returned a validated edit plan through your ChatGPT login. No API key, queue jobs or uploads.')
