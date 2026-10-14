import assert from 'node:assert/strict'
import { buildSyllabusPracticeSet, rebindSyllabusPracticeUnit } from '../src/lib/syllabusPractice.js'
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
  practiceMode: 'verified',
  focusedRetestOf: 'syllabus-set:parent-fixture',
  focusedRetestParentAttemptId: 'att-parent-fixture-0001',
  routeId: 'cie-9702-as-physics',
  stage: 'AS',
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
assert.equal(payload.practiceMode, 'verified')
assert.equal(payload.focusedRetestOf, persistedUnit.focusedRetestOf)
assert.equal(payload.focusedRetestParentAttemptId, persistedUnit.focusedRetestParentAttemptId)
assert.equal(payload.stage, persistedUnit.stage)
assert.deepEqual(payload.paperComponent, [1, 2])
assert.equal(payload.parts.length, 1)
assert.deepEqual(payload.parts[0].sourceBindingProvenance, binding)
assert.equal('prompt' in payload.parts[0], false)
assert.equal('sourceRef' in payload.parts[0], false)
assert.equal('answerRef' in payload.parts[0], false)

const generated = buildSyllabusPracticeSet({
  routeId: 'cie-9702-as-physics',
  syllabusTopicIds: ['physics-9702-topic-02'],
  questionCount: 10,
  components: [1, 2],
  excludeAttempted: false,
  seed: 1,
})
const generatedUnitId = 'syllabus-set:cie-9702-as-physics:physics-9702-topic-02:c1-2:q10:s1'
const generatedUnit = {
  id: generatedUnitId,
  sourceAuthority: 'server-syllabus',
  sourceGateVersion: 'server-syllabus-catalog-v2',
  routeId: generated.routeId,
  stage: generated.stage,
  syllabusTopic: generated.syllabusTopicIds.join(','),
  knowledgeGroupId: generated.syllabusTopicIds[0],
  paperComponent: generated.components,
  studyMode: generated.studyMode,
  sourcePreference: generated.sourcePreference,
  practiceMode: generated.practiceMode,
  parts: generated.questionGroups.flatMap((group) => group.parts.map((part) => ({
    id: `${generatedUnitId}:${group.id}:${part.partId}`,
    sourceQuestionId: group.id,
    questionPartId: part.partId,
    sourceKind: 'past-paper',
    sourceBindingProvenance: part.sourceBindingProvenance,
    markingProvenance: part.markingProvenance,
  }))),
}
const rebound = rebindSyllabusPracticeUnit(generatedUnit)
assert.ok(rebound, 'a current generated syllabus unit must rebind against the same source bank')
const reboundMcq = rebound.parts.find((part) => part.sourceQuestionId === 'cie-9702-9702_s25_qp_11:q8')
assert.ok(reboundMcq, 'the deterministic Kinematics fixture must include S25/11 Q8')
assert.equal(reboundMcq.answerType, 'multiple-choice', 'rebind must preserve the MCQ response contract')
assert.equal(reboundMcq.options.length, 4, 'rebind must preserve the four visible choices')
assert.equal(reboundMcq.answerKey, 'A', 'rebind must preserve the bound deterministic answer')
assert.deepEqual(generated.sourceMix, { official: 10, originalFoundation: 0 }, 'generate must retain the strict source authority contract')
assert.deepEqual(rebound.sourceMix, generated.sourceMix, 'rebind must retain the exact source authority contract')

console.log(JSON.stringify({ status: 'passed', encodedBytes: encoded.length, parts: payload.parts.length }))
