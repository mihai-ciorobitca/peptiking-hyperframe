import { setTimeout as delay } from 'node:timers/promises'
import { writeFile } from 'node:fs/promises'

export async function loadFlowConnection(cfg, signal, request = fetch) {
  if (cfg.flowUrl && cfg.flowKey) return cfg
  const response = await request(`${cfg.supabaseUrl}/rest/v1/rpc/get_hyperframes_flow_connection`, {
    method: 'POST', headers: { apikey: cfg.serviceRoleKey, Authorization: `Bearer ${cfg.serviceRoleKey}`, 'Content-Type': 'application/json' },
    body: '{}', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error('Automatic B-roll connection is not installed. Apply asset-connection.sql and provision the existing Flow connection in Supabase Vault.')
  const data = await response.json()
  if (!data || typeof data.url !== 'string' || !/^https?:\/\//.test(data.url) || typeof data.key !== 'string' || !data.key) throw new Error('The encrypted Flow connection has not been provisioned.')
  return { ...cfg, flowUrl: data.url.replace(/\/+$/, ''), flowKey: data.key }
}

export async function flowRequest(cfg, route, body, signal) {
  if (!cfg.flowUrl || !cfg.flowKey) throw new Error('Automatic B-roll needs your existing PeptiKing Flow connection. Set FLOW_API_URL and FLOW_API_KEY in .env; these are the existing B-roll Creator service settings, not OpenAI credentials.')
  const response = await fetch(`${cfg.flowUrl}${route}`, { method: body ? 'POST' : 'GET',
    headers: { 'x-api-key': cfg.flowKey, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`B-roll service failed (${response.status}): ${data?.error || 'Check the Flow connection and generation allowance.'}`)
  if (!data) throw new Error('B-roll service returned no data.')
  return data
}

export async function generateScenes(scenes, owner, cfg, signal, progress, manifestPath, request = flowRequest) {
  if (!scenes.length) return []
  if (!owner.projectId || !owner.email) throw new Error('Open and unlock B-Roll Creator once in PeptiKing before requesting automatic generated footage.')
  const quota = await request(cfg, `/v1/users/${encodeURIComponent(owner.email)}/generation-quota`, undefined, signal)
  // The service also enforces quota at submission; don't assume a missing value is unlimited.
  const remaining = quota.remaining ?? quota.dailyQuota?.remaining
  if (!Number.isFinite(remaining)) throw new Error('B-roll service did not return a valid generation allowance.')
  if (remaining < scenes.length) throw new Error('Not enough B-roll generation allowance for this edit.')
  const pending = new Set()
  const records = []
  try {
    for (const [index, scene] of scenes.entries()) {
      await progress('generate-broll', `Generating B-roll ${index + 1}/${scenes.length}: ${scene.title}`, 33)
      // No automatic retries of POST: a timed-out submission may already be generating.
      const submission = await request(cfg, '/v1/generate', { projectId: owner.projectId, userEmail: owner.email,
        title: scene.title, prompt: `${scene.prompt}\nVertical 9:16. No text, logos or watermarks.`, aspectRatio: '9:16',
        durationSeconds: scene.durationSeconds, count: 1, generationMode: 'direct_video' }, signal)
      const id = submission.jobs?.[0]?.jobId || submission.jobId
      if (typeof id !== 'string' || !id) throw new Error('B-roll service accepted a request without a job id; check B-Roll Creator before retrying.')
      pending.add(id)
      records.push({ id, title: scene.title, status: 'submitted' })
      await writeFile(manifestPath, JSON.stringify(records, null, 2))
      for (;;) {
        signal.throwIfAborted()
        const job = await request(cfg, `/v1/jobs/${encodeURIComponent(id)}`, undefined, signal)
        if (['failed','cancelled','cancelling'].includes(job.status)) throw new Error(`B-roll ${index+1} failed: ${job.error || job.status}`)
        if (job.status === 'done') {
          const library = await request(cfg, `/v1/users/${encodeURIComponent(owner.email)}/executions?limit=50`, undefined, signal)
          const execution = library.executions?.find(item => item.job_id === id && item.media_url)
          const url = execution?.media_url || job.result?.link
          if (!url || job.result?.mediaType === 'image') throw new Error('Generated B-roll has no downloadable video. Check B-Roll Creator.')
          records[index] = { id, title: scene.title, status: 'done', url }
          pending.delete(id)
          await writeFile(manifestPath, JSON.stringify(records, null, 2))
          break
        }
        await delay(3000, undefined, { signal })
      }
    }
    return records
  } finally {
    // Cancel known pending generations when this edit fails or is cancelled.
    for (const id of pending) {
      try { await request(cfg, `/v1/jobs/${encodeURIComponent(id)}/cancel`, { userEmail: owner.email }, AbortSignal.timeout(10000)) }
      catch { console.error(`Could not cancel Flow job ${id}; check B-Roll Creator.`) }
    }
  }
}
