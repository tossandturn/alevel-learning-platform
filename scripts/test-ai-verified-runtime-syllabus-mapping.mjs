import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createAiVerifiedQuestionBankLoader } from '../server/aiVerifiedQuestionBank.js'
import { routeById } from '../src/data/routeRegistry.js'
import { CAMBRIDGE_9702_A2_SYLLABUS } from '../src/data/syllabus/cambridge-9702-a2-2025-2027.js'
import { syllabusTopicsInventory } from '../src/lib/syllabusPractice.js'
import { artifactId, buildAiStudentStudyRelease } from './ai-pdf-ingestion/contract.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-ai-verified-runtime-syllabus-'))
const libraryRoot = path.join(root, 'library')
const artifactRoot = path.join(root, 'artifacts')

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')

function buildArtifact({
  routeId,
  subjectCode,
  stage,
  fileStem,
  questionStartPage,
  topicIds,
  pointIds,
  questionRegionPages,
  diagramRegionPages = [],
  questionRegionHashSeed,
  markSchemePage,
  markSchemeHashSeed,
  questionNumber = '1',
}) {
  const route = routeById(routeId)
  assert.ok(route, `route ${routeId} must exist`)
  const questionFile = `${fileStem}.pdf`
  const markSchemeFile = questionFile.replace('_qp_', '_ms_')
  const questionBytes = Buffer.from(`%PDF-1.4\n${fileStem}\nquestion\n`, 'utf8')
  const markSchemeBytes = Buffer.from(`%PDF-1.4\n${fileStem}\nmark-scheme\n`, 'utf8')
  const questionPdfSha256 = sha256(questionBytes)
  const markSchemePdfSha256 = sha256(markSchemeBytes)
  const paperId = `cie-${subjectCode}-${fileStem}`
  const artifactIdentity = artifactId({ paperId, questionPdfSha256, markSchemePdfSha256 })
  const subjectRoot = path.join(libraryRoot, subjectCode)
  fs.mkdirSync(subjectRoot, { recursive: true })
  fs.writeFileSync(path.join(subjectRoot, questionFile), questionBytes)
  fs.writeFileSync(path.join(subjectRoot, markSchemeFile), markSchemeBytes)
  const questionPageHash = sha256(Buffer.from(questionRegionHashSeed || `${fileStem}:question-page`, 'utf8'))
  // A diagram crop still comes from the same authoritative source page image.
  const diagramPageHash = questionPageHash
  const markSchemePageHash = sha256(Buffer.from(markSchemeHashSeed || `${fileStem}:mark-scheme-page`, 'utf8'))
  const regions = questionRegionPages.map((page) => ({
    page,
    pageImageSha256: questionPageHash,
    x0: 0.1,
    y0: 0.15,
    x1: 0.9,
    y1: 0.82,
  }))
  const diagramRegions = diagramRegionPages.map((page) => ({
    page,
    pageImageSha256: diagramPageHash,
    x0: 0.2,
    y0: 0.25,
    x1: 0.6,
    y1: 0.7,
  }))
  const candidateTags = {
    primaryTopicId: topicIds[0],
    secondaryTopicIds: topicIds.slice(1),
    syllabusPointIds: [...pointIds],
  }
  const verificationTags = {
    primaryTopicId: topicIds[0],
    secondaryTopicIds: topicIds.slice(1),
    syllabusPointIds: [...pointIds],
  }
  const artifact = {
    schemaVersion: 'ai-pdf-ingestion.v1',
    artifactId: artifactIdentity,
    paperId,
    subject: subjectCode,
    stage,
    syllabusRouteId: routeId,
    status: 'ai-verified',
    storageMode: 'coordinate-only',
    extractor: { provider: 'openai', model: 'gpt-5.6', schemaName: 'ai_pdf_question_extraction_v1' },
    verifier: { provider: 'qwen', model: 'qwen3-vl-plus', schemaName: 'ai_pdf_question_verification_v1' },
    source: {
      questionPdfPath: path.join(libraryRoot, subjectCode, questionFile),
      markSchemePdfPath: path.join(libraryRoot, subjectCode, markSchemeFile),
      questionPdfSha256,
      markSchemePdfSha256,
      renderDpi: 180,
      pageImageHashes: Object.fromEntries([...new Set([...questionRegionPages, ...diagramRegionPages])].map((page) => [page, questionPageHash])),
      pageSizes: Object.fromEntries([...new Set([...questionRegionPages, ...diagramRegionPages])].map((page) => [page, { width: 1200, height: 1600 }])),
      markSchemePageHashes: { [markSchemePage]: markSchemePageHash },
      markSchemePageSizes: { [markSchemePage]: { width: 1200, height: 1600 } },
    },
    candidate: {
      questions: [{
        questionNumber,
        questionStartPage,
        regions,
        diagramRegions,
        parts: [{ label: 'a', marks: 4, ocrText: 'State the answer.', math: [], diagramAssociations: [] }],
        tags: candidateTags,
        markSchemeEvidence: [{ page: markSchemePage, pageImageSha256: markSchemePageHash }],
      }],
    },
    verification: {
      questions: [{
        questionNumber,
        questionStartPage,
        pages: [...new Set([...questionRegionPages, ...diagramRegionPages])],
        regions,
        diagramRegions,
        parts: [{ label: 'a', marks: 4 }],
        diagramRegionCount: diagramRegions.length,
        tags: verificationTags,
        markSchemeEvidence: [{ page: markSchemePage, pageImageSha256: markSchemePageHash }],
      }],
    },
  }
  artifact.studentRelease = buildAiStudentStudyRelease({
    artifactId: artifact.artifactId,
    routeId: artifact.syllabusRouteId,
    status: artifact.status,
    source: artifact.source,
    extractor: artifact.extractor,
    verifier: artifact.verifier,
    candidate: artifact.candidate,
    verification: artifact.verification,
  })
  return artifact
}

function writeArtifact(artifact, suffix = `${artifact.artifactId.slice('sha256:'.length)}.json`) {
  const directory = path.join(artifactRoot, artifact.paperId)
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, suffix), JSON.stringify(artifact), 'utf8')
}

fs.mkdirSync(libraryRoot, { recursive: true })
fs.mkdirSync(artifactRoot, { recursive: true })

const route0606 = routeById('cie-0606-igcse-additional-mathematics')
const calculus0606 = route0606.syllabus.topics.find((topic) => topic.id === 'math-0606-calculus')
const functions0606 = route0606.syllabus.topics.find((topic) => topic.id === 'math-0606-functions')
assert.deepEqual(calculus0606.points.map((point) => point.id), ['math-0606-point-calculus-01'], '0606 route projection must attach only the official points whose topicId matches Calculus')
assert.ok(calculus0606.points.every((point) => point.topicId === calculus0606.id), '0606 route points must not be aggregated across topics')
assert.ok(routeById('cie-0610-igcse-biology').syllabus.topics.every((topic) => !topic.points?.length), 'the 0606 repair must not populate independent 0610 placeholder topics')
for (const routeId of ['cie-9700-as-biology', 'cie-9701-as-chemistry']) {
  const route = routeById(routeId)
  assert.equal(route.syllabus.version, '2025-2027', `${routeId} must retain the current production syllabus version`)
  assert.ok(route.syllabus.topics.every((topic) => !topic.points?.length), `${routeId} future-version points must not enter the current placeholder route`)
}

const a2Route = routeById('cie-9702-a2-physics')
const a2Primary = a2Route.syllabus.topics.find((topic) => topic.id === 'physics-9702-topic-13')
const a2Secondary = a2Route.syllabus.topics.find((topic) => topic.id === 'physics-9702-topic-12')
const a2Unrelated = a2Route.syllabus.topics.find((topic) => topic.id === 'physics-9702-topic-15')
assert.ok(a2Primary && a2Secondary && a2Unrelated, 'A2 official syllabus topics must be available')
const sourceA2Primary = CAMBRIDGE_9702_A2_SYLLABUS.topics.find((topic) => topic.id === a2Primary.id)
assert.strictEqual(a2Primary.points, sourceA2Primary.points, 'non-empty nested point collections on other routes must retain their authoritative identity')

const valid0606 = buildArtifact({
  routeId: route0606.routeId,
  subjectCode: '0606',
  stage: 'IGCSE',
  fileStem: '0606_w25_qp_21',
  questionStartPage: 9,
  topicIds: [calculus0606.id],
  pointIds: [calculus0606.points[0].id],
  questionRegionPages: [9],
  markSchemePage: 8,
  questionNumber: '7',
})
const wrong0606Point = buildArtifact({
  routeId: route0606.routeId,
  subjectCode: '0606',
  stage: 'IGCSE',
  fileStem: '0606_w25_qp_22',
  questionStartPage: 9,
  topicIds: [calculus0606.id],
  pointIds: ['math-0606-point-calculus-99'],
  questionRegionPages: [9],
  markSchemePage: 8,
  questionNumber: '7',
})
const wrong0606Topic = buildArtifact({
  routeId: route0606.routeId,
  subjectCode: '0606',
  stage: 'IGCSE',
  fileStem: '0606_w25_qp_23',
  questionStartPage: 9,
  topicIds: [functions0606.id],
  pointIds: [calculus0606.points[0].id],
  questionRegionPages: [9],
  markSchemePage: 8,
  questionNumber: '7',
})
writeArtifact(valid0606)
writeArtifact(wrong0606Point)
writeArtifact(wrong0606Topic)

const a2Question = buildArtifact({
  routeId: 'cie-9702-a2-physics',
  subjectCode: '9702',
  stage: 'A2',
  fileStem: '9702_m25_qp_42',
  questionStartPage: 3,
  topicIds: [a2Primary.id, a2Secondary.id],
  pointIds: [a2Primary.points[0].id, a2Secondary.points[0].id],
  questionRegionPages: [3],
  diagramRegionPages: [3],
  markSchemePage: 17,
})

const a2Mismatch = buildArtifact({
  routeId: 'cie-9702-a2-physics',
  subjectCode: '9702',
  stage: 'A2',
  fileStem: '9702_m25_qp_43',
  questionStartPage: 5,
  topicIds: [a2Primary.id, a2Secondary.id],
  pointIds: [a2Primary.points[0].id, 'physics-9702-point-12-1-99'],
  questionRegionPages: [5],
  markSchemePage: 18,
})

const a2WrongTopicPoint = buildArtifact({
  routeId: 'cie-9702-a2-physics',
  subjectCode: '9702',
  stage: 'A2',
  fileStem: '9702_m25_qp_46',
  questionStartPage: 9,
  topicIds: [a2Primary.id, a2Secondary.id],
  pointIds: [a2Primary.points[0].id, a2Unrelated.points[0].id],
  questionRegionPages: [9],
  markSchemePage: 21,
})
writeArtifact(a2Question)
writeArtifact(a2Mismatch)
writeArtifact(a2WrongTopicPoint)

const a2StartMismatch = buildArtifact({
  routeId: 'cie-9702-a2-physics',
  subjectCode: '9702',
  stage: 'A2',
  fileStem: '9702_m25_qp_44',
  questionStartPage: 6,
  topicIds: [a2Primary.id, a2Secondary.id],
  pointIds: [a2Primary.points[0].id, a2Secondary.points[0].id],
  questionRegionPages: [6],
  markSchemePage: 19,
})
a2StartMismatch.verification.questions[0].questionStartPage = 7
writeArtifact(a2StartMismatch)

const a2DiagramMismatch = buildArtifact({
  routeId: 'cie-9702-a2-physics',
  subjectCode: '9702',
  stage: 'A2',
  fileStem: '9702_m25_qp_45',
  questionStartPage: 8,
  topicIds: [a2Primary.id, a2Secondary.id],
  pointIds: [a2Primary.points[0].id, a2Secondary.points[0].id],
  questionRegionPages: [8],
  diagramRegionPages: [8],
  markSchemePage: 20,
})
a2DiagramMismatch.verification.questions[0].diagramRegionCount = 0
writeArtifact(a2DiagramMismatch)

const a2P5 = buildArtifact({
  routeId: 'cie-9702-a2-physics',
  subjectCode: '9702',
  stage: 'A2',
  fileStem: '9702_m25_qp_52',
  questionStartPage: 7,
  topicIds: [a2Primary.id, a2Secondary.id],
  pointIds: [a2Primary.points[0].id, a2Secondary.points[0].id],
  questionRegionPages: [7],
  markSchemePage: 19,
})
writeArtifact(a2P5)

const p4Route = routeById('cie-9709-as-p1-p4')
assert.ok(p4Route?.syllabus?.topics?.length >= 2, '9709 AS route must expose official route topics')
const p4TopicA = p4Route.syllabus.topics[0]
const p4TopicB = p4Route.syllabus.topics[1]

const p4Question = buildArtifact({
  routeId: 'cie-9709-as-p1-p4',
  subjectCode: '9709',
  stage: 'AS',
  fileStem: '9709_s25_qp_42',
  questionStartPage: 10,
  topicIds: [p4TopicA.id, p4TopicB.id],
  pointIds: [p4TopicA.points[0].id, p4TopicB.points[0].id],
  questionRegionPages: [10],
  markSchemePage: 20,
})
writeArtifact(p4Question)

try {
  const load = createAiVerifiedQuestionBankLoader({ artifactRoot, libraryRoot })
  const loaded = load()
  assert.equal(loaded.groups.length, 3, 'only valid coordinate-bound runtime artifacts should enter the bank')

  const group0606 = loaded.groups.find((group) => group.routeId === route0606.routeId)
  assert.ok(group0606, 'a valid 0606 Calculus point binding must pass the unchanged runtime loader')
  assert.deepEqual(group0606.syllabusMapping.syllabusPointIds, ['math-0606-point-calculus-01'])
  assert.equal(loaded.groups.some((group) => group.sourceRef?.paper === '0606_w25_qp_22.pdf'), false, 'a non-existent 0606 point ID must remain rejected')
  assert.equal(loaded.groups.some((group) => group.sourceRef?.paper === '0606_w25_qp_23.pdf'), false, 'a Calculus point attached to the wrong 0606 topic must remain rejected')

  const a2Group = loaded.groups.find((group) => group.routeId === 'cie-9702-a2-physics')
  assert.ok(a2Group, '9702 A2 runtime group must load')
  assert.equal(a2Group.questionStartPage, 3)
  assert.deepEqual(a2Group.diagramRegions.map((region) => region.page), [3])
  assert.deepEqual(a2Group.syllabusMapping.secondaryTopicIds, [a2Secondary.id])
  assert.deepEqual(a2Group.syllabusMapping.syllabusPointIds, [a2Primary.points[0].id, a2Secondary.points[0].id])
  assert.equal(a2Group.syllabusMapping.questionStartPage, 3)
  assert.ok(a2Group.parts[0].sourceEvidence.every((entry) => entry.coordinateSpace === 'normalized-xyxy'))
  assert.ok(a2Group.diagramRegions.every((region) => region.coordinateSpace === 'normalized-xyxy'))

  const a2Inventory = syllabusTopicsInventory({
    routeId: 'cie-9702-a2-physics',
    questionBank: loaded.groups,
    includeStudyOnly: false,
  })
  const a2SecondaryRow = a2Inventory.topics.find((candidate) => candidate.id === a2Secondary.id)
  assert.ok(a2SecondaryRow, 'the secondary official topic must remain in the server syllabus inventory')
  assert.ok(
    a2SecondaryRow.questionIdsByComponent?.[4]?.studyQuestionIds?.includes(a2Group.sourceQuestionId),
    'count/list/start inventory must preserve an AI-verified secondary syllabus membership',
  )

  const p4Group = loaded.groups.find((group) => group.routeId === 'cie-9709-as-p1-p4')
  assert.ok(p4Group, '9709 AS P1+P4 runtime group must load')
  assert.equal(p4Group.paperComponent, 4)
  assert.deepEqual(p4Group.syllabusMapping.secondaryTopicIds, [p4TopicB.id])
  assert.deepEqual(p4Group.syllabusMapping.syllabusPointIds, [p4TopicA.points[0].id, p4TopicB.points[0].id])
  assert.equal(p4Group.questionStartPage, 10)

  assert.equal(loaded.groups.some((group) => group.sourceRef?.paper === '9702_m25_qp_52.pdf'), false, 'paper 5 must remain excluded from 9702 A2 Topic Drill')
  assert.equal(loaded.groups.some((group) => group.sourceRef?.paper === '9702_m25_qp_43.pdf'), false, 'candidate and verification syllabus binding mismatches must fail closed')
  assert.equal(loaded.groups.some((group) => group.sourceRef?.paper === '9702_m25_qp_44.pdf'), false, 'questionStartPage mismatches must fail closed')
  assert.equal(loaded.groups.some((group) => group.sourceRef?.paper === '9702_m25_qp_45.pdf'), false, 'diagram count mismatches must fail closed')
  assert.equal(loaded.groups.some((group) => group.sourceRef?.paper === '9702_m25_qp_46.pdf'), false, 'syllabus points must belong to a declared topic')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}

console.log(JSON.stringify({ status: 'passed', scope: 'runtime-syllabus-binding-mapping' }))
