import path from 'node:path'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { acquireMusic } from './pixabay.mjs'
import { childEnvironment, ffmpeg, run, serviceDir, probe } from './runtime.mjs'

// Browser integration fixture: no live Pixabay requests, GPT calls or downloads.
const root = path.join(serviceDir, 'smoke-output')
await mkdir(root, { recursive: true })
const projectDir = await mkdtemp(path.join(root, 'music-fixture-'))
const audioPath = path.join(projectDir, 'fixture.mp3')
await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '2', audioPath])
const bytes = await readFile(audioPath)
const selectedUrl = 'https://pixabay.com/music/fashion-two-222/'
const result = await acquireMusic('Soft fashion music', projectDir, {}, AbortSignal.timeout(60000),
  async input => { assert.match(input.prompt, /Fashion two/); return { index: 1 } },
  async () => {
    const browser = await chromium.launchPersistentContext(path.join(projectDir, 'browser'), {
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
      headless: true, acceptDownloads: true, env: childEnvironment(),
    })
    await browser.route('**/*', async route => {
      const url = route.request().url()
      if (url === 'https://pixabay.com/music/search/fashion/') return route.fulfill({ contentType: 'text/html', body: '<a href="/music/" style="display:none">Music navigation</a><a href="/music/hidden-999/" style="display:none">Hidden track</a><div class="audioRow--fixture"><a href="/music/fashion-one-111/">Fashion one</a>Energetic</div><div class="audioRow--fixture"><a href="https://pixabay.com/music/fashion-two-222/">Fashion two</a>Soft instrumental</div>' })
      if (url === selectedUrl) return route.fulfill({ contentType: 'text/html', body: '<a href="/users/test-123/">Test artist</a><button>Free download</button><script>setTimeout(() => { document.querySelector("button").onclick = () => { location.href="/fixture.mp3" } }, 1000)</script>' })
      if (url === 'https://pixabay.com/fixture.mp3') return route.fulfill({ contentType: 'audio/mpeg', headers: { 'Content-Disposition': 'attachment; filename="fashion.mp3"' }, body: bytes })
      return route.abort()
    })
    return browser
  })
assert.equal(result.provenance.sourceUrl, selectedUrl)
assert.equal(result.provenance.creator, 'Test artist')
assert.deepEqual(await readFile(result.file), bytes)
assert.equal((await probe(result.file)).hasAudio, true)
console.log('PASS: Browser search fixture → Astra selection → official download control → local audio → source/license manifest. No live provider request.')
