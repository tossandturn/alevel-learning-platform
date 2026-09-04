import { questionPartLabel } from '../src/data/questionParts.js'
import { normaliseQuestionFragmentHierarchy } from './question-index-fragment-normalization.mjs'

export function normalizeQuestionNumber(value) {
  return String(value || '').trim().replace(/^Q/i, '').match(/^\d+/)?.[0] || ''
}

export function normalizeMarkValue(value) {
  const numeric = Number(value)
  if (Number.isInteger(numeric)) return numeric
  const code = String(value || '').match(/(\d+)\s*$/)
  return code ? Number(code[1]) : 0
}

export function resolvePartMarks({ questionMarks, answerMarks, answerType }) {
  const questionPaperMarks = normalizeMarkValue(questionMarks)
  const markSchemeMarks = normalizeMarkValue(answerMarks)
  if (questionPaperMarks > 0) {
    return {
      marks: questionPaperMarks,
      markSource: markSchemeMarks === questionPaperMarks ? 'paired-mark-scheme' : 'question-paper',
    }
  }
  if (markSchemeMarks > 0) return { marks: markSchemeMarks, markSource: 'paired-mark-scheme' }
  if (answerType === 'multiple-choice') return { marks: 1, markSource: 'multiple-choice-default' }
  return { marks: 0, markSource: '' }
}

export function mergeFragments(records, key, { pageQuestionNumbers = null } = {}) {
  const grouped = new Map()
  let activeQuestionNumber = null
  let activePage = null
  for (const record of records) {
    const recordPage = Number(record?.page)
    for (const fragment of record[key] || []) {
      const candidate = normalizeQuestionNumber(fragment.questionNumber)
      let questionNumber = candidate
      const pageQuestionNumber = pageQuestionNumbers instanceof Map ? pageQuestionNumbers.get(recordPage) : undefined
      const pageHasNoNewQuestion = pageQuestionNumbers instanceof Map
        && pageQuestionNumbers.has(recordPage)
        && pageQuestionNumbers.get(recordPage) === null
      const canContinue = Boolean(
        activeQuestionNumber
        && fragment.continues === true
        && Number.isInteger(recordPage)
        && Number.isInteger(activePage)
        && recordPage >= activePage
        && recordPage <= activePage + 1,
      )
      const canInheritFromContinuationPage = Boolean(
        activeQuestionNumber
        && (pageHasNoNewQuestion || (pageQuestionNumbers instanceof Map && pageQuestionNumbers.size > 0 && pageQuestionNumber === undefined))
        && (!candidate || pageHasNoNewQuestion)
        && Number.isInteger(recordPage)
        && Number.isInteger(activePage)
        && recordPage >= activePage
        && recordPage <= activePage + 1,
      )

      // A noisy `continues` flag must never override an explicitly printed
      // question number. A local PDF anchor also lets us correct OCR that
      // mistakes a continuation part such as (c) for a question number.
      // Inherit only on the same or next page, which prevents A2 questions
      // separated by several pages from being merged into one broken question.
      if (canInheritFromContinuationPage) {
        questionNumber = activeQuestionNumber
      }
      else if (!candidate && canContinue) {
        questionNumber = activeQuestionNumber
      }
      else if (typeof pageQuestionNumber === 'string' && (fragment.startsHere === true || !candidate)) {
        questionNumber = pageQuestionNumber
      }
      if (!questionNumber) continue

      const selectedPageAnchor = typeof pageQuestionNumber === 'string'
        && questionNumber === pageQuestionNumber
        && (fragment.startsHere === true || !candidate)
      if (candidate || selectedPageAnchor || !activeQuestionNumber) {
        activeQuestionNumber = questionNumber
      }
      const current = grouped.get(questionNumber) || { questionNumber, pages: [], fragments: [] }
      current.pages.push(recordPage)
      current.fragments.push({
        ...fragment,
        sourcePage: Number(fragment.sourcePage || recordPage) || null,
      })
      grouped.set(questionNumber, current)
      if (Number.isInteger(recordPage)) activePage = recordPage
    }
  }
  return grouped
}

export function collapseFragments(fragments, { sumMarks = false, questionHierarchy = false } = {}) {
  const sourceFragments = questionHierarchy ? normaliseQuestionFragmentHierarchy(fragments) : fragments
  const grouped = new Map()
  for (const fragment of sourceFragments) {
    const label = questionPartLabel(fragment, sourceFragments.length === 1 ? 'a' : '')
    if (!label) return null
    const current = grouped.get(label)
    if (!current) {
      const key = String(fragment.exactText || fragment.promptFragment || fragment.answerText || '').trim().toLowerCase()
      grouped.set(label, { ...fragment, label, partId: fragment.partId || label, _markEntryKeys: key ? new Set([key]) : new Set() })
      continue
    }
    const currentMarks = normalizeMarkValue(current.marks)
    const nextMarks = normalizeMarkValue(fragment.marks)
    if (!sumMarks && Number.isInteger(currentMarks) && Number.isInteger(nextMarks) && currentMarks > 0 && nextMarks > 0 && currentMarks !== nextMarks) return null
    const currentText = String(current.promptFragment || current.exactText || '').trim()
    const nextText = String(fragment.promptFragment || fragment.exactText || '').trim()
    const mergedText = currentText && nextText && currentText !== nextText ? `${currentText}\n${nextText}` : currentText || nextText
    const currentPoints = Array.isArray(current.markPoints) ? current.markPoints : []
    const nextPoints = Array.isArray(fragment.markPoints) ? fragment.markPoints : []
    const entryKey = String(fragment.exactText || fragment.promptFragment || fragment.answerText || '').trim().toLowerCase()
    const seenEntry = entryKey && current._markEntryKeys?.has(entryKey)
    const markTotal = sumMarks
      ? (currentMarks || 0) + (seenEntry ? 0 : (nextMarks || 0))
      : currentMarks || nextMarks
    const markEntryKeys = new Set(current._markEntryKeys || [])
    if (entryKey) markEntryKeys.add(entryKey)
    grouped.set(label, {
      ...current,
      ...fragment,
      label,
      partId: current.partId || fragment.partId || label,
      promptFragment: mergedText,
      exactText: mergedText,
      marks: markTotal,
      markPoints: [...new Set([...currentPoints, ...nextPoints].map((value) => String(value).trim()).filter(Boolean))],
      sourcePage: Math.min(Number(current.sourcePage || current.page) || Number.POSITIVE_INFINITY, Number(fragment.sourcePage || fragment.page) || Number.POSITIVE_INFINITY),
      _markEntryKeys: markEntryKeys,
    })
  }
  return [...grouped.values()].map((fragment) => ({
    ...(({ _markEntryKeys, ...value }) => value)(fragment),
    sourcePage: Number.isFinite(fragment.sourcePage) ? fragment.sourcePage : null,
  }))
}

export function alignAnswerFragmentsToQuestionParts(questionParts, answerFragments) {
  if (!Array.isArray(questionParts) || questionParts.length !== 1) return answerFragments || []
  const label = questionPartLabel(questionParts[0], 'a')
  if (!label) return answerFragments || []
  return (answerFragments || []).map((fragment) => ({ ...fragment, label, partId: label }))
}
