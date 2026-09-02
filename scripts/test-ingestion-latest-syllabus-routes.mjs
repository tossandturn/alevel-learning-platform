import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { routeById } from '../src/data/routeRegistry.js'
import { parseArgs, syllabusForOptions } from './ingest-ai-pdf-questions.mjs'

const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'ingestion-latest-routes-'))
const questionPdf = path.join(temporaryRoot, 'question.pdf')
const markSchemePdf = path.join(temporaryRoot, 'mark-scheme.pdf')
writeFileSync(questionPdf, '%PDF-question-fixture', 'utf8')
writeFileSync(markSchemePdf, '%PDF-mark-scheme-fixture', 'utf8')

const cases = [
  ['0580', 'IGCSE', 2, 'cie-0580-igcse-mathematics', 'cie-0580-0580_m25_qp_22'],
  ['0606', 'IGCSE', 1, 'cie-0606-igcse-additional-mathematics', 'cie-0606-0606_m25_qp_12'],
  ['0610', 'IGCSE', 2, 'cie-0610-igcse-biology', 'cie-0610-0610_m25_qp_22'],
  ['0625', 'IGCSE', 2, 'cie-0625-igcse-physics', 'cie-0625-0625_m25_qp_22'],
  ['9700', 'AS', 2, 'cie-9700-as-biology', 'cie-9700-9700_m25_qp_22'],
  ['9700', 'A2', 4, 'cie-9700-a2-biology', 'cie-9700-9700_m25_qp_42'],
  ['9701', 'AS', 2, 'cie-9701-as-chemistry', 'cie-9701-9701_m25_qp_22'],
  ['9701', 'A2', 4, 'cie-9701-a2-chemistry', 'cie-9701-9701_m25_qp_42'],
  ['9702', 'AS', 2, 'cie-9702-as-physics', 'cie-9702-9702_m25_qp_22'],
  ['9702', 'A2', 4, 'cie-9702-a2-physics', 'cie-9702-9702_m25_qp_42'],
  ['9708', 'AS', 2, 'cie-9708-as-economics', 'cie-9708-9708_m25_qp_22'],
  ['9708', 'A2', 3, 'cie-9708-a2-economics', 'cie-9708-9708_m25_qp_32'],
  ['9709', 'AS', 2, 'cie-9709-as-p1-p2', 'cie-9709-9709_m25_qp_22'],
  ['9709', 'A2', 4, 'cie-9709-a2-after-p1-p5-p3-p4', 'cie-9709-9709_m25_qp_44'],
  ['9231', 'AS', 3, 'cie-9231-as-p1-p3', 'cie-9231-9231_m25_qp_32'],
  ['9231', 'A2', 2, 'cie-9231-a2-after-p1-p3-p2-p4', 'cie-9231-9231_m25_qp_24'],
]

try {
  for (const [subject, stage, component, routeId, paperId] of cases) {
    const options = parseArgs([
      '--paper-id', paperId,
      '--question-pdf', questionPdf,
      '--mark-scheme-pdf', markSchemePdf,
      '--subject', subject,
      '--stage', stage,
      '--route-id', routeId,
      '--dry-run',
    ], { cwd: temporaryRoot, env: { OPENAI_API_KEY: 'test-key' } })
    const route = routeById(routeId)
    const syllabus = syllabusForOptions(options)
    assert.equal(options.routeId, routeId)
    assert.equal(options.paperComponent, component)
    assert.equal(syllabus.routeId, routeId)
    assert.equal(syllabus.syllabusVersion, route.syllabus.version)
    assert.equal(syllabus.officialUrl, route.syllabus.url)
    assert.ok(syllabus.topics.length > 0, `${routeId} must expose latest official topics`)
    assert.ok(syllabus.points.length > 0, `${routeId} must expose latest official points`)
  }

  const inferredA2 = parseArgs([
    '--paper-id', 'cie-9709-9709_m25_qp_44',
    '--question-pdf', questionPdf,
    '--mark-scheme-pdf', markSchemePdf,
    '--subject', '9709',
    '--route-id', 'cie-9709-a2-after-p1-p5-p3-p4',
    '--dry-run',
  ], { cwd: temporaryRoot, env: { OPENAI_API_KEY: 'test-key' } })
  assert.equal(inferredA2.stage, 'A2', 'an explicit 9709 A2 route must infer its stage when --stage is omitted')
  assert.equal(inferredA2.routeId, 'cie-9709-a2-after-p1-p5-p3-p4')
  console.log(JSON.stringify({ status: 'passed', cases: cases.length, subjects: new Set(cases.map(([subject]) => subject)).size }))
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
