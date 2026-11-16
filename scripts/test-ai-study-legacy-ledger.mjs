import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { test } from 'node:test'
import { verifyAiStudyLegacyLedger } from '../server/aiStudyLegacyLedger.js'

const ENVELOPE_VERSION = 'stem-ai-study-legacy-ledger-envelope.v1'
const PAYLOAD_VERSION = 'stem-ai-study-legacy-ledger.v1'
const keys = crypto.generateKeyPairSync('ed25519')
const otherKeys = crypto.generateKeyPairSync('ed25519')
const catalogId = 'synthetic-catalog'
const a = { routeId: 'route-a', sourceQuestionId: 'question-1' }
const b = { routeId: 'route-a', sourceQuestionId: 'question-2' }
const c = { routeId: 'route-b', sourceQuestionId: 'question-1' }

const entry = (action, identity) => ({ action, ...identity })
const payload = (entries = [entry('active', a), entry('active', b)], generation = 10) => ({
  schemaVersion: PAYLOAD_VERSION,
  catalogId,
  generation,
  entries,
})
const signBytes = (bytes, privateKey = keys.privateKey) => ({
  schemaVersion: ENVELOPE_VERSION,
  payloadBase64: bytes.toString('base64'),
  signature: { algorithm: 'Ed25519', value: crypto.sign(null, bytes, privateKey).toString('base64') },
})
const signPayload = (value, privateKey = keys.privateKey) => signBytes(Buffer.from(JSON.stringify(value), 'utf8'), privateKey)
const trustedBaseline = signPayload(payload(undefined, 9))
const trust = (overrides = {}) => ({
  publicKey: keys.publicKey, expectedCatalogId: catalogId, minimumGeneration: 10, previousLedger: trustedBaseline, ...overrides,
})
const args = (overrides = {}) => ({ envelope: signPayload(payload()), currentGroups: [a, b], trust: trust(), ...overrides })
const errorCode = (input, code) => assert.throws(() => verifyAiStudyLegacyLedger(input), { code })
const INVALID = 'AI_STUDY_LEGACY_LEDGER_INVALID'
const TRUST = 'AI_STUDY_LEGACY_LEDGER_TRUST_REQUIRED'
const ROLLBACK = 'AI_STUDY_LEGACY_LEDGER_ROLLBACK'
const CATALOG = 'AI_STUDY_LEGACY_LEDGER_CATALOG_MISMATCH'
const SNAPSHOT = 'AI_STUDY_LEGACY_SNAPSHOT_INVALID'
const MISSING = 'AI_STUDY_LEGACY_MISSING_ACTIVE'
const HISTORY = 'AI_STUDY_LEGACY_LEDGER_HISTORY_GAP'
const REVERSED = 'AI_STUDY_LEGACY_LEDGER_REVOCATION_REVERSED'
const CONFLICT = 'AI_STUDY_LEGACY_LEDGER_GENERATION_CONFLICT'

test('valid signed ledger returns only complete active identities', () => {
  const result = verifyAiStudyLegacyLedger(args())
  assert.deepEqual(result, { catalogId, generation: 10, activeIdentities: [a, b], revokedIdentities: [] })
  assert.notStrictEqual(result.activeIdentities[0], a)
  assert.ok(Object.isFrozen(result))
  assert.ok(Object.isFrozen(result.activeIdentities))
  assert.ok(Object.isFrozen(result.activeIdentities[0]))
  assert.throws(() => { result.activeIdentities.push(b) }, TypeError)
})

test('explicitly signed revocations are reported whether present or absent and never returned as active', () => {
  const envelope = signPayload(payload([entry('active', a), entry('revoke', b), entry('revoke', c)]))
  const result = verifyAiStudyLegacyLedger(args({ envelope, currentGroups: [a, b] }))
  assert.deepEqual(result.activeIdentities, [a])
  assert.deepEqual(result.revokedIdentities, [
    { ...b, presentInSnapshot: true },
    { ...c, presentInSnapshot: false },
  ])
  assert.ok(Object.isFrozen(result.revokedIdentities))
  assert.ok(Object.isFrozen(result.revokedIdentities[0]))
  assert.ok(!result.activeIdentities.some((identity) => identity.sourceQuestionId === b.sourceQuestionId))
})

test('all identities may be revoked, but an empty signed ledger is rejected', () => {
  const envelope = signPayload(payload([entry('revoke', a), entry('revoke', b)]))
  const result = verifyAiStudyLegacyLedger(args({ envelope, currentGroups: [a, b] }))
  assert.deepEqual(result.activeIdentities, [])
  assert.equal(result.revokedIdentities.length, 2)
  errorCode(args({ envelope: signPayload(payload([])), currentGroups: [] }), INVALID)
})

test('a missing active identity is an integrity error, not a revocation', () => {
  errorCode(args({ currentGroups: [a] }), MISSING)
  errorCode(args({ currentGroups: [] }), MISSING)
  errorCode(args({ currentGroups: [a, c] }), MISSING)
})

test('an unsigned block signal is not accepted as a revocation', () => {
  errorCode(args({ currentGroups: [a], blocked: { file: 'BLOCKED.json', identities: [b] } }), INVALID)
  errorCode(args({ currentGroups: [a], envelope: { ...signPayload(payload()), blocked: [b] } }), INVALID)
  errorCode(args({ currentGroups: [a] }), MISSING)
})

test('the key, catalog, generation floor, and independently retained prior ledger are mandatory', () => {
  const missingPrior = trust()
  delete missingPrior.previousLedger
  for (const candidate of [
    undefined, null, {},
    missingPrior,
    trust({ previousLedger: undefined }),
    { expectedCatalogId: catalogId, minimumGeneration: 10 },
    { publicKey: keys.publicKey, minimumGeneration: 10 },
    { publicKey: keys.publicKey, expectedCatalogId: catalogId },
    trust({ publicKey: keys.privateKey }),
    trust({ publicKey: 'not-a-key' }),
    trust({ expectedCatalogId: '' }),
    trust({ expectedCatalogId: '../catalog' }),
    trust({ minimumGeneration: 0 }),
    trust({ minimumGeneration: -1 }),
    trust({ minimumGeneration: 1.5 }),
    trust({ minimumGeneration: Number.MAX_SAFE_INTEGER + 1 }),
    trust({ minimumGeneration: '10' }),
  ]) errorCode(args({ trust: candidate }), TRUST)
  const wrongAlgorithm = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey
  errorCode(args({ trust: trust({ publicKey: wrongAlgorithm }) }), TRUST)
})

test('catalog mismatch and generation rollback fail closed', () => {
  errorCode(args({ trust: trust({ expectedCatalogId: 'other-catalog' }) }), CATALOG)
  errorCode(args({ trust: trust({ minimumGeneration: 11 }) }), ROLLBACK)
  assert.equal(verifyAiStudyLegacyLedger(args({ trust: trust({ minimumGeneration: 9 }) })).generation, 10)
})

test('forged, corrupted, incorrectly encoded, and cross-key signatures fail', () => {
  const valid = signPayload(payload())
  const modified = signPayload(payload([entry('active', a)]))
  const cases = [
    { ...valid, payloadBase64: modified.payloadBase64 },
    signPayload(payload(), otherKeys.privateKey),
    { ...valid, signature: { ...valid.signature, value: Buffer.alloc(64).toString('base64') } },
    { ...valid, signature: { ...valid.signature, value: Buffer.alloc(63).toString('base64') } },
    { ...valid, signature: { ...valid.signature, value: valid.signature.value.replace(/=$/, '') } },
    { ...valid, signature: { ...valid.signature, algorithm: 'RSA' } },
    { ...valid, payloadBase64: `${valid.payloadBase64}\n` },
    { ...valid, payloadBase64: '' },
    { ...valid, schemaVersion: 'other-envelope.v1' },
    { ...valid, extra: true },
    { ...valid, signature: { ...valid.signature, keyId: 'untrusted' } },
  ]
  for (const envelope of cases) errorCode(args({ envelope }), INVALID)
})

test('validly signed malformed, noncanonical, or ambiguous JSON is rejected', () => {
  const validText = JSON.stringify(payload())
  const duplicateKey = validText.replace('"generation":10', '"generation":10,"generation":10')
  const invalidUtf8 = Buffer.concat([Buffer.from('{"x":"'), Buffer.from([0xff]), Buffer.from('"}')])
  for (const bytes of [
    Buffer.from('{not-json'),
    Buffer.from(`${validText}\n`),
    Buffer.from(duplicateKey),
    Buffer.from(` ${validText}`),
    invalidUtf8,
  ]) errorCode(args({ envelope: signBytes(bytes) }), INVALID)
})

test('signed payload schema, actions, and generation are strict', () => {
  for (const invalidPayload of [
    { ...payload(), extra: true },
    { ...payload(), schemaVersion: 'other.v1' },
    { ...payload(), catalogId: '../catalog' },
    { ...payload(), generation: 0 },
    { ...payload(), generation: 1.5 },
    { ...payload(), generation: Number.MAX_SAFE_INTEGER + 1 },
    { ...payload(), entries: null },
    payload([entry('delete', a)]),
    payload([{ ...entry('active', a), reason: 'unrecognized' }]),
    payload([{ routeId: a.routeId, sourceQuestionId: a.sourceQuestionId }]),
  ]) errorCode(args({ envelope: signPayload(invalidPayload) }), INVALID)
})

test('duplicate identities and active/revoked overlap are rejected', () => {
  for (const entries of [
    [entry('active', a), entry('active', a)],
    [entry('revoke', a), entry('revoke', a)],
    [entry('active', a), entry('revoke', a)],
    [entry('revoke', a), entry('active', a)],
  ]) errorCode(args({ envelope: signPayload(payload(entries)) }), INVALID)
})

test('identity validation rejects malformed values and does not conflate pairs', () => {
  for (const id of ['', ' space', 'a b', '../route', 'a/b', 'a\n', 'a*', '中文', 'x'.repeat(129), 10, null]) {
    errorCode(args({ envelope: signPayload(payload([entry('active', { ...a, routeId: id })])) }), INVALID)
    errorCode(args({ envelope: signPayload(payload([entry('active', { ...a, sourceQuestionId: id })])) }), INVALID)
    errorCode(args({ currentGroups: [{ ...a, routeId: id }, b] }), SNAPSHOT)
  }
  const first = { routeId: 'a:b', sourceQuestionId: 'c' }
  const second = { routeId: 'a', sourceQuestionId: 'b:c' }
  const envelope = signPayload(payload([entry('active', first), entry('active', second)]))
  const result = verifyAiStudyLegacyLedger(args({
    envelope,
    currentGroups: [first, second],
    trust: trust({ previousLedger: envelope }),
  }))
  assert.equal(result.activeIdentities.length, 2)
})

test('snapshot must be complete, unambiguous, and limited to identities in the ledger', () => {
  for (const currentGroups of [
    null, {}, [a, a, b], [a, b, c], [a, { ...b, extra: true }],
    [a, { routeId: b.routeId }], [a, null],
  ]) errorCode(args({ currentGroups }), SNAPSHOT)
})

test('executable or ambiguous snapshot properties are rejected without invoking getters', () => {
  let getterCalled = false
  const withGetter = { sourceQuestionId: a.sourceQuestionId }
  Object.defineProperty(withGetter, 'routeId', { enumerable: true, get() { getterCalled = true; return a.routeId } })
  errorCode(args({ currentGroups: [withGetter, b] }), SNAPSHOT)
  assert.equal(getterCalled, false)
  errorCode(args({ currentGroups: [new Proxy(a, {}), b] }), SNAPSHOT)
  const withIndexGetter = [a, b]
  Object.defineProperty(withIndexGetter, '1', { enumerable: true, get() { getterCalled = true; return b } })
  errorCode(args({ currentGroups: withIndexGetter }), SNAPSHOT)
  assert.equal(getterCalled, false)
  const withExtraProperty = [a, b]
  withExtraProperty.blocked = [b]
  errorCode(args({ currentGroups: withExtraProperty }), SNAPSHOT)
  errorCode(args({ currentGroups: new Proxy([a, b], {}) }), SNAPSHOT)
})

test('oversized inputs fail closed before snapshot processing', () => {
  const envelope = signPayload(payload())
  const tooLarge = { ...envelope, payloadBase64: 'A'.repeat(4 * Math.ceil((8 * 1024 * 1024) / 3) + 4) }
  errorCode(args({ envelope: tooLarge }), INVALID)
  errorCode(args({ currentGroups: new Array(100_001) }), SNAPSHOT)
})

test('new signed active identities must also be present in the complete snapshot', () => {
  const envelope = signPayload(payload([entry('active', a), entry('active', b), entry('active', c)]))
  assert.deepEqual(verifyAiStudyLegacyLedger(args({ envelope, currentGroups: [a, b, c] })).activeIdentities, [a, b, c])
  errorCode(args({ envelope, currentGroups: [a, b] }), MISSING)
})

test('a retained prior signed ledger enforces explicit transition to revocation', () => {
  const previousLedger = signPayload(payload([entry('active', a), entry('active', b)], 9))
  const next = signPayload(payload([entry('active', a), entry('revoke', b)], 10))
  const result = verifyAiStudyLegacyLedger(args({ envelope: next, currentGroups: [a, b], trust: trust({ previousLedger }) }))
  assert.deepEqual(result.activeIdentities, [a])
  assert.deepEqual(result.revokedIdentities, [{ ...b, presentInSnapshot: true }])
  const dropped = signPayload(payload([entry('active', a)], 10))
  errorCode(args({ envelope: dropped, currentGroups: [a], trust: trust({ previousLedger }) }), HISTORY)
})

test('prior revocations cannot disappear or become active without an explicit supported action', () => {
  const previousLedger = signPayload(payload([entry('active', a), entry('revoke', b)], 9))
  const dropped = signPayload(payload([entry('active', a)], 10))
  const restored = signPayload(payload([entry('active', a), entry('active', b)], 10))
  errorCode(args({ envelope: dropped, currentGroups: [a], trust: trust({ previousLedger }) }), HISTORY)
  errorCode(args({ envelope: restored, currentGroups: [a, b], trust: trust({ previousLedger }) }), REVERSED)
})

test('prior ledger is authenticated and detects rollback and same-generation equivocation', () => {
  const previousLedger = signPayload(payload([entry('active', a), entry('active', b)], 10))
  assert.equal(verifyAiStudyLegacyLedger(args({ envelope: previousLedger, trust: trust({ previousLedger }) })).generation, 10)
  const conflict = signPayload(payload([entry('active', a), entry('revoke', b)], 10))
  errorCode(args({ envelope: conflict, trust: trust({ previousLedger }) }), CONFLICT)
  const laterPrevious = signPayload(payload([entry('active', a), entry('active', b)], 11))
  errorCode(args({ trust: trust({ previousLedger: laterPrevious }) }), ROLLBACK)
  errorCode(args({ trust: trust({ previousLedger: signPayload(payload(), otherKeys.privateKey) }) }), INVALID)
  errorCode(args({ trust: trust({ previousLedger: signPayload({ ...payload(), catalogId: 'other-catalog' }) }) }), CATALOG)
  errorCode(args({ trust: trust({ previousLedger: null }) }), TRUST)
})
