import crypto from 'node:crypto'
import { types } from 'node:util'

const ENVELOPE_VERSION = 'stem-ai-study-legacy-ledger-envelope.v1'
const PAYLOAD_VERSION = 'stem-ai-study-legacy-ledger.v1'
const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024
const MAX_IDENTITIES = 100_000
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

function fail(code) {
  const error = new Error(code)
  error.code = code
  throw error
}

const invalid = () => fail('AI_STUDY_LEGACY_LEDGER_INVALID')
const invalidTrust = () => fail('AI_STUDY_LEGACY_LEDGER_TRUST_REQUIRED')
const invalidSnapshot = () => fail('AI_STUDY_LEGACY_SNAPSHOT_INVALID')

function exactRecord(value, keys) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  const actual = Reflect.ownKeys(value)
  return actual.length === keys.length && keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && descriptor.enumerable && Object.hasOwn(descriptor, 'value')
  })
}

function dataArray(value, maximumLength) {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maximumLength || Reflect.ownKeys(value).length !== value.length + 1) return false
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return false
  }
  return true
}

function validId(value) {
  return typeof value === 'string' && ID.test(value)
}

function identityKey(identity) {
  return JSON.stringify([identity.routeId, identity.sourceQuestionId])
}

function identityOf(value) {
  return { routeId: value.routeId, sourceQuestionId: value.sourceQuestionId }
}

function canonicalBase64(value, maximumBytes) {
  if (typeof value !== 'string' || value.length === 0
    || value.length > 4 * Math.ceil(maximumBytes / 3)
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) invalid()
  const bytes = Buffer.from(value, 'base64')
  if (bytes.length === 0 || bytes.length > maximumBytes || bytes.toString('base64') !== value) invalid()
  return bytes
}

function authenticatedLedger(envelope, publicKey, expectedCatalogId) {
  if (!exactRecord(envelope, ['schemaVersion', 'payloadBase64', 'signature'])
    || envelope.schemaVersion !== ENVELOPE_VERSION
    || !exactRecord(envelope.signature, ['algorithm', 'value'])
    || envelope.signature.algorithm !== 'Ed25519') invalid()

  const bytes = canonicalBase64(envelope.payloadBase64, MAX_PAYLOAD_BYTES)
  const signature = canonicalBase64(envelope.signature.value, 64)
  if (signature.length !== 64) invalid()
  let verified = false
  try {
    verified = crypto.verify(null, bytes, publicKey, signature)
  } catch {
    invalid()
  }
  if (!verified) invalid()

  let payload
  try {
    const text = bytes.toString('utf8')
    if (!Buffer.from(text, 'utf8').equals(bytes)) invalid()
    payload = JSON.parse(text)
    // One byte representation prevents duplicate keys and parser disagreement.
    if (JSON.stringify(payload) !== text) invalid()
  } catch {
    invalid()
  }
  if (!exactRecord(payload, ['schemaVersion', 'catalogId', 'generation', 'entries'])
    || payload.schemaVersion !== PAYLOAD_VERSION || !validId(payload.catalogId)
    || !Number.isSafeInteger(payload.generation) || payload.generation < 1
    || !Array.isArray(payload.entries) || payload.entries.length === 0
    || payload.entries.length > MAX_IDENTITIES) invalid()
  if (payload.catalogId !== expectedCatalogId) fail('AI_STUDY_LEGACY_LEDGER_CATALOG_MISMATCH')

  const actions = new Map()
  const active = []
  const revoked = []
  for (const item of payload.entries) {
    if (!exactRecord(item, ['action', 'routeId', 'sourceQuestionId'])
      || !['active', 'revoke'].includes(item.action)
      || !validId(item.routeId) || !validId(item.sourceQuestionId)) invalid()
    const identity = identityOf(item)
    const key = identityKey(identity)
    if (actions.has(key)) invalid()
    actions.set(key, item.action)
    if (item.action === 'active') active.push(identity)
    else revoked.push(identity)
  }
  return { catalogId: payload.catalogId, generation: payload.generation, actions, active, revoked }
}

function validateTrust(trust) {
  if (!exactRecord(trust, ['publicKey', 'expectedCatalogId', 'minimumGeneration', 'previousLedger'])
    || types.isProxy(trust.publicKey) || !(trust.publicKey instanceof crypto.KeyObject) || trust.publicKey.type !== 'public'
    || trust.publicKey.asymmetricKeyType !== 'ed25519' || !validId(trust.expectedCatalogId)
    || !Number.isSafeInteger(trust.minimumGeneration) || trust.minimumGeneration < 1
    || !trust.previousLedger) invalidTrust()
}

function validateHistory(current, previous, currentEnvelope, previousEnvelope) {
  if (current.generation < previous.generation) fail('AI_STUDY_LEGACY_LEDGER_ROLLBACK')
  if (current.generation === previous.generation
    && currentEnvelope.payloadBase64 !== previousEnvelope.payloadBase64) {
    fail('AI_STUDY_LEGACY_LEDGER_GENERATION_CONFLICT')
  }
  for (const [key, previousAction] of previous.actions) {
    const action = current.actions.get(key)
    if (!action) fail('AI_STUDY_LEGACY_LEDGER_HISTORY_GAP')
    if (previousAction === 'revoke' && action !== 'revoke') {
      fail('AI_STUDY_LEGACY_LEDGER_REVOCATION_REVERSED')
    }
  }
}

// The snapshot must be complete. Trust inputs, including the last accepted signed
// ledger or independently reviewed bootstrap baseline, come from outside the data root.
export function verifyAiStudyLegacyLedger(input) {
  if (!exactRecord(input, ['envelope', 'currentGroups', 'trust'])) invalid()
  const { envelope, currentGroups, trust } = input
  validateTrust(trust)
  const current = authenticatedLedger(envelope, trust.publicKey, trust.expectedCatalogId)
  if (current.generation < trust.minimumGeneration) fail('AI_STUDY_LEGACY_LEDGER_ROLLBACK')
  const previous = authenticatedLedger(trust.previousLedger, trust.publicKey, trust.expectedCatalogId)
  validateHistory(current, previous, envelope, trust.previousLedger)

  if (!dataArray(currentGroups, MAX_IDENTITIES)) invalidSnapshot()
  const observed = new Set()
  let unexpected = false
  for (const group of currentGroups) {
    if (!exactRecord(group, ['routeId', 'sourceQuestionId'])
      || !validId(group.routeId) || !validId(group.sourceQuestionId)) invalidSnapshot()
    const key = identityKey(group)
    if (observed.has(key)) invalidSnapshot()
    observed.add(key)
    if (!current.actions.has(key)) unexpected = true
  }
  if (current.active.some((identity) => !observed.has(identityKey(identity)))) {
    fail('AI_STUDY_LEGACY_MISSING_ACTIVE')
  }
  if (unexpected) invalidSnapshot()

  return Object.freeze({
    catalogId: current.catalogId,
    generation: current.generation,
    activeIdentities: Object.freeze(current.active.map((identity) => Object.freeze(identity))),
    revokedIdentities: Object.freeze(current.revoked.map((identity) => Object.freeze({
      ...identity,
      presentInSnapshot: observed.has(identityKey(identity)),
    }))),
  })
}
