import { isHumanReviewedPastPaperItem } from '../src/data/questionBank.js'

export const OBJECTIVE_RESULT_SCHEMA_VERSION = 'stem-objective-result-v1'
export const SINGLE_CHOICE_ANSWER_FORMAT = 'single-choice'
export const SINGLE_CHOICE_LABELS = Object.freeze(['A', 'B', 'C', 'D'])

// Current Cambridge assessment overviews identify these complete components as
// four-option / multiple-choice papers. This allowlist deliberately excludes
// Mathematics 9709 Paper 1, which is a structured Pure Mathematics paper.
const OFFICIAL_SINGLE_CHOICE_COMPONENTS = new Map([
  ['0610', new Set([1, 2])],
  ['0620', new Set([1, 2])],
  ['0625', new Set([1, 2])],
  ['9700', new Set([1])],
  ['9701', new Set([1])],
  ['9702', new Set([1])],
  ['9708', new Set([1, 3])],
])

function text(value, limit = 300) {
  return String(value ?? '').trim().slice(0, limit)
}

function paperIdentity(value = {}) {
  const paperId = text(value.paperId || value.sourceRef?.paperId || value.id, 240)
  const parsed = paperId.match(/(?:^|[-_])(\d{4})_[msw]\d{2}_qp_([1-9])\d(?:\.pdf)?$/i)
  const subjectCode = /^\d{4}$/.test(text(value.subjectCode, 4))
    ? text(value.subjectCode, 4)
    : parsed?.[1] || ''
  const explicitComponent = Number(value.paperComponent ?? value.sourceRef?.component)
  const paperComponent = Number.isInteger(explicitComponent) && explicitComponent > 0
    ? explicitComponent
    : Number(parsed?.[2] || 0)
  return { subjectCode, paperComponent, paperId }
}

function canonicalChoice(value) {
  const candidate = text(value, 20).toUpperCase()
  return candidate.match(/^([A-D])[.)]?$/)?.[1] || ''
}

export function isExplicitSingleChoicePart(part) {
  return Boolean(
    part
    && part.answerArea?.type === 'multiple-choice'
    && part.answerArea?.input === 'choice'
    && Array.isArray(part.options)
    && part.options.length === SINGLE_CHOICE_LABELS.length
    && Number(part.marks) === 1,
  )
}

export function objectivePaperProfile(value = {}) {
  const identity = paperIdentity(value)
  const componentConfirmed = OFFICIAL_SINGLE_CHOICE_COMPONENTS.get(identity.subjectCode)?.has(identity.paperComponent) === true
  const sourceConfirmed = Array.isArray(value.parts)
    && value.parts.length === 1
    && isExplicitSingleChoicePart(value.parts[0])
  if (!componentConfirmed && !sourceConfirmed) return null
  return Object.freeze({
    ...identity,
    confirmation: componentConfirmed ? 'official-paper-component' : 'verified-source-question',
  })
}

export function objectiveAnswerMetadata(value = {}) {
  if (!objectivePaperProfile(value)) return null
  return {
    answerFormat: SINGLE_CHOICE_ANSWER_FORMAT,
    choiceLabels: [...SINGLE_CHOICE_LABELS],
  }
}

function stripAnswerFields(value = {}) {
  const {
    answer: _answer,
    answerId: _answerId,
    answerKey: _answerKey,
    answerRef: _answerRef,
    answerText: _answerText,
    exactAnswer: _exactAnswer,
    markPoints: _markPoints,
    markSchemeEvidence: _markSchemeEvidence,
    markSchemePoints: _markSchemePoints,
    markSource: _markSource,
    ...safe
  } = value
  return safe
}

export function projectNativeObjectivePracticeSet(result = {}) {
  if (!Array.isArray(result.questionGroups)) return result
  return {
    ...result,
    questionGroups: result.questionGroups.map((group) => {
      const metadata = objectiveAnswerMetadata(group)
      if (!metadata) return group
      return {
        ...stripAnswerFields(group),
        ...metadata,
        parts: (group.parts || []).map((part) => {
          const provenance = part.sourceBindingProvenance || part.markingProvenance || part.provenance
          return {
            ...stripAnswerFields(part),
            ...metadata,
            ...(provenance ? { provenance } : {}),
          }
        }),
      }
    }),
  }
}

export function scoreObjectiveQuestion({ question, selectedOption } = {}) {
  const metadata = objectiveAnswerMetadata(question || {})
  const choiceParts = (question?.parts || []).filter(isExplicitSingleChoicePart)
  const part = choiceParts.length === 1 ? choiceParts[0] : null
  const correctOption = canonicalChoice(part?.answerKey)
  const selected = canonicalChoice(selectedOption)
  const available = Boolean(
    metadata
    && selected
    && part
    && correctOption
    && isHumanReviewedPastPaperItem(question),
  )
  if (!available) {
    return {
      questionPartId: part?.partId || part?.questionPartId || null,
      available: false,
      source: 'unavailable',
      sourceStatus: 'official-key-unavailable',
      score: null,
      maxScore: metadata ? 1 : null,
      correctOption: null,
    }
  }
  return {
    questionPartId: part.partId || part.questionPartId,
    available: true,
    source: 'mark-scheme',
    sourceStatus: 'reviewed-official-key',
    score: selected === correctOption ? 1 : 0,
    maxScore: 1,
    correctOption,
  }
}
