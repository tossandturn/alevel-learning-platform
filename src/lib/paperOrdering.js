export function sortPaperLibraryItems(items = []) {
  return [...(Array.isArray(items) ? items : [])].sort((left, right) => (
    (Number(right?.year) || 0) - (Number(left?.year) || 0)
      || String(left?.season || '').localeCompare(String(right?.season || ''))
      || String(left?.file || '').localeCompare(String(right?.file || ''), undefined, { numeric: true })
      || String(left?.id || '').localeCompare(String(right?.id || ''))
  ))
}
