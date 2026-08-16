export function isHumanReviewedIndexItem(item) {
  return item?.answerBinding?.verificationStatus === 'reviewed'
}

export function mergeIndexItemPreservingReview(existing, incoming) {
  return isHumanReviewedIndexItem(existing) ? existing : incoming
}

export function replaceMachineIndexedPaperItems(items, paperId, incomingItems) {
  const next = new Map()
  for (const item of items || []) {
    if (item?.sourceRef?.paperId === paperId && !isHumanReviewedIndexItem(item)) continue
    next.set(item.bankId || item.questionId, item)
  }
  for (const incoming of incomingItems || []) {
    const id = incoming.bankId || incoming.questionId
    next.set(id, mergeIndexItemPreservingReview(next.get(id), incoming))
  }
  return [...next.values()]
}

export function syllabusMappingForIndexItem(item, { fallbackKnowledgeGroupId, specificationId, syllabusUrl }) {
  const existing = item?.syllabusMapping || {}
  if (isHumanReviewedIndexItem(item)) {
    return {
      ...existing,
      specificationId,
      syllabusUrl: existing.syllabusUrl || syllabusUrl || null,
      knowledgeGroupId: item.knowledgeGroupId || existing.knowledgeGroupId || fallbackKnowledgeGroupId,
      mappingStatus: existing.mappingStatus || 'reviewed',
    }
  }
  return {
    ...existing,
    specificationId,
    syllabusUrl: syllabusUrl || null,
    knowledgeGroupId: fallbackKnowledgeGroupId,
    mappingStatus: 'machine-indexed',
  }
}

export function knowledgeGroupForIndexItem(item, fallbackKnowledgeGroupId) {
  return isHumanReviewedIndexItem(item) && item.knowledgeGroupId
    ? item.knowledgeGroupId
    : fallbackKnowledgeGroupId
}

export function minimumQuestionGroupsForImport(paper) {
  const explicit = Number(paper?.examProfile?.defaultQuestionCount)
  if (Number.isInteger(explicit) && explicit > 0) return explicit
  if (paper?.subject === '9702' && Number(paper?.examProfile?.paperNumber) === 2) return 7
  return 1
}

function questionNumber(item) {
  const match = String(item?.sourceRef?.question || item?.questionId || item?.bankId || '').match(/(?:^|:)q(\d+)$/i)
  return match ? Number(match[1]) : null
}

export function hasCompleteQuestionNumberSequence(items, expectedCount) {
  const count = Number(expectedCount)
  if (!Number.isInteger(count) || count < 1) return false
  const numbers = new Set((items || []).map(questionNumber).filter(Number.isInteger))
  if (numbers.size !== count) return false
  for (let number = 1; number <= count; number += 1) if (!numbers.has(number)) return false
  return true
}

export function isReplacementImportComplete({ existingCount = 0, incomingCount = 0, expectedCount = 1 }) {
  return Number(incomingCount) >= Number(expectedCount) && Number(incomingCount) >= Number(existingCount)
}
