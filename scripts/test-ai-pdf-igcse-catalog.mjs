import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { CAMBRIDGE_0580_IGCSE_SYLLABUS } from '../src/data/syllabus/cambridge-0580-igcse-2025-2027.js'
import { CAMBRIDGE_0625_IGCSE_SYLLABUS } from '../src/data/syllabus/cambridge-0625-igcse-2026-2028.js'
import { routeById } from '../src/data/routeRegistry.js'
import { syllabusTopicsInventory } from '../src/lib/syllabusPractice.js'
import { parseArgs as parseIngestionArgs } from './ingest-ai-pdf-questions.mjs'
import { parseArgs as parseTopicPackArgs } from './generate-ai-pdf-topic-pack.mjs'

const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'ai-pdf-igcse-catalog-'))

try {
  assert.equal(CAMBRIDGE_0580_IGCSE_SYLLABUS.syllabusVersion, '2025-2027')
  assert.equal(CAMBRIDGE_0580_IGCSE_SYLLABUS.officialUrl, 'https://www.cambridgeinternational.org/Images/662466-2025-2027-syllabus.pdf')
  assert.deepEqual(
    CAMBRIDGE_0580_IGCSE_SYLLABUS.topics.map(topic => topic.name),
    ['Number', 'Algebra and graphs', 'Coordinate geometry', 'Geometry', 'Mensuration', 'Trigonometry', 'Transformations and vectors', 'Probability', 'Statistics'],
  )
  assert.deepEqual(
    CAMBRIDGE_0625_IGCSE_SYLLABUS.topics.map(topic => topic.name),
    ['Motion, forces and energy', 'Thermal physics', 'Waves', 'Electricity and magnetism', 'Nuclear physics', 'Space physics'],
  )
  assert.deepEqual(CAMBRIDGE_0580_IGCSE_SYLLABUS.topics.map(topic => topic.officialPage), [12, 17, 20, 21, 25, 27, 28, 29, 30])
  assert.deepEqual(CAMBRIDGE_0625_IGCSE_SYLLABUS.topics.map(topic => topic.officialPage), [12, 18, 22, 27, 34, 37])
  assert.ok(CAMBRIDGE_0580_IGCSE_SYLLABUS.points.length >= 40)
  assert.ok(CAMBRIDGE_0625_IGCSE_SYLLABUS.points.length >= 12)

  for (const [routeId, expectedSyllabus] of [
    ['cie-0580-igcse-mathematics', CAMBRIDGE_0580_IGCSE_SYLLABUS],
    ['cie-0625-igcse-physics', CAMBRIDGE_0625_IGCSE_SYLLABUS],
  ]) {
    const route = routeById(routeId)
    assert.equal(route.syllabus.version, expectedSyllabus.syllabusVersion)
    assert.equal(route.syllabus.url, expectedSyllabus.officialUrl)
    assert.deepEqual(route.syllabus.topics.map(topic => topic.id), expectedSyllabus.topics.map(topic => topic.id))
    const inventory = syllabusTopicsInventory({ routeId, questionBank: [] })
    assert.deepEqual(inventory.topics.map(topic => topic.id), expectedSyllabus.topics.map(topic => topic.id))
    assert.deepEqual(inventory.topics.map(topic => topic.name), expectedSyllabus.topics.map(topic => topic.name))
  }

  const questionPdf = path.join(temporaryRoot, 'question.pdf')
  const markSchemePdf = path.join(temporaryRoot, 'mark-scheme.pdf')
  writeFileSync(questionPdf, Buffer.from('%PDF-fixture', 'utf8'))
  writeFileSync(markSchemePdf, Buffer.from('%PDF-fixture', 'utf8'))

  for (const subject of ['0580', '0625']) {
    const ingestionOptions = parseIngestionArgs([
      '--paper-id', `cie-${subject}-fixture`,
      '--question-pdf', questionPdf,
      '--mark-scheme-pdf', markSchemePdf,
      '--subject', subject,
      '--dry-run',
    ], { cwd: temporaryRoot, env: { OPENAI_API_KEY: 'test-key' } })
    assert.equal(ingestionOptions.subject, subject)
    assert.equal(parseTopicPackArgs(['--subject', subject, '--dry-run'], { cwd: temporaryRoot }).subject, subject)
  }

  assert.throws(
    () => parseTopicPackArgs(['--subject', '0580', '--topic-id', '0580-igcse-topic-99'], { cwd: temporaryRoot }),
    error => error?.code === 'OFFICIAL_TOPIC_INVALID',
  )
  assert.throws(
    () => parseTopicPackArgs(['--subject', '0625', '--topic-id', '0625-igcse-topic-99'], { cwd: temporaryRoot }),
    error => error?.code === 'OFFICIAL_TOPIC_INVALID',
  )

  console.log(JSON.stringify({ status: 'passed', checks: 19 }))
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
