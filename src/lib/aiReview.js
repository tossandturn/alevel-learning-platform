const ASSISTED_LABEL = 'Working and answer guidance'

function text(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[−–—]/g, '-')
    .replace(/×/g, '*')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/\s+/g, ' ')
    .trim()
}

function compact(value) {
  return text(value).replace(/\s+/g, '').replace(/·/g, '*')
}

function numberTokens(value) {
  return text(value).match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g) || []
}

function parseNumber(value) {
  const lines = String(value || '').replace(/\r\n?/g, '\n').split('\n').map((line) => text(line)).filter(Boolean)
  const input = (lines.at(-1) || '').replace(/,/g, '')
  const fraction = input.match(/(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)(?!\s*=)/)
  if (fraction) {
    const denominator = Number(fraction[2])
    return denominator === 0 ? Number.NaN : Number(fraction[1]) / denominator
  }

  const afterEquals = input.match(/=\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/)
  const values = afterEquals ? [afterEquals[1]] : numberTokens(input)
  return values.length ? Number(values[0]) : Number.NaN
}

function extractUnit(value) {
  const input = text(value).replace(/,/g, '')
  const afterEquals = input.match(/=\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/)
  const numberMatch = afterEquals || input.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/)
  if (!numberMatch) return input.replace(/[=]/g, '').trim()

  const numberValue = numberMatch[1] || numberMatch[0]
  const numberIndex = numberMatch.index + numberMatch[0].lastIndexOf(numberValue)
  return input.slice(numberIndex + numberValue.length).replace(/[=]/g, '').trim()
}

function normalizeUnit(value) {
  return compact(value)
    .replace(/\^\{?(-?\d+)\}?/g, '$1')
    .replace(/per/g, '/')
    .replace(/seconds?/g, 's')
    .replace(/metres?/g, 'm')
    .replace(/meters?/g, 'm')
    .replace(/newtons?/g, 'n')
    .replace(/joules?/g, 'j')
}

function unitMatches(actual, acceptedUnits) {
  if (!Array.isArray(acceptedUnits) || acceptedUnits.length === 0) return true
  const normalizedActual = normalizeUnit(actual)
  return acceptedUnits.some((unit) => normalizeUnit(unit) === normalizedActual)
}

function markCount(part) {
  const marks = Number(part?.marks)
  return Number.isFinite(marks) && marks > 0 ? Math.floor(marks) : (part?.markPoints?.length || 0)
}

function pointList(part, awarded, reasons) {
  const maxMarks = markCount(part)
  const source = Array.isArray(part?.markPoints) && part.markPoints.length
    ? part.markPoints
    : Array.from({ length: maxMarks }, (_, index) => `Mark point ${index + 1}`)
  const points = source.length >= maxMarks
    ? source.slice(0, maxMarks)
    : [...source, ...Array.from({ length: maxMarks - source.length }, (_, index) => `Mark point ${source.length + index + 1}`)]

  return points.map((_, index) => ({
    awarded: index < awarded,
    reason: reasons[index] || (index < awarded ? 'Evidence supports this mark point.' : 'Evidence for this mark point was not detected.'),
  }))
}

function responseTemplate(part, awarded, confidence, markPoints, strengths, gaps, nextStep, suggestedRetest) {
  const maxMarks = markCount(part)
  return {
    overallLabel: ASSISTED_LABEL,
    confidence: Math.max(0, Math.min(1, Number(confidence.toFixed(2)))),
    awarded,
    maxMarks,
    markPoints,
    strengths,
    gaps,
    nextStep,
    suggestedRetest,
  }
}

function blankReview(part, hasWorking = false) {
  const processNote = hasWorking
    ? 'Working was supplied, but there is no final response to assess.'
    : 'No answer or working was submitted.'
  return responseTemplate(
    part,
    0,
    0,
    pointList(part, 0, []),
    [],
    [processNote],
    'Attempt the question again and put the final response in the answer field.',
    { recommended: true, focus: part?.topic || part?.subtopic || 'this question', reason: 'No assessable response was submitted.' },
  )
}

function reviewMultipleChoice(part, answer) {
  const selected = text(answer)
  const expected = text(part?.answer)
  const options = Array.isArray(part?.options) ? part.options : []
  const selectedIndex = options.findIndex((option, index) => {
    const letter = String.fromCharCode(97 + index)
    return selected === letter || selected === text(option) || selected.startsWith(`${letter}.`)
  })
  const expectedIndex = options.findIndex((option) => text(option) === expected)
  const correct = selected !== '' && (selected === expected || (selectedIndex >= 0 && selectedIndex === expectedIndex))
  return responseTemplate(
    part,
    correct ? markCount(part) : 0,
    0.99,
    pointList(part, correct ? markCount(part) : 0, correct
      ? Array.from({ length: markCount(part) }, () => 'Selected response matches the stored option for this question.')
      : ['Selected response does not match the stored option for this question.']),
    correct ? ['Selected the correct option.'] : [],
    correct ? [] : [`Review the distinction tested by this question before retrying.`],
    correct ? 'Explain why the selected option is correct, then move to the next weak question.' : 'Eliminate distractors using the relevant law, definition, or graph before choosing.',
    { recommended: !correct, focus: part?.subtopic || part?.topic || 'the question concept', reason: correct ? 'No retest is needed for this response.' : 'The selected option was not correct.' },
  )
}

function workingEvidence(working, part) {
  const source = text(working)
  if (!source) return { present: false, points: 0, reasons: [] }

  const tokens = numberTokens(source)
  const hasOperation = /[=+*/^]|\b(divide|multiply|substitut|therefore|because|since|so)\b/.test(source)
  const hasFormula = /\b[a-z]\s*=|sqrt|sin|cos|tan|newton|force|mass|gradient|wavelength|proportional/.test(source)
  const evidenceLevel = Math.min(markCount(part), (tokens.length >= 2 ? 1 : 0) + (hasOperation ? 1 : 0) + (hasFormula ? 1 : 0))
  return {
    present: true,
    points: Math.max(1, evidenceLevel),
    reasons: [`Working contains ${tokens.length ? 'calculation values' : 'written reasoning'}${hasOperation ? ' and an operation/equation' : ''}.`],
  }
}

function reviewNumeric(part, answer, working) {
  const maxMarks = markCount(part)
  const finalText = text(answer)
  const value = parseNumber(finalText)
  const expected = Number(part?.acceptedValue)
  const tolerance = Number.isFinite(Number(part?.tolerance)) ? Number(part.tolerance) : 0
  const valueOk = Number.isFinite(value) && Number.isFinite(expected) && Math.abs(value - expected) <= tolerance
  const actualUnit = extractUnit(finalText)
  const unitOk = valueOk && unitMatches(actualUnit, part?.acceptedUnits)
  const evidence = workingEvidence(working, part)
  const finalPoint = maxMarks > 1 ? 1 : maxMarks
  const methodMarks = maxMarks > 1 && evidence.present ? Math.min(maxMarks - 1, evidence.points) : 0
  const awarded = valueOk ? Math.min(maxMarks, methodMarks + finalPoint - (unitOk ? 0 : 1)) : methodMarks
  const reasons = []
  for (let index = 0; index < maxMarks; index += 1) {
    if (index < methodMarks) reasons.push(evidence.reasons[0] || 'Working provides process evidence.')
    else if (index === maxMarks - 1 || maxMarks === 1) {
      reasons.push(valueOk
        ? unitOk ? 'Final value and unit are within the stored deterministic tolerance.' : 'Final value is correct, but the unit is missing or incompatible.'
        : 'Final value is not within the stored deterministic tolerance.')
    }
  }

  const strengths = []
  if (valueOk) strengths.push('Final numerical value is within the stored tolerance.')
  if (unitOk) strengths.push('Unit is compatible with the expected unit.')
  if (evidence.present) strengths.push('Working shows assessable process evidence.')
  const gaps = []
  if (!valueOk) gaps.push('Recheck the calculation and final value against the question data.')
  if (valueOk && !unitOk && Array.isArray(part?.acceptedUnits) && part.acceptedUnits.length) gaps.push('Add or correct the unit in the final answer.')
  if (!evidence.present && maxMarks > 1) gaps.push('Show substitution and intermediate steps to make method marks assessable.')

  return responseTemplate(
    part,
    awarded,
    valueOk && unitOk ? 0.98 : valueOk || evidence.present ? 0.78 : 0.94,
    pointList(part, awarded, reasons),
    strengths,
    gaps,
    awarded === maxMarks ? 'Check significant figures and units, then continue with the next question.' : 'Redo the calculation showing the formula, substitution, units, and final value on separate lines.',
    { recommended: awarded < maxMarks, focus: part?.subtopic || part?.topic || 'the calculation method', reason: awarded < maxMarks ? 'One or more value, unit, or method points were not demonstrated.' : 'No retest is needed for this response.' },
  )
}

function reviewWritten(part, answer, working) {
  const answerText = text(answer)
  const workingText = text(working)
  if (!answerText && !workingText) return blankReview(part)

  const expectedKeywords = Array.isArray(part?.expectedKeywords) ? part.expectedKeywords : []
  const source = `${answerText} ${workingText}`.trim()
  const compactSource = compact(source)
  const hits = expectedKeywords.filter((keyword) => source.includes(text(keyword)) || compactSource.includes(compact(keyword)))
  const maxMarks = markCount(part)
  const awarded = Math.min(maxMarks, hits.length)
  const markReasons = hits.slice(0, maxMarks).map(() => 'Detected one stored key idea in the response.')
  const strengths = hits.length ? [`Matched ${Math.min(hits.length, maxMarks)} of ${Math.max(expectedKeywords.length, maxMarks)} expected ideas.`] : []
  if (workingText && !answerText) strengths.push('The process area contains reviewable reasoning, but a final written response is missing.')
  const gaps = []
  if (!hits.length) gaps.push('No stored key idea was detected; use the command word and the relevant scientific or mathematical relationship.')
  if (hits.length < maxMarks) gaps.push(`Add the missing mark-point idea${maxMarks - awarded === 1 ? '' : 's'} and link it directly to the question.`)
  if (workingText && !answerText) gaps.push('Transfer the conclusion from working into the final answer field.')

  return responseTemplate(
    part,
    awarded,
    answerText && awarded === maxMarks ? 0.82 : 0.58,
    pointList(part, awarded, markReasons),
    strengths,
    gaps,
    awarded === maxMarks ? 'Compare your wording with the mark points and keep the concise scientific relationship.' : 'Rewrite the response as one complete explanation, covering each command word and mark point.',
    { recommended: awarded < maxMarks, focus: part?.subtopic || part?.topic || 'the written explanation', reason: awarded < maxMarks ? 'Some expected ideas were not evidenced.' : 'No retest is needed for this response.' },
  )
}

export function reviewWrittenResponse(part, answer, working) {
  if (!part || typeof part !== 'object') {
    throw new TypeError('reviewWrittenResponse requires a question part object.')
  }
  if (!text(answer) && !text(working)) return blankReview(part)

  if (part.answerType === 'multiple-choice') return reviewMultipleChoice(part, answer)
  if (part.answerType === 'numeric') return reviewNumeric(part, answer, working)
  return reviewWritten(part, answer, working)
}

export function reviewAttempt(unit, answers = {}, working = {}) {
  if (!unit || typeof unit !== 'object' || !Array.isArray(unit.parts)) {
    throw new TypeError('reviewAttempt requires a unit with a parts array.')
  }

  const partResults = unit.parts.map((part) => reviewWrittenResponse(part, answers?.[part.id], working?.[part.id]))
  const awarded = partResults.reduce((sum, result) => sum + result.awarded, 0)
  const maxMarks = partResults.reduce((sum, result) => sum + result.maxMarks, 0)
  const weak = partResults.filter((result) => result.awarded < result.maxMarks)
  const confidence = partResults.length
    ? partResults.reduce((sum, result) => sum + result.confidence, 0) / partResults.length
    : 0

  return {
    overallLabel: ASSISTED_LABEL,
    confidence: Number(confidence.toFixed(2)),
    awarded,
    maxMarks,
    markPoints: partResults.flatMap((result, index) => result.markPoints.map((point, pointIndex) => ({
      awarded: point.awarded,
      reason: `${unit.parts[index].label || unit.parts[index].id}, point ${pointIndex + 1}: ${point.reason}`,
    }))),
    strengths: [...new Set(partResults.flatMap((result) => result.strengths))],
    gaps: [...new Set(partResults.flatMap((result) => result.gaps))],
    nextStep: weak.length
      ? `Review ${weak.length} weak question${weak.length === 1 ? '' : 's'}, then complete the suggested retest.`
      : 'Review the evidence once, then move to a mixed or timed set.',
    suggestedRetest: {
      recommended: weak.length > 0,
      focus: weak.map((result, index) => unit.parts[partResults.indexOf(result)]?.subtopic || unit.parts[partResults.indexOf(result)]?.topic || `question ${index + 1}`),
      reason: weak.length ? 'Retest is focused on incomplete mark points.' : 'No immediate retest is needed.',
    },
    parts: partResults,
    assistedReview: true,
    officialResult: false,
  }
}
