import {
  buildCoachPractice,
  buildVerifiedPracticeCatalog,
  coachPracticeOptions,
  paperQuestionMarkingMetadata,
  verifiedPracticeCatalogRevision,
  rebindVerifiedPracticeUnit,
} from '../src/lib/verifiedPracticeCatalog.js'

const DISCOVERY_SCHEMA = 'verified-practice-discovery-v1'
const UNIT_SCHEMA = 'verified-practice-unit-v1'
const MARKING_SCHEMA = 'paper-marking-context-v1'
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/
const SAFE_ROUTE = /^[a-z0-9][a-z0-9-]{1,119}$/

function failure(statusCode, code, message) {
  throw Object.assign(new Error(message), { statusCode, code })
}

function exactObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function identifier(value, name = 'identifier', pattern = SAFE_ID) {
  const text = String(value || '').trim()
  if (!pattern.test(text)) failure(400, 'verified_practice_request_invalid', `A valid ${name} is required.`)
  return text
}

function positiveInteger(value, { min = 0, max = 1000, fallback = 0 } = {}) {
  if (value === undefined || value === null || value === '') return fallback
  const number = Number(value)
  if (!Number.isInteger(number) || number < min || number > max) failure(400, 'verified_practice_request_invalid', 'A bounded integer is required.')
  return number
}

function publicOption(option) {
  return {
    routeId: option.routeId,
    subjectId: option.subjectId,
    qualificationId: option.qualificationId,
    qualification: option.qualification,
    code: option.code,
    label: option.label,
    stage: option.stage,
    topics: option.topics.map((topic) => ({
      id: topic.id,
      routeId: topic.routeId,
      label: topic.label,
      stageTags: [...topic.stageTags],
      inventory: topic.inventory,
      inventoryByStage: { ...topic.inventoryByStage },
    })),
  }
}

function publicUnit(unit) {
  return {
    id: unit.id,
    type: unit.type,
    discoveryOnly: true,
    routeId: unit.routeId,
    qualification: unit.qualification,
    subject: unit.subject,
    subjectId: unit.subjectId,
    qualificationId: unit.qualificationId,
    knowledgeGroupId: unit.knowledgeGroupId,
    topicId: unit.topicId,
    topic: unit.topic,
    title: unit.title,
    stage: unit.stage,
    paperComponent: Array.isArray(unit.paperComponent) ? [...unit.paperComponent] : [],
    durationSec: Number(unit.durationSec) || 0,
    maxMarks: Number(unit.maxMarks) || 0,
    difficulty: unit.difficulty,
    estimatedMinutes: Number(unit.estimatedMinutes) || 0,
    priority: unit.priority,
    inventoryStatus: unit.inventoryStatus,
    questionGroupCount: Number(unit.questionGroupCount) || 0,
    answerPartCount: Array.isArray(unit.parts) ? unit.parts.length : 0,
    paperCount: Array.isArray(unit.referencePapers) ? unit.referencePapers.length : 0,
    sourceSetIndex: Number(unit.sourceSetIndex) || 0,
    sourceSetCount: Number(unit.sourceSetCount) || 0,
    startable: unit.startable !== false,
  }
}

let catalogCache = { revision: '', units: [], routes: [] }
function catalogSnapshot() {
  const revision = verifiedPracticeCatalogRevision()
  if (catalogCache.revision === revision) return catalogCache
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = verifiedPracticeCatalogRevision()
    const units = buildVerifiedPracticeCatalog()
      .filter((unit) => unit.startable !== false)
      .map((unit) => Object.freeze(unit))
    const routes = coachPracticeOptions()
    const after = verifiedPracticeCatalogRevision()
    if (before === after) {
      catalogCache = { revision: after, units, routes }
      return catalogCache
    }
  }
  failure(503, 'verified_practice_revision_changed', 'The verified practice catalog changed while it was being read.')
}

function catalogUnits() {
  return catalogSnapshot().units
}

function currentUnit(unit) {
  return {
    ...unit,
    discoveryOnly: false,
    sourceAuthority: 'server-verified',
    sourceGateStatus: 'current',
  }
}

function stableCatalogBuild(builder) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = verifiedPracticeCatalogRevision()
    const value = builder()
    const after = verifiedPracticeCatalogRevision()
    if (before === after) return { revision: after, value }
  }
  failure(503, 'verified_practice_revision_changed', 'The verified practice catalog changed while it was being read.')
}

export function buildVerifiedPracticeDiscovery() {
  const snapshot = catalogSnapshot()
  return {
    schemaVersion: DISCOVERY_SCHEMA,
    sourceVersion: snapshot.revision,
    routes: snapshot.routes.map(publicOption),
    units: snapshot.units.map(publicUnit),
  }
}

export function verifiedPracticeUnitById(unitId) {
  const id = identifier(unitId, 'practice unit ID')
  const unit = catalogUnits().find((candidate) => candidate.id === id)
  if (!unit) failure(404, 'verified_practice_unit_not_found', 'The verified practice unit was not found.')
  return { schemaVersion: UNIT_SCHEMA, sourceVersion: catalogSnapshot().revision, unit: currentUnit(unit) }
}

export function generateVerifiedPracticeUnit(input) {
  if (!exactObject(input)) failure(400, 'verified_practice_request_invalid', 'The verified practice selection is invalid.')
  const allowed = new Set(['routeId', 'subjectId', 'stage', 'knowledgeGroupId', 'topicId', 'questionCount', 'questionOffset', 'allowPartial', 'unitId', 'sourceQuestionIds'])
  if (Object.keys(input).some((key) => !allowed.has(key))) failure(400, 'verified_practice_request_invalid', 'The verified practice selection has unexpected fields.')
  const routeId = input.routeId ? identifier(input.routeId, 'route ID', SAFE_ROUTE) : ''
  const subjectId = input.subjectId ? identifier(input.subjectId, 'subject ID') : ''
  const knowledgeGroupId = input.knowledgeGroupId ? identifier(input.knowledgeGroupId, 'topic ID') : ''
  const topicId = input.topicId ? identifier(input.topicId, 'topic ID') : ''
  const stage = String(input.stage || '').trim().slice(0, 40)
  const questionCount = positiveInteger(input.questionCount, { min: 1, max: 30, fallback: 10 })
  const questionOffset = positiveInteger(input.questionOffset, { min: 0, max: 100_000, fallback: 0 })
  const unitId = input.unitId ? identifier(input.unitId, 'practice unit ID') : ''
  const sourceQuestionIds = input.sourceQuestionIds === undefined || input.sourceQuestionIds === null
    ? null
    : Array.isArray(input.sourceQuestionIds) && input.sourceQuestionIds.length > 0 && input.sourceQuestionIds.length <= 30
      ? input.sourceQuestionIds.map((value) => identifier(value, 'source question ID'))
      : failure(400, 'verified_practice_request_invalid', 'The source question list is invalid.')
  const result = stableCatalogBuild(() => buildCoachPractice({
    routeId,
    subjectId,
    stage,
    knowledgeGroupId,
    topicId,
    questionCount,
    questionOffset,
    allowPartial: input.allowPartial === true,
    unitId,
    sourceQuestionIds,
    agentGenerated: true,
  }))
  return { schemaVersion: UNIT_SCHEMA, sourceVersion: result.revision, unit: currentUnit(result.value) }
}

export function rebindVerifiedPracticeUnitForRequest(unit) {
  if (!exactObject(unit)) failure(400, 'verified_practice_rebind_invalid', 'A saved verified practice unit is required.')
  const result = stableCatalogBuild(() => rebindVerifiedPracticeUnit(unit))
  const rebound = result.value
  if (!rebound) failure(409, 'verified_practice_rebind_failed', 'This saved practice no longer matches the current reviewed source catalog.')
  return { schemaVersion: UNIT_SCHEMA, sourceVersion: result.revision, unit: currentUnit(rebound) }
}

export function markingContextForPaper({ paperId, routeId = '' } = {}) {
  const normalizedPaperId = identifier(paperId, 'paper ID')
  const normalizedRouteId = routeId ? identifier(routeId, 'route ID', SAFE_ROUTE) : ''
  const result = stableCatalogBuild(() => paperQuestionMarkingMetadata({ paperId: normalizedPaperId, routeId: normalizedRouteId }))
  return {
    schemaVersion: MARKING_SCHEMA,
    sourceVersion: result.revision,
    paperId: normalizedPaperId,
    routeId: normalizedRouteId,
    questions: result.value,
  }
}

export const VERIFIED_PRACTICE_SCHEMAS = Object.freeze({
  discovery: DISCOVERY_SCHEMA,
  unit: UNIT_SCHEMA,
  marking: MARKING_SCHEMA,
})
