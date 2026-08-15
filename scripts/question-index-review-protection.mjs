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
