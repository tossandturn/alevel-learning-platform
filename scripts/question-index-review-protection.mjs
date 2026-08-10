export function isHumanReviewedIndexItem(item) {
  return item?.answerBinding?.verificationStatus === 'reviewed'
}

export function mergeIndexItemPreservingReview(existing, incoming) {
  return isHumanReviewedIndexItem(existing) ? existing : incoming
}
