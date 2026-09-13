export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])

/** Only validated numeric/style fields and escaped text enter the generated project. */
export function buildComposition(plan, { mainHasAudio = true, hasMusic = false, preparedMain = false } = {}) {
  let start = 0
  const motionTweens = []
  const clips = plan.segments.map((segment, index) => {
    const duration = segment.sourceEnd - segment.sourceStart
    const frames = segment.keyframes
    let style = `transform:scale(${segment.zoom})`
    if (frames?.length) {
      const first = frames[0]
      style = `width:${first.width}px;height:${first.height}px;right:auto;bottom:auto;object-fit:fill;transform-origin:0 0`
      motionTweens.push(`tl.set('#main-${index}',{x:${first.x},y:${first.y},scale:${first.scale},transformOrigin:'0 0'},${start});`)
      for (let k = 1; k < frames.length; k++) {
        const prev = frames[k-1], frame = frames[k]
        motionTweens.push(`tl.to('#main-${index}',{x:${frame.x},y:${frame.y},scale:${frame.scale},duration:${frame.time-prev.time},ease:'none'},${start+prev.time});`)
      }
    }
    const clip = `<video id="main-${index}" class="clip footage" src="assets/${preparedMain ? 'main-render.mp4' : 'main.mp4'}" data-start="${start}" data-duration="${duration}" data-media-start="${segment.sourceStart}" data-track-index="0" style="${style}" ${mainHasAudio && !plan.muteOutput ? `data-has-audio="true" data-volume="${plan.speechVolume}"` : 'muted data-volume="0"'} playsinline></video>`
    start += duration
    return clip
  })
  for (const [index, clip] of plan.brolls.entries()) {
    clips.push(`<video id="broll-${index}" class="clip footage broll" src="assets/broll-${clip.index}.mp4" data-start="${clip.start}" data-duration="${clip.duration}" data-media-start="${clip.sourceStart}" data-track-index="1" muted data-volume="0" playsinline></video>`)
  }
  for (const key of ['captions', 'titles']) {
    for (const [index, clip] of plan[key].entries()) clips.push(`<div id="${key}-${index}" class="clip ${key}" data-start="${clip.start}" data-duration="${clip.end - clip.start}" data-track-index="${key === 'captions' ? 2 : 3}"><span>${escapeHtml(clip.text)}</span></div>`)
  }
  if (hasMusic && !plan.muteOutput && plan.musicVolume > 0) clips.push(`<audio id="music" src="assets/music-loop.m4a" data-start="0" data-duration="${plan.duration}" data-volume="${plan.musicVolume}" data-track-index="4"></audio>`)
  const fades = plan.brolls.map((clip, index) => {
    const fade = Math.min(0.18, clip.duration / 4)
    return `tl.fromTo('#broll-${index}',{opacity:0},{opacity:1,duration:${fade}},${clip.start});tl.to('#broll-${index}',{opacity:0,duration:${fade}},${clip.start + clip.duration - fade});tl.set('#broll-${index}',{opacity:0},${clip.start + clip.duration});`
  }).join('\n')
  return `<!doctype html><html><head><meta charset="utf-8"><title>PeptiKing HyperFrames edit</title>
<style>html,body{margin:0;background:#000;width:1080px;height:1920px;overflow:hidden;font-family:Arial,sans-serif}#main{position:relative;width:1080px;height:1920px;overflow:hidden}.clip{position:absolute}.footage{inset:0;width:100%;height:100%;object-fit:cover}.broll{z-index:2}.captions,.titles{z-index:3;left:90px;right:90px;display:flex;justify-content:center;text-align:center;line-height:1.22;font-weight:700;overflow-wrap:break-word}.captions{bottom:280px;font-size:42px;color:${plan.captionColor}}.captions span{background:rgba(0,0,0,.78);border-bottom:3px solid ${plan.accentColor};border-radius:14px;padding:14px 22px;white-space:pre-line}.titles{top:180px;color:${plan.accentColor};font-size:56px}.titles span{padding:18px 24px;background:rgba(0,0,0,.82);border-radius:14px}</style>
<script src="assets/gsap.min.js"></script></head><body><div id="main" data-composition-id="main" data-start="0" data-duration="${plan.duration}" data-width="1080" data-height="1920" data-fps="30">${clips.join('\n')}</div>
<script>window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});tl.to({}, {duration:${plan.duration}},0);${fades}${motionTweens.join('\n')}window.__timelines.main=tl;</script></body></html>`
}
