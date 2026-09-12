import path from 'node:path'
import { createWriteStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { ffmpeg, run, serviceDir } from './runtime.mjs'

export function allowedMediaUrl(value, hosts) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !hosts.has(url.hostname)) throw new Error('The source media host is not enabled on this worker. Add its exact host to HYPERFRAMES_MEDIA_HOSTS.')
  return url
}

export async function downloadMedia(value, file, cfg, signal, maxBytes = 500 * 1024 * 1024) {
  let url = allowedMediaUrl(value, cfg.allowedMediaHosts)
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetch(url, { redirect: 'manual', signal })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (!location) throw new Error('Media redirect has no destination.')
      url = allowedMediaUrl(new URL(location, url).href, cfg.allowedMediaHosts)
      continue
    }
    if (!response.ok || !response.body) throw new Error(`Source media download failed (${response.status}).`)
    if (Number(response.headers.get('content-length')) > maxBytes) { await response.body.cancel(); throw new Error('Source file is too large.') }
    let bytes = 0
    const limit = new Transform({ transform(chunk, encoding, callback) { bytes += chunk.length; callback(bytes > maxBytes ? new Error('Source file is too large.') : null, chunk) } })
    await pipeline(Readable.fromWeb(response.body), limit, createWriteStream(file), { signal })
    return file
  }
  throw new Error('Too many media redirects.')
}

export async function thumbnail(file, at, destination, signal) {
  await run(ffmpeg, ['-y', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'scale=384:-2', '-q:v', '5', destination], { signal })
  return `data:image/jpeg;base64,${(await readFile(destination)).toString('base64')}`
}

export async function transcribe(mainFile, cfg, signal) {
  const audio = path.join(path.dirname(mainFile), 'speech.mp3')
  await run(ffmpeg, ['-y', '-i', mainFile, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', audio], { signal })
  const output = path.join(path.dirname(mainFile), 'speech.json')
  await run(cfg.python, [path.join(serviceDir, 'transcribe.py'), '--audio', audio, '--output', output, '--model', cfg.whisperModel], { signal })
  const data = JSON.parse(await readFile(output, 'utf8'))
  if (typeof data.text !== 'string' || !Array.isArray(data.words)) throw new Error('Local transcription did not return readable text and timestamps.')
  return data
}
