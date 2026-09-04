const FILTER_KEYS = Object.freeze(['subject', 'stage', 'route', 'paperNumber', 'year', 'season', 'kind', 'query'])

export function filterDefaults(subject = 'all') {
  return { subject: subject || 'all', stage: 'all', route: 'all', paperNumber: 'all', year: 'all', season: 'all', kind: 'qp', query: '' }
}

export function paperFilterStorageKey(routeId = 'all', studyMode = 'past-paper-practice') {
  return `stem-paper-filters:${routeId || 'all'}:${studyMode || 'past-paper-practice'}`
}

export function restorePaperFilters(value, subject = 'all') {
  const defaults = filterDefaults(subject)
  if (!value || value.subject !== defaults.subject) return defaults
  return Object.fromEntries(FILTER_KEYS.map((key) => [key, Object.prototype.hasOwnProperty.call(value, key) ? value[key] : defaults[key]]))
}

export function readPaperFilters(storageKey, storage = typeof window !== 'undefined' ? window.sessionStorage : null) {
  if (!storage || !storageKey) return null
  try {
    const raw = storage.getItem(storageKey)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function writePaperFilters(storageKey, value, storage = typeof window !== 'undefined' ? window.sessionStorage : null) {
  if (!storage || !storageKey || !value) return
  try {
    storage.setItem(storageKey, JSON.stringify(value))
  } catch {
    // Private browsing or a full storage quota should not block paper practice.
  }
}
