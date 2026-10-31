export const COACH_TASK_SCHEMA_VERSION = 'stem-coach-task-v1'
export const COACH_TASK_ESTIMATE_VERSION = 'coach-duration-v1'
const EFFORTS = new Set(['low', 'high', 'max'])
const INITIAL_RANGES = Object.freeze({
  text: Object.freeze({ low: [8_000, 30_000], high: [15_000, 60_000], max: [25_000, 100_000] }),
  image: Object.freeze({ low: [12_000, 30_000], high: [20_000, 75_000], max: [30_000, 105_000] }),
})

const finiteTime = (value, fallback) => Number.isFinite(value) && value >= 0 ? Math.round(value) : fallback
const safeText = (value, max = 120) => String(value || '').replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, max)
const dimensions = profile => ({
  model: profile.model || null,
  effort: profile.effectiveEffort || null,
  inputKind: profile.inputKind,
  helpIntent: profile.helpIntent,
})
const source = (kind, profile, sampleCount = 0, method = null) => ({
  kind,
  version: COACH_TASK_ESTIMATE_VERSION,
  sampleCount,
  maxSamples: 20,
  method,
  dimensions: dimensions(profile),
})
const percentile = (sorted, fraction) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]

export function normalizeCoachTaskProfile(value = {}) {
  const requestedEffort = EFFORTS.has(value.requestedEffort) ? value.requestedEffort : null
  const effectiveEffort = EFFORTS.has(value.effectiveEffort) ? value.effectiveEffort : 'low'
  const inputKind = value.inputKind === 'image' ? 'image' : 'text'
  const persistenceMode = value.persistenceMode === 'saved' || value.persistenceMode === 'instant' || value.persistenceMode === 'legacy'
    ? value.persistenceMode
    : value.saved === true ? 'saved' : Number(value.retentionMs) === 600_000 ? 'instant' : 'legacy'
  const defaultRetention = persistenceMode === 'saved' ? 259_200_000 : persistenceMode === 'instant' ? 600_000 : 86_400_000
  return {
    requestedEffort,
    effectiveEffort,
    thinkingEnabled: Boolean(value.thinkingEnabled),
    inputKind,
    imageCount: inputKind === 'image' ? Math.max(1, Math.min(4, Number(value.imageCount) || 1)) : 0,
    helpIntent: safeText(value.helpIntent, 40) || 'unknown',
    provider: safeText(value.provider, 40) || null,
    model: safeText(value.model, 120) || null,
    saved: persistenceMode === 'saved',
    retentionMs: Math.max(1_000, Math.min(604_800_000, Number(value.retentionMs) || defaultRetention)),
    persistenceMode,
  }
}

export function estimateCoachDuration(profileValue, durationValues = []) {
  const profile = normalizeCoachTaskProfile(profileValue)
  const samples = durationValues
    .filter(value => Number.isFinite(value) && value >= 100 && value <= 600_000)
    .map(Math.round)
    .slice(0, 20)
    .sort((a, b) => a - b)
  if (samples.length >= 5) {
    return {
      status: 'calibrated',
      totalMs: { lower: percentile(samples, 0.25), upper: percentile(samples, 0.90) },
      remainingMs: null,
      exceededByMs: null,
      source: source('cohort', profile, samples.length, 'p25-p90'),
    }
  }
  const [lower, upper] = INITIAL_RANGES[profile.inputKind][profile.effectiveEffort]
  return {
    status: 'initial',
    totalMs: { lower, upper },
    remainingMs: null,
    exceededByMs: null,
    source: source('initial', profile),
  }
}

export function createCoachTask(profileValue, acceptedAt, estimate = null) {
  const profile = normalizeCoachTaskProfile(profileValue)
  const at = finiteTime(acceptedAt, Date.now())
  return {
    schemaVersion: COACH_TASK_SCHEMA_VERSION,
    stage: { code: 'accepted', changedAt: at },
    reasoning: {
      requestedEffort: profile.requestedEffort,
      effectiveEffort: profile.effectiveEffort,
      enabled: profile.thinkingEnabled,
      activityObserved: false,
    },
    input: { kind: profile.inputKind, imageCount: profile.imageCount },
    helpIntent: profile.helpIntent,
    model: { provider: profile.provider, id: profile.model },
    persistence: { saved: profile.saved, retentionMs: profile.retentionMs },
    milestones: {
      acceptedAt: at,
      processingStartedAt: null,
      providerRequestedAt: null,
      providerRespondedAt: null,
      reasoningActivityAt: null,
      firstAnswerAt: null,
      completedAt: null,
    },
    estimate: estimate || estimateCoachDuration(profile),
  }
}

export function parseCoachTask(value) {
  try {
    const task = typeof value === 'string' ? JSON.parse(value) : value
    return task?.schemaVersion === COACH_TASK_SCHEMA_VERSION ? task : null
  } catch {
    return null
  }
}

export function applyCoachTaskEvent(taskValue, event = {}, fallbackAt = Date.now()) {
  const parsed = parseCoachTask(taskValue)
  if (!parsed) return null
  const task = structuredClone(parsed)
  const at = finiteTime(event.at, finiteTime(fallbackAt, Date.now()))
  const stage = code => { task.stage = { code, changedAt: at } }
  const first = key => { if (task.milestones[key] === null) task.milestones[key] = at }
  switch (event.type) {
    case 'preparing': stage('preparing'); first('processingStartedAt'); break
    case 'requesting_model':
      if(task.stage.code==='requesting_model'&&(!event.provider||safeText(event.provider,40)===task.model.provider)&&(!event.model||safeText(event.model,120)===task.model.id))return task
      stage('requesting_model'); first('providerRequestedAt')
      if (event.provider) task.model.provider = safeText(event.provider, 40) || task.model.provider
      if (event.model) task.model.id = safeText(event.model, 120) || task.model.id
      break
    case 'request_sent': stage('waiting_response'); first('providerRequestedAt'); break
    case 'response_headers': if(task.milestones.providerRespondedAt!==null&&task.stage.code==='waiting_response')return task;stage('waiting_response'); first('providerRespondedAt'); break
    case 'reasoning_activity': if(task.reasoning.activityObserved)return task;stage('thinking'); task.reasoning.activityObserved = true; first('reasoningActivityAt'); break
    case 'answer_delta': if(task.milestones.firstAnswerAt!==null&&task.stage.code==='answering')return task;stage('answering'); first('firstAnswerAt'); break
    case 'stream_complete':
    case 'finalizing': if(task.stage.code==='finalizing')return task;stage('finalizing'); break
    case 'local':
      stage('finalizing')
      task.reasoning = { requestedEffort: task.reasoning.requestedEffort, effectiveEffort: null, enabled: false, activityObserved: false }
      task.model = { provider: null, id: null }
      task.estimate = { status: 'unavailable', totalMs: null, remainingMs: null, exceededByMs: null, source: { ...task.estimate.source, sampleCount: 0 } }
      break
    case 'complete':
      stage('complete'); first('completedAt')
      task.estimate = { ...task.estimate, status: 'complete', remainingMs: { lower: 0, upper: 0 }, exceededByMs: null }
      break
    case 'failed':
    case 'interrupted':
      stage(event.type); first('completedAt')
      task.estimate = { ...task.estimate, status: 'unavailable', remainingMs: null, exceededByMs: null }
      break
    default: return task
  }
  return task
}

export function taskSnapshot(taskValue, { now = Date.now(), status = 'running' } = {}) {
  const task = parseCoachTask(taskValue)
  if (!task) return null
  const snapshot = structuredClone(task)
  if (status !== 'running' || !['initial', 'calibrated'].includes(snapshot.estimate.status) || !snapshot.estimate.totalMs) return snapshot
  const elapsed = Math.max(0, finiteTime(now, Date.now()) - snapshot.milestones.acceptedAt)
  const total = snapshot.estimate.totalMs
  if (elapsed > total.upper) {
    snapshot.estimate.status = 'exceeded'
    snapshot.estimate.remainingMs = null
    snapshot.estimate.exceededByMs = elapsed - total.upper
  } else {
    snapshot.estimate.remainingMs = { lower: Math.max(0, total.lower - elapsed), upper: Math.max(0, total.upper - elapsed) }
    snapshot.estimate.exceededByMs = null
  }
  return snapshot
}

export function legacyCoachTask(row, now = Date.now()) {
  const at = finiteTime(row?.created, finiteTime(now, Date.now()))
  const terminal = ['succeeded', 'failed', 'interrupted'].includes(row?.status)
  const code = row?.status === 'succeeded' ? 'complete' : row?.status === 'failed' ? 'failed' : row?.status === 'interrupted' ? 'interrupted' : 'preparing'
  return {
    schemaVersion: COACH_TASK_SCHEMA_VERSION,
    stage: { code, changedAt: finiteTime(row?.updated, at) },
    reasoning: { requestedEffort: null, effectiveEffort: null, enabled: false, activityObserved: false },
    input: { kind: 'text', imageCount: 0 },
    helpIntent: 'unknown',
    model: { provider: null, id: null },
    persistence: { saved: false, retentionMs: Math.max(1_000, finiteTime(row?.expires, at) - at) },
    milestones: {
      acceptedAt: at,
      processingStartedAt: null,
      providerRequestedAt: null,
      providerRespondedAt: null,
      reasoningActivityAt: null,
      firstAnswerAt: null,
      completedAt: terminal ? finiteTime(row?.updated, at) : null,
    },
    estimate: {
      status: terminal && row?.status === 'succeeded' ? 'complete' : 'unavailable',
      totalMs: null,
      remainingMs: null,
      exceededByMs: null,
      source: {
        kind: 'legacy',
        version: COACH_TASK_ESTIMATE_VERSION,
        sampleCount: 0,
        maxSamples: 20,
        method: null,
        dimensions: { model: null, effort: null, inputKind: 'text', helpIntent: 'unknown' },
      },
    },
  }
}
