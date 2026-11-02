import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { readPrivateProviderText } from './tavernProvider.js'
import { boundedAdmissionsOperation } from './admissionsResearchDeadline.js'

// Protocol references, not copied implementation:
// https://api-docs.deepseek.com/guides/search/
// https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/web/web-deepseek-api
export const DEEPSEEK_SEARCH_ENDPOINT = 'https://api.deepseek.com/v1/tools/search'
export const DEEPSEEK_FETCH_ENDPOINT = 'https://api.deepseek.com/v1/tools/fetch'
const OFFICIAL_KEY_PATH = path.join(os.homedir(), '.config', 'stemist', 'deepseek.key')
const MAX_RESPONSE_BYTES = 512 * 1024

function credential(value) {
  const key = typeof value === 'string' ? value.trim() : ''
  return key.length >= 8 && key.length <= 512 && !/[\s\p{Cc}]/u.test(key) ? key : ''
}

function officialBase(value) {
  if (!value) return true
  try {
    const url = new URL(String(value))
    return url.origin === 'https://api.deepseek.com' && !url.username && !url.password && !url.search && !url.hash
      && ['/', '/v1', '/v1/'].includes(url.pathname)
  } catch { return false }
}

function loadCredential(env, readOfficialKey) {
  const selection = String(env.STEM_ADMISSIONS_RESEARCH_PROVIDER || '').trim().toLowerCase()
  if (selection === 'off') return { reason: 'disabled', key: '' }
  if (selection && selection !== 'deepseek') return { reason: 'unsupported_provider', key: '' }
  if (Object.hasOwn(env, 'STEM_ADMISSIONS_DEEPSEEK_API_KEY')) {
    const key = credential(env.STEM_ADMISSIONS_DEEPSEEK_API_KEY)
    return { key, reason: key ? 'configured' : 'invalid_official_credential', credentialSource: 'admissions-env' }
  }
  // Never reuse a loaded academic provider descriptor or its Bailian credential.
  if (selection === 'deepseek' && env.STEM_ACADEMIC_PROVIDER === 'deepseek' && credential(env.STEM_ACADEMIC_DEEPSEEK_API_KEY)) {
    return { key: credential(env.STEM_ACADEMIC_DEEPSEEK_API_KEY), reason: 'configured', credentialSource: 'official-academic-env' }
  }
  if (selection === 'deepseek' && credential(env.DEEPSEEK_API_KEY)
    && officialBase(env.DEEPSEEK_BASE_URL) && officialBase(env.DEEPSEEK_API_BASE_URL)) {
    return { key: credential(env.DEEPSEEK_API_KEY), reason: 'configured', credentialSource: 'official-deepseek-env' }
  }
  try {
    const key = credential(readOfficialKey(OFFICIAL_KEY_PATH, 512))
    return { key, reason: key ? 'configured' : 'invalid_official_credential', credentialSource: 'protected-official-key' }
  } catch {
    return { key: '', reason: 'official_credential_unavailable' }
  }
}

function providerError(code) {
  return Object.assign(new Error('Official public research provider is unavailable.'), { code })
}

async function boundedJson(response, signal) {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) throw providerError('ADMISSIONS_SEARCH_RESPONSE_TOO_LARGE')
  const reader = response.body?.getReader()
  if (!reader) throw providerError('ADMISSIONS_SEARCH_INVALID_RESPONSE')
  const chunks = []
  let total = 0
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) throw providerError('ADMISSIONS_SEARCH_RESPONSE_TOO_LARGE')
      chunks.push(Buffer.from(value))
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (error) {
    if (error.code) throw error
    throw providerError('ADMISSIONS_SEARCH_INVALID_RESPONSE')
  } finally {
    signal.removeEventListener('abort', abort)
    await reader.cancel().catch(() => {})
  }
}

export function createAdmissionsSearchProvider({ env = process.env, readOfficialKey = readPrivateProviderText, fetchImpl = fetch } = {}) {
  let credentials
  const configuration = () => credentials ||= loadCredential(env, readOfficialKey)
  async function post(endpoint, body, { deadlineAt = Infinity } = {}) {
    const { key } = configuration()
    if (!key) throw providerError('ADMISSIONS_SEARCH_NOT_CONFIGURED')
    return boundedAdmissionsOperation(async (signal) => {
      let response
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST', redirect: 'error', signal,
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body),
        })
      } catch { throw providerError('ADMISSIONS_SEARCH_TRANSPORT') }
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => {})
        throw providerError(`ADMISSIONS_SEARCH_HTTP_${response.status}`)
      }
      return boundedJson(response, signal)
    }, { timeoutMs: 8_000, deadlineAt, code: 'ADMISSIONS_SEARCH_TIMEOUT' })
  }
  return Object.freeze({
    get status() {
      const { key, reason, credentialSource } = configuration()
      return { provider: 'deepseek', configured: Boolean(key), reason, credentialSource, searchEndpoint: DEEPSEEK_SEARCH_ENDPOINT, fetchEndpoint: DEEPSEEK_FETCH_ENDPOINT }
    },
    async search({ query, limit = 5, deadlineAt, includeContent = false } = {}) {
      if (typeof query !== 'string' || !query.trim() || Array.from(query).length > 128) throw providerError('ADMISSIONS_SEARCH_QUERY_INVALID')
      const result = await post(DEEPSEEK_SEARCH_ENDPOINT, { query, count: Math.min(8, Math.max(1, Number(limit) || 5)), need_content: includeContent === true }, { deadlineAt })
      if (!Array.isArray(result?.results)) throw providerError('ADMISSIONS_SEARCH_INVALID_RESPONSE')
      return result.results.slice(0, 8).flatMap((item) => typeof item?.url === 'string' && typeof item.title === 'string'
        ? [{ url: item.url.slice(0, 2048), title: item.title.slice(0, 180), ...(includeContent === true && typeof item.content === 'string' && item.content.trim().length >= 180 ? { pageContent: item.content.slice(0, 60_000), contentTransport: 'deepseek-search-content' } : {}) }]
        : [])
    },
    async fetchPage(url, options = {}) {
      let parsed
      try { parsed = new URL(url) } catch { throw providerError('ADMISSIONS_SOURCE_URL_BLOCKED') }
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.search
        || net.isIP(parsed.hostname.replace(/^\[|\]$/g, '')) || !parsed.hostname.includes('.') || /\.(?:local|internal|localhost)$/.test(parsed.hostname)) {
        throw providerError('ADMISSIONS_SOURCE_URL_BLOCKED')
      }
      const result = await post(DEEPSEEK_FETCH_ENDPOINT, { url }, options)
      if (typeof result?.content !== 'string' || !result.content.trim()) throw providerError('ADMISSIONS_FETCH_EMPTY')
      return { url, title: String(result.title || '').slice(0, 180), text: result.content.slice(0, 80_000), transport: 'deepseek-fetch' }
    },
  })
}
