const REVERSE_SESSION_ORDER = Object.freeze({
  nov: 3,
  w: 3,
  winter: 3,
  jun: 2,
  s: 2,
  summer: 2,
  mar: 1,
  m: 1,
  spring: 1,
})

function sessionRank(value) {
  return REVERSE_SESSION_ORDER[String(value || '').trim().toLowerCase()] || 0
}

export function sortPaperLibraryItems(items = []) {
  return [...(Array.isArray(items) ? items : [])].sort((left, right) => (
    (Number(right?.year) || 0) - (Number(left?.year) || 0)
      || sessionRank(right?.season) - sessionRank(left?.season)
      || String(left?.season || '').localeCompare(String(right?.season || ''))
      || String(left?.file || '').localeCompare(String(right?.file || ''), undefined, { numeric: true })
      || String(left?.id || '').localeCompare(String(right?.id || ''))
  ))
}
