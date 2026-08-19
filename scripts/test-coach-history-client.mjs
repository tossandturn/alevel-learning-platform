import assert from 'node:assert/strict'
import * as coachHistory from '../src/lib/coachHistory.js'
import {
  buildCoachConversationId,
  buildCoachStorageKey,
  buildLegacyCoachStorageKey,
  mergeCoachMessages,
  serializeCoachConversation,
} from '../src/lib/coachHistory.js'

const baseContext = {
  routeId: 'cie-9702-as-physics',
  stage: 'AS',
  subject: { code: '9702', title: 'Physics' },
  view: 'chapter-practice',
  attemptId: 'attempt-a',
  paper: { questionFile: '9702_s25_qp_21.pdf' },
  question: { id: 'group-q4', number: 4, label: 'Question 4' },
}

const stableId = buildCoachConversationId(baseContext)
assert.equal(
  stableId,
  buildCoachConversationId({ ...baseContext, view: 'result', attemptId: 'attempt-b' }),
  'conversation identity must not change when a student submits or changes surface',
)
assert.notEqual(
  stableId,
  buildCoachConversationId({ ...baseContext, question: { id: 'group-q5', number: 5 } }),
  'different official questions must keep separate Coach histories',
)
assert.equal(
  stableId,
  buildCoachConversationId({ ...baseContext, paper: {} }),
  'a stable official question ID must restore the same thread when another surface omits paper metadata',
)
assert.equal(
  buildCoachStorageKey(stableId, 'ielts:42'),
  buildCoachStorageKey(stableId, 'ielts:42'),
  'the same account must address the same local fallback key',
)
assert.notEqual(
  buildCoachStorageKey(stableId, 'ielts:42'),
  buildCoachStorageKey(stableId, 'ielts:43'),
  'local fallback keys must remain account scoped',
)

const legacyKey = buildLegacyCoachStorageKey(baseContext, 'guest')
assert.match(legacyKey, /^alevel-ai-coach-v3:/)

const merged = mergeCoachMessages(
  [
    { id: 'user-1', role: 'user', content: 'How do I start?', createdAt: '2026-08-19T01:00:00.000Z' },
    { id: 'assistant-1', role: 'assistant', content: 'Start with the force diagram.', createdAt: '2026-08-19T01:00:01.000Z' },
  ],
  [
    { role: 'assistant', content: 'Start with the force diagram.', createdAt: '2026-08-19T01:00:01.000Z' },
    { role: 'assistant', content: 'Then resolve the forces.', createdAt: '2026-08-19T01:00:02.000Z' },
  ],
)
assert.deepEqual(merged.map(({ role, content }) => `${role}:${content}`), [
  'user:How do I start?',
  'assistant:Start with the force diagram.',
  'assistant:Then resolve the forces.',
])

const recoveredStream = mergeCoachMessages(
  [{
    id: 'assistant-stream-1',
    role: 'assistant',
    content: 'Long partial guidance that was visible before the connection dropped.',
    createdAt: '2026-08-19T01:00:03.000Z',
    updatedAt: '2026-08-19T01:00:04.000Z',
    status: 'interrupted',
  }],
  [{
    id: 'assistant-stream-1',
    role: 'assistant',
    content: 'Use F = ma for the resultant force.',
    createdAt: '2026-08-19T01:00:03.000Z',
    updatedAt: '2026-08-19T01:00:05.000Z',
    status: 'completed',
  }],
)
assert.deepEqual(
  recoveredStream.map(({ id, content, status }) => ({ id, content, status })),
  [{
    id: 'assistant-stream-1',
    content: 'Use F = ma for the resultant force.',
    status: 'completed',
  }],
  'a retry must replace the same interrupted assistant slot rather than restoring both partial and completed copies',
)

const serialized = serializeCoachConversation({
  conversationId: stableId,
  context: baseContext,
  messages: [
    { role: 'user', content: 'Look at this', imageDataUrls: ['data:image/png;base64,secret'] },
    {
      id: 'assistant-stream-1',
      role: 'assistant',
      content: 'The first step is to label the forces.',
      mode: 'ai',
      createdAt: '2026-08-19T01:00:06.000Z',
      updatedAt: '2026-08-19T01:00:07.000Z',
    },
  ],
})
assert.equal(serialized.conversationId, stableId)
assert.equal(serialized.sourceProduct, 'stem')
assert.equal(serialized.messages[0].attachments.length, 1)
assert.equal(serialized.messages[1].id, 'assistant-stream-1')
assert.equal(serialized.messages[1].updatedAt, '2026-08-19T01:00:07.000Z')
assert.equal(serialized.context.routeId, baseContext.routeId, 'account history must retain safe route context for cross-version restoration')
assert.doesNotMatch(JSON.stringify(serialized), /data:image|base64|secret/)

assert.equal(typeof coachHistory.serializeCoachContext, 'function', 'Coach history must expose a sanitized context snapshot serializer')
assert.equal(typeof coachHistory.mergeCoachContext, 'function', 'Coach history must restore a persisted context snapshot without replacing live state')
assert.equal(typeof coachHistory.buildCoachRetryRequest, 'function', 'Coach history must reconstruct an interrupted request after refresh')

const interruptedConversation = serializeCoachConversation({
  conversationId: stableId,
  context: {
    ...baseContext,
    question: {
      ...baseContext.question,
      prompt: 'A triangular prism question with the official OCR context.',
    },
    sourceQuestionExtract: 'Official OCR excerpt: resolve the forces and state the unit.',
    response: 'My typed working is 12 N to the right.',
  },
  messages: [
    {
      id: 'user-retry-1',
      role: 'user',
      content: 'Check my photographed working.',
      imageDataUrls: ['data:image/png;base64,private-image'],
      createdAt: '2026-08-19T01:00:08.000Z',
    },
    {
      id: 'assistant-retry-1',
      role: 'assistant',
      content: 'The connection stopped after the first step.',
      mode: 'interrupted',
      status: 'interrupted',
      warning: 'stream ended',
      hintLevel: 3,
      createdAt: '2026-08-19T01:00:09.000Z',
      updatedAt: '2026-08-19T01:00:10.000Z',
    },
  ],
})
const restoredRetry = coachHistory.buildCoachRetryRequest(interruptedConversation.messages)
assert.deepEqual(
  {
    assistantId: restoredRetry?.assistantId,
    message: restoredRetry?.message,
    level: restoredRetry?.level,
    previous: restoredRetry?.previous,
    attachments: restoredRetry?.attachments,
    unavailableAttachmentCount: restoredRetry?.unavailableAttachmentCount,
  },
  {
    assistantId: 'assistant-retry-1',
    message: 'Check my photographed working.',
    level: 3,
    previous: [],
    attachments: [],
    unavailableAttachmentCount: 1,
  },
  'refresh recovery must reuse the original user turn and assistant slot without reviving image bytes',
)
assert.equal(interruptedConversation.contextText, 'Official OCR excerpt: resolve the forces and state the unit.')
assert.doesNotMatch(JSON.stringify(interruptedConversation), /private-image|data:image|base64/)
const restoredContext = coachHistory.mergeCoachContext(
  { routeId: baseContext.routeId, question: { id: 'group-q4' } },
  { contextText: interruptedConversation.contextText },
)
assert.equal(restoredContext.sourceQuestionExtract, 'Official OCR excerpt: resolve the forces and state the unit.')

const unsafeContext = coachHistory.serializeCoachContext({
  contextText: 'Official OCR text. data:image/png;base64,private-context-image',
})
assert.doesNotMatch(JSON.stringify(unsafeContext), /data:image|base64|private-context-image/)

for (const status of ['failed', 'retrying', 'streaming']) {
  const statusRetry = coachHistory.buildCoachRetryRequest([
    {
      id: `user-${status}`,
      role: 'user',
      content: `Recover ${status}`,
      createdAt: '2026-08-19T01:00:11.000Z',
    },
    {
      id: `assistant-${status}`,
      role: 'assistant',
      content: `Partial ${status}`,
      status,
      hintLevel: 2,
      createdAt: '2026-08-19T01:00:12.000Z',
      updatedAt: '2026-08-19T01:00:13.000Z',
    },
  ])
  assert.equal(statusRetry?.assistantId, `assistant-${status}`, `status=${status} must remain retryable after refresh`)
}

console.log('Client Coach history contract checks passed.')
