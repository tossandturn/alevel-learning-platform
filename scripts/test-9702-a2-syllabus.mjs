import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { CAMBRIDGE_9702_A2_SYLLABUS } from '../src/data/syllabus/cambridge-9702-a2-2025-2027.js'
import { buildDryRunPlan, controlledTopicCatalogForOptions, parseArgs } from './ingest-ai-pdf-questions.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), '9702-a2-syllabus-'))

try {
  const questionPdf = path.join(root, '9702_m25_qp_42.pdf')
  const markSchemePdf = path.join(root, '9702_m25_ms_42.pdf')
  fs.writeFileSync(questionPdf, '%PDF-1.4\nfixture\n', 'utf8')
  fs.writeFileSync(markSchemePdf, '%PDF-1.4\nfixture\n', 'utf8')

  assert.equal(CAMBRIDGE_9702_A2_SYLLABUS.routeId, 'cie-9702-a2-physics')
  assert.equal(CAMBRIDGE_9702_A2_SYLLABUS.officialUrl, 'https://www.cambridgeinternational.org/Images/664565-2025-2027-syllabus.pdf')
  assert.deepEqual(CAMBRIDGE_9702_A2_SYLLABUS.topics.map((topic) => topic.code), [
    '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25',
  ])
  assert.ok(CAMBRIDGE_9702_A2_SYLLABUS.points.length >= 60)
  assert.ok(CAMBRIDGE_9702_A2_SYLLABUS.points.every((point) => /^physics-9702-topic-(1[2-9]|2[0-5])$/.test(point.topicId)))
  assert.ok(CAMBRIDGE_9702_A2_SYLLABUS.topics.every((topic) => topic.points.every((point) => point.topicId === topic.id)))

  const options = parseArgs([
    '--paper-id', 'cie-9702-9702_m25_qp_42',
    '--question-pdf', questionPdf,
    '--mark-scheme-pdf', markSchemePdf,
    '--subject', '9702',
    '--stage', 'A2',
    '--dry-run',
  ], { cwd: root })
  assert.equal(options.stage, 'A2')
  assert.equal(buildDryRunPlan(options).syllabusRouteId, 'cie-9702-a2-physics')
  assert.deepEqual(controlledTopicCatalogForOptions(options).map((topic) => topic.code), [
    '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25',
  ])
  assert.ok(controlledTopicCatalogForOptions(options).every((topic) => topic.component === 'A2 P4'))

  const asOptions = parseArgs([
    '--paper-id', 'cie-9702-9702_m25_qp_22',
    '--question-pdf', questionPdf,
    '--mark-scheme-pdf', markSchemePdf,
    '--subject', '9702',
    '--dry-run',
  ], { cwd: root })
  assert.equal(asOptions.stage, 'AS')
  assert.equal(controlledTopicCatalogForOptions(asOptions).length, 11)
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}

console.log(JSON.stringify({ status: 'passed', scope: '9702-a2-official-syllabus' }))
