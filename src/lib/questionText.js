const VISUAL_PLACEHOLDER = /\[(?:graph|diagram|figure|image|table|chart|map)\s*:[^\]]*\]/gi

export function requiresSourceVisual(value) {
  VISUAL_PLACEHOLDER.lastIndex = 0
  return VISUAL_PLACEHOLDER.test(String(value || ''))
}

export function stripSourceVisualPlaceholders(value) {
  VISUAL_PLACEHOLDER.lastIndex = 0
  return String(value || '')
    .replace(VISUAL_PLACEHOLDER, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
