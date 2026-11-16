import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { createAiStudyDualRootLoader } from '../server/aiStudyDualRoot.js'
import { createAiVerifiedQuestionBankLoader } from '../server/aiVerifiedQuestionBank.js'

const MATH = 'cie-9709-as-p1-p5'
const MATH_OTHER = 'cie-9709-as-p1-p4'
const PHYSICS = 'cie-9702-as-physics'
const BIOLOGY = 'cie-9700-as-biology'
const INVALID = 'AI_STUDY_PROMOTION_INVALID'
const REQUIRED = 'AI_STUDY_PROMOTION_REQUIRED'
const BLOCKED = 'AI_STUDY_CANDIDATE_BLOCKED'
const hash = (character) => character.repeat(64)

function group(routeId, subjectCode, sourceQuestionId, extra = {}) {
  return { routeId, subjectCode, sourceQuestionId, ...extra }
}

function doc(subject, file, sha256 = hash('a'), bytes = 123, extra = {}) {
  return { subject, file, sha256, bytes, ...extra }
}

function snapshots() {
  return {
    legacy: {
      groups: [
        group(PHYSICS, '9702', 'physics-q1'),
        group(BIOLOGY, '9700', 'biology-q1'),
        group(MATH, '9709', 'math-legacy-q1', { content: { text: 'legacy' } }),
      ],
      documents: [
        doc('9702', 'physics.pdf'),
        doc('9700', 'biology.pdf', hash('b')),
        doc('9709', 'math-legacy.pdf', hash('c'), 345, { year: 2020 }),
      ],
    },
    candidate: {
      groups: [group(MATH, '9709', 'math-candidate-q1', { content: { text: 'candidate' } })],
      documents: [doc('9709', 'math-candidate.pdf', hash('d'), 456)],
    },
  }
}

function loader(legacy, candidateLoader, candidateRouteIds = [MATH]) {
  return createAiStudyDualRootLoader({
    legacyLoader: () => legacy,
    candidateLoader,
    candidateRouteIds,
  })
}

function expectUnavailable(load, legacy, code = INVALID) {
  for (const scope of [{}, { routeId: PHYSICS }, { routeId: BIOLOGY }, { subject: '9702' }, { subject: 'Biology' }]) {
    const result = load(scope)
    assert.deepEqual(result, { groups: legacy.groups, documents: legacy.documents, complete: false, candidateErrorCode: code })
    assert.notStrictEqual(result.groups, legacy.groups)
    assert.notStrictEqual(result.documents, legacy.documents)
  }
  for (const scope of [{ routeId: MATH }, { subject: '9709' }, { subject: 'math-9709' }, { subject: 'Mathematics' }, { routeId: PHYSICS, subject: '9709' }]) {
    assert.throws(() => load(scope), (error) => error.statusCode === 503 && error.code === code)
  }
}

test('absent candidate returns a complete, independent copy of the full legacy snapshot', () => {
  const { legacy } = snapshots()
  const load = loader(legacy, null)
  const result = load({ routeId: MATH })
  assert.deepEqual(result, { ...legacy, complete: true, candidateErrorCode: null })
  assert.notStrictEqual(result.groups, legacy.groups)
  assert.notStrictEqual(result.documents, legacy.documents)
  assert.strictEqual(result.groups[0], legacy.groups[0])
})

test('legacy is loaded first, candidate is not scoped, and valid snapshots merge deterministically', () => {
  const { legacy, candidate } = snapshots()
  const calls = []
  const load = createAiStudyDualRootLoader({
    legacyLoader: (...args) => { calls.push(['legacy', args]); return legacy },
    candidateLoader: (...args) => { calls.push(['candidate', args]); return candidate },
    candidateRouteIds: [MATH],
  })
  const result = load({ routeId: BIOLOGY })
  assert.deepEqual(calls.map(([name]) => name), ['legacy', 'candidate'])
  assert.ok(calls.every(([, args]) => !args[0]?.routeId && !args[0]?.subject))
  assert.deepEqual(result.groups, [...legacy.groups, ...candidate.groups])
  assert.deepEqual(result.documents, [...legacy.documents, ...candidate.documents])
  assert.strictEqual(result.groups.at(-1), candidate.groups[0])
  assert.equal(result.complete, true)
  assert.equal(result.candidateErrorCode, null)
})

test('legacy failures propagate before any candidate attempt', () => {
  const failure = new Error('legacy failed')
  let called = false
  const load = createAiStudyDualRootLoader({ legacyLoader: () => { throw failure }, candidateLoader: () => { called = true } , candidateRouteIds: [MATH] })
  assert.throws(() => load(), (error) => error === failure)
  assert.equal(called, false)
})

test('missing or malformed candidate snapshots fail without leaking partial data', () => {
  const { legacy, candidate } = snapshots()
  for (const corrupt of [undefined, null, {}, { groups: candidate.groups }, { documents: candidate.documents },
    { groups: 'bad', documents: candidate.documents }, { groups: candidate.groups, documents: null },
    { groups: [], documents: [] }]) {
    expectUnavailable(loader(legacy, () => corrupt), legacy)
  }
})

test('candidate exceptions are sanitized, preserving only recognized promotion codes', () => {
  const { legacy } = snapshots()
  for (const [failure, code] of [[new Error('private candidate detail'), INVALID],
    [Object.assign(new Error('private promotion detail'), { code: REQUIRED, statusCode: 400 }), REQUIRED],
    [Object.assign(new Error('private invalid detail'), { code: INVALID }), INVALID],
    [Object.assign(new Error('private blocked detail'), { code: BLOCKED }), BLOCKED],
    [Object.assign(new Error('private unknown detail'), { code: 'OTHER' }), INVALID]]) {
    const load = loader(legacy, () => { throw failure })
    expectUnavailable(load, legacy, code)
    assert.throws(() => load({ routeId: MATH }), (error) => !error.message.includes('private') && !error.cause)
  }
})

test('candidate is reloaded after corruption and complete is independent for each result', () => {
  const { legacy, candidate } = snapshots()
  let current = candidate
  let calls = 0
  const load = loader(legacy, () => { calls += 1; return current })
  const first = load()
  current = { groups: candidate.groups, documents: null }
  const second = load({ routeId: PHYSICS })
  assert.throws(() => load({ routeId: MATH }), { code: INVALID, statusCode: 503 })
  current = candidate
  const third = load({ subject: '9709' })
  assert.equal(calls, 4)
  assert.equal(first.complete, true)
  assert.equal(first.candidateErrorCode, null)
  assert.equal(second.complete, false)
  assert.equal(second.candidateErrorCode, INVALID)
  assert.equal(third.complete, true)
  assert.deepEqual(first.groups, third.groups)
})

test('explicitly incomplete candidate snapshots are never merged', () => {
  const { legacy, candidate } = snapshots()
  for (const [extra, code] of [[{ complete: false }, INVALID],
    [{ complete: false, candidateErrorCode: REQUIRED }, REQUIRED],
    [{ candidateErrorCode: INVALID }, INVALID],
    [{ complete: 'true' }, INVALID]]) {
    expectUnavailable(loader(legacy, () => ({ ...candidate, ...extra })), legacy, code)
  }
  expectUnavailable(loader(legacy, () => ({ complete: false, candidateErrorCode: REQUIRED })), legacy, REQUIRED)
})

test('legacy retains its loader cache while candidate refreshes on every request', () => {
  const { legacy, candidate } = snapshots()
  const originalLegacy = legacy
  const originalCandidate = candidate
  let currentLegacy = originalLegacy
  let currentCandidate = originalCandidate
  const calls = []
  const load = createAiStudyDualRootLoader({
    legacyLoader: (options) => { calls.push(['legacy', options]); return options?.refresh ? currentLegacy : originalLegacy },
    candidateLoader: (options) => { calls.push(['candidate', options]); return options?.refresh ? currentCandidate : originalCandidate },
    candidateRouteIds: [MATH],
  })
  const first = load()
  currentLegacy = { ...originalLegacy, groups: [group(PHYSICS, '9702', 'physics-q2'), ...originalLegacy.groups.slice(1)] }
  currentCandidate = { ...originalCandidate, groups: [group(MATH, '9709', 'math-candidate-q2')] }
  const second = load()
  assert.ok(calls.filter(([name]) => name === 'legacy').every(([, options]) => options?.refresh !== true))
  assert.ok(calls.filter(([name]) => name === 'candidate').every(([, options]) => options?.refresh === true))
  assert.equal(first.groups.at(-1).sourceQuestionId, 'math-candidate-q1')
  assert.equal(second.groups.at(-1).sourceQuestionId, 'math-candidate-q2')
  assert.ok(second.groups.some((entry) => entry.sourceQuestionId === 'physics-q1'))
  assert.ok(!second.groups.some((entry) => entry.sourceQuestionId === 'physics-q2'))
})

test('fresh candidate validation observes same-metadata source tampering, revocation, and recovery', () => {
  const { legacy, candidate } = snapshots()
  const source = { bytes: Buffer.from('safe'), size: 4, mtimeMs: 12345 }
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
  const trustedDigest = digest(source.bytes)
  let revoked = false
  let checks = 0
  const load = loader(legacy, (options) => {
    assert.equal(options?.refresh, true)
    checks += 1
    if (revoked) throw Object.assign(new Error('revoked'), { code: REQUIRED })
    if (digest(source.bytes) !== trustedDigest) throw Object.assign(new Error('source tampered'), { code: INVALID })
    return candidate
  })
  assert.equal(load().complete, true)
  source.bytes = Buffer.from('evil')
  assert.equal(source.bytes.length, source.size)
  assert.equal(source.mtimeMs, 12345)
  assert.equal(load({ routeId: PHYSICS }).candidateErrorCode, INVALID)
  assert.throws(() => load({ routeId: MATH }), { statusCode: 503, code: INVALID })
  source.bytes = Buffer.from('safe')
  assert.equal(load({ routeId: MATH }).complete, true)
  revoked = true
  assert.equal(load({ routeId: BIOLOGY }).candidateErrorCode, REQUIRED)
  assert.throws(() => load({ subject: '9709' }), { statusCode: 503, code: REQUIRED })
  revoked = false
  assert.equal(load().complete, true)
  assert.equal(checks, 7)
})

test('matching group and document collisions keep the actual legacy objects', () => {
  const { legacy, candidate } = snapshots()
  candidate.groups.unshift(JSON.parse(JSON.stringify(legacy.groups[2])))
  candidate.documents.unshift(doc('9709', 'math-legacy.pdf', hash('c'), 345, { year: 2025 }))
  const result = loader(legacy, () => candidate)()
  assert.equal(result.complete, true)
  assert.deepEqual(result.groups, [...legacy.groups, candidate.groups[1]])
  assert.deepEqual(result.documents, [...legacy.documents, candidate.documents[1]])
  assert.strictEqual(result.groups[2], legacy.groups[2])
  assert.strictEqual(result.documents[2], legacy.documents[2])
})

test('any nonidentical group collision rejects all candidate data', () => {
  const { legacy, candidate } = snapshots()
  candidate.groups.push({ ...legacy.groups[2], content: { text: 'changed' } })
  expectUnavailable(loader(legacy, () => candidate), legacy)
})

test('a candidate cannot override a separately protected static source group', () => {
  const { legacy, candidate } = snapshots()
  const protectedGroups = [group(MATH, '9709', 'math-candidate-q1', { content: { text: 'published static source' } })]
  const load = createAiStudyDualRootLoader({ legacyLoader: () => legacy, candidateLoader: () => candidate,
    candidateRouteIds: [MATH], protectedGroups })
  assert.throws(() => load({ routeId: MATH }), { code: INVALID, statusCode: 503 })
  const unaffected = load({ routeId: PHYSICS })
  assert.deepEqual(unaffected.groups, legacy.groups)
  assert.equal(unaffected.complete, false)
})

test('group equality requires byte-identical JSON representation', () => {
  const { legacy, candidate } = snapshots()
  const original = legacy.groups[2]
  candidate.groups.push({ sourceQuestionId: original.sourceQuestionId, routeId: original.routeId,
    subjectCode: original.subjectCode, content: original.content })
  expectUnavailable(loader(legacy, () => candidate), legacy)
})

test('conflicting hash or byte count in a document rejects the entire candidate', () => {
  for (const conflicting of [doc('9709', 'math-legacy.pdf', hash('e'), 345), doc('9709', 'math-legacy.pdf', hash('c'), 346)]) {
    const { legacy, candidate } = snapshots()
    candidate.documents.push(conflicting)
    expectUnavailable(loader(legacy, () => candidate), legacy)
  }
})

test('duplicate candidate groups or documents are rejected even if identical', () => {
  for (const kind of ['groups', 'documents']) {
    const { legacy, candidate } = snapshots()
    candidate[kind].push({ ...candidate[kind][0] })
    expectUnavailable(loader(legacy, () => candidate), legacy)
  }
})

test('legacy duplicates remain intact and all collisions are checked against them', () => {
  const { legacy, candidate } = snapshots()
  legacy.groups.push({ ...legacy.groups[2], content: { text: 'different legacy' } })
  candidate.groups.push({ ...legacy.groups[2] })
  expectUnavailable(loader(legacy, () => candidate), legacy)
  const withoutCollision = snapshots()
  withoutCollision.legacy.groups.push({ ...withoutCollision.legacy.groups[0] })
  const result = loader(withoutCollision.legacy, () => withoutCollision.candidate)()
  assert.equal(result.groups.length, withoutCollision.legacy.groups.length + 1)
})

test('extra routes and inconsistent subject metadata make a candidate unavailable', () => {
  for (const change of [
    (candidate) => candidate.groups.push(group(PHYSICS, '9702', 'extra-q1')),
    (candidate) => { candidate.groups[0].subjectCode = '9702' },
    (candidate) => { candidate.groups[0].subject = 'Physics' },
    (candidate) => { candidate.documents[0].subject = '9702' },
    (candidate) => { candidate.groups[0].sourceQuestionId = '' },
    (candidate) => { candidate.documents[0].sha256 = 'bad' },
    (candidate) => { candidate.documents[0].bytes = 0 },
    (candidate) => { candidate.documents[0].file = '../outside.pdf' },
  ]) {
    const { legacy, candidate } = snapshots()
    change(candidate)
    expectUnavailable(loader(legacy, () => candidate), legacy)
  }
})

test('multiple registered routes derive their subjects from the registry', () => {
  const { legacy, candidate } = snapshots()
  candidate.groups.push(group(BIOLOGY, '9700', 'biology-candidate'))
  candidate.documents.push(doc('9700', 'biology-candidate.pdf'))
  let healthy = true
  const load = loader(legacy, () => healthy ? candidate : null, [MATH, BIOLOGY])
  assert.equal(load().complete, true)
  healthy = false
  assert.equal(load({ routeId: PHYSICS }).complete, false)
  assert.throws(() => load({ routeId: BIOLOGY }), { code: INVALID, statusCode: 503 })
  assert.throws(() => load({ subject: 'biology-9700' }), { code: INVALID, statusCode: 503 })
  assert.throws(() => load({ subject: '9709' }), { code: INVALID, statusCode: 503 })
})

test('a different route of the same subject remains available when no subject is requested', () => {
  const { legacy } = snapshots()
  const load = loader(legacy, () => null)
  assert.equal(load({ routeId: MATH_OTHER }).complete, false)
  assert.throws(() => load({ routeId: MATH_OTHER, subject: '9709' }), { code: INVALID, statusCode: 503 })
})

test('bad candidate allowlist fails closed for scoped requests but preserves unscoped legacy', () => {
  const { legacy, candidate } = snapshots()
  for (const routes of [[], [''], ['not-a-route'], [MATH, 'not-a-route'], [MATH, MATH], null, 'invalid']) {
    const load = loader(legacy, () => candidate, routes)
    assert.deepEqual(load(), { ...legacy, complete: false, candidateErrorCode: INVALID })
    assert.throws(() => load({ routeId: PHYSICS }), { code: INVALID, statusCode: 503 })
    assert.throws(() => load({ subject: '9700' }), { code: INVALID, statusCode: 503 })
  }
})

test('unrecognized request scope cannot bypass a failed candidate', () => {
  const { legacy } = snapshots()
  const load = loader(legacy, () => null)
  for (const scope of [{ routeId: 'unknown' }, { subject: 'unknown' }, { routeId: 12 }, { subject: {} }]) {
    assert.throws(() => load(scope), { code: INVALID, statusCode: 503 })
  }
})

test('all allowed routes are accepted without requiring every route to appear', () => {
  const { legacy, candidate } = snapshots()
  assert.equal(loader(legacy, () => candidate, [MATH, MATH_OTHER])().complete, true)
})

test('real bank loaders preserve an empty legacy snapshot when the signed candidate root is absent', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '__dual_root_missing_fixture_never_create__')
  assert.equal(fs.existsSync(root), false)
  const legacyLoader = createAiVerifiedQuestionBankLoader({ artifactRoot: path.join(root, 'legacy'), libraryRoot: path.join(root, 'library') })
  const candidateLoader = createAiVerifiedQuestionBankLoader({ artifactRoot: path.join(root, 'candidate'),
    libraryRoot: path.join(root, 'library'), promotionPolicy: { mode: 'signed-candidate', trustedPublicKeys: {} } })
  const load = createAiStudyDualRootLoader({ legacyLoader, candidateLoader, candidateRouteIds: [MATH] })
  assert.deepEqual(load({ routeId: PHYSICS }), { groups: [], documents: [], complete: false, candidateErrorCode: INVALID })
  assert.throws(() => load({ routeId: MATH }), { code: INVALID, statusCode: 503 })
  assert.equal(createAiStudyDualRootLoader({ legacyLoader })().complete, true)
  assert.equal(fs.existsSync(root), false)
})

test('frozen snapshots are not mutated and returned array changes do not affect loaders', () => {
  const { legacy, candidate } = snapshots()
  for (const snapshot of [legacy, candidate]) {
    snapshot.groups.forEach(Object.freeze)
    snapshot.documents.forEach(Object.freeze)
    Object.freeze(snapshot.groups)
    Object.freeze(snapshot.documents)
    Object.freeze(snapshot)
  }
  const before = JSON.stringify({ legacy, candidate })
  const load = loader(legacy, () => candidate)
  const result = load()
  result.groups.pop()
  result.documents.splice(0, 1)
  assert.equal(JSON.stringify({ legacy, candidate }), before)
  assert.equal(load().groups.length, legacy.groups.length + candidate.groups.length)
})
