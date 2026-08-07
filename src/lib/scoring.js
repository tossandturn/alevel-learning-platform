function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/−/g, '-')
    .replace(/×/g, 'x')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseNumericAnswer(raw) {
  const lines = String(raw || '').replace(/\r\n?/g, '\n').split('\n').map((line) => normalizeText(line)).filter(Boolean)
  const line = (lines.at(-1) || '').replace(/,/g, '')
  const text = line.includes('=') ? line.slice(line.lastIndexOf('=') + 1).trim() : line
  const tokenPattern = /-?\d+(?:\.\d+)?\s*\/\s*-?\d+(?:\.\d+)?|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi
  const numericMatch = [...text.matchAll(tokenPattern)].at(0)
  const fractionMatch = numericMatch?.[0].match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/)
  const unit = text
    .slice((numericMatch?.index ?? 0) + (numericMatch?.[0]?.length || 0))
    .replace(/[=]/g, '')
    .trim()

  if (fractionMatch) {
    const numerator = Number(fractionMatch[1])
    const denominator = Number(fractionMatch[2])
    return { value: denominator === 0 ? Number.NaN : numerator / denominator, unit }
  }

  return { value: numericMatch ? Number(numericMatch[0]) : Number.NaN, unit }
}

function selectedOptionKey(rawAnswer) {
  const answer = normalizeText(rawAnswer)
  return answer.match(/^([a-d])(?:\b|[.)\s:-])/)?.[1] || (/^[a-d]$/.test(answer) ? answer : '')
}

function unitMatches(unit, acceptedUnits) {
  if (!acceptedUnits || acceptedUnits.length === 0) return true
  const normalized = normalizeText(unit).replace(/\s/g, '')
  return acceptedUnits.some((accepted) => normalizeText(accepted).replace(/\s/g, '') === normalized)
}

function scorePart(part, rawAnswer) {
  const answer = normalizeText(rawAnswer)

  if (!answer) {
    return {
      partId: part.id,
      awarded: 0,
      maxMarks: part.marks,
      status: 'blank',
      feedback: 'No answer submitted.',
      evidence: part.markPoints.map((point, index) => ({ pointId: `${part.id}-M${index + 1}`, awarded: false, point })),
    }
  }

  if (part.answerType === 'multiple-choice') {
    const expected = normalizeText(part.answerKey || part.answer)
    const expectedKey = selectedOptionKey(expected)
    const submittedKey = selectedOptionKey(answer)
    const correct = expectedKey && submittedKey ? expectedKey === submittedKey : answer === expected
    return {
      partId: part.id,
      awarded: correct ? part.marks : 0,
      maxMarks: part.marks,
      status: correct ? 'secure' : 'missed',
      feedback: correct ? 'Correct option selected.' : `Correct answer: ${part.answer}.`,
      evidence: part.markPoints.map((point, index) => ({ pointId: `${part.id}-M${index + 1}`, awarded: correct, point })),
    }
  }

  if (part.answerType === 'numeric') {
    const parsed = parseNumericAnswer(rawAnswer)
    const valueOk = Number.isFinite(parsed.value) && Math.abs(parsed.value - part.acceptedValue) <= part.tolerance
    const unitOk = unitMatches(parsed.unit, part.acceptedUnits)
    const awarded = valueOk ? Math.max(1, part.marks - (unitOk ? 0 : 1)) : 0

    return {
      partId: part.id,
      awarded,
      maxMarks: part.marks,
      status: awarded === part.marks ? 'secure' : awarded > 0 ? 'partial' : 'missed',
      feedback: valueOk
        ? unitOk
          ? 'Value and unit are inside the deterministic tolerance.'
          : 'Value is correct, but the unit is missing or incompatible.'
        : `Expected ${part.acceptedValue}${part.acceptedUnits?.[0] ? ` ${part.acceptedUnits[0]}` : ''}.`,
      evidence: part.markPoints.map((point, index) => ({
        pointId: `${part.id}-M${index + 1}`,
        awarded: index < awarded,
        point,
      })),
    }
  }

  const hits = (part.expectedKeywords || []).filter((keyword) => answer.includes(normalizeText(keyword)))
  const awarded = Math.min(part.marks, hits.length)

  return {
    partId: part.id,
    awarded,
    maxMarks: part.marks,
    status: awarded === part.marks ? 'secure' : awarded > 0 ? 'partial' : 'review-needed',
    feedback:
      awarded === part.marks
        ? 'All seed mark points were detected.'
        : 'Written answer needs review; keyword matching is an assisted estimate.',
    evidence: part.markPoints.map((point, index) => ({
      pointId: `${part.id}-M${index + 1}`,
      awarded: index < awarded,
      point,
    })),
    confidence: awarded === part.marks ? 0.84 : 0.56,
  }
}

export function scoreAttempt(unit, answers, elapsedSec) {
  const criteria = unit.parts.map((part) => scorePart(part, answers[part.id]))
  const rawMarks = criteria.reduce((sum, part) => sum + part.awarded, 0)
  const percentage = Math.round((rawMarks / unit.maxMarks) * 100)
  const weakest = criteria.find((part) => part.awarded < part.maxMarks)

  return {
    schemaVersion: 'deterministic-v2',
    rawMarks,
    maxMarks: unit.maxMarks,
    percentage,
    gradeEstimate: percentage >= 80 ? 'A/A* range' : percentage >= 65 ? 'B range' : percentage >= 50 ? 'C range' : 'Needs rebuild',
    estimateSource: 'Practice estimate, not official grade boundary',
    elapsedSec,
    criteria,
    weakestPartId: weakest?.partId || null,
    confidence: criteria.some((part) => part.status === 'review-needed') ? 0.62 : 0.9,
  }
}
