import http from 'node:http'

import { CONFIG_SCHEMA_VERSION } from './schema.mjs'
import { productConfigError, publicError } from './errors.mjs'
import { readActivePublication, readChannelRevisions } from './store.mjs'

const MAX_REQUEST_TARGET_BYTES = 2048
const SERVER_OPTIONS = Object.freeze({
  maxHeaderSize: 16 * 1024,
  requestTimeout: 5000,
  headersTimeout: 5000,
  keepAliveTimeout: 5000,
  connectionsCheckingInterval: 1000,
})

function hasControlCharacters(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true
  }
  return false
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value)}\n`, 'utf8')
}

function writeResponse(response, statusCode, headers, body, headOnly = false) {
  response.writeHead(statusCode, {
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  })
  if (headOnly || statusCode === 304) response.end()
  else response.end(body)
}

function writeJson(response, statusCode, value, { headOnly = false, headers = {} } = {}) {
  const body = jsonBytes(value)
  writeResponse(response, statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.length),
    'Cache-Control': 'no-store',
    ...headers,
  }, body, headOnly)
}

function rejectRequestBody(request) {
  const contentLength = request.headers['content-length']
  const transferEncoding = request.headers['transfer-encoding']
  if (transferEncoding || (contentLength !== undefined && (!/^\d+$/u.test(contentLength) || Number(contentLength) > 0))) {
    request.resume()
    throw productConfigError('request_body_not_allowed', 'GET and HEAD requests cannot include a body.', { statusCode: 400 })
  }
}

function parseRequestTarget(request) {
  const target = String(request.url || '')
  if (!target.startsWith('/') || target.startsWith('//') || Buffer.byteLength(target, 'utf8') > MAX_REQUEST_TARGET_BYTES) {
    throw productConfigError('invalid_request_target', 'Request target is invalid.', { statusCode: 400 })
  }
  if (target.includes('\\') || /\s/u.test(target) || /%2f|%5c/iu.test(target) || target.includes('#')) {
    throw productConfigError('invalid_request_target', 'Request target is invalid.', { statusCode: 400 })
  }
  let rawPath = target.split('?', 1)[0]
  let stable = false
  for (let pass = 0; pass < 8; pass += 1) {
    if (/%2f|%5c/iu.test(rawPath)
        || hasControlCharacters(rawPath)
        || /\\/u.test(rawPath)
        || rawPath.split('/').some((segment) => segment === '.' || segment === '..')) {
      throw productConfigError('invalid_request_target', 'Request target is invalid.', { statusCode: 400 })
    }
    let next
    try {
      next = decodeURIComponent(rawPath)
    } catch {
      throw productConfigError('invalid_request_target', 'Request target is invalid.', { statusCode: 400 })
    }
    if (next === rawPath) {
      stable = true
      break
    }
    rawPath = next
  }
  if (!stable) throw productConfigError('invalid_request_target', 'Request target is invalid.', { statusCode: 400 })
  try {
    return new URL(target, 'http://loopback.invalid')
  } catch {
    throw productConfigError('invalid_request_target', 'Request target is invalid.', { statusCode: 400 })
  }
}

function methodAllowed(request, response, allowed) {
  if (allowed.includes(request.method)) return
  response.setHeader('Allow', allowed.join(', '))
  throw productConfigError('method_not_allowed', 'Method is not allowed.', { statusCode: 405 })
}

function configQuery(url) {
  const allowed = new Set(['channel', 'capability'])
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) {
      throw productConfigError('invalid_query', 'Configuration query is invalid.', { statusCode: 400 })
    }
  }
  const channel = url.searchParams.get('channel') || 'release'
  const capability = url.searchParams.get('capability')
  if (capability === null) throw productConfigError('invalid_capability', 'Capability level is required.', { statusCode: 400 })
  if (capability !== '1') throw productConfigError('unsupported_capability', 'Capability level is unsupported.', { statusCode: 409 })
  return { channel, capability: 1 }
}

function etagMatches(header, etag) {
  if (typeof header !== 'string') return false
  return header.split(',').map((value) => value.trim()).some((value) => value === '*' || value === etag)
}

export function createProductConfigServer({ storeRoot, iconAllowlist }) {
  if (!(iconAllowlist instanceof Set) || iconAllowlist.size === 0) {
    throw productConfigError('icon_allowlist_invalid', 'A packaged icon allowlist is required.', { statusCode: 500 })
  }
  const server = http.createServer(SERVER_OPTIONS, (request, response) => {
    const headOnly = request.method === 'HEAD'
    try {
      const url = parseRequestTarget(request)
      if (url.pathname === '/healthz') {
        methodAllowed(request, response, ['GET', 'HEAD'])
        rejectRequestBody(request)
        if ([...url.searchParams.keys()].length) throw productConfigError('invalid_query', 'Health query is invalid.', { statusCode: 400 })
        writeJson(response, 200, {
          ok: true,
          service: 'stemist-product-config',
          schemaVersion: CONFIG_SCHEMA_VERSION,
          channels: readChannelRevisions({ storeRoot, iconAllowlist }),
        }, { headOnly })
        return
      }
      if (url.pathname !== '/api/product/config') {
        throw productConfigError('not_found', 'Route was not found.', { statusCode: 404 })
      }
      methodAllowed(request, response, ['GET', 'HEAD'])
      rejectRequestBody(request)
      const query = configQuery(url)
      const publication = readActivePublication({ storeRoot, channel: query.channel, iconAllowlist })
      if (publication.config.minCapabilityVersion > query.capability) {
        throw productConfigError('unsupported_capability', 'Published configuration requires a newer capability.', { statusCode: 409 })
      }
      const etag = `"${publication.sha256}"`
      const commonHeaders = {
        'Cache-Control': 'no-cache',
        ETag: etag,
      }
      if (etagMatches(request.headers['if-none-match'], etag)) {
        writeResponse(response, 304, commonHeaders, null, true)
        return
      }
      writeResponse(response, 200, {
        ...commonHeaders,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': String(publication.bytes.length),
      }, publication.bytes, headOnly)
    } catch (error) {
      const failure = publicError(error)
      writeJson(response, failure.statusCode, failure.body, { headOnly })
    }
  })
  server.on('clientError', (_error, socket) => {
    if (!socket.writable) return
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
  })
  return server
}
