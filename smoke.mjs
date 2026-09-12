import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { serviceDir, ffmpeg, run, probe } from './runtime.mjs'
import { renderPlan } from './worker.mjs'
import { validatePlan } from './plan.mjs'

const projectDir = path.join(serviceDir, 'smoke-output')
await mkdir(path.join(projectDir, 'assets'), { recursive: true })
const signal = AbortSignal.timeout(120000)
await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(projectDir, 'assets/main.mp4')], { signal })
await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=0x163833:size=360x640:rate=30', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(projectDir, 'assets/broll-1.mp4')], { signal })
const media = { main: { duration: 3, hasAudio: true }, brolls: [{ duration: 1 }], music: null }
const plan = validatePlan({ unsupportedReason: null, summary: 'Local renderer verification', segments: [{ sourceStart: 0.5, sourceEnd: 2.5, zoom: 1 }], brolls: [{ index: 1, start: 0.5, duration: 0.8, sourceStart: 0 }], captions: [{ text: 'HyperFrames · PeptiKing', start: 0, end: 2 }], titles: [], captionColor: '#ffffff', accentColor: '#d7af58', musicVolume: 0, speechVolume: 1, muteOutput: false }, media)
const output = await renderPlan(projectDir, plan, media, signal)
const details = await probe(output, signal)
if (!details.hasAudio || !details.hasVideo || Math.abs(details.duration - 2) > 0.2) throw new Error('Rendered smoke test failed audio/video checks.')
console.log(`PASS 1080×1920 MP4 with source trim, captions, B-roll and audio: ${output}`)
