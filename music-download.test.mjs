import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { downloadFromTrackPage } from './music-download.mjs'

function fakePage(click) {
  const page = new EventEmitter()
  page.getByRole = () => ({ click: () => click(page), isVisible: async () => true, isEnabled: async () => true })
  page.getByText = () => ({ count: async () => 0 })
  return page
}
const options = { timeoutMs: 100, retryMs: 5 }
test('captures immediate native download and cleans up listeners', async () => {
  const page = fakePage(async page => page.emit('download', { file: 'music' }))
  assert.deepEqual(await downloadFromTrackPage(page, new AbortController().signal, options), { file: 'music' })
  assert.equal(page.eventNames().length, 0)
})
test('retries one inert pre-hydration click', async () => {
  let clicks = 0
  const page = fakePage(async page => { if (++clicks === 2) page.emit('download', 'music') })
  assert.equal(await downloadFromTrackPage(page, new AbortController().signal, options), 'music')
  assert.equal(clicks, 2)
})
test('never retries a download request that already started', async () => {
  let clicks = 0
  const page = fakePage(async page => { clicks++; page.emit('request', { url: () => 'https://pixabay.com/music/download/123/' }) })
  await assert.rejects(downloadFromTrackPage(page, new AbortController().signal, options), /did not produce/)
  assert.equal(clicks, 1)
})
test('verification network errors fail clearly without retrying or bypassing', async () => {
  let clicks = 0
  const page = fakePage(async page => { clicks++; page.emit('requestfailed', { url: () => 'https://brunhild.challenges.cloudflare.com/example', failure: () => ({ errorText: 'net::ERR_NAME_NOT_RESOLVED' }) }) })
  await assert.rejects(downloadFromTrackPage(page, new AbortController().signal, options), /verification could not connect.*ERR_NAME_NOT_RESOLVED/)
  assert.equal(clicks, 1)
  assert.equal(page.eventNames().length, 0)
})
test('abort stops waiting and removes listeners', async () => {
  const controller = new AbortController()
  const page = fakePage(async () => controller.abort(new Error('Stopped')))
  await assert.rejects(downloadFromTrackPage(page, controller.signal, options), /Stopped/)
  assert.equal(page.eventNames().length, 0)
})
