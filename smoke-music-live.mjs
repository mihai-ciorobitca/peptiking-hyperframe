import path from 'node:path'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { acquireMusic } from './pixabay.mjs'
import { serviceDir } from './runtime.mjs'

// Explicit live test: uses Codex limits and downloads one Pixabay music track.
// Does not claim queue jobs, generate Flow footage or upload anything.
await mkdir(path.join(serviceDir, 'smoke-output'), { recursive: true })
const projectDir = await mkdtemp(path.join(serviceDir, 'smoke-output', 'live-music-'))
try {
  const result = await acquireMusic('Quiet instrumental fashion background music beneath spoken dialogue', projectDir, {
    model: 'gpt-6-astra', effort: 'low', codexHome: process.env.HYPERFRAMES_CODEX_HOME || process.env.CODEX_HOME,
    musicProfile: process.env.HYPERFRAMES_MUSIC_PROFILE,
    musicHeadless: process.env.HYPERFRAMES_MUSIC_HEADLESS === 'true',
  }, AbortSignal.timeout(180000))
  console.log(`PASS live Pixabay search → Astra selection → browser download → verified audio: ${result.file}`)
} catch (error) { console.error(error.message); process.exitCode = 1 }
