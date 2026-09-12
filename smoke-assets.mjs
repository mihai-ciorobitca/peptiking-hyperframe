import path from 'node:path'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { serviceDir } from './runtime.mjs'
import { planAssets } from './asset-plan.mjs'

const output = path.join(serviceDir, 'smoke-output')
await mkdir(output, { recursive: true })
const projectDir = await mkdtemp(path.join(output, 'asset-plan-'))
const plan = await planAssets({ projectDir, instructions: 'Create exactly one four-second B-roll of silk fabric moving in studio light and add fashion background music. Make the whole edit automatically.',
  duration: 20, brollCount: 0, hasMusic: false, muteOutput: false, isRevision: false,
  transcript: { text: 'Welcome to our fashion collection.', words: [] },
}, { model: 'gpt-6-astra', effort: 'low', codexHome: process.env.HYPERFRAMES_CODEX_HOME || process.env.CODEX_HOME }, AbortSignal.timeout(120000))
if (plan.scenes.length !== 1 || plan.scenes[0].durationSeconds !== 4 || !plan.music) throw new Error('Asset planner did not honor the requested scenes and music.')
console.log('PASS: Astra/Low planned a generated B-roll scene and Pixabay background music through ChatGPT login. No Flow generation or music download was triggered.')
