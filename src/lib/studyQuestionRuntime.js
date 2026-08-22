import { isStudyOnlyPastPaperItem, studyQuestionBank } from '../data/questionBank.js'

export function studyQuestionGroupsForRoute(routeId, verifiedGroups = []) {
  const verifiedIds = new Set(verifiedGroups.map((question) => question.sourceQuestionId).filter(Boolean))
  return studyQuestionBank
    .filter((question) => question.routeId === routeId)
    .toSorted((left, right) => (
      (Number(right.sourceRef?.year) || 0) - (Number(left.sourceRef?.year) || 0)
      || String(left.sourceRef?.paper).localeCompare(String(right.sourceRef?.paper))
      || String(left.sourceRef?.question).localeCompare(String(right.sourceRef?.question), undefined, { numeric: true })
    ))
    .map((question) => ({
      ...question,
      studyOnly: isStudyOnlyPastPaperItem(question) && !verifiedIds.has(question.sourceQuestionId),
    }))
}
