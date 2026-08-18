import assert from 'node:assert/strict'
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

const serialized = serializeCoachConversation({
  conversationId: stableId,
  context: baseContext,
  messages: [
    { role: 'user', content: 'Look at this', imageDataUrls: ['data:image/png;base64,secret'] },
    { role: 'assistant', content: 'The first step is to label the forces.', mode: 'ai' },
  ],
})
assert.equal(serialized.conversationId, stableId)
assert.equal(serialized.sourceProduct, 'stem')
assert.equal(serialized.messages[0].attachments.length, 1)
assert.doesNotMatch(JSON.stringify(serialized), /data:image|base64|secret/)

console.log('Client Coach history contract checks passed.')
