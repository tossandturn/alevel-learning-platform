import crypto from 'node:crypto'

export const COACH_IMAGE_UPLOAD_PROTOCOL = 'stem-coach-image-upload-v1'
const DEFAULT_CHUNK_CHARS = 65_536
const DEFAULT_TTL_MS = 15 * 60 * 1000
const DEFAULT_MAX_IMAGE_BYTES = 4 * 1024 * 1024
const DEFAULT_MAX_PER_OWNER = 4
const DEFAULT_MAX_ENTRIES = 64
const DEFAULT_MAX_RESERVED_CHARS = 32 * 1024 * 1024
const DEFAULT_MAX_BODY_BYTES = 80 * 1024
const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

const failure = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code })
const ownerKey = owner => crypto.createHash('sha256').update(String(owner)).digest('hex')

export function coachImageUploadId(value) {
  if (typeof value !== 'string' || !/^cu-[a-zA-Z0-9_-]{16,80}$/.test(value)) {
    throw failure(400, 'coach_upload_id_invalid', '图片上传编号无效。')
  }
  return value
}

export function readCoachUploadJson(request, maxBytes = DEFAULT_MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const advertisedLength = String(request.headers?.['content-length'] || '')
    if (/^\d+$/.test(advertisedLength) && Number(advertisedLength) > maxBytes) {
      request.resume?.()
      reject(failure(413, 'coach_upload_body_too_large', '图片分块请求过大。'))
      return
    }
    const chunks = []
    let bytes = 0
    let settled = false
    let ended = false
    let closeSeen = false
    let transportCleanupScheduled = false
    const cleanupBody = () => {
      request.off('data', onData)
      request.off('end', onEnd)
      request.off('aborted', onAborted)
    }
    const cleanupAll = () => {
      cleanupBody()
      request.off('close', onClose)
      request.off('error', onError)
    }
    const scheduleTransportCleanup = () => {
      if (transportCleanupScheduled) return
      transportCleanupScheduled = true
      setImmediate(() => {
        request.off('close', onClose)
        request.off('error', onError)
      })
    }
    const fail = (error, { transport = false } = {}) => {
      if (settled) return
      settled = true
      chunks.length = 0
      if (transport) {
        cleanupBody()
        if (closeSeen) scheduleTransportCleanup()
      } else cleanupAll()
      reject(error)
    }
    const onData = chunk => {
      bytes += chunk.length
      if (bytes > maxBytes) {
        fail(failure(413, 'coach_upload_body_too_large', '图片分块请求过大。'))
        request.resume?.()
        return
      }
      chunks.push(chunk)
    }
    const onEnd = () => {
      ended = true
      if (settled) return
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
        settled = true
        chunks.length = 0
        cleanupAll()
        resolve(value)
      } catch {
        fail(failure(400, 'coach_upload_json_invalid', '图片上传请求必须是有效 JSON。'))
      }
    }
    const onAborted = () => fail(failure(400, 'coach_upload_request_aborted', '图片分块请求未完整接收。'), { transport: true })
    const onClose = () => {
      closeSeen = true
      if (!ended && !settled) onAborted()
      request.off('close', onClose)
      scheduleTransportCleanup()
    }
    const onError = () => {
      if (!settled) onAborted()
      if (closeSeen) scheduleTransportCleanup()
    }
    request.on('data', onData)
    request.on('end', onEnd)
    request.on('aborted', onAborted)
    request.on('close', onClose)
    request.on('error', onError)
  })
}

function hasImageMagic(bytes, mimeType) {
  if (mimeType === 'image/png') {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  }
  if (mimeType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  }
  return bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
}

export function createCoachImageUploadStore({
  now = Date.now,
  ttlMs = DEFAULT_TTL_MS,
  chunkChars = DEFAULT_CHUNK_CHARS,
  maxImageBytes = DEFAULT_MAX_IMAGE_BYTES,
  maxPerOwner = DEFAULT_MAX_PER_OWNER,
  maxEntries = DEFAULT_MAX_ENTRIES,
  maxReservedChars = DEFAULT_MAX_RESERVED_CHARS,
} = {}) {
  const uploads = new Map()
  const maxBase64Chars = Math.ceil(maxImageBytes / 3) * 4
  let reservedChars = 0

  const remove = id => {
    const entry = uploads.get(id)
    if (!entry) return false
    uploads.delete(id)
    reservedChars -= entry.base64Length
    return true
  }
  const cleanup = () => {
    const at = now()
    for (const [id, entry] of uploads) if (entry.expiresAt <= at) remove(id)
  }
  const sweep = setInterval(() => {
    try { cleanup() } catch { /* Expiry must not affect request handling. */ }
  }, Math.min(60_000, Math.max(25, ttlMs)))
  sweep.unref?.()
  const owned = (owner, id) => {
    cleanup()
    const entry = uploads.get(coachImageUploadId(id))
    if (!entry || entry.owner !== ownerKey(owner)) throw failure(404, 'coach_upload_not_found', '图片上传不存在或已过期。')
    return entry
  }
  const snapshot = entry => ({
    protocol: COACH_IMAGE_UPLOAD_PROTOCOL,
    id: entry.id,
    status: entry.status,
    base64Length: entry.base64Length,
    receivedChars: entry.receivedChars,
    chunkChars,
    expiresAt: entry.expiresAt,
    base64Sha256: entry.base64Sha256,
    mimeType: entry.mimeType,
  })

  return {
    capabilities: Object.freeze({
      protocol: COACH_IMAGE_UPLOAD_PROTOCOL,
      enabled: true,
      chunkChars,
      chunkMethod: 'POST',
      chunkPathSuffix: '/chunks',
      maxImageBytes,
      ttlMs,
    }),
    initialize(owner, id, metadata) {
      const safeId = coachImageUploadId(id)
      const mimeType = String(metadata?.mimeType || '').trim().toLowerCase()
      const base64Length = metadata?.base64Length
      const base64Sha256 = String(metadata?.base64Sha256 || '').trim().toLowerCase()
      if (!MIME_TYPES.has(mimeType) || !Number.isInteger(base64Length) || base64Length <= 0 || base64Length % 4 !== 0 || !/^[a-f0-9]{64}$/.test(base64Sha256)) {
        throw failure(400, 'coach_upload_metadata_invalid', '图片上传信息无效。')
      }
      if (base64Length > maxBase64Chars) throw failure(413, 'coach_upload_image_too_large', '图片超过允许大小。')
      cleanup()
      const key = ownerKey(owner)
      const prior = uploads.get(safeId)
      if (prior) {
        if (prior.owner !== key) throw failure(404, 'coach_upload_not_found', '图片上传不存在或已过期。')
        if (prior.mimeType !== mimeType || prior.base64Length !== base64Length || prior.base64Sha256 !== base64Sha256) {
          throw failure(409, 'coach_upload_metadata_conflict', '图片上传信息与已有任务不一致。')
        }
        return snapshot(prior)
      }
      let ownerCount = 0
      for (const entry of uploads.values()) if (entry.owner === key) ownerCount += 1
      if (ownerCount >= maxPerOwner) throw failure(429, 'coach_upload_owner_limit', '待处理图片过多，请先完成或取消已有上传。')
      if (uploads.size >= maxEntries || reservedChars + base64Length > maxReservedChars) {
        throw failure(429, 'coach_upload_capacity', '图片上传服务繁忙，请稍后重试。')
      }
      const entry = {
        id: safeId,
        owner: key,
        mimeType,
        base64Length,
        base64Sha256,
        receivedChars: 0,
        status: 'uploading',
        expiresAt: now() + ttlMs,
        storage: Buffer.alloc(base64Length),
        base64: '',
      }
      uploads.set(safeId, entry)
      reservedChars += base64Length
      return snapshot(entry)
    },
    get(owner, id) {
      return snapshot(owned(owner, id))
    },
    append(owner, id, payload) {
      const entry = owned(owner, id)
      const offset = payload?.offset
      const chunk = payload?.chunk
      if (!Number.isInteger(offset) || offset < 0 || offset % 4 !== 0 || typeof chunk !== 'string' || !chunk.length || chunk.length > chunkChars || !/^[A-Za-z0-9+/]*={0,2}$/.test(chunk)) {
        throw failure(400, 'coach_upload_chunk_invalid', '图片分块无效。')
      }
      const end = offset + chunk.length
      if (offset < entry.receivedChars) {
        const repeated = entry.status === 'ready'
          ? entry.base64.slice(offset, end) === chunk
          : entry.storage.toString('ascii', offset, end) === chunk
        if (repeated && end <= entry.receivedChars) return snapshot(entry)
        throw failure(409, 'coach_upload_offset_conflict', '图片上传位置已变化，请刷新上传状态。')
      }
      if (offset !== entry.receivedChars || entry.status !== 'uploading') {
        throw failure(409, 'coach_upload_offset_conflict', '图片上传位置已变化，请刷新上传状态。')
      }
      const finalChunk = end === entry.base64Length
      if (end > entry.base64Length || (!finalChunk && (chunk.length % 4 !== 0 || chunk.includes('=')))) {
        throw failure(400, 'coach_upload_chunk_invalid', '图片分块无效。')
      }
      entry.storage.write(chunk, offset, chunk.length, 'ascii')
      entry.receivedChars = end
      return snapshot(entry)
    },
    complete(owner, id) {
      const entry = owned(owner, id)
      if (entry.status === 'ready') return snapshot(entry)
      if (entry.receivedChars !== entry.base64Length) throw failure(409, 'coach_upload_incomplete', '图片尚未上传完成。')
      const base64 = entry.storage.toString('ascii')
      if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
        throw failure(422, 'coach_upload_base64_invalid', '图片编码无效。')
      }
      const bytes = Buffer.from(base64, 'base64')
      if (!bytes.length || bytes.toString('base64') !== base64) throw failure(422, 'coach_upload_base64_invalid', '图片编码无效。')
      if (crypto.createHash('sha256').update(base64, 'ascii').digest('hex') !== entry.base64Sha256) {
        throw failure(422, 'coach_upload_sha_mismatch', '图片校验失败，请重新上传。')
      }
      if (bytes.length > maxImageBytes) throw failure(413, 'coach_upload_image_too_large', '图片超过允许大小。')
      if (!hasImageMagic(bytes, entry.mimeType)) throw failure(422, 'coach_upload_mime_mismatch', '图片格式与声明不一致。')
      entry.status = 'ready'
      entry.base64 = base64
      entry.storage = null
      return snapshot(entry)
    },
    resolve(owner, ids) {
      if (!Array.isArray(ids) || !ids.length || ids.length > maxPerOwner || new Set(ids).size !== ids.length) {
        throw failure(400, 'coach_upload_ids_invalid', '图片上传编号列表无效。')
      }
      return ids.map(id => {
        const entry = owned(owner, id)
        if (entry.status !== 'ready') throw failure(409, 'coach_upload_not_ready', '图片尚未上传完成。')
        return `data:${entry.mimeType};base64,${entry.base64}`
      })
    },
    delete(owner, id) {
      const entry = owned(owner, id)
      remove(entry.id)
      return { protocol: COACH_IMAGE_UPLOAD_PROTOCOL, id: entry.id, deleted: true }
    },
    storageStats() {
      cleanup()
      let allocatedChars = 0
      let storageUnits = 0
      for (const entry of uploads.values()) {
        if (entry.storage) allocatedChars += entry.storage.length
        else allocatedChars += Buffer.byteLength(entry.base64, 'ascii')
        storageUnits += 1
      }
      return { entries: uploads.size, reservedChars, allocatedChars, storageUnits }
    },
    close() {
      clearInterval(sweep)
      uploads.clear()
      reservedChars = 0
    },
  }
}

export function createCoachImageUploads({ authenticate, sendJson, options = {} }) {
  const store = createCoachImageUploadStore(options)
  return {
    async handle(request, response, url) {
      const prefix = '/api/ai/coach/uploads/'
      if (!url.pathname.startsWith(prefix)) return false
      const owner = authenticate(request)
      if (!owner) throw failure(401, 'coach_auth_required', '请先登录。')
      if (url.pathname === `${prefix}capabilities`) {
        if (request.method !== 'GET') {
          sendJson(response, 405, { code: 'coach_upload_method', error: '请求方式不支持。' })
          return true
        }
        sendJson(response, 200, store.capabilities)
        return true
      }
      const suffix = url.pathname.slice(prefix.length)
      const completeMatch = /^([^/]+)\/complete$/.exec(suffix)
      const chunkMatch = /^([^/]+)\/chunks$/.exec(suffix)
      const id = coachImageUploadId(completeMatch ? completeMatch[1] : chunkMatch ? chunkMatch[1] : suffix)
      if (chunkMatch) {
        if (request.method !== 'POST') {
          sendJson(response, 405, { code: 'coach_upload_method', error: '请求方式不支持。' })
          return true
        }
        sendJson(response, 200, store.append(owner, id, await readCoachUploadJson(request)))
        return true
      }
      if (completeMatch) {
        if (request.method !== 'POST') {
          sendJson(response, 405, { code: 'coach_upload_method', error: '请求方式不支持。' })
          return true
        }
        await readCoachUploadJson(request)
        sendJson(response, 200, store.complete(owner, id))
        return true
      }
      if (request.method === 'GET') sendJson(response, 200, store.get(owner, id))
      else if (request.method === 'PUT') sendJson(response, 200, store.initialize(owner, id, await readCoachUploadJson(request)))
      else if (request.method === 'PATCH') sendJson(response, 200, store.append(owner, id, await readCoachUploadJson(request)))
      else if (request.method === 'DELETE') sendJson(response, 200, store.delete(owner, id))
      else sendJson(response, 405, { code: 'coach_upload_method', error: '请求方式不支持。' })
      return true
    },
    resolvePayload(owner, payload) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.imageUploadIds === undefined) return payload
      const inlineImages = payload.imageDataUrls
      const hasInlineImages = Boolean(String(payload.imageDataUrl || '').trim())
        || (Array.isArray(inlineImages)
          ? inlineImages.some(value => String(value || '').trim())
          : inlineImages !== undefined && inlineImages !== null && Boolean(String(inlineImages).trim()))
      if (hasInlineImages) throw failure(400, 'coach_upload_input_conflict', '不能同时提交分块图片和内嵌图片。')
      const normalized = { ...payload, imageDataUrls: store.resolve(owner, payload.imageUploadIds) }
      delete normalized.imageUploadIds
      delete normalized.imageDataUrl
      return normalized
    },
    close() {
      store.close()
    },
  }
}
