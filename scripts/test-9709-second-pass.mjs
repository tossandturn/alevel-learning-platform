import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import importedIndex from '../src/data/importedQuestionIndex.json' with { type: 'json' }
import { unifiedQuestionBank } from '../src/data/questionBank.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = execFileSync(process.execPath, ['scripts/audit-9709-second-pass.mjs', '--json'], { cwd: root, encoding: 'utf8' })
const report = JSON.parse(output)
assert.equal(report.schemaVersion, '9709-second-pass-audit-v1')
const indexed9709 = importedIndex.questions.filter((question) => question.subjectCode === '9709')
assert.equal(report.summary.total, indexed9709.length, 'the second pass must cover every currently imported 9709 group')
assert.equal(report.summary.reviewedFailures, 0, 'a reviewed 9709 record must never survive a failed second pass')
assert.equal(report.summary.verifiedComplete, 0, 'machine-indexed 9709 records must not be promoted by an automated second pass')
assert.ok(report.summary.unreviewed + report.summary.semanticQuarantined === report.summary.total, 'every 9709 group must remain in an explicit review state')
assert.ok(report.summary.rangeGapCandidates > 0, 'range candidates must be reported for independent semantic review')
assert.ok(report.paperIssues.some((issue) => issue.questionId === 'cie-9709-9709_m25_qp_32:q8' && issue.reason === 'source-range-gap-candidate'), 'the known 9709 range candidate must remain represented')
const repairedMechanicsPaper = report.records
  .filter((record) => record.paperId === 'cie-9709-9709_m25_qp_42')
  .toSorted((left, right) => left.questionNumber - right.questionNumber)
assert.deepEqual(
  repairedMechanicsPaper.map((record) => record.questionNumber),
  [1, 2, 3, 4, 5, 6, 7],
  'the source-backed repair must restore every printed M25/42 Mechanics question group',
)
assert.ok(
  !report.paperIssues.some((issue) => issue.paperId === 'cie-9709-9709_m25_qp_42' && issue.reason === 'question-number-gap'),
  'the repaired M25/42 paper must not retain a missing-question diagnostic',
)
const repairedQ4 = repairedMechanicsPaper.find((record) => record.questionId === 'cie-9709-9709_m25_qp_42:q4')
assert.deepEqual(repairedQ4?.qpAssets.map((asset) => asset.page), [6, 7], 'Q4 must retain both official question-paper pages')
assert.deepEqual(repairedQ4?.msAssets.map((asset) => asset.page), [11, 12], 'Q4 must retain the paired mark-scheme pages')
const repairedQ4Index = indexed9709.find((question) => question.questionId === 'cie-9709-9709_m25_qp_42:q4')
assert.deepEqual(repairedQ4Index?.parts.map((part) => part.label), ['a', 'b'], 'Q4 must retain both printed parts')
assert.deepEqual(repairedQ4Index?.parts.map((part) => part.marks), [4, 3], 'Q4 marks must close to the official total')
assert.equal(repairedQ4Index?.totalMarks, 7, 'Q4 must retain the official seven marks')
const repairedQ6 = repairedMechanicsPaper.find((record) => record.questionId === 'cie-9709-9709_m25_qp_42:q6')
assert.deepEqual(repairedQ6?.qpAssets.map((asset) => asset.page), [10, 11], 'Q6 must not consume Q4 source pages')
const structurallyIncomplete = report.records.find((record) => record.questionId === 'cie-9709-9709_m25_qp_32:q3')
assert.ok(
  structurallyIncomplete?.issues.includes('question-parts-missing') && structurallyIncomplete?.issues.includes('mark-scheme-parts-missing'),
  'a source record without paired structured parts must remain quarantined',
)
const crossPage = report.records.find((record) => record.questionId === 'cie-9709-9709_s25_qp_13:q9')
assert.deepEqual(crossPage?.qpAssets.map((asset) => asset.page), [10, 11], 'cross-page QP evidence must retain both pages')
assert.deepEqual(crossPage?.msAssets.map((asset) => asset.page), [18, 19, 20, 21], 'cross-page MS evidence must retain every declared page')
assert.ok(crossPage?.qpAssets.every((asset) => asset.valid && asset.width > 0 && asset.height > 0), 'QP assets must be non-empty decodable images')
assert.ok(crossPage?.msAssets.every((asset) => asset.valid && asset.width > 0 && asset.height > 0), 'MS assets must be non-empty decodable images')
assert.equal(unifiedQuestionBank.filter((question) => question.subjectCode === '9709').length, 0, 'unreviewed 9709 groups must not enter the runtime practice bank')
assert.ok(importedIndex.questions.filter((question) => question.subjectCode === '9709').every((question) => importedIndex.bindings.find((binding) => binding.questionId === question.questionId)?.verificationStatus !== 'reviewed'), 'the imported 9709 batch must remain machine-indexed or quarantined until evidence review')
console.log(JSON.stringify({ status: 'passed', summary: report.summary }))
