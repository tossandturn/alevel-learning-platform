const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions'
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504])
const BASE_RETRY_DELAY_MS = 250
const MAX_RETRY_DELAY_MS = 4000

function sanitizedError(code, message, { retryable = false } = {}) {
  const error = new Error(message)
  error.code = code
  Object.defineProperty(error, 'retryable', { value: retryable })
  return error
}

function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) {
    throw sanitizedError('OPENAI_CONFIGURATION_INVALID', `${name} must be a positive integer.`)
  }
}

function outputText(responseBody) {
  if (typeof responseBody?.output_text === 'string') {
    return responseBody.output_text
  }

  const chatContent = responseBody?.choices?.[0]?.message?.content
  if (typeof chatContent === 'string') return chatContent
  if (Array.isArray(chatContent)) {
    const text = chatContent.map((item) => typeof item?.text === 'string' ? item.text : '').join('')
    if (text) return text
  }

  for (const output of responseBody?.output ?? []) {
    for (const content of output?.content ?? []) {
      if (typeof content?.text === 'string') {
        return content.text
      }
    }
  }

  throw sanitizedError('OPENAI_RESPONSE_TEXT_MISSING', 'OpenAI response did not contain output text.')
}

function hasRefusal(responseBody) {
  if (typeof responseBody?.choices?.[0]?.message?.refusal === 'string') return true
  for (const output of responseBody?.output ?? []) {
    for (const content of output?.content ?? []) {
      if (content?.type === 'refusal' || typeof content?.refusal === 'string') {
        return true
      }
    }
  }
  return false
}

function retryDelayMs(attempt, randomImpl) {
  const exponentialDelay = Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * (2 ** (attempt - 1)))
  const randomValue = Number(randomImpl())
  const jitter = Number.isFinite(randomValue) ? Math.min(1, Math.max(0, randomValue)) : 0
  return Math.floor(exponentialDelay * (0.5 + (jitter * 0.5)))
}

function timeoutError() {
  return sanitizedError('OPENAI_TIMEOUT', 'OpenAI request timed out.', { retryable: true })
}

function paperTimeoutError() {
  return sanitizedError('AI_PAPER_TIMEOUT', 'AI paper deadline exceeded.')
}

function effectiveTimeoutMs(timeoutMs, deadlineAt) {
  if (!Number.isFinite(deadlineAt)) return timeoutMs
  const remainingMs = Math.floor(deadlineAt - Date.now())
  if (remainingMs < 1) throw paperTimeoutError()
  return Math.min(timeoutMs, remainingMs)
}

export function resolveOpenAiResponsesUrl(baseUrl) {
  return resolveOpenAiApiUrl(baseUrl, 'responses', OPENAI_RESPONSES_URL)
}

export function resolveOpenAiChatCompletionsUrl(baseUrl) {
  return resolveOpenAiApiUrl(baseUrl, 'chat/completions', OPENAI_CHAT_COMPLETIONS_URL)
}

function resolveOpenAiApiUrl(baseUrl, endpoint, defaultUrl) {
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
    return defaultUrl
  }

  let url
  try {
    url = new URL(baseUrl.trim())
  } catch {
    throw sanitizedError('OPENAI_BASE_URL_INVALID', 'OPENAI_BASE_URL must be a valid http(s) URL.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw sanitizedError('OPENAI_BASE_URL_INVALID', 'OPENAI_BASE_URL must be a valid http(s) URL.')
  }

  const pathname = url.pathname.replace(/\/+$/, '')
  const apiBase = !pathname
    ? '/v1'
    : pathname.endsWith('/v1/responses')
      ? pathname.slice(0, -'/responses'.length)
      : pathname.endsWith('/v1/chat/completions')
        ? pathname.slice(0, -'/chat/completions'.length)
        : pathname.endsWith('/v1')
          ? pathname
          : `${pathname}/v1`
  url.pathname = `${apiBase}/${endpoint}`
  url.search = ''
  url.hash = ''
  return url.toString()
}

function normalizedTransport(value) {
  const transport = typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : 'responses'
  if (transport === 'responses') return transport
  if (transport === 'chat' || transport === 'chat-completions') return 'chat-completions'
  throw sanitizedError('OPENAI_CONFIGURATION_INVALID', 'transport must be responses or chat-completions.')
}

function chatMessages(input) {
  if (!Array.isArray(input)) return []
  return input.map((message) => {
    const content = Array.isArray(message?.content)
      ? message.content.flatMap((entry) => {
        if (entry?.type === 'input_text') return [{ type: 'text', text: String(entry.text || '') }]
        if (entry?.type === 'input_image' && typeof entry.image_url === 'string' && entry.image_url.trim()) {
          return [{ type: 'image_url', image_url: { url: entry.image_url } }]
        }
        return []
      })
      : String(message?.content || '')
    return {
      role: message?.role === 'system' ? 'system' : message?.role === 'assistant' ? 'assistant' : 'user',
      content,
    }
  })
}

export async function callOpenAiStructured({
  apiKey,
  model,
  schemaName,
  schema,
  input,
  baseUrl,
  fetchImpl = fetch,
  maxAttempts = 3,
  timeoutMs = 30000,
  deadlineAt = null,
  signal: externalSignal = null,
  transport = 'responses',
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  randomImpl = Math.random,
}) {
  assertPositiveInteger(maxAttempts, 'maxAttempts')
  assertPositiveInteger(timeoutMs, 'timeoutMs')
  const selectedTransport = normalizedTransport(transport)
  const endpoint = selectedTransport === 'chat-completions'
    ? resolveOpenAiChatCompletionsUrl(baseUrl)
    : resolveOpenAiResponsesUrl(baseUrl)
  const body = JSON.stringify(selectedTransport === 'chat-completions'
    ? {
      model,
      messages: chatMessages(input),
      stream: false,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: schemaName,
          strict: true,
          schema,
        },
      },
    }
    : {
      model,
      store: false,
      input,
      text: {
        format: {
          type: 'json_schema',
          name: schemaName,
          strict: true,
          schema,
        },
      },
    })

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const requestTimeoutMs = effectiveTimeoutMs(timeoutMs, deadlineAt)
    const controller = new AbortController()
    const detachExternalSignal = linkAbortSignal(externalSignal, controller)
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)
    let failure
    let result

    try {
      let response
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body,
          signal: controller.signal,
        })
      } catch {
        failure = controller.signal.aborted
          ? timeoutError()
          : sanitizedError('OPENAI_NETWORK_ERROR', 'OpenAI request failed before a response was received.', { retryable: true })
      }

      if (!failure && (!response || !Number.isInteger(response.status))) {
        failure = sanitizedError('OPENAI_RESPONSE_INVALID', 'OpenAI returned an invalid response.')
      }

      if (!failure && !response.ok) {
        failure = sanitizedError(
          `OPENAI_HTTP_${response.status}`,
          `OpenAI request failed with status ${response.status}.`,
          { retryable: RETRYABLE_STATUS_CODES.has(response.status) },
        )
      }

      let responseBody
      if (!failure) {
        try {
          responseBody = await readJsonWithDeadline(response, controller, requestTimeoutMs)
        } catch {
          failure = controller.signal.aborted
            ? timeoutError()
            : sanitizedError('OPENAI_RESPONSE_INVALID', 'OpenAI returned an unreadable response.')
        }
      }

      if (!failure && selectedTransport === 'responses' && responseBody?.status !== 'completed') {
        failure = sanitizedError('OPENAI_RESPONSE_INCOMPLETE', 'OpenAI response was not completed.')
      }

      if (!failure && hasRefusal(responseBody)) {
        failure = sanitizedError('OPENAI_RESPONSE_REFUSAL', 'OpenAI response contained a refusal.')
      }

      if (!failure) {
        try {
          result = JSON.parse(outputText(responseBody))
        } catch (error) {
          failure = error?.code
            ? error
            : sanitizedError('OPENAI_RESPONSE_JSON_INVALID', 'OpenAI response did not contain valid JSON.')
        }
      }
    } finally {
      clearTimeout(timeout)
      detachExternalSignal()
    }

    if (externalSignal?.aborted) {
      throw sanitizedError('OPENAI_TIMEOUT', 'OpenAI request timed out.')
    }
    if (failure) {
      if (failure.retryable && attempt < maxAttempts) {
        const delayMs = retryDelayMs(attempt, randomImpl)
        if (Number.isFinite(deadlineAt) && Date.now() + delayMs >= deadlineAt) throw paperTimeoutError()
        await sleep(delayMs)
        continue
      }
      if (Number.isFinite(deadlineAt) && Date.now() >= deadlineAt) throw paperTimeoutError()
      throw failure
    }

    return result
  }

  throw sanitizedError('OPENAI_NETWORK_ERROR', 'OpenAI request failed before a response was received.')
}

function linkAbortSignal(externalSignal, controller) {
  if (!externalSignal || typeof externalSignal.addEventListener !== 'function') return () => {}
  const abort = () => controller.abort()
  if (externalSignal.aborted) controller.abort()
  else externalSignal.addEventListener('abort', abort, { once: true })
  return () => externalSignal.removeEventListener('abort', abort)
}

async function readJsonWithDeadline(response, controller, timeoutMs) {
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(timeoutError())
    }, timeoutMs)
  })
  try {
    return await Promise.race([response.json(), deadline])
  } finally {
    clearTimeout(timer)
  }
}
