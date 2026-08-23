const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
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
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
    return OPENAI_RESPONSES_URL
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
  if (!pathname) {
    url.pathname = '/v1/responses'
  } else if (pathname.endsWith('/v1/responses')) {
    url.pathname = pathname
  } else if (pathname.endsWith('/v1')) {
    url.pathname = `${pathname}/responses`
  } else {
    url.pathname = `${pathname}/v1/responses`
  }
  url.search = ''
  url.hash = ''
  return url.toString()
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
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  randomImpl = Math.random,
}) {
  assertPositiveInteger(maxAttempts, 'maxAttempts')
  assertPositiveInteger(timeoutMs, 'timeoutMs')
  const responsesUrl = resolveOpenAiResponsesUrl(baseUrl)

  const body = JSON.stringify({
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
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)
    let failure
    let result

    try {
      let response
      try {
        response = await fetchImpl(responsesUrl, {
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
          responseBody = await response.json()
        } catch {
          failure = controller.signal.aborted
            ? timeoutError()
            : sanitizedError('OPENAI_RESPONSE_INVALID', 'OpenAI returned an unreadable response.')
        }
      }

      if (!failure && responseBody?.status !== 'completed') {
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
