function baseTopicId(value) {
  return String(value || '').trim().split('@')[0]
}

/**
 * Return the official topic memberships that may be used by a reviewed
 * question-group consumer. Secondary memberships are deliberately ignored
 * until both the source binding and the syllabus mapping are human-reviewed.
 */
export function questionTopicMembershipIds(question) {
  const mapping = question?.syllabusMapping || {}
  const primaryTopicId = baseTopicId(mapping.primaryTopicId || question?.knowledgeGroupId || question?.topicId)
  const reviewed = question?.answerBinding?.verificationStatus === 'reviewed'
    && String(mapping.reviewStatus || '').toLowerCase() === 'reviewed'
  const explicitTopicIds = reviewed && Array.isArray(mapping.topicIds)
    ? mapping.topicIds
    : []
  const secondaryTopicIds = reviewed && Array.isArray(mapping.secondaryTopicIds)
    ? mapping.secondaryTopicIds
    : []
  return [...new Set([primaryTopicId, ...explicitTopicIds, ...secondaryTopicIds]
    .map(baseTopicId)
    .filter(Boolean))]
}

export function questionBelongsToTopic(question, topicId) {
  const requestedTopicId = baseTopicId(topicId)
  return !requestedTopicId || questionTopicMembershipIds(question).includes(requestedTopicId)
}
