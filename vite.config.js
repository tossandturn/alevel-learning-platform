import { defineConfig } from 'vite'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createAiApi } from './server/aiApi.js'
import { createStemApi } from './server/stemApi.js'
import { isPaperAvailableToStudents } from './src/lib/paperGovernance.js'

const DEFAULT_LIBRARY_ROOT = 'D:/CodexWork/cie-fraft-fetcher/output/pdf'
const ALLOWED_SUBJECTS = new Set(['0580', '0606', '0610', '0625', '9231', '9700', '9701', '9702', '9708', '9709', 'bpho', 'amc12', 'esat', 'tmua'])
let paperCatalogCache = { path: '', modifiedAtMs: -1, byFile: new Map() }
const pdfIntegrityCache = new Map()

function paperCatalogIndex() {
  const root = process.cwd()
  const catalogPath = [
    path.resolve(root, 'public', 'data', 'papers.json'),
    path.resolve(root, 'dist', 'data', 'papers.json'),
  ].find((candidate) => fs.existsSync(candidate))
  if (!catalogPath) return new Map()
  const modifiedAtMs = fs.statSync(catalogPath).mtimeMs
  if (paperCatalogCache.path === catalogPath && paperCatalogCache.modifiedAtMs === modifiedAtMs) return paperCatalogCache.byFile
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  const byFile = new Map()
  for (const item of catalog.items || []) {
    if (isPaperAvailableToStudents(item)) byFile.set(`${item.subject}/${item.file}`, item)
  }
  paperCatalogCache = { path: catalogPath, modifiedAtMs, byFile }
  return byFile
}

async function verifiedPdfChecksum(filePath, expectedSha256) {
  const stat = await fs.promises.stat(filePath)
  const cached = pdfIntegrityCache.get(filePath)
  if (cached && cached.size === stat.size && cached.modifiedAtMs === stat.mtimeMs && cached.expectedSha256 === expectedSha256) return cached.ok
  const hash = await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath)
    const checksum = createHash('sha256')
    stream.on('data', (chunk) => checksum.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(checksum.digest('hex')))
  })
  const ok = hash === expectedSha256
  pdfIntegrityCache.set(filePath, { size: stat.size, modifiedAtMs: stat.mtimeMs, expectedSha256, ok })
  return ok
}

function pdfAccessLogPath(env) {
  if (env.STEM_PDF_ACCESS_LOG_PATH) return path.resolve(env.STEM_PDF_ACCESS_LOG_PATH)
  const databasePath = env.STEM_DATABASE_PATH || env.STEM_DB_PATH || path.join(process.cwd(), 'data', 'stem.sqlite')
  return path.join(path.dirname(path.resolve(databasePath)), 'pdf-access.log')
}

function recordPdfAccess(env, item, { outcome, statusCode, ranged }) {
  const row = {
    at: new Date().toISOString(),
    documentId: item?.id || null,
    subject: item?.subject || null,
    outcome,
    statusCode,
    transfer: ranged ? 'range' : 'full',
  }
  const target = pdfAccessLogPath(env)
  void fs.promises.mkdir(path.dirname(target), { recursive: true })
    .then(() => fs.promises.appendFile(target, `${JSON.stringify(row)}\n`, 'utf8'))
    .catch(() => {
      // Audit logging must not expose internals or turn a document request into a server error.
    })
}

async function sendLocalPdf(request, response, next, env) {
  const requestUrl = new URL(request.url, 'http://127.0.0.1')
  const segments = requestUrl.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  if (segments[0] !== 'local-pdf') return next()

  const [, subject, fileName] = segments
  if (!ALLOWED_SUBJECTS.has(subject) || !fileName || path.basename(fileName) !== fileName || !fileName.endsWith('.pdf')) {
    response.statusCode = 400
    response.end('Invalid local PDF path')
    return
  }

  const catalogItem = paperCatalogIndex().get(`${subject}/${fileName}`)
  if (!catalogItem) {
    recordPdfAccess(env, null, { outcome: 'catalog-denied', statusCode: 404, ranged: Boolean(request.headers.range) })
    response.statusCode = 404
    response.setHeader('Cache-Control', 'no-store')
    response.end('PDF is not available in the current governed catalog')
    return
  }

  const libraryRoot = path.resolve(env.CIE_LIBRARY_ROOT || DEFAULT_LIBRARY_ROOT)
  const filePath = path.resolve(libraryRoot, subject, fileName)
  const subjectRoot = path.resolve(libraryRoot, subject)
  if (!filePath.startsWith(`${subjectRoot}${path.sep}`) || !fs.existsSync(filePath)) {
    recordPdfAccess(env, catalogItem, { outcome: 'file-missing', statusCode: 404, ranged: Boolean(request.headers.range) })
    response.statusCode = 404
    response.setHeader('Cache-Control', 'no-store')
    response.end('PDF file is unavailable')
    return
  }

  const range = request.headers.range
  const stat = fs.statSync(filePath)
  if (stat.size !== Number(catalogItem.bytes)) {
    recordPdfAccess(env, catalogItem, { outcome: 'integrity-denied', statusCode: 409, ranged: Boolean(range) })
    response.statusCode = 409
    response.setHeader('Cache-Control', 'no-store')
    response.end('PDF integrity check failed')
    return
  }
  if (!(await verifiedPdfChecksum(filePath, catalogItem.sha256))) {
    recordPdfAccess(env, catalogItem, { outcome: 'checksum-denied', statusCode: 409, ranged: Boolean(range) })
    response.statusCode = 409
    response.setHeader('Cache-Control', 'no-store')
    response.end('PDF integrity check failed')
    return
  }

  response.setHeader('Content-Type', 'application/pdf')
  response.setHeader('Accept-Ranges', 'bytes')
  response.setHeader('Content-Disposition', `inline; filename="${fileName}"`)
  response.setHeader('Cache-Control', 'private, max-age=3600')

  if (!range) {
    response.setHeader('Content-Length', stat.size)
    recordPdfAccess(env, catalogItem, { outcome: 'served', statusCode: 200, ranged: false })
    fs.createReadStream(filePath).pipe(response)
    return
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range)
  if (!match) {
    recordPdfAccess(env, catalogItem, { outcome: 'invalid-range', statusCode: 416, ranged: true })
    response.statusCode = 416
    response.setHeader('Content-Range', `bytes */${stat.size}`)
    response.end()
    return
  }

  const start = match[1] ? Number(match[1]) : 0
  const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1
  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || start >= stat.size) {
    recordPdfAccess(env, catalogItem, { outcome: 'invalid-range', statusCode: 416, ranged: true })
    response.statusCode = 416
    response.setHeader('Content-Range', `bytes */${stat.size}`)
    response.end()
    return
  }

  response.statusCode = 206
  response.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`)
  response.setHeader('Content-Length', end - start + 1)
  recordPdfAccess(env, catalogItem, { outcome: 'served', statusCode: 206, ranged: true })
  fs.createReadStream(filePath, { start, end }).pipe(response)
}

function sendHealth(request, response, next) {
  const requestUrl = new URL(request.url, 'http://127.0.0.1')
  if (!['/healthz', '/api/health'].includes(requestUrl.pathname)) return next()
  response.statusCode = 200
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify({ ok: true, service: 'stem' }))
}

function securityHeaders(request, response, next) {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()')
  response.setHeader('Content-Security-Policy', "frame-ancestors 'self'")

  const requestUrl = new URL(request.url, 'http://127.0.0.1')
  const forwardedProto = String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase()
  if (forwardedProto === 'https' || String(process.env.STEM_FORCE_HSTS || '').trim() === '1') {
    response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }

  if (/^\/assets\/.+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/i.test(requestUrl.pathname)) {
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  } else if (requestUrl.pathname === '/' || requestUrl.pathname.endsWith('.html')) {
    response.setHeader('Cache-Control', 'no-cache')
  }
  return next()
}

function localCieLibrary(env) {
  const libraryRoot = path.resolve(env.CIE_LIBRARY_ROOT || DEFAULT_LIBRARY_ROOT)
  const aiApi = createAiApi({ env, libraryRoot, allowedSubjects: ALLOWED_SUBJECTS })
  const stemApi = createStemApi({ env })
  return {
    name: 'local-cie-library',
    configureServer(server) {
      server.middlewares.use(securityHeaders)
      server.middlewares.use(sendHealth)
      server.middlewares.use(stemApi)
      server.middlewares.use(aiApi)
      server.middlewares.use((request, response, next) => {
        void sendLocalPdf(request, response, next, env).catch(next)
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use(securityHeaders)
      server.middlewares.use(sendHealth)
      server.middlewares.use(stemApi)
      server.middlewares.use(aiApi)
      server.middlewares.use((request, response, next) => {
        void sendLocalPdf(request, response, next, env).catch(next)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') }
  return {
    preview: {
      allowedHosts: ['stem.ieltsist.com'],
    },
    plugins: [
      react(),
      viteStaticCopy({
        targets: [
          { src: 'node_modules/pdfjs-dist/cmaps/*', dest: 'pdfjs/cmaps', rename: { stripBase: true } },
          { src: 'node_modules/pdfjs-dist/standard_fonts/*', dest: 'pdfjs/standard_fonts', rename: { stripBase: true } },
        ],
      }),
      localCieLibrary(env),
    ],
  }
})
