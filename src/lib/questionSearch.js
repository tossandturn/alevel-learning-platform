import { stripSourceVisualPlaceholders } from './questionText.js'

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function joinSearchParts(parts) {
  return parts
    .flatMap((part) => Array.isArray(part) ? part : [part])
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ')
}

export function questionSearchText(question = {}) {
  const sourceRef = question.sourceRef || {}
  const answerRef = question.answerRef || {}
  const parts = Array.isArray(question.parts) ? question.parts : []
  const markPoints = parts.flatMap((part) => Array.isArray(part.markSchemePoints) ? part.markSchemePoints : [])
  const promptFragments = parts.map((part) => stripSourceVisualPlaceholders(part.promptFragment || part.prompt || ''))
  const optionText = parts.map((part) => Array.isArray(part.options) ? part.options.join(' ') : '')
  const markPointText = markPoints.map((point) => (
    typeof point === 'string'
      ? point
      : [point?.point, point?.text, point?.label, point?.description].map((value) => String(value || '').trim()).filter(Boolean).join(' ')
  ))

  return normalizeSearchText(joinSearchParts([
    question.sourceQuestionId,
    question.questionGroupId,
    question.questionNumber,
    question.label,
    question.displayLabel,
    question.prompt,
    stripSourceVisualPlaceholders(question.prompt || ''),
    sourceRef.paper,
    sourceRef.question,
    sourceRef.file,
    answerRef.file,
    question.sourceDescription,
    question.sourceLabel,
    question.knowledgeGroupId,
    question.topicId,
    question.syllabusTopic,
    question.answerType,
    question.topicTags,
    question.skillTags,
    promptFragments,
    optionText,
    markPointText,
  ]))
}

export function questionMatchesSearch(question, query) {
  const terms = normalizeSearchText(query).split(' ').filter(Boolean)
  if (!terms.length) return true
  const text = questionSearchText(question)
  return terms.every((term) => text.includes(term))
}

export function filterQuestionsBySearch(questions = [], query = '') {
  return (Array.isArray(questions) ? questions : []).filter((question) => questionMatchesSearch(question, query))
}
