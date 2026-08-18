import assert from 'node:assert/strict'
import { syllabusPracticeRebindPayload } from '../src/lib/syllabusPracticeRebind.js'

const binding = {
  sourceQuestionId: 'cie-9702-9702_m25_qp_12:q4',
  questionPartId: 'a',
  bindingSignature: 'fnv1a64:1234567890abcdef',
  reviewVersion: '9702-p1-m25-v2',
  sourceDocumentSha256: 'a'.repeat(64),
  answerDocumentSha256: 'b'.repeat(64),
  sourceIndexSha256: 'c'.repeat(64),
  sourceManifestChecksum: 'd'.repeat(64),
}

const persistedUnit = {
  id: 'syllabus-set:large-fixture',
  type: 'topic',
  agentGenerated: true,
  sourceAuthority: 'server-syllabus',
  sourceGateVersion: 'server-syllabus-catalog-v2',
  routeId: 'cie-9702-as-physics',
  syllabusTopic: 'physics-9702-topic-02',
  knowledgeGroupId: 'physics-9702-topic-02',
  paperComponent: [1, 2],
  title: 'untrusted client title',
  prompt: 'x'.repeat(500_000),
  sourceRef: { assetUrls: ['https://example.invalid/large-page.jpg'], prompt: 'x'.repeat(500_000) },
  answerRef: { assetUrls: ['https://example.invalid/large-mark-scheme.jpg'], prompt: 'x'.repeat(500_000) },
  parts: [{
    id: 'syllabus-set:large-fixture:question:a',
    sourceQuestionId: binding.sourceQuestionId,
    questionPartId: binding.questionPartId,
    sourceBindingProvenance: binding,
    markingProvenance: { ...binding, extra: 'x'.repeat(500_000) },
    prompt: 'x'.repeat(500_000),
    sourceRef: { assetUrls: ['https://example.invalid/part.jpg'] },
  }],
}

const payload = syllabusPracticeRebindPayload(persistedUnit)
const encoded = JSON.stringify({ unit: payload })

assert.ok(encoded.length < 10_000, `rebind payload must remain compact; got ${encoded.length} bytes`)
assert.equal(payload.id, persistedUnit.id)
assert.equal(payload.sourceAuthority, 'server-syllabus')
assert.deepEqual(payload.paperComponent, [1, 2])
assert.equal(payload.parts.length, 1)
assert.deepEqual(payload.parts[0].sourceBindingProvenance, binding)
assert.equal('prompt' in payload.parts[0], false)
assert.equal('sourceRef' in payload.parts[0], false)
assert.equal('answerRef' in payload.parts[0], false)

console.log(JSON.stringify({ status: 'passed', encodedBytes: encoded.length, parts: payload.parts.length }))
