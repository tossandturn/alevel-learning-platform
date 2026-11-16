const CHAPTER_SIZES = Object.freeze([1, 3, 5, 10, 15])
const SHA256 = /^[a-f0-9]{64}$/i

export function chapterStudySizes(value) {
  const count = Number(value)
  if (!Number.isSafeInteger(count) || count <= 0) return []
  return [...new Set(CHAPTER_SIZES.map((size) => Math.min(size, count)).filter(Boolean))]
}

function validAvailability(value) {
  return Boolean(value && value.mode === 'chapter-study'
    && Number.isSafeInteger(value.available) && value.available >= 0
    && Number.isSafeInteger(value.officialAvailable) && value.officialAvailable >= 0
    && Number.isSafeInteger(value.originalAvailable) && value.originalAvailable >= 0
    && value.available === value.officialAvailable + value.originalAvailable
    && value.startable === (value.available > 0))
}

export function officialChapterCount(topic, components, allComponents) {
  if (!Array.isArray(components) || !components.length || !Array.isArray(allComponents) || !allComponents.length
    || components.some((component) => !allComponents.includes(component)) || new Set(components).size !== components.length) return 0
  const allSelected = components.length === allComponents.length && allComponents.every((component) => components.includes(component))
  const availability = allSelected ? topic?.chapterStudy
    : components.length === 1 ? topic?.componentCounts?.[components[0]]?.chapterStudy : null
  return validAvailability(availability) ? availability.officialAvailable : 0
}

export function hasChapterStudyPolicy(inventory) {
  const policy = inventory?.practicePolicy?.chapterStudy
  return Boolean(inventory?.chapterStudy?.mode === 'chapter-study' && policy?.mode === 'chapter-study'
    && policy.minSourceGroups === 1 && policy.maxSourceGroups === 15 && policy.countPolicy === 'cap-to-available'
    && policy.formalProgressEligible === false && Array.isArray(policy.sourcePreferences)
    && policy.sourcePreferences.includes('official-first'))
}

export function validateOfficialChapterSet(value, routeId) {
  if (!value || value.routeId !== routeId || value.studyMode !== 'chapter-study' || value.sourcePreference !== 'official-first'
    || value.practiceMode !== 'study-only' || value.formalProgressEligible !== false
    || !Array.isArray(value.questionGroups) || value.questionGroups.length < 1 || value.questionGroups.length > 15
    || value.sourceMix?.official !== value.questionGroups.length || value.sourceMix?.originalFoundation !== 0) return false
  const ids = new Set()
  return value.questionGroups.every((group) => {
    const paper = String(group?.sourceRef?.paper || ''), answer = String(group?.answerRef?.file || '')
    const id = String(group?.id || '')
    if (!id || ids.has(id)) return false
    ids.add(id)
    const common = group.studentStudyEligible === true && group.formalProgressEligible === false
      && group.sourceContent?.complete === true && group.sourceContent?.fileComplete === true
      && /^\d{4}_[msw]\d{2}_qp_\d{2}\.pdf$/i.test(paper)
      && SHA256.test(String(group.sourceRef?.sha256 || ''))
    if (!common) return false
    if (group.answerFormat !== 'single-choice') return answer === paper.replace(/_qp_/i, '_ms_')
      && SHA256.test(String(group.answerRef?.sha256 || ''))
    const part = Array.isArray(group.parts) && group.parts.length === 1 ? group.parts[0] : null
    const binding = part?.sourceBindingProvenance
    return JSON.stringify(group.choiceLabels) === JSON.stringify(['A', 'B', 'C', 'D'])
      && part?.answerFormat === 'single-choice' && !Object.hasOwn(part, 'answerKey')
      && !Object.hasOwn(group, 'correctOption') && binding?.sourceQuestionId === id
      && binding?.questionPartId === part.partId && binding?.sourceDocumentSha256 === group.sourceRef.sha256
      && SHA256.test(String(binding?.answerDocumentSha256 || ''))
  })
}

export function validateServerObjectiveResult(value, expected) {
  if (!value || value.schemaVersion !== 'stem-objective-result-v1' || value.mode !== 'topic' || value.available !== true
    || value.formalProgressEligible === true || value.maxScore !== 1 || ![0, 1].includes(value.score)
    || !['ai-checked-official-key', 'reviewed-official-key'].includes(value.sourceStatus)
    || !/^[A-D]$/.test(String(value.correctOption || '')) || !/^[A-D]$/.test(String(expected?.selectedOption || ''))) return false
  for (const field of ['attemptId', 'routeId', 'stage', 'paperId', 'sourceQuestionId', 'questionPartId', 'selectedOption']) {
    if (!expected[field] || value[field] !== expected[field]) return false
  }
  return value.score === (value.selectedOption === value.correctOption ? 1 : 0)
}

export function objectiveAnswerSnapshot(unit, answers = {}) {
  const result = { ...answers }
  const seen = new Set()
  for (const part of unit?.parts || []) {
    if (part?.serverDeterministicScoringAvailable !== true || part?.answerFormat !== 'single-choice') continue
    const sourceQuestionId = String(part.sourceQuestionId || '')
    const selected = typeof answers[part.id] === 'string' ? answers[part.id].trim().toUpperCase() : ''
    if (!sourceQuestionId || seen.has(sourceQuestionId)) throw new Error('The objective question binding is ambiguous.')
    seen.add(sourceQuestionId)
    if (/^[A-D]$/.test(selected)) result[sourceQuestionId] = selected
  }
  return result
}
