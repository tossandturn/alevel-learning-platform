import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  createTavernConversationStore,
  estimateTavernTokensUpperBound,
  selectTavernProviderContext,
  TAVERN_TURN_DEFAULT_LEASE_TTL_MS,
  tavernModelContextWindow,
} from '../server/tavernConversationStore.js'

assert.equal(tavernModelContextWindow('qwen3.7-max').tokens, 1_000_000)
assert.equal(tavernModelContextWindow('qwen3.7-plus').tokens, 1_000_000)
assert.equal(tavernModelContextWindow('unknown-model').verified, false)
assert.equal(estimateTavernTokensUpperBound('🧩中A'), Buffer.byteLength('🧩中A', 'utf8') + 16)
assert.equal(TAVERN_TURN_DEFAULT_LEASE_TTL_MS, 90_000)

const selected = selectTavernProviderContext({
  model: 'tiny-unverified-model',
  systemPrompt: 'system',
  currentMessage: 'remember cobalt lantern',
  recentMessages: Array.from({ length: 30 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `recent-${index}-${'x'.repeat(80)}`,
  })),
  retrievedSegments: [{
    segmentId: 'seg-old',
    firstSequence: 1,
    lastSequence: 4,
    sourceChecksum: 'a'.repeat(64),
    summary: 'The user chose the phrase cobalt lantern as an old story detail.',
  }],
  contextWindowOverride: 1_200,
  maxOutboundBytes: 8_000,
})
assert.equal(selected.memory.contextWindowTokens, 1_200)
assert.equal(selected.memory.countingMethod, 'utf8-provider-envelope-upper-bound-v2')
assert.equal(selected.memory.historyTruncated, true)
assert.equal(selected.memory.retrievedSegments, 1)
assert.match(JSON.stringify(selected.messages), /cobalt lantern/)
assert.ok(selected.memory.estimatedInputUpperBoundTokens < 1_200)

const scratchRoot = path.resolve('.tmp-test')
fs.mkdirSync(scratchRoot, { recursive: true })
const tempRoot = fs.mkdtempSync(path.join(scratchRoot, 'tavern-memory-'))
let nowMs = Date.parse('2026-10-06T10:00:00.000Z')
let idCounter = 0
const createStore = (options = {}) => createTavernConversationStore({
  root: tempRoot,
  now: () => nowMs,
  randomUUID: () => `20000000-0000-4000-8000-${String(++idCounter).padStart(12, '0')}`,
  quotaBytes: 8 * 1024 * 1024,
  segmentTargetBytes: 1_024,
  leaseTtlMs: 1_000,
  ...options,
})

let store = createStore()
const resumed = store.resumeConversation({ ownerId: 'ielts:7001', persona: 'keeper' })
assert.equal(resumed.persona, 'keeper')
assert.equal(resumed.revision, 0)
assert.equal(resumed.turnCount, 0)
assert.equal(store.resumeConversation({ ownerId: 'ielts:7001', persona: 'keeper' }).id, resumed.id)
assert.notEqual(store.resumeConversation({ ownerId: 'ielts:7001', persona: 'tarot-reader' }).id, resumed.id)
assert.notEqual(store.resumeConversation({ ownerId: 'ielts:7002', persona: 'keeper' }).id, resumed.id)

const inflightConversation = store.resumeConversation({ ownerId: 'ielts:7003', persona: 'keeper' })
const inflightFirst = store.beginTurn({
  ownerId: 'ielts:7003', persona: 'keeper', conversationId: inflightConversation.id,
  clientTurnId: 'inflight-client-0001', expectedRevision: 0,
  message: 'first pending', requestHash: 'inflight-hash-0001',
})
assert.throws(() => store.beginTurn({
  ownerId: 'ielts:7003', persona: 'keeper', conversationId: inflightConversation.id,
  clientTurnId: 'inflight-client-0002', expectedRevision: inflightFirst.conversation.revision,
  message: 'second pending', requestHash: 'inflight-hash-0002',
}), (error) => error?.statusCode === 409 && error?.code === 'tavern_turn_in_progress')
nowMs += 1_100
const inflightRecovered = store.beginTurn({
  ownerId: 'ielts:7003', persona: 'keeper', conversationId: inflightConversation.id,
  clientTurnId: 'inflight-client-0002', expectedRevision: inflightFirst.conversation.revision,
  message: 'second pending', requestHash: 'inflight-hash-0002',
})
assert.equal(inflightRecovered.providerCallRequired, true)
assert.equal(inflightRecovered.conversation.revision, inflightFirst.conversation.revision + 2, 'expiring the abandoned turn and reserving its replacement are separate canonical revisions')
const inflightMessages = store.getMessages({ ownerId: 'ielts:7003', persona: 'keeper', conversationId: inflightConversation.id, limit: 10 }).messages
assert.equal(inflightMessages.find((turn) => turn.id === 'inflight-client-0001:assistant')?.status, 'interrupted')
assert.throws(() => store.beginTurn({
  ownerId: 'ielts:7003', persona: 'keeper', conversationId: inflightConversation.id,
  clientTurnId: 'inflight-client-0001', expectedRevision: inflightFirst.conversation.revision,
  message: 'first pending', requestHash: 'inflight-hash-0001',
}), (error) => error?.statusCode === 409 && error?.code === 'tavern_turn_in_progress', 'an old logical retry cannot reopen while its replacement provider call is active')
assert.throws(() => store.completeTurn({
  ownerId: 'ielts:7003', persona: 'keeper', conversationId: inflightConversation.id,
  clientTurnId: 'inflight-client-0001', leaseId: inflightFirst.leaseId, assistantContent: 'late stale answer',
}), (error) => error?.statusCode === 409 && error?.code === 'tavern_turn_lease_conflict')
store.failTurn({
  ownerId: 'ielts:7003', persona: 'keeper', conversationId: inflightConversation.id,
  clientTurnId: 'inflight-client-0002', leaseId: inflightRecovered.leaseId, status: 'interrupted',
})

let defaultLeaseNow = Date.parse('2026-10-06T11:00:00.000Z')
const defaultLeaseStore = createTavernConversationStore({
  root: tempRoot,
  now: () => defaultLeaseNow,
  randomUUID: () => `21000000-0000-4000-8000-${String(++idCounter).padStart(12, '0')}`,
  quotaBytes: 8 * 1024 * 1024,
  segmentTargetBytes: 1_024,
})
const protectedConversation = defaultLeaseStore.resumeConversation({ ownerId: 'ielts:7004', persona: 'keeper' })
const protectedTurn = defaultLeaseStore.beginTurn({
  ownerId: 'ielts:7004', persona: 'keeper', conversationId: protectedConversation.id,
  clientTurnId: 'protected-client-0001', expectedRevision: 0,
  message: 'provider still running', requestHash: 'protected-hash-0001',
})
defaultLeaseNow += 60_001
assert.throws(() => defaultLeaseStore.beginTurn({
  ownerId: 'ielts:7004', persona: 'keeper', conversationId: protectedConversation.id,
  clientTurnId: 'protected-client-0002', expectedRevision: protectedTurn.conversation.revision,
  message: 'must not duplicate billing', requestHash: 'protected-hash-0002',
}), (error) => error?.statusCode === 409 && error?.code === 'tavern_turn_in_progress')
defaultLeaseStore.failTurn({
  ownerId: 'ielts:7004', persona: 'keeper', conversationId: protectedConversation.id,
  clientTurnId: 'protected-client-0001', leaseId: protectedTurn.leaseId, status: 'interrupted',
})
defaultLeaseStore.close()

const legacyMessages = []
for (let pair = 0; pair < 25; pair += 1) {
  legacyMessages.push(
    { role: 'user', content: pair === 0 ? 'My old synthetic fact is cobalt lantern.' : `legacy-user-${pair}` },
    { role: 'assistant', content: `legacy-assistant-${pair}` },
  )
}
const imported = store.resumeConversation({
  ownerId: 'ielts:7001',
  persona: 'keeper',
  conversationId: resumed.id,
  legacyImport: { importId: 'legacy-import-0001', messages: legacyMessages },
})
assert.equal(imported.turnCount, 50)
assert.equal(store.resumeConversation({
  ownerId: 'ielts:7001',
  persona: 'keeper',
  conversationId: resumed.id,
  legacyImport: { importId: 'legacy-import-0001', messages: legacyMessages },
}).turnCount, 50, 'legacy import retry must not duplicate messages')
assert.throws(() => store.resumeConversation({
  ownerId: 'ielts:7001',
  persona: 'keeper',
  conversationId: resumed.id,
  legacyImport: { importId: 'legacy-import-0001', messages: [{ role: 'user', content: 'different body' }] },
}), (error) => error?.statusCode === 409 && error?.code === 'tavern_import_idempotency_conflict')

let conversation = imported
for (let pair = 25; pair < 205; pair += 1) {
  const clientTurnId = `client-turn-${String(pair).padStart(4, '0')}`
  const begun = store.beginTurn({
    ownerId: 'ielts:7001',
    persona: 'keeper',
    conversationId: resumed.id,
    clientTurnId,
    expectedRevision: conversation.revision,
    message: `user-${pair}`,
    requestHash: `hash-${pair}-value`,
  })
  assert.equal(begun.replay, false)
  conversation = store.completeTurn({
    ownerId: 'ielts:7001',
    persona: 'keeper',
    conversationId: resumed.id,
    clientTurnId,
    assistantContent: `assistant-${pair}`,
    leaseId: begun.leaseId,
  }).conversation
  nowMs += 10
}
assert.equal(conversation.turnCount, 410)

const newestPage = store.getMessages({ ownerId: 'ielts:7001', persona: 'keeper', conversationId: resumed.id, limit: 40 })
assert.equal(newestPage.messages.length, 40)
assert.equal(newestPage.messages[0].sequence, 371)
assert.equal(newestPage.messages.at(-1).sequence, 410)
assert.ok(newestPage.nextBefore)
const previousPage = store.getMessages({ ownerId: 'ielts:7001', persona: 'keeper', conversationId: resumed.id, before: newestPage.nextBefore, limit: 40 })
assert.equal(previousPage.messages.at(-1).sequence, 370)
assert.equal(previousPage.messages[0].sequence, 331)

const context = store.contextForProvider({
  ownerId: 'ielts:7001',
  persona: 'keeper',
  conversationId: resumed.id,
  model: 'tiny-unverified-model',
  currentMessage: 'What was my old cobalt detail?',
  systemPrompt: 'system',
  contextWindowOverride: 1_500,
  maxOutboundBytes: 10_000,
})
assert.match(JSON.stringify(context.messages), /cobalt lantern/)
assert.ok(context.memory.usedHistoryMessages > 0)
assert.ok(context.memory.retrievedSegments > 0)
assert.equal(context.memory.historyTruncated, true)

const retryStart = store.beginTurn({
  ownerId: 'ielts:7001', persona: 'keeper', conversationId: resumed.id,
  clientTurnId: 'retry-turn-0001', expectedRevision: conversation.revision,
  message: 'retry body', requestHash: 'retry-hash-0001',
})
assert.equal(retryStart.providerCallRequired, true)
store.close()
store = createStore()
assert.throws(() => store.beginTurn({
  ownerId: 'ielts:7001', persona: 'keeper', conversationId: resumed.id,
  clientTurnId: 'retry-turn-0001', expectedRevision: conversation.revision,
  message: 'retry body', requestHash: 'retry-hash-0001',
}), (error) => error?.statusCode === 409 && error?.code === 'tavern_turn_in_progress')
nowMs += 1_100
const retryAfterRestart = store.beginTurn({
  ownerId: 'ielts:7001', persona: 'keeper', conversationId: resumed.id,
  clientTurnId: 'retry-turn-0001', expectedRevision: conversation.revision,
  message: 'retry body', requestHash: 'retry-hash-0001',
})
assert.equal(retryAfterRestart.replay, true)
assert.equal(retryAfterRestart.providerCallRequired, true)
assert.equal(retryAfterRestart.turns[1].status, 'pending')
assert.throws(() => store.beginTurn({
  ownerId: 'ielts:7001', persona: 'keeper', conversationId: resumed.id,
  clientTurnId: 'retry-turn-0001', expectedRevision: conversation.revision,
  message: 'changed retry body', requestHash: 'different-hash-0001',
}), (error) => error?.statusCode === 409 && error?.code === 'tavern_turn_idempotency_conflict')
const failed = store.failTurn({
  ownerId: 'ielts:7001', persona: 'keeper', conversationId: resumed.id,
  clientTurnId: 'retry-turn-0001', status: 'unavailable', assistantContent: '',
  leaseId: retryAfterRestart.leaseId,
})
assert.equal(failed.turns[1].status, 'unavailable')

assert.throws(() => store.beginTurn({
  ownerId: 'ielts:7001', persona: 'keeper', conversationId: resumed.id,
  clientTurnId: 'stale-revision-1', expectedRevision: 0,
  message: 'stale', requestHash: 'stale-hash-0001',
}), (error) => error?.statusCode === 409 && error?.code === 'tavern_conversation_revision_conflict')
assert.throws(() => store.getMessages({
  ownerId: 'ielts:7002', persona: 'keeper', conversationId: resumed.id, limit: 40,
}), (error) => error?.statusCode === 404 && error?.code === 'tavern_conversation_not_found')
assert.throws(() => store.getMessages({
  ownerId: 'ielts:7001', persona: 'tarot-reader', conversationId: resumed.id, limit: 40,
}), (error) => error?.statusCode === 409 && error?.code === 'tavern_conversation_persona_mismatch')

const deleted = store.deleteConversation({ ownerId: 'ielts:7001', persona: 'keeper', conversationId: resumed.id })
assert.deepEqual(deleted, { deleted: true, conversationId: resumed.id })
assert.throws(() => store.getMessages({ ownerId: 'ielts:7001', persona: 'keeper', conversationId: resumed.id }),
  (error) => error?.statusCode === 410 && error?.code === 'tavern_conversation_deleted')
assert.throws(() => store.resumeConversation({
  ownerId: 'ielts:7001', persona: 'keeper', conversationId: resumed.id,
  legacyImport: { importId: 'legacy-import-0001', messages: legacyMessages },
}), (error) => error?.statusCode === 410)
assert.throws(() => store.completeTurn({
  ownerId: 'ielts:7001', persona: 'keeper', conversationId: resumed.id,
  clientTurnId: 'retry-turn-0001', assistantContent: 'late completion', leaseId: retryAfterRestart.leaseId,
}), (error) => error?.statusCode === 410)

let largePageConversation = store.resumeConversation({ ownerId: 'ielts:9001', persona: 'keeper' })
for (let pair = 0; pair < 20; pair += 1) {
  const begun = store.beginTurn({
    ownerId: 'ielts:9001', persona: 'keeper', conversationId: largePageConversation.id,
    clientTurnId: `large-page-turn-${String(pair).padStart(4, '0')}`,
    expectedRevision: largePageConversation.revision,
    message: `user-${pair}:` + '界'.repeat(11_000),
    requestHash: `large-page-hash-${String(pair).padStart(4, '0')}`,
  })
  largePageConversation = store.completeTurn({
    ownerId: 'ielts:9001', persona: 'keeper', conversationId: largePageConversation.id,
    clientTurnId: `large-page-turn-${String(pair).padStart(4, '0')}`,
    leaseId: begun.leaseId,
    assistantContent: `assistant-${pair}:` + '界'.repeat(11_000),
  }).conversation
}
const boundedLargePage = store.getMessages({
  ownerId: 'ielts:9001', persona: 'keeper', conversationId: largePageConversation.id, limit: 40,
})
assert.ok(boundedLargePage.messages.length < 40)
assert.ok(Buffer.byteLength(JSON.stringify(boundedLargePage), 'utf8') <= 512 * 1024)
assert.ok(boundedLargePage.nextBefore)

const retrievalStore = createStore({ root: path.join(tempRoot, 'retrieval-store'), segmentTargetBytes: 256 })
let retrievalConversation = retrievalStore.resumeConversation({ ownerId: 'ielts:9010', persona: 'keeper' })
for (let pair = 0; pair < 220; pair += 1) {
  const clientTurnId = `retrieval-turn-${String(pair).padStart(4, '0')}`
  const begun = retrievalStore.beginTurn({
    ownerId: 'ielts:9010', persona: 'keeper', conversationId: retrievalConversation.id,
    clientTurnId, expectedRevision: retrievalConversation.revision,
    message: `${pair === 0 ? 'EARLYUNIQUEFACT-COBALT-ANCHOR' : `newer-${pair}`} ${'u'.repeat(300)}`,
    requestHash: `retrieval-hash-${String(pair).padStart(4, '0')}`,
  })
  retrievalConversation = retrievalStore.completeTurn({
    ownerId: 'ielts:9010', persona: 'keeper', conversationId: retrievalConversation.id,
    clientTurnId, leaseId: begun.leaseId, assistantContent: `answer-${pair} ${'a'.repeat(300)}`,
  }).conversation
}
const earlyRetrieved = retrievalStore.contextForProvider({
  ownerId: 'ielts:9010', persona: 'keeper', conversationId: retrievalConversation.id,
  model: 'unverified-small-model', contextWindowOverride: 1500, maxOutboundBytes: 8000,
  currentMessage: 'What was EARLYUNIQUEFACT-COBALT-ANCHOR?', systemPrompt: 'system',
})
assert.match(JSON.stringify(earlyRetrieved.messages), /EARLYUNIQUEFACT-COBALT-ANCHOR/)
retrievalStore.close()

const quotaStore = createStore({ root: path.join(tempRoot, 'quota-store'), quotaBytes: 64 * 1024 })
const quotaConversation = quotaStore.resumeConversation({ ownerId: 'ielts:8001', persona: 'keeper' })
const quotaBegun = quotaStore.beginTurn({
  ownerId: 'ielts:8001', persona: 'keeper', conversationId: quotaConversation.id,
  clientTurnId: 'quota-turn-0001', expectedRevision: 0,
  message: 'x'.repeat(60 * 1024), requestHash: 'quota-hash-0001',
})
assert.throws(() => quotaStore.completeTurn({
  ownerId: 'ielts:8001', persona: 'keeper', conversationId: quotaConversation.id,
  clientTurnId: 'quota-turn-0001', leaseId: quotaBegun.leaseId,
  assistantContent: 'y'.repeat(8 * 1024),
}), (error) => error?.statusCode === 413 && ['tavern_storage_quota_exceeded', 'tavern_physical_quota_exceeded'].includes(error?.code))
quotaStore.close()
store.close()
const cleanupRelative = path.relative(fs.realpathSync(scratchRoot), fs.realpathSync(tempRoot))
if (!cleanupRelative || cleanupRelative.startsWith('..') || path.isAbsolute(cleanupRelative) || !/^tavern-memory-[^/\\]+$/.test(cleanupRelative)) {
  throw new Error('Unsafe Tavern memory test cleanup target.')
}
fs.rmSync(tempRoot, { recursive: true, force: true })
if (fs.existsSync(scratchRoot) && fs.readdirSync(scratchRoot).length === 0) fs.rmdirSync(scratchRoot)

console.log(JSON.stringify({ status: 'passed', storedMessages: 410 }))
