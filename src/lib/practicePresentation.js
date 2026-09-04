import { getExamPaperProfile } from '../data/examStructure.js'

function positiveNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

export function responsePresent(value) {
  if (value == null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.values(value).some(responsePresent)
  return Boolean(value)
}

export function evidencePresent(value) {
  if (typeof value === 'string') return value.trim().length > 0
  if (!value || typeof value !== 'object') return false
  if (value.hasVisualContent === false) return false
  return Boolean(value.dataUrl || value.previewUrl || value.blobUrl || value.url || value.bytes)
}

function partResponsePresent(attempt, part) {
  const partId = part?.id
  if (!partId) return false
  return responsePresent(attempt?.answers?.[partId])
    || responsePresent(attempt?.working?.[partId])
    || evidencePresent(attempt?.evidence?.[partId])
    || (Array.isArray(attempt?.imageEvidence) && attempt.imageEvidence.some((item) => item?.partId === partId && evidencePresent(item)))
}

function sourceQuestionKey(part) {
  return String(part?.sourceQuestionId || part?.questionGroupId || part?.bankId || part?.sourceRef?.question || part?.id || '')
}

function compactSourcePaperLabel(sourceRef = {}) {
  const file = String(sourceRef.paper || sourceRef.paperId || '').replace(/\.[^.]+$/, '').replace(/^cie-\d{4}-/i, '')
  const match = file.match(/(?:^|[_-])([msw])(\d{2})[_-]qp[_-]?(\d{1,2})(?:$|[_-])/i)
  return match ? `${match[1].toUpperCase()}${match[2]}/${match[3]}` : file
}

export function sourceQuestionDisplayLabel(part = {}, fallback = 'Question') {
  const explicit = String(part.displayLabel || '').trim()
  const paper = compactSourcePaperLabel(part.sourceRef)
  if (explicit && (!paper || explicit.includes(`${paper} ·`))) return explicit
  const question = String(part.sourceRef?.question || part.label || explicit || fallback).trim()
  return paper ? `${paper} · ${question}` : question
}

export function practiceAttemptMetrics(attempt = {}, unit = {}) {
  const metrics = practiceUnitMetrics(unit)
  const parts = Array.isArray(unit.parts) ? unit.parts : []
  const groups = new Map()
  for (const part of parts) {
    const key = sourceQuestionKey(part)
    const group = groups.get(key)
    if (group) group.push(part)
    else groups.set(key, [part])
  }
  const answeredPartCount = parts.filter((part) => partResponsePresent(attempt, part)).length
  const answeredQuestionCount = [...groups.values()].filter((group) => group.every((part) => partResponsePresent(attempt, part))).length
  return {
    ...metrics,
    answeredPartCount,
    unansweredAnswerPartCount: Math.max(0, metrics.answerPartCount - answeredPartCount),
    answeredQuestionCount,
    unansweredSourceQuestionCount: Math.max(0, groups.size - answeredQuestionCount),
  }
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
  const aiStudy = part.reviewStatus === 'machine-indexed' && part.studyOnly === true && part.aiAssistedMarkingAvailable
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
  if (part.aiAssistedMarkingAvailable && (reviewed || aiStudy)) {
    return {
      mode: aiStudy ? 'ai-study-marked' : 'semantic-reviewed',
      label: aiStudy ? 'AI auto-marked' : 'Semantic-reviewed',
      detail: aiStudy
        ? 'AI marks the submitted response against the checksum-bound question paper and mark scheme. The result is saved as study evidence outside formal mastery.'
        : 'AI reviews the submitted evidence first. You can then compare it with the reviewed mark scheme before the result enters mastery.',
      formalMasteryEligible: reviewed,
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

function nonNegativeInteger(value) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : 0
}

/**
 * Project the server syllabus inventory for the components selected in a
 * builder. The UI must not use availableQuestionCount as a synonym for
 * formally reviewed questions because source-backed study items are included.
 */
export function topicPracticeInventory(topic = {}, components = []) {
  const componentCounts = topic?.componentCounts && typeof topic.componentCounts === 'object'
    ? topic.componentCounts
    : null
  const selectedComponents = [...new Set((Array.isArray(components) ? components : [components])
    .map((component) => String(component))
    .filter(Boolean))]
  const hasComponentInventory = Boolean(componentCounts && selectedComponents.length)
  const rows = hasComponentInventory
    ? selectedComponents.map((component) => componentCounts[component] || {})
    : [topic]
  const sum = (field) => rows.reduce((total, row) => total + nonNegativeInteger(row?.[field]), 0)
  const directAvailable = nonNegativeInteger(topic.availableQuestionCount ?? topic.inventory)
  const directVerified = nonNegativeInteger(topic.verifiedQuestionCount)
  const directStudyOnly = nonNegativeInteger(topic.studyQuestionCount)
  const availableQuestionCount = hasComponentInventory ? sum('availableQuestionCount') : directAvailable
  const verifiedQuestionCount = hasComponentInventory ? sum('verifiedQuestionCount') : directVerified
  const studyQuestionCount = hasComponentInventory ? sum('studyQuestionCount') : directStudyOnly

  return {
    verifiedQuestionCount,
    studyQuestionCount,
    availableQuestionCount: availableQuestionCount || verifiedQuestionCount + studyQuestionCount,
    indexedQuestionCount: nonNegativeInteger(topic.indexedQuestionCount),
    pendingReviewCount: nonNegativeInteger(topic.pendingReviewCount),
  }
}

function questionIdsForComponent(topic, component) {
  const rows = topic?.questionIdsByComponent
  if (!rows || typeof rows !== 'object') return null
  const row = rows[String(component)] || rows[component]
  if (!row || typeof row !== 'object') return null
  const ids = (field) => Array.isArray(row[field])
    ? row[field].map((value) => String(value || '').trim()).filter(Boolean)
    : null
  const indexedQuestionIds = ids('indexedQuestionIds')
  const verifiedQuestionIds = ids('verifiedQuestionIds')
  const studyQuestionIds = ids('studyQuestionIds')
  const pendingReviewQuestionIds = ids('pendingReviewQuestionIds')
  if (!indexedQuestionIds || !verifiedQuestionIds || !studyQuestionIds || !pendingReviewQuestionIds) return null
  return { indexedQuestionIds, verifiedQuestionIds, studyQuestionIds, pendingReviewQuestionIds }
}

/**
 * Keep a Topic Detail question list on the same canonical server-authorized
 * identity set as inventory and server-side practice-set creation. Production
 * inventory intentionally omits study-only IDs; an explicit non-production
 * review inventory may include them. A missing identity row is fail-closed.
 */
export function filterQuestionGroupsByPracticeInventory(questionGroups = [], topics = [], components = []) {
  const selectedTopics = Array.isArray(topics) ? topics : [topics]
  const selectedComponents = [...new Set((Array.isArray(components) ? components : [components])
    .map((component) => Number(component))
    .filter((component) => Number.isInteger(component) && component > 0))]
  if (!selectedTopics.length || !selectedComponents.length) return []

  const practiceQuestionIds = new Set()
  for (const topic of selectedTopics) {
    for (const component of selectedComponents) {
      const row = questionIdsForComponent(topic, component)
      if (!row) return []
      row.verifiedQuestionIds.forEach((questionId) => practiceQuestionIds.add(questionId))
      row.studyQuestionIds.forEach((questionId) => practiceQuestionIds.add(questionId))
    }
  }

  return (Array.isArray(questionGroups) ? questionGroups : []).filter((question) => {
    const sourceQuestionId = String(question?.sourceQuestionId || question?.id || question?.questionGroupId || '').trim()
    const component = Number(question?.paperComponent ?? question?.sourceRef?.component)
    return practiceQuestionIds.has(sourceQuestionId) && selectedComponents.includes(component)
  })
}

/**
 * Aggregate selected syllabus topics by stable question identity. A question
 * may be mapped to more than one topic, so adding per-topic counts would
 * overstate the set size before the server builds the actual practice set.
 */
export function aggregateTopicPracticeInventory(topics = [], components = []) {
  const selectedTopics = Array.isArray(topics) ? topics : []
  const selectedComponents = [...new Set((Array.isArray(components) ? components : [components])
    .map((component) => Number(component))
    .filter((component) => Number.isInteger(component) && component > 0))]
  const identityRows = selectedTopics.flatMap((topic) => selectedComponents.map((component) => questionIdsForComponent(topic, component)))
  const canDeduplicate = selectedTopics.length > 0
    && selectedComponents.length > 0
    && identityRows.length === selectedTopics.length * selectedComponents.length
    && identityRows.every(Boolean)

  if (!canDeduplicate) {
    return selectedTopics.reduce((summary, topic) => {
      const inventory = topicPracticeInventory(topic, selectedComponents)
      return {
        verifiedQuestionCount: summary.verifiedQuestionCount + inventory.verifiedQuestionCount,
        studyQuestionCount: summary.studyQuestionCount + inventory.studyQuestionCount,
        availableQuestionCount: summary.availableQuestionCount + inventory.availableQuestionCount,
        indexedQuestionCount: summary.indexedQuestionCount + inventory.indexedQuestionCount,
        pendingReviewCount: summary.pendingReviewCount + inventory.pendingReviewCount,
      }
    }, {
      verifiedQuestionCount: 0,
      studyQuestionCount: 0,
      availableQuestionCount: 0,
      indexedQuestionCount: 0,
      pendingReviewCount: 0,
    })
  }

  const ids = {
    indexedQuestionIds: new Set(),
    verifiedQuestionIds: new Set(),
    studyQuestionIds: new Set(),
    pendingReviewQuestionIds: new Set(),
  }
  identityRows.forEach((row) => {
    Object.entries(ids).forEach(([field, target]) => row[field].forEach((id) => target.add(id)))
  })
  return {
    verifiedQuestionCount: ids.verifiedQuestionIds.size,
    studyQuestionCount: ids.studyQuestionIds.size,
    availableQuestionCount: new Set([...ids.verifiedQuestionIds, ...ids.studyQuestionIds]).size,
    indexedQuestionCount: ids.indexedQuestionIds.size,
    pendingReviewCount: ids.pendingReviewQuestionIds.size,
  }
}
