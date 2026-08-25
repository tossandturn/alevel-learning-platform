import { callOpenAiStructured } from './openai-structured.mjs'

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504])
const DEFAULT_QWEN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
const DEFAULT_QWEN_MAX_OUTPUT_TOKENS = 8192

function nonempty(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function normalizeCompatibleBaseUrl(value) {
  const candidate = nonempty(value) || DEFAULT_QWEN_BASE_URL
  const url = new URL(candidate)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw codedError('QWEN_BASE_URL_INVALID', 'Qwen base URL must be an http(s) URL.')
  url.pathname = url.pathname.replace(/\/+$/, '') || '/compatible-mode/v1'
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

function workspaceBaseUrl(env) {
  const workspaceId = nonempty(env.DASHSCOPE_WORKSPACE_ID || env.QWEN_WORKSPACE_ID)
  if (!workspaceId) return ''
  const region = nonempty(env.DASHSCOPE_REGION) || 'cn-beijing'
  return `https://${workspaceId}.${region}.maas.aliyuncs.com/compatible-mode/v1`
}

function openAiStructuredTransport(baseUrl, env) {
  const configured = nonempty(env.OPENAI_STRUCTURED_TRANSPORT || env.AI_PDF_OPENAI_TRANSPORT).toLowerCase()
  if (configured === 'responses') return configured
  if (configured === 'chat' || configured === 'chat-completions') return 'chat-completions'
  if (configured && configured !== 'auto') throw codedError('OPENAI_CONFIGURATION_INVALID', 'OPENAI_STRUCTURED_TRANSPORT must be responses or chat-completions.')
  if (!baseUrl) return 'responses'
  try {
    return new URL(baseUrl).hostname.toLowerCase() === 'api.openai.com' ? 'responses' : 'chat-completions'
  } catch {
    return 'responses'
  }
}

export function providersFromEnvironment(env = {}, { model = 'gpt-5.6', baseUrl = '' } = {}) {
  const providers = []
  const openAiKey = nonempty(env.OPENAI_API_KEY || env.OPENAI_VISION_API_KEY)
  if (openAiKey) {
    const openAiBaseUrl = nonempty(baseUrl || env.OPENAI_VISION_BASE_URL || env.OPENAI_BASE_URL)
    providers.push(Object.freeze({
      name: 'openai',
      apiKey: openAiKey,
      model: nonempty(model) || nonempty(env.OPENAI_VISION_MODEL || env.OPENAI_MODEL) || 'gpt-5.6',
      baseUrl: openAiBaseUrl,
      transport: openAiStructuredTransport(openAiBaseUrl, env),
      ...configuredProviderTimeout(env.AI_PDF_OPENAI_PROVIDER_TIMEOUT_MS),
    }))
  }

  const qwenKey = nonempty(
    env.QWEN_VISION_API_KEY
    || env.VISION_AI_API_KEY
    || env.QWEN_API_KEY
    || env.DASHSCOPE_API_KEY
    || env.PHYSICS_AI_API_KEY,
  )
  if (qwenKey) {
    providers.push(Object.freeze({
      name: 'qwen',
      apiKey: qwenKey,
      model: nonempty(env.QWEN_VISION_MODEL || env.VISION_AI_MODEL || env.PHYSICS_VISION_MODEL) || 'qwen3-vl-plus',
      baseUrl: normalizeCompatibleBaseUrl(env.QWEN_VISION_BASE_URL || env.VISION_AI_BASE_URL || env.DASHSCOPE_COMPAT_BASE_URL || workspaceBaseUrl(env)),
      ...configuredProviderTimeout(env.AI_PDF_QWEN_PROVIDER_TIMEOUT_MS),
    }))
  }
  return Object.freeze(providers)
}

export async function callStructuredWithFallback({
  providers = [],
  request,
  callOpenAi = callOpenAiStructured,
  callCompatible = callCompatibleStructured,
} = {}) {
  let lastError = null
  for (const provider of providers) {
    if (Number.isFinite(request?.deadlineAt) && Date.now() >= request.deadlineAt) throw codedError('AI_PAPER_TIMEOUT', 'AI paper deadline exceeded.')
    try {
      const providerRequest = provider.timeoutMs
        ? { ...request, timeoutMs: provider.timeoutMs }
        : request
      const value = await callProviderWithDeadline(provider, providerRequest, (signal) => provider.name === 'openai'
        ? callOpenAi({ ...providerRequest, signal, apiKey: provider.apiKey, model: provider.model, baseUrl: provider.baseUrl || undefined, transport: provider.transport || providerRequest?.transport })
        : callCompatible({ ...providerRequest, signal, apiKey: provider.apiKey, model: provider.model, baseUrl: provider.baseUrl }))
      return Object.freeze({ provider, value })
    } catch (error) {
      if (error?.code === 'AI_PAPER_TIMEOUT') throw error
      lastError = error
    }
  }
  if (lastError) throw lastError
  throw codedError('AI_PROVIDER_NOT_CONFIGURED', 'No AI vision provider is configured.')
}

function configuredProviderTimeout(value) {
  const timeoutMs = Number(value)
  return Number.isInteger(timeoutMs) && timeoutMs > 0 ? { timeoutMs } : {}
}

async function callProviderWithDeadline(provider, request, invoke) {
  const timeoutMs = Number.isInteger(request?.timeoutMs) && request.timeoutMs > 0 ? request.timeoutMs : null
  const deadlineAt = Number.isFinite(request?.deadlineAt) ? request.deadlineAt : null
  if (!timeoutMs && !Number.isFinite(deadlineAt)) return invoke(undefined)

  const remainingMs = Number.isFinite(deadlineAt) ? Math.floor(deadlineAt - Date.now()) : Number.POSITIVE_INFINITY
  if (remainingMs < 1) throw codedError('AI_PAPER_TIMEOUT', 'AI paper deadline exceeded.')
  const requestTimeoutMs = Number.isFinite(timeoutMs) ? Math.min(timeoutMs, remainingMs) : remainingMs
  const controller = new AbortController()
  let timer
  const timeoutError = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      if (Number.isFinite(deadlineAt) && Date.now() >= deadlineAt) {
        reject(codedError('AI_PAPER_TIMEOUT', 'AI paper deadline exceeded.'))
        return
      }
      const error = codedError(provider.name === 'openai' ? 'OPENAI_TIMEOUT' : 'QWEN_TIMEOUT', `${provider.name} request timed out.`)
      error.retryable = true
      reject(error)
    }, requestTimeoutMs)
  })
  try {
    return await Promise.race([invoke(controller.signal), timeoutError])
  } finally {
    clearTimeout(timer)
  }
}

export async function callCompatibleStructured({
  apiKey,
  model,
  schema,
  input,
  baseUrl,
  signal: externalSignal = null,
  fetchImpl = fetch,
  maxAttempts = 3,
  timeoutMs = 30000,
  deadlineAt = null,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
} = {}) {
  if (!nonempty(apiKey)) throw codedError('QWEN_CONFIGURATION_INVALID', 'Qwen API key is not configured.')
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw codedError('QWEN_CONFIGURATION_INVALID', 'maxAttempts must be positive.')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw codedError('QWEN_CONFIGURATION_INVALID', 'timeoutMs must be positive.')
  const endpoint = `${normalizeCompatibleBaseUrl(baseUrl)}/chat/completions`
  const messages = compatibleMessages(input, schema)

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const requestTimeoutMs = effectiveTimeoutMs(timeoutMs, deadlineAt)
    const controller = new AbortController()
    const detachExternalSignal = linkAbortSignal(externalSignal, controller)
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0,
          max_tokens: DEFAULT_QWEN_MAX_OUTPUT_TOKENS,
          enable_thinking: false,
          stream: false,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      })
      if (!response?.ok) {
        const error = codedError(`QWEN_HTTP_${response?.status || 0}`, `Qwen request failed with status ${response?.status || 0}.`)
        error.retryable = RETRYABLE_STATUS_CODES.has(response?.status)
        throw error
      }
      const payload = await readJsonWithDeadline(response, controller, requestTimeoutMs)
      const content = payload?.choices?.[0]?.message?.content
      const text = Array.isArray(content)
        ? content.map((entry) => entry?.text || '').join('')
        : String(content || '')
      if (!text.trim()) throw codedError('QWEN_RESPONSE_TEXT_MISSING', 'Qwen returned an empty response.')
      try {
        return parseCompatibleJson(text)
      } catch {
        throw codedError('QWEN_RESPONSE_JSON_INVALID', 'Qwen did not return valid JSON.')
      }
    } catch (error) {
      const retryable = controller.signal.aborted || error?.retryable === true
      if (externalSignal?.aborted) throw codedError('QWEN_TIMEOUT', 'Qwen request timed out.')
      if (retryable && attempt < maxAttempts) {
        const delayMs = Math.min(4000, 250 * (2 ** (attempt - 1)))
        if (Number.isFinite(deadlineAt) && Date.now() + delayMs >= deadlineAt) throw codedError('AI_PAPER_TIMEOUT', 'AI paper deadline exceeded.')
        await sleep(delayMs)
        continue
      }
      if (Number.isFinite(deadlineAt) && Date.now() >= deadlineAt) throw codedError('AI_PAPER_TIMEOUT', 'AI paper deadline exceeded.')
      if (controller.signal.aborted) throw codedError('QWEN_TIMEOUT', 'Qwen request timed out.')
      throw error?.code ? error : codedError('QWEN_NETWORK_ERROR', 'Qwen request failed before a response was received.')
    } finally {
      clearTimeout(timeout)
      detachExternalSignal()
    }
  }
  throw codedError('QWEN_NETWORK_ERROR', 'Qwen request failed before a response was received.')
}

function linkAbortSignal(externalSignal, controller) {
  if (!externalSignal || typeof externalSignal.addEventListener !== 'function') return () => {}
  const abort = () => controller.abort()
  if (externalSignal.aborted) controller.abort()
  else externalSignal.addEventListener('abort', abort, { once: true })
  return () => externalSignal.removeEventListener('abort', abort)
}

function effectiveTimeoutMs(timeoutMs, deadlineAt) {
  if (!Number.isFinite(deadlineAt)) return timeoutMs
  const remainingMs = Math.floor(deadlineAt - Date.now())
  if (remainingMs < 1) throw codedError('AI_PAPER_TIMEOUT', 'AI paper deadline exceeded.')
  return Math.min(timeoutMs, remainingMs)
}

async function readJsonWithDeadline(response, controller, timeoutMs) {
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(codedError('QWEN_TIMEOUT', 'Qwen request timed out.'))
    }, timeoutMs)
  })
  try {
    return await Promise.race([
      response.json().catch(() => {
        throw codedError('QWEN_RESPONSE_INVALID', 'Qwen returned an unreadable response.')
      }),
      deadline,
    ])
  } finally {
    clearTimeout(timer)
  }
}

function compatibleMessages(input, _schema) {
  // The task prompt already names the required fields. Repeating the complete
  // controlled-tag schema makes compatible vision gateways spend excessive
  // time reading the request and can cause their response stream to stall.
  const schemaInstruction = `Return only one valid JSON object matching this compact schema: ${JSON.stringify(compactSchema(_schema))}. Follow the page and coordinate constraints from the task prompt. Do not use Markdown fences or add commentary.`
  return (Array.isArray(input) ? input : []).map((message, index) => ({
    role: message?.role === 'system' ? 'system' : 'user',
    content: [
      ...(Array.isArray(message?.content) ? message.content : []).flatMap((entry) => {
        if (entry?.type === 'input_text') return [{ type: 'text', text: String(entry.text || '') }]
        if (entry?.type === 'input_image' && nonempty(entry.image_url)) return [{ type: 'image_url', image_url: { url: entry.image_url } }]
        return []
      }),
      ...(index === 0 ? [{ type: 'text', text: schemaInstruction }] : []),
    ],
  }))
}

function compactSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return {}
  const result = {}
  for (const key of ['type', 'required', 'additionalProperties']) {
    if (schema[key] !== undefined) result[key] = schema[key]
  }
  if (schema.properties && typeof schema.properties === 'object') {
    result.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, compactSchema(value)]))
  }
  if (schema.items) result.items = compactSchema(schema.items)
  return result
}

function parseCompatibleJson(text) {
  const source = String(text || '').trim().replace(/^\uFEFF/, '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  if (start < 0 || end <= start) throw new SyntaxError('Qwen response did not contain a complete JSON object.')
  return JSON.parse(source.slice(start, end + 1))
}

function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}
