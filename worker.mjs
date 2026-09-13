import path from 'node:path'
import { trackFaces, trackingSummary, animatePlan, bakeFraming } from './motion.mjs'
import { restorePreparedEdit } from './recovery.mjs'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { mkdir, writeFile, readFile, copyFile, stat } from 'node:fs/promises'
import { config, hyperframes, run, probe, ffmpeg, serviceDir } from './runtime.mjs'
import { downloadMedia, thumbnail, transcribe } from './media.mjs'
import { requestPlan, validatePlan } from './plan.mjs'
import { buildComposition } from './composition.mjs'
import { verifyCodexLogin } from './codex.mjs'
import { planAssets } from './asset-plan.mjs'
import { generateScenes, loadFlowConnection } from './flow.mjs'
import { acquireMusic } from './pixabay.mjs'
import { createLogger, safeLogText } from './logging.mjs'

const require = createRequire(import.meta.url)
const TIMEOUT_MS = 10 * 60 * 1000

export async function rpc(cfg, name, body, signal) {
  const response = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { apikey: cfg.serviceRoleKey, Authorization: `Bearer ${cfg.serviceRoleKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`Worker queue request failed (${response.status}). Verify the HyperFrames database migration and Supabase key.`)
  return response.json()
}

async function previousEdit(job, cfg, signal) {
  const id = job.payload.parentJobId
  if (!id) return null
  const url = new URL(`${cfg.supabaseUrl}/rest/v1/AiVideoEditJob`)
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid previous edit identifier.')
  url.search = new URLSearchParams({ id: `eq.${id}`, userId: `eq.${job.user_id}`, status: 'eq.COMPLETED', select: 'payload,result,attempts', limit: '1' })
  const response = await fetch(url, { headers: { apikey: cfg.serviceRoleKey, Authorization: `Bearer ${cfg.serviceRoleKey}` }, signal })
  if (!response.ok) throw new Error('The previous edit could not be loaded.')
  const previous = (await response.json())[0]
  if (!previous) throw new Error('The previous edit is no longer available.')
  return previous
}

export async function renderPlan(projectDir, plan, media, signal, cfg = { python: path.join(serviceDir, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python') }) {
  const assets = path.join(projectDir, 'assets')
  await copyFile(require.resolve('gsap/dist/gsap.min.js'), path.join(assets, 'gsap.min.js'))
  let compositionPlan = plan
  if (plan.segments.some(segment => segment.bakedFraming)) {
    const framed = await bakeFraming(projectDir, plan, cfg, signal)
    if (media.main.hasAudio && !plan.muteOutput) {
      const trims=plan.segments.map((s,i)=>`[0:a]atrim=start=${s.sourceStart}:end=${s.sourceEnd},asetpts=PTS-STARTPTS[a${i}]`)
      const concat=plan.segments.map((s,i)=>`[a${i}]`).join('')+`concat=n=${plan.segments.length}:v=0:a=1[audio]`
      await run(ffmpeg,['-y','-i',path.join(assets,'main.mp4'),'-i',framed,'-filter_complex',[...trims,concat].join(';'),'-map','1:v:0','-map','[audio]','-c:v','copy','-c:a','aac','-b:a','192k','-t',String(plan.duration),'-movflags','+faststart',path.join(assets,'main-render.mp4')],{signal})
    } else await copyFile(framed,path.join(assets,'main-render.mp4'))
    compositionPlan={...plan,segments:[{sourceStart:0,sourceEnd:plan.duration,zoom:1}]}
  } else {
    // Use one codec/fps/resolution contract for extraction; retain the original.
    // 4K/60fps sources can exhaust decoder resources when reused across many cuts.
    await run(ffmpeg, ['-y', '-threads', '2', '-i', path.join(assets, 'main.mp4'), '-map', '0:v:0', '-map', '0:a?',
      '-vf', "scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30",
      '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', '18', '-g', '30', '-keyint_min', '30', '-sc_threshold', '0', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', path.join(assets, 'main-render.mp4')], { signal })
  }
  if (media.music && !plan.muteOutput && plan.musicVolume > 0) {
    await run(ffmpeg, ['-y', '-stream_loop', '-1', '-i', path.join(assets, 'music.mp3'), '-t', String(plan.duration), '-af', `afade=t=in:d=0.7,afade=t=out:st=${Math.max(0,plan.duration-1)}:d=1`, '-c:a', 'aac', path.join(assets, 'music-loop.m4a')], { signal })
  }
  await writeFile(path.join(projectDir, 'index.html'), buildComposition(compositionPlan, { mainHasAudio: media.main.hasAudio, hasMusic: Boolean(media.music), preparedMain: true }))
  await writeFile(path.join(projectDir, 'edit-plan.json'), JSON.stringify(plan, null, 2))
  await hyperframes(['lint'], { cwd: projectDir, signal })
  const output = path.join(projectDir, 'master.mp4')
  await hyperframes(['render', '--output', output, '--fps', '30', '--quality', 'high', '--workers', '1'], { cwd: projectDir, signal })
  const details = await probe(output, signal)
  if (!details.hasVideo || Math.abs(details.duration - plan.duration) > 0.5) throw new Error('HyperFrames rendered an unexpected video duration.')
  const video = details.streams.find((stream) => stream.codec_type === 'video')
  if (video.width !== 1080 || video.height !== 1920) throw new Error('HyperFrames did not render the required 1080 × 1920 canvas.')
  if (!plan.muteOutput && (media.main.hasAudio || (media.music && plan.musicVolume > 0)) && !details.hasAudio) throw new Error('The rendered video is missing its expected audio.')
  const web = path.join(projectDir, 'edit.mp4')
  const bitrate = Math.max(200, Math.floor(32 * 1024 * 1024 * 8 / plan.duration / 1000) - 128)
  await run(ffmpeg, ['-y', '-i', output, '-map', '0:v:0', ...(plan.muteOutput ? ['-an'] : ['-map', '0:a?', '-c:a', 'aac', '-b:a', '128k']), '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', `${bitrate}k`, '-maxrate', `${bitrate}k`, '-bufsize', `${bitrate*2}k`, '-pix_fmt', 'yuv420p', '-movflags', '+faststart', web], { signal })
  if ((await stat(web)).size > 45 * 1024 * 1024) throw new Error('The edited video exceeds the website upload limit.')
  return web
}

async function editVideo(job, cfg, signal, progress) {
  const payload = job.payload
  if (payload?.editor !== 'hyperframes' || payload.version !== 2 || !payload.mainVideo || !Array.isArray(payload.brollVideos) || payload.brollVideos.length > 20) throw new Error('Unsupported HyperFrames job payload.')
  if (!/^[a-zA-Z0-9_-]+$/.test(job.job_id)) throw new Error('Invalid job identifier.')
  const projectDir = path.join(cfg.projectsDir, `${job.job_id}-${job.attempts}`)
  const assets = path.join(projectDir, 'assets')
  await mkdir(assets, { recursive: true })
  const previous = await previousEdit(job, cfg, signal)
  let main, brolls, images, music, transcript, acquiredAssets
  if (payload.resumeAttempt != null) {
    await progress('resume', 'Restoring saved footage and transcript; no asset generation', 35)
    ;({ main, brolls, images, music, transcript, acquiredAssets } = await restorePreparedEdit(job, cfg, projectDir, signal))
  } else {
  const inheritedAssets = previous?.result?.acquiredAssets
  const sources = [...payload.brollVideos]
  for (const source of inheritedAssets?.generatedBrolls || []) {
    if (!sources.some(item => item.url === source.url)) sources.push(source)
  }
  if (sources.length > 20) throw new Error('This revision would exceed 20 B-roll sources.')
  await progress('download', 'Downloading the selected video and B-rolls', 5)
  const mainFile = await downloadMedia(payload.mainVideo.url, path.join(assets, 'main.mp4'), cfg, signal)
  main = await probe(mainFile, signal)
  if (!main.hasVideo || main.duration > 600) throw new Error('HyperFrames needs a main video no longer than 10 minutes.')
  brolls = []
  images = []
  for (const [index, source] of sources.entries()) {
    const file = await downloadMedia(source.url, path.join(assets, `broll-${index+1}.mp4`), cfg, signal)
    const meta = await probe(file, signal)
    if (!meta.hasVideo) throw new Error(`B-roll ${index+1} has no video stream.`)
    brolls.push({ duration: meta.duration, title: source.title })
    images.push({ label: `B-roll ${index+1}: ${source.title}`, url: await thumbnail(file, Math.min(1,meta.duration/2), path.join(assets, `broll-${index+1}.jpg`), signal) })
  }
  music = null
  if (payload.musicTrack) {
    const file = await downloadMedia(payload.musicTrack.url, path.join(assets, 'music.mp3'), cfg, signal)
    music = await probe(file, signal)
    if (!music.hasAudio) throw new Error('The selected music has no audio stream.')
  } else if (inheritedAssets?.music && !payload.requestedActions?.muteOutput) {
    if (!Number.isInteger(previous.attempts) || previous.attempts < 1) throw new Error('Previous music source metadata is invalid.')
    const source = path.join(cfg.projectsDir, `${payload.parentJobId}-${previous.attempts}`, 'assets', 'music.mp3')
    await copyFile(source, path.join(assets, 'music.mp3')).catch(() => { throw new Error('The previous Pixabay music file is missing on this laptop. Restore the original project folder to preserve the soundtrack.') })
    music = await probe(path.join(assets, 'music.mp3'), signal)
  }
  for (const [index, fraction] of [0.1,0.5,0.9].entries()) images.push({ label: `Main video at ${(main.duration*fraction).toFixed(1)} seconds`, url: await thumbnail(mainFile, main.duration*fraction, path.join(assets, `main-${index}.jpg`), signal) })
  if (payload.captionStyleReference) {
    const file = await downloadMedia(payload.captionStyleReference.url, path.join(assets, 'caption-reference'), cfg, signal, 10 * 1024 * 1024)
    images.push({ label: 'Requested caption style reference', url: await thumbnail(file, 0, path.join(assets, 'caption-reference.jpg'), signal) })
  }
  await progress('transcribe', 'Transcribing the speech for accurate caption timing', 25)
  transcript = main.hasAudio ? await transcribe(mainFile, cfg, signal) : { text: '', words: [] }
  await writeFile(path.join(projectDir, 'transcript.json'), JSON.stringify(transcript))
  acquiredAssets = inheritedAssets ? { generatedBrolls: [...(inheritedAssets.generatedBrolls || [])], music: payload.musicTrack ? null : inheritedAssets.music } : null
  if (cfg.autoAssets) {
    await progress('plan-assets', 'Astra is planning B-roll and background music', 29)
    const assetPlan = await planAssets({ instructions: payload.instructions, transcript, images, projectDir,
      duration: main.duration, brollCount: brolls.length, hasMusic: Boolean(music),
      muteOutput: Boolean(payload.requestedActions?.muteOutput), isRevision: Boolean(payload.parentJobId) }, cfg, signal)
    await writeFile(path.join(projectDir, 'asset-plan.json'), JSON.stringify(assetPlan, null, 2))
    acquiredAssets ||= { generatedBrolls: [], music: null }
    const flowCfg = assetPlan.scenes.length ? await loadFlowConnection(cfg, signal) : cfg
    let owner
    if (assetPlan.scenes.length) {
      const ownerUrl = new URL(`${cfg.supabaseUrl}/rest/v1/User`)
      ownerUrl.search = new URLSearchParams({ id: `eq.${job.user_id}`, select: 'email,aiVideoFlowProjectId', limit: '1' })
      const response = await fetch(ownerUrl, { headers: { apikey: cfg.serviceRoleKey, Authorization: `Bearer ${cfg.serviceRoleKey}` }, signal })
      if (!response.ok) throw new Error('Could not load the B-roll generation project for this edit owner.')
      owner = (await response.json())[0]
      if (!owner?.email || !owner.aiVideoFlowProjectId) throw new Error('Open and unlock B-Roll Creator for this account before requesting generated footage. No music acquisition or Flow generation was started.')
    }
    // Music failure is resolved before spending generation allowance.
    if (assetPlan.music) {
      await progress('source-music', 'Astra is selecting fashion background music from Pixabay', 31)
      const selected = await acquireMusic(assetPlan.musicBrief, projectDir, cfg, signal, undefined, undefined, message => progress('source-music', message, 31))
      music = await probe(selected.file, signal)
      if (!music.hasAudio || music.hasVideo) throw new Error('The downloaded Pixabay file is not an audio track.')
      acquiredAssets.music = selected.provenance
    }
    if (assetPlan.scenes.length) {
      const generated = await generateScenes(assetPlan.scenes, { email: owner?.email, projectId: owner?.aiVideoFlowProjectId, job }, flowCfg, signal, progress, path.join(projectDir, 'flow-jobs.json'))
      for (const clip of generated) {
        const index = brolls.length + 1
        const file = await downloadMedia(clip.url, path.join(assets, `broll-${index}.mp4`), cfg, signal)
        const meta = await probe(file, signal)
        if (!meta.hasVideo) throw new Error(`Generated B-roll ${index} is not a playable video.`)
        brolls.push({ duration: meta.duration, title: clip.title })
        images.push({ label: `B-roll ${index}: ${clip.title}`, url: await thumbnail(file, Math.min(1, meta.duration / 2), path.join(assets, `broll-${index}.jpg`), signal) })
        acquiredAssets.generatedBrolls.push({ ...clip, durationSeconds: meta.duration })
      }
    }
    await writeFile(path.join(projectDir, 'asset-manifest.json'), JSON.stringify(acquiredAssets, null, 2))
  }
    await writeFile(path.join(projectDir, 'asset-manifest.json'), JSON.stringify(acquiredAssets || { generatedBrolls: [], music: null }))
  }
  let faceTracks = null
  if (/zoom|refram|face.?track|speaking.person|scale.*keyframe|center.*face/i.test(payload.instructions)) {
    await progress('track-faces', 'Tracking faces locally for smooth person-centered zoom', 37)
    faceTracks = await trackFaces(path.join(assets, 'main.mp4'), projectDir, cfg, signal)
    await progress('track-faces', `Face tracking complete: ${trackingSummary(faceTracks).people.length} tracks; preparing animated framing`, 39)
  }
  await progress('astra-edit', 'GPT-6 Astra is planning the edit · Low reasoning', 40)
  const media = { main: { duration: main.duration, hasAudio: main.hasAudio }, brolls, music: music ? { duration: music.duration } : null, faceTracking: trackingSummary(faceTracks) }
  let plan = await requestPlan({ instructions: `${payload.instructions}\n${acquiredAssets ? 'Asset acquisition is complete. Any generated B-rolls and selected music listed in media are available to use; do not request further generation. Include newly acquired assets while respecting explicit removal requests for previous assets.' : ''}`, media, transcript, previousPlan: previous?.result?.editPlan || (previous ? { previousInstructions: previous.payload?.instructions || '' } : null), images, projectDir }, cfg, signal)
  if (payload.requestedActions?.muteOutput) plan.muteOutput = true
  validatePlan(plan, media)
  if (plan.segments.some(segment => segment.motion)) {
    if (!faceTracks && plan.segments.some(segment => segment.motion?.followFace)) faceTracks = await trackFaces(path.join(assets, 'main.mp4'), projectDir, cfg, signal)
    const dimensions = main.streams.find(stream => stream.codec_type === 'video')
    plan = animatePlan(plan, faceTracks, dimensions)
  }
  await progress('render', 'HyperFrames is rendering the edited video', 65)
  const outputPath = await renderPlan(projectDir, plan, media, signal, cfg)
  await progress('upload', 'Uploading the edited MP4 for playback', 92)
  const fileName = `hyperframes-${job.job_id}.mp4`
  const objectPath = `hyperframes-exports/${job.user_id}/${job.job_id}/${job.attempts}/${fileName}`
  const encoded = [cfg.bucket, ...objectPath.split('/')].map(encodeURIComponent).join('/')
  const bytes = await readFile(outputPath)
  const response = await fetch(`${cfg.supabaseUrl}/storage/v1/object/${encoded}`, {
    method: 'POST', headers: { apikey: cfg.serviceRoleKey, Authorization: `Bearer ${cfg.serviceRoleKey}`, 'Content-Type': 'video/mp4', 'x-upsert': 'true' }, body: bytes, signal,
  })
  if (!response.ok) throw new Error(`Export upload failed (${response.status}). Verify the website storage bucket and file-size limit.`)
  await progress('finalizing', 'Finalizing the HyperFrames edit', 99)
  const videoUrl = `${cfg.supabaseUrl}/storage/v1/object/public/${encoded}`
  return { videoUrl, downloadUrl: `${videoUrl}?download=${encodeURIComponent(fileName)}`, fileName, sizeBytes: bytes.length, completedAt: new Date().toISOString(), editor: 'hyperframes', model: cfg.model, reasoningEffort: cfg.effort, editPlan: plan, acquiredAssets, projectDir, workerId: cfg.workerId }
}

export async function handleJob(job, cfg, outerSignal) {
  const log = createLogger(cfg, job)
  log.emit('claimed', `model=${cfg.model} reasoning=${cfg.effort}`)
  const controller = new AbortController()
  const signal = AbortSignal.any([controller.signal, outerSignal, AbortSignal.timeout(TIMEOUT_MS)])
  let state = { stage: 'starting', message: 'HyperFrames worker connected', percent: 1 }
  let failures = 0
  const progress = async (stage, message, percent) => {
    signal.throwIfAborted()
    state = { stage, message, percent }
    const accepted = await rpc(cfg, 'update_borumi_video_edit_job_progress', { p_job_id: job.job_id, p_worker_id: cfg.workerId, p_stage: stage, p_message: message, p_percent: percent }, signal)
    if (!accepted) { controller.abort(new Error('The job was cancelled or claimed by another worker.')); signal.throwIfAborted() }
    log.progress(stage, message, percent)
  }
  let heartbeatRunning = false
  const timer = setInterval(async () => {
    if (heartbeatRunning || signal.aborted) return
    heartbeatRunning = true
    try { await progress(state.stage, state.message, state.percent); failures = 0 }
    catch (error) { log.emit('heartbeat-error', error.message); if (++failures >= 3) controller.abort(error) }
    finally { heartbeatRunning = false }
  }, 3000)
  try {
    await progress(state.stage, state.message, state.percent)
    let result
    if (job.operation === 'LIST_PROJECTS') {
      await verifyCodexLogin(cfg, signal)
      await hyperframes(['--version'], { signal })
      result = { editor: 'hyperframes', model: cfg.model, reasoningEffort: cfg.effort, authentication: 'chatgpt', modelAccessVerified: false, workerId: cfg.workerId, connectedAt: new Date().toISOString() }
    } else if (job.operation === 'EDIT_VIDEO') result = await editVideo(job, cfg, signal, progress)
    else throw new Error('Unsupported worker operation.')
    signal.throwIfAborted()
    clearInterval(timer)
    const accepted = await rpc(cfg, 'finish_borumi_video_edit_job', { p_job_id: job.job_id, p_worker_id: cfg.workerId, p_result: result, p_error: null })
    log.emit(accepted ? 'completed' : 'completion-rejected', accepted ? `progress=100% bytes=${result.sizeBytes || 0}` : 'Result was not accepted; check cancellation or lease ownership.')
    return accepted
  } catch (error) {
    const message = signal.aborted ? String(signal.reason?.message || 'The edit was cancelled or reached the 10-minute processing limit.') : String(error.message || error)
    clearInterval(timer)
    log.emit(signal.aborted ? 'aborted' : 'failed', `stage=${state.stage} ${message}`)
    try {
      const accepted = await rpc(cfg, 'finish_borumi_video_edit_job', { p_job_id: job.job_id, p_worker_id: cfg.workerId, p_result: null, p_error: safeLogText(message, [cfg.serviceRoleKey, cfg.flowKey]) })
      log.emit(accepted ? 'failure-recorded' : 'failure-update-rejected', 'Database failure update')
    } catch (finishError) { log.emit('failure-update-error', finishError.message) }
    return false
  } finally { clearInterval(timer) }
}

async function main() {
  const cfg = config()
  const controller = new AbortController()
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => controller.abort(new Error('Worker stopped.')))
  const log = createLogger(cfg)
  log.emit('ready', `model=${cfg.model} reasoning=${cfg.effort} capabilities=resume,animated_zoom,face_tracking Waiting for jobs`)
  while (!controller.signal.aborted) {
    try {
      const rows = await rpc(cfg, 'claim_hyperframes_video_edit_job', { p_worker_id: cfg.workerId, p_lease_seconds: 900 }, controller.signal)
      const job = rows?.[0]
      if (job) { await handleJob(job, cfg, controller.signal); continue }
    } catch (error) { if (!controller.signal.aborted) log.emit('queue-error', error.message) }
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  log.emit('stopped', 'Worker stopped')
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main()
