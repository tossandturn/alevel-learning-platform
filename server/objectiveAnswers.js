import { isHumanReviewedPastPaperItem } from '../src/data/questionBank.js'
import { buildSourceRenderManifest } from '../src/lib/sourceRenderManifest.js'

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
const REVIEWED_DISPLAY_BOUNDS = 'reviewed-display-bounds-v1'
const QUESTION_ASSET_URL = /^\/question-assets\/([A-Za-z0-9_-]+)\/qp-(\d+)\.(?:jpg|jpeg|png|webp)$/

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

function sourceChoiceOption(value, label) {
  const raw = String(value ?? '').trim()
  if (!raw || raw.length > 2_000) return null
  const labelOnly = raw.match(/^\(?([A-D])\)?[.)]?$/i)
  if (labelOnly) return labelOnly[1].toUpperCase() === label ? { label, text: '' } : null
  const prefixed = raw.match(/^\(?([A-D])\)?(?:\s*[.)]\s*|\s+)([\s\S]*)$/i)
  if (prefixed) {
    if (prefixed[1].toUpperCase() !== label) return null
    return { label, text: prefixed[2].trim() }
  }
  return { label, text: raw }
}

export function nativeChoiceOptions(value = {}) {
  if (!objectiveAnswerMetadata(value)) return null
  const choiceParts = (value.parts || []).filter(isExplicitSingleChoicePart)
  if (choiceParts.length !== 1) return null
  const options = choiceParts[0].options.map((option, index) => sourceChoiceOption(option, SINGLE_CHOICE_LABELS[index]))
  return options.length === SINGLE_CHOICE_LABELS.length && options.every(Boolean) ? options : null
}

function validImageSize(value) {
  if (!Array.isArray(value) || value.length !== 2) return null
  const size = value.map(Number)
  return size.every((item) => Number.isInteger(item) && item > 0 && item <= 10_000) && size[0] * size[1] <= 24_000_000
    ? size
    : null
}

function reviewedFocusPage(value, paperId, page) {
  const sourceAssets = new Set((value.sourceRef?.assetUrls || []).map(String))
  const candidates = (value.parts || []).flatMap((part) => part.sourceFocus?.pages || []).flatMap((entry) => {
    const url = String(entry?.assetUrl || '')
    const match = url.match(QUESTION_ASSET_URL)
    const imageSize = validImageSize(entry?.imageSize)
    if (entry?.safetyStatus !== REVIEWED_DISPLAY_BOUNDS
      || Number(entry?.page) !== page
      || match?.[1] !== paperId
      || Number(match?.[2]) !== page
      || !sourceAssets.has(url)
      || !imageSize) return []
    return [{ url, imageSize }]
  })
  const unique = [...new Map(candidates.map((entry) => [JSON.stringify(entry), entry])).values()]
  return unique.length === 1 ? unique[0] : null
}

export function nativeQuestionFocus(value = {}) {
  const sourceQuestionId = String(value.sourceQuestionId || value.id || '').trim()
  const paperId = String(value.paperId || value.sourceRef?.paperId || '').trim()
  const manifest = buildSourceRenderManifest(value)
  if (!sourceQuestionId || sourceQuestionId.length > 240 || !paperId || !/^:q\d+(?::|$)/i.test(sourceQuestionId.slice(paperId.length))
    || !manifest?.pages?.length || manifest.pages.length > 20
    || manifest.pages.some((page) => page.exactRegion !== true)) return null
  const pages = manifest.pages.map((page) => {
    const focus = reviewedFocusPage(value, paperId, page.page)
    return focus ? { page: page.page, url: focus.url, region: [...page.normalizedRegion], imageSize: [...focus.imageSize] } : null
  })
  if (pages.some((page) => !page)) return null
  const sourceAssets = new Set((value.sourceRef?.assetUrls || []).map(String).filter((url) => {
    const match = url.match(QUESTION_ASSET_URL)
    return match?.[1] === paperId
  }))
  const focusedAssets = new Set(pages.map((page) => page.url))
  if (sourceAssets.size !== focusedAssets.size || [...sourceAssets].some((url) => !focusedAssets.has(url))) return null
  return {
    schemaVersion: 'native-question-focus-v1',
    sourceQuestionId,
    paperId,
    pages,
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
    choiceOptions: _choiceOptions,
    questionFocus: _questionFocus,
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
      const choiceOptions = nativeChoiceOptions(group)
      const questionFocus = nativeQuestionFocus(group)
      return {
        ...stripAnswerFields(group),
        ...metadata,
        ...(choiceOptions ? { choiceOptions } : {}),
        ...(questionFocus ? { questionFocus } : {}),
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
