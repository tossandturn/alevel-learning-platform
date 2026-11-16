import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'

import { questionGroupsFromAiArtifacts } from '../server/aiVerifiedQuestionBank.js'
import { artifactId, buildAiStudentStudyRelease } from './ai-pdf-ingestion/contract.mjs'

const libraryRoot = path.join(os.tmpdir(), 'synthetic-duplicate-mapping-library')
const paperId = 'cie-9702-9702_m21_qp_42'
const questionPdfSha256 = 'a'.repeat(64), markSchemePdfSha256 = 'b'.repeat(64)
function artifact(primaryTopicId, secondaryTopicIds = []) {
  const tags = { primaryTopicId, secondaryTopicIds, syllabusPointIds: [] }
  const region = { page: 3, pageImageSha256: 'd'.repeat(64), x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.8 }
  const markSchemeEvidence = [{ page: 5, pageImageSha256: 'e'.repeat(64) }]
  const result = { schemaVersion: 'ai-pdf-ingestion.v1', artifactId: artifactId({ paperId, questionPdfSha256, markSchemePdfSha256 }),
    paperId, subject: '9702', stage: 'A2', syllabusRouteId: 'cie-9702-a2-physics', status: 'ai-verified', storageMode: 'coordinate-only',
    extractor: { provider: 'fixture-a', model: 'fixture-a', schemaName: 'ai_pdf_question_extraction_v1' },
    verifier: { provider: 'fixture-b', model: 'fixture-b', schemaName: 'ai_pdf_question_verification_v1' },
    source: { questionPdfPath: `${libraryRoot}/9702/9702_m21_qp_42.pdf`, markSchemePdfPath: `${libraryRoot}/9702/9702_m21_ms_42.pdf`,
      questionPdfSha256, markSchemePdfSha256, renderDpi: 180,
      pageImageHashes: { 3: 'd'.repeat(64) }, pageSizes: { 3: { width: 1200, height: 1600 } },
      markSchemePageHashes: { 5: 'e'.repeat(64) }, markSchemePageSizes: { 5: { width: 1200, height: 1600 } } },
    candidate: { questions: [{ questionNumber: '2', regions: [region], diagramRegions: [],
      parts: [{ label: 'a', marks: 4, ocrText: 'Synthetic question.' }], tags, markSchemeEvidence }] },
    verification: { questions: [{ questionNumber: '2', pages: [3], regions: [region], diagramRegions: [], diagramRegionCount: 0,
      parts: [{ label: 'a', marks: 4 }], tags, markSchemeEvidence }] },
  }
  result.studentRelease = buildAiStudentStudyRelease({ ...result, routeId: result.syllabusRouteId })
  return result
}
const a = artifact('physics-9702-topic-13')
assert.equal(questionGroupsFromAiArtifacts([a, structuredClone(a)], { libraryRoot }).length, 1)
assert.equal(questionGroupsFromAiArtifacts([a, artifact('physics-9702-topic-14')], { libraryRoot }).length, 0,
  'the same source identity with different primary syllabus mappings must be quarantined')
assert.equal(questionGroupsFromAiArtifacts([a, artifact('physics-9702-topic-13', ['physics-9702-topic-14'])], { libraryRoot }).length, 0,
  'the same source identity with different secondary syllabus mappings must be quarantined')
console.log(JSON.stringify({ status: 'PASS_LOCAL_ONLY', scope: 'duplicate-route-source-mapping-conflicts' }))
