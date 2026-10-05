import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { questionGroupsFromAiArtifacts } from '../server/aiVerifiedQuestionBank.js'
import { isAiMarkablePastPaperItem } from '../src/data/questionBank.js'
import { topicPracticeEligibility } from '../src/lib/practiceConstants.js'
import {
  canonicalAiMarkingProvenance,
  canonicalSourcePracticeProvenance,
} from '../src/lib/sourceContentContract.js'
import { buildSyllabusPracticeSet } from '../src/lib/syllabusPractice.js'

const bindingSchemaVersion = 'stem-ai-part-evidence-binding.v2'
const libraryRoot = 'D:/CodexWork/cie-fraft-fetcher/output/pdf'
const transformationsRoot = 'D:/CodexWork/stem-ocr-work/postprocess-batches/chapter-20260927/math-0580-transformations'
const permutationsRoot = 'D:/CodexWork/stem-ocr-work/postprocess-batches/chapter-20260927/addmath-permutations'

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function artifactFiles(root) {
  const artifactRoot = path.join(root, 'reviewed-artifacts')
  return fs.readdirSync(artifactRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => fs.readdirSync(path.join(artifactRoot, entry.name), { withFileTypes: true })
      .filter((item) => item.isFile() && item.name.endsWith('.json'))
      .map((item) => path.join(artifactRoot, entry.name, item.name)))
    .sort((left, right) => left.localeCompare(right))
}

function exactRegion(region, page) {
  return {
    page: Number(region.page),
    pageImageSha256: page.sha256,
    x0: Number(region.region.x0),
    y0: Number(region.region.y0),
    x1: Number(region.region.x1),
    y1: Number(region.region.y1),
    partLabels: [...region.partLabels],
  }
}

function withExactPartEvidence(sourceArtifact, geometryDocument) {
  const artifact = cloneJson(sourceArtifact)
  const pageByKey = new Map(geometryDocument.pages.map((page) => [page.key, page]))
  for (const candidateQuestion of artifact.candidate.questions) {
    const geometry = geometryDocument.questions.find((question) => question.sourceQuestionId === candidateQuestion.sourceQuestionId)
    assert.ok(geometry, `missing source geometry for ${candidateQuestion.sourceQuestionId}`)
    const verificationQuestion = artifact.verification.questions.find((question) => question.questionNumber === candidateQuestion.questionNumber)
    assert.ok(verificationQuestion, `missing verification question for ${candidateQuestion.sourceQuestionId}`)
    const qpRegions = geometry.qpRegions.map((region) => exactRegion(region, pageByKey.get(region.pageKey)))
    const diagramRegions = geometry.diagramRegions.map((region) => exactRegion(region, pageByKey.get(region.pageKey)))
    const markSchemeEvidence = geometry.msRegions.map((region) => ({
      ...exactRegion(region, pageByKey.get(region.pageKey)),
      marks: Number(region.marks),
    }))
    const parts = geometry.parts.map((part) => ({
      label: part.label,
      marks: Number(part.marks),
      partPageBinding: cloneJson(part.partPageBinding),
    }))
    candidateQuestion.partEvidenceSchemaVersion = bindingSchemaVersion
    candidateQuestion.regions = cloneJson(qpRegions)
    candidateQuestion.diagramRegions = cloneJson(diagramRegions)
    candidateQuestion.markSchemeEvidence = cloneJson(markSchemeEvidence)
    candidateQuestion.parts = candidateQuestion.parts.map((part) => ({
      ...part,
      partPageBinding: cloneJson(parts.find((binding) => binding.label === part.label).partPageBinding),
    }))
    verificationQuestion.partEvidenceSchemaVersion = bindingSchemaVersion
    verificationQuestion.regions = cloneJson(qpRegions)
    verificationQuestion.diagramRegions = cloneJson(diagramRegions)
    verificationQuestion.markSchemeEvidence = cloneJson(markSchemeEvidence)
    verificationQuestion.parts = cloneJson(parts)
  }
  return artifact
}

function artifactForQuestion(root, sourceQuestionId) {
  return artifactFiles(root)
    .map(readJson)
    .find((artifact) => artifact.candidate.questions.some((question) => question.sourceQuestionId === sourceQuestionId))
}

function exactGroups(root) {
  const geometry = readJson(path.join(root, 'source-geometry.json'))
  const artifacts = artifactFiles(root).map((file) => withExactPartEvidence(readJson(file), geometry))
  return {
    artifacts,
    geometry,
    groups: questionGroupsFromAiArtifacts(artifacts, { libraryRoot }),
  }
}

function expectedPartBinding(geometry, label, pageByKey) {
  const part = geometry.parts.find((entry) => entry.label === label)
  const qp = geometry.qpRegions.filter((entry) => entry.partLabels.length === 1 && entry.partLabels[0] === label)
  const ms = geometry.msRegions.filter((entry) => entry.partLabels.length === 1 && entry.partLabels[0] === label)
  const diagrams = geometry.diagramRegions.filter((entry) => entry.partLabels.includes(label))
  assert.equal(qp.length, 1, `fixture must have one exact QP region for ${geometry.sourceQuestionId}:${label}`)
  assert.equal(ms.length, 1, `fixture must have one exact MS region for ${geometry.sourceQuestionId}:${label}`)
  return {
    questionPage: part.partPageBinding.questionPage,
    markSchemePage: part.partPageBinding.markSchemePage,
    questionRegion: Object.values(qp[0].region),
    markSchemeRegion: Object.values(ms[0].region),
    questionPageImageSha256: pageByKey.get(qp[0].pageKey).sha256,
    markSchemePageImageSha256: pageByKey.get(ms[0].pageKey).sha256,
    sharedDiagramCount: diagrams.length,
  }
}

const transformations = exactGroups(transformationsRoot)
assert.equal(transformations.groups.length, 6, 'all six exact 0580 fixtures must remain whole question groups')
assert.equal(transformations.groups.reduce((sum, group) => sum + group.parts.length, 0), 13)
assert.equal(transformations.groups.reduce((sum, group) => sum + group.totalMarks, 0), 30)

const q19 = transformations.groups.find((group) => group.sourceQuestionId === 'cie-0580-0580_w25_qp_12:q19')
const q19c = q19.parts.find((part) => part.label === 'c')
assert.equal(q19c.answerSourcePage, 9, 'Q19(c) must bind its own MS page 9, not the question first MS page 8')

const transformationPageByKey = new Map(transformations.geometry.pages.map((page) => [page.key, page]))
for (const geometry of transformations.geometry.questions) {
  const group = transformations.groups.find((candidate) => candidate.sourceQuestionId === geometry.sourceQuestionId)
  assert.ok(group, `missing loaded 0580 group ${geometry.sourceQuestionId}`)
  assert.equal(group.formalProgressEligible, false)
  assert.equal(group.diagramRegions.length, geometry.diagramRegions.length, 'shared whole-question diagrams must remain displayable')
  for (const expectedPart of geometry.parts) {
    const part = group.parts.find((candidate) => candidate.label === expectedPart.label)
    const expected = expectedPartBinding(geometry, expectedPart.label, transformationPageByKey)
    assert.ok(part, `missing runtime part ${geometry.sourceQuestionId}:${expectedPart.label}`)
    assert.equal(part.sourcePage, expected.questionPage)
    assert.equal(part.answerSourcePage, expected.markSchemePage)
    assert.equal(part.partEvidenceBinding?.schemaVersion, bindingSchemaVersion)
    assert.equal(part.partEvidenceBinding?.partLabel, expectedPart.label)
    assert.deepEqual(
      part.sourceEvidence.filter((entry) => entry.evidenceRole === 'question-part').map((entry) => entry.region),
      [expected.questionRegion],
    )
    assert.equal(part.sourceEvidence.filter((entry) => entry.evidenceRole === 'shared-diagram').length, expected.sharedDiagramCount)
    assert.equal(part.markSchemeEvidence.length, 1)
    assert.deepEqual(part.markSchemeEvidence[0].partLabels, [expectedPart.label])
    assert.deepEqual(part.markSchemeEvidence[0].region, expected.markSchemeRegion)
    assert.equal(part.markSchemeEvidence[0].page, expected.markSchemePage)
    const marking = canonicalAiMarkingProvenance(group, part)
    const practice = canonicalSourcePracticeProvenance(group, part)
    assert.ok(marking, `exact multipart provenance must be markable for ${part.partId}`)
    assert.ok(practice, `exact multipart source practice binding must exist for ${part.partId}`)
    assert.equal(marking.sourceEvidence.page, expected.questionPage)
    assert.equal(marking.sourceEvidence.assetSha256, expected.questionPageImageSha256)
    assert.deepEqual(marking.sourceEvidence.region, expected.questionRegion)
    assert.equal(marking.sourceEvidence.markSchemePage, expected.markSchemePage)
    assert.equal(marking.sourceEvidence.markSchemePageImageSha256, expected.markSchemePageImageSha256)
    assert.deepEqual(marking.sourceEvidence.markSchemeRegion, expected.markSchemeRegion)
  }
  assert.equal(isAiMarkablePastPaperItem(group), true)
}

assert.equal(canonicalAiMarkingProvenance(q19, q19c).sourceEvidence.markSchemePage, 9)
const blockedExactQ19 = {
  ...q19,
  answerBinding: { ...q19.answerBinding, verificationStatus: 'blocked' },
}
assert.equal(canonicalAiMarkingProvenance(blockedExactQ19, blockedExactQ19.parts.find((part) => part.label === 'c')), null)
assert.equal(canonicalSourcePracticeProvenance(blockedExactQ19, blockedExactQ19.parts.find((part) => part.label === 'c')), null)

const legacyQ19Artifact = artifactForQuestion(transformationsRoot, 'cie-0580-0580_w25_qp_12:q19')
const legacyQ19 = questionGroupsFromAiArtifacts([legacyQ19Artifact], { libraryRoot })[0]
assert.ok(legacyQ19, 'legacy whole-question study display must remain loadable')
assert.equal(isAiMarkablePastPaperItem(legacyQ19), false, 'legacy multipart evidence without exact QP labels must not grant AI markability')
assert.ok(legacyQ19.parts.every((part) => canonicalSourcePracticeProvenance(legacyQ19, part)), 'legacy study display must retain source-practice provenance')
const blockedLegacyQ19 = {
  ...legacyQ19,
  answerBinding: { ...legacyQ19.answerBinding, verificationStatus: 'blocked' },
}
assert.equal(
  canonicalSourcePracticeProvenance(blockedLegacyQ19, blockedLegacyQ19.parts[0]),
  null,
  'legacy practice fallback must preserve the ai-verified answer-binding authority gate',
)

const malformedMissingLabel = cloneJson(transformations.artifacts[0])
delete malformedMissingLabel.candidate.questions[0].regions[0].partLabels
delete malformedMissingLabel.verification.questions[0].regions[0].partLabels
assert.equal(questionGroupsFromAiArtifacts([malformedMissingLabel], { libraryRoot }).length, 0, 'v2 must fail closed when a QP part label is missing')

const malformedAmbiguousLabel = cloneJson(transformations.artifacts[0])
malformedAmbiguousLabel.candidate.questions[0].regions.push(cloneJson(malformedAmbiguousLabel.candidate.questions[0].regions[0]))
malformedAmbiguousLabel.verification.questions[0].regions.push(cloneJson(malformedAmbiguousLabel.verification.questions[0].regions[0]))
assert.equal(questionGroupsFromAiArtifacts([malformedAmbiguousLabel], { libraryRoot }).length, 0, 'v2 must fail closed on ambiguous duplicate QP part labels')

const malformedMissingMsLabel = cloneJson(transformations.artifacts[0])
delete malformedMissingMsLabel.candidate.questions[0].markSchemeEvidence[0].partLabels
delete malformedMissingMsLabel.verification.questions[0].markSchemeEvidence[0].partLabels
assert.equal(questionGroupsFromAiArtifacts([malformedMissingMsLabel], { libraryRoot }).length, 0, 'v2 must fail closed when an MS part label is missing')

const malformedAmbiguousMsLabel = cloneJson(transformations.artifacts[0])
malformedAmbiguousMsLabel.candidate.questions[0].markSchemeEvidence.push(cloneJson(malformedAmbiguousMsLabel.candidate.questions[0].markSchemeEvidence[0]))
malformedAmbiguousMsLabel.verification.questions[0].markSchemeEvidence.push(cloneJson(malformedAmbiguousMsLabel.verification.questions[0].markSchemeEvidence[0]))
assert.equal(questionGroupsFromAiArtifacts([malformedAmbiguousMsLabel], { libraryRoot }).length, 0, 'v2 must fail closed on ambiguous duplicate MS part labels')

const malformedPageBinding = cloneJson(transformations.artifacts.find((artifact) => artifact.candidate.questions[0].sourceQuestionId === 'cie-0580-0580_w25_qp_12:q19'))
malformedPageBinding.candidate.questions[0].parts.find((part) => part.label === 'c').partPageBinding.markSchemePage = 8
malformedPageBinding.verification.questions[0].parts.find((part) => part.label === 'c').partPageBinding.markSchemePage = 8
assert.equal(questionGroupsFromAiArtifacts([malformedPageBinding], { libraryRoot }).length, 0, 'v2 must fail closed when an explicit part page disagrees with its labelled MS evidence')

const permutationsGeometry = readJson(path.join(permutationsRoot, 'source-geometry.json'))
for (const [sourceQuestionId, expectedPages] of [
  ['cie-0606-0606_s25_qp_22:q5', { 'a.i': 11, 'a.ii': 11, 'a.iii': 12, b: 12 }],
  ['cie-0606-0606_w25_qp_23:q5', { a: 8, b: 9, c: 9 }],
]) {
  const sourceArtifact = cloneJson(artifactForQuestion(permutationsRoot, sourceQuestionId))
  // These frozen source records intentionally use non-canonical prototype
  // point IDs and must remain non-runtime. Rebind only this controlled test
  // copy to an existing route point so the regression exercises part/page
  // dispatch without changing or approving the original 0606 taxonomy.
  for (const document of [sourceArtifact.candidate, sourceArtifact.verification]) {
    for (const question of document.questions) {
      question.tags = {
        ...question.tags,
        primaryTopicId: 'math-0606-series',
        secondaryTopicIds: [],
        syllabusPointIds: ['math-0606-point-series-01'],
      }
    }
  }
  const artifact = withExactPartEvidence(sourceArtifact, permutationsGeometry)
  const group = questionGroupsFromAiArtifacts([artifact], { libraryRoot })[0]
  assert.ok(group, `missing 0606 cross-page fixture ${sourceQuestionId}`)
  for (const [label, expectedPage] of Object.entries(expectedPages)) {
    const part = group.parts.find((candidate) => candidate.label === label)
    assert.equal(part.answerSourcePage, expectedPage, `${sourceQuestionId}:${label} must retain its exact MS page`)
    assert.equal(canonicalAiMarkingProvenance(group, part).sourceEvidence.markSchemePage, expectedPage)
  }
}

const locallyEligibleGroups = transformations.groups.map((group) => ({ ...group, studentStudyEligible: true }))
const mixedChapter = buildSyllabusPracticeSet({
  routeId: 'cie-0580-igcse-mathematics',
  syllabusTopicIds: ['0580-igcse-topic-07'],
  questionCount: 6,
  studyMode: 'chapter-study',
  questionBank: locallyEligibleGroups,
  includeStudyOnly: true,
  excludeAttempted: false,
  seed: 1,
})
const componentOneChapter = buildSyllabusPracticeSet({
  routeId: 'cie-0580-igcse-mathematics',
  syllabusTopicIds: ['0580-igcse-topic-07'],
  questionCount: 3,
  studyMode: 'chapter-study',
  components: [1],
  questionBank: locallyEligibleGroups,
  includeStudyOnly: true,
  excludeAttempted: false,
  seed: 1,
})
const componentThreeChapter = buildSyllabusPracticeSet({
  routeId: 'cie-0580-igcse-mathematics',
  syllabusTopicIds: ['0580-igcse-topic-07'],
  questionCount: 3,
  studyMode: 'chapter-study',
  components: [3],
  questionBank: locallyEligibleGroups,
  includeStudyOnly: true,
  excludeAttempted: false,
  seed: 1,
})
assert.equal(mixedChapter.count, 6)
assert.equal(mixedChapter.practiceMode, 'study-only')
assert.equal(mixedChapter.formalProgressEligible, false)
assert.equal(componentOneChapter.count, 3)
assert.equal(componentThreeChapter.count, 3)
assert.equal(topicPracticeEligibility({ verifiedQuestionCount: 0, availableQuestionCount: 6 }).studyReady, true)
assert.equal(topicPracticeEligibility({ verifiedQuestionCount: 0, availableQuestionCount: 3 }).studyReady, false)

for (const group of transformations.groups) {
  for (const part of group.parts) {
    assert.equal(part.answerKey, null)
    assert.deepEqual(part.options, [])
    assert.equal(part.markSchemeEvidence.some((entry) => Object.hasOwn(entry, 'text')), false, 'private MS summaries must not enter runtime parts')
  }
}

const publicIndex = fs.readFileSync('public/data/study-question-index/cie-0580-igcse-mathematics.json', 'utf8')
for (const group of transformations.groups) {
  assert.equal(publicIndex.includes(group.sourceQuestionId), false, 'unpublished v2 IDs must not appear in baseline public content')
}

console.log(JSON.stringify({
  status: 'pass',
  suite: 'written-part-evidence-bindings',
  transformations: { groups: transformations.groups.length, parts: 13, marks: 30, components: { 1: 3, 3: 3 } },
  crossPage0606: ['cie-0606-0606_s25_qp_22:q5', 'cie-0606-0606_w25_qp_23:q5'],
  formalProgressEligible: false,
  published: false,
}))
