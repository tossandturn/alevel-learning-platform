import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCoachJobStore } from '../server/coachJobStore.js'

const root=fs.mkdtempSync(path.join(os.tmpdir(),'coach-jobs-'))
let now=1000
let store=createCoachJobStore({root,now:()=>now,ttlMs:5000,maxActive:2,maxPerOwner:1,maxRows:4})
const args={owner:'ielts:1',id:'job-one-12345678',hash:'a'.repeat(64),scope:{attemptId:'attempt-1',context:{mode:'practice'}}}
assert.equal(store.begin(args).created,true)
assert.equal(store.begin(args).created,false,'same logical request must never generate twice')
assert.throws(()=>store.begin({...args,hash:'b'.repeat(64)}),e=>e.code==='coach_job_conflict')
assert.throws(()=>store.get('ielts:2',args.id),e=>e.statusCode===404)
assert.throws(()=>store.begin({...args,id:'job-two-12345678'}),e=>e.statusCode===429)
store.update(args.owner,args.id,{answer:'partial',stage:'arranging'})
assert.equal(store.get(args.owner,args.id).answer,'partial')
store.finish(args.owner,args.id,{mode:'ai',providerStatus:'connected',answer:'complete',answerStatus:'complete'})
assert.equal(store.get(args.owner,args.id).status,'succeeded')
assert.equal(store.begin(args).created,false)
store.begin({...args,id:'job-two-12345678'})
store.close()
store=createCoachJobStore({root,now:()=>now,ttlMs:5000})
assert.equal(store.get(args.owner,args.id).result.answer,'complete','completed results survive process restart')
assert.equal(store.get(args.owner,'job-two-12345678').status,'interrupted','restart never silently launches a second paid generation')
assert.equal(store.get(args.owner,args.id).scope,undefined,'internal authorization scope stays private')
now=7000
assert.throws(()=>store.get(args.owner,args.id),e=>e.statusCode===404)
store.close()
fs.rmSync(root,{recursive:true}) // Only this test's mkdtemp fixture.
console.log('PASS Coach job store: idempotency, ownership, restart, expiry, quotas.')
