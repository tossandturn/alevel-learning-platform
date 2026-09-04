const SERIES_DOCUMENT_KINDS = new Set(['er', 'gt'])

function normaliseTitle(value) {
  return String(value || '').toLowerCase().replace(/&/g, 'and').replace(/\s+/g, ' ').trim()
}

function isSpecialistRoute(route) {
  return route?.stage === 'Competition' || route?.stage === 'Admissions'
}

function isSeriesDocument(item) {
  return !item?.variant && SERIES_DOCUMENT_KINDS.has(item?.kind)
}

function paperNumber(item) {
  const value = item?.examProfile?.paperNumber
  return value == null ? null : Number(value)
}

function titleIncludesS1(item) {
  return /\bprobability and statistics 1\b/.test(normaliseTitle(item?.examProfile?.title))
}

function titleIncludesP1(item) {
  return /\bpure mathematics 1\b/.test(normaliseTitle(item?.examProfile?.title))
}

function matches9709P1S1(item) {
  const component = paperNumber(item)
  return (component === 1 && titleIncludesP1(item)) || titleIncludesS1(item)
}

export function paperItemMatchesActiveRoute(item, activeRoute) {
  if (!activeRoute) return true
  if (item?.subject !== activeRoute.subjectCode) return false
  if (isSpecialistRoute(activeRoute) || isSeriesDocument(item)) return true
  if (activeRoute.routeId === 'cie-9709-as-p1-p5') return matches9709P1S1(item)

  const component = paperNumber(item)
  return (
    component == null
    || !Number.isFinite(component)
    || !activeRoute.paperComponents?.length
    || activeRoute.paperComponents.includes(component)
  )
}
