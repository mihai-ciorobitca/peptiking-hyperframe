import path from 'node:path'
import {mkdir,readFile} from 'node:fs/promises'
import {serviceDir,ffmpeg,run} from './runtime.mjs'
import {renderPlan} from './worker.mjs'
import {validatePlan} from './plan.mjs'
const dir=path.join(serviceDir,'smoke-output/transitions')
await mkdir(path.join(dir,'assets'),{recursive:true})
const signal=AbortSignal.timeout(180000)
for(const [name,color] of [['main','green'],['broll-1','red'],['broll-2','blue']]) await run(ffmpeg,['-y','-f','lavfi','-i',`color=c=${color}:size=360x640:rate=30`,'-t','5','-c:v','libx264','-pix_fmt','yuv420p',path.join(dir,`assets/${name}.mp4`)],{signal})
const media={main:{duration:5,hasAudio:false},brolls:[{duration:5},{duration:5}],music:null}
const plan=validatePlan({segments:[{sourceStart:0,sourceEnd:5,zoom:1}],brolls:[{index:1,start:.5,duration:2.1,sourceStart:0,transitionIn:{type:'cross-dissolve',duration:.6}},{index:2,start:2,duration:2.5,sourceStart:0,transitionIn:{type:'cross-dissolve',duration:.6}}],captions:[],titles:[],captionColor:'#ffffff',accentColor:'#ffffff',musicVolume:0,speechVolume:1,muteOutput:false},media)
const output=await renderPlan(dir,plan,media,signal)
for(const [time,expected] of [[1.5,'red'],[2.3,'blend'],[3,'blue']]){
 const pixel=path.join(dir,`${expected}.rgb`)
 await run(ffmpeg,['-y','-ss',String(time),'-i',output,'-vf','crop=2:2:540:960','-frames:v','1','-pix_fmt','rgb24','-f','rawvideo',pixel],{signal})
 const [r,g,b]=await readFile(pixel)
 if(g>40 || (expected==='blend' && !(r>70&&b>70)) || (expected==='red'&&r<220) || (expected==='blue'&&b<220))throw new Error(`Incorrect ${expected} transition pixels: ${r},${g},${b}`)
 console.log(`PASS ${expected} frame: ${r},${g},${b}`)
}
console.log(`PASS actual MP4 cross-dissolve without main-video bleed: ${output}`)
