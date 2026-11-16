import assert from 'node:assert/strict'
import path from 'node:path'
import { questionGroupsFromAiArtifacts } from '../server/aiVerifiedQuestionBank.js'

const libraryRoot = path.resolve('synthetic-library')
const requirements = { schemaVersion: 'stem-ai-scoring-context.v1', dependency: 'follow-through',
  dependsOnPartLabels: ['b'], evidenceRequirement: 'student-work-visible-and-readable', onMissing: 'human-review-required' }
const region = { page: 3, pageImageSha256: 'd'.repeat(64), x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.8 }
const scheme = { page: 5, pageImageSha256: 'e'.repeat(64) }
const artifact = {
  schemaVersion: 'ai-pdf-ingestion.v1', artifactId: `sha256:${'c'.repeat(64)}`,
  paperId: 'cie-9709-9709_m25_qp_12', subject: '9709', stage: 'AS', syllabusRouteId: 'cie-9709-as-p1-p5',
  status: 'ai-verified', storageMode: 'coordinate-only',
  source: { questionPdfRelativePath: '9709/9709_m25_qp_12.pdf', markSchemePdfRelativePath: '9709/9709_m25_ms_12.pdf',
    questionPdfSha256: 'a'.repeat(64), markSchemePdfSha256: 'b'.repeat(64), renderDpi: 120,
    pageSizes: { 3: { width: 1200, height: 1600 } }, pageImageHashes: { 3: 'd'.repeat(64) },
    markSchemePageSizes: { 5: { width: 1200, height: 1600 } }, markSchemePageHashes: { 5: 'e'.repeat(64) } },
  candidate: { questions: [{ questionNumber: '2', questionStartPage: 3, regions: [region], diagramRegions: [],
    parts: [{ label: 'b', marks: 3, ocrText: 'Synthetic part b.' },
      { label: 'c', marks: 2, ocrText: 'Synthetic part c.', scoringContextRequirements: requirements }],
    tags: { primaryTopicId: '9709-p1-topic-01', secondaryTopicIds: [], syllabusPointIds: [] }, markSchemeEvidence: [scheme] }] },
  verification: { questions: [{ questionNumber: '2', questionStartPage: 3, pages: [3], regions: [region], diagramRegions: [],
    parts: [{ label: 'b', marks: 3 }, { label: 'c', marks: 2, scoringContextRequirements: structuredClone(requirements) }],
    diagramRegionCount: 0, tags: { primaryTopicId: '9709-p1-topic-01', secondaryTopicIds: [], syllabusPointIds: [] },
    markSchemeEvidence: [scheme] }] },
}
const groups = (value) => questionGroupsFromAiArtifacts([value], { libraryRoot })
assert.equal(groups(artifact).length, 1)
assert.deepEqual(groups(artifact)[0].parts.find((part) => part.label === 'c').scoringContextRequirements, requirements)
for (const mutate of [
  (item) => { item.verification.questions[0].parts[1].scoringContextRequirements = null },
  (item) => { item.verification.questions[0].parts[1].scoringContextRequirements.dependsOnPartLabels = ['c'] },
  (item) => { item.candidate.questions[0].parts[1].scoringContextRequirements.onMissing = 'allow' },
  (item) => { item.candidate.questions[0].parts[1].scoringContextRequirements.dependsOnPartLabels = ['unknown'] },
  (item) => {
    for (const review of [item.candidate, item.verification]) {
      review.questions[0].parts[0].scoringContextRequirements = { ...requirements, dependsOnPartLabels: ['c'] }
    }
  },
]) {
  const invalid = structuredClone(artifact)
  mutate(invalid)
  assert.equal(groups(invalid).length, 0, 'unsafe or inconsistent context requirements must reject the artifact')
}
const legacy = structuredClone(artifact)
delete legacy.candidate.questions[0].parts[1].scoringContextRequirements
delete legacy.verification.questions[0].parts[1].scoringContextRequirements
assert.equal(groups(legacy).length, 1, 'legacy artifacts without requirements remain unchanged')
assert.equal(groups(legacy)[0].sourceContent.bindingSignature,
  `ai:${artifact.artifactId}:${artifact.syllabusRouteId}:2`, 'legacy signatures without dependencies must remain unchanged')
assert.equal(groups(artifact)[0].sourceContent.bindingSignature, groups(legacy)[0].sourceContent.bindingSignature,
  'existing source signatures remain stable for renderer and draft compatibility')
assert.match(groups(artifact)[0].parts.find((part) => part.label === 'c').scoringContextFingerprint, /^[a-f0-9]{64}$/,
  'dependent scoring requires a separately verified server-side context fingerprint')
console.log(JSON.stringify({ status: 'PASS_LOCAL_SYNTHETIC_ONLY', contextDependencies: true, mismatchFailClosed: true }))
