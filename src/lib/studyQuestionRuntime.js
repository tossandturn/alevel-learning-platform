import { stableSorted } from './arrayOrder.js'
import { requestStudyQuestionGroups } from './verifiedPracticeClient.js'

const fragmentCache = new Map()

function sortQuestions(left, right) {
  return (
    (Number(right.sourceRef?.year) || 0) - (Number(left.sourceRef?.year) || 0)
    || String(left.sourceRef?.paper).localeCompare(String(right.sourceRef?.paper))
    || String(left.sourceRef?.question).localeCompare(String(right.sourceRef?.question), undefined, { numeric: true })
  )
}

function isStudyOnlyCandidate(question) {
  return Boolean(
    question?.sourceKind === 'past-paper'
    && question?.answerBinding?.verificationStatus === 'machine-indexed'
    && question?.questionGroupId
    && question?.questionGroupStatus !== 'quarantined'
    && question?.sourceContent?.fileComplete === true
    && question?.sourceContent?.semanticStatus === 'unreviewed',
  )
}

export function studyQuestionGroupsForRoute(questions = [], verifiedGroups = []) {
  const verifiedIds = new Set(verifiedGroups.map((question) => question.sourceQuestionId).filter(Boolean))
  return stableSorted(Array.isArray(questions) ? questions : [], sortQuestions)
    .map((question) => ({
      ...question,
      studyOnly: isStudyOnlyCandidate(question) && !verifiedIds.has(question.sourceQuestionId),
    }))
}

export function loadStudyQuestionGroupsForRoute(routeId, verifiedGroups = [], { fetchImpl = fetch, token = '', accessKey = 'guest', now = Date.now, cacheTtlMs = 30_000 } = {}) {
  const normalizedRouteId = String(routeId || '').trim()
  if (!normalizedRouteId) return Promise.resolve([])
  const cacheKey = `${String(accessKey || 'guest')}\n${normalizedRouteId}`
  const ttl = Math.min(60_000, Math.max(0, Number(cacheTtlMs) || 0))
  let entry = fragmentCache.get(cacheKey)
  if (entry && now() - entry.at > ttl) {
    fragmentCache.delete(cacheKey)
    entry = null
  }
  if (!entry) {
    const request = requestStudyQuestionGroups({ routeId: normalizedRouteId, token, fetchImpl })
      .catch((error) => {
        if (fragmentCache.get(cacheKey)?.promise === request) fragmentCache.delete(cacheKey)
        throw error
      })
    entry = { at: now(), promise: request }
    fragmentCache.set(cacheKey, entry)
  }
  return entry.promise.then((questions) => studyQuestionGroupsForRoute(questions, verifiedGroups))
}
