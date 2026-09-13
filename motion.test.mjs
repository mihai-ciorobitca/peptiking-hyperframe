import test from 'node:test'
import assert from 'node:assert/strict'
import { animatePlan, cropTransform } from './motion.mjs'
import {buildComposition} from './composition.mjs'
const motion={zoomFrom:1,zoomTo:1.15,transitionSeconds:1,followFace:true,faceTrackId:null,targetX:.5,targetY:.5}
const frames=Array.from({length:21},(_,i)=>({time:i/5,faces:[{id:1,x:.3+i*.015,y:.4,w:.2,h:.2,motion:.2}]}))

test('chest-up crop fits face height and upper chest instead of applying a subtle wide-shot zoom',()=>{
 const tracked={width:1080,height:1920,frames:[{time:0,faces:[{id:1,x:.5,y:.3,w:.12,h:.08,motion:.2}]}]}
 const p=animatePlan({segments:[{sourceStart:0,sourceEnd:1,zoom:1,motion:{...motion,framing:'chest-up',zoomFrom:1,zoomTo:1}}]},tracked,{})
 const segment=p.segments[0],f=segment.keyframes[0]
 assert.equal(segment.bakedFraming,true)
 assert.ok(Math.abs(f.scale-4)<1e-8)
 const faceCenter=.3*f.height*f.scale+f.y
 assert.ok(faceCenter>500&&faceCenter<700,'face should sit above center with room for upper chest')
 assert.ok(f.x+f.width*f.scale>=1080&&f.y+f.height*f.scale>=1920)
})
test('face crop follows a moving subject and eases scale with no exposed borders',()=>{
 const plan=animatePlan({segments:[{sourceStart:0,sourceEnd:4,zoom:1,motion}]},{width:640,height:360,frames},{})
 const k=plan.segments[0].keyframes
 assert.equal(k[0].scale,1);assert.equal(k[5].scale,1.15)
 assert.notEqual(k[0].x,k.at(-1).x)
 for(const f of k){assert.ok(f.x<=0&&f.y<=0);assert.ok(f.x+f.width*f.scale>=1080-1e-8);assert.ok(f.y+f.height*f.scale>=1920-1e-8)}
 const inc=k[1].scale-k[0].scale, middle=k[3].scale-k[2].scale
 assert.ok(inc<middle,'zoom must ease in')
})
test('zoom out reaches exact endpoint and supports explicit off-center focal point',()=>{
 const p=animatePlan({segments:[{sourceStart:0,sourceEnd:1.2,zoom:1,motion:{...motion,zoomFrom:1.15,zoomTo:1,followFace:false,targetX:.8}}]},null,{width:1080,height:1920})
 assert.equal(p.segments[0].keyframes.at(-1).scale,1)
 assert.deepEqual(cropTransform(1080,1920,1,.8,.1),{width:1080,height:1920,scale:1,x:0,y:0})
})
test('face tracking cannot claim success with no matching visible face',()=>{
 assert.throws(()=>animatePlan({segments:[{sourceStart:0,sourceEnd:4,motion}]},{width:640,height:360,frames:[]},{}),/No visible face/)
 assert.throws(()=>animatePlan({segments:[{sourceStart:0,sourceEnd:4,motion:{...motion,faceTrackId:99}}]},{width:640,height:360,frames},{}),/No visible face/)
})
test('composition compiles scale and position keyframes on the source clip only',()=>{
 const p=animatePlan({duration:4,segments:[{sourceStart:0,sourceEnd:4,zoom:1,motion}],brolls:[],captions:[],titles:[],speechVolume:1,musicVolume:0,captionColor:'#ffffff',accentColor:'#aaaaaa'}, {width:640,height:360,frames},{})
 const html=buildComposition(p)
 assert.match(html,/transform-origin:0 0/);assert.match(html,/tl.to\('#main-0',\{x:/);assert.match(html,/ease:'none'/)
})

test('adjacent zoom segments keep a continuous crop position',()=>{
 const m={...motion,zoomFrom:1.12,zoomTo:1.12}
 const p=animatePlan({segments:[{sourceStart:0,sourceEnd:2,zoom:1.12,motion:m},{sourceStart:2,sourceEnd:4,zoom:1.12,motion:m}]},{width:640,height:360,frames},{})
 const end=p.segments[0].keyframes.at(-1),start=p.segments[1].keyframes[0]
 assert.equal(end.x,start.x);assert.equal(end.y,start.y);assert.equal(end.scale,start.scale)
})
