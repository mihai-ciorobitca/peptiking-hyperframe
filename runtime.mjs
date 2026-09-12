import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import ffmpeg from 'ffmpeg-static'
import ffprobe from 'ffprobe-static'

const require = createRequire(import.meta.url)
export const serviceDir = path.dirname(fileURLToPath(import.meta.url))
export const hyperframesCli = require.resolve('hyperframes/bin/hyperframes.mjs')
export { ffmpeg }
export const ffprobePath = ffprobe.path

export function config(env = process.env) {
  const required = (key) => {
    const value = env[key]?.trim()
    if (!value || /YOUR_PROJECT/.test(value)) throw new Error(`Set ${key} in the worker .env file.`)
    return value
  }
  const supabaseUrl = required('SUPABASE_URL').replace(/\/$/, '')
  if (new URL(supabaseUrl).protocol !== 'https:') throw new Error('SUPABASE_URL must use HTTPS.')
  const model = env.HYPERFRAMES_MODEL || 'gpt-6-astra'
  const effort = env.HYPERFRAMES_REASONING_EFFORT || 'low'
  if (model !== 'gpt-6-astra' || effort !== 'low') throw new Error('This worker is configured for gpt-6-astra with low reasoning effort.')
  return {
    supabaseUrl, serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    codexHome: env.HYPERFRAMES_CODEX_HOME || env.CODEX_HOME,
    python: env.HYPERFRAMES_PYTHON || path.join(serviceDir, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
    whisperModel: env.HYPERFRAMES_WHISPER_MODEL || 'base',
    model, effort, bucket: env.HYPERFRAMES_EXPORT_BUCKET || 'shotstack',
    workerId: `hyperframes-${os.hostname()}-${process.pid}`,
    projectsDir: path.resolve(env.HYPERFRAMES_PROJECTS_DIR || path.join(serviceDir, 'projects')),
    allowedMediaHosts: new Set([new URL(supabaseUrl).hostname, 'storage.googleapis.com', ...(env.HYPERFRAMES_MEDIA_HOSTS || '').split(',').map((host) => host.trim()).filter(Boolean)]),
  }
}

// Renderer subprocesses receive only runtime settings, never worker credentials.
export function childEnvironment(env = process.env) {
  const keys = ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'CHROME_PATH', 'PUPPETEER_EXECUTABLE_PATH']
  const result = Object.fromEntries(keys.filter((key) => env[key]).map((key) => [key, env[key]]))
  result.PATH = [path.dirname(ffmpeg), path.dirname(ffprobePath), result.PATH || result.Path || ''].join(path.delimiter)
  delete result.Path
  return { ...result, HYPERFRAMES_NO_UPDATE_CHECK: '1', DO_NOT_TRACK: '1', CI: '1' }
}

export function run(command, args, { cwd = serviceDir, signal, input, env = childEnvironment(), maxOutput = 12000 } = {}) {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, shell: false, env, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] })
    if (input !== undefined) { child.stdin.on('error', () => {}); child.stdin.end(input) }
    let output = ''
    let stopped = false
    const collect = (chunk) => { output = `${output}${chunk}`.slice(-maxOutput) }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const abort = () => {
      stopped = true
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        killer.on('error', () => child.kill())
      } else child.kill('SIGTERM')
    }
    signal?.addEventListener('abort', abort, { once: true })
    child.once('error', (error) => { signal?.removeEventListener('abort', abort); reject(error) })
    child.once('close', (code) => {
      signal?.removeEventListener('abort', abort)
      if (stopped) reject(signal.reason || new Error('Job stopped.'))
      else if (code !== 0) reject(new Error(`${path.basename(command)} failed (${code}): ${output.slice(-2500)}`))
      else resolve(output)
    })
    if (signal?.aborted) abort()
  })
}

export const hyperframes = (args, options) => run(process.execPath, [hyperframesCli, ...args], options)

export async function probe(file, signal) {
  const raw = await run(ffprobePath, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], { signal })
  const data = JSON.parse(raw)
  const duration = Number(data.format?.duration)
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Source media has no readable duration.')
  return { duration, hasAudio: data.streams.some((stream) => stream.codec_type === 'audio'), hasVideo: data.streams.some((stream) => stream.codec_type === 'video'), streams: data.streams }
}
