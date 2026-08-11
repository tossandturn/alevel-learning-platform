const CONTEXT_VALUE_LIMIT = 240
const MAX_TERM_IDS = 20

// These are product IDs, not display text. Keeping the mapping explicit means
// an IELTSist term always returns to a deterministic STEM syllabus context.
export const STEM_TERM_IDS_BY_TOPIC_TAG = Object.freeze({
  'physics-9702-mechanics': ['stem.physics.mechanics'],
  dynamics: ['stem.physics.dynamics'],
  'forces and momentum': ['stem.physics.forces-momentum'],
  'math-0580-number': ['stem.math.number'],
  number: ['stem.math.number'],
  'powers and roots': ['stem.math.powers-roots'],
  algebra: ['stem.math.algebra'],
  'algebra and graphs': ['stem.math.algebra-graphs'],
  electricity: ['stem.physics.electricity'],
  waves: ['stem.physics.waves'],
  'electric fields': ['stem.physics.electric-fields'],
  'gravitational fields': ['stem.physics.gravitational-fields'],
})

export const STEM_TOPIC_TERM_IDS = Object.freeze({
  'physics-9702-topic-03': ['stem.physics.dynamics', 'stem.physics.forces-momentum'],
  'math-0580-number': ['stem.math.number'],
  'math-0580-algebra': ['stem.math.algebra', 'stem.math.algebra-graphs'],
  'physics-9702-topic-07': ['stem.physics.waves'],
  'physics-9702-topic-12': ['stem.physics.gravitational-fields'],
  'physics-9702-topic-18': ['stem.physics.electric-fields'],
})

const TOPIC_BY_TERM_ID = new Map(Object.entries(STEM_TOPIC_TERM_IDS)
  .flatMap(([topicId, termIds]) => termIds.map((termId) => [termId, topicId])))

function text(value, limit = CONTEXT_VALUE_LIMIT) {
  return String(value || '').trim().slice(0, limit)
}

function list(value) {
  return [...new Set(String(value || '').split(',').map((item) => text(item, 120)).filter(Boolean))].slice(0, MAX_TERM_IDS)
}

function readParam(params, canonical, legacy = []) {
  return text(params.get(canonical) || legacy.map((name) => params.get(name)).find(Boolean) || '')
}

export function termIdsForStemContext({ topicId = '', topicTags = [] } = {}) {
  const direct = STEM_TOPIC_TERM_IDS[text(topicId)] || []
  const tagged = (Array.isArray(topicTags) ? topicTags : [])
    .flatMap((tag) => STEM_TERM_IDS_BY_TOPIC_TAG[text(tag).toLowerCase()] || [])
  return [...new Set([...direct, ...tagged])].slice(0, MAX_TERM_IDS)
}

export function topicIdForTermIds(termIds = []) {
  return list(Array.isArray(termIds) ? termIds.join(',') : termIds)
    .map((termId) => TOPIC_BY_TERM_ID.get(termId))
    .find(Boolean) || ''
}

export function parseProductContext(value = typeof window !== 'undefined' ? window.location.search : '') {
  const params = value instanceof URLSearchParams
    ? value
    : new URLSearchParams(String(value || '').startsWith('?') ? String(value).slice(1) : value)
  const termIds = list(readParam(params, 'termIds', ['term_ids']))
  return {
    from: readParam(params, 'from'),
    focus: readParam(params, 'focus'),
    routeId: readParam(params, 'routeId', ['route_id']),
    topicId: readParam(params, 'topicId', ['topic_id']) || topicIdForTermIds(termIds),
    termIds,
    attemptId: readParam(params, 'attemptId', ['attempt_id', 'returnAttempt', 'return_attempt']),
    returnTo: readParam(params, 'returnTo', ['return_to']),
  }
}

export function applyProductContext(url, { routeId = '', topicId = '', termIds = [], attemptId = '', returnTo = '', subject = '' } = {}) {
  const target = url instanceof URL ? url : new URL(String(url))
  const set = (key, value) => {
    const safe = text(value)
    if (safe) target.searchParams.set(key, safe)
  }
  set('routeId', routeId)
  set('topicId', topicId)
  const normalizedTermIds = list(Array.isArray(termIds) ? termIds.join(',') : termIds)
  if (normalizedTermIds.length) target.searchParams.set('termIds', normalizedTermIds.join(','))
  set('attemptId', attemptId)
  set('returnTo', returnTo)
  set('subject', subject)
  return target
}
