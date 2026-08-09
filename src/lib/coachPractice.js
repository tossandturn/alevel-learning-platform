import { subjects } from '../data/catalog.js'
import { learningPlan } from '../data/learningPlan.js'
import { questionInventory, selectTaggedQuestions, sourceMixForQuestions, unifiedQuestionBank } from '../data/questionBank.js'
import { courseRoutes, routeById, routesForSubject } from '../data/routeRegistry.js'

const EXTERNAL_GROUPS = Object.freeze({
  bpho: [
    externalGroup('bpho-mechanics', 'Mechanics and dynamics'),
    externalGroup('bpho-waves', 'Waves and oscillations'),
    externalGroup('bpho-electricity', 'Electricity and electromagnetism'),
    externalGroup('bpho-thermal-modern', 'Thermal and modern physics'),
  ],
  esat: [
    externalGroup('esat-mathematics-1', 'Mathematics 1'),
    externalGroup('esat-mathematics-2', 'Mathematics 2'),
    externalGroup('esat-physics', 'Physics'),
    externalGroup('esat-chemistry', 'Chemistry'),
    externalGroup('esat-biology', 'Biology'),
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

function externalGroup(id, name) {
  return Object.freeze({ id, name, stageTags: [] })
}

function appSubjectForRoute(route) {
  return subjects.find((subject) => subject.routeIds?.includes(route.routeId))
}

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

function baseTopicId(topicId) {
  return String(topicId || '').split('@')[0]
}

function planGroupsFor(subject) {
  if (!subject) return []
  const routeQuestions = selectTaggedQuestionsForRoute(subject.routeId)
  const questionTopicIds = [...new Set(routeQuestions.map((question) => question.knowledgeGroupId).filter(Boolean))]
  const routePlanGroups = learningPlan.knowledgeGroups.filter((group) => group.routeId === subject.routeId && !group.hidden)
  const groupIds = [...new Set([...routePlanGroups.map((group) => group.id), ...questionTopicIds])]
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

function selectTaggedQuestionsForRoute(routeId) {
  const route = routeById(routeId)
  if (!route) return []
  return unifiedQuestionBank.filter((question) => question.routeId === routeId)
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

export class PracticeInventoryError extends Error {
  constructor({ subject, stage, group, available, requested }) {
    super(`${subject.code} ${stage} ${group.name} has no verified question available yet. The source inventory is still being indexed.`)
    this.name = 'PracticeInventoryError'
    this.code = 'insufficient_verified_questions'
    this.available = available
    this.requested = requested
  }
}

function resolveSelection({ routeId, subjectId, stage, knowledgeGroupId }) {
  const explicitRoute = routeById(routeId || subjectId)
  const matchingRoutes = explicitRoute ? [explicitRoute] : routesForSubject(subjectId).filter((route) => !stage || route.stage === stage)
  if (matchingRoutes.length !== 1) {
    throw new Error(matchingRoutes.length ? 'Choose one exact paper route before building practice.' : 'Choose a valid learning route before building practice.')
  }
  const subject = coachPracticeSubjects.find((item) => item.routeId === matchingRoutes[0].routeId)
  const groups = planGroupsFor(subject)
  const group = groups.find((item) => item.id === knowledgeGroupId) || groups[0]
  return { subject, group }
}

export function previewCoachPracticeSourceMix({ routeId, subjectId, stage, knowledgeGroupId, questionCount = 10 }) {
  const requestedCount = Math.min(30, Math.max(10, Number(questionCount) || 10))
  let selection
  try {
    selection = resolveSelection({ routeId, subjectId, stage, knowledgeGroupId })
  } catch {
    return { questionCount: requestedCount, available: 0, shortfall: requestedCount, partial: false, status: 'route-required', pastPaperItems: 0, generatedPractice: 0, referencedPapers: 0, referencePapers: [] }
  }
  const { subject, group } = selection
  const available = group ? questionInventory({ routeId: subject.routeId, qualificationId: subject.qualificationId, stage: subject.stage, knowledgeGroupId: group.id }) : 0
  return {
    questionCount: requestedCount,
    available,
    shortfall: Math.max(0, requestedCount - available),
    partial: available > 0 && available < requestedCount,
    status: available >= requestedCount ? 'ready' : available > 0 ? 'partial' : 'empty',
    pastPaperItems: Math.min(available, requestedCount),
    generatedPractice: 0,
    referencedPapers: 0,
    referencePapers: [],
  }
}

export function buildCoachPractice({ routeId, subjectId, stage, knowledgeGroupId, questionCount = 10, questionOffset = 0, allowPartial = false, unitId = '', sourceQuestionIds = null }) {
  const { subject, group } = resolveSelection({ routeId, subjectId, stage, knowledgeGroupId })
  const assignedSourceIds = Array.isArray(sourceQuestionIds)
    ? sourceQuestionIds.map((id) => String(id || '').trim()).filter(Boolean)
    : null
  if (assignedSourceIds && new Set(assignedSourceIds).size !== assignedSourceIds.length) {
    throw new Error('The assignment source list contains duplicate question IDs.')
  }
  const requestedCount = assignedSourceIds ? assignedSourceIds.length : Math.min(30, Math.max(10, Number(questionCount) || 10))
  if (!group) throw new PracticeInventoryError({ subject, stage: subject.stage, group: { name: 'selected topic' }, available: 0, requested: requestedCount })
  const bank = assignedSourceIds
    ? (() => {
      const available = new Map(selectTaggedQuestionsForRoute(subject.routeId)
        .filter((question) => question.knowledgeGroupId === group.id)
        .map((question) => [question.bankId, question]))
      const missing = assignedSourceIds.filter((id) => !available.has(id))
      if (missing.length) throw new Error('This assignment references question IDs that are no longer available in its selected topic.')
      return assignedSourceIds.map((id) => available.get(id))
    })()
    : selectTaggedQuestions({
      routeId: subject.routeId,
      qualificationId: subject.qualificationId,
      subjectId: subject.subjectId,
      stage: subject.stage,
      knowledgeGroupId: group.id,
      questionCount: requestedCount,
      questionOffset,
    })
  if (!bank.length) {
    throw new PracticeInventoryError({ subject, stage: subject.stage, group, available: bank.length, requested: requestedCount })
  }
  if (bank.length < requestedCount && !allowPartial) {
    throw new PracticeInventoryError({ subject, stage: subject.stage, group, available: bank.length, requested: requestedCount })
  }

  const generatedAt = Date.now()
  const stableUnitId = unitId || `verified-set-${generatedAt}`
  let parts = bank.map((part, _index) => ({
    sourceLabel: `${part.sourceRef.paper} · ${part.sourceRef.question}`,
    sourceDescription: `Official question paper, page ${part.sourceRef.pageStart}. The exact paired mark scheme unlocks after submission.`,
  }))
  parts = bank.flatMap((group, groupIndex) => (group.parts || []).map((questionPart, partIndex) => ({
    ...group,
    ...questionPart,
    id: `${stableUnitId}:${group.questionGroupId || group.sourceQuestionId}:${questionPart.partId || `${groupIndex + 1}-${partIndex + 1}`}`,
    questionGroupId: group.questionGroupId,
    questionPartId: questionPart.partId,
    label: `${group.sourceRef.question || groupIndex + 1}${questionPart.label ? `(${questionPart.label})` : ''}`,
    prompt: questionPart.promptFragment,
    marks: questionPart.marks,
    answerType: questionPart.answerArea?.type || group.answerType || 'handwritten',
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
  })))
  if (parts.some((part) => part.routeId !== subject.routeId || part.stage !== subject.stage)) {
    throw new Error('The selected source contains a question outside this learning route.')
  }
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
  const sourceMix = sourceMixForQuestions(parts)

  return {
    id: stableUnitId,
    type: 'topic',
    agentGenerated: true,
    routeId: subject.routeId,
    qualification: subject.qualification,
    subject: routeById(subject.routeId)?.subject,
    subjectId: subject.subjectId,
    qualificationId: subject.qualificationId,
    knowledgeGroupId: group.id,
    topicId: group.id,
    topic: group.name,
    subtopic: `${subject.stage} verified past-paper drill`,
    icon: appSubject?.icon || 'Q',
    title: `${subject.stage} ${routeById(subject.routeId)?.subject} · ${group.name}`,
    board: subject.label,
    code: subject.code,
    specification: `${subject.stage} · official past-paper questions`,
    inventoryStatus: parts.length < requestedCount ? 'partial-source-inventory' : 'verified-source-inventory',
    stage: subject.stage,
    paperComponent: [...new Set(parts.map((part) => part.paperComponent).filter((value) => value != null))],
    syllabusTopic: group.id,
    sourcePaper: [...new Set(parts.map((part) => part.sourcePaper).filter(Boolean))],
    durationSec: Math.max(20, parts.length * 4) * 60,
    maxMarks: parts.reduce((sum, part) => sum + part.marks, 0),
    difficulty: 'Past paper',
    estimatedMinutes: Math.max(20, parts.length * 4),
    priority: 'AI Coach set',
    provenance: {
      source: 'Question-level items from official papers, each bound to its exact mark scheme.',
      licenseStatus: 'Official exam material; personal study library',
      paperRef: [...sourcePapers.values()].map((item) => item.file).join(', '),
    },
    sourceMix,
    assignmentSourceIds: assignedSourceIds,
    questionGroupCount: bank.length,
    questionOffset: Math.max(0, Math.floor(Number(questionOffset) || 0)),
    referencePapers: [...sourcePapers.values()],
    parts,
  }
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
