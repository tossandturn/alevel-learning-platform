import crypto from 'node:crypto'
import path from 'node:path'

import {
  createTavernConversationStore,
  resolveTavernMemoryRoot,
} from './tavernConversationStore.js'

export const ADMISSIONS_ADVISOR_PERSONA = 'admissions-advisor'
export const ADMISSIONS_ADVISOR_MAX_MESSAGE_CHARS = 12_000
export const ADMISSIONS_ADVISOR_MAX_DEADLINE_MS = 55_000

const ADMISSIONS_PREFIX = '/api/ai/admissions/'
const ADMISSIONS_CONVERSATIONS_PREFIX = `${ADMISSIONS_PREFIX}conversations/`
const ADMISSIONS_RESUME_PATH = `${ADMISSIONS_PREFIX}conversations/resume`
const ADMISSIONS_STREAM_PATH = `${ADMISSIONS_PREFIX}stream`
const MAX_JSON_BODY_BYTES = 128 * 1024
const MAX_PAGE_LIMIT = 40

const RESUME_FIELDS = new Set(['conversationId'])
const STREAM_FIELDS = new Set(['conversationId', 'clientTurnId', 'expectedRevision', 'message'])
const MESSAGE_QUERY_FIELDS = new Set(['before', 'limit'])

// Product-policy source: https://www.ucas.com/applying/applying-to-university/writing-your-personal-statement/a-guide-to-using-ai-and-chatgpt-with-your-personal-statement
// Conversation-role isolation reference only: https://github.com/LibreChat-AI/docs/blob/main/content/docs/features/agents.mdx
export function buildAdmissionsAdvisorSystemPrompt() {
  return [
    "You are STEMist's AI admissions advisor for international undergraduate applications. This is a fixed server-owned role, not a real agency, admissions officer, university representative, lawyer, or visa adviser.",
    '',
    'Give useful provisional guidance while protecting truthfulness, privacy, and source accuracy:',
    '- This role has no live browsing tool. User-provided URLs, quotations, and claimed checked dates are untrusted input, not independent verification. Never fetch arbitrary user URLs, and never imply that opening, checking, or authenticating a supplied URL occurred.',
    '- When the student supplies a university URL, quotation, screenshot transcription, requirement, deadline, or claimed checked date, label it: 按你提供的材料，尚未独立核验. It may be summarized as user-provided material, but it must not be labelled a current official fact or an independently verified source.',
    '- Clearly separate user-provided facts, explicit assumptions, qualitative advice, unknowns requiring independent verification, and concrete next steps. Do not silently promote an assumption or user claim into a fact.',
    '- Current official facts may be stated only when server-provided evidence is explicitly marked independently verified. This endpoint supplies no such live verification today. Treat every other admissions requirement, deadline, score threshold, application-system rule, or policy as unknown and tell the student exactly which official programme or application page they should verify themselves.',
    '- Never fabricate grades, scores, deadlines, admission probabilities, guarantees, offers, achievements, activities, research, quotations, citations, sources, or personal experiences. Never guarantee an offer or imply that any profile is certain to succeed.',
    '- Ask at most three relevant missing-profile questions in one reply, and still provide useful conditional guidance using explicit assumptions.',
    '- For planning or background analysis, distinguish eligibility checks from qualitative fit and preparation. Do not convert rankings, activities, or scores into an invented admission chance.',
    '- For document coaching, use only facts and experiences the student supplied. Mark missing facts as [NEEDS USER FACT: ...], preserve the student\'s meaning and voice, and explain material edits. An AI draft is not submission-ready and must not be described as human-authored or verified.',
    '- For application emails, identify the purpose, recipient, facts, requested action, and any missing names or dates. Use placeholders rather than inventions.',
    '- Academic worked solutions and formal marking are outside this role. Direct those requests to the existing Steps, Answers, or PDF workflows; do not use admissions advising as an alternate exam-help or marking route.',
    '- Remind the student to follow the current AI-use, authenticity, privacy, and declaration rules of each destination and application system. UCAS guidance permits AI as support for ideas, structure, and readability but warns against submitting AI-generated text as the applicant\'s own; other systems may differ and must be checked.',
    '- Do not infer or import Tavern history, study attempts, grades, photographs, files, or data from another account or product. Use only text in this admissions conversation.',
    '- Do not claim to have browsed, researched, contacted a university, or verified a source unless that evidence is actually present in the conversation.',
    '',
    'Reply in the student\'s language unless they request another language. Prefer concise headings and actionable bullets; do not bury unknowns or policy warnings.',
  ].join('\n')
}

function advisorError(statusCode, code, message, extra = {}) {
  return Object.assign(new Error(message), { statusCode, code, ...extra })
}

function sendJson(response, statusCode, value) {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(value))
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let bytes = 0
    let settled = false
    request.on('data', (chunk) => {
      if (settled) return
      bytes += chunk.length
      if (bytes > MAX_JSON_BODY_BYTES) {
        settled = true
        reject(advisorError(413, 'admissions_request_too_large', 'Admissions request body is too large.'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (settled) return
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        settled = true
        resolve(value)
      } catch {
        settled = true
        reject(advisorError(400, 'admissions_request_invalid', 'Admissions request body must be valid JSON.'))
      }
    })
    request.on('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
  })
}

function objectPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw advisorError(400, 'admissions_request_invalid', 'Admissions request must be a JSON object.')
  }
  return value
}

function assertAllowedFields(payload, allowed) {
  if (Object.keys(payload).some((key) => !allowed.has(key))) {
    throw advisorError(400, 'admissions_request_invalid', 'Admissions request contains unsupported fields.')
  }
}

function boundedIdentifier(value, label, { optional = false } = {}) {
  if ((value === undefined || value === '') && optional) return ''
  if (typeof value !== 'string') {
    throw advisorError(400, 'admissions_request_invalid', `${label} must be a bounded scalar identifier.`)
  }
  const clean = value.trim()
  if (!/^[A-Za-z0-9._:-]{8,180}$/.test(clean)) {
    throw advisorError(400, 'admissions_request_invalid', `${label} must be a bounded scalar identifier.`)
  }
  return clean
}

function assertNoQuery(requestUrl) {
  if ([...requestUrl.searchParams.keys()].length) {
    throw advisorError(400, 'admissions_request_invalid', 'This admissions route does not accept query parameters.')
  }
}

function admissionsMessage(value) {
  if (typeof value !== 'string') {
    throw advisorError(400, 'admissions_message_invalid', 'Admissions message must be text.')
  }
  const clean = value.replaceAll(String.fromCharCode(0), '').replace(/\r\n?/g, '\n').trim()
  if (!clean) throw advisorError(400, 'admissions_message_invalid', 'Add an admissions message before sending.')
  if (Array.from(clean).length > ADMISSIONS_ADVISOR_MAX_MESSAGE_CHARS) {
    throw advisorError(413, 'admissions_message_too_large', `Admissions messages are limited to ${ADMISSIONS_ADVISOR_MAX_MESSAGE_CHARS.toLocaleString('en-US')} characters.`)
  }
  return clean
}

function logicalRequestHash({ conversationId, clientTurnId, message }) {
  return crypto.createHash('sha256').update(JSON.stringify({
    feature: 'admissions',
    persona: ADMISSIONS_ADVISOR_PERSONA,
    conversationId,
    clientTurnId,
    message,
  })).digest('hex')
}

function safeStoreError(error) {
  const originalCode = String(error?.code || '')
  if (!originalCode.startsWith('tavern_') && !originalCode.startsWith('coach_tavern_')) return error
  const code = originalCode
    .replace(/^coach_tavern_/, 'admissions_')
    .replace(/^tavern_/, 'admissions_')
  const messages = {
    admissions_memory_unavailable: 'Admissions conversation storage is unavailable.',
    admissions_conversation_not_found: 'This admissions conversation is not available.',
    admissions_conversation_deleted: 'This admissions conversation was deleted and cannot be restored.',
    admissions_conversation_persona_mismatch: 'This conversation does not belong to the admissions advisor.',
    admissions_turn_idempotency_conflict: 'This clientTurnId is already bound to a different admissions request.',
    admissions_turn_in_progress: 'This admissions turn is already being processed.',
    admissions_conversation_revision_conflict: 'The admissions conversation changed on another client.',
    admissions_turn_lease_conflict: 'This admissions turn is no longer current.',
    admissions_generated_result_pending: 'A generated admissions answer must be saved before another message can be sent.',
    admissions_storage_quota_exceeded: 'Admissions conversation storage is full. This turn was not committed.',
    admissions_physical_quota_exceeded: 'Admissions conversation storage is full. This turn was not committed.',
    admissions_storage_headroom_insufficient: 'Admissions conversation storage does not have safe disk headroom.',
    admissions_cursor_invalid: 'The admissions message cursor is invalid.',
  }
  return advisorError(
    Number(error?.statusCode) || 500,
    code,
    messages[code] || 'The admissions conversation request could not be completed.',
    {
      ...(error?.retryable !== undefined ? { retryable: Boolean(error.retryable) } : {}),
      ...(Number.isInteger(error?.currentRevision) ? { currentRevision: error.currentRevision } : {}),
    },
  )
}

function storeCall(operation) {
  try {
    return operation()
  } catch (error) {
    throw safeStoreError(error)
  }
}

function startSse(response) {
  response.statusCode = 200
  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  response.setHeader('Cache-Control', 'no-cache, no-transform')
  response.setHeader('Connection', 'keep-alive')
  response.setHeader('X-Accel-Buffering', 'no')
  response.flushHeaders?.()
}

function sendSseEvent(response, event, value) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`)
}

function sendSseEventOrThrow(response, event, value) {
  try {
    sendSseEvent(response, event, value)
  } catch (error) {
    error.code = 'ADMISSIONS_RESPONSE_TRANSPORT'
    throw error
  }
}

function finishCommittedStream(response, payload) {
  try {
    sendSseEvent(response, 'done', payload)
    response.end()
  } catch {
    try { if (!response.writableEnded && !response.destroyed) response.end() } catch { /* Canonical result is committed. */ }
  }
}

function finishUncommittedStream(response, payload) {
  try {
    if (!response.writableEnded && !response.destroyed) sendSseEvent(response, 'done', payload)
  } catch { /* The failure is already bounded and the client transport may be gone. */ }
  try { if (!response.writableEnded && !response.destroyed) response.end() } catch { /* Nothing else can be delivered. */ }
}

function assistantState(state, status, content = '') {
  return {
    conversation: state.conversation,
    turns: state.turns.map((turn) => turn.role === 'assistant'
      ? { ...turn, content, status }
      : turn),
  }
}

function publicTurnState(state, clientTurnId) {
  return {
    conversation: state.conversation,
    clientTurnId,
    turns: state.turns,
  }
}

function providerFailurePayload({ state, clientTurnId, answer = '', provider = null, partial = false, code }) {
  return {
    mode: partial ? 'interrupted' : 'unavailable',
    provider: provider?.name || undefined,
    providerStatus: provider ? 'error' : 'not_configured',
    answer,
    clientTurnId,
    conversation: state.conversation,
    turns: state.turns,
    code,
    retryable: true,
    partial,
    warning: partial
      ? 'The AI stream ended before a complete admissions answer was generated. Retry this turn.'
      : 'AI admissions guidance is temporarily unavailable. Retry this turn.',
  }
}

function pageRequest(requestUrl) {
  const keys = [...requestUrl.searchParams.keys()]
  if (keys.some((key) => !MESSAGE_QUERY_FIELDS.has(key))
    || [...MESSAGE_QUERY_FIELDS].some((key) => requestUrl.searchParams.getAll(key).length > 1)) {
    throw advisorError(400, 'admissions_request_invalid', 'Admissions message request contains unsupported query parameters.')
  }
  const rawLimit = requestUrl.searchParams.get('limit') || '40'
  if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > MAX_PAGE_LIMIT) {
    throw advisorError(400, 'admissions_page_limit_invalid', 'Admissions message page limit must be an integer from 1 to 40.')
  }
  return {
    before: requestUrl.searchParams.get('before') || '',
    limit: Number(rawLimit),
  }
}

function conversationIdFromPath(requestUrl, { messages = false } = {}) {
  const suffix = messages ? '/messages' : ''
  const raw = requestUrl.pathname.slice(ADMISSIONS_CONVERSATIONS_PREFIX.length, suffix ? -suffix.length : undefined)
  if (!raw || raw.includes('/')) throw advisorError(400, 'admissions_request_invalid', 'Admissions conversation ID is invalid.')
  try {
    return boundedIdentifier(decodeURIComponent(raw), 'conversationId')
  } catch (error) {
    if (error instanceof URIError) throw advisorError(400, 'admissions_request_invalid', 'Admissions conversation ID is invalid.')
    throw error
  }
}

export function resolveAdmissionsMemoryRoot(env = {}, cwd = process.cwd(), baseMemoryRoot = null) {
  const explicit = String(env.STEM_ADMISSIONS_MEMORY_ROOT || '').trim()
  if (explicit) return path.resolve(explicit)
  return path.join(path.resolve(baseMemoryRoot || resolveTavernMemoryRoot(env, cwd)), 'admissions')
}

export function createAdmissionsAdvisor({
  env = process.env,
  providerCandidates = [],
  timeoutConfig = {},
  telemetry = null,
  authorizeCoachRequest = null,
  authenticateRequest,
  conversationStore = null,
  memoryRoot = null,
  baseMemoryRoot = null,
  callCompatibleAiStream,
} = {}) {
  if (typeof authenticateRequest !== 'function') throw new Error('Admissions advisor requires the current STEM authenticator.')
  if (typeof callCompatibleAiStream !== 'function') throw new Error('Admissions advisor requires the canonical compatible AI stream transport.')
  const candidates = Array.isArray(providerCandidates) ? [...providerCandidates] : []
  const providerTimeoutMs = Math.min(45_000, Math.max(250, Number(timeoutConfig.providerTimeoutMs) || 25_000))
  const totalDeadlineMs = Math.min(ADMISSIONS_ADVISOR_MAX_DEADLINE_MS, Math.max(250, Number(timeoutConfig.totalDeadlineMs) || 50_000))
  let activeStore = conversationStore
  const volatileGeneratedResults = new Map()

  const generatedResultKey = (ownerId, conversationId, clientTurnId) => `${ownerId}\u0000${conversationId}\u0000${clientTurnId}`
  const rememberGeneratedResult = (receipt) => {
    const key = generatedResultKey(receipt.ownerId, receipt.conversation.id, receipt.clientTurnId)
    if (volatileGeneratedResults.has(key)) volatileGeneratedResults.delete(key)
    volatileGeneratedResults.set(key, receipt)
    while (volatileGeneratedResults.size > 128) volatileGeneratedResults.delete(volatileGeneratedResults.keys().next().value)
    return receipt
  }
  const forgetGeneratedResult = (ownerId, conversationId, clientTurnId) => {
    volatileGeneratedResults.delete(generatedResultKey(ownerId, conversationId, clientTurnId))
  }
  const forgetConversationResults = (ownerId, conversationId) => {
    const prefix = `${ownerId}\u0000${conversationId}\u0000`
    for (const key of volatileGeneratedResults.keys()) if (key.startsWith(prefix)) volatileGeneratedResults.delete(key)
  }
  const volatileGeneratedResult = ({ ownerId, conversationId, clientTurnId, message, requestHash }) => {
    const receipt = volatileGeneratedResults.get(generatedResultKey(ownerId, conversationId, clientTurnId)) || null
    if (!receipt) return null
    if (receipt.requestHash !== requestHash || receipt.message !== message) {
      throw advisorError(409, 'admissions_turn_idempotency_conflict', 'This clientTurnId is already bound to a different admissions request.')
    }
    return receipt
  }

  const store = () => {
    if (!activeStore) {
      activeStore = createTavernConversationStore({
        root: memoryRoot || resolveAdmissionsMemoryRoot(env, process.cwd(), baseMemoryRoot),
        databaseFilename: 'admissions.sqlite',
        allowedPersonas: [ADMISSIONS_ADVISOR_PERSONA],
        generatedResultReceipts: true,
        rejectDeleteWhilePending: true,
      })
    }
    return activeStore
  }

  async function authorize(request) {
    const ownerId = authenticateRequest(request)
    if (!ownerId) throw advisorError(401, 'coach_auth_required', 'Sign in to STEM before using the admissions advisor.')
    const authorization = typeof authorizeCoachRequest === 'function'
      ? await authorizeCoachRequest({ request, payload: { feature: 'admissions', persona: ADMISSIONS_ADVISOR_PERSONA } })
      : null
    if (authorization?.coachAccess?.assessmentState === 'active-exam'
      || (authorization?.paperStudyMode === 'exam-simulation' && !authorization?.submitted)) {
      throw advisorError(403, 'coach_exam_in_progress', 'AI Coach is unavailable until the exam simulation is submitted.')
    }
    return ownerId
  }

  async function resumeConversation(request, response) {
    const payload = objectPayload(await readJsonBody(request))
    assertAllowedFields(payload, RESUME_FIELDS)
    const conversationId = boundedIdentifier(payload.conversationId, 'conversationId', { optional: true })
    const ownerId = await authorize(request)
    let conversation = storeCall(() => store().resumeConversation({
      ownerId,
      persona: ADMISSIONS_ADVISOR_PERSONA,
      conversationId,
    }))
    const recovered = storeCall(() => store().recoverGeneratedResult({
      ownerId,
      persona: ADMISSIONS_ADVISOR_PERSONA,
      conversationId: conversation.id,
    }))
    if (recovered) {
      conversation = recovered.conversation
      forgetGeneratedResult(ownerId, conversation.id, recovered.clientTurnId)
    }
    const page = storeCall(() => store().getMessages({
      ownerId,
      persona: ADMISSIONS_ADVISOR_PERSONA,
      conversationId: conversation.id,
      limit: MAX_PAGE_LIMIT,
    }))
    sendJson(response, 200, page)
  }

  async function getMessages(requestUrl, request, response) {
    const conversationId = conversationIdFromPath(requestUrl, { messages: true })
    const page = pageRequest(requestUrl)
    const ownerId = await authorize(request)
    sendJson(response, 200, storeCall(() => store().getMessages({
      ownerId,
      persona: ADMISSIONS_ADVISOR_PERSONA,
      conversationId,
      ...page,
    })))
  }

  async function deleteConversation(requestUrl, request, response) {
    if ([...requestUrl.searchParams.keys()].length) {
      throw advisorError(400, 'admissions_request_invalid', 'Admissions delete request does not accept query parameters.')
    }
    const conversationId = conversationIdFromPath(requestUrl)
    const ownerId = await authorize(request)
    const result = storeCall(() => store().deleteConversation({
      ownerId,
      persona: ADMISSIONS_ADVISOR_PERSONA,
      conversationId,
    }))
    forgetConversationResults(ownerId, conversationId)
    sendJson(response, 200, result)
  }

  async function streamConversation(request, response) {
    const payload = objectPayload(await readJsonBody(request))
    assertAllowedFields(payload, STREAM_FIELDS)
    if ([...STREAM_FIELDS].some((field) => !Object.hasOwn(payload, field))) {
      throw advisorError(400, 'admissions_request_invalid', 'conversationId, clientTurnId, expectedRevision and message are required.')
    }
    const conversationId = boundedIdentifier(payload.conversationId, 'conversationId')
    const clientTurnId = boundedIdentifier(payload.clientTurnId, 'clientTurnId')
    if (!Number.isInteger(payload.expectedRevision) || payload.expectedRevision < 0) {
      throw advisorError(400, 'admissions_request_invalid', 'expectedRevision must be a non-negative integer.')
    }
    const message = admissionsMessage(payload.message)
    const ownerId = await authorize(request)
    const requestHash = logicalRequestHash({ conversationId, clientTurnId, message })
    const completedReplay = storeCall(() => store().replayCompletedTurn({
      ownerId,
      persona: ADMISSIONS_ADVISOR_PERSONA,
      conversationId,
      clientTurnId,
      message,
      requestHash,
    }))
    let receiptReadError = null
    let generatedReceipt = null
    if (!completedReplay) {
      try {
        generatedReceipt = storeCall(() => store().getGeneratedResult({
          ownerId,
          persona: ADMISSIONS_ADVISOR_PERSONA,
          conversationId,
          clientTurnId,
          message,
          requestHash,
        }))
      } catch (error) {
        receiptReadError = safeStoreError(error)
      }
      generatedReceipt ||= volatileGeneratedResult({ ownerId, conversationId, clientTurnId, message, requestHash })
      if (!generatedReceipt && receiptReadError) throw receiptReadError
    }
    const state = completedReplay || generatedReceipt || storeCall(() => store().beginTurn({
      ownerId,
      persona: ADMISSIONS_ADVISOR_PERSONA,
      conversationId,
      clientTurnId,
      expectedRevision: payload.expectedRevision,
      message,
      requestHash,
    }))

    const canonicalMessage = state.turns.find((turn) => turn.role === 'user')?.content || message
    const metadata = { stemCoachContext: { feature: 'admissions', persona: ADMISSIONS_ADVISOR_PERSONA } }
    const deadlineAt = Date.now() + totalDeadlineMs
    const requestId = crypto.randomUUID()
    let lastProvider = candidates[0] || null
    let lastContextMemory = null
    let streamedAnswer = ''
    let responseTransportFailure = null
    let successful = null
    startSse(response)
    const heartbeat = setInterval(() => {
      try { if (!response.writableEnded && !response.destroyed) response.write(': keep-alive\n\n') } catch { /* The outer stream guard closes transport failures. */ }
    }, 15_000)
    try {
      if (completedReplay) {
        const answer = completedReplay.turns.find((turn) => turn.role === 'assistant')?.content || ''
        const result = {
          mode: 'ai',
          provider: completedReplay.provider || undefined,
          providerStatus: 'connected',
          answer,
          clientTurnId,
          conversation: completedReplay.conversation,
          turns: completedReplay.turns,
          model: completedReplay.model || undefined,
          replayed: true,
        }
        sendSseEventOrThrow(response, 'meta', { ...result, answer: undefined })
        if (answer) sendSseEventOrThrow(response, 'delta', { text: answer })
        finishCommittedStream(response, result)
        return
      }

      if (generatedReceipt) {
        let completed
        try {
          completed = storeCall(() => store().completeTurn({
            ownerId,
            persona: ADMISSIONS_ADVISOR_PERSONA,
            conversationId,
            clientTurnId,
            leaseId: generatedReceipt.leaseId,
            assistantContent: generatedReceipt.answer,
            provider: generatedReceipt.provider,
            model: generatedReceipt.model,
            memory: generatedReceipt.memory,
          }))
        } catch {
          const durable = generatedReceipt.receiptStatus === 'durable'
          const pending = assistantState(generatedReceipt, 'commit_pending')
          finishUncommittedStream(response, {
            mode: durable ? 'interrupted' : 'indeterminate',
            provider: generatedReceipt.provider || undefined,
            providerStatus: 'storage_error',
            answer: generatedReceipt.answer,
            clientTurnId,
            conversation: pending.conversation,
            turns: pending.turns,
            model: generatedReceipt.model || undefined,
            code: durable ? 'admissions_commit_deferred' : 'admissions_generation_indeterminate',
            retryable: durable,
            partial: true,
            receiptStatus: generatedReceipt.receiptStatus,
            providerRetryRequired: false,
            ...(!durable ? { exactlyOnceGuaranteed: false } : {}),
            warning: durable
              ? 'The generated answer is durably retained but not yet committed. Retry this same turn to commit it; the provider will not be called again.'
              : 'The provider finished, but durable result storage is unavailable. Do not automatically retry or assume exactly-once completion.',
          })
          return
        }
        forgetGeneratedResult(ownerId, conversationId, clientTurnId)
        const answer = completed.turns.find((turn) => turn.role === 'assistant')?.content || generatedReceipt.answer
        const result = {
          mode: 'ai',
          provider: generatedReceipt.provider || undefined,
          providerStatus: 'connected',
          answer,
          clientTurnId,
          conversation: completed.conversation,
          turns: completed.turns,
          model: generatedReceipt.model || undefined,
          replayed: true,
          commitRecovered: true,
        }
        sendSseEventOrThrow(response, 'meta', { ...result, answer: undefined })
        if (answer) sendSseEventOrThrow(response, 'delta', { text: answer })
        finishCommittedStream(response, result)
        return
      }

      if (!candidates.length) {
        const failedState = storeCall(() => store().failTurn({
          ownerId,
          persona: ADMISSIONS_ADVISOR_PERSONA,
          conversationId,
          clientTurnId,
          leaseId: state.leaseId,
          status: 'unavailable',
        }))
        const result = providerFailurePayload({
          state: failedState,
          clientTurnId,
          code: 'admissions_provider_not_configured',
        })
        sendSseEventOrThrow(response, 'meta', { ...result, answer: undefined, retryable: undefined, warning: undefined })
        finishUncommittedStream(response, result)
        return
      }

      for (const [providerIndex, provider] of candidates.entries()) {
        lastProvider = provider
        let attemptAnswer = ''
        const selectedContext = storeCall(() => store().contextForProvider({
          ownerId,
          persona: ADMISSIONS_ADVISOR_PERSONA,
          conversationId,
          model: provider.model,
          protocol: provider.protocol,
          metadata,
          currentMessage: canonicalMessage,
          systemPrompt: buildAdmissionsAdvisorSystemPrompt(),
          excludeClientTurnId: clientTurnId,
        }))
        lastContextMemory = selectedContext.memory
        try {
          sendSseEventOrThrow(response, 'meta', {
            mode: 'ai',
            provider: provider.name,
            providerStatus: 'connecting',
            model: provider.model,
            ...publicTurnState(state, clientTurnId),
          })
          const result = await callCompatibleAiStream(provider, {
            messages: [
              { role: 'system', content: buildAdmissionsAdvisorSystemPrompt() },
              ...selectedContext.messages,
              { role: 'user', content: canonicalMessage },
            ],
            temperature: 0.2,
            metadata,
            operation: 'admissions-advisor-stream',
            requestId,
            providerAttempt: providerIndex + 1,
            fallbackPath: candidates.slice(0, providerIndex + 1).map((candidate) => candidate.name).join('>'),
            fallback: providerIndex > 0,
            telemetry,
            timeoutMs: providerTimeoutMs,
            totalDeadlineMs,
            deadlineAt,
            outputTokenLimit: 4096,
            storeResponse: false,
            onDelta: async (delta) => {
              const text = String(delta || '')
              if (!text) return
              attemptAnswer += text
              streamedAnswer += text
              sendSseEventOrThrow(response, 'delta', { text })
            },
          })
          const answer = String(result?.answer || attemptAnswer).trim()
          if (!answer) throw advisorError(502, 'admissions_generation_incomplete', 'AI admissions response was incomplete.')
          successful = { answer, provider, memory: lastContextMemory }
        } catch (error) {
          if (error?.code === 'ADMISSIONS_RESPONSE_TRANSPORT') {
            responseTransportFailure = error
            break
          }
          if (attemptAnswer || providerIndex === candidates.length - 1) break
        }
        if (successful || responseTransportFailure) break
      }

      if (successful) {
        let receipt = rememberGeneratedResult({
          ownerId,
          message,
          requestHash,
          conversation: state.conversation,
          turns: state.turns,
          clientTurnId,
          leaseId: state.leaseId,
          answer: successful.answer,
          provider: successful.provider.name,
          model: successful.provider.model,
          memory: successful.memory,
          receiptStatus: 'volatile',
        })
        try {
          const durableReceipt = storeCall(() => store().saveGeneratedResult({
            ownerId,
            persona: ADMISSIONS_ADVISOR_PERSONA,
            conversationId,
            clientTurnId,
            leaseId: state.leaseId,
            requestHash,
            assistantContent: successful.answer,
            provider: successful.provider.name,
            model: successful.provider.model,
            memory: successful.memory,
          }))
          receipt = rememberGeneratedResult({ ...receipt, ...durableReceipt, ownerId, message, requestHash, receiptStatus: 'durable' })
        } catch { /* A volatile receipt preserves known-success state for this process. */ }

        let completed
        try {
          completed = storeCall(() => store().completeTurn({
            ownerId,
            persona: ADMISSIONS_ADVISOR_PERSONA,
            conversationId,
            clientTurnId,
            leaseId: receipt.leaseId,
            assistantContent: receipt.answer,
            provider: receipt.provider,
            model: receipt.model,
            memory: receipt.memory,
          }))
        } catch {
          const durable = receipt.receiptStatus === 'durable'
          const pending = assistantState(receipt, 'commit_pending')
          finishUncommittedStream(response, {
            mode: durable ? 'interrupted' : 'indeterminate',
            provider: receipt.provider,
            providerStatus: 'storage_error',
            answer: receipt.answer,
            clientTurnId,
            conversation: pending.conversation,
            turns: pending.turns,
            model: receipt.model,
            code: durable ? 'admissions_commit_deferred' : 'admissions_generation_indeterminate',
            retryable: durable,
            partial: true,
            receiptStatus: receipt.receiptStatus,
            providerRetryRequired: false,
            ...(!durable ? { exactlyOnceGuaranteed: false } : {}),
            warning: durable
              ? 'The generated answer is durably retained but not yet committed. Retry this same turn to commit it; the provider will not be called again.'
              : 'The provider finished, but durable result storage is unavailable. Do not automatically retry or assume exactly-once completion.',
          })
          return
        }
        forgetGeneratedResult(ownerId, conversationId, clientTurnId)
        const canonicalAnswer = completed.turns.find((turn) => turn.role === 'assistant')?.content || receipt.answer
        finishCommittedStream(response, {
          mode: 'ai',
          provider: receipt.provider,
          providerStatus: 'connected',
          answer: canonicalAnswer,
          clientTurnId,
          conversation: completed.conversation,
          turns: completed.turns,
          model: receipt.model,
        })
        return
      }

      const partial = Boolean(streamedAnswer)
      if (responseTransportFailure) {
        try {
          storeCall(() => store().failTurn({
            ownerId,
            persona: ADMISSIONS_ADVISOR_PERSONA,
            conversationId,
            clientTurnId,
            leaseId: state.leaseId,
            status: partial ? 'partial' : 'interrupted',
            assistantContent: partial ? streamedAnswer : '',
            provider: lastProvider?.name || '',
            model: lastProvider?.model || '',
            memory: lastContextMemory,
          }))
        } catch { /* The client is gone; retain the lease boundary if settlement also fails. */ }
        try { if (!response.writableEnded && !response.destroyed) response.end() } catch { /* Client transport is unavailable. */ }
        return
      }
      const failed = storeCall(() => store().failTurn({
        ownerId,
        persona: ADMISSIONS_ADVISOR_PERSONA,
        conversationId,
        clientTurnId,
        leaseId: state.leaseId,
        status: partial ? 'partial' : 'unavailable',
        assistantContent: partial ? streamedAnswer : '',
        provider: lastProvider?.name || '',
        model: lastProvider?.model || '',
        memory: lastContextMemory,
      }))
      finishUncommittedStream(response, providerFailurePayload({
        state: failed,
        clientTurnId,
        answer: partial ? failed.turns.find((turn) => turn.role === 'assistant')?.content || streamedAnswer : '',
        provider: lastProvider,
        partial,
        code: partial ? 'admissions_generation_incomplete' : 'admissions_provider_unavailable',
      }))
    } catch (error) {
      if (error?.code === 'ADMISSIONS_RESPONSE_TRANSPORT') {
        try { if (!response.writableEnded && !response.destroyed) response.end() } catch { /* Client transport is unavailable. */ }
        return
      }
      const primaryError = safeStoreError(error)
      let failureState = assistantState(state, 'interrupted')
      let settlementError = null
      if (state?.leaseId && !generatedReceipt && !successful) {
        try {
          failureState = storeCall(() => store().failTurn({
            ownerId,
            persona: ADMISSIONS_ADVISOR_PERSONA,
            conversationId,
            clientTurnId,
            leaseId: state.leaseId,
            status: streamedAnswer ? 'partial' : 'interrupted',
            assistantContent: streamedAnswer,
            provider: lastProvider?.name || '',
            model: lastProvider?.model || '',
            memory: lastContextMemory,
          }))
        } catch (settlementFailure) {
          settlementError = safeStoreError(settlementFailure)
        }
      }
      const surfacedError = settlementError || primaryError
      const code = String(surfacedError?.code || 'admissions_stream_failed')
      finishUncommittedStream(response, {
        mode: 'unavailable',
        provider: lastProvider?.name || undefined,
        providerStatus: code.startsWith('admissions_') ? 'storage_error' : 'error',
        answer: streamedAnswer,
        clientTurnId,
        conversation: failureState.conversation,
        turns: failureState.turns,
        model: lastProvider?.model || undefined,
        code,
        retryable: surfacedError?.retryable !== false,
        partial: Boolean(streamedAnswer),
        warning: 'The admissions stream could not be finalized safely. Retry only when the client indicates it is safe to do so.',
      })
    } finally {
      clearInterval(heartbeat)
    }
  }

  async function handle(request, response, requestUrl) {
    if (!requestUrl.pathname.startsWith(ADMISSIONS_PREFIX)) return false
    if (request.method === 'POST' && requestUrl.pathname === ADMISSIONS_RESUME_PATH) {
      assertNoQuery(requestUrl)
      await resumeConversation(request, response)
      return true
    }
    if (request.method === 'GET'
      && requestUrl.pathname.startsWith(ADMISSIONS_CONVERSATIONS_PREFIX)
      && requestUrl.pathname.endsWith('/messages')) {
      await getMessages(requestUrl, request, response)
      return true
    }
    if (request.method === 'DELETE'
      && requestUrl.pathname.startsWith(ADMISSIONS_CONVERSATIONS_PREFIX)
      && !requestUrl.pathname.endsWith('/messages')) {
      await deleteConversation(requestUrl, request, response)
      return true
    }
    if (request.method === 'POST' && requestUrl.pathname === ADMISSIONS_STREAM_PATH) {
      assertNoQuery(requestUrl)
      await streamConversation(request, response)
      return true
    }
    return false
  }

  return Object.freeze({
    handle,
    close: () => {
      volatileGeneratedResults.clear()
      activeStore?.close?.()
    },
  })
}
