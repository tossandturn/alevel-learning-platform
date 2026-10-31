import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createCoachJobStore, DEFAULT_COACH_JOB_MAX_ROWS } from '../server/coachJobStore.js'

const Database = process.getBuiltinModule('node:sqlite').DatabaseSync
const owner = 'ielts:7101'
const ownerHash = crypto.createHash('sha256').update(owner).digest('hex')
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
const scope = { feature: 'answers', helpIntent: 'hint', context: { attemptId: 'attempt-fixture' } }
const profile = (extra = {}) => ({
  requestedEffort: null,
  effectiveEffort: 'low',
  thinkingEnabled: true,
  inputKind: 'text',
  imageCount: 0,
  helpIntent: 'hint',
  provider: 'deepseek',
  model: 'deepseek-v4.1-flash',
  saved: true,
  retentionMs: 259_200_000,
  ...extra,
})
const result = (answer = 'Synthetic answer.') => ({ mode: 'ai', provider: 'deepseek', providerStatus: 'connected', model: 'deepseek-v4.1-flash', answer, timing: { version: 1 } })
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-task-store-'))
assert.equal(DEFAULT_COACH_JOB_MAX_ROWS,4096)
let now = 1_800_000_000_000
let store = null
let capacity = null
let capacityRoot = ''
let inspection = null

try {
  const legacyFile = path.join(root, 'academic-coach-jobs.sqlite')
  fs.mkdirSync(root, { recursive: true })
  const legacy = new Database(legacyFile)
  legacy.exec(`CREATE TABLE coach_jobs (
    owner TEXT NOT NULL, id TEXT NOT NULL, request_hash TEXT NOT NULL, scope TEXT NOT NULL,
    status TEXT NOT NULL, stage TEXT NOT NULL, answer TEXT NOT NULL DEFAULT '', result TEXT,
    created INTEGER NOT NULL, updated INTEGER NOT NULL, expires INTEGER NOT NULL,
    PRIMARY KEY(owner,id));`)
  legacy.prepare("INSERT INTO coach_jobs(owner,id,request_hash,scope,status,stage,answer,result,created,updated,expires) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .run(ownerHash, 'cj-legacyTask123456789', hash('legacy'), JSON.stringify(scope), 'succeeded', 'complete', 'Legacy answer', JSON.stringify(result('Legacy answer')), now - 1000, now - 500, now + 12_345)
  legacy.prepare("INSERT INTO coach_jobs(owner,id,request_hash,scope,status,stage,answer,result,created,updated,expires) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .run(ownerHash, 'cj-legacyRunning1234567', hash('legacy-running'), JSON.stringify(scope), 'running', 'analysis', '', null, now - 800, now - 700, now + 12_345)
  legacy.close()

  store = createCoachJobStore({ root, now: () => now })
  const legacySnapshot = store.get(owner, 'cj-legacyTask123456789')
  assert.equal(legacySnapshot.expiresAt, now + 12_345, 'migration must not rewrite old expiry')
  assert.equal(legacySnapshot.serverNow, now)
  assert.equal(legacySnapshot.task.schemaVersion, 'stem-coach-task-v1')
  assert.equal(legacySnapshot.task.estimate.source.kind, 'legacy')
  assert.equal(legacySnapshot.task.persistence.saved, false)
  const interruptedLegacy = store.get(owner, 'cj-legacyRunning1234567')
  assert.equal(interruptedLegacy.status, 'interrupted')
  assert.equal(interruptedLegacy.task.stage.code, 'interrupted')

  const firstId = 'cj-taskProgress123456789'
  const accepted = store.begin({ owner, id: firstId, hash: hash(firstId), scope, taskProfile: profile() })
  assert.equal(accepted.serverNow, now)
  assert.equal(accepted.expiresAt, now + 259_200_000)
  assert.deepEqual(accepted.task.persistence, { saved: true, retentionMs: 259_200_000 })
  assert.equal(accepted.task.stage.code, 'accepted')
  assert.deepEqual(accepted.task.reasoning, { requestedEffort: null, effectiveEffort: 'low', enabled: true, activityObserved: false })
  assert.equal(accepted.task.estimate.status, 'initial')
  assert.equal(accepted.task.estimate.source.kind, 'initial')
  const taskStart=now
  store.progress(owner, firstId, { type: 'preparing', at: taskStart + 10 })
  store.progress(owner, firstId, { type: 'requesting_model', at: taskStart + 20, provider: 'deepseek', model: 'deepseek-v4.1-flash' })
  store.progress(owner, firstId, { type: 'response_headers', at: taskStart + 30 })
  store.progress(owner, firstId, { type: 'reasoning_activity', at: taskStart + 40 })
  const reasoningUpdated=store.get(owner,firstId).updatedAt;now+=1
  store.progress(owner, firstId, { type: 'reasoning_activity', at: taskStart + 41 })
  assert.equal(store.get(owner, firstId).task.stage.changedAt, taskStart + 40, 'reasoning stage persists only its first observed activity')
  assert.equal(store.get(owner,firstId).updatedAt,reasoningUpdated,'duplicate reasoning activity does not write SQLite')
  store.progress(owner, firstId, { type: 'answer_delta', at: taskStart + 50 })
  const answerUpdated=store.get(owner,firstId).updatedAt;now+=1
  store.progress(owner, firstId, { type: 'answer_delta', at: taskStart + 55 })
  assert.equal(store.get(owner, firstId).task.stage.changedAt, taskStart + 50, 'answer stage is not rewritten for every delta')
  assert.equal(store.get(owner,firstId).updatedAt,answerUpdated,'duplicate answer activity does not write SQLite')
  store.progress(owner, firstId, { type: 'finalizing', at: taskStart + 60 })
  now += 10_000
  store.finish(owner, firstId, result())
  const completed = store.get(owner, firstId)
  assert.equal(completed.task.stage.code, 'complete')
  assert.equal(completed.task.reasoning.activityObserved, true)
  assert.equal(completed.task.milestones.reasoningActivityAt, 1_800_000_000_040)
  assert.equal(completed.task.milestones.firstAnswerAt, 1_800_000_000_050)
  assert.equal(completed.task.estimate.status, 'complete')
  assert.doesNotMatch(JSON.stringify(completed.task), /Synthetic answer|reasoning_content|Bearer|data:image/)

  // Five exact-cohort successes calibrate the sixth task; other cohorts do not contribute.
  const durations = [8_000, 10_000, 12_000, 16_000, 20_000]
  for (const [index, duration] of durations.entries()) {
    const id = `cj-cohort${index}123456789012`
    const started = now += 1000
    store.begin({ owner, id, hash: hash(id), scope, taskProfile: profile() })
    now = started + duration
    store.finish(owner, id, result(`Answer ${index}`))
  }
  const excludedId = 'cj-excludedHigh123456789'
  store.begin({ owner, id: excludedId, hash: hash(excludedId), scope, taskProfile: profile({ requestedEffort: 'high', effectiveEffort: 'high' }) })
  now += 90_000
  store.finish(owner, excludedId, result('High answer'))

  const calibratedId = 'cj-calibrated1234567890'
  const calibrated = store.begin({ owner, id: calibratedId, hash: hash(calibratedId), scope, taskProfile: profile() })
  assert.equal(calibrated.task.estimate.status, 'calibrated')
  assert.equal(calibrated.task.estimate.source.kind, 'cohort')
  assert.equal(calibrated.task.estimate.source.sampleCount, 6)
  assert.equal(calibrated.task.estimate.source.maxSamples, 20)
  assert.equal(calibrated.task.estimate.source.method, 'p25-p90')
  assert.deepEqual(calibrated.task.estimate.source.dimensions, { model: 'deepseek-v4.1-flash', effort: 'low', inputKind: 'text', helpIntent: 'hint' })
  now += calibrated.task.estimate.totalMs.upper + 1
  const exceeded = store.get(owner, calibratedId)
  assert.equal(exceeded.task.estimate.status, 'exceeded')
  assert.equal(exceeded.task.estimate.remainingMs, null)
  assert.ok(exceeded.task.estimate.exceededByMs >= 1)
  assert.equal(Object.hasOwn(exceeded.task.estimate, 'percent'), false)

  const page = store.listCandidates(owner, { limit: 2 })
  assert.equal(page.items.length, 2)
  assert.ok(page.nextCursor)
  const secondPage = store.listCandidates(owner, { limit: 2, cursor: page.nextCursor })
  assert.ok(secondPage.items.length > 0)
  assert.ok(secondPage.items.every(item => !['answer', 'result', 'scope', 'request_hash'].some(key => Object.hasOwn(item.snapshot, key))))

  const instantId = 'cj-instant1234567890123'
  store.fail(owner, calibratedId)
  const instant = store.begin({ owner, id: instantId, hash: hash(instantId), scope, taskProfile: profile({ saved: false, retentionMs: 600_000 }) })
  assert.deepEqual(instant.task.persistence, { saved: false, retentionMs: 600_000 })
  assert.equal(instant.expiresAt, now + 600_000)
  now += 1000
  store.finish(owner, instantId, result('Instant answer'))
  assert.ok(store.listCandidates(owner, { limit: 60 }).items.every(item => item.snapshot.id !== instantId), 'instant jobs never enter saved task history')

  const expiringId = 'cj-expiring123456789012'
  store.begin({ owner, id: expiringId, hash: hash(expiringId), scope, taskProfile: profile() })
  const expiring = store.get(owner, expiringId)
  now = expiring.expiresAt + 1
  assert.throws(() => store.get(owner, expiringId), error => error.statusCode === 404)

  const restartInstantId='cj-instantRestart12345678',restartInstantHash=hash(restartInstantId)
  store.begin({owner,id:restartInstantId,hash:restartInstantHash,scope,taskProfile:profile({saved:false,retentionMs:600_000,persistenceMode:'instant'})})
  now+=1000;store.finish(owner,restartInstantId,result('RAM-only instant answer'))
  assert.match(store.get(owner,restartInstantId).answer,/RAM-only/)
  store.close()
  store = null

  inspection = new Database(legacyFile)
  const columns = new Set(inspection.prepare('PRAGMA table_info(coach_jobs)').all().map(column => column.name))
  for (const name of ['task_json', 'model', 'effort', 'thinking_enabled', 'input_kind', 'help_intent', 'duration_ms', 'completed', 'saved_task']) assert.ok(columns.has(name), `missing migration column ${name}`)
  const tombstone=inspection.prepare('SELECT scope,answer,result,task_json,model,effort,input_kind,help_intent,saved_task FROM coach_jobs WHERE id=?').get(restartInstantId)
  assert.deepEqual({...tombstone},{scope:'{}',answer:'',result:null,task_json:null,model:null,effort:null,input_kind:null,help_intent:null,saved_task:0},'instant SQLite tombstone contains no binding, answer, result, prompt, image or task details')
  const sampleColumns=new Set(inspection.prepare('PRAGMA table_info(coach_job_duration_samples)').all().map(column=>column.name))
  for(const forbidden of ['owner','job_id','request_hash','answer','result','scope','task_json'])assert.equal(sampleColumns.has(forbidden),false,`anonymous duration sample leaked ${forbidden}`)
  assert.ok(inspection.prepare('SELECT COUNT(*) AS n FROM coach_job_duration_samples').get().n>=1,'instant AI completion contributes only an anonymous duration sample')
  inspection.close();inspection=null

  store=createCoachJobStore({root,now:()=>now})
  const afterRestart=store.get(owner,restartInstantId)
  assert.equal(afterRestart.status,'interrupted')
  assert.equal(afterRestart.answer,'')
  assert.equal(Object.hasOwn(afterRestart,'result'),false)
  assert.deepEqual(afterRestart.task.persistence,{saved:false,retentionMs:600_000})
  const replay=store.begin({owner,id:restartInstantId,hash:restartInstantHash,scope,taskProfile:profile({saved:false,retentionMs:600_000,persistenceMode:'instant'})})
  assert.equal(replay.created,false,'restart tombstone prevents duplicate paid generation')
  store.close();store=null

  capacityRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-task-capacity-'))
  capacity = createCoachJobStore({ root: capacityRoot, now: () => now, maxRows: 2, maxActive: 1 })
  const activeInstant='cj-capacityInstant1234567'
  capacity.begin({owner,id:activeInstant,hash:hash(activeInstant),scope,taskProfile:profile({saved:false,retentionMs:600_000,persistenceMode:'instant'})})
  assert.throws(()=>capacity.begin({owner,id:'cj-capacitySameOwner12345',hash:hash('same-owner'),scope,taskProfile:profile()}),error=>error.statusCode===429,'per-owner active limit spans instant and saved jobs')
  assert.throws(()=>capacity.begin({owner:'ielts:7102',id:'cj-capacityOtherOwner1234',hash:hash('other-owner'),scope,taskProfile:profile()}),error=>error.statusCode===429,'global active limit spans instant and saved jobs')
  now+=1000;capacity.finish(owner,activeInstant,result('Instant capacity answer'))
  const savedCapacity='cj-capacitySaved123456789'
  capacity.begin({owner,id:savedCapacity,hash:hash(savedCapacity),scope,taskProfile:profile()})
  now+=1000;capacity.finish(owner,savedCapacity,result())
  assert.throws(() => capacity.begin({ owner, id: 'cj-capacityBlocked123456', hash: hash('blocked'), scope, taskProfile: profile() }), error => error.statusCode === 429 && error.code === 'coach_job_busy')
  assert.equal(capacity.get(owner,activeInstant).status,'succeeded','unexpired instant tombstone is not deleted to make room')
  assert.equal(capacity.listCandidates(owner, { limit: 20 }).items.length, 1, 'only saved jobs enter history and unexpired rows are not deleted to make room')
  capacity.close()
  capacity = null
  fs.rmSync(capacityRoot, { recursive: true, force: true })
  capacityRoot = ''

  console.log('PASS Coach task store: additive migration, legacy/instant/saved retention, stages, calibrated/exceeded estimates, cursor list and bounded capacity')
} finally {
  try { store?.close() } catch {}
  try { capacity?.close() } catch {}
  try { inspection?.close() } catch {}
  if (capacityRoot) fs.rmSync(capacityRoot, { recursive: true, force: true })
  fs.rmSync(root, { recursive: true, force: true })
}
