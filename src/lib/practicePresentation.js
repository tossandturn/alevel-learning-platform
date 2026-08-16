import { getExamPaperProfile } from '../data/examStructure.js'

function positiveNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

function partComponent(part, unit) {
  const direct = Number(part?.paperComponent ?? part?.sourceRef?.component)
  if (Number.isFinite(direct) && direct > 0) return direct
  const components = Array.isArray(unit?.paperComponent) ? unit.paperComponent : [unit?.paperComponent]
  const onlyComponent = components.map(Number).filter((value) => Number.isFinite(value) && value > 0)
  return onlyComponent.length === 1 ? onlyComponent[0] : null
}

export function practiceUnitMetrics(unit = {}) {
  const parts = Array.isArray(unit.parts) ? unit.parts : []
  const sourceQuestionIds = new Set(parts
    .map((part) => part?.sourceQuestionId || part?.questionGroupId || part?.bankId)
    .filter(Boolean))
  const paperIds = new Set([
    ...(Array.isArray(unit.referencePapers) ? unit.referencePapers : []).map((paper) => paper?.id || paper?.file),
    ...parts.map((part) => part?.sourceRef?.paperId || part?.sourceRef?.paper || part?.sourcePaper),
  ].filter(Boolean))
  const summedMarks = parts.reduce((sum, part) => sum + positiveNumber(part?.marks), 0)
  const declaredQuestionCount = Number(unit.sourceQuestionCount ?? unit.questionGroupCount)
  const markingCounts = parts.reduce((counts, part) => {
    const mode = markingStatusForPart(part).mode
    if (mode === 'auto-scored') counts.autoScoredPartCount += 1
    else if (mode === 'semantic-reviewed') counts.semanticReviewedPartCount += 1
    else counts.selfMarkPartCount += 1
    return counts
  }, {
    autoScoredPartCount: 0,
    selfMarkPartCount: 0,
    semanticReviewedPartCount: 0,
  })
  const totalMarks = summedMarks || positiveNumber(unit.totalMarks ?? unit.markTotal ?? unit.maxMarks)

  return {
    sourceQuestionCount: sourceQuestionIds.size || (Number.isInteger(declaredQuestionCount) && declaredQuestionCount > 0 ? declaredQuestionCount : parts.length),
    answerPartCount: parts.length,
    paperCount: paperIds.size,
    totalMarks,
    ...markingCounts,
  }
}

export function practiceMetricsSummary(unit = {}) {
  const metrics = practiceUnitMetrics(unit)
  const questionLabel = metrics.sourceQuestionCount === 1 ? 'official question' : 'official questions'
  const partLabel = metrics.answerPartCount === 1 ? 'answer part' : 'answer parts'
  const markLabel = metrics.totalMarks === 1 ? 'mark' : 'marks'
  return `${metrics.sourceQuestionCount} ${questionLabel} · ${metrics.answerPartCount} ${partLabel} · ${metrics.totalMarks} ${markLabel}`
}

export function recommendedPracticeMinutes(unit = {}) {
  const parts = Array.isArray(unit.parts) ? unit.parts : []
  if (!parts.length) return Math.max(5, Math.ceil(positiveNumber(unit.estimatedMinutes) || 5))

  const subjectCode = String(unit.subjectCode || unit.code || '').match(/\d{4}|amc12|tmua|esat|bpho/i)?.[0]?.toLowerCase() || ''
  const marksByComponent = new Map()
  let unprofiledMarks = 0
  for (const part of parts) {
    const marks = positiveNumber(part?.marks)
    const component = partComponent(part, unit)
    if (!marks || !component) {
      unprofiledMarks += marks
      continue
    }
    marksByComponent.set(component, (marksByComponent.get(component) || 0) + marks)
  }

  let minutes = 0
  for (const [component, marks] of marksByComponent) {
    const profile = getExamPaperProfile(subjectCode, String(component))
    const duration = positiveNumber(profile?.durationMinutes)
    const maxMarks = positiveNumber(profile?.maxMarks)
    if (duration && maxMarks) minutes += marks * duration / maxMarks
    else unprofiledMarks += marks
  }

  if (unprofiledMarks) minutes += unprofiledMarks * 1.5
  if (!minutes) minutes = positiveNumber(unit.estimatedMinutes) || parts.length * 4
  return Math.max(5, Math.ceil(minutes))
}

export function withPracticePresentation(unit = {}) {
  const metrics = practiceUnitMetrics(unit)
  const estimatedMinutes = recommendedPracticeMinutes({ ...unit, ...metrics })
  return {
    ...unit,
    ...metrics,
    questionGroupCount: metrics.sourceQuestionCount,
    maxMarks: metrics.totalMarks,
    estimatedMinutes,
    durationSec: estimatedMinutes * 60,
  }
}

export function markingStatusForPart(part = {}) {
  const reviewed = part.reviewStatus === 'reviewed' && part.studyOnly !== true
  if (part.deterministicScoringAvailable || part.answerKey) {
    return {
      mode: 'auto-scored',
      label: 'Auto-scored',
      detail: reviewed
        ? 'Your selected option is checked against the reviewed answer key after submission.'
        : 'Your selected option can be checked, but this result stays outside formal mastery until source review is complete.',
      formalMasteryEligible: reviewed,
    }
  }
  if (part.aiAssistedMarkingAvailable && reviewed) {
    return {
      mode: 'semantic-reviewed',
      label: 'Semantic-reviewed',
      detail: 'AI reviews the submitted evidence first. You can then compare it with the reviewed mark scheme before the result enters mastery.',
      formalMasteryEligible: true,
    }
  }
  return {
    mode: 'self-mark',
    label: 'Self-mark',
    detail: 'Use the paired mark scheme after submission. This practice stays outside formal mastery until source review is complete.',
    formalMasteryEligible: false,
  }
}

export function topicDisplayNames(topicIds = [], topics = []) {
  const topicById = new Map((Array.isArray(topics) ? topics : []).map((topic) => [topic.id, topic]))
  const names = [...new Set((Array.isArray(topicIds) ? topicIds : [])
    .map((topicId) => {
      const topic = topicById.get(topicId)
      return String(topic?.name || topic?.label || '').replace(/^\d+(?:\.\d+)?\s+/, '').trim()
    })
    .filter(Boolean))]
  return names.length ? names : ['Selected syllabus topic']
}
