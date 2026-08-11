import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { paperQuestionMarkingMetadata } from '../src/data/questionBank.js'
import { reviewedManifestQuestion } from '../src/lib/paperMarking.js'

const contract = Object.freeze({
  routeId: 'cie-0580-igcse-mathematics',
  qualification: 'IGCSE',
  specificationVersion: 'cambridge-0580-2025-2027',
  paperId: 'cie-0580-0580_m25_qp_12',
})

function outputPath(argv) {
  const index = argv.indexOf('--output')
  assert.ok(index >= 0 && argv[index + 1], 'Pass --output <manifest-path>')
  return path.resolve(argv[index + 1])
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

const metadataByQuestion = paperQuestionMarkingMetadata({ paperId: contract.paperId, routeId: contract.routeId })
const numbers = Object.keys(metadataByQuestion).map(Number).sort((left, right) => left - right)
assert.deepEqual(numbers, Array.from({ length: 26 }, (_, index) => index + 1), 'Manifest requires reviewed metadata for Q1-Q26')
const questions = numbers.flatMap((questionNumber) => {
  const metadata = metadataByQuestion[questionNumber]
  return metadata.parts.map((part) => reviewedManifestQuestion({ ...contract, questionNumber, metadata, part }))
})
assert.ok(questions.every(Boolean), 'Every reviewed part requires at least one canonical mark-scheme point')
assert.equal(questions.length, 46, 'The reviewed paper must contain 46 question parts')
assert.equal(questions.reduce((sum, question) => sum + question.availableMarks, 0), 80, 'The reviewed paper must total 80 marks')
const pointIds = questions.flatMap((question) => question.markSchemePoints.map((point) => point.pointId))
assert.equal(new Set(pointIds).size, pointIds.length, 'Manifest mark-point IDs must be unique')

const reviewedSetPath = path.resolve(import.meta.dirname, '..', 'src', 'data', 'reviewedQuestionSets', `${contract.paperId}.json`)
const destination = outputPath(process.argv.slice(2))
fs.mkdirSync(path.dirname(destination), { recursive: true })
fs.writeFileSync(destination, `${JSON.stringify({
  schemaVersion: 'stem-marking-manifest.v2',
  generatedAt: new Date().toISOString(),
  source: {
    reviewedSet: path.basename(reviewedSetPath),
    sha256: sha256File(reviewedSetPath),
    questionCount: 26,
    partCount: questions.length,
    totalMarks: 80,
  },
  questions,
}, null, 2)}\n`)
console.log(`Generated ${questions.length} trusted STEM marking parts (80 marks) at ${destination}.`)
