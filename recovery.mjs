import path from 'node:path'
import { readFile, cp, readdir, writeFile } from 'node:fs/promises'
import { probe } from './runtime.mjs'
import { thumbnail } from './media.mjs'

export async function restorePreparedEdit(job, cfg, projectDir, signal) {
  const attempt = job.payload.resumeAttempt
  if (!/^[a-zA-Z0-9_-]+$/.test(job.job_id) || !Number.isInteger(attempt) || attempt < 1 || attempt >= job.attempts) throw new Error('Invalid resume checkpoint.')
  const source = path.join(cfg.projectsDir, `${job.job_id}-${attempt}`)
  let transcript, acquiredAssets
  try {
    transcript = JSON.parse(await readFile(path.join(source, 'transcript.json'), 'utf8'))
    acquiredAssets = JSON.parse(await readFile(path.join(source, 'asset-manifest.json'), 'utf8'))
    await cp(path.join(source, 'assets'), path.join(projectDir, 'assets'), { recursive: true, force: false, errorOnExist: true })
  } catch {
    throw new Error('Saved assets are unavailable. Resume on the laptop that ran this edit with its original projects folder. No new B-roll was generated; use Restart to start over.')
  }
  const assets = path.join(projectDir, 'assets')
  const main = await probe(path.join(assets, 'main.mp4'), signal)
  if (!main.hasVideo) throw new Error('The saved main video is unreadable. Restore the project folder or restart.')
  const files = (await readdir(assets)).filter(name => /^broll-\d+\.mp4$/.test(name)).sort((a,b) => Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0]))
  const brolls = [], images = []
  for (const [index, name] of files.entries()) {
    if (name !== `broll-${index+1}.mp4`) throw new Error('Saved B-roll files are incomplete. Restore the project folder before resuming.')
    const file = path.join(assets, name), meta = await probe(file, signal)
    if (!meta.hasVideo) throw new Error('A saved B-roll is unreadable.')
    const title = `Saved B-roll ${index+1}`
    brolls.push({duration: meta.duration, title})
    images.push({label: title, url: await thumbnail(file, Math.min(1,meta.duration/2), path.join(assets, `broll-${index+1}.jpg`), signal)})
  }
  const names = await readdir(assets)
  const music = names.includes('music.mp3') ? await probe(path.join(assets,'music.mp3'),signal) : null
  if ((acquiredAssets.music || job.payload.musicTrack) && !music?.hasAudio) throw new Error('The saved soundtrack is missing. Restore it before resuming.')
  const expected = job.payload.brollVideos.length + (acquiredAssets.generatedBrolls?.length || 0)
  if (brolls.length < expected) throw new Error('Saved B-roll files are incomplete. No replacement clips were generated.')
  for (const [index,fraction] of [0.1,0.5,0.9].entries()) images.push({label:`Main video at ${(main.duration*fraction).toFixed(1)} seconds`,url:await thumbnail(path.join(assets,'main.mp4'), main.duration*fraction,path.join(assets,`main-${index}.jpg`),signal)})
  if (job.payload.captionStyleReference) {
    if (!names.includes('caption-reference')) throw new Error('Saved caption reference is missing.')
    images.push({label:'Requested caption style reference',url:await thumbnail(path.join(assets,'caption-reference'),0,path.join(assets,'caption-reference.jpg'),signal)})
  }
  await writeFile(path.join(projectDir,'transcript.json'),JSON.stringify(transcript))
  await writeFile(path.join(projectDir,'asset-manifest.json'),JSON.stringify(acquiredAssets))
  return { main, brolls, images, music, transcript, acquiredAssets }
}
