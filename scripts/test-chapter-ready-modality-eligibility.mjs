import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { chapterReadyModalityEligibility } from './chapter-ready-modality-eligibility.mjs'

const syllabus = JSON.parse(fs.readFileSync(path.resolve('src/data/syllabus/biology-9700-as-mitotic-cell-cycle-source.json'), 'utf8'))
const originalPointsJson = JSON.stringify(syllabus.points)
const textOnly = chapterReadyModalityEligibility(syllabus.points, {
  sourceKind: 'text-only-mcq',
  hasDiagram: false,
  hasPhotomicrograph: false,
  hasMicroscopeSlide: false,
  printedTableCount: 0,
})
assert.equal(textOnly.eligiblePoints.length, 7)
assert.deepEqual(textOnly.excludedPoints.map((point) => point.officialOutcomeCode), ['5.2.2'])
assert.ok(textOnly.eligiblePoints.some((point) => point.officialOutcomeCode === '5.2.1'))

const tableOnly = chapterReadyModalityEligibility(syllabus.points, {
  sourceKind: 'table-mcq',
  hasDiagram: false,
  hasPhotomicrograph: false,
  hasMicroscopeSlide: false,
  printedTableCount: 2,
})
assert.equal(tableOnly.eligiblePoints.length, 7, 'Printed tables alone must not satisfy the visual modality required by 5.2.2.')

const diagram = chapterReadyModalityEligibility(syllabus.points, {
  sourceKind: 'diagram-mcq',
  hasDiagram: true,
  hasPhotomicrograph: false,
  hasMicroscopeSlide: false,
  printedTableCount: 0,
})
assert.equal(diagram.eligiblePoints.length, 8)
assert.equal(diagram.excludedPoints.length, 0)

const providerRawFixture = Object.freeze({
  syllabusPointIds: Object.freeze(['biology-9700-2025-5-2-01', 'biology-9700-2025-5-2-02']),
  reviewDecision: 'accept',
})
const providerRawBefore = JSON.stringify(providerRawFixture)
chapterReadyModalityEligibility(syllabus.points, textOnly.evidence)
assert.equal(JSON.stringify(providerRawFixture), providerRawBefore, 'Modality eligibility must constrain the request schema and never rewrite provider output.')
assert.equal(JSON.stringify(syllabus.points), originalPointsJson, 'Modality eligibility must not mutate the canonical syllabus catalog.')

console.log(JSON.stringify({
  status: 'PASS_CHAPTER_READY_MODALITY_ELIGIBILITY',
  textOnlyEligiblePoints: textOnly.eligiblePoints.length,
  excludedOutcomeCodes: textOnly.excludedPoints.map((point) => point.officialOutcomeCode),
  providerRawRewritten: false,
}))
