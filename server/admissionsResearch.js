import dns from 'node:dns'
import fs from 'node:fs'
import https from 'node:https'
import net from 'node:net'
import path from 'node:path'
import crypto from 'node:crypto'
import { boundedAdmissionsOperation } from './admissionsResearchDeadline.js'
import { createAdmissionsSearchProvider } from './admissionsSearchProvider.js'
import { admissionsInstitutions, planAdmissionsResearch, researchScope } from './admissionsResearchContext.js'
import { assessAdmissionsPage, admissionsEvidencePreparation, newAdmissionsSourceId } from './admissionsResearchEvidence.js'
import { admissionsSourceExcerpt, createAdmissionsPreviewDescriptor } from './admissionsPreviewContract.js'

const DEFAULT_TIMEOUT_MS = 8_000
const DEFAULT_MAX_BYTES = 256 * 1024
const DEFAULT_MAX_PAGE_CHARS = 12_000
const DEFAULT_MAX_CONTEXT_CHARS = 24_000
const DEFAULT_MAX_SOURCES = 3
const MAX_REDIRECTS = 3

const URL_PATTERN = /https:\/\/[^\s<>{}\u005b\u005d"']+/giu
const TRACKING_QUERY_PARAMETERS = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id'])
const NON_HTML_ADMISSIONS_PATH = /\.(?:pdf|docx?|xlsx?|pptx?|zip|rar)(?:$|\/)/iu
const NON_CURRENT_ADMISSIONS_PATH = /\/(?:archive|archives|documents?|office)(?:\/|$)/iu

function researchError(code, message) {
  return Object.assign(new Error(message), { code })
}

function cleanText(value, maxLength = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function sourceDate(value) {
  const text = cleanText(value, 40)
  return /^\d{4}-\d{2}-\d{2}(?:T[^\s]+)?$/.test(text) ? text : ''
}

function normalizedYears(value) {
  const values = Array.isArray(value) ? value : value ? [value] : []
  return [...new Set(values.map((item) => cleanText(item, 20)).filter((item) => /^20\d{2}(?:[-/]20\d{2})?$/.test(item)))].slice(0, 6)
}

function academicRoot(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '').replace(/^www\./, '')
  if (!host || net.isIP(host)) return ''
  const labels = host.split('.')
  if (labels.length < 2) return ''
  const threePartSuffixes = new Set(['ac.uk', 'edu.au', 'edu.hk', 'edu.sg', 'ac.nz', 'ac.jp', 'edu.cn'])
  const suffix = labels.slice(-2).join('.')
  return threePartSuffixes.has(suffix) && labels.length >= 3 ? labels.slice(-3).join('.') : labels.slice(-2).join('.')
}

function normalizedAllowedDomains(value) {
  const output = new Set()
  for (const item of value || []) {
    const raw = String(item || '').trim()
    if (!raw) continue
    try {
      const url = raw.includes('://') ? new URL(raw) : new URL(`https://${raw}`)
      const root = academicRoot(url.hostname)
      if (root) output.add(root)
    } catch {
      const root = academicRoot(raw)
      if (root) output.add(root)
    }
  }
  return output
}

function isAllowedHostname(hostname, allowedDomains) {
  const root = academicRoot(hostname)
  return Boolean(root && allowedDomains.has(root))
}

function ipv4Octets(address) {
  const values = String(address || '').split('.').map(Number)
  return values.length === 4 && values.every((value) => Number.isInteger(value) && value >= 0 && value <= 255) ? values : null
}

function publicIpv4(address) {
  const octets = ipv4Octets(address)
  if (!octets) return false
  const [a, b, c] = octets
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  if (a === 192 && b === 0 && c === 0) return false
  if (a === 192 && b === 0 && c === 2) return false
  if (a === 198 && (b === 18 || b === 19)) return false
  if (a === 198 && b === 51 && c === 100) return false
  if (a === 203 && b === 0 && c === 113) return false
  return true
}

export function isPublicNetworkAddress(address) {
  const value = String(address || '').trim().toLowerCase().replace(/^\[|\]$/g, '')
  const family = net.isIP(value)
  if (family === 4) return publicIpv4(value)
  if (family !== 6) return false
  // Accept native global unicast only. Mapped/translated/tunnel addresses and
  // IANA special-purpose ranges cannot smuggle private IPv4 through hex forms.
  const [first, second] = value.split(':').map(word => Number.parseInt(word || '0', 16))
  return first >= 0x2000 && first <= 0x3fff && first !== 0x2002
    && !(first === 0x2001 && (second < 0x200 || second === 0xdb8))
    && !(first === 0x3fff && second <= 0x0fff)
}

export function shouldResearchAdmissions(message, options = {}) {
  return planAdmissionsResearch({ message, ...options }).requested
}

function decodeHtmlEntities(value) {
  const named = new Map([
    ['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', "'"], ['nbsp', ' '],
    ['ndash', '-'], ['mdash', '-'], ['middot', '·'],
  ])
  return String(value || '').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/giu, (match, entity) => {
    const lower = entity.toLowerCase()
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16)
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : ' '
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10)
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : ' '
    }
    return named.get(lower) ?? ' '
  })
}

export function extractAdmissionsPageText(html, maxChars = DEFAULT_MAX_PAGE_CHARS) {
  const raw = String(html || '')
  const main = raw.match(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/iu)?.[1] || raw
  const withoutActive = main
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|iframe|form|template|nav|footer|header|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article|\/main)\b[^>]*>/giu, '\n')
    .replace(/<[^>]+>/g, ' ')
  const normalized = decodeHtmlEntities(withoutActive)
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const identity = normalized.slice(0, 1_500)
  const ranges = []
  const addRange = (index, before, after, score) => {
    const start = Math.max(0, index - before)
    const end = Math.min(normalized.length, index + after)
    const text = normalized.slice(start, end)
    ranges.push({ start, end, score, text })
  }
  for (const match of normalized.matchAll(/to include|required subjects?|subjects required|minimum entry standard|entry qualifications?|qualifications required|entry requirements?|admission requirements?|academic requirements?|standard offer|english language requirements?|testing requirements?|application deadline|入学要求|申请要求|语言要求/giu)) {
    const anchor = match[0]
    const text = normalized.slice(Math.max(0, match.index - 400), Math.min(normalized.length, match.index + 4_000))
    const score = (/to include|required subjects?|subjects required/iu.test(anchor) ? 100 : 40)
      + (/\b(?:[A-G]\*?){3,4}\b|\b[A-G]\*?\s+(?:or\s+[A-G]\*?\s+)?in\s+(?:Mathematics|Maths|Physics|Chemistry|Biology)\b|\b\d{2}\s+points?\b/iu.test(text) ? 20 : 0)
      + (/to include|required subjects?|subjects required|including|must include/iu.test(text) ? 15 : 0)
    addRange(match.index, 400, 4_000, score)
  }
  for (const match of normalized.matchAll(/start date\s*(?:\n|:|-)?\s*(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d{2}/giu)) {
    addRange(match.index, 120, 800, 80)
  }
  const selected = []
  for (const candidate of ranges.sort((left, right) => right.score - left.score || left.start - right.start)) {
    if (candidate.end <= identity.length || selected.some(item => candidate.start < item.end && candidate.end > item.start)) continue
    selected.push(candidate)
    if (selected.length >= 8) break
  }
  const priority = selected.map(item => item.text)
  const ordered = priority.length ? `${identity}\n\n${priority.join('\n\n')}\n\n${normalized}` : normalized
  return ordered.slice(0, Math.max(1, Number(maxChars) || DEFAULT_MAX_PAGE_CHARS))
}

function htmlTitle(html) {
  const match = String(html || '').match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/iu)
  return cleanText(decodeHtmlEntities(match?.[1] || ''), 180)
}

async function defaultResolveAddresses(hostname) {
  return dns.promises.lookup(hostname, { all: true, verbatim: true })
}

export function createPinnedAddressLookup(address, family = net.isIP(address)) {
  const pinned = String(address || '')
  const pinnedFamily = Number(family) || net.isIP(pinned)
  return function pinnedAddressLookup(_hostname, options, callback) {
    if (options?.all) callback(null, [{ address: pinned, family: pinnedFamily }])
    else callback(null, pinned, pinnedFamily)
  }
}

function defaultRequestPage({ url, address, family, timeoutMs, maxBytes, signal }) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error, result) => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else resolve(result)
    }
    const request = https.request({
      protocol: 'https:',
      hostname: url.hostname,
      servername: url.hostname,
      port: 443,
      method: 'GET',
      path: `${url.pathname}${url.search}`,
      headers: {
        Accept: 'text/html, text/plain;q=0.8',
        'Accept-Encoding': 'identity',
        'User-Agent': 'STEMist-Admissions-Research/1.0',
      },
      lookup: createPinnedAddressLookup(address, family),
      signal,
    }, (response) => {
      const chunks = []
      let bytes = 0
      response.on('data', (chunk) => {
        bytes += chunk.length
        if (bytes > maxBytes) {
          request.destroy(researchError('ADMISSIONS_SOURCE_TOO_LARGE', 'Admissions source exceeded the safe response limit.'))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => finish(null, {
        statusCode: Number(response.statusCode) || 0,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }))
      response.on('error', error => finish(error))
      response.on('aborted', () => finish(researchError('ADMISSIONS_SOURCE_INTERRUPTED', 'Public page was interrupted.')))
    })
    request.setTimeout(timeoutMs, () => request.destroy(researchError('ADMISSIONS_SOURCE_TIMEOUT', 'Admissions source request timed out.')))
    request.on('error', (error) => finish(error))
    request.end()
  })
}

export function normalizeAdmissionsPublicUrl(rawUrl, allowedDomains) {
  let url
  try { url = new URL(String(rawUrl || '')) } catch { throw researchError('ADMISSIONS_SOURCE_URL_INVALID', 'Admissions source URL is invalid.') }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw researchError('ADMISSIONS_SOURCE_URL_BLOCKED', 'Admissions sources must use credential-free HTTPS on the standard port.')
  }
  const queryKeys = [...url.searchParams.keys()]
  if (queryKeys.some((key) => /(?:^|_)(?:access_?token|token|api_?key|auth|authorization|password|session|signature|secret|code)(?:$|_)/iu.test(key.toLowerCase().replace(/[^a-z\d]+/g, '_')))) {
    throw researchError('ADMISSIONS_SOURCE_URL_BLOCKED', 'Admissions source URLs must not contain credential-like query parameters.')
  }
  if (queryKeys.some(key => !TRACKING_QUERY_PARAMETERS.has(key.toLowerCase()))) {
    throw researchError('ADMISSIONS_SOURCE_URL_BLOCKED', 'Public course URLs may contain only recognized tracking query parameters.')
  }
  url.hash = ''
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if (!hostname || net.isIP(hostname) || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.endsWith('.home.arpa')) {
    throw researchError('ADMISSIONS_SOURCE_HOST_BLOCKED', 'Admissions source host is not public.')
  }
  if (!isAllowedHostname(hostname, allowedDomains)) {
    throw researchError('ADMISSIONS_SOURCE_DOMAIN_BLOCKED', 'Admissions source is outside the reviewed official-domain directory.')
  }
  if (/\/(?:login|signin|account|portal|student|admin|user|profile)(?:\/|$)|@|%40/iu.test(url.pathname)) {
    throw researchError('ADMISSIONS_SOURCE_URL_BLOCKED', 'Private portal paths are not public admissions sources.')
  }
  // Recognized tracking values are discarded before retrieval and persistence.
  url.search = ''
  return url
}

function isCurrentAdmissionsHtmlCandidate(url, { allowTransfer = false } = {}) {
  let pathname
  try { pathname = decodeURIComponent(url.pathname) } catch { return false }
  if (NON_HTML_ADMISSIONS_PATH.test(pathname) || NON_CURRENT_ADMISSIONS_PATH.test(pathname)) return false
  if (!allowTransfer && /\/(?:transfer|transfers)(?:\/|$)/iu.test(pathname)) return false
  if (/\/(?:graduate|postgraduate)(?:\/|$)/iu.test(pathname)) return false
  return true
}

export async function validateAdmissionsPublicUrl(rawUrl, { allowedDomains, resolveAddresses = defaultResolveAddresses, deadlineAt = Infinity, timeoutMs = 2_000 } = {}) {
  const url = normalizeAdmissionsPublicUrl(rawUrl, allowedDomains)
  const hostname = url.hostname
  let addresses
  try {
    addresses = await boundedAdmissionsOperation(() => resolveAddresses(hostname), { deadlineAt, timeoutMs, code: 'ADMISSIONS_SOURCE_DNS_TIMEOUT' })
  } catch (error) {
    if (error?.code === 'ADMISSIONS_SOURCE_DNS_TIMEOUT') throw error
    throw researchError('ADMISSIONS_SOURCE_DNS_FAILED', 'Admissions source DNS lookup failed.')
  }
  if (!Array.isArray(addresses) || !addresses.length || addresses.some((item) => !isPublicNetworkAddress(item?.address))) {
    throw researchError('ADMISSIONS_SOURCE_PRIVATE_ADDRESS', 'Admissions source resolved to a private or reserved network address.')
  }
  return { url, address: addresses[0].address, family: Number(addresses[0].family) || net.isIP(addresses[0].address) }
}

export function createAdmissionsPageReader({
  allowedDomains = new Set(),
  resolveAddresses = defaultResolveAddresses,
  requestPage = defaultRequestPage,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_BYTES,
  maxPageChars = DEFAULT_MAX_PAGE_CHARS,
  maxRedirects = MAX_REDIRECTS,
} = {}) {
  const domains = normalizedAllowedDomains(allowedDomains)
  return async function readAdmissionsPage(rawUrl, options = {}) {
    const deadlineAt = Math.min(Date.now() + timeoutMs, options.deadlineAt || Infinity)
    let current = String(rawUrl || '')
    for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
      const safe = await validateAdmissionsPublicUrl(current, { allowedDomains: domains, resolveAddresses, deadlineAt, timeoutMs: Math.min(2_000, timeoutMs) })
      const result = await boundedAdmissionsOperation(signal => requestPage({ ...safe, timeoutMs, maxBytes, signal }), { deadlineAt, timeoutMs, code: 'ADMISSIONS_SOURCE_TIMEOUT' })
      const statusCode = Number(result?.statusCode) || 0
      const headers = result?.headers || {}
      if ([301, 302, 303, 307, 308].includes(statusCode)) {
        if (redirect >= maxRedirects) throw researchError('ADMISSIONS_SOURCE_REDIRECT_LIMIT', 'Admissions source exceeded the redirect limit.')
        const location = cleanText(headers.location, 2000)
        if (!location) throw researchError('ADMISSIONS_SOURCE_REDIRECT_INVALID', 'Admissions source redirect is missing a location.')
        current = new URL(location, safe.url).href
        continue
      }
      if (statusCode < 200 || statusCode >= 300) throw researchError('ADMISSIONS_SOURCE_HTTP_STATUS', `Admissions source returned HTTP ${statusCode || 'error'}.`)
      const encoding = cleanText(headers['content-encoding'], 40).toLowerCase()
      if (encoding && encoding !== 'identity') throw researchError('ADMISSIONS_SOURCE_ENCODING_BLOCKED', 'Compressed admissions source responses are not accepted.')
      const contentType = cleanText(headers['content-type'], 120).toLowerCase()
      if (!contentType.startsWith('text/html') && !contentType.startsWith('text/plain')) {
        throw researchError('ADMISSIONS_SOURCE_TYPE_BLOCKED', 'Admissions source is not a supported public text page.')
      }
      const body = Buffer.isBuffer(result.body) ? result.body : Buffer.from(String(result.body || ''), 'utf8')
      if (body.byteLength > maxBytes) throw researchError('ADMISSIONS_SOURCE_TOO_LARGE', 'Admissions source exceeded the safe response limit.')
      if (/charset\s*=\s*(?!utf-?8|us-ascii)[^;\s]+/iu.test(contentType)) {
        throw researchError('ADMISSIONS_SOURCE_CHARSET_BLOCKED', 'Admissions source character encoding is unsupported.')
      }
      const raw = body.toString('utf8')
      const text = contentType.startsWith('text/html') ? extractAdmissionsPageText(raw, maxPageChars) : cleanText(raw, maxPageChars)
      if (!text) throw researchError('ADMISSIONS_SOURCE_EMPTY', 'Public page did not contain usable text.')
      return {
        url: safe.url.href,
        title: contentType.startsWith('text/html') ? htmlTitle(raw) : '',
        text,
      }
    }
    throw researchError('ADMISSIONS_SOURCE_REDIRECT_LIMIT', 'Admissions source exceeded the redirect limit.')
  }
}

function normalizedSource(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null
  let url
  try { url = new URL(String(raw.url || '')).href } catch { return null }
  if (!url.startsWith('https://')) return null
  const title = cleanText(raw.title || new URL(url).hostname, 180)
  if (!title) return null
  return {
    id: cleanText(raw.id || `source-${index + 1}`, 100),
    title,
    url,
    checkedOn: sourceDate(raw.checkedOn || raw.sourceCheckedOn),
    applicableYears: normalizedYears(raw.applicableYears),
    aliases: Array.isArray(raw.aliases) ? raw.aliases.map((item) => cleanText(item, 120)).filter(Boolean).slice(0, 12) : [],
  }
}

function defaultSourceCatalog() {
  const sources = []
  const reviewsPath = path.join(import.meta.dirname, 'catalogs', 'university-admission-reviews.json')
  const profilesPath = path.join(import.meta.dirname, 'catalogs', 'university-profiles-source.json')
  try {
    const reviews = JSON.parse(fs.readFileSync(reviewsPath, 'utf8'))
    for (const [id, value] of Object.entries(reviews.sources || {})) sources.push({ id, ...value })
  } catch { /* A missing curated file yields an explicitly limited research result. */ }
  try {
    const profiles = JSON.parse(fs.readFileSync(profilesPath, 'utf8'))
    for (const item of profiles.items || []) {
      const aliases = [item.id, ...(item.aliases || [])]
      for (const source of item.profile?.sources || []) {
        sources.push({
          id: `${item.id}-${source.id || 'source'}`,
          title: source.title,
          url: source.url,
          checkedOn: item.provenance?.sourceCheckedOn || item.profile?.updatedOn,
          aliases,
        })
      }
      if (item.provenance?.programme?.url) {
        sources.push({
          id: `${item.id}-programme`,
          title: item.provenance.programme.title || `${item.id} programmes`,
          url: item.provenance.programme.url,
          checkedOn: sourceDate(item.provenance.programme.checkedAt)?.slice(0, 10) || item.provenance?.sourceCheckedOn,
          aliases,
        })
      }
    }
  } catch { /* Same bounded fallback as above. */ }
  const deduped = new Map()
  for (const [index, source] of sources.entries()) {
    const normalized = normalizedSource(source, index)
    if (normalized && !deduped.has(normalized.url)) deduped.set(normalized.url, normalized)
  }
  return [...deduped.values()]
}

export function createAdmissionsResearch({
  env = process.env,
  sourceCatalog = null,
  searchPublicSources = null,
  readPublicPage = null,
  fetchReadPublicPage = null,
  resolveAddresses = defaultResolveAddresses,
  providerOptions = {},
  now = () => new Date(),
  maxSources = DEFAULT_MAX_SOURCES,
  maxContextChars = DEFAULT_MAX_CONTEXT_CHARS,
} = {}) {
  const catalog = (sourceCatalog || defaultSourceCatalog()).map(normalizedSource).filter(Boolean)
  const institutions = admissionsInstitutions(catalog, academicRoot)
  const provider = searchPublicSources ? null : createAdmissionsSearchProvider({ env, ...providerOptions })
  const search = searchPublicSources || provider.search
  const searchMode = searchPublicSources ? 'injected-search-fetch' : 'deepseek-search-fetch'

  return Object.freeze({
    async prepareTurn({ message = '', history = [], deadlineAt = Infinity, onActivity = null } = {}) {
      const canonicalMessage = String(message || '')
      const plan = planAdmissionsResearch({ message: canonicalMessage, history, institutions })
      const scope = researchScope(plan)
      const prepare = options => admissionsEvidencePreparation({ message: canonicalMessage, scope, searchMode, ...options })
      if (!plan.requested) return prepare({ status: 'not_requested' })
      if (plan.missing.length) return prepare({ status: 'needs_clarification', missingFields: plan.missing })
      if (provider && !provider.status.configured) return prepare({ status: 'unavailable', code: 'ADMISSIONS_SEARCH_NOT_CONFIGURED' })
      const researchDeadline = Math.min(deadlineAt - 12_000, Date.now() + 18_000)
      let found
      onActivity?.({ phase: 'search' })
      try {
        found = await boundedAdmissionsOperation(() => search({ query: plan.query, limit: 6, deadlineAt: researchDeadline }), {
          timeoutMs: 8_000, deadlineAt: researchDeadline, code: 'ADMISSIONS_SEARCH_TIMEOUT',
        })
      } catch (error) {
        return prepare({ status: 'unavailable', code: /^ADMISSIONS_[A-Z_\d]+$/.test(error?.code || '') ? error.code : 'ADMISSIONS_SEARCH_FAILED' })
      }
      const domainsForSchool = new Set(institutions.filter(item => item.name === plan.school.name).map(item => item.domain))
      const directReader = readPublicPage || createAdmissionsPageReader({
        allowedDomains: domainsForSchool,
        resolveAddresses,
        timeoutMs: 4_000,
        maxBytes: 512 * 1024,
        maxPageChars: 60_000,
        maxRedirects: 3,
      })
      const fallbackReader = fetchReadPublicPage || (provider ? (url, options) => provider.fetchPage(url, options) : null)
      const allowTransfer = /\btransfer(?:ring)?\b|转学/iu.test(canonicalMessage)
      const directUrls = [...(plan.directCourseUrl ? [plan.directCourseUrl] : []), ...(canonicalMessage.match(URL_PATTERN) || [])].flatMap(raw => {
        try {
          const url = normalizeAdmissionsPublicUrl(raw, domainsForSchool)
          return isCurrentAdmissionsHtmlCandidate(url, { allowTransfer }) ? [{ url: url.href }] : []
        } catch { return [] }
      })
      const selected = [...new Map([...directUrls, ...(Array.isArray(found) ? found : [])].flatMap(raw => {
        try {
          const normalized = normalizeAdmissionsPublicUrl(raw.url, domainsForSchool)
          if (!isCurrentAdmissionsHtmlCandidate(normalized, { allowTransfer })) return []
          const url = normalized.href
          return [[url, { url }]]
        } catch { return [] }
      })).values()].slice(0, Math.min(DEFAULT_MAX_SOURCES, Math.max(1, Number(maxSources) || DEFAULT_MAX_SOURCES)))
      if (!selected.length) return prepare({ status: 'no_results', code: 'ADMISSIONS_OFFICIAL_RESULTS_EMPTY' })
      onActivity?.({ phase: 'fetch' })
      const results = await Promise.all(selected.map(async (candidate) => {
        const readAndAssess = async (reader, transport, timeoutMs) => {
          if (typeof reader !== 'function') return { code: 'ADMISSIONS_COURSE_EVIDENCE_MISSING' }
          try {
            const page = await boundedAdmissionsOperation(() => reader(candidate.url, { deadlineAt: researchDeadline }), {
              timeoutMs, deadlineAt: researchDeadline, code: transport === 'direct-pinned-html' ? 'ADMISSIONS_DIRECT_READ_TIMEOUT' : 'ADMISSIONS_FETCH_TIMEOUT',
            })
            const actualUrl = normalizeAdmissionsPublicUrl(page?.url || candidate.url, domainsForSchool).href
            const assessment = assessAdmissionsPage(page, plan)
            if (assessment.rejection) return { code: 'ADMISSIONS_COURSE_EVIDENCE_MISSING', rejection: assessment.rejection }
            const retrievedAt = new Date(now()).toISOString()
            return {
              source: {
                id: '', title: cleanText(page.title || `${plan.school.name} ${plan.course?.name || plan.kind}`, 180),
                url: actualUrl, official: true, retrievedAt,
                applicableYears: assessment.applicableYears,
                verification: { ...assessment.verification, transport },
                excerpt: admissionsSourceExcerpt(assessment.sourceExcerpt),
                preview: createAdmissionsPreviewDescriptor({ sourceUrl: actualUrl, now: Date.parse(retrievedAt) }),
                textSha256: crypto.createHash('sha256').update(String(page.text || '')).digest('hex'),
              },
              evidence: assessment.evidence,
            }
          } catch (error) {
            return { code: /^ADMISSIONS_[A-Z_\d]+$/.test(error?.code || '') ? error.code : transport === 'direct-pinned-html' ? 'ADMISSIONS_DIRECT_READ_FAILED' : 'ADMISSIONS_FETCH_FAILED' }
          }
        }
        try {
          await validateAdmissionsPublicUrl(candidate.url, { allowedDomains: domainsForSchool, resolveAddresses, deadlineAt: researchDeadline })
          const direct = await readAndAssess(directReader, 'direct-pinned-html', 4_000)
          if (direct.source) return direct
          const fallback = await readAndAssess(fallbackReader, 'deepseek-fetch', 8_000)
          return fallback.source ? fallback : { code: fallback.code || direct.code }
        } catch (error) {
          return { code: /^ADMISSIONS_[A-Z_\d]+$/.test(error?.code || '') ? error.code : 'ADMISSIONS_FETCH_FAILED' }
        }
      }))
      const supported = results.filter(item => item.source)
      if (!supported.length) return prepare({ status: 'insufficient_evidence', code: results[0]?.code || 'ADMISSIONS_COURSE_EVIDENCE_MISSING' })
      const sources = supported.map(({ source }, index) => ({ ...source, id: newAdmissionsSourceId(index) }))
      const partial = supported.length < selected.length || sources.some(source => !source.verification.pageYearVerified || (plan.year && !source.verification.yearMatched))
      return prepare({
        status: partial ? 'partial' : 'complete', sources,
        evidence: supported.map(item => item.evidence.slice(0, Math.floor(maxContextChars / supported.length))),
      })
    },
  })
}
