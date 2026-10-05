import assert from 'node:assert/strict'

const VISUAL_REQUIRED_OUTCOME_CODES = Object.freeze(new Set(['5.2.2']))

function booleanField(value, name) {
  assert.equal(typeof value, 'boolean', `${name} must be boolean`)
  return value
}

export function chapterReadyModalityEligibility(points, evidence) {
  assert.ok(Array.isArray(points) && points.length > 0)
  const hasDiagram = booleanField(evidence?.hasDiagram, 'hasDiagram')
  const hasPhotomicrograph = booleanField(evidence?.hasPhotomicrograph, 'hasPhotomicrograph')
  const hasMicroscopeSlide = booleanField(evidence?.hasMicroscopeSlide, 'hasMicroscopeSlide')
  const hasRequiredVisualModality = hasDiagram || hasPhotomicrograph || hasMicroscopeSlide
  const eligiblePoints = []
  const excludedPoints = []
  for (const point of points) {
    assert.equal(typeof point?.id, 'string')
    assert.equal(typeof point?.officialOutcomeCode, 'string')
    if (VISUAL_REQUIRED_OUTCOME_CODES.has(point.officialOutcomeCode) && !hasRequiredVisualModality) {
      excludedPoints.push(Object.freeze({
        id: point.id,
        officialOutcomeCode: point.officialOutcomeCode,
        reason: 'official-outcome-requires-photomicrograph-diagram-or-microscope-slide',
      }))
    } else {
      eligiblePoints.push(point)
    }
  }
  return Object.freeze({
    evidence: Object.freeze({
      sourceKind: String(evidence?.sourceKind || ''),
      hasDiagram,
      hasPhotomicrograph,
      hasMicroscopeSlide,
      printedTableCount: Number.isInteger(evidence?.printedTableCount) && evidence.printedTableCount >= 0
        ? evidence.printedTableCount
        : 0,
    }),
    eligiblePoints: Object.freeze([...eligiblePoints]),
    excludedPoints: Object.freeze([...excludedPoints]),
  })
}
