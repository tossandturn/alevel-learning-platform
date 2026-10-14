import { defineConfig } from 'vite'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createAiApi } from './server/aiApi.js'
import { classifyMembershipProtectedAsset, createMembershipAccessController, membershipFeatureForRequest, membershipProtectedCacheControl } from './server/membershipAccess.js'
import { createAiVerifiedQuestionBankLoader } from './server/aiVerifiedQuestionBank.js'
import { resolveAiPdfIngestionRoot } from './server/aiPdfIngestionCandidates.js'
import { createCoachAttemptAuthorizer, createCurriculumPracticeAccess, createStemApi } from './server/stemApi.js'
import { createCurriculumPracticeApi } from './server/curriculumPracticeApi.js'
import { createTopicPdfRenderer } from './server/topicPdfRenderer.js'
import { isPaperAvailableToStudents } from './src/lib/paperGovernance.js'
import { mergeRuntimeEnv } from './src/lib/runtimeEnv.js'
import { resolveLibraryRoot } from './server/pdfLibrary.js'
import { artifactTreeIdentity } from './scripts/release-content-policy.mjs'
import {
  releaseIdMatchesCommit,
  sameTreeIdentity,
  validateBuildIdentity,
  validateReleaseManifest,
} from './scripts/release-manifest-contract.mjs'

const ALLOWED_SUBJECTS = new Set(['0580', '0606', '0610', '0625', '9231', '9700', '9701', '9702', '9708', '9709', 'bpho', 'amc12', 'esat', 'tmua'])
const PUBLIC_ROOT = path.resolve(process.cwd(), 'public')
const PUBLIC_METADATA_FILES = ['favicon.svg', 'icons.svg', 'robots.txt', 'sitemap.xml']
const QA_DISABLE_HMR = process.env.NODE_ENV === 'test' && process.env.STEM_QA_DISABLE_HMR === '1'
let paperCatalogCache = { path: '', modifiedAtMs: -1, byFile: new Map() }
const pdfIntegrityCache = new Map()

export function membershipClientBoundary() {
  return {
    name: 'membership-client-boundary',
    generateBundle() {
      const forbidden = []
      for (const id of this.getModuleIds()) {
        const normalized = String(id).replaceAll('\\', '/')
        if (normalized.endsWith('/src/data/verifiedPracticeCatalog.json')
            || normalized.endsWith('/src/data/importedQuestionIndex.json')
            || normalized.endsWith('/src/data/questionBank.js')
            || normalized.endsWith('/src/lib/verifiedPracticeCatalog.js')
            || normalized.endsWith('/src/lib/coachPractice.js')
            || normalized.includes('/public/data/study-question-index/')) forbidden.push(normalized)
      }
      if (forbidden.length) this.error(`Protected membership content entered the browser graph: ${forbidden.join(', ')}`)
    },
  }
}

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

export async function sendLocalPdf(request, response, next, env, runtimePdfDocuments = () => [], { protectedAccess = false } = {}) {
  const requestUrl = new URL(request.url, 'http://127.0.0.1')
  const segments = requestUrl.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  if (segments[0] !== 'local-pdf') return next()

  const [, subject, fileName] = segments
  if (!ALLOWED_SUBJECTS.has(subject) || !fileName || path.basename(fileName) !== fileName || !fileName.endsWith('.pdf')) {
    response.statusCode = 400
    response.end('Invalid local PDF path')
    return
  }

  const staticCatalogItem = paperCatalogIndex().get(`${subject}/${fileName}`)
  let runtimeCatalogItem = null
  try {
    runtimeCatalogItem = (runtimePdfDocuments() || []).find((item) => item?.subject === subject && item?.file === fileName) || null
  } catch {
    runtimeCatalogItem = null
  }
  const catalogItem = staticCatalogItem || runtimeCatalogItem
  if (!catalogItem) {
    recordPdfAccess(env, null, { outcome: 'catalog-denied', statusCode: 404, ranged: Boolean(request.headers.range) })
    response.statusCode = 404
    response.setHeader('Cache-Control', 'no-store')
    response.end('PDF is not available in the current governed catalog')
    return
  }

  const libraryRoot = resolveLibraryRoot({ env, cwd: process.cwd() })
  const filePath = path.resolve(libraryRoot, subject, fileName)
  const subjectRoot = path.resolve(libraryRoot, subject)
  if (!filePath.startsWith(`${subjectRoot}${path.sep}`) || !fs.existsSync(filePath)) {
    recordPdfAccess(env, catalogItem, { outcome: 'file-missing', statusCode: 404, ranged: Boolean(request.headers.range) })
    response.statusCode = 404
    response.setHeader('Cache-Control', 'no-store')
    response.end('PDF file is unavailable')
    return
  }

  const requestedRange = request.headers.range
  const stat = fs.statSync(filePath)
  if (stat.size !== Number(catalogItem.bytes)) {
    recordPdfAccess(env, catalogItem, { outcome: 'integrity-denied', statusCode: 409, ranged: Boolean(requestedRange) })
    response.statusCode = 409
    response.setHeader('Cache-Control', 'no-store')
    response.end('PDF integrity check failed')
    return
  }
  if (!(await verifiedPdfChecksum(filePath, catalogItem.sha256))) {
    recordPdfAccess(env, catalogItem, { outcome: 'checksum-denied', statusCode: 409, ranged: Boolean(requestedRange) })
    response.statusCode = 409
    response.setHeader('Cache-Control', 'no-store')
    response.end('PDF integrity check failed')
    return
  }

  const etag = `"${catalogItem.sha256}"`
  const ifRange = request.headers['if-range']
  // This route emits no Last-Modified validator. A range may be combined with
  // cached bytes only when If-Range is the exact strong content validator.
  // Weak, stale, date, and malformed validators receive the full current PDF.
  const range = requestedRange !== undefined
    && (ifRange === undefined || typeof ifRange === 'string' && ifRange.trim() === etag)
    ? requestedRange
    : null

  response.setHeader('Content-Type', 'application/pdf')
  response.setHeader('Accept-Ranges', 'bytes')
  response.setHeader('Content-Disposition', `inline; filename="${fileName}"`)
  response.setHeader('Cache-Control', membershipProtectedCacheControl(protectedAccess, 'private, max-age=3600'))
  if (protectedAccess) response.setHeader('Vary', 'Authorization, Cookie')
  response.setHeader('ETag', etag)

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

function contentTypeForPublicPath(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.css':
      return 'text/css; charset=utf-8'
    case '.gif':
      return 'image/gif'
    case '.htm':
    case '.html':
      return 'text/html; charset=utf-8'
    case '.jpeg':
    case '.jpg':
      return 'image/jpeg'
    case '.js':
    case '.mjs':
      return 'application/javascript; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.png':
      return 'image/png'
    case '.svg':
      return 'image/svg+xml'
    case '.txt':
      return 'text/plain; charset=utf-8'
    case '.webp':
      return 'image/webp'
    case '.xml':
      return 'application/xml; charset=utf-8'
    default:
      return 'application/octet-stream'
  }
}

function openPublicAsset(publicRoot, filePath) {
  const root = path.resolve(publicRoot)
  try {
    const visibleRoot = fs.lstatSync(root)
    if (visibleRoot.isSymbolicLink() || !visibleRoot.isDirectory()) return null
  } catch {
    return null
  }
  const relative = path.relative(root, filePath)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null
  let cursor = root
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment)
    let visible
    try { visible = fs.lstatSync(cursor) } catch { return null }
    if (visible.isSymbolicLink()) return null
  }
  let physicalRoot
  let physicalFile
  try {
    physicalRoot = fs.realpathSync.native(root)
    physicalFile = fs.realpathSync.native(filePath)
  } catch {
    return null
  }
  const physicalRelative = path.relative(physicalRoot, physicalFile)
  if (!physicalRelative || physicalRelative.startsWith('..') || path.isAbsolute(physicalRelative)) return null
  let descriptor
  try {
    const noFollow = Number(fs.constants.O_NOFOLLOW) || 0
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow)
    const stat = fs.fstatSync(descriptor)
    const visible = fs.lstatSync(filePath)
    if (!stat.isFile() || visible.isSymbolicLink() || stat.dev !== visible.dev || stat.ino !== visible.ino) {
      fs.closeSync(descriptor)
      return null
    }
    return { descriptor, stat }
  } catch {
    if (Number.isInteger(descriptor)) try { fs.closeSync(descriptor) } catch {}
    return null
  }
}

export function sendPublicAsset(request, response, next, { protectedAccess = false, publicRoot = PUBLIC_ROOT } = {}) {
  const requestUrl = new URL(request.url, 'http://127.0.0.1')
  let pathname
  try {
    pathname = decodeURIComponent(requestUrl.pathname)
  } catch {
    response.statusCode = 400
    response.setHeader('Cache-Control', 'no-store')
    response.end('Invalid public asset path')
    return
  }

  const isPublicMetadata = PUBLIC_METADATA_FILES.includes(pathname.slice(1))
  if (!isPublicMetadata && !pathname.startsWith('/data/') && !pathname.startsWith('/question-assets/')) return next()

  const resolvedPublicRoot = path.resolve(publicRoot)
  const filePath = path.resolve(resolvedPublicRoot, `.${pathname}`)
  const relative = path.relative(resolvedPublicRoot, filePath)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    response.statusCode = 400
    response.setHeader('Cache-Control', 'no-store')
    response.end('Invalid public asset path')
    return
  }

  const opened = openPublicAsset(resolvedPublicRoot, filePath)
  if (!opened) {
    response.statusCode = 404
    response.setHeader('Cache-Control', 'no-store')
    response.end('Public asset not found')
    return
  }
  const { descriptor, stat } = opened

  response.setHeader('Content-Type', contentTypeForPublicPath(filePath))
  if (protectedAccess) {
    response.setHeader('Cache-Control', membershipProtectedCacheControl(true, 'no-cache'))
    response.setHeader('Vary', 'Authorization, Cookie')
  } else if (pathname.startsWith('/question-assets/')) {
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  } else {
    response.setHeader('Cache-Control', 'no-cache')
  }
  // Explicit framing is required for large catalog files when this origin is
  // behind Nginx/Cloudflare/Tunnel. The proxy may still apply compression and
  // will adjust the representation headers, but the uncompressed origin body
  // must never be an unknown-length chunked stream.
  response.setHeader('Content-Length', String(stat.size))
  if (request.method === 'HEAD') {
    fs.closeSync(descriptor)
    response.end()
    return
  }
  fs.createReadStream(filePath, { fd: descriptor, autoClose: true }).pipe(response)
}

export function createMissingBuiltAssetMiddleware({ assetRoot = path.resolve(process.cwd(), 'dist') } = {}) {
  const resolvedAssetRoot = path.resolve(assetRoot)
  return function sendMissingBuiltAsset(request, response, next) {
    if (request.method && !['GET', 'HEAD'].includes(request.method)) return next()
    const requestUrl = new URL(request.url, 'http://127.0.0.1')
    let pathname
    try {
      pathname = decodeURIComponent(requestUrl.pathname)
    } catch {
      response.statusCode = 400
      response.setHeader('Content-Type', 'text/plain; charset=utf-8')
      response.setHeader('Cache-Control', 'no-store')
      response.end('Invalid built asset path')
      return
    }
    if (!/^\/assets\/.+\.js$/i.test(pathname)) return next()
    const filePath = path.resolve(resolvedAssetRoot, `.${pathname}`)
    const relative = path.relative(resolvedAssetRoot, filePath)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      response.statusCode = 400
      response.setHeader('Content-Type', 'text/plain; charset=utf-8')
      response.setHeader('Cache-Control', 'no-store')
      response.end('Invalid built asset path')
      return
    }
    const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null
    if (!stat || stat.isDirectory()) {
      response.statusCode = 404
      response.setHeader('Content-Type', 'text/plain; charset=utf-8')
      response.setHeader('Cache-Control', 'no-store')
      response.end('Built asset not found')
      return
    }
    response.statusCode = 200
    response.setHeader('Content-Type', 'application/javascript; charset=utf-8')
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    response.setHeader('Content-Length', String(stat.size))
    if (request.method === 'HEAD') {
      response.end()
      return
    }
    fs.createReadStream(filePath).pipe(response)
  }
}

export function releaseBuildIdentity(env, runtimeRootInput = process.cwd()) {
  try {
    const runtimeRoot = fs.realpathSync(runtimeRootInput)
    if (env.STEM_RELEASE_ROOT && fs.realpathSync(env.STEM_RELEASE_ROOT) !== runtimeRoot) return { status: 'unavailable' }
    const expectedManifestPath = path.join(runtimeRoot, 'release-manifest.json')
    const manifestPath = path.resolve(env.STEM_RELEASE_MANIFEST_PATH || expectedManifestPath)
    if (fs.realpathSync(manifestPath) !== fs.realpathSync(expectedManifestPath)) return { status: 'unavailable' }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    if (!validateReleaseManifest(manifest, { releaseId: path.basename(runtimeRoot) }).valid) return { status: 'unavailable' }
    if (env.STEM_RELEASE_ID && String(env.STEM_RELEASE_ID) !== manifest.releaseId) return { status: 'unavailable' }
    if (env.STEM_RELEASE_COMMIT && String(env.STEM_RELEASE_COMMIT).toLowerCase() !== manifest.commit) return { status: 'unavailable' }
    if (!releaseIdMatchesCommit(manifest.releaseId, manifest.commit)) return { status: 'unavailable' }
    const embeddedBuild = JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'dist', 'build-identity.json'), 'utf8'))
    if (!validateBuildIdentity(embeddedBuild, { commit: manifest.commit, requireClean: true }).valid) return { status: 'unavailable' }
    const releaseTree = artifactTreeIdentity(runtimeRoot, { exclude: ['release-manifest.json'] })
    if (!sameTreeIdentity(releaseTree, manifest.releaseTree)) return { status: 'unavailable' }
    const immutableAssetsRoot = fs.realpathSync(path.join(runtimeRoot, 'public', 'question-assets'))
    if (path.basename(immutableAssetsRoot) !== manifest.immutableAssets.identity) return { status: 'unavailable' }
    if (!sameTreeIdentity(artifactTreeIdentity(immutableAssetsRoot), manifest.immutableAssets)) return { status: 'unavailable' }
    return {
      status: 'verified',
      schemaVersion: manifest.schemaVersion,
      releaseId: manifest.releaseId,
      commit: manifest.commit,
      generatedAt: manifest.generatedAt,
    }
  } catch {
    return { status: 'unavailable' }
  }
}

function buildSourceIdentity(env, root) {
  const configured = String(env.STEM_BUILD_COMMIT || '').trim().toLowerCase()
  if (configured && !/^[a-f0-9]{40}$/.test(configured)) {
    throw new Error('STEM_BUILD_COMMIT must be a full lowercase Git commit.')
  }
  let gitRoot = ''
  try {
    gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    gitRoot = ''
  }
  if (gitRoot && fs.realpathSync(gitRoot) === fs.realpathSync(root)) {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().toLowerCase()
    if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Git HEAD did not resolve to a full commit.')
    if (configured && configured !== commit) throw new Error('STEM_BUILD_COMMIT does not match the actual Git HEAD.')
    const status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return { commit, sourceState: status ? 'dirty' : 'clean' }
  }
  return configured ? { commit: configured, sourceState: 'clean' } : null
}

function stemBuildIdentityOutput(env) {
  let resolvedRoot = process.cwd()
  let resolvedOutDir = path.resolve(process.cwd(), 'dist')
  return {
    name: 'stem-build-identity-output',
    apply: 'build',
    configResolved(config) {
      resolvedRoot = config.root
      resolvedOutDir = path.resolve(config.root, config.build.outDir || 'dist')
    },
    closeBundle() {
      const identity = buildSourceIdentity(env, resolvedRoot)
      if (!identity) throw new Error('A full Git commit is required to create the STEM build identity.')
      fs.writeFileSync(path.join(resolvedOutDir, 'build-identity.json'), `${JSON.stringify({
        schemaVersion: 'stem-build-identity.v1',
        ...identity,
      }, null, 2)}\n`, 'utf8')
    },
  }
}

function createHealthMiddleware(env) {
  const build = releaseBuildIdentity(env)
  return function sendHealth(request, response, next) {
    const requestUrl = new URL(request.url, 'http://127.0.0.1')
    if (!['/healthz', '/api/health'].includes(requestUrl.pathname)) return next()
    response.statusCode = 200
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')
    response.end(JSON.stringify({ ok: true, service: 'stem', build }))
  }
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

function stemAppModulePreload() {
  return {
    name: 'stem-app-modulepreload',
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        if (!context.bundle) return html
        const appChunk = Object.values(context.bundle).find((asset) => (
          asset.type === 'chunk'
          && /[/\\]src[/\\]App\.jsx$/.test(String(asset.facadeModuleId || ''))
        ))
        if (!appChunk || html.includes(appChunk.fileName)) return html
        return {
          html,
          tags: [{
            tag: 'link',
            attrs: {
              rel: 'modulepreload',
              crossorigin: '',
              href: `/${appChunk.fileName}`,
            },
            injectTo: 'head',
          }],
        }
      },
    },
  }
}

function stemPublicAssetOutput() {
  let resolvedRoot = process.cwd()
  let resolvedOutDir = path.resolve(process.cwd(), 'dist')
  return {
    name: 'stem-public-asset-output',
    apply: 'build',
    config() {
      return {
        build: {
          copyPublicDir: false,
        },
      }
    },
    configResolved(config) {
      resolvedRoot = config.root
      resolvedOutDir = path.resolve(config.root, config.build.outDir || 'dist')
    },
    closeBundle() {
      fs.mkdirSync(resolvedOutDir, { recursive: true })
      for (const fileName of PUBLIC_METADATA_FILES) {
        const source = path.resolve(resolvedRoot, 'public', fileName)
        const target = path.resolve(resolvedOutDir, fileName)
        if (fs.existsSync(source)) {
          fs.copyFileSync(source, target)
        }
      }
    },
  }
}

function localCieLibrary(env) {
  const libraryRoot = resolveLibraryRoot({ env, cwd: process.cwd() })
  const sendHealth = createHealthMiddleware(env)
  const runtimeAiQuestionBank = createAiVerifiedQuestionBankLoader({
    artifactRoot: resolveAiPdfIngestionRoot(env),
    // The runtime bank validates each artifact against its own subject folder.
    // Pass the complete private library so 9709 and other supported routes are
    // not silently excluded by a 9702-only root.
    libraryRoot,
  })
  const runtimeAiGroups = () => runtimeAiQuestionBank().groups
  const runtimePdfDocuments = () => runtimeAiQuestionBank().documents
  const topicPdfRenderer = createTopicPdfRenderer({
    artifactRoot: resolveAiPdfIngestionRoot(env),
    libraryRoot,
    timeoutMs: env.STEM_TOPIC_PDF_TIMEOUT_MS,
  })
  const stemApi = createStemApi({ env, topicQuestionBankProvider: runtimeAiGroups, libraryRoot, topicPdfRenderer })
  const curriculumReleaseRoot = env.STEM_CURRICULUM_PRACTICE_RELEASE_ROOT || '/home/ubuntu/alevel-physics/curriculum-practice/current'
  const curriculumPracticeAccess = createCurriculumPracticeAccess({ env })
  const curriculumPracticeApi = createCurriculumPracticeApi({
    releaseRoot: curriculumReleaseRoot,
    sourceAssetRoot: env.STEM_CURRICULUM_PRACTICE_SOURCE_ROOT || path.join(curriculumReleaseRoot, 'source'),
    ...curriculumPracticeAccess,
    authenticateRequest: curriculumPracticeAccess.authenticateMembershipRequest,
  })
  const curriculumMembershipAccess = createMembershipAccessController({ env })
  function handleMembershipMiddlewareError(response, next, error) {
    const statusCode = Number(error?.statusCode)
    const membershipCode = String(error?.code || '')
    const invalidPath = statusCode === 400 && membershipCode === 'protected_asset_path_invalid'
    if (!invalidPath && (![401, 403, 503].includes(statusCode)
        || (statusCode !== 401 && !membershipCode.startsWith('membership_')))) {
      next(error)
      return
    }
    const code = statusCode === 401 ? 'identity_required' : membershipCode
    const message = statusCode === 401 ? 'Sign in to continue.' : error.message
    const payload = Buffer.from(JSON.stringify({ code, error: message }), 'utf8')
    response.statusCode = statusCode
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('Content-Length', payload.length)
    response.setHeader('Cache-Control', 'no-store')
    response.end(payload)
  }
  async function requireProtectedMembership(request, pathname) {
    const classification = classifyMembershipProtectedAsset(pathname)
    if (classification.invalid) throw Object.assign(new Error('The protected asset path is invalid.'), { statusCode: 400, code: 'protected_asset_path_invalid' })
    const feature = classification.feature
    if (feature && curriculumMembershipAccess.enforcementEnabled()) {
      await curriculumMembershipAccess.requireFeature(curriculumPracticeAccess.authenticateMembershipRequest(request), feature)
      return true
    }
    return false
  }
  const membershipProtectedPublicAsset = (request, response, next) => {
    void (async () => {
      const pathname = new URL(request.url, 'http://127.0.0.1').pathname
      const protectedAccess = await requireProtectedMembership(request, pathname)
      sendPublicAsset(request, response, next, { protectedAccess })
    })().catch((error) => handleMembershipMiddlewareError(response, next, error))
  }
  const membershipProtectedLocalPdf = (request, response, next) => {
    void (async () => {
      const pathname = new URL(request.url, 'http://127.0.0.1').pathname
      const protectedAccess = await requireProtectedMembership(request, pathname)
      await sendLocalPdf(request, response, next, env, runtimePdfDocuments, { protectedAccess })
    })().catch((error) => handleMembershipMiddlewareError(response, next, error))
  }
  const curriculumPracticeMiddleware = (request, response, next) => {
    void (async () => {
      const pathname = new URL(request.url, 'http://127.0.0.1').pathname
      if (pathname.startsWith('/api/stem/curriculum-practice') && curriculumMembershipAccess.enforcementEnabled()) {
        const feature = membershipFeatureForRequest(request.method, pathname)
        if (feature) {
          await curriculumMembershipAccess.requireFeature(
            curriculumPracticeAccess.authenticateMembershipRequest(request),
            feature,
          )
          Object.defineProperty(request, 'membershipProtectedAccess', { value: true, configurable: false, enumerable: false })
        }
      }
      if (!await curriculumPracticeApi.handle(request, response)) next()
    })().catch((error) => handleMembershipMiddlewareError(response, next, error))
  }
  const aiApi = createAiApi({
    env,
    libraryRoot,
    allowedSubjects: ALLOWED_SUBJECTS,
    questionBankProvider: runtimeAiGroups,
    authorizeCoachRequest: createCoachAttemptAuthorizer({ env, questionBankProvider: runtimeAiGroups }),
    membershipIdentityProvider: curriculumPracticeAccess.authenticateMembershipRequest,
  })
  return {
    name: 'local-cie-library',
    configureServer(server) {
      server.middlewares.use(securityHeaders)
      server.middlewares.use(createMissingBuiltAssetMiddleware({ assetRoot: path.resolve(server.config.root, server.config.build.outDir || 'dist') }))
      server.middlewares.use(sendHealth)
      server.middlewares.use(membershipProtectedPublicAsset)
      server.middlewares.use(curriculumPracticeMiddleware)
      server.middlewares.use(stemApi)
      server.middlewares.use(aiApi)
      server.middlewares.use(membershipProtectedLocalPdf)
    },
    configurePreviewServer(server) {
      server.middlewares.use(securityHeaders)
      server.middlewares.use(createMissingBuiltAssetMiddleware({ assetRoot: path.resolve(server.config.root, server.config.build.outDir || 'dist') }))
      server.middlewares.use(sendHealth)
      server.middlewares.use(membershipProtectedPublicAsset)
      server.middlewares.use(curriculumPracticeMiddleware)
      server.middlewares.use(stemApi)
      server.middlewares.use(aiApi)
      server.middlewares.use(membershipProtectedLocalPdf)
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = mergeRuntimeEnv({
    cwd: process.cwd(),
    env: { ...process.env, ...loadEnv(mode, process.cwd(), '') },
  })
  return {
    server: QA_DISABLE_HMR ? { hmr: false } : undefined,
    preview: {
      allowedHosts: ['stem.ieltsist.com'],
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalizedId = id.replaceAll('\\', '/')
            if (normalizedId.endsWith('/src/data/sourceContentManifest.json')) return 'source-content-manifest'
            return undefined
          },
        },
      },
    },
    plugins: [
      react(),
      membershipClientBoundary(),
      stemAppModulePreload(),
      stemPublicAssetOutput(),
      stemBuildIdentityOutput(env),
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
