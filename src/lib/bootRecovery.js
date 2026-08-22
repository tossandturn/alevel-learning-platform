function errorMessage(value) {
  return String(value?.message || value?.reason || value || '').trim()
}

export function isBootFailure(value, { appReady = false } = {}) {
  if (appReady) return false
  const message = errorMessage(value)
  if (!message) return true
  return /chunk|dynamically imported module|importing a module script failed|failed to fetch|preload|module script|module.{0,24}(evaluation|failed)|evaluation.{0,24}module|syntax error|unexpected token/i.test(message)
}

export function freshReloadUrl(href, timestamp = Date.now()) {
  const url = new URL(href)
  url.searchParams.set('_stem_reload', String(timestamp))
  return url.toString()
}
