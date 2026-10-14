import assert from 'node:assert/strict'
import {
  createVerifiedPracticeClient,
  requestStudyQuestionGroups,
} from '../src/lib/verifiedPracticeClient.js'
import { loadStudyQuestionGroupsForRoute } from '../src/lib/studyQuestionRuntime.js'
import {
  MAX_PRACTICE_ACCESS_LEASE_MS,
  assertPracticeAccessCurrent,
  createProtectedContentLease,
  createPracticeAccessSnapshot,
  practiceDraftFromAttempt,
  protectedUnitNeedsAccessRefresh,
  resolveStoredPracticeAttemptId,
  resolveProtectedUnits,
} from '../src/lib/practiceAccessLease.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const discovery = {
  schemaVersion: 'verified-practice-discovery-v1',
  sourceVersion: 'a'.repeat(64),
  routes: [{ routeId: 'cie-9702-as-physics', subjectId: 'physics', qualificationId: 'cambridge-9702', qualification: 'A-Level', code: '9702', label: 'AS 9702 Physics', stage: 'AS', topics: [{ id: 'physics-9702-waves', routeId: 'cie-9702-as-physics', label: 'Waves', stageTags: ['AS'], inventory: 10, inventoryByStage: { AS: 10 } }] }],
  units: [{ id: 'past-paper-set:cie-9702-as-physics:physics-9702-waves:set-1', type: 'topic', discoveryOnly: true, routeId: 'cie-9702-as-physics', qualification: 'A-Level', subject: 'Physics', subjectId: 'physics', qualificationId: 'cambridge-9702', knowledgeGroupId: 'physics-9702-waves', topicId: 'physics-9702-waves', topic: 'Waves', title: 'AS Physics · Waves · Set 1', stage: 'AS', paperComponent: [1, 2], durationSec: 2400, maxMarks: 20, difficulty: 'Past paper', estimatedMinutes: 40, priority: 'Start here', inventoryStatus: 'verified-source-inventory', questionGroupCount: 10, answerPartCount: 12, paperCount: 2, sourceSetIndex: 1, sourceSetCount: 1, startable: true }],
}
const fullUnit = { ...discovery.units[0], discoveryOnly: false, sourceAuthority: 'server-verified', sourceGateStatus: 'current', parts: [{ id: 'part-1', sourceKind: 'past-paper', sourceQuestionId: 'q1', questionPartId: 'a', marks: 1, answerKey: 'A' }] }
const calls = []
const fetchImpl = async (url, options = {}) => {
  calls.push({ url: String(url), options })
  const pathname = new URL(String(url), 'https://stem.ieltsist.com').pathname
  if (pathname === '/api/stem/verified-practice/catalog') return new Response(JSON.stringify(discovery), { status: 200, headers: { 'content-type': 'application/json' } })
  if (pathname.startsWith('/api/stem/verified-practice/units/')) return new Response(JSON.stringify({ schemaVersion: 'verified-practice-unit-v1', sourceVersion: discovery.sourceVersion, unit: fullUnit }), { status: 200, headers: { 'content-type': 'application/json' } })
  if (pathname === '/api/stem/verified-practice/generate' || pathname === '/api/stem/verified-practice/rebind') return new Response(JSON.stringify({ schemaVersion: 'verified-practice-unit-v1', sourceVersion: discovery.sourceVersion, unit: fullUnit }), { status: 200, headers: { 'content-type': 'application/json' } })
  if (pathname.includes('/marking-context')) return new Response(JSON.stringify({ schemaVersion: 'paper-marking-context-v1', sourceVersion: discovery.sourceVersion, paperId: 'paper-1', routeId: 'cie-9702-as-physics', questions: {} }), { status: 200, headers: { 'content-type': 'application/json' } })
  if (pathname.startsWith('/api/stem/study-question-index/')) return new Response(JSON.stringify({ schemaVersion: 'study-question-fragment-v1', routeId: 'cie-9702-as-physics', sourceIndexSha256: 'b'.repeat(64), questions: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
  return new Response(JSON.stringify({ code: 'not_found' }), { status: 404, headers: { 'content-type': 'application/json' } })
}

const client = createVerifiedPracticeClient({ fetchImpl, token: 'member-token' })
const loaded = await client.catalog()
assert.deepEqual(loaded, discovery)
assert.equal(client.resolveSelection({ routeId: 'cie-9702-as-physics', topicId: 'physics-9702-waves' }).group.id, 'physics-9702-waves')
assert.equal(client.resolveSelection({ subjectId: 'physics', stage: 'AS', topicId: 'physics-9702-waves' }).subject.routeId, 'cie-9702-as-physics')
assert.equal((await client.unit(discovery.units[0].id)).id, fullUnit.id)
assert.equal((await client.generate({ routeId: 'cie-9702-as-physics', knowledgeGroupId: 'physics-9702-waves', questionCount: 10 })).id, fullUnit.id)
assert.equal((await client.rebind(fullUnit)).sourceGateStatus, 'current')
assert.equal((await client.markingContext({ paperId: 'paper-1', routeId: 'cie-9702-as-physics' })).paperId, 'paper-1')
assert.ok(calls.filter((call) => call.url.includes('/api/stem/verified-practice/') && !call.url.endsWith('/catalog')).every((call) => call.options.headers.Authorization === 'Bearer member-token'))
assert.equal(calls.find((call) => call.url.endsWith('/catalog')).options.credentials, 'same-origin')

await requestStudyQuestionGroups({ routeId: 'cie-9702-as-physics', token: 'member-token', fetchImpl })
assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer member-token')

const guestCalls = []
const guest = createVerifiedPracticeClient({ fetchImpl: async (url, options) => { guestCalls.push({ url, options }); return fetchImpl(url, options) }, token: '' })
await guest.unit(discovery.units[0].id)
assert.equal(guestCalls.at(-1).options.credentials, 'same-origin', 'safe-off guest keeps the existing cookie/anonymous request path')
assert.ok(!guestCalls.at(-1).options.headers?.Authorization)

const firstAccess = createPracticeAccessSnapshot('student-1\ntoken-a', 1)
const sameAccess = createPracticeAccessSnapshot('student-1\ntoken-a', 1)
const rotatedAccess = createPracticeAccessSnapshot('student-1\ntoken-b', 2)
assert.equal(MAX_PRACTICE_ACCESS_LEASE_MS, 30_000)
assert.equal(assertPracticeAccessCurrent(firstAccess, sameAccess), true)
assert.throws(
  () => assertPracticeAccessCurrent(firstAccess, rotatedAccess),
  (error) => error.code === 'account_changed' && error.statusCode === 409,
  'an old owner/token generation cannot commit protected content into the new account state',
)
const leaseUnit = { id: 'unit-a', sourceAuthority: 'server-verified', parts: [{ sourceKind: 'past-paper' }] }
const lease = createProtectedContentLease(firstAccess, () => 1_000)
assert.equal(protectedUnitNeedsAccessRefresh(leaseUnit, lease, sameAccess, { now: () => 31_000 }), false, 'a just-in-window lease may complete the same protected restore')
assert.equal(protectedUnitNeedsAccessRefresh(leaseUnit, lease, sameAccess, { now: () => 31_001 }), true, 'a protected restore must rebind after at most 30 seconds')
assert.equal(protectedUnitNeedsAccessRefresh(leaseUnit, lease, rotatedAccess, { now: () => 1_001 }), true, 'owner/token generation rotation invalidates the lease immediately')
assert.equal(protectedUnitNeedsAccessRefresh({ id: 'public', parts: [] }, null, rotatedAccess), false, 'public discovery metadata does not invent a protected lease')
const persistedAttempt = { id: 'att-owned-1', unitId: 'unit-a', startedAt: '2026-10-14T00:00:00.000Z', routeId: 'cie-9702-as-physics', stage: 'AS', answers: { part: 'LOCAL QA' }, working: {}, evidence: {}, elapsedSec: 15, activePartId: 'part', settings: { mode: 'practice' } }
const persistedDraft = practiceDraftFromAttempt(persistedAttempt, { updatedAt: '2026-10-14T00:00:15.000Z' })
assert.equal(persistedDraft.attemptId, persistedAttempt.id, 'every autosave retains the attempt binding')
assert.equal(persistedDraft.startedAt, persistedAttempt.startedAt, 'every autosave retains the attempt start identity')
assert.equal(resolveStoredPracticeAttemptId({ draft: persistedDraft, navigationAttemptId: persistedAttempt.id, unit: { id: 'unit-a', routeId: persistedAttempt.routeId } }), persistedAttempt.id)
assert.equal(resolveStoredPracticeAttemptId({ draft: { ...persistedDraft, attemptId: undefined }, navigationAttemptId: persistedAttempt.id, unit: { id: 'unit-a', routeId: persistedAttempt.routeId } }), persistedAttempt.id, 'a legacy timer-damaged draft may recover only the explicit same-unit URL attempt binding')
assert.throws(() => resolveStoredPracticeAttemptId({ draft: { ...persistedDraft, attemptId: undefined }, navigationAttemptId: persistedAttempt.id, unit: { id: 'unit-a', routeId: 'cie-9702-a2-physics' } }), /route|binding/i)
assert.throws(() => resolveStoredPracticeAttemptId({ draft: persistedDraft, navigationAttemptId: 'att-other', unit: { id: 'unit-a', routeId: persistedAttempt.routeId } }), /binding/i)
assert.throws(() => resolveStoredPracticeAttemptId({ draft: { ...persistedDraft, attemptId: undefined }, navigationAttemptId: persistedAttempt.id, unit: { id: 'unit-a', routeId: persistedAttempt.routeId }, knownBindings: [{ attemptId: persistedAttempt.id, unitId: 'unit-b' }] }), /another question set|binding/i)

const reboundUnits = await resolveProtectedUnits(
  [{ id: 'unit-a' }, { id: 'unit-b' }],
  async (unit) => ({ ...unit, sourceGateStatus: 'current' }),
  { expectedAccess: firstAccess, currentAccess: () => sameAccess },
)
assert.deepEqual([...reboundUnits.keys()], ['unit-a', 'unit-b'])
const membershipFailure = Object.assign(new Error('Membership expired.'), { code: 'membership_required', statusCode: 403 })
await assert.rejects(
  () => resolveProtectedUnits(
    [{ id: 'unit-a' }, { id: 'unit-b' }],
    async (unit) => {
      if (unit.id === 'unit-b') throw membershipFailure
      return { ...unit, sourceGateStatus: 'current' }
    },
    { expectedAccess: firstAccess, currentAccess: () => sameAccess },
  ),
  (error) => error === membershipFailure,
  'a protected rebind denial remains an actionable 403 instead of becoming a missing unit',
)
let releaseOldOwner
let currentOldOwnerAccess = sameAccess
const oldOwnerPending = resolveProtectedUnits(
  [{ id: 'unit-a' }],
  () => new Promise((resolve) => { releaseOldOwner = resolve }),
  { expectedAccess: firstAccess, currentAccess: () => currentOldOwnerAccess },
)
await Promise.resolve()
currentOldOwnerAccess = rotatedAccess
releaseOldOwner({ id: 'unit-a', sourceGateStatus: 'current' })
await assert.rejects(
  () => oldOwnerPending,
  (error) => error.code === 'account_changed',
  'a late protected response cannot repopulate a cache after owner/token rotation',
)
let rejectOldOwner
currentOldOwnerAccess = sameAccess
const oldOwnerDenied = resolveProtectedUnits(
  [{ id: 'unit-a' }],
  () => new Promise((_resolve, reject) => { rejectOldOwner = reject }),
  { expectedAccess: firstAccess, currentAccess: () => currentOldOwnerAccess },
)
await Promise.resolve()
currentOldOwnerAccess = rotatedAccess
rejectOldOwner(membershipFailure)
await assert.rejects(
  () => oldOwnerDenied,
  (error) => error.code === 'account_changed',
  'a late old-owner denial cannot surface a stale membership error in the replacement account',
)

const malformed = createVerifiedPracticeClient({
  token: '',
  fetchImpl: async () => new Response(JSON.stringify({ ...discovery, units: [{ ...discovery.units[0], answerKey: 'A' }] }), { status: 200, headers: { 'content-type': 'application/json' } }),
})
await assert.rejects(() => malformed.catalog(), /invalid|protected|unexpected/i)

let now = 0
let routeFetches = 0
const refreshableFetch = async (url) => {
  routeFetches += 1
  const routeId = decodeURIComponent(String(url).split('/').at(-1))
  return new Response(JSON.stringify({ schemaVersion: 'study-question-fragment-v1', routeId, sourceIndexSha256: String(routeFetches).padStart(64, '0'), questions: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
}
await loadStudyQuestionGroupsForRoute('refreshable-route', [], { fetchImpl: refreshableFetch, accessKey: 'student-1', now: () => now, cacheTtlMs: 30_000 })
await loadStudyQuestionGroupsForRoute('refreshable-route', [], { fetchImpl: refreshableFetch, accessKey: 'student-1', now: () => now, cacheTtlMs: 30_000 })
assert.equal(routeFetches, 1)
now = 30_001
await loadStudyQuestionGroupsForRoute('refreshable-route', [], { fetchImpl: refreshableFetch, accessKey: 'student-1', now: () => now, cacheTtlMs: 30_000 })
assert.equal(routeFetches, 2, 'an existing web build revalidates route content after the bounded cache window')

const generationOne = createPracticeAccessSnapshot('student-1\ntoken-a', 1)
const generationTwo = createPracticeAccessSnapshot('student-1\ntoken-b', 2)
await loadStudyQuestionGroupsForRoute('generation-route', [], { fetchImpl: refreshableFetch, accessKey: generationOne.cacheKey, now: () => now, cacheTtlMs: MAX_PRACTICE_ACCESS_LEASE_MS })
await loadStudyQuestionGroupsForRoute('generation-route', [], { fetchImpl: refreshableFetch, accessKey: generationTwo.cacheKey, now: () => now, cacheTtlMs: MAX_PRACTICE_ACCESS_LEASE_MS })
assert.equal(routeFetches, 4, 'same-owner credential rotation receives a distinct bounded route-fragment lease')

const appSource = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8')
assert.doesNotMatch(appSource, /const existing = resolvedVerifiedUnits\.get\(unitId\)[\s\S]{0,80}if \(existing\) return existing/, 'a resolved unit must not bypass a fresh server access check')
assert.match(appSource, /practiceAccessGenerationRef/, 'protected async work is bound to an owner/token generation')
assert.match(appSource, /resolveProtectedUnits/, 'persisted protected units use the fail-closed rebind batch')
assert.match(appSource, /verifiedRebindState\.status === 'error'/, 'a failed deep-link rebind remains visible and retryable')
assert.match(appSource, /ensureStudyQuestionRuntime[\s\S]{0,1800}accessKey: requestedAccess\.cacheKey[\s\S]{0,800}current\(\)[\s\S]{0,300}setStudyQuestionRuntimeState/, 'late study-index responses are checked against the current owner/token generation before state commit')
assert.match(appSource, /generateCoachPractice[\s\S]{0,700}const requestedAccess[\s\S]{0,500}runtime\.client\.generate[\s\S]{0,300}assertPracticeAccessCurrent[\s\S]{0,300}setResolvedVerifiedUnits[\s\S]{0,500}setAppState/, 'generated protected units must recheck owner/token after await and before cache or draft state writes')
assert.match(appSource, /generateSyllabusPractice[\s\S]{0,1000}requestSyllabusPracticeSet[\s\S]{0,500}assertPracticeAccessCurrent[\s\S]{0,500}setSyllabusRebindState/, 'server-syllabus generation must recheck owner/token before cache or draft state writes')
assert.match(appSource, /requiresProtectedValidation[\s\S]{0,500}resolveVerifiedUnit\(unit\)/, 'starting an already-resolved server unit must obtain a fresh server validation instead of trusting the render cache')
assert.doesNotMatch(appSource, /persistedVerifiedUnits\.map[\s\S]{0,300}catch\s*\{\s*return null/, '401/403/503 persisted rebind failures must not be converted into a missing unit')
assert.match(appSource, /resolveSyllabusUnit[\s\S]{0,1000}requestSyllabusPracticeRebind[\s\S]{0,300}assertPracticeAccessCurrent/, 'starting a cached server-syllabus unit also receives a fresh owner-bound server rebind')
assert.match(appSource, /syllabusRebindState\.status === 'error'/, 'a failed syllabus deep-link rebind is visible and retryable without deleting its draft')
assert.doesNotMatch(appSource, /persistedSyllabusUnits\.map[\s\S]{0,300}catch\s*\{\s*return null/, 'syllabus rebind denials must not be converted into a missing unit')
assert.match(appSource, /navigation\.view === 'practice'[\s\S]{0,2200}needsProtectedUnitRefresh[\s\S]{0,900}resolve(?:Syllabus|Verified)Unit/, 'practice history/deep-link restore must refresh an expired protected lease before rebuilding the attempt')
assert.match(appSource, /window\.setInterval[\s\S]{0,800}practiceDraftFromAttempt/, 'the periodic practice autosave must retain the exact attempt binding')

console.log('Browser verified-practice client keeps discovery public and sends bearer only to protected content routes.')
