import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { run, ffmpeg, serviceDir } from './runtime.mjs'

export const clamp = (x, min, max) => Math.max(min, Math.min(max, x))
export function cropTransform(width, height, zoom, x, y) {
  const cover = Math.max(1080 / width, 1920 / height)
  const w = width * cover, h = height * cover
  return { width: w, height: h, scale: zoom,
    x: clamp(540 - x * w * zoom, 1080 - w * zoom, 0),
    y: clamp(960 - y * h * zoom, 1920 - h * zoom, 0) }
}
export async function trackFaces(file, projectDir, cfg, signal) {
  const video = path.join(projectDir, 'tracking-preview.mp4')
  await run(ffmpeg, ['-y', '-i', file, '-an', '-vf', 'fps=5,scale=640:-2', '-c:v', 'libx264', '-preset', 'ultrafast', video], { signal })
  const output = path.join(projectDir, 'face-tracks.json')
  try { await run(cfg.python, [path.join(serviceDir, 'track-faces.py'), '--video', video, '--output', output], { signal }) }
  catch (error) { throw new Error(`Local face tracking failed. Run .venv/Scripts/python.exe -m pip install -r requirements.txt, then resume. ${error.message}`) }
  return JSON.parse(await readFile(output, 'utf8'))
}
export function trackingSummary(tracks) {
  if (!tracks) return null
  const people = new Map()
  for (const frame of tracks.frames) for (const face of frame.faces) {
    const item = people.get(face.id) || { id: face.id, from: frame.time, to: frame.time, x: face.x, y: face.y, samples: 0 }
    item.to = frame.time; item.samples++; people.set(face.id, item)
  }
  return { width: tracks.width, height: tracks.height, people: [...people.values()], note: 'Coordinates are normalized source coordinates. faceTrackId can select a visible person; null automatically follows the dominant face with mouth-motion switching. This is visual tracking, not voice identity recognition.' }
}
export function animatePlan(plan, tracks, dimensions) {
  const width = tracks?.width || dimensions.width, height = tracks?.height || dimensions.height
  if (!(width > 0 && height > 0)) throw new Error('Missing source dimensions for animated framing.')
  let previousSegment = null
  const segments = plan.segments.map(segment => {
    const motion = segment.motion
    if (!motion) { previousSegment = null; return segment }
    const duration = segment.sourceEnd - segment.sourceStart
    const sourceFrames = tracks?.frames.filter(f => f.time >= segment.sourceStart && f.time <= segment.sourceEnd) || []
    if (motion.followFace && !sourceFrames.some(f => f.faces.some(face => motion.faceTrackId == null || face.id === motion.faceTrackId))) throw new Error('No visible face was found in a requested face-tracking segment. Use a fixed focal point for this shot.')
    const targets=[]; let selected=null, lastSwitch=-Infinity, x=motion.targetX, y=motion.targetY
    const count=Math.ceil(duration*5)
    for(let i=0;i<=count;i++) {
      const time=Math.min(duration,i/5), at=segment.sourceStart+time
      const frame=sourceFrames.reduce((best,f)=>!best||Math.abs(f.time-at)<Math.abs(best.time-at)?f:best,null)
      if(motion.followFace && frame && Math.abs(frame.time-at)<1) {
        const faces=frame.faces.filter(f=>motion.faceTrackId==null||f.id===motion.faceTrackId)
        let face=faces.find(f=>f.id===selected)
        const candidate=[...faces].sort((a,b)=>(b.motion+.1)*Math.sqrt(b.w*b.h)-(a.motion+.1)*Math.sqrt(a.w*a.h))[0]
        if(!face || (candidate && candidate.id!==selected && at-lastSwitch>1.2 && candidate.motion>face.motion*1.8+.08)) {face=candidate;if(face){selected=face.id;lastSwitch=at}}
        if(face){x=face.x;y=face.y}
      }
      targets.push({time,x,y})
    }
    // Centered smoothing removes detector jitter without accumulating tracking lag.
    const keyframes=targets.map((target,i)=>{
      const window=targets.slice(Math.max(0,i-2),Math.min(targets.length,i+3))
      const x=window.reduce((sum,f)=>sum+f.x,0)/window.length, y=window.reduce((sum,f)=>sum+f.y,0)/window.length
      const t=clamp(target.time/Math.min(motion.transitionSeconds,duration),0,1)
      const ease=t*t*(3-2*t)
      const zoom=motion.zoomFrom+(motion.zoomTo-motion.zoomFrom)*ease
      return {time:target.time,...cropTransform(width,height,zoom,x,y)}
    })
    const last = previousSegment?.keyframes.at(-1)
    if (last && Math.abs(previousSegment.sourceEnd-segment.sourceStart)<0.02 && Math.abs(last.scale-keyframes[0].scale)<0.001) {
      for (const frame of keyframes) {
        const t=clamp(frame.time/Math.min(motion.transitionSeconds,duration),0,1), blend=t*t*(3-2*t)
        frame.x=clamp(last.x+(frame.x-last.x)*blend,1080-frame.width*frame.scale,0)
        frame.y=clamp(last.y+(frame.y-last.y)*blend,1920-frame.height*frame.scale,0)
      }
    }
    previousSegment = {...segment,keyframes}
    return previousSegment
  })
  return {...plan,segments}
}
