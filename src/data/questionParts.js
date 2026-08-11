const PART_LABEL_TOKEN = /^\s*\(?([ivx]+|[a-z]|\d+)\)?/i
const EXPLICIT_PART_PATTERN = /(?:^|\n)\s*\((?:[a-z]|[ivx]+|\d+)\)\s+/im
const MARK_PATTERN = /\[\s*\d+\s*\]/

function text(value) {
  return String(value || '').trim()
}

export function hasExplicitQuestionParts(prompt) {
  const value = text(prompt)
  return EXPLICIT_PART_PATTERN.test(value) || MARK_PATTERN.test(value) && /\n\s*\(/.test(value)
}

export function normalisePartLabel(value, fallback = 'a') {
  const raw = text(value)
  const source = raw.match(/(?:^|[:_-])part[-_:]?(.+)$/i)?.[1] || raw
  const tokens = []
  let cursor = 0
  const input = source.trim()
  while (cursor < input.length) {
    const next = input.slice(cursor)
    if (cursor > 0 && !/^[-\s_:()]/.test(next)) return fallback
    cursor += next.match(/^[-\s_:]*/)[0].length
    const match = input.slice(cursor).match(PART_LABEL_TOKEN)
    if (!match) return fallback
    tokens.push(match[1].toLowerCase())
    cursor += match[0].length
    if (cursor < input.length && !/^[-\s_:()]/.test(input.slice(cursor))) return fallback
  }
  if (!tokens.length) return fallback
  if (tokens.length > 1 && /^\d+$/.test(tokens[0])) tokens.shift()
  return tokens.length === 1
    ? tokens[0]
    : `${tokens[0]}${tokens.slice(1).map((token) => `(${token})`).join('')}`
}

export function questionPartLabel(part, fallback = 'a') {
  const label = normalisePartLabel(part?.label, '')
  const partLabel = normalisePartLabel(part?.partLabel, '')
  const partId = normalisePartLabel(part?.partId, '')
  if (partId.includes('(') && !label.includes('(')) return partId
  if (partLabel.includes('(') && !label.includes('(')) return partLabel
  return label || partLabel || partId || fallback
}

function partMarks(value) {
  const marks = Number(value)
  return Number.isInteger(marks) && marks > 0 ? marks : 0
}

function answerAreaFor(question, part) {
  const answerType = part.answerType || question.answerType || 'handwritten'
  return {
    type: answerType,
    input: answerType === 'multiple-choice' ? 'choice' : answerType === 'numeric' ? 'numeric-and-working' : 'handwriting',
  }
}

function cloneEvidenceEntries(value) {
  if (!Array.isArray(value)) return Object.freeze([])
  return Object.freeze(value
    .filter((item) => item && typeof item === 'object')
    .map((item) => Object.freeze({
      ...item,
      imageSize: Array.isArray(item.imageSize) ? Object.freeze([...item.imageSize]) : item.imageSize,
      region: Array.isArray(item.region) ? Object.freeze([...item.region]) : item.region,
      sourceRegion: Array.isArray(item.sourceRegion) ? Object.freeze([...item.sourceRegion]) : item.sourceRegion,
      answerDiagramRegion: Array.isArray(item.answerDiagramRegion) ? Object.freeze([...item.answerDiagramRegion]) : item.answerDiagramRegion,
    })))
}

function cloneSourceRegion(value) {
  if (!value || typeof value !== 'object') return null
  return Object.freeze({
    ...value,
    pixelBounds: Array.isArray(value.pixelBounds) ? Object.freeze([...value.pixelBounds]) : value.pixelBounds,
    normalizedBounds: Array.isArray(value.normalizedBounds) ? Object.freeze([...value.normalizedBounds]) : value.normalizedBounds,
  })
}

function structuredPart(question, answer, part, index) {
  const label = questionPartLabel(part, index === 0 ? 'a' : String(index + 1))
  const marks = partMarks(part.marks)
  const answerPart = answer?.answerParts?.find((candidate) => questionPartLabel(candidate) === label)
  return {
    partId: part.partId || `${question.questionId || question.bankId}:part-${label}`,
    label,
    promptFragment: text(part.promptFragment || part.exactText || part.prompt),
    marks,
    answerArea: part.answerArea || answerAreaFor(question, part),
    markSchemePoints: [...(answerPart?.markSchemePoints || part.markSchemePoints || part.markPoints || [])].map(text).filter(Boolean),
    answerKey: answerPart?.answerKey || answerPart?.correctOption || part.answerKey || part.correctOption || null,
    answerText: answerPart?.answerText || answerPart?.exactText || part.answerText || null,
    sourcePage: Number(part.sourcePage || part.page || question.sourceRef?.pageStart) || null,
    // A structured answer part must carry its own reviewed MS page. Falling
    // back to the document's first page can silently bind a mark to the wrong
    // source when an imported record is incomplete.
    answerSourcePage: Number(answerPart?.sourcePage ?? answerPart?.page) || null,
    // Keep the reviewer-bound image proof on the normalized runtime part.
    // The source-content gate and server marker must verify these bytes again;
    // this does not authorize a client-supplied image.
    sourceEvidence: cloneEvidenceEntries(part.sourceEvidence),
    sourceRegion: cloneSourceRegion(part.sourceRegion),
    markSchemeEvidence: cloneEvidenceEntries(answerPart?.markSchemeEvidence || part.markSchemeEvidence),
  }
}

export function validateQuestionGroup(group) {
  const parts = Array.isArray(group?.parts) ? group.parts : []
  const totalMarks = Number(group?.totalMarks)
  const partsTotal = parts.reduce((sum, part) => sum + partMarks(part.marks), 0)
  const hasValidParts = parts.length > 0 && parts.every((part) => (
    text(part.partId)
    && text(part.promptFragment)
    && partMarks(part.marks) > 0
    && part.answerArea?.type
    && (part.answerArea.type === 'multiple-choice' ? Boolean(part.answerKey) : part.markSchemePoints?.length > 0)
  ))
  return {
    valid: hasValidParts && Number.isInteger(totalMarks) && totalMarks > 0 && partsTotal === totalMarks,
    partsTotal,
    totalMarks,
  }
}

export function buildLegacyQuestionGroup(question, answer = null) {
  const questionId = question.questionId || question.bankId
  const prompt = text(question.prompt)
  if (!questionId || !prompt) return { status: 'quarantined', reason: 'missing-question-group-fields', parts: [] }
  if (hasExplicitQuestionParts(prompt)) {
    return { status: 'quarantined', reason: 'legacy-multi-part-needs-structured-import', parts: [] }
  }

  const answerKey = answer?.answerKey || question.answerKey || question.answer || null
  const answerType = question.answerType || 'handwritten'
  const marks = answerType === 'multiple-choice' ? 1 : partMarks(question.marks)
  const part = {
    partId: `${questionId}:part-a`,
    label: 'a',
    promptFragment: prompt,
    marks,
    answerArea: answerAreaFor(question, { answerType }),
    markSchemePoints: answerType === 'multiple-choice'
      ? ['Select the answer option that matches the official answer key.']
      : [...(answer?.markPoints || question.markPoints || [])].map(text).filter(Boolean),
    answerKey,
    answerText: answer?.exactAnswer || question.exactAnswer || null,
    sourcePage: Number(question.sourceRef?.pageStart) || null,
    answerSourcePage: Number(answer?.answerRef?.pageStart || question.answerRef?.pageStart) || null,
  }
  const group = { questionGroupId: questionId, totalMarks: marks, parts: [part] }
  const validation = validateQuestionGroup(group)
  return validation.valid
    ? { status: 'legacy-single-part', reason: null, ...group }
    : { status: 'quarantined', reason: 'legacy-marks-or-mark-scheme-incomplete', parts: [] }
}

export function normaliseQuestionGroup(question, answer = null) {
  const questionId = question.questionGroupId || question.questionId || question.bankId
  if (Array.isArray(question.parts) && question.parts.length) {
    const parts = question.parts.map((part, index) => structuredPart({ ...question, questionId }, answer, part, index))
    const group = {
      questionGroupId: questionId,
      totalMarks: Number(question.totalMarks || question.marks),
      parts,
    }
    const validation = validateQuestionGroup(group)
    return validation.valid
      ? { status: 'verified', reason: null, ...group }
      : { status: 'quarantined', reason: 'question-mark-scheme-parts-do-not-reconcile', parts: [] }
  }
  return buildLegacyQuestionGroup({ ...question, questionId }, answer)
}
