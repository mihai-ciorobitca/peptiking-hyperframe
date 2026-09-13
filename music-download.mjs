/** Download only through the site's official button, without bypassing verification. */
export async function downloadFromTrackPage(page, signal, { timeoutMs = 60000, retryMs = 4000 } = {}) {
  signal.throwIfAborted()
  let resolveResult, rejectResult, settled = false, started = false
  const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject })
  result.catch(() => {})
  const fail = error => { if (!settled) { settled = true; rejectResult(error) } }
  const received = download => { if (!settled) { settled = true; resolveResult(download) } }
  const request = req => { if (/\/download(?:\/|$)/.test(new URL(req.url()).pathname)) started = true }
  const networkFailure = req => {
    const host = new URL(req.url()).hostname
    if (host === 'challenges.cloudflare.com' || host.endsWith('.challenges.cloudflare.com')) {
      fail(new Error(`Pixabay verification could not connect (${req.failure()?.errorText || 'network error'}). Open npm run music:open and try Free download manually on the worker laptop. Check its DNS/network if verification cannot load.`))
    }
  }
  const pageError = error => {
    if (/turnstile|captcha|verification/i.test(error.message)) fail(new Error('Pixabay could not complete download verification. Run npm run music:open and try Free download manually on the worker laptop.'))
  }
  const aborted = () => fail(signal.reason || new Error('Music download cancelled.'))
  page.on('download', received)
  page.on('request', request)
  page.on('requestfailed', networkFailure)
  page.on('pageerror', pageError)
  signal.addEventListener('abort', aborted, { once: true })
  const timeout = setTimeout(() => fail(new Error('Pixabay did not produce a music download. Open npm run music:open and click Free download on a track to check verification or login requirements.')), timeoutMs)
  let retry
  try {
    const button = page.getByRole('button', { name: 'Free download', exact: true })
    await button.click()
    // A visible server-rendered button can precede its client-side event handler.
    // Retry only an inert click, never a download/verification already underway.
    retry = setTimeout(async () => {
      try {
        if (settled || started || signal.aborted) return
        if (await page.getByText(/Downloading\.\.\./, { exact: true }).count()) return
        if (await button.isVisible() && await button.isEnabled()) await button.click({ timeout: 3000 })
      } catch (error) { fail(error) }
    }, retryMs)
    return await result
  } finally {
    clearTimeout(timeout)
    clearTimeout(retry)
    page.off('download', received)
    page.off('request', request)
    page.off('requestfailed', networkFailure)
    page.off('pageerror', pageError)
    signal.removeEventListener('abort', aborted)
  }
}
