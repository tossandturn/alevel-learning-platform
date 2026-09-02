import importedQuestionIndex from './importedQuestionIndex.json' with { type: 'json' }
import { LEGACY_UNSCOPED_ROUTE_ID, resolveRouteId, routeById, routesForSubject } from './routeRegistry.js'
import { normaliseQuestionGroup } from './questionParts.js'
import { hasCompleteSourceContent, hasRequiredSourceVisual, reviewedSourceFocusBinding, sourceContentStatus } from '../lib/questionContent.js'
import { canonicalAiMarkingProvenance, canonicalSourceMarkingProvenance } from '../lib/sourceContentContract.js'
import { stableSorted } from '../lib/arrayOrder.js'
import { questionBelongsToTopic } from '../lib/questionTopicMembership.js'

const REQUIRED_SOURCE_FIELDS = ['paperId', 'paper', 'question', 'localUrl', 'pageStart', 'sha256']
const REQUIRED_ANSWER_FIELDS = ['documentId', 'file', 'localUrl', 'pageStart', 'sha256']

function joinedIndexItems(index) {
  if (Array.isArray(index.items)) return index.items
  const answers = new Map((index.answers || []).map((answer) => [answer.answerId, answer]))
  const bindings = new Map((index.bindings || []).map((binding) => [binding.questionId, binding]))
  return (index.questions || []).map((question) => {
    const binding = bindings.get(question.questionId)
    const answer = answers.get(binding?.answerId)
    return answer ? { ...question, ...answer, bankId: question.questionId, answerBinding: binding } : question
  })
}

function hasRequiredFields(value, fields) {
  return value && fields.every((field) => value[field] !== undefined && value[field] !== null && value[field] !== '')
}

function isAiVerifiedCoordinateQuestionGroup(question) {
  if (
    question?.answerBinding?.verificationStatus !== 'ai-verified'
    || question?.sourceContent?.schemaVersion !== 'ai-verified-coordinate-source-v1'
    || question?.sourceContent?.semanticStatus !== 'ai-verified'
    || question?.answerBinding?.questionDocumentSha256 !== question?.sourceRef?.sha256
    || question?.answerBinding?.answerDocumentSha256 !== question?.answerRef?.sha256
  ) return false

  const parts = Array.isArray(question?.parts) ? question.parts : []
  const totalMarks = Number(question?.totalMarks ?? question?.marks)
  return Boolean(
    parts.length
    && Number.isInteger(totalMarks)
    && totalMarks > 0
    && parts.reduce((sum, part) => sum + Number(part?.marks || 0), 0) === totalMarks
    && parts.every((part) => (
      typeof part?.partId === 'string'
      && part.partId
      && typeof part?.promptFragment === 'string'
      && part.promptFragment.trim()
      && Number.isInteger(Number(part.marks))
      && Number(part.marks) > 0
      && Number(part.questionDeclaredMarks) === Number(part.marks)
      && Number.isInteger(Number(part.sourcePage))
      && Number(part.sourcePage) > 0
      && Number.isInteger(Number(part.answerSourcePage))
      && Number(part.answerSourcePage) > 0
      && Array.isArray(part.sourceEvidence)
      && part.sourceEvidence.some((evidence) => (
        Number(evidence?.page) === Number(part.sourcePage)
        && evidence?.coordinateSpace === 'normalized-xyxy'
        && evidence?.documentSha256 === question.sourceRef?.sha256
        && Array.isArray(evidence?.region)
        && evidence.region.length === 4
      ))
      && Array.isArray(part.markSchemeEvidence)
      && part.markSchemeEvidence.some((evidence) => (
        Number(evidence?.page) === Number(part.answerSourcePage)
        && /^[a-f0-9]{64}$/i.test(String(evidence?.pageImageSha256 || ''))
      ))
    )),
  )
}

export function isVerifiedPastPaperItem(question) {
  const route = routeById(question?.routeId)
  const groupValidation = normaliseQuestionGroup(question, question)
  return Boolean(
    question
    && question.sourceKind === 'past-paper'
    && question.bankId
    && question.qualificationId
    && question.knowledgeGroupId
    && Array.isArray(question.topicTags)
    && question.topicTags.length
    && question.answerBinding
    && (question.answerBinding.verificationStatus === 'machine-indexed' || question.answerBinding.verificationStatus === 'reviewed')
    && question.answerBinding.questionDocumentSha256 === question.sourceRef?.sha256
    && question.answerBinding.answerDocumentSha256 === question.answerRef?.sha256
    && question.questionGroupId
    && question.questionGroupStatus !== 'quarantined'
    && groupValidation.status === 'verified'
    && hasCompleteSourceContent(question)
    && hasRequiredSourceVisual(question)
    && route
    && route.stage === question.stage
    && route.qualification === question.qualification
    && hasRequiredFields(question.sourceRef, REQUIRED_SOURCE_FIELDS)
    && hasRequiredFields(question.answerRef, REQUIRED_ANSWER_FIELDS),
  )
}

// A machine-indexed QP/MS binding is sufficient to show a source-backed
// question for practice. AI study marking additionally requires the generated
// checksum manifest to cover every declared QP/MS page; it never makes the
// result an official or mastery-eligible mark.
export function isHumanReviewedPastPaperItem(question) {
  return isVerifiedPastPaperItem(question) && question.answerBinding?.verificationStatus === 'reviewed'
}

/**
 * Study-only is deliberately narrower than "has an asset URL" but broader
 * than the formal reviewed bank. It is for source-backed practice while a
 * reviewer is still reconciling syllabus mapping or semantic evidence.
 *
 * These records remain outside the verified catalog, teacher assignments and
 * mastery signals. A separate checksum-bound gate may allow AI study marking.
 */
export function isStudyOnlyPastPaperItem(question) {
  const route = routeById(question?.routeId)
  const sourceContent = question?.sourceContent || sourceContentStatus(question)
  const groupValidation = normaliseQuestionGroup(question, question)
  const coordinateVerified = isAiVerifiedCoordinateQuestionGroup(question)
  return Boolean(
    question
    && question.sourceKind === 'past-paper'
    && question.bankId
    && question.qualificationId
    && question.knowledgeGroupId
    && Array.isArray(question.topicTags)
    && question.topicTags.length
    && ['machine-indexed', 'ai-verified'].includes(question.answerBinding?.verificationStatus)
    && question.questionGroupId
    && question.questionGroupStatus !== 'quarantined'
    && (groupValidation.status === 'verified' || coordinateVerified)
    && sourceContent.fileComplete === true
    && ['unreviewed', 'ai-verified'].includes(sourceContent.semanticStatus)
    && route
    && route.stage === question.stage
    && route.qualification === question.qualification
    && hasRequiredFields(question.sourceRef, REQUIRED_SOURCE_FIELDS)
    && hasRequiredFields(question.answerRef, REQUIRED_ANSWER_FIELDS),
  )
}

export function isAiMarkablePastPaperItem(question) {
  const sourceEligible = isHumanReviewedPastPaperItem(question) || isStudyOnlyPastPaperItem(question)
  return Boolean(
    sourceEligible
    && Array.isArray(question?.parts)
    && question.parts.length
    && question.parts.every((part) => canonicalAiMarkingProvenance(question, part)),
  )
}

export function isStudentReleasedAiStudyItem(question) {
  const release = question?.studentRelease
  return Boolean(
    isStudyOnlyPastPaperItem(question)
    && question?.studentStudyEligible === true
    && question?.formalProgressEligible === false
    && release?.schemaVersion === 'ai-student-study-release.v1'
    && release?.status === 'released'
    && release?.authority === 'ai-provisional'
    && release?.studentStudyEligible === true
    && release?.formalProgressEligible === false
    && release?.artifactId
    && release.artifactId === question?.answerBinding?.artifactId
    && release?.routeId === question?.routeId
    && release?.sourceBinding?.questionPdfSha256 === question?.sourceRef?.sha256
    && release?.sourceBinding?.markSchemePdfSha256 === question?.answerRef?.sha256
    && release?.review?.extractionSchemaName === 'ai_pdf_question_extraction_v1'
    && release?.review?.verificationSchemaName === 'ai_pdf_question_verification_v1'
    && release?.review?.independentPassCount === 2,
  )
}

function routesForImportedQuestion(question) {
  const stages = new Set(question.stageTags || [])
  const component = Number(question.sourceRef?.component || question.componentTags?.[0])
  const topicRouteId = resolveRouteId({
    qualificationId: question.qualificationId,
    subjectId: question.subjectId,
    knowledgeGroupId: question.knowledgeGroupId,
  })
  return routesForSubject(question.subjectId).filter((route) => {
    const isSpecialistRoute = route.stage === 'Admissions' || route.stage === 'Competition'
    const stageMatches = isSpecialistRoute || stages.has(route.stage)
    const componentMatches = isSpecialistRoute || !Number.isFinite(component) || !route.paperComponents.length || route.paperComponents.includes(component)
    const topicMatches = !topicRouteId || route.routeId === topicRouteId
    return stageMatches && componentMatches && topicMatches
  })
}

export function normalizeImportedQuestion(question, route = null) {
  const sourceRef = { ...(question.sourceRef || {}), page: question.sourceRef?.page ?? question.sourceRef?.pageStart }
  const answerRef = question.answerRef || {}
  const sourceQuestionId = question.bankId || question.questionId
  const questionGroup = normaliseQuestionGroup(question, question)
  const sourceContent = sourceContentStatus({ ...question, parts: questionGroup.parts })
  const reviewedSourceFocus = sourceContent.complete ? reviewedSourceFocusBinding(question) : null
  const normalizedParts = (questionGroup.parts || []).map((part) => Object.freeze({
    ...part,
    // This is intentionally populated only from matching human-reviewed QP
    // region evidence. The player uses the full source page otherwise.
    sourceFocus: reviewedSourceFocus?.complete ? reviewedSourceFocus.parts?.[part.partId] || null : null,
  }))
  const routeId = route?.routeId || LEGACY_UNSCOPED_ROUTE_ID
  const sourceKnowledgeGroupId = question.knowledgeGroupId || question.topicId || null
  const sourceTopicRouteId = resolveRouteId({ subjectId: question.subjectId, knowledgeGroupId: sourceKnowledgeGroupId })
  const syllabusTopic = route && sourceTopicRouteId !== routeId
    ? `${sourceKnowledgeGroupId}@${routeId}`
    : sourceKnowledgeGroupId
  return Object.freeze({
    ...question,
    bankId: `${sourceQuestionId}@${routeId}`,
    sourceQuestionId,
    questionGroupId: questionGroup.questionGroupId || sourceQuestionId,
    questionGroupStatus: questionGroup.status,
    totalMarks: questionGroup.totalMarks || 0,
    parts: Object.freeze(normalizedParts),
    routeId,
    qualification: route?.qualification || null,
    stage: route?.stage || null,
    subject: route?.subject || null,
    paperComponent: sourceRef.component ?? null,
    knowledgeGroupId: syllabusTopic,
    topicId: syllabusTopic,
    syllabusTopic,
    sourceKnowledgeGroupId,
    sourcePaper: sourceRef.paper || null,
    sourceKind: 'past-paper',
    sourceContent,
    answerType: question.answerType || 'handwritten',
    marks: questionGroup.totalMarks || Math.max(1, Number(question.marks) || 1),
    stageTags: [...new Set(question.stageTags || [])],
    componentTags: [...new Set(question.componentTags || [])],
    topicTags: [...new Set(question.topicTags || [])],
    skillTags: [...new Set(question.skillTags || [])],
    sourceRef: Object.freeze(sourceRef),
    answerRef: Object.freeze(answerRef),
    provenance: Object.freeze({
      source: 'Official question paper and exact paired mark scheme',
      licenseStatus: question.provenance?.licenseStatus || 'Official exam material; personal study library',
      paperRef: sourceRef.paper,
      indexedAt: question.provenance?.indexedAt || importedQuestionIndex.generatedAt,
    }),
  })
}

const normalizedImportedQuestionBank = Object.freeze(
  joinedIndexItems(importedQuestionIndex)
    .flatMap((question) => {
      const routes = routesForImportedQuestion(question)
      return routes.length ? routes.map((route) => normalizeImportedQuestion(question, route)) : [normalizeImportedQuestion(question)]
    }),
)

// Formal consumers retain the strict reviewed/source-complete contract.
export const unifiedQuestionBank = Object.freeze(normalizedImportedQuestionBank.filter(isVerifiedPastPaperItem))

// Topic study can use a separate, explicitly labelled pool while human review
// is in progress. Keeping this separate prevents a relaxed UI inventory from
// silently widening assignments, progress denominators, or AI marking.
export const studyQuestionBank = Object.freeze(normalizedImportedQuestionBank.filter((question) => (
  isVerifiedPastPaperItem(question) || isStudyOnlyPastPaperItem(question)
)))

export function selectTaggedQuestions({
  routeId,
  qualificationId,
  subjectId,
  stage,
  knowledgeGroupId,
  questionCount = 10,
  questionOffset = 0,
  questionBank = unifiedQuestionBank,
}) {
  const requestedCount = Math.min(30, Math.max(1, Number(questionCount) || 10))
  const offset = Math.max(0, Math.floor(Number(questionOffset) || 0))
  const selectionLimit = offset + requestedCount
  const route = routeById(routeId)
  if (!route) return []
  const candidates = questionBank.filter((question) => (
    question.routeId === routeId
    && (!qualificationId || question.qualificationId === qualificationId)
    && (!subjectId || question.subjectId === subjectId)
    && questionBelongsToTopic(question, knowledgeGroupId)
    && (!stage || question.stage === stage)
    && isVerifiedPastPaperItem(question)
  ))

  const sorted = stableSorted(candidates, (left, right) => (
      (Number(right.sourceRef?.year) || 0) - (Number(left.sourceRef?.year) || 0)
      || String(left.sourceRef?.paper).localeCompare(String(right.sourceRef?.paper))
      || String(left.sourceRef?.question).localeCompare(String(right.sourceRef?.question), undefined, { numeric: true })
    ))

  // A topic may contain many MCQs from one recent paper and only a few
  // structured parts. Round-robin the available answer surfaces and papers so
  // a 10-question drill remains useful for both exam recognition and working.
  const interleaveByPaper = (items) => {
    const byPaper = Map.groupBy(items, (question) => question.sourceRef?.paperId || question.sourceRef?.paper)
    const paperBuckets = [...byPaper.values()]
    const result = []
    let cursor = 0
    while (result.length < items.length) {
      let added = false
      for (const bucket of paperBuckets) {
        if (cursor < bucket.length) {
          result.push(bucket[cursor])
          added = true
        }
      }
      if (!added) break
      cursor += 1
    }
    return result
  }
  const byType = Map.groupBy(sorted, (question) => question.answerType || 'handwritten')
  for (const [type, items] of byType) byType.set(type, interleaveByPaper(items))
  const typeOrder = ['handwritten', 'numeric', 'graph', 'multiple-choice']
  const types = stableSorted([...byType.keys()], (left, right) => {
    const leftRank = typeOrder.indexOf(left)
    const rightRank = typeOrder.indexOf(right)
    return (leftRank < 0 ? typeOrder.length : leftRank) - (rightRank < 0 ? typeOrder.length : rightRank) || left.localeCompare(right)
  })
  const cursors = new Map(types.map((type) => [type, 0]))
  const selected = []

  while (selected.length < selectionLimit) {
    let added = false
    for (const type of types) {
      const index = cursors.get(type)
      const bucket = byType.get(type)
      if (index >= bucket.length) continue
      selected.push(bucket[index])
      cursors.set(type, index + 1)
      added = true
      if (selected.length >= selectionLimit) break
    }
    if (!added) break
  }

  return selected.slice(offset, offset + requestedCount)
}

export function questionInventory({ routeId, qualificationId, subjectId, stage, knowledgeGroupId, questionBank = unifiedQuestionBank }) {
  const route = routeById(routeId)
  if (!route) return 0
  return questionBank.filter((question) => (
    question.routeId === routeId
    && (!qualificationId || question.qualificationId === qualificationId)
    && (!subjectId || question.subjectId === subjectId)
    && (!stage || question.stage === stage)
    && questionBelongsToTopic(question, knowledgeGroupId)
    && isVerifiedPastPaperItem(question)
  )).length
}

function printedQuestionNumber(question) {
  const match = String(question?.sourceRef?.question || '').match(/\d+/)
  return match ? Number(match[0]) : null
}

export function paperQuestionMarkingMetadata({ paperId, routeId, questionBank = unifiedQuestionBank }) {
  const sourceQuestions = questionBank.filter((question) => (
    question.sourceRef?.paperId === paperId
    && (!routeId || question.routeId === routeId)
    && isHumanReviewedPastPaperItem(question)
  ))
  const bySourceQuestion = new Map()
  for (const question of sourceQuestions) {
    const sourceId = question.sourceQuestionId || question.questionGroupId
    if (!bySourceQuestion.has(sourceId)) bySourceQuestion.set(sourceId, question)
  }
  return Object.fromEntries([...bySourceQuestion.values()].flatMap((question) => {
    const number = printedQuestionNumber(question)
    if (!number) return []
    const parts = (question.parts || []).map((part) => ({
      id: part.partId,
      label: part.label,
      marks: Number(part.marks) || 0,
      answerType: part.answerArea?.type || question.answerType || 'handwritten',
      answerKey: part.answerKey || null,
      options: [...(part.options || [])],
      prompt: part.promptFragment || '',
      markSchemePoints: [...(part.markSchemePoints || [])],
      sourcePage: part.sourcePage || question.sourceRef.pageStart,
      markSchemePage: part.answerSourcePage || question.answerRef.pageStart,
      sourceEvidence: [...(part.sourceEvidence || [])],
      markSchemeEvidence: [...(part.markSchemeEvidence || [])],
      markingProvenance: canonicalSourceMarkingProvenance(question, part),
    }))
    const maxMarks = parts.reduce((sum, part) => sum + part.marks, 0) || Number(question.totalMarks) || Number(question.marks) || 0
    if (!maxMarks) return []
    return [[number, Object.freeze({
      schemaVersion: 'paper-question-marking-v1',
      reviewStatus: 'reviewed',
      questionId: question.sourceQuestionId || question.questionGroupId,
      bindingSignature: question.sourceContent?.bindingSignature || '',
      questionGroupId: question.questionGroupId,
      number,
      maxMarks,
      prompt: parts.map((part) => part.prompt).filter(Boolean).join('\n'),
      parts: Object.freeze(parts.map(Object.freeze)),
      expectedMarkPoints: Object.freeze(parts.flatMap((part) => part.markSchemePoints.map((point, index) => ({
        id: `${part.id}:M${index + 1}`,
        partId: part.id,
        marks: 1,
        point,
      })))),
      sourceRef: question.sourceRef,
      answerRef: question.answerRef,
    })]]
  }))
}

export function sourceMixForQuestions(questions) {
  return {
    pastPaperItems: questions.filter(isVerifiedPastPaperItem).length,
    generatedPractice: 0,
    referencedPapers: new Set(questions.map((question) => question.sourceRef?.paperId).filter(Boolean)).size,
  }
}
