const STORAGE_KEY = 'alevel-learning-platform-v2'
const MAX_SYNC_QUEUE = 50

const fallbackState = {
  profile: { role: 'student', learningTrack: 'AS', learnerName: '', schoolName: '', targetGrade: 'A', examBoard: 'Cambridge International', weeklyQuestions: 18, deadline: '2026-10-15', preferredMode: 'Topics' },
  attempts: [], drafts: {}, paperDrafts: {}, paperSessions: [], paperReviews: [], recentPapers: [], recentPractice: [], favoriteUnitIds: [], generatedUnits: [], assignments: [], classrooms: [], syncQueue: [],
}

function canUseStorage() {
  return typeof window !== 'undefined' && Boolean(window.localStorage)
}

function normalizeSyncItem(item) {
  if (!item || item.method !== 'POST' || !/^\/api\/stem\/assignments\/[^/]+\/submissions$/.test(item.resource || '') || !item.idempotencyKey || !item.body?.idempotencyKey) return null
  return {
    id: String(item.id || `sync-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`), resource: String(item.resource), method: 'POST', idempotencyKey: String(item.idempotencyKey), attemptId: String(item.attemptId || ''),
    body: { idempotencyKey: String(item.body.idempotencyKey), attemptId: String(item.body.attemptId || ''), rawMarks: Number(item.body.rawMarks), maxMarks: Number(item.body.maxMarks), percentage: Number(item.body.percentage), elapsedSeconds: Math.max(0, Number(item.body.elapsedSeconds) || 0), markingMode: String(item.body.markingMode || 'assisted'), reviewRequired: Boolean(item.body.reviewRequired) },
    createdAt: String(item.createdAt || new Date().toISOString()), retryCount: Math.max(0, Number(item.retryCount) || 0), lastError: String(item.lastError || '').slice(0, 300), lastTriedAt: item.lastTriedAt ? String(item.lastTriedAt) : null,
  }
}

function normalizeState(value) {
  const state = { ...structuredClone(fallbackState), ...(value || {}) }
  state.syncQueue = Array.isArray(state.syncQueue) ? state.syncQueue.map(normalizeSyncItem).filter(Boolean).slice(-MAX_SYNC_QUEUE) : []
  return state
}

export function loadState() {
  try {
    if (!canUseStorage()) return structuredClone(fallbackState)
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      const previous = window.localStorage.getItem('alevel-learning-platform-v1')
      return normalizeState(previous ? JSON.parse(previous) : null)
    }
    return normalizeState(JSON.parse(raw))
  } catch {
    return structuredClone(fallbackState)
  }
}

export function saveState(nextState, { replaceSyncQueue = false } = {}) {
  if (!canUseStorage()) return
  const next = normalizeState(nextState)
  // UI state is intentionally saved often. Preserve queue entries and receipts
  // written by a background retry between two React renders.
  if (!replaceSyncQueue) {
    const current = loadState()
    const queuedByKey = new Map([...current.syncQueue, ...next.syncQueue].map((item) => [item.idempotencyKey, item]))
    next.syncQueue = [...queuedByKey.values()].slice(-MAX_SYNC_QUEUE)
    const currentAttempts = new Map(current.attempts.map((attempt) => [attempt.id, attempt]))
    next.attempts = next.attempts.map((attempt) => {
      const persisted = currentAttempts.get(attempt.id)
      return persisted?.serverSync === 'synced' && attempt.serverSync !== 'synced'
        ? { ...attempt, serverSync: 'synced', serverSyncError: '', serverReceipt: persisted.serverReceipt }
        : attempt
    })
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
}

function updateStoredState(update) {
  if (!canUseStorage()) return null
  const next = update(loadState())
  saveState(next, { replaceSyncQueue: true })
  return next
}

export function enqueueSharedSync(item) {
  const nextItem = normalizeSyncItem({ ...item, createdAt: new Date().toISOString() })
  if (!nextItem) return null
  updateStoredState((state) => {
    const existing = state.syncQueue.find((queued) => queued.idempotencyKey === nextItem.idempotencyKey)
    if (existing) return state
    return { ...state, syncQueue: [...state.syncQueue, nextItem].slice(-MAX_SYNC_QUEUE) }
  })
  return nextItem
}

export function listPendingSharedSync() { return loadState().syncQueue }

export function markSharedSyncAttempt(id, error) {
  updateStoredState((state) => ({ ...state, syncQueue: state.syncQueue.map((item) => item.id === id ? { ...item, retryCount: item.retryCount + 1, lastError: String(error || '').slice(0, 300), lastTriedAt: new Date().toISOString() } : item) }))
}

export function markSharedSyncComplete(id, receipt = {}) {
  updateStoredState((state) => ({
    ...state,
    syncQueue: state.syncQueue.filter((item) => item.id !== id),
    attempts: state.attempts.map((attempt) => attempt.id === receipt.attemptId || attempt.id === state.syncQueue.find((item) => item.id === id)?.attemptId
      ? { ...attempt, serverSync: 'synced', serverSyncError: '', serverReceipt: { eventId: receipt.eventId || '', occurredAt: receipt.occurredAt || '' } }
      : attempt),
  }))
}

export function makeAttemptId() { return `att-${Date.now()}-${Math.random().toString(16).slice(2, 8)}` }
