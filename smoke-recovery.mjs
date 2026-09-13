import path from 'node:path'
import { mkdir, cp, writeFile } from 'node:fs/promises'
import { serviceDir, probe } from './runtime.mjs'
import { restorePreparedEdit } from './recovery.mjs'
import { renderPlan } from './worker.mjs'
import { validatePlan } from './plan.mjs'
const root=path.join(serviceDir,'smoke-output','recovery')
const id=`smoke-${Date.now()}`
const source=path.join(root,`${id}-1`), target=path.join(root,`${id}-2`)
await mkdir(source,{recursive:true})
await cp(path.join(serviceDir,'smoke-output','assets'),path.join(source,'assets'),{recursive:true})
await writeFile(path.join(source,'transcript.json'),JSON.stringify({text:'Recovery verified',words:[]}))
await writeFile(path.join(source,'asset-manifest.json'),JSON.stringify({generatedBrolls:[{title:'Saved clip'}],music:{source:'fixture'}}))
await mkdir(path.join(target,'assets'),{recursive:true})
const signal=AbortSignal.timeout(120000)
const restored=await restorePreparedEdit({job_id:id,attempts:2,payload:{resumeAttempt:1,brollVideos:[]}}, {projectsDir:root}, target, signal)
const media={main:restored.main,brolls:restored.brolls,music:restored.music}
const plan=validatePlan({unsupportedReason:null,summary:'Resume check',segments:[{sourceStart:0,sourceEnd:2,zoom:1.1}],brolls:[{index:1,start:0.5,duration:0.8,sourceStart:0}],captions:[{text:'Recovered edit',start:0,end:2}],titles:[],captionColor:'#ffffff',accentColor:'#d7af58',speechVolume:1,musicVolume:0.1,muteOutput:false},media)
const output=await renderPlan(target,plan,media,signal)
const meta=await probe(output,signal)
if(!meta.hasVideo||!meta.hasAudio)throw Error('Resume output missing video/audio')
console.log('PASS saved footage, B-roll, transcript and soundtrack restored and rendered:',output)
