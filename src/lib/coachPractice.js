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

export function buildCoachPractice({ routeId, subjectId, stage, knowledgeGroupId, questionCount = 10, allowPartial = false }) {
  const { subject, group } = resolveSelection({ routeId, subjectId, stage, knowledgeGroupId })
  const requestedCount = Math.min(30, Math.max(10, Number(questionCount) || 10))
  if (!group) throw new PracticeInventoryError({ subject, stage: subject.stage, group: { name: 'selected topic' }, available: 0, requested: requestedCount })
  const bank = selectTaggedQuestions({
    routeId: subject.routeId,
    qualificationId: subject.qualificationId,
    subjectId: subject.subjectId,
    stage: subject.stage,
    knowledgeGroupId: group.id,
    questionCount: requestedCount,
  })
  if (!bank.length) {
    throw new PracticeInventoryError({ subject, stage: subject.stage, group, available: bank.length, requested: requestedCount })
  }
  if (bank.length < requestedCount && !allowPartial) {
    throw new PracticeInventoryError({ subject, stage: subject.stage, group, available: bank.length, requested: requestedCount })
  }

  const generatedAt = Date.now()
  const parts = bank.map((part, index) => ({
    ...part,
    id: `set-${generatedAt}-${index + 1}`,
    label: String(index + 1),
    sourceKind: 'past-paper',
    sourceLabel: `${part.sourceRef.paper} · ${part.sourceRef.question}`,
    sourceDescription: `Official question paper, page ${part.sourceRef.pageStart}. The exact paired mark scheme unlocks after submission.`,
  }))
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
    id: `verified-set-${generatedAt}`,
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
    referencePapers: [...sourcePapers.values()],
    parts,
  }
}
