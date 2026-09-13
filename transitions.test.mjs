import test from 'node:test'
import assert from 'node:assert/strict'
import {validatePlan} from './plan.mjs'
const media={main:{duration:5},brolls:[{duration:3},{duration:3},{duration:3}]}
const plan={segments:[{sourceStart:0,sourceEnd:5,zoom:1}],brolls:[{index:1,start:.5,duration:2.1,sourceStart:0,transitionIn:{type:'cross-dissolve',duration:.6}},{index:2,start:2,duration:2,sourceStart:0,transitionIn:{type:'cross-dissolve',duration:.6}}],captions:[],titles:[],captionColor:'#ffffff',accentColor:'#ffffff',musicVolume:0,speechVolume:1,muteOutput:false}
test('dissolve overlap preserves source durations and output length',()=>{
 const p=validatePlan(plan,media);assert.equal(p.duration,5);assert.equal(p.brolls[1].duration,2);assert.equal(p.brolls[0].sourceStart,0)
})
test('invalid transitions and triple overlaps fail before rendering',()=>{
 for(const transition of [{type:'zoom-wipe',duration:.6},{type:'cross-dissolve',duration:3},{type:'cross-dissolve',duration:-1},{type:'cut',duration:0}]){
  const p=structuredClone(plan);p.brolls[1].transitionIn=transition;assert.throws(()=>validatePlan(p,media),/transition|cross-dissolve/)
 }
 const p=structuredClone(plan);p.brolls.push({index:3,start:2.2,duration:2,sourceStart:0,transitionIn:{type:'cross-dissolve',duration:.6}});assert.throws(()=>validatePlan(p,media),/two-clip cross-dissolve/)
})
