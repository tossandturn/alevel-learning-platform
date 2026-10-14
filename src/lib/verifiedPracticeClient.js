const DISCOVERY_SCHEMA = 'verified-practice-discovery-v1'
const UNIT_SCHEMA = 'verified-practice-unit-v1'
const MARKING_SCHEMA = 'paper-marking-context-v1'
const FRAGMENT_SCHEMA = 'study-question-fragment-v1'
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/
const SAFE_ROUTE = /^[a-z0-9][a-z0-9-]{1,119}$/
const FORBIDDEN_PUBLIC_KEYS = /^(?:parts|questions|sourceQuestionIds?|referencePapers|sourceRef|answerRef|prompt|options|answer|answerKey|exactAnswer|markPoints|markSchemePoints|markingProvenance|sourceAssetUrls?|questionUrl|markSchemeUrl)$/i

function failure(message, code = 'verified_practice_invalid', statusCode = 0) {
  return Object.assign(new Error(message), { code, statusCode })
}

function exactKeys(value, keys) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('|') === [...keys].sort().join('|'))
}

function publicTreeIsSafe(value) {
  if (Array.isArray(value)) return value.every(publicTreeIsSafe)
  if (!value || typeof value !== 'object') return true
  return Object.entries(value).every(([key, child]) => !FORBIDDEN_PUBLIC_KEYS.test(key) && publicTreeIsSafe(child))
}

function validDiscoveryUnit(unit) {
  const keys = ['id', 'type', 'discoveryOnly', 'routeId', 'qualification', 'subject', 'subjectId', 'qualificationId', 'knowledgeGroupId', 'topicId', 'topic', 'title', 'stage', 'paperComponent', 'durationSec', 'maxMarks', 'difficulty', 'estimatedMinutes', 'priority', 'inventoryStatus', 'questionGroupCount', 'answerPartCount', 'paperCount', 'sourceSetIndex', 'sourceSetCount', 'startable']
  return exactKeys(unit, keys)
    && SAFE_ID.test(unit.id)
    && unit.type === 'topic'
    && unit.discoveryOnly === true
    && SAFE_ROUTE.test(unit.routeId)
    && SAFE_ID.test(unit.knowledgeGroupId)
    && unit.topicId === unit.knowledgeGroupId
    && Array.isArray(unit.paperComponent)
    && ['durationSec', 'maxMarks', 'estimatedMinutes', 'questionGroupCount', 'answerPartCount', 'paperCount', 'sourceSetIndex', 'sourceSetCount'].every((key) => Number.isInteger(unit[key]) && unit[key] >= 0)
    && typeof unit.startable === 'boolean'
}

function validDiscoveryRoute(route) {
  const keys = ['routeId', 'subjectId', 'qualificationId', 'qualification', 'code', 'label', 'stage', 'topics']
  if (!exactKeys(route, keys) || !SAFE_ROUTE.test(route.routeId) || !SAFE_ID.test(route.subjectId) || !Array.isArray(route.topics)) return false
  const topicKeys = ['id', 'routeId', 'label', 'stageTags', 'inventory', 'inventoryByStage']
  return route.topics.every((topic) => exactKeys(topic, topicKeys)
    && SAFE_ID.test(topic.id)
    && topic.routeId === route.routeId
    && Array.isArray(topic.stageTags)
    && Number.isInteger(topic.inventory) && topic.inventory >= 0
    && topic.inventoryByStage && typeof topic.inventoryByStage === 'object' && !Array.isArray(topic.inventoryByStage))
}

function validateDiscovery(payload) {
  if (!exactKeys(payload, ['schemaVersion', 'sourceVersion', 'routes', 'units'])
      || payload.schemaVersion !== DISCOVERY_SCHEMA
      || !/^[a-f0-9]{64}$/.test(payload.sourceVersion)
      || !Array.isArray(payload.routes) || !Array.isArray(payload.units)
      || payload.routes.length > 100 || payload.units.length > 10_000
      || !payload.routes.every(validDiscoveryRoute)
      || !payload.units.every(validDiscoveryUnit)
      || !publicTreeIsSafe(payload)) {
    throw failure('The public practice catalog is invalid or contains protected fields.')
  }
  return payload
}

function validateUnit(payload) {
  const unit = payload?.unit
  if (!exactKeys(payload, ['schemaVersion', 'sourceVersion', 'unit']) || payload.schemaVersion !== UNIT_SCHEMA
      || !/^[a-f0-9]{64}$/.test(payload.sourceVersion)
      || !unit || typeof unit !== 'object' || Array.isArray(unit)
      || !SAFE_ID.test(String(unit.id || ''))
      || unit.discoveryOnly !== false
      || unit.sourceAuthority !== 'server-verified'
      || unit.sourceGateStatus !== 'current'
      || !Array.isArray(unit.parts) || !unit.parts.length) {
    throw failure('The protected practice unit is invalid.')
  }
  return { ...unit, sourceVersion: payload.sourceVersion }
}

function validateMarking(payload, expected) {
  if (!exactKeys(payload, ['schemaVersion', 'sourceVersion', 'paperId', 'routeId', 'questions'])
      || payload.schemaVersion !== MARKING_SCHEMA
      || !/^[a-f0-9]{64}$/.test(payload.sourceVersion)
      || payload.paperId !== expected.paperId
      || payload.routeId !== expected.routeId
      || !payload.questions || typeof payload.questions !== 'object' || Array.isArray(payload.questions)) {
    throw failure('The protected paper marking context is invalid.')
  }
  return payload
}

async function jsonRequest(fetchImpl, path, { token = '', method = 'GET', body, publicRequest = false } = {}) {
  const headers = {
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...(!publicRequest && token ? { Authorization: `Bearer ${token}` } : {}),
  }
  let response
  try {
    response = await fetchImpl(path, {
      method,
      credentials: 'same-origin',
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch {
    throw failure('The practice service could not be reached.', 'network_error')
  }
  let payload
  try { payload = await response.json() } catch { payload = null }
  if (!response.ok) {
    const code = String(payload?.code || payload?.error?.code || (response.status === 401 ? 'identity_required' : response.status === 403 ? 'membership_required' : 'verified_practice_request_failed'))
    const message = response.status === 401
      ? 'Sign in to continue.'
      : response.status === 403 && code === 'membership_required'
        ? 'An active membership is required to open this practice content.'
        : String(payload?.message || payload?.error?.message || payload?.error || 'The practice request failed.')
    throw failure(message, code, response.status)
  }
  return payload
}

function normalizedSelection(discovery, selection = {}) {
  const explicitId = String(selection.routeId || selection.subjectId || '').trim()
  let route = discovery.routes.find((candidate) => candidate.routeId === explicitId)
  if (!route) {
    const subjectId = String(selection.subjectId || '').trim()
    const stage = String(selection.stage || '').trim()
    const matches = discovery.routes.filter((candidate) => candidate.subjectId === subjectId && (!stage || candidate.stage === stage))
    if (matches.length !== 1) throw failure('Choose one exact paper route before building practice.', 'practice_route_required')
    route = matches[0]
  }
  const requestedTopicId = String(selection.topicId || selection.knowledgeGroupId || '').trim()
  const group = route.topics.find((topic) => topic.id === requestedTopicId) || route.topics[0]
  if (!group) throw failure('Choose a valid learning topic before building practice.', 'practice_topic_required')
  return { subject: route, group }
}

function compactRebindUnit(unit) {
  if (!unit || typeof unit !== 'object' || !SAFE_ID.test(String(unit.id || '')) || !SAFE_ROUTE.test(String(unit.routeId || '')) || !Array.isArray(unit.parts) || !unit.parts.length || unit.parts.length > 500) {
    throw failure('The saved practice unit is invalid.')
  }
  return {
    id: unit.id,
    routeId: unit.routeId,
    knowledgeGroupId: String(unit.knowledgeGroupId || ''),
    topicId: String(unit.topicId || ''),
    topic: String(unit.topic || '').slice(0, 240),
    focusedRetestOf: unit.focusedRetestOf || null,
    agentGenerated: unit.agentGenerated === true,
    assignmentSourceIds: Array.isArray(unit.assignmentSourceIds) ? unit.assignmentSourceIds.slice(0, 30) : null,
    questionOffset: Number.isInteger(unit.questionOffset) ? unit.questionOffset : 0,
    inventoryStatus: String(unit.inventoryStatus || '').slice(0, 80),
    priority: String(unit.priority || '').slice(0, 80),
    parts: unit.parts.map((part) => ({
      id: String(part.id || ''),
      sourceKind: String(part.sourceKind || ''),
      sourceQuestionId: String(part.sourceQuestionId || ''),
      questionGroupId: String(part.questionGroupId || ''),
      bankId: String(part.bankId || ''),
      questionPartId: String(part.questionPartId || ''),
      partId: String(part.partId || ''),
    })),
  }
}

export function createVerifiedPracticeClient({ fetchImpl = fetch, token = '' } = {}) {
  let discovery = null
  const request = (path, options = {}) => jsonRequest(fetchImpl, path, { token, ...options })
  return {
    async catalog() {
      discovery = validateDiscovery(await request('/api/stem/verified-practice/catalog', { publicRequest: true }))
      return discovery
    },
    resolveSelection(selection) {
      if (!discovery) throw failure('The public practice catalog has not loaded.')
      return normalizedSelection(discovery, selection)
    },
    async unit(unitId) {
      const id = String(unitId || '').trim()
      if (!SAFE_ID.test(id)) throw failure('The practice unit ID is invalid.')
      return validateUnit(await request(`/api/stem/verified-practice/units/${encodeURIComponent(id)}`))
    },
    async generate(selection) {
      const value = selection && typeof selection === 'object' ? selection : {}
      const body = Object.fromEntries(['routeId', 'subjectId', 'stage', 'knowledgeGroupId', 'topicId', 'questionCount', 'questionOffset', 'allowPartial', 'unitId', 'sourceQuestionIds']
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, value[key]]))
      return validateUnit(await request('/api/stem/verified-practice/generate', { method: 'POST', body }))
    },
    async rebind(unit) {
      return validateUnit(await request('/api/stem/verified-practice/rebind', { method: 'POST', body: { unit: compactRebindUnit(unit) } }))
    },
    async markingContext({ paperId, routeId = '' } = {}) {
      const paper = String(paperId || '').trim()
      const route = String(routeId || '').trim()
      if (!SAFE_ID.test(paper) || route && !SAFE_ROUTE.test(route)) throw failure('The paper marking request is invalid.')
      const suffix = route ? `?routeId=${encodeURIComponent(route)}` : ''
      return validateMarking(await request(`/api/stem/papers/${encodeURIComponent(paper)}/marking-context${suffix}`), { paperId: paper, routeId: route })
    },
  }
}

export async function requestStudyQuestionGroups({ routeId, token = '', fetchImpl = fetch } = {}) {
  const route = String(routeId || '').trim()
  if (!SAFE_ROUTE.test(route)) throw failure('The study question route is invalid.')
  const payload = await jsonRequest(fetchImpl, `/api/stem/study-question-index/${encodeURIComponent(route)}`, { token })
  if (!exactKeys(payload, ['schemaVersion', 'routeId', 'sourceIndexSha256', 'questions'])
      || payload.schemaVersion !== FRAGMENT_SCHEMA || payload.routeId !== route
      || !/^[a-f0-9]{64}$/.test(payload.sourceIndexSha256)
      || !Array.isArray(payload.questions) || payload.questions.length > 20_000) {
    throw failure('The protected study question index is invalid.')
  }
  return payload.questions
}

export const VERIFIED_PRACTICE_CLIENT_SCHEMAS = Object.freeze({
  discovery: DISCOVERY_SCHEMA,
  unit: UNIT_SCHEMA,
  marking: MARKING_SCHEMA,
  fragment: FRAGMENT_SCHEMA,
})
