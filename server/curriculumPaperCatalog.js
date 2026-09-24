import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_MANIFEST_PATH = fileURLToPath(new URL('./catalogs/curriculum-papers.json', import.meta.url))
const BOARDS = new Set(['ap', 'ib'])
const PAIR_STATUSES = new Set(['verified', 'candidate', 'missing'])
const RIGHTS_STATUSES = new Set(['unverified', 'licensed'])
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/
const SAFE_COURSE_ID = /^[a-z0-9][a-z0-9._-]{0,119}$/
const SHA256 = /^[a-f0-9]{64}$/
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024
const MAX_PDF_BYTES = 1024 * 1024 * 1024
const FILE_ROUTE = '/api/stem/curriculum-papers/files/'

function fail(statusCode, code, message, headers = undefined) {
  throw Object.assign(new Error(message), { statusCode, code, ...(headers ? { headers } : {}) })
}

function catalogUnavailable() {
  fail(503, 'curriculum_catalog_unavailable', 'Curriculum paper catalogue is temporarily unavailable.')
}

function boundedText(value, max, { empty = false } = {}) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) catalogUnavailable()
  return value.trim()
}

function safeRelativePdf(value) {
  if (typeof value !== 'string' || !value || value.length > 1024 || value.includes('\0') || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return false
  const segments = value.split(/[\\/]+/)
  if (segments.some(segment => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(segment))) return false
  return /\.pdf$/i.test(value)
}

function normalizeSourceFile(raw, fileIds) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !SAFE_ID.test(raw.id || '') || fileIds.has(raw.id)) catalogUnavailable()
  if (!safeRelativePdf(raw.relativePath) || !SHA256.test(raw.sha256 || '') || !RIGHTS_STATUSES.has(raw.rightsStatus) || raw.integrityStatus !== 'verified') catalogUnavailable()
  if (!Number.isSafeInteger(raw.bytes) || raw.bytes < 5 || raw.bytes > MAX_PDF_BYTES || !Number.isInteger(raw.pages) || raw.pages < 1 || raw.pages > 10000) catalogUnavailable()
  const item = {
    id: raw.id,
    name: boundedText(raw.name, 300),
    bytes: raw.bytes,
    pages: raw.pages,
    sha256: raw.sha256,
    relativePath: raw.relativePath,
    sourceUrl: typeof raw.sourceUrl === 'string' && raw.sourceUrl.length <= 2000 ? raw.sourceUrl : null,
    rightsStatus: raw.rightsStatus,
    integrityStatus: raw.integrityStatus,
  }
  fileIds.add(item.id)
  return item
}

function normalizeManifest(payload) {
  if (!payload || payload.schemaVersion !== 'curriculum-paper-source-v1' || !Array.isArray(payload.courses) || !Array.isArray(payload.papers)
    || payload.courses.length > 1000 || payload.papers.length > 100000) catalogUnavailable()

  const courseIds = new Set()
  const courses = payload.courses.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !SAFE_COURSE_ID.test(raw.id || '') || courseIds.has(raw.id) || !BOARDS.has(raw.board)) catalogUnavailable()
    const course = {
      id: raw.id,
      board: raw.board,
      label: boundedText(raw.label, 160),
      subject: boundedText(raw.subject, 120),
    }
    courseIds.add(course.id)
    return course
  })
  const coursesById = new Map(courses.map(course => [course.id, course]))
  const paperIds = new Set()
  const fileIds = new Set()
  const filesById = new Map()
  const papers = payload.papers.map(raw => {
    const course = coursesById.get(raw?.course)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !SAFE_ID.test(raw.id || '') || paperIds.has(raw.id)
      || !BOARDS.has(raw.board) || !course || course.board !== raw.board || raw.courseLabel !== course.label || raw.subject !== course.subject
      || !Number.isInteger(raw.year) || raw.year < 1900 || raw.year > 2100 || typeof raw.fullExam !== 'boolean'
      || raw.practiceReady !== false || !PAIR_STATUSES.has(raw.pairStatus)) catalogUnavailable()
    const questionPaper = normalizeSourceFile(raw.questionPaper, fileIds)
    const markScheme = raw.markScheme === null ? null : normalizeSourceFile(raw.markScheme, fileIds)
    const paper = {
      id: raw.id,
      board: raw.board,
      course: raw.course,
      courseLabel: raw.courseLabel,
      subject: raw.subject,
      level: boundedText(raw.level, 80, { empty: true }),
      year: raw.year,
      session: boundedText(raw.session, 80),
      paper: boundedText(raw.paper, 80),
      variant: boundedText(raw.variant, 80, { empty: true }),
      title: boundedText(raw.title, 300),
      section: boundedText(raw.section, 200, { empty: true }),
      fullExam: raw.fullExam,
      practiceReady: false,
      pairStatus: raw.pairStatus,
      questionPaper,
      markScheme,
    }
    paperIds.add(paper.id)
    filesById.set(questionPaper.id, { board: paper.board, file: questionPaper })
    if (markScheme) filesById.set(markScheme.id, { board: paper.board, file: markScheme })
    return paper
  })

  return { courses, coursesById, papers, filesById }
}

function officialSourceUrl(board, value) {
  if (typeof value !== 'string' || !value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
    const hostname = url.hostname.toLowerCase()
    const domain = board === 'ap' ? 'collegeboard.org' : board === 'ib' ? 'ibo.org' : ''
    if (!domain || hostname !== domain && !hostname.endsWith(`.${domain}`)) return null
    return url.href
  } catch {
    return null
  }
}

function assetRootValue(assetRoot, env) {
  const value = typeof assetRoot === 'string' ? assetRoot : typeof env?.STEM_CURRICULUM_ASSET_ROOT === 'string' ? env.STEM_CURRICULUM_ASSET_ROOT : ''
  return value && path.isAbsolute(value) ? path.resolve(value) : ''
}

function safeContentDisposition(name, id) {
  let display = typeof name === 'string' ? name : ''
  display = [...display].map(character => {
    const code = character.codePointAt(0)
    return code < 32 || code === 127 ? ' ' : character
  }).join('').replace(/[\\/:"?*<>|]/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '')
  if (!display) display = `${id}.pdf`
  if (!/\.pdf$/i.test(display)) display += '.pdf'
  if (display.length > 180) display = `${display.slice(0, 176).replace(/[. ]+$/g, '')}.pdf`
  let fallback = display.normalize('NFKD').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_').replace(/\s+/g, ' ').trim()
  if (!fallback) fallback = `${id}.pdf`
  const encoded = encodeURIComponent(display).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

function statSignature(stat) {
  return [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':')
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate)
  return Boolean(relative) && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)
}

function parseRange(value, size) {
  if (value === undefined) return null
  if (typeof value !== 'string') return false
  const match = value.trim().match(/^bytes=(\d*)-(\d*)$/)
  if (!match || !match[1] && !match[2]) return false
  let start
  let end
  if (!match[1]) {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix < 1) return false
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : size - 1
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) return false
    end = Math.min(end, size - 1)
  }
  return { start, end }
}

function requestedRange(request, size, etag) {
  const range = request.headers.range
  if (range === undefined) return null
  const ifRange = request.headers['if-range']
  // This endpoint emits no Last-Modified validator. Only an exact strong ETag
  // match may combine a cached prefix with a new partial response; weak, stale,
  // date, and malformed validators all fall back to the complete representation.
  if (ifRange !== undefined && (typeof ifRange !== 'string' || ifRange.trim() !== etag)) return null
  return parseRange(range, size)
}

function jsonResponse(request, response, statusCode, body, headers = undefined) {
  const bytes = Buffer.from(JSON.stringify(body), 'utf8')
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Length', String(bytes.length))
  if (headers) for (const [name, value] of Object.entries(headers)) response.setHeader(name, value)
  response.end(request.method === 'HEAD' ? undefined : bytes)
}

function errorResponse(request, response, error) {
  const exposed = Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 600
    ? error
    : { statusCode: 503, code: 'curriculum_catalog_unavailable', message: 'Curriculum paper catalogue is temporarily unavailable.' }
  jsonResponse(request, response, exposed.statusCode, { error: { code: exposed.code || 'curriculum_catalog_unavailable', message: exposed.message } }, exposed.headers)
}

export function createCurriculumPaperCatalog({ manifestPath = DEFAULT_MANIFEST_PATH, assetRoot, env = {} } = {}) {
  const resolvedManifestPath = path.resolve(manifestPath)
  const resolvedAssetRoot = assetRootValue(assetRoot, env)
  const hashCache = new Map()
  let manifestCache = null

  async function loadManifest() {
    let stat
    try {
      stat = await fsp.stat(resolvedManifestPath)
    } catch {
      catalogUnavailable()
    }
    if (!stat.isFile() || stat.size < 2 || stat.size > MAX_MANIFEST_BYTES) catalogUnavailable()
    const signature = statSignature(stat)
    if (manifestCache?.signature === signature) return manifestCache.value
    let payload
    try {
      payload = JSON.parse(await fsp.readFile(resolvedManifestPath, 'utf8'))
    } catch {
      catalogUnavailable()
    }
    const value = normalizeManifest(payload)
    manifestCache = { signature, value }
    return value
  }

  const canDownload = file => Boolean(resolvedAssetRoot) && file.rightsStatus === 'licensed' && file.integrityStatus === 'verified'

  function publicFile(file, board) {
    const downloadable = canDownload(file)
    return {
      id: file.id,
      name: file.name,
      bytes: file.bytes,
      pages: file.pages,
      sha256: file.sha256,
      downloadUrl: downloadable ? `${FILE_ROUTE}${encodeURIComponent(file.id)}` : null,
      sourceUrl: officialSourceUrl(board, file.sourceUrl),
      availability: downloadable ? 'downloadable' : 'source-only',
    }
  }

  function publicPaper(item) {
    const questionPaper = publicFile(item.questionPaper, item.board)
    return {
      id: item.id,
      board: item.board,
      course: item.course,
      courseLabel: item.courseLabel,
      subject: item.subject,
      level: item.level,
      year: item.year,
      session: item.session,
      paper: item.paper,
      variant: item.variant,
      title: item.title,
      section: item.section,
      fullExam: item.fullExam,
      practiceReady: false,
      availability: questionPaper.availability,
      questionPaper,
      markScheme: item.markScheme ? publicFile(item.markScheme, item.board) : null,
      pairStatus: item.pairStatus,
      notice: questionPaper.availability === 'downloadable'
        ? 'Licensed source file; practice remains unavailable until review and integration are complete.'
        : 'Source reference only; in-app download and practice are not available.',
    }
  }

  async function list(input = {}) {
    const board = String(input.board || '').trim().toLowerCase()
    if (!BOARDS.has(board)) fail(400, 'invalid_curriculum_board', 'board must be ap or ib.')
    const manifest = await loadManifest()
    const course = String(input.course || '').trim()
    if (course && (!SAFE_COURSE_ID.test(course) || manifest.coursesById.get(course)?.board !== board)) {
      fail(400, 'invalid_curriculum_scope', 'course does not belong to the selected board.')
    }
    const level = String(input.level || '').trim()
    const rawYear = String(input.year || '').trim()
    const year = rawYear ? Number(rawYear) : null
    const session = String(input.session || '').trim()
    const paper = String(input.paper || '').trim()
    const query = String(input.query || '').trim().toLowerCase()
    const requestedPage = input.page === undefined ? 1 : Number(input.page)
    const pageSize = input.pageSize === undefined ? 20 : Number(input.pageSize)
    if (level.length > 80 || session.length > 80 || paper.length > 80 || query.length > 160
      || rawYear && (!/^\d{4}$/.test(rawYear) || !Number.isInteger(year) || year < 1900 || year > 2100)) {
      fail(400, 'invalid_curriculum_filters', 'One or more curriculum paper filters are invalid.')
    }
    if (!Number.isInteger(requestedPage) || requestedPage < 1 || requestedPage > 10000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      fail(400, 'invalid_curriculum_page', 'page and pageSize must be positive integers within range.')
    }

    const boardPapers = manifest.papers.filter(item => item.board === board)
    const coursePapers = course ? boardPapers.filter(item => item.course === course) : boardPapers
    const filters = {
      levels: [...new Set(coursePapers.map(item => item.level).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })),
      years: [...new Set(coursePapers.map(item => item.year))].sort((a, b) => b - a),
      sessions: [...new Set(coursePapers.map(item => item.session))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })),
      papers: [...new Set(coursePapers.map(item => item.paper))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })),
    }
    const searchable = item => [item.id, item.course, item.courseLabel, item.subject, item.level, item.year, item.session, item.paper, item.variant, item.title, item.section, item.questionPaper.id, item.questionPaper.name, item.markScheme?.id, item.markScheme?.name]
      .filter(value => value !== undefined && value !== null).join(' ').toLowerCase()
    const matched = coursePapers.filter(item => (!level || item.level.toLowerCase() === level.toLowerCase())
      && (year === null || item.year === year)
      && (!session || item.session.toLowerCase() === session.toLowerCase())
      && (!paper || item.paper.toLowerCase() === paper.toLowerCase())
      && (!query || searchable(item).includes(query)))
      .sort((a, b) => b.year - a.year || a.courseLabel.localeCompare(b.courseLabel, 'en') || a.paper.localeCompare(b.paper, 'en', { numeric: true }) || a.variant.localeCompare(b.variant, 'en', { numeric: true }) || a.id.localeCompare(b.id, 'en'))
    const total = matched.length
    const pages = Math.ceil(total / pageSize)
    const page = Math.min(requestedPage, Math.max(1, pages))
    const selected = matched.slice((page - 1) * pageSize, page * pageSize).map(publicPaper)
    const downloadable = matched.filter(item => canDownload(item.questionPaper)).length
    return {
      schemaVersion: 'curriculum-papers-v1',
      board,
      courses: manifest.courses.filter(item => item.board === board).map(({ id, label, subject }) => ({ id, label, subject })).sort((a, b) => a.label.localeCompare(b.label, 'en')),
      filters,
      total,
      page,
      pageSize,
      pages,
      items: selected,
      summary: { papers: total, downloadable, sourceOnly: total - downloadable },
    }
  }

  async function verifiedFile(id, aborted = () => false) {
    if (!SAFE_ID.test(id || '') || !resolvedAssetRoot) fail(404, 'curriculum_paper_file_not_found', 'Curriculum paper file was not found.')
    const manifest = await loadManifest()
    const record = manifest.filesById.get(id)
    if (!record || !canDownload(record.file)) fail(404, 'curriculum_paper_file_not_found', 'Curriculum paper file was not found.')
    const candidate = path.resolve(resolvedAssetRoot, record.file.relativePath)
    if (!inside(resolvedAssetRoot, candidate)) fail(404, 'curriculum_paper_file_not_found', 'Curriculum paper file was not found.')

    let handle
    try {
      const realRoot = await fsp.realpath(resolvedAssetRoot)
      const candidateLstat = await fsp.lstat(candidate)
      if (candidateLstat.isSymbolicLink()) throw new Error('symlink')
      const realFile = await fsp.realpath(candidate)
      if (!inside(realRoot, realFile)) throw new Error('outside root')
      handle = await fsp.open(realFile, 'r')
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size !== record.file.bytes || stat.size < 5 || stat.size > MAX_PDF_BYTES) throw new Error('size mismatch')
      const signature = statSignature(stat)
      const key = `${realFile}\0${record.file.sha256}`
      let cached = hashCache.get(key)
      if (!cached || cached.signature !== signature) {
        const hash = crypto.createHash('sha256')
        for await (const chunk of handle.createReadStream({ start: 0, end: stat.size - 1, autoClose: false })) {
          if (aborted()) throw new Error('request aborted')
          hash.update(chunk)
        }
        if (aborted()) throw new Error('request aborted')
        const after = await handle.stat()
        const valid = statSignature(after) === signature && hash.digest('hex') === record.file.sha256
        cached = { signature, valid }
        hashCache.delete(key)
        hashCache.set(key, cached)
        while (hashCache.size > 256) hashCache.delete(hashCache.keys().next().value)
      }
      if (!cached.valid) throw new Error('checksum mismatch')
      const signatureBytes = Buffer.alloc(5)
      const read = await handle.read(signatureBytes, 0, signatureBytes.length, 0)
      if (read.bytesRead !== 5 || signatureBytes.toString('ascii') !== '%PDF-') throw new Error('not pdf')
      return { handle, file: record.file, size: stat.size }
    } catch {
      await handle?.close().catch(() => {})
      fail(404, 'curriculum_paper_file_not_found', 'Curriculum paper file was not found.')
    }
  }

  async function serveFile(request, response, id) {
    const aborted = () => request.aborted || response.destroyed || response.writableEnded
    if (aborted()) return
    const opened = await verifiedFile(id, aborted)
    if (aborted()) {
      await opened.handle.close().catch(() => {})
      return
    }
    const etag = `"${opened.file.sha256}"`
    const range = requestedRange(request, opened.size, etag)
    if (range === false) {
      await opened.handle.close().catch(() => {})
      fail(416, 'curriculum_paper_range_not_satisfiable', 'Requested byte range is not satisfiable.', { 'Content-Range': `bytes */${opened.size}`, 'Accept-Ranges': 'bytes' })
    }
    const start = range?.start ?? 0
    const end = range?.end ?? opened.size - 1
    if (aborted()) {
      await opened.handle.close().catch(() => {})
      return
    }
    response.statusCode = range ? 206 : 200
    response.setHeader('Content-Type', 'application/pdf')
    response.setHeader('Content-Disposition', safeContentDisposition(opened.file.name, opened.file.id))
    response.setHeader('Content-Length', String(end - start + 1))
    response.setHeader('Accept-Ranges', 'bytes')
    response.setHeader('Cache-Control', 'private, no-store')
    response.setHeader('ETag', etag)
    response.setHeader('X-Content-Type-Options', 'nosniff')
    if (range) response.setHeader('Content-Range', `bytes ${start}-${end}/${opened.size}`)
    if (request.method === 'HEAD') {
      await opened.handle.close().catch(() => {})
      response.end()
      return
    }
    const stream = opened.handle.createReadStream({ start, end, autoClose: false })
    await new Promise(resolve => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        request.removeListener('aborted', stop)
        response.removeListener('close', stop)
        response.removeListener('finish', finish)
        if (!stream.destroyed) stream.destroy()
        opened.handle.close().catch(() => {}).finally(resolve)
      }
      const stop = () => {
        if (!stream.destroyed) stream.destroy()
        finish()
      }
      const streamError = () => {
        if (!response.destroyed) response.destroy()
        finish()
      }
      request.once('aborted', stop)
      stream.once('error', streamError)
      response.once('finish', finish)
      response.once('close', stop)
      if (aborted()) {
        stop()
        return
      }
      stream.pipe(response)
    })
  }

  return {
    list,
    async handle(request, response, url = new URL(request.url, 'http://127.0.0.1')) {
      const isList = url.pathname === '/api/stem/curriculum-papers'
      const isFile = url.pathname.startsWith(FILE_ROUTE)
      if (!isList && !isFile) return false
      try {
        if (isList) {
          if (request.method !== 'GET') fail(405, 'curriculum_method_not_allowed', 'Only GET is supported.', { Allow: 'GET' })
          jsonResponse(request, response, 200, await list(Object.fromEntries(url.searchParams)))
          return true
        }
        if (!['GET', 'HEAD'].includes(request.method)) fail(405, 'curriculum_method_not_allowed', 'Only GET and HEAD are supported.', { Allow: 'GET, HEAD' })
        let id = ''
        try {
          id = decodeURIComponent(url.pathname.slice(FILE_ROUTE.length))
        } catch {
          // Invalid percent encoding is indistinguishable from an unknown id.
        }
        await serveFile(request, response, id)
        return true
      } catch (error) {
        if (!request.aborted && !response.destroyed && !response.headersSent && !response.writableEnded) errorResponse(request, response, error)
        return true
      }
    },
  }
}
