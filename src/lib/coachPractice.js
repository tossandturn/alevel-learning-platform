import { subjects } from '../data/catalog.js'
import { learningPlan } from '../data/learningPlan.js'
import { questionInventory, selectTaggedQuestions, sourceMixForQuestions } from '../data/questionBank.js'

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

export const coachPracticeSubjects = Object.freeze([
  coachSubject('biology', 'cambridge-9700', '9700', '9700 Biology', 'biology-9700', ['AS', 'A2']),
  coachSubject('igcse-biology', 'cambridge-0610', '0610', '0610 IGCSE Biology', 'biology-0610', ['IGCSE']),
  coachSubject('physics', 'cambridge-9702', '9702', '9702 Physics', 'physics-9702', ['AS', 'A2']),
  coachSubject('chemistry', 'cambridge-9701', '9701', '9701 Chemistry', 'chemistry-9701', ['AS', 'A2']),
  coachSubject('economics', 'cambridge-9708', '9708', '9708 Economics', 'economics-9708', ['AS', 'A2']),
  coachSubject('math', 'cambridge-9709', '9709', '9709 Mathematics', 'math-9709', ['AS', 'A2']),
  coachSubject('further-math', 'cambridge-9231', '9231', '9231 Further Mathematics', 'math-9231', ['AS', 'A2']),
  coachSubject('igcse-physics', 'cambridge-0625', '0625', '0625 IGCSE Physics', 'physics-0625', ['IGCSE']),
  coachSubject('igcse-math', 'cambridge-0580', '0580', '0580 IGCSE Mathematics', 'math-0580', ['IGCSE']),
  coachSubject('additional-math', 'cambridge-0606', '0606', '0606 Additional Mathematics', 'math-0606', ['IGCSE']),
  coachSubject('bpho', 'bpho', 'bpho', 'BPhO', null, ['Physics Challenge', 'SPC', 'Round 1', 'Round 2']),
  coachSubject('esat', 'esat', 'esat', 'ESAT', null, ['Mathematics 1', 'Mathematics 2', 'Physics', 'Chemistry', 'Biology']),
  coachSubject('tmua', 'tmua', 'tmua', 'TMUA', null, ['Paper 1', 'Paper 2']),
  coachSubject('amc12', 'amc12', 'amc12', 'AMC 12', null, ['AMC 12']),
])

function coachSubject(id, qualificationId, code, label, planSubjectId, stages) {
  return Object.freeze({ id, qualificationId, code, label, planSubjectId, stages })
}

function planGroupsFor(subject) {
  if (!subject) return []
  if (!subject.planSubjectId) return EXTERNAL_GROUPS[subject.id] || []
  const planSubject = learningPlan.subjects.find((item) => item.id === subject.planSubjectId)
  return (planSubject?.knowledgeGroupIds || [])
    .map((groupId) => learningPlan.knowledgeGroups.find((group) => group.id === groupId))
    .filter(Boolean)
}

export function coachPracticeOptions() {
  return coachPracticeSubjects.map((subject) => ({
    ...subject,
    topics: planGroupsFor(subject).map((group) => ({
      id: group.id,
      label: group.name,
      stageTags: group.stageTags || [],
      inventory: questionInventory({ qualificationId: subject.qualificationId, knowledgeGroupId: group.id }),
      inventoryByStage: Object.fromEntries(subject.stages.map((stage) => [
        stage,
        questionInventory({ qualificationId: subject.qualificationId, stage, knowledgeGroupId: group.id }),
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

function resolveSelection(subjectId, knowledgeGroupId) {
  const subject = coachPracticeSubjects.find((item) => item.id === subjectId) || coachPracticeSubjects[0]
  const groups = planGroupsFor(subject)
  const group = groups.find((item) => item.id === knowledgeGroupId) || groups[0]
  return { subject, group }
}

export function previewCoachPracticeSourceMix({ subjectId, stage, knowledgeGroupId, questionCount = 10 }) {
  const { subject, group } = resolveSelection(subjectId, knowledgeGroupId)
  const requestedCount = Math.min(30, Math.max(10, Number(questionCount) || 10))
  const available = group ? questionInventory({ qualificationId: subject.qualificationId, stage, knowledgeGroupId: group.id }) : 0
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

export function buildCoachPractice({ subjectId, stage, knowledgeGroupId, questionCount = 10, allowPartial = false }) {
  const { subject, group } = resolveSelection(subjectId, knowledgeGroupId)
  const requestedCount = Math.min(30, Math.max(10, Number(questionCount) || 10))
  if (!group) throw new PracticeInventoryError({ subject, stage, group: { name: 'selected topic' }, available: 0, requested: requestedCount })
  const bank = selectTaggedQuestions({
    qualificationId: subject.qualificationId,
    subjectId: subject.id,
    stage,
    knowledgeGroupId: group.id,
    questionCount: requestedCount,
  })
  if (!bank.length) {
    throw new PracticeInventoryError({ subject, stage, group, available: bank.length, requested: requestedCount })
  }
  if (bank.length < requestedCount && !allowPartial) {
    throw new PracticeInventoryError({ subject, stage, group, available: bank.length, requested: requestedCount })
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
  const appSubject = subjects.find((item) => item.id === subject.id)
  const sourceMix = sourceMixForQuestions(parts)

  return {
    id: `verified-set-${generatedAt}`,
    type: 'topic',
    agentGenerated: true,
    subjectId: subject.id,
    qualificationId: subject.qualificationId,
    knowledgeGroupId: group.id,
    topicId: group.id,
    topic: group.name,
    subtopic: `${stage} verified past-paper drill`,
    icon: appSubject?.icon || 'Q',
    title: `${subject.label}: ${group.name}`,
    board: subject.label,
    code: subject.code,
    specification: `${stage} · official past-paper questions`,
    inventoryStatus: parts.length < requestedCount ? 'partial-source-inventory' : 'verified-source-inventory',
    stage,
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
