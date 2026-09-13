import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, mkdir, cp, writeFile, rm } from 'node:fs/promises'
import { restorePreparedEdit } from './recovery.mjs'

test('resume rejects invalid checkpoint paths and attempts', async () => {
  for (const [id,attempt] of [['../escape',1],['safe',0],['safe',2]]) {
    await assert.rejects(restorePreparedEdit({job_id:id,attempts:2,payload:{resumeAttempt:attempt}}, {projectsDir:os.tmpdir()}, os.tmpdir(), AbortSignal.timeout(1000)), /Invalid resume/)
  }
})
test('missing checkpoint fails without acquiring replacements', async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),'hf-recovery-'))
  try { await assert.rejects(restorePreparedEdit({job_id:'missing',attempts:2,payload:{resumeAttempt:1}}, {projectsDir:root},path.join(root,'missing-2'),AbortSignal.timeout(1000)), /No new B-roll was generated/) }
  finally { await rm(root,{recursive:true,force:true}) }
})
