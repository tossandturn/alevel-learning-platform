import { courseRoutes, LEGACY_UNSCOPED_ROUTE_ID, routeById } from '../data/routeRegistry.js'
import { migrateLearningState, normalizeAcademicStage, resolveRouteBinding } from './routeMigration.js'

const STORAGE_KEY = 'alevel-learning-platform-v2'
const MAX_SYNC_QUEUE = 50
const MAX_COMPLETED_SYNC_KEYS = 100
const DEFAULT_ROUTE_ID = 'cie-9702-as-physics'

const fallbackState = {
  profile: { role: 'student', learningTrack: 'AS', activeRouteId: DEFAULT_ROUTE_ID, recentRouteIds: [DEFAULT_ROUTE_ID], learnerName: '', schoolName: '', targetGrade: 'A', examBoard: 'Cambridge International', weeklyQuestions: 18, deadline: '2026-10-15', preferredMode: 'Topics' },
  attempts: [], drafts: {}, paperDrafts: {}, paperSessions: [], paperReviews: [], recentPapers: [], recentPractice: [], favoriteUnitIds: [], generatedUnits: [], assignments: [], classrooms: [], syncQueue: [], completedSyncKeys: [],
}

function canUseStorage() {
  return typeof window !== 'undefined' && Boolean(window.localStorage)
}

function stableQueueId(item) {
  const input = `${item.resource || ''}|${item.idempotencyKey || item.body?.idempotencyKey || ''}|${item.attemptId || item.body?.attemptId || ''}`
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `sync-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function routeEvidence(item, attempt) {
  return [...new Set([
    item.routeId,
    item.body?.routeId,
    attempt?.routeId,
    attempt?.scoreResult?.routeId,
  ].filter((routeId) => typeof routeId === 'string' && routeId.trim() && routeId !== LEGACY_UNSCOPED_ROUTE_ID).map((routeId) => routeId.trim()))]
}

function stageEvidence(item, attempt) {
  return [...new Set([
    item.stage,
    item.body?.stage,
    attempt?.scoreResult?.stage,
    attempt?.courseStage,
    attempt?.academicStage,
    attempt?.stage === 'result' ? null : attempt?.stage,
  ].map(normalizeAcademicStage).filter(Boolean))]
}

export function normalizeSyncItem(item, { attemptsById = new Map() } = {}) {
  if (!item || item.method !== 'POST' || !/^\/api\/stem\/assignments\/[^/]+\/submissions$/.test(item.resource || '') || !item.idempotencyKey || !item.body?.idempotencyKey) return null
  const attemptId = String(item.attemptId || item.body.attemptId || '')
  const attempt = attemptsById.get(attemptId)
  const routeIds = routeEvidence(item, attempt)
  const stages = stageEvidence(item, attempt)
  const registeredRoute = routeIds.length === 1 ? routeById(routeIds[0]) : null
  let blockedReason = ''
  if (routeIds.length === 0) blockedReason = 'missing-route-id'
  else if (routeIds.length > 1) blockedReason = 'conflicting-route-ids'
  else if (!registeredRoute) blockedReason = 'unknown-route-id'
  else if (stages.length === 0) blockedReason = 'missing-stage'
  else if (stages.length > 1 || stages[0] !== registeredRoute.stage) blockedReason = 'route-stage-mismatch'

  const syncable = !blockedReason
  const routeId = registeredRoute?.routeId || (routeIds.length === 1 ? routeIds[0] : LEGACY_UNSCOPED_ROUTE_ID)
  const stage = stages.length === 1 ? stages[0] : null
  return {
    id: String(item.id || stableQueueId({ ...item, attemptId })),
    resource: String(item.resource),
    method: 'POST',
    idempotencyKey: String(item.idempotencyKey),
    attemptId,
    routeId,
    stage,
    syncable,
    syncStatus: syncable ? 'pending' : 'blocked',
    blockedReason: blockedReason || null,
    body: {
      idempotencyKey: String(item.body.idempotencyKey),
      attemptId: String(item.body.attemptId || attemptId),
      routeId,
      stage,
      rawMarks: Number(item.body.rawMarks),
      maxMarks: Number(item.body.maxMarks),
      percentage: Number(item.body.percentage),
      elapsedSeconds: Math.max(0, Number(item.body.elapsedSeconds) || 0),
      markingMode: String(item.body.markingMode || 'assisted'),
      reviewRequired: Boolean(item.body.reviewRequired),
    },
    createdAt: item.createdAt ? String(item.createdAt) : null,
    retryCount: Math.max(0, Number(item.retryCount) || 0),
    lastError: String(item.lastError || item.error || '').slice(0, 300),
    lastTriedAt: item.lastTriedAt ? String(item.lastTriedAt) : null,
  }
}

function normalizeGeneratedUnit(unit) {
  const binding = resolveRouteBinding(unit, { routes: courseRoutes })
  return { ...unit, routeId: binding.routeId, stage: binding.stage, routeBindingReason: binding.reason }
}

export function normalizeState(value, options = {}) {
  const persisted = value && typeof value === 'object' ? value : null
  const state = { ...structuredClone(fallbackState), ...(persisted || {}) }
  const inputProfile = persisted?.profile || null
  const requestedRoute = routeById(inputProfile?.activeRouteId)
  const activeRouteId = requestedRoute?.routeId || (persisted ? null : DEFAULT_ROUTE_ID)
  const preservedTrack = normalizeAcademicStage(inputProfile?.learningTrack)
  const recentRouteIds = [...new Set([activeRouteId, ...(inputProfile?.recentRouteIds || [])])]
    .filter((routeId) => routeId && routeById(routeId))
    .slice(0, 6)
  state.profile = {
    ...fallbackState.profile,
    ...(inputProfile || {}),
    activeRouteId,
    learningTrack: requestedRoute?.stage || preservedTrack || (persisted ? null : fallbackState.profile.learningTrack),
    recentRouteIds,
  }

  state.generatedUnits = (state.generatedUnits || []).map(normalizeGeneratedUnit)
  const suppliedUnits = Array.isArray(options.units) ? options.units : []
  const hasStaticUnitContext = Object.prototype.hasOwnProperty.call(options, 'units')
  const contextUnits = [...new Map([...state.generatedUnits, ...suppliedUnits].filter(Boolean).map((unit) => [unit.id, unit])).values()]
  const unitsById = new Map(contextUnits.map((unit) => [unit.id, unit]))
  state.drafts = Object.fromEntries(Object.entries(state.drafts || {}).map(([unitId, draft]) => {
    const unit = unitsById.get(unitId)
    if (!unit && !draft?.routeId) return [unitId, { ...draft, routeMigration: { status: 'deferred', reason: 'missing-unit-context' } }]
    const binding = resolveRouteBinding(draft, { unit, routes: courseRoutes })
    return [unitId, { ...draft, routeId: binding.routeId, stage: binding.stage, routeBindingReason: binding.reason }]
  }))

  const migrated = migrateLearningState(state, {
    units: contextUnits,
    routes: courseRoutes,
    deferMissingUnits: !hasStaticUnitContext,
  })
  migrated.completedSyncKeys = [...new Set(migrated.completedSyncKeys || [])].filter(Boolean).slice(-MAX_COMPLETED_SYNC_KEYS)
  const attemptsById = new Map((migrated.attempts || []).map((attempt) => [attempt.id, attempt]))
  migrated.syncQueue = Array.isArray(migrated.syncQueue)
    ? migrated.syncQueue.map((item) => normalizeSyncItem(item, { attemptsById })).filter(Boolean).filter((item) => !migrated.completedSyncKeys.includes(item.idempotencyKey)).slice(-MAX_SYNC_QUEUE)
    : []
  return migrated
}

export function mergeStoredState(current, next) {
  const completedSyncKeys = [...new Set([...(current.completedSyncKeys || []), ...(next.completedSyncKeys || [])])].slice(-MAX_COMPLETED_SYNC_KEYS)
  const currentAttempts = new Map((current.attempts || []).map((attempt) => [attempt.id, attempt]))
  const nextAttemptIds = new Set((next.attempts || []).map((attempt) => attempt.id))
  const attempts = [...(next.attempts || []).map((attempt) => {
    const persisted = currentAttempts.get(attempt.id)
    return persisted?.serverSync === 'synced' && attempt.serverSync !== 'synced'
      ? { ...attempt, serverSync: 'synced', serverSyncError: '', serverReceipt: persisted.serverReceipt }
      : attempt
  }), ...(current.attempts || []).filter((attempt) => !nextAttemptIds.has(attempt.id))]
  const syncedAttemptIds = new Set([...(current.attempts || []), ...attempts].filter((attempt) => attempt.serverSync === 'synced').map((attempt) => attempt.id))
  const queuedByKey = new Map([...(next.syncQueue || []), ...(current.syncQueue || [])].map((item) => [item.idempotencyKey, item]))
  const syncQueue = [...queuedByKey.values()]
    .filter((item) => !completedSyncKeys.includes(item.idempotencyKey) && !syncedAttemptIds.has(item.attemptId))
    .slice(-MAX_SYNC_QUEUE)
  return { ...next, attempts, syncQueue, completedSyncKeys }
}

export function loadState(options = {}) {
  try {
    if (!canUseStorage()) return normalizeState(null, options)
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      const previous = window.localStorage.getItem('alevel-learning-platform-v1')
      return normalizeState(previous ? JSON.parse(previous) : null, options)
    }
    return normalizeState(JSON.parse(raw), options)
  } catch {
    return normalizeState(null, options)
  }
}

export function saveState(nextState, { replaceSyncQueue = false, units } = {}) {
  if (!canUseStorage()) return
  const normalizeOptions = units === undefined ? {} : { units }
  let next = normalizeState(nextState, normalizeOptions)
  // UI state is saved frequently. Merge server receipts and completion
  // tombstones so a stale React render cannot resurrect a completed upload.
  if (!replaceSyncQueue) next = mergeStoredState(loadState(normalizeOptions), next)
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
}

function updateStoredState(update) {
  if (!canUseStorage()) return null
  const next = update(loadState())
  saveState(next, { replaceSyncQueue: true })
  return next
}

export function enqueueSharedSync(item) {
  const state = loadState()
  const attemptsById = new Map(state.attempts.map((attempt) => [attempt.id, attempt]))
  const nextItem = normalizeSyncItem({ ...item, createdAt: item.createdAt || new Date().toISOString() }, { attemptsById })
  if (!nextItem || state.completedSyncKeys.includes(nextItem.idempotencyKey)) return null
  const existing = state.syncQueue.find((queued) => queued.idempotencyKey === nextItem.idempotencyKey)
  if (existing) return existing.syncable ? existing : null
  updateStoredState((current) => ({ ...current, syncQueue: [...current.syncQueue, nextItem].slice(-MAX_SYNC_QUEUE) }))
  return nextItem.syncable ? nextItem : null
}

export function listPendingSharedSync() { return loadState().syncQueue.filter((item) => item.syncable) }

export function listBlockedSharedSync() { return loadState().syncQueue.filter((item) => !item.syncable) }

export function markSharedSyncAttempt(id, error) {
  updateStoredState((state) => ({ ...state, syncQueue: state.syncQueue.map((item) => item.id === id && item.syncable ? { ...item, retryCount: item.retryCount + 1, lastError: String(error || '').slice(0, 300), lastTriedAt: new Date().toISOString() } : item) }))
}

export function markSharedSyncComplete(id, receipt = {}) {
  updateStoredState((state) => {
    const completedItem = state.syncQueue.find((item) => item.id === id)
    const attemptId = receipt.attemptId || completedItem?.attemptId
    const completedSyncKeys = completedItem?.idempotencyKey
      ? [...new Set([...state.completedSyncKeys, completedItem.idempotencyKey])].slice(-MAX_COMPLETED_SYNC_KEYS)
      : state.completedSyncKeys
    return {
      ...state,
      completedSyncKeys,
      syncQueue: state.syncQueue.filter((item) => item.id !== id),
      attempts: state.attempts.map((attempt) => attempt.id === attemptId
        ? { ...attempt, serverSync: 'synced', serverSyncError: '', serverReceipt: { eventId: receipt.eventId || '', occurredAt: receipt.occurredAt || '' } }
        : attempt),
    }
  })
}

export function makeAttemptId() { return `att-${Date.now()}-${Math.random().toString(16).slice(2, 8)}` }
