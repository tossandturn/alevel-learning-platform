import assert from 'node:assert/strict'

import { createNativeQuestionImages } from '../server/nativeQuestionImages.js'

const documentSha256 = 'a'.repeat(64)
const pageHash = (value) => value.repeat(64)
const permutations = (items) => items.length < 2
  ? [items]
  : items.flatMap((item, index) => permutations(items.filter((_, itemIndex) => itemIndex !== index)).map((tail) => [item, ...tail]))

function evidence({ page = 8, region, imageSize = [1488, 2105], hash = pageHash('b') }) {
  return {
    page,
    documentSha256,
    pageImageSha256: hash,
    imageSize,
    coordinateSpace: 'normalized-xyxy',
    region,
  }
}

function descriptors({ partEvidence, diagramRegions }) {
  const question = {
    routeId: 'cie-9700-as-biology',
    sourceQuestionId: 'cie-9700-9700_s25_qp_13:q16',
    subjectCode: '9700',
    released: true,
    sourceRef: { paper: '9700_s25_qp_13.pdf', sha256: documentSha256 },
    sourceContent: {
      schemaVersion: 'ai-verified-coordinate-source-v1',
      complete: true,
      fileComplete: true,
      bindingSignature: 'trusted-region-dedup-fixture',
    },
    parts: [{ sourceEvidence: partEvidence }],
    diagramRegions,
  }
  return createNativeQuestionImages({
    getQuestionBank: () => [question],
    isReleased: (item) => item.released === true,
  }).descriptors(question.routeId, question.sourceQuestionId)
}

const completeQuestion = evidence({ region: [0.06, 0.06, 0.94, 0.43] })
const repeatedTable = evidence({ region: [0.055, 0.135, 0.94, 0.405] })
const mergedQuestionAndTable = [0.055, 0.06, 0.94, 0.43]
assert.deepEqual(
  descriptors({ partEvidence: [completeQuestion, repeatedTable], diagramRegions: [repeatedTable] }).map((item) => item.region),
  [mergedQuestionAndTable],
  'a same-page diagram crop with only an 8px boundary overshoot and over 99% pixel coverage merges into one union crop without losing the trusted outer pixels',
)

const existingUnion = evidence({ region: mergedQuestionAndTable })
assert.deepEqual(
  descriptors({ partEvidence: [completeQuestion, existingUnion, repeatedTable], diagramRegions: [repeatedTable] }).map((item) => item.region),
  [mergedQuestionAndTable],
  'when a fuzzy union equals an existing trusted region, exactly one stable descriptor must remain',
)
assert.deepEqual(
  descriptors({ partEvidence: [repeatedTable, existingUnion, completeQuestion], diagramRegions: [repeatedTable] }).map((item) => item.region),
  [mergedQuestionAndTable],
  'equal-union coalescing must be deterministic when trusted part evidence arrives in a different order',
)

const graphQuestion = evidence({ region: [0.06, 0.06, 0.94, 0.63] })
const repeatedGraph = evidence({ region: [0.02, 0.22, 0.95, 0.49] })
assert.deepEqual(
  descriptors({ partEvidence: [graphQuestion, repeatedGraph], diagramRegions: [repeatedGraph] }).map((item) => item.region),
  [[0.02, 0.06, 0.95, 0.63]],
  'a verified graph crop already 94% covered by the complete question merges by union when the complete crop grows by no more than 6%',
)

const adjacentRegion = evidence({ region: [0.06, 0.44, 0.94, 0.6] })
assert.deepEqual(
  descriptors({ partEvidence: [completeQuestion, adjacentRegion], diagramRegions: [adjacentRegion] }).map((item) => item.region),
  [completeQuestion.region, adjacentRegion.region],
  'an adjacent same-page region must remain independently visible',
)

const overflowingDiagram = evidence({ region: [0.03, 0.12, 0.98, 0.405] })
assert.deepEqual(
  descriptors({ partEvidence: [completeQuestion, overflowingDiagram], diagramRegions: [overflowingDiagram] }).map((item) => item.region),
  [completeQuestion.region, overflowingDiagram.region],
  'a diagram with meaningful pixels outside the complete-question crop must not be swallowed',
)

const ratchetOuter = evidence({ imageSize: [1000, 1000], region: [0.1, 0.1, 0.5, 0.5] })
const ratchetDiagram1 = evidence({ imageSize: [1000, 1000], region: [0.12, 0.15, 0.52, 0.45] })
const ratchetDiagram2 = evidence({ imageSize: [1000, 1000], region: [0.14, 0.15, 0.54, 0.45] })
const ratchetOutputs = permutations([ratchetOuter, ratchetDiagram1, ratchetDiagram2]).flatMap((partEvidence) => (
  permutations([ratchetDiagram1, ratchetDiagram2]).map((diagramRegions) => descriptors({ partEvidence, diagramRegions }))
))
for (const output of ratchetOutputs) assert.deepEqual(output, ratchetOutputs[0], 'cumulative unions and diagram order must be deterministic')
assert.deepEqual(
  ratchetOutputs[0].map((item) => item.region),
  [[0.1, 0.1, 0.52, 0.5], ratchetDiagram2.region],
  'each cumulative union is measured against the immutable original part bounds, so total growth cannot ratchet past 6%',
)

const tieA = evidence({ imageSize: [1000, 1000], region: [0.1, 0.1, 0.5, 0.5] })
const tieB = evidence({ imageSize: [1000, 1000], region: [0.11, 0.1, 0.51, 0.5] })
const tieDiagram = evidence({ imageSize: [1000, 1000], region: [0.105, 0.15, 0.505, 0.45] })
const tieOutputs = permutations([tieA, tieB, tieDiagram]).map((partEvidence) => descriptors({ partEvidence, diagramRegions: [tieDiagram] }))
for (const output of tieOutputs) assert.deepEqual(output, tieOutputs[0], 'canonical tie-breaking must make descriptor URL/v independent of part evidence order')
assert.deepEqual(tieOutputs[0].map((item) => item.region), [[0.1, 0.1, 0.505, 0.5], tieB.region])

const slightlyLargerDiagram = evidence({ imageSize: [1000, 1000], region: [0.096, 0.101, 0.5, 0.5] })
assert.deepEqual(
  descriptors({ partEvidence: [ratchetOuter, slightlyLargerDiagram], diagramRegions: [slightlyLargerDiagram] }).map((item) => item.region),
  [[0.096, 0.1, 0.5, 0.5]],
  'a diagram may be slightly larger than its part when coverage, overflow, and immutable-baseline union growth all remain conservative',
)

const secondPageDiagram = evidence({ page: 9, hash: pageHash('c'), region: [0.055, 0.135, 0.94, 0.405] })
assert.deepEqual(
  descriptors({ partEvidence: [completeQuestion, secondPageDiagram], diagramRegions: [secondPageDiagram] }).map((item) => [item.page, item.region]),
  [[8, completeQuestion.region], [9, secondPageDiagram.region]],
  'near-containment must never deduplicate across pages',
)

assert.deepEqual(
  descriptors({ partEvidence: [completeQuestion, repeatedTable], diagramRegions: [] }).map((item) => item.region),
  [completeQuestion.region, repeatedTable.region],
  'fuzzy containment applies only to diagram provenance, not two independently trusted part regions',
)

console.log(JSON.stringify({
  status: 'passed',
  scope: 'pixel-aware trusted source-region deduplication',
  cases: 11,
}))
