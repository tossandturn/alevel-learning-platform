import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  buildDryRunPlan,
  controlledTopicCatalogForOptions,
  parseArgs,
} from './ingest-ai-pdf-questions.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), '9709-ingestion-routes-'))

function fixture(routeId, stage, paperCode) {
  const questionPdf = path.join(root, `9709_m25_qp_${paperCode}.pdf`)
  const markSchemePdf = path.join(root, `9709_m25_ms_${paperCode}.pdf`)
  fs.writeFileSync(questionPdf, '%PDF-1.4\nquestion fixture\n', 'utf8')
  fs.writeFileSync(markSchemePdf, '%PDF-1.4\nmark scheme fixture\n', 'utf8')
  return parseArgs([
    '--paper-id', `cie-9709-9709_m25_qp_${paperCode}`,
    '--question-pdf', questionPdf,
    '--mark-scheme-pdf', markSchemePdf,
    '--subject', '9709',
    '--stage', stage,
    '--route-id', routeId,
    '--dry-run',
  ], { cwd: root, env: {} })
}

try {
  const cases = [
    ['cie-9709-as-p1-p2', 'AS', '22', 2, 6, '9709-p2-topic-'],
    ['cie-9709-as-p1-p4', 'AS', '42', 4, 5, '9709-m1-topic-'],
    ['cie-9709-as-p1-p5', 'AS', '52', 5, 5, '9709-s1-topic-'],
    ['cie-9709-a2-after-p1-p5-p3-p4', 'A2', '32', 3, 9, '9709-p3-topic-'],
    ['cie-9709-a2-after-p1-p5-p3-p6', 'A2', '62', 6, 5, '9709-s2-topic-'],
    ['cie-9709-a2-after-p1-p4-p3-p5', 'A2', '52', 5, 5, '9709-s1-topic-'],
  ]

  for (const [routeId, stage, paperCode, component, topicCount, prefix] of cases) {
    const options = fixture(routeId, stage, paperCode)
    assert.equal(options.routeId, routeId)
    assert.equal(options.paperComponent, component)
    assert.equal(buildDryRunPlan(options).syllabusRouteId, routeId)
    const topics = controlledTopicCatalogForOptions(options)
    assert.equal(topics.length, topicCount, `${routeId} Paper ${component} must expose only its official component chapters`)
    assert.ok(topics.every((topic) => topic.id.startsWith(prefix) && Number(topic.component) === component))
  }

  assert.throws(
    () => fixture('cie-9709-as-p1-p2', 'AS', '42'),
    (error) => error.code === 'PAPER_COMPONENT_NOT_IN_ROUTE',
    'a paper must not be tagged with a syllabus route that excludes its component',
  )

  console.log(JSON.stringify({ status: 'passed', scope: '9709-ingestion-routes', routes: cases.length }))
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
