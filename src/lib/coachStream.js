const COACH_STREAM_EVENTS = new Set(['meta', 'delta', 'reset', 'done'])

function protocolError() {
  const error = new Error('AI Coach returned an invalid response stream.')
  error.code = 'coach_stream_protocol_invalid'
  return error
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function parseCoachStreamEvent(rawEvent) {
  const lines = String(rawEvent || '').split(/\r?\n/)
  const dataLines = lines.filter((line) => line.startsWith('data:'))
  if (!dataLines.length) {
    if (lines.every((line) => !line.trim() || line.startsWith(':'))) return null
    throw protocolError()
  }

  const eventLines = lines.filter((line) => line.startsWith('event:'))
  if (eventLines.length !== 1) throw protocolError()
  const eventName = eventLines[0].slice(6).trim()
  if (!COACH_STREAM_EVENTS.has(eventName)) throw protocolError()

  let payload
  try {
    payload = JSON.parse(dataLines.map((line) => line.slice(5).trimStart()).join('\n'))
  } catch {
    throw protocolError()
  }
  if (!isRecord(payload)) throw protocolError()

  if (eventName === 'delta' && typeof payload.text !== 'string') throw protocolError()
  if (eventName === 'meta' && (typeof payload.mode !== 'string' || typeof payload.providerStatus !== 'string')) throw protocolError()
  if (eventName === 'reset' && Object.hasOwn(payload, 'provider') && typeof payload.provider !== 'string') throw protocolError()
  if (eventName === 'done') {
    if (typeof payload.mode !== 'string' || typeof payload.providerStatus !== 'string' || typeof payload.answer !== 'string') throw protocolError()
    if (Object.hasOwn(payload, 'retryable') && typeof payload.retryable !== 'boolean') throw protocolError()
    if (Object.hasOwn(payload, 'partial') && typeof payload.partial !== 'boolean') throw protocolError()
  }

  return { eventName, payload }
}

export function createCoachStreamParser() {
  let completed = false
  return (rawEvent) => {
    if (completed) throw protocolError()
    const parsed = parseCoachStreamEvent(rawEvent)
    if (parsed?.eventName === 'done') completed = true
    return parsed
  }
}

/**
 * Classifies an interrupted browser SSE read without treating an upstream
 * transport abort as a student-initiated cancellation.
 */
export function coachStreamFailureState({
  error,
  streamedAnswer = '',
  requestAborted = false,
  requestSuperseded = false,
  streamCompleted = false,
} = {}) {
  if (requestAborted || requestSuperseded || streamCompleted) {
    return { ignored: true, retryable: false }
  }

  const partialAnswer = String(streamedAnswer || '').trim()
  const warning = String(error?.message || '').trim()
  const interrupted = error?.name === 'AbortError'
  return {
    ignored: false,
    retryable: true,
    content: partialAnswer || (interrupted
      ? 'The response stream was interrupted before it completed.'
      : 'AI Coach is temporarily unavailable.'),
    mode: partialAnswer ? 'interrupted' : 'offline',
    status: partialAnswer ? 'interrupted' : 'failed',
    warning,
  }
}
