import catalog from '../data/verifiedPracticeCatalog.json' with { type: 'json' }
import { subjects } from '../data/catalog.js'
import { learningPlan } from '../data/learningPlan.js'
import { courseRoutes, routeById, routesForSubject } from '../data/routeRegistry.js'
import { canonicalSourceMarkingProvenance, canonicalSourceQuestionId } from './sourceContentContract.js'
import { reviewedSourceFocusBinding, sourceContentStatus, stripSourceVisualPlaceholders } from './questionContent.js'
import { SOURCE_CONTENT_MANIFEST_CHECKSUM, SOURCE_INDEX_SHA256 } from '../data/sourceContentIdentity.js'
import { withPracticePresentation } from './practicePresentation.js'
import { MIN_VERIFIED_GROUPS_FOR_PRACTICE } from './practiceConstants.js'

export { MIN_VERIFIED_GROUPS_FOR_PRACTICE }

const EXTERNAL_GROUPS = Object.freeze({
  bpho: [
    externalGroup('bpho-mechanics', 'Mechanics and dynamics'),
    externalGroup('bpho-waves', 'Waves and oscillations'),
    externalGroup('bpho-electricity', 'Electricity and electromagnetism'),
    externalGroup('bpho-thermal-modern', 'Thermal and modern physics'),
  ],
  esat: [
    externalGroup('esat-mathematics-1', 'Mathematics 1', { paperComponent: 'mathematics-1', routeSyllabusTopic: 'esat-topic-01' }),
    externalGroup('esat-mathematics-2', 'Mathematics 2', { paperComponent: 'mathematics-2', routeSyllabusTopic: 'esat-topic-02' }),
    externalGroup('esat-physics', 'Physics', { paperComponent: 'physics', routeSyllabusTopic: 'esat-topic-03' }),
    externalGroup('esat-chemistry', 'Chemistry', { paperComponent: 'chemistry', routeSyllabusTopic: 'esat-topic-04' }),
    externalGroup('esat-biology', 'Biology', { paperComponent: 'biology', routeSyllabusTopic: 'esat-topic-05' }),
  ],
  tmua: [
    externalGroup('tmua-algebra', 'Algebra and functions'),
    externalGroup('tmua-geometry', 'Geometry and trigonometry'),
    externalGroup('tmua-proof', 'Logic and proof'),
    externalGroup('tmua-problem-solving', 'Mathematical problem solving'),
  ],
  amc12: [
    externalGroup('amc12-algebra', 'Algebra and functions'),
    externalGroup('amc12-geometry', 'Geometry and trigonometry'),
    externalGroup('amc12-number', 'Number theory'),
    externalGroup('amc12-combinatorics', 'Counting and probability'),
    externalGroup('amc12-logic', 'Logic and strategy'),
  ],
})

function externalGroup(id, name, routeMetadata = {}) {
  return Object.freeze({ id, name, stageTags: [], ...routeMetadata })
}

function compactSourcePaperLabel(sourceRef) {
  const file = String(sourceRef?.paper || '').replace(/\.[^.]+$/, '')
  const match = file.match(/(?:^|[_-])([msw])(\d{2})[_-]qp[_-]?(\d{1,2})(?:$|[_-])/i)
  if (match) return `${match[1].toUpperCase()}${match[2]}/${match[3]}`
  return file || String(sourceRef?.paperId || '').replace(/^cie-\d{4}-/i, '')
}

function appSubjectForRoute(route) {
  return subjects.find((subject) => subject.routeIds?.includes(route.routeId))
}

function baseTopicId(topicId) {
  return String(topicId || '').split('@')[0]
}

function currentQuestionGroup(raw) {
  const sourceContent = sourceContentStatus(raw)
  if (!sourceContent.complete || raw.answerBinding?.verificationStatus !== 'reviewed') return null
  const sourceFocus = reviewedSourceFocusBinding(raw)
  const parts = Object.freeze((raw.parts || []).map((part) => Object.freeze({
    ...part,
    sourceFocus: sourceFocus.complete ? sourceFocus.parts?.[part.partId] || null : null,
  })))
  return Object.freeze({ ...raw, parts, sourceContent })
}

const catalogIsCurrent = catalog?.schemaVersion === 'verified-practice-catalog-v1'
  && catalog?.sourceIndexSha256 === SOURCE_INDEX_SHA256
  && catalog?.sourceContentManifestChecksum === SOURCE_CONTENT_MANIFEST_CHECKSUM
const currentGroups = catalogIsCurrent
  ? catalog.groups.map(currentQuestionGroup).filter(Boolean)
  : []

export const verifiedPracticeQuestionGroups = Object.freeze(currentGroups)

export const coachPracticeSubjects = Object.freeze(courseRoutes.map((route) => {
  const appSubject = appSubjectForRoute(route)
  return Object.freeze({
    id: route.routeId,
    routeId: route.routeId,
    subjectId: appSubject?.id || route.subjectId,
    qualificationId: route.routeId.startsWith('cie-') ? `cambridge-${route.subjectCode}` : route.subjectId,
    qualification: route.qualification,
    code: route.subjectCode,
    label: `${route.stage} ${route.subjectCode.toUpperCase()} ${route.subject}`,
    planSubjectId: route.subjectId,
    stage: route.stage,
    stages: [route.stage],
  })
}))

function groupsForRoute(routeId) {
  return verifiedPracticeQuestionGroups.filter((question) => question.routeId === routeId)
}

function planGroupsFor(subject) {
  if (!subject) return []
  const routeQuestions = groupsForRoute(subject.routeId)
  const questionTopicIds = [...new Set(routeQuestions.map((question) => question.knowledgeGroupId).filter(Boolean))]
  const routePlanGroups = learningPlan.knowledgeGroups.filter((group) => group.routeId === subject.routeId && !group.hidden)
  const externalGroups = [subject.subjectId, subject.planSubjectId]
    .flatMap((subjectId) => EXTERNAL_GROUPS[subjectId] || [])
  const groupIds = [...new Set([
    ...routePlanGroups.map((group) => group.id),
    ...questionTopicIds,
    ...externalGroups.map((group) => group.id),
  ])]
  return groupIds.map((id) => {
    const sourceId = baseTopicId(id)
    const group = learningPlan.knowledgeGroups.find((item) => item.id === sourceId)
      || Object.values(EXTERNAL_GROUPS).flat().find((item) => item.id === sourceId)
    return Object.freeze({
      ...(group || {}),
      id,
      routeId: subject.routeId,
      stage: subject.stage,
      name: group?.name || sourceId.replaceAll('-', ' '),
      stageTags: [subject.stage],
    })
  })
}

export function questionInventory({ routeId, qualificationId, subjectId, stage, knowledgeGroupId }) {
  const route = routeById(routeId)
  if (!route) return 0
  return groupsForRoute(routeId).filter((question) => (
    (!qualificationId || question.qualificationId === qualificationId)
    && (!subjectId || question.subjectId === subjectId)
    && (!stage || question.stage === stage)
    && (!knowledgeGroupId || question.knowledgeGroupId === knowledgeGroupId)
  )).length
}

export function coachPracticeOptions() {
  return coachPracticeSubjects.map((subject) => ({
    ...subject,
    topics: planGroupsFor(subject).map((group) => ({
      id: group.id,
      routeId: subject.routeId,
      label: group.name,
      stageTags: group.stageTags || [],
      inventory: questionInventory({ routeId: subject.routeId, qualificationId: subject.qualificationId, knowledgeGroupId: group.id }),
      inventoryByStage: Object.fromEntries(subject.stages.map((stage) => [
        stage,
        questionInventory({ routeId: subject.routeId, qualificationId: subject.qualificationId, stage, knowledgeGroupId: group.id }),
      ])),
    })),
  }))
}

export function topicQueryForRoute(routeId, topicId) {
  const canonicalTopicId = String(topicId || '').split('@')[0]
  const subject = coachPracticeSubjects.find((item) => item.routeId === routeId)
  return planGroupsFor(subject).find((topic) => topic.id === canonicalTopicId)?.name || ''
}

export class PracticeInventoryError extends Error {
  constructor({ subject, stage, group, available, requested }) {
    super(`${subject.code} ${stage} ${group.name} has no verified question available yet. The source inventory is still being indexed.`)
    this.name = 'PracticeInventoryError'
    this.code = 'insufficient_verified_questions'
    this.available = available
    this.requested = requested
  }
}

export function resolveVerifiedPracticeSelection({ routeId, subjectId, stage, knowledgeGroupId, topicId } = {}) {
  const explicitRoute = routeById(routeId || subjectId)
  const matchingRoutes = explicitRoute ? [explicitRoute] : routesForSubject(subjectId).filter((route) => !stage || route.stage === stage)
  if (matchingRoutes.length !== 1) {
    throw new Error(matchingRoutes.length ? 'Choose one exact paper route before building practice.' : 'Choose a valid learning route before building practice.')
  }
  const subject = coachPracticeSubjects.find((item) => item.routeId === matchingRoutes[0].routeId)
  const groups = planGroupsFor(subject)
  const requestedTopicId = String(topicId || knowledgeGroupId || '').trim()
  const group = groups.find((item) => item.id === requestedTopicId) || groups[0]
  return { subject, group }
}

function stableSelection(questions) {
  return [...questions].toSorted((left, right) => (
    (Number(right.sourceRef?.year) || 0) - (Number(left.sourceRef?.year) || 0)
    || String(left.sourceRef?.paper).localeCompare(String(right.sourceRef?.paper))
    || String(left.sourceRef?.question).localeCompare(String(right.sourceRef?.question), undefined, { numeric: true })
  ))
}

function selectedQuestions({ routeId, qualificationId, subjectId, stage, knowledgeGroupId, questionCount, questionOffset }) {
  return stableSelection(groupsForRoute(routeId).filter((question) => (
    (!qualificationId || question.qualificationId === qualificationId)
    && (!subjectId || question.subjectId === subjectId)
    && (!stage || question.stage === stage)
    && question.knowledgeGroupId === knowledgeGroupId
  ))).slice(questionOffset, questionOffset + questionCount)
}

export function previewCoachPracticeSourceMix({ routeId, subjectId, stage, knowledgeGroupId, questionCount = 10 }) {
  const requestedCount = Math.min(30, Math.max(10, Number(questionCount) || 10))
  let selection
  try {
    selection = resolveVerifiedPracticeSelection({ routeId, subjectId, stage, knowledgeGroupId })
  } catch {
    return { questionCount: requestedCount, available: 0, shortfall: requestedCount, partial: false, status: 'route-required', pastPaperItems: 0, generatedPractice: 0, referencedPapers: 0, referencePapers: [] }
  }
  const { subject, group } = selection
  const available = group ? questionInventory({ routeId: subject.routeId, qualificationId: subject.qualificationId, stage: subject.stage, knowledgeGroupId: group.id }) : 0
  return withPracticePresentation({
    questionCount: requestedCount,
    available,
    shortfall: Math.max(0, requestedCount - available),
    partial: available > 0 && available < requestedCount,
    status: available >= MIN_VERIFIED_GROUPS_FOR_PRACTICE ? 'ready' : available > 0 ? 'partial' : 'empty',
    pastPaperItems: Math.min(available, requestedCount),
    generatedPractice: 0,
    referencedPapers: 0,
    referencePapers: [],
  })
}

function partFromQuestion(group, questionPart, groupIndex, partIndex, stableUnitId) {
  return {
    ...group,
    ...questionPart,
    id: `${stableUnitId}:${group.questionGroupId || group.sourceQuestionId}:${questionPart.partId || `${groupIndex + 1}-${partIndex + 1}`}`,
    questionGroupId: group.questionGroupId,
    questionPartId: questionPart.partId,
    label: `${group.sourceRef.question || groupIndex + 1}${questionPart.label ? `(${questionPart.label})` : ''}`,
    displayLabel: `${compactSourcePaperLabel(group.sourceRef) ? `${compactSourcePaperLabel(group.sourceRef)} · ` : ''}${group.sourceRef.question || groupIndex + 1}${questionPart.label ? `(${questionPart.label})` : ''}`,
    sourceVisualRequired: false,
    sourceContentComplete: group.sourceContent.complete === true,
    sourceContentReasons: group.sourceContent.reasons || [],
    sourcePages: group.sourceContent.sourcePages || [],
    sourceAssetUrls: group.sourceContent.assetUrls || group.sourceRef?.assetUrls || [],
    markingProvenance: canonicalSourceMarkingProvenance(group, questionPart),
    prompt: stripSourceVisualPlaceholders(questionPart.promptFragment),
    marks: questionPart.marks,
    answerType: questionPart.answerArea?.type || group.answerType || 'handwritten',
    options: [...(questionPart.options || [])],
    answerKey: questionPart.answerKey,
    answer: questionPart.answerKey,
    reviewStatus: group.answerBinding?.verificationStatus || 'unindexed',
    practiceAvailable: true,
    deterministicScoringAvailable: Boolean(questionPart.answerKey),
    aiAssistedMarkingAvailable: group.answerBinding?.verificationStatus === 'reviewed',
    markPoints: questionPart.markSchemePoints || [],
    sourceKind: 'past-paper',
    sourceLabel: `${group.sourceRef.paper} / ${group.sourceRef.question}${questionPart.label ? `(${questionPart.label})` : ''}`,
    sourceDescription: `Official question paper, page ${questionPart.sourcePage || group.sourceRef.pageStart}. The exact paired mark scheme is bound to this question part.`,
    sourceRef: { ...group.sourceRef, questionPartId: questionPart.partId, page: questionPart.sourcePage || group.sourceRef.pageStart },
    answerRef: { ...group.answerRef, questionPartId: questionPart.partId, page: questionPart.answerSourcePage || group.answerRef.pageStart },
  }
}

function buildUnit({ stableUnitId, subject, group, bank, template = {} }) {
  const parts = bank.flatMap((question, groupIndex) => (question.parts || []).map((questionPart, partIndex) => (
    partFromQuestion(question, questionPart, groupIndex, partIndex, stableUnitId)
  )))
  const sourcePapers = new Map()
  for (const part of parts) {
    if (!sourcePapers.has(part.sourceRef.paperId)) {
      sourcePapers.set(part.sourceRef.paperId, {
        id: part.sourceRef.paperId,
        file: part.sourceRef.paper,
        year: part.sourceRef.year,
        season: part.sourceRef.season,
        paperNumber: part.sourceRef.component,
        questionUrl: part.sourceRef.localUrl,
        markSchemeUrl: part.answerRef.localUrl,
      })
    }
  }
  const appSubject = subjects.find((item) => item.id === subject.subjectId)
  const route = routeById(subject.routeId)
  return withPracticePresentation({
    id: stableUnitId,
    type: 'topic',
    agentGenerated: Boolean(template.agentGenerated),
    routeId: subject.routeId,
    qualification: subject.qualification,
    subject: route?.subject,
    subjectId: route?.subjectId || subject.subjectId,
    qualificationId: subject.qualificationId,
    knowledgeGroupId: group.id,
    topicId: group.id,
    topic: group.name,
    subtopic: `${subject.stage} verified past-paper drill`,
    icon: appSubject?.icon || 'Q',
    title: `${subject.stage} ${route?.subject} · ${group.name}`,
    board: subject.label,
    code: subject.code,
    subjectCode: subject.code,
    specification: `${subject.stage} · official past-paper questions`,
    inventoryStatus: template.inventoryStatus || 'verified-source-inventory',
    stage: subject.stage,
    paperComponent: group.paperComponent
      ? [group.paperComponent]
      : [...new Set(parts.map((part) => part.paperComponent).filter((value) => value != null))],
    syllabusTopic: group.routeSyllabusTopic || group.id,
    sourcePaper: [...new Set(parts.map((part) => part.sourcePaper).filter(Boolean))],
    durationSec: Math.max(20, parts.length * 4) * 60,
    maxMarks: parts.reduce((sum, part) => sum + part.marks, 0),
    difficulty: 'Past paper',
    estimatedMinutes: Math.max(20, parts.length * 4),
    priority: template.priority || 'AI Coach set',
    provenance: {
      source: 'Question-level items from official papers, each bound to its exact mark scheme.',
      licenseStatus: 'Official exam material; personal study library',
      paperRef: [...sourcePapers.values()].map((item) => item.file).join(', '),
    },
    sourceMix: {
      pastPaperItems: parts.length,
      generatedPractice: 0,
      referencedPapers: sourcePapers.size,
    },
    assignmentSourceIds: template.assignmentSourceIds || null,
    questionGroupCount: bank.length,
    questionOffset: template.questionOffset || 0,
    referencePapers: [...sourcePapers.values()],
    parts,
    sourceSetIndex: template.sourceSetIndex || null,
    sourceSetCount: template.sourceSetCount || null,
    focusedRetestOf: template.focusedRetestOf || null,
    sourceGateVersion: 'current-reviewed-source-v1',
  })
}

export function buildCoachPractice({ routeId, subjectId, stage, knowledgeGroupId, topicId, questionCount = 10, questionOffset = 0, allowPartial = false, unitId = '', sourceQuestionIds = null, agentGenerated = false }) {
  const { subject, group } = resolveVerifiedPracticeSelection({ routeId, subjectId, stage, knowledgeGroupId, topicId })
  const assignedSourceIds = Array.isArray(sourceQuestionIds)
    ? sourceQuestionIds.map((id) => String(id || '').trim()).filter(Boolean)
    : null
  if (assignedSourceIds && new Set(assignedSourceIds).size !== assignedSourceIds.length) {
    throw new Error('The assignment source list contains duplicate question IDs.')
  }
  const requestedCount = assignedSourceIds ? assignedSourceIds.length : Math.min(30, Math.max(10, Number(questionCount) || 10))
  if (!group) throw new PracticeInventoryError({ subject, stage: subject.stage, group: { name: 'selected topic' }, available: 0, requested: requestedCount })
  const available = selectedQuestions({
    routeId: subject.routeId,
    qualificationId: subject.qualificationId,
    subjectId: subject.subjectId,
    stage: subject.stage,
    knowledgeGroupId: group.id,
    questionCount: Number.MAX_SAFE_INTEGER,
    questionOffset: 0,
  })
  const bank = assignedSourceIds
    ? assignedSourceIds.map((id) => available.find((question) => question.bankId === id)).filter(Boolean)
    : available.slice(Math.max(0, Number(questionOffset) || 0), Math.max(0, Number(questionOffset) || 0) + requestedCount)
  if (assignedSourceIds && bank.length !== assignedSourceIds.length) {
    throw new Error('This assignment references question IDs that are no longer available in its selected topic.')
  }
  if (!bank.length || (bank.length < requestedCount && !allowPartial)) {
    throw new PracticeInventoryError({ subject, stage: subject.stage, group, available: bank.length, requested: requestedCount })
  }
  return buildUnit({
    stableUnitId: unitId || `verified-set-${Date.now()}`,
    subject,
    group,
    bank,
    template: {
      assignmentSourceIds: assignedSourceIds,
      agentGenerated,
      questionOffset: Math.max(0, Math.floor(Number(questionOffset) || 0)),
      inventoryStatus: bank.length < requestedCount ? 'partial-source-inventory' : 'verified-source-inventory',
    },
  })
}

function persistedPartReference(part) {
  const sourceQuestionId = canonicalSourceQuestionId(part?.sourceQuestionId || part?.questionGroupId || part?.bankId)
  const questionPartId = String(part?.questionPartId || part?.partId || '')
  return sourceQuestionId && questionPartId ? { sourceQuestionId, questionPartId } : null
}

export function rebindVerifiedPracticeUnit(unit) {
  const suppliedParts = Array.isArray(unit?.parts) ? unit.parts : []
  if (!suppliedParts.length || suppliedParts.some((part) => part?.sourceKind !== 'past-paper')) return null
  const route = routeById(unit?.routeId)
  if (!route) return null
  const references = suppliedParts.map(persistedPartReference)
  if (references.some((reference) => !reference)) return null
  const uniquePartKeys = new Set(references.map((reference) => `${reference.sourceQuestionId}\u0000${reference.questionPartId}`))
  if (uniquePartKeys.size !== references.length) return null
  const canonicalById = new Map(groupsForRoute(route.routeId).map((group) => [group.sourceQuestionId, group]))
  const orderedGroups = [...new Set(references.map((reference) => reference.sourceQuestionId))]
    .map((sourceQuestionId) => canonicalById.get(sourceQuestionId))
  if (orderedGroups.some((group) => !group)) return null
  const knowledgeGroupId = orderedGroups[0]?.knowledgeGroupId
  if (!knowledgeGroupId || orderedGroups.some((group) => group.knowledgeGroupId !== knowledgeGroupId)) return null
  const subject = coachPracticeSubjects.find((item) => item.routeId === route.routeId)
  const rebuilt = buildUnit({
    stableUnitId: String(unit.id || `verified-set-${Date.now()}`),
    subject,
    group: planGroupsFor(subject).find((item) => item.id === knowledgeGroupId) || { id: knowledgeGroupId, name: unit.topic || knowledgeGroupId },
    bank: orderedGroups,
    template: unit,
  })
  const canonicalParts = new Map(rebuilt.parts.map((part) => [`${part.sourceQuestionId}\u0000${part.questionPartId}`, part]))
  const parts = references.map((reference) => canonicalParts.get(`${reference.sourceQuestionId}\u0000${reference.questionPartId}`))
  if (parts.some((part) => !part)) return null
  const totalMarks = parts.reduce((sum, part) => sum + Number(part.marks || 0), 0)
  const ratio = parts.length / Math.max(1, rebuilt.parts.length)
  return withPracticePresentation({
    ...rebuilt,
    parts,
    maxMarks: totalMarks,
    durationSec: Math.max(300, Math.ceil(Number(rebuilt.durationSec || 600) * ratio)),
    estimatedMinutes: Math.max(5, Math.ceil(Number(rebuilt.estimatedMinutes || 10) * ratio)),
    questionGroupCount: new Set(references.map((reference) => reference.sourceQuestionId)).size,
  })
}

function stableCatalogUnitId(routeId, topicId, setNumber) {
  return `past-paper-set:${routeId}:${topicId}:set-${setNumber}`
}

export function buildVerifiedPracticeCatalog({ chunkSize = 10 } = {}) {
  const size = Math.min(30, Math.max(5, Math.floor(Number(chunkSize) || 10)))
  const units = []
  for (const option of coachPracticeOptions()) {
    for (const topic of option.topics) {
      for (let offset = 0; offset < topic.inventory; offset += size) {
        const setNumber = Math.floor(offset / size) + 1
        const unit = buildCoachPractice({
          routeId: option.routeId,
          knowledgeGroupId: topic.id,
          questionCount: Math.min(size, topic.inventory - offset),
          questionOffset: offset,
          allowPartial: true,
          unitId: stableCatalogUnitId(option.routeId, topic.id, setNumber),
        })
        units.push({
          ...unit,
          agentGenerated: false,
          sourceSetIndex: setNumber,
          sourceSetCount: Math.ceil(topic.inventory / size),
          title: `${option.stage} ${routeById(option.routeId)?.subject} · ${topic.label} · Set ${setNumber}`,
          priority: setNumber === 1 ? 'Start here' : 'Past paper set',
        })
      }
    }
  }
  return units
}

export function verifiedPracticeCatalogMetrics(units = buildVerifiedPracticeCatalog()) {
  return {
    units: units.length,
    questionGroups: units.reduce((sum, unit) => sum + (unit.questionGroupCount || 0), 0),
    answerableParts: units.reduce((sum, unit) => sum + unit.parts.length, 0),
    referencedPapers: new Set(units.flatMap((unit) => unit.referencePapers || []).map((paper) => paper.id)).size,
    routes: new Set(units.map((unit) => unit.routeId)).size,
    topics: new Set(units.map((unit) => `${unit.routeId}:${unit.knowledgeGroupId}`)).size,
  }
}

export function paperQuestionMarkingMetadata({ paperId, routeId }) {
  const sourceQuestions = verifiedPracticeQuestionGroups.filter((question) => (
    question.sourceRef?.paperId === paperId
    && (!routeId || question.routeId === routeId)
    && question.answerBinding?.verificationStatus === 'reviewed'
  ))
  return Object.fromEntries(sourceQuestions.map((question) => {
    const number = Number(String(question.sourceRef?.question || '').match(/\d+/)?.[0])
    if (!number) return null
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
    return [number, {
      schemaVersion: 'paper-question-marking-v1',
      reviewStatus: 'reviewed',
      questionId: question.sourceQuestionId || question.questionGroupId,
      bindingSignature: question.sourceContent?.bindingSignature || '',
      questionGroupId: question.questionGroupId,
      number,
      maxMarks,
      prompt: parts.map((part) => part.prompt).filter(Boolean).join('\n'),
      parts,
      expectedMarkPoints: parts.flatMap((part) => part.markSchemePoints.map((point, index) => ({
        id: `${part.id}:M${index + 1}`,
        partId: part.id,
        marks: 1,
        point,
      }))),
      sourceRef: question.sourceRef,
      answerRef: question.answerRef,
    }]
  }).filter(Boolean))
}
