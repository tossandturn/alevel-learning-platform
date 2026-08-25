import { SOURCE_INDEX_SHA256 } from '../data/sourceContentIdentity.js'
import { stableSorted } from './arrayOrder.js'

const fragmentPromises = new Map()

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

export function loadStudyQuestionGroupsForRoute(routeId, verifiedGroups = [], fetchImpl = fetch) {
  const normalizedRouteId = String(routeId || '').trim()
  if (!normalizedRouteId) return Promise.resolve([])
  if (!fragmentPromises.has(normalizedRouteId)) {
    const fragmentUrl = `/data/study-question-index/${encodeURIComponent(normalizedRouteId)}.json?source=${SOURCE_INDEX_SHA256}`
    const request = Promise.resolve(fetchImpl(fragmentUrl, { credentials: 'same-origin' }))
      .then(async (response) => {
        if (!response?.ok) throw new Error(`Source question fragment unavailable (${response?.status || 'request failed'}).`)
        const fragment = await response.json()
        if (
          fragment?.schemaVersion !== 'study-question-fragment-v1'
          || fragment.routeId !== normalizedRouteId
          || fragment.sourceIndexSha256 !== SOURCE_INDEX_SHA256
          || !Array.isArray(fragment.questions)
        ) {
          throw new Error('Source question fragment is stale or invalid.')
        }
        return fragment.questions
      })
      .catch((error) => {
        fragmentPromises.delete(normalizedRouteId)
        throw error
      })
    fragmentPromises.set(normalizedRouteId, request)
  }
  return fragmentPromises.get(normalizedRouteId).then((questions) => studyQuestionGroupsForRoute(questions, verifiedGroups))
}
