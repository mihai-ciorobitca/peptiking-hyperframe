import path from 'node:path'
import {mkdir} from 'node:fs/promises'
import {serviceDir,ffmpeg,run,probe} from './runtime.mjs'
import {animatePlan} from './motion.mjs'
import {renderPlan} from './worker.mjs'
const dir=path.join(serviceDir,'smoke-output/framing-test')
await mkdir(path.join(dir,'assets'),{recursive:true})
const signal=AbortSignal.timeout(180000)
await run(ffmpeg,['-y','-f','lavfi','-i','testsrc2=size=360x640:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','3','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',path.join(dir,'assets/main.mp4')],{signal})
await run(ffmpeg,['-y','-f','lavfi','-i','sine=frequency=880:sample_rate=44100','-t','1',path.join(dir,'assets/music.mp3')],{signal})
const motion={framing:'chest-up',zoomFrom:1,zoomTo:1.03,transitionSeconds:1,followFace:true,faceTrackId:1,targetX:.5,targetY:.5}
const tracks={width:360,height:640,frames:Array.from({length:16},(_,i)=>({time:i/5,faces:[{id:1,x:.5,y:.35,w:.15,h:.1,motion:.1}]}))}
const plan=animatePlan({duration:2,segments:[{sourceStart:.5,sourceEnd:1.5,zoom:1,motion},{sourceStart:2,sourceEnd:3,zoom:1,motion:null}],brolls:[],captions:[],titles:[],captionColor:'#ffffff',accentColor:'#d7af58',speechVolume:1,musicVolume:.1,muteOutput:false},tracks,{})
const file=await renderPlan(dir,plan,{main:{hasAudio:true},music:{duration:1}},signal)
const details=await probe(file,signal)
if(!details.hasAudio||Math.abs(details.duration-2)>.2)throw new Error('Framed source cuts lost duration or audio')
for(const frequency of [440,880]){
 const log=await run(ffmpeg,['-i',file,'-vn','-af',`bandpass=f=${frequency}:width_type=h:w=30,volumedetect`,'-f','null','-'],{signal})
 const level=Number(log.match(/mean_volume:\s*([-\d.]+) dB/)?.[1])
 if(!Number.isFinite(level)||level< -65)throw new Error(`Framing mix lost ${frequency} Hz audio`)
}
console.log('PASS baked chest-up crop, source cut, static action shot, duration and speech/music mix')
