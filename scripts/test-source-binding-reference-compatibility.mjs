import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const moduleArg = process.argv.find((value) => value.startsWith('--module='))?.slice('--module='.length)
const moduleUrl = moduleArg
  ? pathToFileURL(path.resolve(moduleArg)).href
  : new URL('../src/lib/sourceContentContract.js', import.meta.url).href
const { sourceBindingSignature } = await import(moduleUrl)
const hash = (value) => value.repeat(64)
const legacyQuestion = {
  sourceQuestionId: 'cie-9702-fixture:q1',
  sourceRef: { paperId: 'cie-9702-fixture', sha256: hash('a'), pageStart: 2, pageEnd: 2 },
  answerRef: { documentId: 'ms', sha256: hash('b') },
  parts: [{
    partId: 'q1:a',
    sourceEvidence: [{ page: 2, documentSha256: hash('a'), pageImageSha256: hash('c'),
      coordinateSpace: 'normalized-xyxy', region: [0.1, 0.1, 0.9, 0.9], imageSize: [100, 100] }],
    markSchemeEvidence: [{ page: 3, pageImageSha256: hash('d') }],
  }],
}
const productionSignature = 'fnv1a64:03a8aee951f78ea3'
assert.equal(sourceBindingSignature(legacyQuestion), productionSignature,
  'a pre-reference coordinate question must retain its f99742d signature')

for (const rotation of [undefined, null, 0, '0']) {
  const question = structuredClone(legacyQuestion)
  question.parts[0].sourceEvidence[0].rotationDegrees = rotation
  question.parts[0].sourceEvidence[0].evidenceRole = 'question-part'
  assert.equal(sourceBindingSignature(question), productionSignature,
    `legacy non-reference evidence with rotation ${String(rotation)} must preserve the production signature`)
}

const referenceQuestion = structuredClone(legacyQuestion)
referenceQuestion.parts[0].sourceEvidence.push({
  page: 24, documentSha256: hash('a'), pageImageSha256: hash('e'),
  coordinateSpace: 'normalized-xyxy', region: [0.1, 0.2, 0.9, 0.8], imageSize: [100, 100],
  evidenceRole: 'reference-material', rotationDegrees: 90,
})
const referenceSignature = sourceBindingSignature(referenceQuestion)
assert.notEqual(referenceSignature, productionSignature, 'adding a source-bound reference must alter the question binding')

const mutations = [
  ['reference rotation', (entry) => { entry.rotationDegrees = 270 }],
  ['reference role', (entry) => { entry.evidenceRole = 'question-part' }],
  ['reference page', (entry) => { entry.page = 23 }],
  ['reference document hash', (entry) => { entry.documentSha256 = hash('f') }],
  ['reference page hash', (entry) => { entry.pageImageSha256 = hash('f') }],
  ['reference crop', (entry) => { entry.region[0] = 0.2 }],
  ['reference image size', (entry) => { entry.imageSize[0] = 101 }],
]
for (const [label, mutate] of mutations) {
  const question = structuredClone(referenceQuestion)
  mutate(question.parts[0].sourceEvidence[1])
  assert.notEqual(sourceBindingSignature(question), referenceSignature, `${label} must alter the source binding`)
}

const invalidRotation = structuredClone(referenceQuestion)
invalidRotation.parts[0].sourceEvidence[1].rotationDegrees = 'invalid'
const zeroRotation = structuredClone(referenceQuestion)
zeroRotation.parts[0].sourceEvidence[1].rotationDegrees = 0
assert.notEqual(sourceBindingSignature(invalidRotation), sourceBindingSignature(zeroRotation),
  'an invalid rotation must not collide with the valid unrotated reference binding')

console.log(JSON.stringify({ status: 'PASS', baseline: 'f99742d76a028e5f525cddad538ae7b31f9a8d50', legacyCases: 5, referenceMutationCases: mutations.length + 2 }))
