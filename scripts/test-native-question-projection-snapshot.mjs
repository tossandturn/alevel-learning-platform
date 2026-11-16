import assert from 'node:assert/strict'
import { createNativeQuestionImages } from '../server/nativeQuestionImages.js'

const evidence = { page: 1, documentSha256: 'a'.repeat(64), pageImageSha256: 'b'.repeat(64),
  imageSize: [1488, 2105], coordinateSpace: 'normalized-xyxy', region: [0.1, 0.2, 0.9, 0.8] }
const question = { routeId: 'cie-9702-a2-physics', sourceQuestionId: 'cie-9702-9702_s25_qp_41:q1', subjectCode: '9702', released: true,
  sourceRef: { paper: '9702_s25_qp_41.pdf', sha256: 'a'.repeat(64), renderDpi: 180 },
  sourceContent: { schemaVersion: 'ai-verified-coordinate-source-v1', complete: true, fileComplete: true, bindingSignature: 'fixture' },
  parts: [{ sourceEvidence: [evidence] }], diagramRegions: [] }
let loads = 0
const service = createNativeQuestionImages({ getQuestionBank: () => { loads += 1; return [question] },
  libraryRoot: '/fixture', isReleased: (item) => item.released })
const projected = service.projectSet({ questionGroups: [
  { id: question.sourceQuestionId, routeId: question.routeId, sourceContent: { assetUrls: [] } },
] }, { questionBank: [question] })
assert.equal(projected.questionGroups[0].nativeSourceImages.length, 1)
assert.equal(loads, 0, 'projection must reuse the request-validated snapshot')
assert.equal(service.descriptors(question.routeId, question.sourceQuestionId).length, 1)
assert.equal(loads, 1, 'a later image lookup must revalidate its own source snapshot')
console.log(JSON.stringify({ status: 'PASS_LOCAL_ONLY', scope: 'native-question-projection-snapshot' }))
