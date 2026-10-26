import crypto from 'node:crypto'

import { createTavernConversationStore } from './tavernConversationStore.js'

const MAX_JSON_BODY_BYTES = 128 * 1024
const MAX_PAGE_LIMIT = 40
const RESUME_FIELDS = new Set(['conversationId'])
const STREAM_FIELDS = new Set(['conversationId', 'clientTurnId', 'expectedRevision', 'message'])
const MESSAGE_QUERY_FIELDS = new Set(['before', 'limit'])

function advisorError(statusCode, code, message, extra = {}) {
  return Object.assign(new Error(message), { statusCode, code, ...extra })
}

function roleCode(role, suffix) {
  return `${role.errorPrefix}${suffix}`
}

function copy(role, key, ...args) {
  const value = role.copy?.[key]
  if (typeof value === 'function') return value(...args)
  if (typeof value === 'string') return value
  throw new Error(`Advisor role ${role.persona} is missing copy.${key}.`)
}

function roleError(role, statusCode, suffix, copyKey, extra = {}) {
  return advisorError(statusCode, roleCode(role, suffix), copy(role, copyKey), extra)
}

function assertRoleConfig(role) {
  const requiredStrings = [
    'persona',
    'feature',
    'apiPrefix',
    'memorySubdirectory',
    'databaseFilename',
    'errorPrefix',
    'responseTransportCode',
    'operation',
  ]
  for (const key of requiredStrings) {
    if (typeof role?.[key] !== 'string' || !role[key]) throw new Error(`Advisor role requires ${key}.`)
  }
  if (!role.apiPrefix.startsWith('/api/ai/') || !role.apiPrefix.endsWith('/')) {
    throw new Error(`Advisor role ${role.persona} requires a bounded API prefix.`)
  }
  if (!role.errorPrefix.endsWith('_')) throw new Error(`Advisor role ${role.persona} requires a trailing error prefix separator.`)
  if (!Number.isInteger(role.maxMessageChars) || role.maxMessageChars < 1) throw new Error(`Advisor role ${role.persona} requires maxMessageChars.`)
  if (!Number.isInteger(role.maxDeadlineMs) || role.maxDeadlineMs < 250) throw new Error(`Advisor role ${role.persona} requires maxDeadlineMs.`)
  if (typeof role.buildSystemPrompt !== 'function') throw new Error(`Advisor role ${role.persona} requires buildSystemPrompt.`)
  if (typeof role.resolveMemoryRoot !== 'function') throw new Error(`Advisor role ${role.persona} requires resolveMemoryRoot.`)
  return Object.freeze({ ...role, copy: Object.freeze({ ...role.copy }) })
}

function sendJson(response, statusCode, value) {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(value))
}

function readJsonBody(role, request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let bytes = 0
    let settled = false
    request.on('data', (chunk) => {
      if (settled) return
      bytes += chunk.length
      if (bytes > MAX_JSON_BODY_BYTES) {
        settled = true
        reject(roleError(role, 413, 'request_too_large', 'requestTooLarge'))
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
        reject(roleError(role, 400, 'request_invalid', 'invalidJson'))
      }
    })
    request.on('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
  })
}

function objectPayload(role, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw roleError(role, 400, 'request_invalid', 'requestMustBeObject')
  }
  return value
}

function assertAllowedFields(role, payload, allowed) {
  if (Object.keys(payload).some((key) => !allowed.has(key))) {
    throw roleError(role, 400, 'request_invalid', 'unsupportedFields')
  }
}

function boundedIdentifier(role, value, label, { optional = false } = {}) {
  if ((value === undefined || value === '') && optional) return ''
  if (typeof value !== 'string') {
    throw advisorError(400, roleCode(role, 'request_invalid'), copy(role, 'identifierInvalid', label))
  }
  const clean = value.trim()
  if (!/^[A-Za-z0-9._:-]{8,180}$/.test(clean)) {
    throw advisorError(400, roleCode(role, 'request_invalid'), copy(role, 'identifierInvalid', label))
  }
  return clean
}

function assertNoQuery(role, requestUrl) {
  if ([...requestUrl.searchParams.keys()].length) {
    throw roleError(role, 400, 'request_invalid', 'routeDoesNotAcceptQuery')
  }
}

function advisorMessage(role, value) {
  if (typeof value !== 'string') {
    throw roleError(role, 400, 'message_invalid', 'messageMustBeText')
  }
  const clean = value.replaceAll(String.fromCharCode(0), '').replace(/\r\n?/g, '\n').trim()
  if (!clean) throw roleError(role, 400, 'message_invalid', 'messageRequired')
  if (Array.from(clean).length > role.maxMessageChars) {
    throw advisorError(413, roleCode(role, 'message_too_large'), copy(role, 'messageTooLarge', role.maxMessageChars))
  }
  return clean
}

function logicalRequestHash(role, { conversationId, clientTurnId, message }) {
  return crypto.createHash('sha256').update(JSON.stringify({
    feature: role.feature,
    persona: role.persona,
    conversationId,
    clientTurnId,
    message,
  })).digest('hex')
}

function safeStoreError(role, error) {
  const originalCode = String(error?.code || '')
  if (!originalCode.startsWith('tavern_') && !originalCode.startsWith('coach_tavern_')) return error
  const suffix = originalCode.replace(/^coach_tavern_/, '').replace(/^tavern_/, '')
  const code = roleCode(role, suffix)
  return advisorError(
    Number(error?.statusCode) || 500,
    code,
    role.copy.storeMessages?.[code] || copy(role, 'storeFallback'),
    {
      ...(error?.retryable !== undefined ? { retryable: Boolean(error.retryable) } : {}),
      ...(Number.isInteger(error?.currentRevision) ? { currentRevision: error.currentRevision } : {}),
    },
  )
}

function storeCall(role, operation) {
  try {
    return operation()
  } catch (error) {
    throw safeStoreError(role, error)
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

function sendSseEventOrThrow(role, response, event, value) {
  try {
    sendSseEvent(response, event, value)
  } catch (error) {
    error.code = role.responseTransportCode
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

function providerFailurePayload(role, { state, clientTurnId, answer = '', provider = null, partial = false, code }) {
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
    warning: partial ? copy(role, 'partialWarning') : copy(role, 'unavailableWarning'),
  }
}

function pageRequest(role, requestUrl) {
  const keys = [...requestUrl.searchParams.keys()]
  if (keys.some((key) => !MESSAGE_QUERY_FIELDS.has(key))
    || [...MESSAGE_QUERY_FIELDS].some((key) => requestUrl.searchParams.getAll(key).length > 1)) {
    throw roleError(role, 400, 'request_invalid', 'messageQueryUnsupported')
  }
  const rawLimit = requestUrl.searchParams.get('limit') || '40'
  if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > MAX_PAGE_LIMIT) {
    throw roleError(role, 400, 'page_limit_invalid', 'pageLimitInvalid')
  }
  return {
    before: requestUrl.searchParams.get('before') || '',
    limit: Number(rawLimit),
  }
}

function conversationIdFromPath(role, conversationsPrefix, requestUrl, { messages = false } = {}) {
  const suffix = messages ? '/messages' : ''
  const raw = requestUrl.pathname.slice(conversationsPrefix.length, suffix ? -suffix.length : undefined)
  if (!raw || raw.includes('/')) throw roleError(role, 400, 'request_invalid', 'conversationIdInvalid')
  try {
    return boundedIdentifier(role, decodeURIComponent(raw), 'conversationId')
  } catch (error) {
    if (error instanceof URIError) throw roleError(role, 400, 'request_invalid', 'conversationIdInvalid')
    throw error
  }
}

export function createAdvisorConversationEngine({
  role: rawRole,
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
  const role = assertRoleConfig(rawRole)
  if (typeof authenticateRequest !== 'function') throw new Error(copy(role, 'authenticatorRequired'))
  if (typeof callCompatibleAiStream !== 'function') throw new Error(copy(role, 'streamTransportRequired'))
  const candidates = Array.isArray(providerCandidates) ? [...providerCandidates] : []
  const providerTimeoutMs = Math.min(45_000, Math.max(250, Number(timeoutConfig.providerTimeoutMs) || 25_000))
  const totalDeadlineMs = Math.min(role.maxDeadlineMs, Math.max(250, Number(timeoutConfig.totalDeadlineMs) || 50_000))
  const conversationsPrefix = `${role.apiPrefix}conversations/`
  const resumePath = `${role.apiPrefix}conversations/resume`
  const streamPath = `${role.apiPrefix}stream`
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
      throw roleError(role, 409, 'turn_idempotency_conflict', 'turnIdempotencyConflict')
    }
    return receipt
  }

  const store = () => {
    if (!activeStore) {
      activeStore = createTavernConversationStore({
        root: memoryRoot || role.resolveMemoryRoot(env, process.cwd(), baseMemoryRoot),
        databaseFilename: role.databaseFilename,
        allowedPersonas: [role.persona],
        generatedResultReceipts: true,
        rejectDeleteWhilePending: true,
      })
    }
    return activeStore
  }

  async function authorize(request) {
    const ownerId = authenticateRequest(request)
    if (!ownerId) throw advisorError(401, 'coach_auth_required', copy(role, 'authRequired'))
    const authorization = typeof authorizeCoachRequest === 'function'
      ? await authorizeCoachRequest({ request, payload: { feature: role.feature, persona: role.persona } })
      : null
    if (authorization?.coachAccess?.assessmentState === 'active-exam'
      || (authorization?.paperStudyMode === 'exam-simulation' && !authorization?.submitted)) {
      throw advisorError(403, 'coach_exam_in_progress', copy(role, 'examInProgress'))
    }
    return ownerId
  }

  async function resumeConversation(request, response) {
    const payload = objectPayload(role, await readJsonBody(role, request))
    assertAllowedFields(role, payload, RESUME_FIELDS)
    const conversationId = boundedIdentifier(role, payload.conversationId, 'conversationId', { optional: true })
    const ownerId = await authorize(request)
    let conversation = storeCall(role, () => store().resumeConversation({
      ownerId,
      persona: role.persona,
      conversationId,
    }))
    const recovered = storeCall(role, () => store().recoverGeneratedResult({
      ownerId,
      persona: role.persona,
      conversationId: conversation.id,
    }))
    if (recovered) {
      conversation = recovered.conversation
      forgetGeneratedResult(ownerId, conversation.id, recovered.clientTurnId)
    }
    const page = storeCall(role, () => store().getMessages({
      ownerId,
      persona: role.persona,
      conversationId: conversation.id,
      limit: MAX_PAGE_LIMIT,
    }))
    sendJson(response, 200, page)
  }

  async function getMessages(requestUrl, request, response) {
    const conversationId = conversationIdFromPath(role, conversationsPrefix, requestUrl, { messages: true })
    const page = pageRequest(role, requestUrl)
    const ownerId = await authorize(request)
    sendJson(response, 200, storeCall(role, () => store().getMessages({
      ownerId,
      persona: role.persona,
      conversationId,
      ...page,
    })))
  }

  async function deleteConversation(requestUrl, request, response) {
    if ([...requestUrl.searchParams.keys()].length) {
      throw roleError(role, 400, 'request_invalid', 'deleteDoesNotAcceptQuery')
    }
    const conversationId = conversationIdFromPath(role, conversationsPrefix, requestUrl)
    const ownerId = await authorize(request)
    const result = storeCall(role, () => store().deleteConversation({
      ownerId,
      persona: role.persona,
      conversationId,
    }))
    forgetConversationResults(ownerId, conversationId)
    sendJson(response, 200, result)
  }

  async function streamConversation(request, response) {
    const payload = objectPayload(role, await readJsonBody(role, request))
    assertAllowedFields(role, payload, STREAM_FIELDS)
    if ([...STREAM_FIELDS].some((field) => !Object.hasOwn(payload, field))) {
      throw roleError(role, 400, 'request_invalid', 'streamFieldsRequired')
    }
    const conversationId = boundedIdentifier(role, payload.conversationId, 'conversationId')
    const clientTurnId = boundedIdentifier(role, payload.clientTurnId, 'clientTurnId')
    if (!Number.isInteger(payload.expectedRevision) || payload.expectedRevision < 0) {
      throw roleError(role, 400, 'request_invalid', 'revisionInvalid')
    }
    const message = advisorMessage(role, payload.message)
    const ownerId = await authorize(request)
    const requestHash = logicalRequestHash(role, { conversationId, clientTurnId, message })
    const completedReplay = storeCall(role, () => store().replayCompletedTurn({
      ownerId,
      persona: role.persona,
      conversationId,
      clientTurnId,
      message,
      requestHash,
    }))
    let receiptReadError = null
    let generatedReceipt = null
    if (!completedReplay) {
      try {
        generatedReceipt = storeCall(role, () => store().getGeneratedResult({
          ownerId,
          persona: role.persona,
          conversationId,
          clientTurnId,
          message,
          requestHash,
        }))
      } catch (error) {
        receiptReadError = safeStoreError(role, error)
      }
      generatedReceipt ||= volatileGeneratedResult({ ownerId, conversationId, clientTurnId, message, requestHash })
      if (!generatedReceipt && receiptReadError) throw receiptReadError
    }
    const state = completedReplay || generatedReceipt || storeCall(role, () => store().beginTurn({
      ownerId,
      persona: role.persona,
      conversationId,
      clientTurnId,
      expectedRevision: payload.expectedRevision,
      message,
      requestHash,
    }))

    const canonicalMessage = state.turns.find((turn) => turn.role === 'user')?.content || message
    const metadata = { stemCoachContext: { feature: role.feature, persona: role.persona } }
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
        sendSseEventOrThrow(role, response, 'meta', { ...result, answer: undefined })
        if (answer) sendSseEventOrThrow(role, response, 'delta', { text: answer })
        finishCommittedStream(response, result)
        return
      }

      if (generatedReceipt) {
        let completed
        try {
          completed = storeCall(role, () => store().completeTurn({
            ownerId,
            persona: role.persona,
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
            code: roleCode(role, durable ? 'commit_deferred' : 'generation_indeterminate'),
            retryable: durable,
            partial: true,
            receiptStatus: generatedReceipt.receiptStatus,
            providerRetryRequired: false,
            ...(!durable ? { exactlyOnceGuaranteed: false } : {}),
            warning: durable ? copy(role, 'commitDeferredWarning') : copy(role, 'generationIndeterminateWarning'),
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
        sendSseEventOrThrow(role, response, 'meta', { ...result, answer: undefined })
        if (answer) sendSseEventOrThrow(role, response, 'delta', { text: answer })
        finishCommittedStream(response, result)
        return
      }

      if (!candidates.length) {
        const failedState = storeCall(role, () => store().failTurn({
          ownerId,
          persona: role.persona,
          conversationId,
          clientTurnId,
          leaseId: state.leaseId,
          status: 'unavailable',
        }))
        const result = providerFailurePayload(role, {
          state: failedState,
          clientTurnId,
          code: roleCode(role, 'provider_not_configured'),
        })
        sendSseEventOrThrow(role, response, 'meta', { ...result, answer: undefined, retryable: undefined, warning: undefined })
        finishUncommittedStream(response, result)
        return
      }

      for (const [providerIndex, provider] of candidates.entries()) {
        lastProvider = provider
        let attemptAnswer = ''
        const systemPrompt = role.buildSystemPrompt()
        const selectedContext = storeCall(role, () => store().contextForProvider({
          ownerId,
          persona: role.persona,
          conversationId,
          model: provider.model,
          protocol: provider.protocol,
          metadata,
          currentMessage: canonicalMessage,
          systemPrompt,
          excludeClientTurnId: clientTurnId,
        }))
        lastContextMemory = selectedContext.memory
        try {
          sendSseEventOrThrow(role, response, 'meta', {
            mode: 'ai',
            provider: provider.name,
            providerStatus: 'connecting',
            model: provider.model,
            ...publicTurnState(state, clientTurnId),
          })
          const result = await callCompatibleAiStream(provider, {
            messages: [
              { role: 'system', content: systemPrompt },
              ...selectedContext.messages,
              { role: 'user', content: canonicalMessage },
            ],
            temperature: 0.2,
            metadata,
            operation: role.operation,
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
              sendSseEventOrThrow(role, response, 'delta', { text })
            },
          })
          const answer = String(result?.answer || attemptAnswer).trim()
          if (!answer) throw roleError(role, 502, 'generation_incomplete', 'generationIncomplete')
          successful = { answer, provider, memory: lastContextMemory }
        } catch (error) {
          if (error?.code === role.responseTransportCode) {
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
          const durableReceipt = storeCall(role, () => store().saveGeneratedResult({
            ownerId,
            persona: role.persona,
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
          completed = storeCall(role, () => store().completeTurn({
            ownerId,
            persona: role.persona,
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
            code: roleCode(role, durable ? 'commit_deferred' : 'generation_indeterminate'),
            retryable: durable,
            partial: true,
            receiptStatus: receipt.receiptStatus,
            providerRetryRequired: false,
            ...(!durable ? { exactlyOnceGuaranteed: false } : {}),
            warning: durable ? copy(role, 'commitDeferredWarning') : copy(role, 'generationIndeterminateWarning'),
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
          storeCall(role, () => store().failTurn({
            ownerId,
            persona: role.persona,
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
      const failed = storeCall(role, () => store().failTurn({
        ownerId,
        persona: role.persona,
        conversationId,
        clientTurnId,
        leaseId: state.leaseId,
        status: partial ? 'partial' : 'unavailable',
        assistantContent: partial ? streamedAnswer : '',
        provider: lastProvider?.name || '',
        model: lastProvider?.model || '',
        memory: lastContextMemory,
      }))
      finishUncommittedStream(response, providerFailurePayload(role, {
        state: failed,
        clientTurnId,
        answer: partial ? failed.turns.find((turn) => turn.role === 'assistant')?.content || streamedAnswer : '',
        provider: lastProvider,
        partial,
        code: roleCode(role, partial ? 'generation_incomplete' : 'provider_unavailable'),
      }))
    } catch (error) {
      if (error?.code === role.responseTransportCode) {
        try { if (!response.writableEnded && !response.destroyed) response.end() } catch { /* Client transport is unavailable. */ }
        return
      }
      const primaryError = safeStoreError(role, error)
      let failureState = assistantState(state, 'interrupted')
      let settlementError = null
      if (state?.leaseId && !generatedReceipt && !successful) {
        try {
          failureState = storeCall(role, () => store().failTurn({
            ownerId,
            persona: role.persona,
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
          settlementError = safeStoreError(role, settlementFailure)
        }
      }
      const surfacedError = settlementError || primaryError
      const code = String(surfacedError?.code || roleCode(role, 'stream_failed'))
      finishUncommittedStream(response, {
        mode: 'unavailable',
        provider: lastProvider?.name || undefined,
        providerStatus: code.startsWith(role.errorPrefix) ? 'storage_error' : 'error',
        answer: streamedAnswer,
        clientTurnId,
        conversation: failureState.conversation,
        turns: failureState.turns,
        model: lastProvider?.model || undefined,
        code,
        retryable: surfacedError?.retryable !== false,
        partial: Boolean(streamedAnswer),
        warning: copy(role, 'streamFinalizeWarning'),
      })
    } finally {
      clearInterval(heartbeat)
    }
  }

  async function handle(request, response, requestUrl) {
    if (!requestUrl.pathname.startsWith(role.apiPrefix)) return false
    if (request.method === 'POST' && requestUrl.pathname === resumePath) {
      assertNoQuery(role, requestUrl)
      await resumeConversation(request, response)
      return true
    }
    if (request.method === 'GET'
      && requestUrl.pathname.startsWith(conversationsPrefix)
      && requestUrl.pathname.endsWith('/messages')) {
      await getMessages(requestUrl, request, response)
      return true
    }
    if (request.method === 'DELETE'
      && requestUrl.pathname.startsWith(conversationsPrefix)
      && !requestUrl.pathname.endsWith('/messages')) {
      await deleteConversation(requestUrl, request, response)
      return true
    }
    if (request.method === 'POST' && requestUrl.pathname === streamPath) {
      assertNoQuery(role, requestUrl)
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
