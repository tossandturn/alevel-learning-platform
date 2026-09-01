export const MIN_QUESTION_GROUPS_PER_TEST = 6
export const MIN_TESTS_PER_TOPIC = 2
export const MIN_VERIFIED_GROUPS_FOR_PRACTICE = MIN_QUESTION_GROUPS_PER_TEST * MIN_TESTS_PER_TOPIC
export const TOPIC_PRACTICE_SET_SIZES = Object.freeze([MIN_QUESTION_GROUPS_PER_TEST, 10, 15])

function nonNegativeInteger(value) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : 0
}

export function topicPracticeEligibility({ verifiedQuestionCount, availableQuestionCount } = {}) {
  const verified = nonNegativeInteger(verifiedQuestionCount)
  const available = nonNegativeInteger(availableQuestionCount)
  const ready = verified >= MIN_VERIFIED_GROUPS_FOR_PRACTICE
  const hasStudyOnlyInventory = available > verified
  const studyReady = !ready
    && hasStudyOnlyInventory
    && available >= MIN_QUESTION_GROUPS_PER_TEST
  const startable = ready || studyReady

  return Object.freeze({
    ready,
    studyReady,
    ctaPolicy: ready ? 'start' : studyReady ? 'start-study' : 'hidden',
    availableSetSizes: Object.freeze(startable
      ? TOPIC_PRACTICE_SET_SIZES.filter((size) => size <= available)
      : []),
  })
}

/**
 * Formal Topic Drill progress is scoped to every selected official topic, not
 * the aggregate of their reviewed source groups.
 */
export function selectedTopicPracticeEligibility({
  topicIds = [],
  verifiedQuestionCountByTopic = {},
  availableQuestionCountByTopic = {},
} = {}) {
  const selectedTopicIds = [...new Set((Array.isArray(topicIds) ? topicIds : [topicIds])
    .map((topicId) => String(topicId || '').trim())
    .filter(Boolean))]
  const byTopic = Object.fromEntries(selectedTopicIds.map((topicId) => [topicId, topicPracticeEligibility({
    verifiedQuestionCount: verifiedQuestionCountByTopic?.[topicId],
    availableQuestionCount: availableQuestionCountByTopic?.[topicId],
  })]))
  return Object.freeze({
    topicIds: Object.freeze(selectedTopicIds),
    byTopic: Object.freeze(byTopic),
    ready: selectedTopicIds.length > 0 && selectedTopicIds.every((topicId) => byTopic[topicId].ready),
  })
}

export function practiceCatalogSlices(totalCount, preferredSize = 10, { includeBelowFloor = false } = {}) {
  const total = nonNegativeInteger(totalCount)
  if (total < MIN_QUESTION_GROUPS_PER_TEST) {
    return includeBelowFloor && total > 0
      ? Object.freeze([Object.freeze({ offset: 0, count: total, startable: false })])
      : Object.freeze([])
  }
  const preferred = Math.min(15, Math.max(
    MIN_QUESTION_GROUPS_PER_TEST,
    nonNegativeInteger(preferredSize) || 10,
  ))
  const slices = []
  let offset = 0
  while (offset < total) {
    const remaining = total - offset
    let count = remaining <= 15 ? remaining : preferred
    const tail = remaining - count
    if (tail > 0 && tail < MIN_QUESTION_GROUPS_PER_TEST) {
      count -= MIN_QUESTION_GROUPS_PER_TEST - tail
    }
    if (count < MIN_QUESTION_GROUPS_PER_TEST) return Object.freeze([])
    slices.push(Object.freeze({ offset, count, startable: true }))
    offset += count
  }
  return Object.freeze(slices)
}

function sourceQuestionGroupCount(unit) {
  const identities = new Set((unit?.parts || [])
    .map((part) => part?.sourceQuestionId || part?.questionGroupId || part?.bankId)
    .filter(Boolean))
  if (identities.size) return identities.size
  return nonNegativeInteger(unit?.questionGroupCount)
}

export function isStartableTopicPracticeUnit(unit, { allowFocusedRetest = false } = {}) {
  const sourceBacked = unit?.sourceAuthority === 'server-syllabus'
    || (unit?.parts || []).some((part) => part?.sourceKind === 'past-paper')
  if (unit?.type !== 'topic' || !sourceBacked) return true
  if (unit?.startable === false) return false
  const questionGroupCount = sourceQuestionGroupCount(unit)
  if (questionGroupCount >= MIN_QUESTION_GROUPS_PER_TEST) return true
  return Boolean(
    allowFocusedRetest
    && questionGroupCount === 1
    && unit?.focusedRetestOf
    && unit?.focusedRetestValidated === true,
  )
}
