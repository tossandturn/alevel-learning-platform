import fs from 'node:fs'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { isAiMarkablePastPaperItem, studyQuestionBank } from '../src/data/questionBank.js'
import { renderVerifiedCoordinatePdfPage } from './coordinatePdfImages.js'
import {
  auditedMarkSchemeAssetEvidence,
  auditedQuestionAssetEvidence,
  canonicalAiMarkingProvenance,
  documentPageFromAssetUrl,
  requiredMarkSchemeAssetEvidence,
  requiredSourceAssetEvidence,
  STEM_AI_COORDINATE_SOURCE_BINDING_SCHEMA_VERSION,
  STEM_AI_SOURCE_BINDING_SCHEMA_VERSION,
  STEM_MARKING_MANIFEST_SCHEMA_VERSION,
  STEM_SOURCE_REVIEW_SCHEMA_VERSION,
} from '../src/lib/sourceContentContract.js'
import { validHmacJwt, verifyMarkingCapability } from './markingCapability.js'

const IMAGE_PATTERN = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/
const MAX_BODY_BYTES = 16 * 1024 * 1024
const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const MAX_COACH_IMAGE_COUNT = 4
const MAX_COACH_IMAGE_BYTES = 4 * 1024 * 1024
const MAX_COACH_TOTAL_IMAGE_BYTES = 10 * 1024 * 1024
const TEMP_IMAGE_TTL_MS = 5 * 60 * 1000
const PDF_TEXT_CACHE_MAX_ENTRIES = 6
const COACH_CONTEXT_CACHE_MAX_ENTRIES = 48
const COACH_CONTEXT_MAX_CHARS = 4_800
const DEFAULT_AI_PROVIDER_TIMEOUT_MS = 25_000
const DEFAULT_AI_REQUEST_DEADLINE_MS = 50_000
const MIN_AI_TIMEOUT_MS = 250
const MAX_AI_PROVIDER_TIMEOUT_MS = 45_000
const MAX_AI_REQUEST_DEADLINE_MS = 55_000
const pdfTextCache = new Map()
const coachContextCache = new Map()
const CIE_SUBJECTS = new Set(['0580', '0606', '0625', '9231', '9701', '9702', '9708', '9709'])
const DEFAULT_SOURCE_ASSET_ROOT = path.resolve(import.meta.dirname, '..', 'public', 'question-assets')
let extraSourceCache = null
const temporaryImages = new Map()

function sendJson(response, statusCode, value) {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(value))
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let bytes = 0
    request.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request is too large.'), { statusCode: 413 }))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        reject(Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400 }))
      }
    })
    request.on('error', reject)
  })
}

function compactText(value, maxLength = 18000) {
  const clean = String(value || '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  return clean.length > maxLength ? `${clean.slice(0, maxLength)}\n...[truncated]` : clean
}

function boundedCacheSet(cache, key, value, maxEntries) {
  if (cache.has(key)) cache.delete(key)
  cache.set(key, value)
  while (cache.size > maxEntries) cache.delete(cache.keys().next().value)
}

function authenticatedStemUser(request, env) {
  const token = String(request.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1]
  const identitySigningKey = env.STEM_IDENTITY_SIGNING_KEY || env.STEM_INTERNAL_AUTH_KEY
  const claims = validHmacJwt(token, identitySigningKey, { issuer: 'ieltsist.com', audience: 'stem.ieltsist.com', maxLifetimeSeconds: 60 * 60 })
  return claims && /^ielts:\d+$/.test(String(claims.sub)) ? String(claims.sub) : null
}

function compactCoachContextText(value, maxLength = 4000) {
  return compactText(value, maxLength)
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/_=-]+/gi, '[image omitted]')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function verifiedCoachSubmission(payload, request, env) {
  const userId = authenticatedStemUser(request, env)
  const grant = validHmacJwt(payload.submissionGrant, env.COACH_SUBMISSION_SIGNING_KEY, { issuer: 'stem.ieltsist.com', audience: 'stem-ai', maxLifetimeSeconds: 15 * 60 })
  if (!userId || !grant || grant.sub !== userId || grant.scope !== 'coach:worked-solution') return false
  const question = payload.context?.question || {}
  return String(grant.attemptId || '') === String(payload.context?.attemptId || '')
    && String(grant.questionId || '') === String(question.id || question.questionId || '')
    && String(grant.paperId || '') === String(payload.context?.paper?.id || payload.context?.paper?.paperId || '')
}

function safeCoachContext(value) {
  const source = value && typeof value === 'object' ? value : {}
  const question = source.question && typeof source.question === 'object' ? source.question : {}
  const paper = source.paper && typeof source.paper === 'object' ? source.paper : {}
  const contextText = compactCoachContextText(source.contextText || source.sourceQuestionExtract, 4000)
  return {
    subject: typeof source.subject === 'object' ? { code: compactText(source.subject.code, 20), name: compactText(source.subject.name, 100) } : compactText(source.subject, 80),
    syllabus: compactText(source.syllabus, 200), stage: compactText(source.stage, 30), topic: compactText(source.topic, 200), attemptId: compactText(source.attemptId, 100),
    question: { id: compactText(question.id || question.questionId, 160), number: Number(question.number) || null, title: compactText(question.title, 300), prompt: compactText(question.prompt, 4000), hint: compactText(question.hint, 1000) },
    paper: { id: compactText(paper.id || paper.paperId, 160), questionFile: compactText(paper.questionFile, 180), markSchemeFile: compactText(paper.markSchemeFile, 180) },
    ...(contextText ? { contextText, sourceQuestionExtract: contextText } : {}),
    agentIntent: source.agentIntent && typeof source.agentIntent === 'object' ? { type: compactText(source.agentIntent.type, 80) } : null,
  }
}

function imageBytes(dataUrl) {
  const match = String(dataUrl || '').match(IMAGE_PATTERN)
  if (!match) throw Object.assign(new Error('Attached image must be PNG, JPEG or WebP.'), { statusCode: 400 })
  const bytes = Buffer.byteLength(match[2], 'base64')
  if (!bytes || bytes > MAX_IMAGE_BYTES) throw Object.assign(new Error('Attached image is empty or too large.'), { statusCode: 400 })
  return bytes
}

function coachImageDataUrls(payload) {
  const source = Array.isArray(payload?.imageDataUrls)
    ? payload.imageDataUrls
    : payload?.imageDataUrl
      ? [payload.imageDataUrl]
      : []
  const images = source.map((value) => String(value || '').trim()).filter(Boolean)
  if (images.length > MAX_COACH_IMAGE_COUNT) {
    throw Object.assign(new Error(`Attach no more than ${MAX_COACH_IMAGE_COUNT} images.`), { statusCode: 400 })
  }
  let totalBytes = 0
  for (const image of images) {
    const bytes = imageBytes(image)
    if (bytes > MAX_COACH_IMAGE_BYTES) {
      throw Object.assign(new Error('Each Coach image must be under 4 MB after compression.'), { statusCode: 400 })
    }
    totalBytes += bytes
  }
  if (totalBytes > MAX_COACH_TOTAL_IMAGE_BYTES) {
    throw Object.assign(new Error('Coach attachments are too large. Remove a photo or choose smaller images.'), { statusCode: 400 })
  }
  return images
}

function cleanupTemporaryImages() {
  const now = Date.now()
  for (const [token, image] of temporaryImages) {
    if (image.expiresAt > now) continue
    temporaryImages.delete(token)
    fs.rm(image.filePath, { force: true }, () => {})
  }
}

async function temporaryImageUrl(dataUrl, publicBaseUrl) {
  if (!publicBaseUrl) return { url: dataUrl, cleanup: () => {} }
  const match = String(dataUrl || '').match(IMAGE_PATTERN)
  if (!match) throw Object.assign(new Error('Handwriting image must be PNG, JPEG or WebP.'), { statusCode: 400 })
  cleanupTemporaryImages()
  const extension = match[1] === 'jpeg' ? 'jpg' : match[1]
  const mime = `image/${match[1] === 'jpg' ? 'jpeg' : match[1]}`
  const token = crypto.randomUUID()
  const directory = path.join(os.tmpdir(), 'alevel-physics-ai-images')
  const filePath = path.join(directory, `${token}.${extension}`)
  await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 })
  await fs.promises.writeFile(filePath, Buffer.from(match[2], 'base64'), { mode: 0o600 })
  temporaryImages.set(token, { filePath, mime, expiresAt: Date.now() + TEMP_IMAGE_TTL_MS })
  return {
    url: `${publicBaseUrl.replace(/\/+$/, '')}/api/ai/image/${token}`,
    cleanup: () => {
      temporaryImages.delete(token)
      fs.rm(filePath, { force: true }, () => {})
    },
  }
}

async function temporaryProviderImages(dataUrls, publicBaseUrl) {
  const images = []
  try {
    for (const dataUrl of dataUrls) images.push(await temporaryImageUrl(dataUrl, publicBaseUrl))
    return images
  } catch (error) {
    images.forEach((image) => image.cleanup())
    throw error
  }
}

function providerMessageContent(text, providerImages) {
  if (!providerImages.length) return text
  return [
    { type: 'text', text },
    ...providerImages.map((image) => ({ type: 'image_url', image_url: { url: image.url } })),
  ]
}

function handleTemporaryImage(requestUrl, response) {
  const token = requestUrl.pathname.slice('/api/ai/image/'.length)
  if (!/^[0-9a-f-]{36}$/i.test(token)) return sendJson(response, 404, { error: 'Image not found.' })
  const image = temporaryImages.get(token)
  if (!image || image.expiresAt <= Date.now()) {
    temporaryImages.delete(token)
    if (image?.filePath) fs.rm(image.filePath, { force: true }, () => {})
    return sendJson(response, 404, { error: 'Image not found.' })
  }
  response.statusCode = 200
  response.setHeader('Content-Type', image.mime)
  response.setHeader('Cache-Control', 'no-store')
  fs.createReadStream(image.filePath)
    .on('error', () => {
      if (!response.headersSent) response.statusCode = 404
      response.end()
    })
    .pipe(response)
  return true
}

function extraSourceMap(libraryRoot) {
  if (extraSourceCache) return extraSourceCache
  extraSourceCache = new Map()
  const manifestPath = path.join(path.dirname(libraryRoot), 'extra-contests-manifest.json')
  if (!fs.existsSync(manifestPath)) return extraSourceCache
  for (const item of JSON.parse(fs.readFileSync(manifestPath, 'utf8'))) {
    if (item.url && item.downloaded !== 'missing') extraSourceCache.set(`${item.subject}/${item.file}`, item.url)
  }
  return extraSourceCache
}

function remotePdfUrl(libraryRoot, subject, fileName) {
  if (CIE_SUBJECTS.has(subject)) return `https://cie.fraft.cn/obj/Common/Fetch/redir/${encodeURIComponent(fileName)}`
  return extraSourceMap(libraryRoot).get(`${subject}/${fileName}`) || null
}

function resolvePdfReference(libraryRoot, allowedSubjects, subject, fileName) {
  if (!allowedSubjects.has(subject) || !fileName || path.basename(fileName) !== fileName || !fileName.toLowerCase().endsWith('.pdf')) {
    throw Object.assign(new Error('Invalid paper reference.'), { statusCode: 400 })
  }
  const subjectRoot = path.resolve(libraryRoot, subject)
  const filePath = path.resolve(subjectRoot, fileName)
  if (filePath.startsWith(`${subjectRoot}${path.sep}`) && fs.existsSync(filePath)) return { type: 'local', filePath }
  const url = remotePdfUrl(libraryRoot, subject, fileName)
  if (!url) throw Object.assign(new Error('Referenced paper is unavailable.'), { statusCode: 404 })
  return { type: 'remote', url }
}

async function pdfBytes(reference) {
  if (reference.type === 'local') {
    const stat = fs.statSync(reference.filePath)
    return {
      cacheKey: `${reference.filePath}:${stat.size}:${stat.mtimeMs}`,
      data: fs.readFileSync(reference.filePath),
    }
  }
  const response = await fetch(reference.url)
  if (!response.ok) throw Object.assign(new Error('Referenced paper is unavailable.'), { statusCode: 404 })
  const buffer = Buffer.from(await response.arrayBuffer())
  return { cacheKey: `${reference.url}:${buffer.length}`, data: buffer }
}

async function extractPdfText(reference) {
  const { cacheKey, data } = await pdfBytes(reference)
  if (pdfTextCache.has(cacheKey)) {
    const cached = pdfTextCache.get(cacheKey)
    pdfTextCache.delete(cacheKey)
    pdfTextCache.set(cacheKey, cached)
    return cached
  }
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: new Uint8Array(data), disableWorker: true })
  const document = await task.promise
  const pages = []
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      pages.push(`[Page ${pageNumber}]\n${content.items.map((item) => item.str).join(' ')}`)
    }
  } finally {
    if (typeof document.destroy === 'function') await document.destroy()
  }
  const text = pages.join('\n\n')
  boundedCacheSet(pdfTextCache, cacheKey, text, PDF_TEXT_CACHE_MAX_ENTRIES)
  return text
}

function questionExcerpt(text, questionNumber) {
  const source = String(text || '')
  if (!source) return ''
  const marker = new RegExp(`(?:^|\\n|\\s)${questionNumber}\\s+(?=[A-Za-z(])`, 'm')
  const match = marker.exec(source)
  if (!match) return compactText(source)
  const start = Math.max(0, match.index - 800)
  return compactText(source.slice(start, start + 12000), 12000)
}

function subjectCodeForQuestion(question) {
  const match = String(question?.sourceRef?.paper || '').match(/^(\d{4})[_-]/)
  return match?.[1] || String(question?.subjectId || '')
}

function sourceAssetPath(assetRoot, assetUrl) {
  let pathname
  try {
    pathname = decodeURIComponent(new URL(String(assetUrl || ''), 'https://stem.local').pathname)
  } catch {
    return null
  }
  const prefix = '/question-assets/'
  if (!pathname.startsWith(prefix)) return null
  const parts = pathname.slice(prefix.length).split('/')
  if (!parts.length || parts.some((part) => !part || part === '.' || part === '..' || part.includes('\\'))) return null
  const root = path.resolve(assetRoot)
  const resolved = path.resolve(root, ...parts)
  const relative = path.relative(root, resolved)
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? resolved : null
}

function imageMimeType(assetUrl) {
  const extension = path.extname(String(assetUrl || '')).toLowerCase()
  if (extension === '.png') return 'image/png'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  return ''
}

function sourceContextFailure(code) {
  return Object.assign(new Error('The paired official source images are unavailable for this response.'), {
    statusCode: 422,
    code,
  })
}

function evidenceByPage(parts, evidenceForPart, documentSha256) {
  const byPage = new Map()
  for (const part of parts || []) {
    for (const evidence of evidenceForPart(part)) {
      if (evidence.documentSha256 && evidence.documentSha256 !== documentSha256) {
        throw sourceContextFailure('source_asset_document_mismatch')
      }
      const existing = byPage.get(evidence.page)
      if (existing && existing.assetSha256 !== evidence.assetSha256) {
        throw sourceContextFailure('source_asset_checksum_conflict')
      }
      byPage.set(evidence.page, evidence)
    }
  }
  return byPage
}

function assetUrlByPage(assetUrls, page) {
  return (assetUrls || []).find((url) => documentPageFromAssetUrl(url) === Number(page)) || ''
}

function localOfficialImage({ assetRoot, assetUrl, page, expectedSha256, role, region = null }) {
  const filePath = sourceAssetPath(assetRoot, assetUrl)
  const mimeType = imageMimeType(assetUrl)
  if (!filePath || !mimeType || !fs.existsSync(filePath)) throw sourceContextFailure('source_asset_unavailable')
  const bytes = fs.readFileSync(filePath)
  if (!bytes.length) throw sourceContextFailure('source_asset_unavailable')
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== expectedSha256) throw sourceContextFailure('source_asset_checksum_mismatch')
  return Object.freeze({
    role,
    page: Number(page),
    sha256,
    region: Array.isArray(region) ? [...region] : null,
    dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
  })
}

function mergeAiMarkingQuestionBanks(baseQuestionBank, additionalQuestionBank) {
  const questions = new Map()
  for (const question of [...(Array.isArray(baseQuestionBank) ? baseQuestionBank : []), ...(Array.isArray(additionalQuestionBank) ? additionalQuestionBank : [])]) {
    const routeId = String(question?.routeId || '').trim()
    const sourceQuestionId = String(question?.sourceQuestionId || question?.questionGroupId || '').trim()
    if (!routeId || !sourceQuestionId) continue
    questions.set(`${routeId}\u0000${sourceQuestionId}`, question)
  }
  return Object.freeze([...questions.values()])
}

function coordinateRegion(value) {
  if (!Array.isArray(value) || value.length !== 4) return null
  const [x0, y0, x1, y1] = value.map(Number)
  return [x0, y0, x1, y1].every(Number.isFinite) && x0 >= 0 && y0 >= 0 && x1 <= 1 && y1 <= 1 && x0 < x1 && y0 < y1
    ? [x0, y0, x1, y1]
    : null
}

function coordinatePageEvidence(entries, { expectedDocumentSha256 = '', requireRegion = false, failureCode }) {
  const expectedHash = String(expectedDocumentSha256 || '').trim().toLowerCase()
  const byPage = new Map()
  for (const entry of Array.isArray(entries) ? entries : []) {
    const page = Number(entry?.page)
    const pageImageSha256 = String(entry?.pageImageSha256 || '').trim().toLowerCase()
    const region = coordinateRegion(entry?.region)
    if (!Number.isInteger(page) || page <= 0 || !/^[a-f0-9]{64}$/.test(pageImageSha256)) throw sourceContextFailure(failureCode)
    if (expectedHash && entry?.documentSha256 && String(entry.documentSha256).trim().toLowerCase() !== expectedHash) {
      throw sourceContextFailure('source_asset_document_mismatch')
    }
    if (requireRegion && (entry?.coordinateSpace !== 'normalized-xyxy' || !region)) throw sourceContextFailure(failureCode)
    const existing = byPage.get(page)
    if (existing && existing.pageImageSha256 !== pageImageSha256) throw sourceContextFailure('source_asset_checksum_conflict')
    byPage.set(page, { page, pageImageSha256, region })
  }
  return [...byPage.values()].sort((left, right) => left.page - right.page)
}

function coordinatePdfFileName(value, failureCode) {
  const fileName = String(value || '').trim()
  if (!fileName || path.basename(fileName) !== fileName || !fileName.toLowerCase().endsWith('.pdf')) throw sourceContextFailure(failureCode)
  return fileName
}

async function coordinateOfficialImages(canonical, { libraryRoot, env, deadlineAt = null }) {
  const question = canonical.question
  const part = canonical.part
  const sourceRef = question.sourceRef || {}
  const answerRef = question.answerRef || {}
  const subject = subjectCodeForQuestion(question)
  const questionFile = coordinatePdfFileName(sourceRef.paper, 'source_asset_evidence_missing')
  const markSchemeFile = coordinatePdfFileName(answerRef.file, 'mark_scheme_asset_evidence_missing')
  const questionEvidence = coordinatePageEvidence(part.sourceEvidence, {
    expectedDocumentSha256: sourceRef.sha256,
    requireRegion: true,
    failureCode: 'source_asset_evidence_missing',
  })
  const markSchemeEvidence = coordinatePageEvidence(part.markSchemeEvidence, {
    failureCode: 'mark_scheme_asset_evidence_missing',
  })
  if (!subject || !questionEvidence.length) throw sourceContextFailure('source_asset_evidence_missing')
  if (!markSchemeEvidence.length) throw sourceContextFailure('mark_scheme_asset_evidence_missing')
  const renderDpi = sourceRef.renderDpi ?? answerRef.renderDpi
  const [questionImages, markSchemeImages] = await Promise.all([
    Promise.all(questionEvidence.map((evidence) => renderVerifiedCoordinatePdfPage({
      libraryRoot,
      subject,
      fileName: questionFile,
      expectedPdfSha256: sourceRef.sha256,
      page: evidence.page,
      expectedPageImageSha256: evidence.pageImageSha256,
      role: 'question-paper',
      region: evidence.region,
      renderDpi,
      deadlineAt,
      env,
    }))),
    Promise.all(markSchemeEvidence.map((evidence) => renderVerifiedCoordinatePdfPage({
      libraryRoot,
      subject,
      fileName: markSchemeFile,
      expectedPdfSha256: answerRef.sha256,
      page: evidence.page,
      expectedPageImageSha256: evidence.pageImageSha256,
      role: 'mark-scheme',
      renderDpi,
      deadlineAt,
      env,
    }))),
  ])
  return Object.freeze({ questionImages: Object.freeze(questionImages), markSchemeImages: Object.freeze(markSchemeImages) })
}

/**
 * Resolve official QP/MS images from the current reviewed server binding.
 * The request never supplies source URLs, hashes or image bytes for official
 * material, so a stale or forged client capability cannot alter AI context.
 */
export async function canonicalHandwritingMarkingImages(canonical, { assetRoot = DEFAULT_SOURCE_ASSET_ROOT, libraryRoot, env = process.env, deadlineAt = null } = {}) {
  if (!canonical?.ok || !canonical.question || !canonical.part) throw sourceContextFailure('source_provenance_missing')
  const question = canonical.question
  const sourceRef = question.sourceRef || {}
  const answerRef = question.answerRef || {}
  if (canonical.provenance?.reviewSchemaVersion === STEM_AI_COORDINATE_SOURCE_BINDING_SCHEMA_VERSION) {
    return coordinateOfficialImages(canonical, { libraryRoot, env, deadlineAt })
  }
  if (canonical.provenance?.reviewSchemaVersion === STEM_AI_SOURCE_BINDING_SCHEMA_VERSION) {
    const questionImages = auditedQuestionAssetEvidence(question).map((evidence) => localOfficialImage({
      assetRoot,
      assetUrl: evidence.assetUrl,
      page: evidence.page,
      expectedSha256: evidence.assetSha256,
      role: 'question-paper',
    }))
    const markSchemeImages = auditedMarkSchemeAssetEvidence(question).map((evidence) => localOfficialImage({
      assetRoot,
      assetUrl: evidence.assetUrl,
      page: evidence.page,
      expectedSha256: evidence.assetSha256,
      role: 'mark-scheme',
    }))
    if (!questionImages.length) throw sourceContextFailure('source_asset_evidence_missing')
    if (!markSchemeImages.length) throw sourceContextFailure('mark_scheme_asset_evidence_missing')
    return Object.freeze({
      questionImages: Object.freeze(questionImages),
      markSchemeImages: Object.freeze(markSchemeImages),
    })
  }
  const sourceEvidence = evidenceByPage([canonical.part], requiredSourceAssetEvidence, String(sourceRef.sha256 || ''))
  const questionImages = [...sourceEvidence.entries()].map(([page, evidence]) => {
    const assetUrl = assetUrlByPage(sourceRef.assetUrls, page)
    if (!assetUrl) throw sourceContextFailure('source_asset_evidence_missing')
    return localOfficialImage({
      assetRoot,
      assetUrl,
      page,
      expectedSha256: evidence.assetSha256,
      role: 'question-paper',
    })
  })
  if (!questionImages.length) throw sourceContextFailure('source_asset_evidence_missing')

  const markSchemeEvidence = evidenceByPage([canonical.part], requiredMarkSchemeAssetEvidence, String(answerRef.sha256 || ''))
  const markSchemeImages = [...markSchemeEvidence.entries()].map(([page, evidence]) => {
    const assetUrl = assetUrlByPage(answerRef.assetUrls, page)
    if (!assetUrl) throw sourceContextFailure('mark_scheme_asset_evidence_missing')
    return localOfficialImage({
      assetRoot,
      assetUrl,
      page,
      expectedSha256: evidence.assetSha256,
      role: 'mark-scheme',
    })
  })
  if (!markSchemeImages.length) throw sourceContextFailure('mark_scheme_asset_evidence_missing')

  return Object.freeze({
    questionImages: Object.freeze(questionImages),
    markSchemeImages: Object.freeze(markSchemeImages),
  })
}

/**
 * Client supplied flags and mark points are display data only. This resolves
 * the exact source group and part against the server's current effective bank
 * before a provider request can be made.
 */
export function canonicalHandwritingMarkingContext(payload = {}, { questionBank = studyQuestionBank } = {}) {
  const provenance = payload?.provenance || {}
  const sourceQuestionId = String(provenance.sourceQuestionId || '').trim()
  const questionPartId = String(provenance.questionPartId || '')
  const routeId = String(provenance.routeId || '')
  const bindingSignature = String(provenance.bindingSignature || '')
  const reviewSchemaVersion = String(provenance.reviewSchemaVersion || '')
  const reviewVersion = String(provenance.reviewVersion || '')
  const sourceDocumentSha256 = String(provenance.sourceDocumentSha256 || '')
  const answerDocumentSha256 = String(provenance.answerDocumentSha256 || '')
  const sourceIndexSha256 = String(provenance.sourceIndexSha256 || '')
  const sourceManifestChecksum = String(provenance.sourceManifestChecksum || '')
  if (!sourceQuestionId || sourceQuestionId.includes('@') || !questionPartId || !routeId || !bindingSignature || !reviewSchemaVersion || !reviewVersion || !sourceDocumentSha256 || !answerDocumentSha256 || !sourceIndexSha256 || !sourceManifestChecksum || !provenance.sourceEvidence) {
    return Object.freeze({ ok: false, code: 'source_provenance_missing' })
  }
  if (provenance.manifestSchemaVersion !== STEM_MARKING_MANIFEST_SCHEMA_VERSION || ![STEM_SOURCE_REVIEW_SCHEMA_VERSION, STEM_AI_SOURCE_BINDING_SCHEMA_VERSION, STEM_AI_COORDINATE_SOURCE_BINDING_SCHEMA_VERSION].includes(reviewSchemaVersion)) {
    return Object.freeze({ ok: false, code: 'source_provenance_mismatch' })
  }

  const effectiveQuestionBank = Array.isArray(questionBank) ? questionBank : studyQuestionBank
  const question = effectiveQuestionBank.find((item) => (
    item.routeId === routeId
    && item.sourceQuestionId === sourceQuestionId
    && isAiMarkablePastPaperItem(item)
  ))
  if (!question) return Object.freeze({ ok: false, code: 'source_question_unreviewed' })
  const part = (question.parts || []).find((item) => item.partId === questionPartId)
  if (!part || !Number.isFinite(Number(part.marks)) || Number(part.marks) <= 0) {
    return Object.freeze({ ok: false, code: 'source_question_unknown' })
  }
  const canonicalProvenance = canonicalAiMarkingProvenance(question, part)
  if (!canonicalProvenance) return Object.freeze({ ok: false, code: 'source_question_unreviewed' })
  const sourceEvidence = provenance.sourceEvidence || {}
  const sourceMatches = sourceEvidence.assetId === canonicalProvenance.sourceEvidence.assetId
    && Number(sourceEvidence.page) === canonicalProvenance.sourceEvidence.page
    && String(sourceEvidence.assetUrl || '') === canonicalProvenance.sourceEvidence.assetUrl
    && String(sourceEvidence.assetSha256 || '') === canonicalProvenance.sourceEvidence.assetSha256
    && String(sourceEvidence.quote || '') === canonicalProvenance.sourceEvidence.quote
    && (!canonicalProvenance.sourceEvidence.coordinateSpace || (
      sourceEvidence.coordinateSpace === canonicalProvenance.sourceEvidence.coordinateSpace
      && JSON.stringify(sourceEvidence.region || null) === JSON.stringify(canonicalProvenance.sourceEvidence.region || null)
      && Number(sourceEvidence.markSchemePage) === Number(canonicalProvenance.sourceEvidence.markSchemePage)
      && String(sourceEvidence.markSchemePageImageSha256 || '') === String(canonicalProvenance.sourceEvidence.markSchemePageImageSha256 || '')
    ))
  if (reviewSchemaVersion !== canonicalProvenance.reviewSchemaVersion
    || bindingSignature !== canonicalProvenance.bindingSignature
    || reviewVersion !== canonicalProvenance.reviewVersion
    || sourceDocumentSha256 !== canonicalProvenance.sourceDocumentSha256
    || answerDocumentSha256 !== canonicalProvenance.answerDocumentSha256
    || sourceIndexSha256 !== canonicalProvenance.sourceIndexSha256
    || sourceManifestChecksum !== canonicalProvenance.sourceManifestChecksum
    || !sourceMatches) {
    return Object.freeze({ ok: false, code: 'source_provenance_mismatch' })
  }

  const questionNumber = Number(String(question.sourceRef?.question || '').match(/\d+/)?.[0])
  const subject = subjectCodeForQuestion(question)
  if (!questionNumber || !subject) return Object.freeze({ ok: false, code: 'canonical_question_context_missing' })
  return Object.freeze({
    ok: true,
    sourceQuestionId,
    questionPartId,
    question,
    part,
    provenance: canonicalProvenance,
    autoFinal: [STEM_AI_SOURCE_BINDING_SCHEMA_VERSION, STEM_AI_COORDINATE_SOURCE_BINDING_SCHEMA_VERSION].includes(canonicalProvenance.reviewSchemaVersion),
    subject,
    questionNumber,
  })
}

export function providerConfig(env = {}) {
  const explicitProvider = String(env.AI_PROVIDER || env.COACH_AI_PROVIDER || env.PHYSICS_AI_PROVIDER || '').trim().toLowerCase()
  const openAiKey = env.OPENAI_API_KEY || env.OPENAI_COACH_API_KEY || ''
  const selectedProvider = explicitProvider === 'qwen' || explicitProvider === 'dashscope'
    ? 'qwen'
    : explicitProvider === 'openai'
      ? 'openai'
      : openAiKey
        ? 'openai'
        : 'qwen'
  const workspaceId = env.DASHSCOPE_WORKSPACE_ID || env.QWEN_WORKSPACE_ID || ''
  const region = env.DASHSCOPE_REGION || 'cn-beijing'
  const dashscopeBase = workspaceId
    ? `https://${workspaceId}.${region}.maas.aliyuncs.com/compatible-mode/v1`
    : 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  const compatibleBaseUrl = normalizeCompatibleBaseUrl(env.DASHSCOPE_COMPAT_BASE_URL || dashscopeBase)
  const dashscopeKey = env.DASHSCOPE_API_KEY || env.QWEN_API_KEY || ''
  const sharedKey = env.PHYSICS_AI_API_KEY || dashscopeKey
  const sharedBaseUrl = (env.PHYSICS_AI_BASE_URL || compatibleBaseUrl).replace(/\/+$/, '')
  const publicBaseUrl = env.PHYSICS_PUBLIC_BASE_URL || env.PUBLIC_BASE_URL || ''
  const imageMode = env.PHYSICS_AI_IMAGE_MODE === 'url' ? 'url' : 'data-url'
  const qwenCoach = {
    name: 'qwen',
    label: 'Qwen',
    apiKey: env.COACH_AI_API_KEY || env.QWEN_COACH_API_KEY || sharedKey,
    baseUrl: normalizeCompatibleBaseUrl(env.COACH_AI_BASE_URL || env.QWEN_COACH_BASE_URL || sharedBaseUrl),
    model: env.COACH_AI_MODEL || env.QWEN_COACH_MODEL || env.PHYSICS_COACH_MODEL || 'qwen3.7-max',
    publicBaseUrl,
    imageMode,
  }
  const qwenVision = {
    name: 'qwen',
    label: 'Qwen',
    apiKey: env.VISION_AI_API_KEY || env.QWEN_VISION_API_KEY || sharedKey,
    baseUrl: normalizeCompatibleBaseUrl(env.VISION_AI_BASE_URL || env.QWEN_VISION_BASE_URL || sharedBaseUrl),
    model: env.VISION_AI_MODEL || env.QWEN_VISION_MODEL || env.PHYSICS_VISION_MODEL || 'qwen3-vl-plus',
    publicBaseUrl,
    imageMode,
  }
  if (selectedProvider === 'openai') {
    const openAiBaseUrl = normalizeOpenAiChatBaseUrl(env.OPENAI_CHAT_BASE_URL || env.OPENAI_BASE_URL || 'https://api.openai.com/v1')
    const openAiCoachModel = env.OPENAI_COACH_MODEL || env.OPENAI_MODEL || 'gpt-5.6'
    const openAiCoach = {
      name: 'openai',
      label: 'OpenAI',
      apiKey: openAiKey,
      baseUrl: openAiBaseUrl,
      model: openAiCoachModel,
      publicBaseUrl,
      imageMode,
      fallback: qwenCoach,
    }
    const openAiVision = {
      name: 'openai',
      label: 'OpenAI',
      apiKey: env.OPENAI_VISION_API_KEY || openAiKey,
      baseUrl: normalizeOpenAiChatBaseUrl(env.OPENAI_VISION_BASE_URL || openAiBaseUrl),
      model: env.OPENAI_VISION_MODEL || env.OPENAI_MODEL || openAiCoachModel,
      publicBaseUrl,
      imageMode,
      fallback: qwenVision,
    }
    return {
      provider: 'openai',
      coach: openAiCoach,
      vision: openAiVision,
    }
  }
  return {
    provider: 'qwen',
    coach: qwenCoach,
    vision: qwenVision,
  }
}

function normalizeCompatibleBaseUrl(value) {
  const source = String(value || '').trim().replace(/[\r\n]+/g, '').replace(/\/+$/, '')
  if (!source) return ''
  if (/\/(?:chat\/completions|responses)$/i.test(source)) return source.replace(/\/(?:chat\/completions|responses)$/i, '')
  return source
}

export function normalizeOpenAiChatBaseUrl(value) {
  const source = String(value || '').trim().replace(/[\r\n]+/g, '').replace(/\/+$/, '')
  if (!source) return ''
  const hasExplicitEndpoint = /\/chat\/completions$/i.test(source)
  const withoutEndpoint = hasExplicitEndpoint
    ? source.replace(/\/chat\/completions$/i, '')
    : source
  if (hasExplicitEndpoint || /\/v1$/i.test(withoutEndpoint)) return withoutEndpoint
  return `${withoutEndpoint}/v1`
}

function imagePublicBase(provider, request) {
  return provider.imageMode === 'url' ? provider.publicBaseUrl || publicBaseUrlFromRequest(request) : ''
}

function publicBaseUrlFromRequest(request) {
  const host = String(request.headers.host || '')
  if (!host || /^127\.0\.0\.1(?::|$)|^localhost(?::|$)/i.test(host)) return ''
  const forwardedProto = String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim()
  const proto = forwardedProto || 'https'
  return `${proto}://${host}`
}

function providerMessage(error, provider) {
  const label = provider?.label || 'AI provider'
  const message = String(error?.message || error || '')
  if (/timeout|timed out|abort/i.test(message)) return `${label} request timed out. Check the server network and retry.`
  if (/fetch failed|econn|enotfound|network/i.test(message)) return `${label} network request failed. Check the server network and retry.`
  const status = message.match(/AI provider returned (\d{3})/)?.[1]
  if (status === '401' || status === '403') return `${label} authentication or model access failed. Check the server key and model permission.`
  if (status === '404') return `${label} model or endpoint was not found. Check the Base URL and model ID.`
  if (status) return `${label} upstream returned HTTP ${status}. Retry or check the provider configuration.`
  return `${label} review is temporarily unavailable. Your answer remains saved.`
}

function providerSampling(provider, temperature) {
  return provider?.name === 'openai' && /^gpt-5/i.test(String(provider.model || '')) ? {} : { temperature }
}

function providerCandidates(provider) {
  const candidates = []
  const seen = new Set()
  let current = provider
  while (current && !seen.has(current)) {
    seen.add(current)
    if (current.apiKey) candidates.push(current)
    current = current.fallback
  }
  return candidates
}

function boundedDuration(value, fallback, minimum, maximum) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return fallback
  return Math.min(maximum, Math.max(minimum, Math.round(number)))
}

function aiTimeoutConfig(env = {}) {
  const providerTimeoutMs = boundedDuration(
    env.STEM_AI_PROVIDER_TIMEOUT_MS || env.PHYSICS_AI_PROVIDER_TIMEOUT_MS,
    DEFAULT_AI_PROVIDER_TIMEOUT_MS,
    MIN_AI_TIMEOUT_MS,
    MAX_AI_PROVIDER_TIMEOUT_MS,
  )
  const requestDeadlineMs = boundedDuration(
    env.STEM_AI_REQUEST_DEADLINE_MS || env.PHYSICS_AI_REQUEST_DEADLINE_MS,
    DEFAULT_AI_REQUEST_DEADLINE_MS,
    providerTimeoutMs,
    MAX_AI_REQUEST_DEADLINE_MS,
  )
  return Object.freeze({ providerTimeoutMs, requestDeadlineMs })
}

function aiDeadlineError() {
  const error = new Error('AI request deadline exceeded.')
  error.name = 'AbortError'
  error.code = 'AI_REQUEST_DEADLINE'
  return error
}

function effectiveAiTimeoutMs(timeoutMs, deadlineAt) {
  const configuredTimeoutMs = boundedDuration(timeoutMs, DEFAULT_AI_PROVIDER_TIMEOUT_MS, 1, MAX_AI_PROVIDER_TIMEOUT_MS)
  if (!Number.isFinite(deadlineAt)) return configuredTimeoutMs
  const remainingMs = Math.floor(deadlineAt - Date.now())
  if (remainingMs <= 0) throw aiDeadlineError()
  return Math.min(configuredTimeoutMs, remainingMs)
}

function emitProviderTelemetry(telemetry, event) {
  const safeEvent = {
    requestId: String(event.requestId || '').replace(/[^a-z0-9._:-]/gi, '').slice(0, 80) || null,
    operation: String(event.operation || 'ai').slice(0, 40),
    provider: String(event.provider || '').slice(0, 40),
    model: String(event.model || '').slice(0, 120),
    providerAttempt: Number.isInteger(event.providerAttempt) && event.providerAttempt > 0 ? Math.min(event.providerAttempt, 10) : 1,
    fallbackPath: String(event.fallbackPath || event.provider || '').replace(/[^a-z0-9._:>-]/gi, '').slice(0, 160),
    timeoutMs: boundedDuration(event.timeoutMs, DEFAULT_AI_PROVIDER_TIMEOUT_MS, 1, MAX_AI_REQUEST_DEADLINE_MS),
    fallback: Boolean(event.fallback),
    statusCode: Number.isInteger(event.statusCode) ? event.statusCode : null,
    schemaStatus: String(event.schemaStatus || 'unknown').slice(0, 40),
    durationMs: Math.max(0, Number(event.durationMs) || 0),
    finalState: String(event.finalState || 'error').slice(0, 40),
  }
  try {
    if (typeof telemetry === 'function') telemetry(safeEvent)
    else console.info(`[ai-provider] ${JSON.stringify(safeEvent)}`)
  } catch {
    // Telemetry must never change provider or marking behavior.
  }
}

function aiResponseSchemaError(error) {
  const schemaError = error instanceof Error ? error : new Error(String(error || 'AI provider returned an invalid response schema.'))
  schemaError.code = 'AI_RESPONSE_SCHEMA_INVALID'
  return schemaError
}

async function callCompatibleAi(provider, { messages, temperature = 0.2, json = false, operation = 'ai', requestId = '', providerAttempt = 1, fallbackPath = '', fallback = false, telemetry = null, timeoutMs = DEFAULT_AI_PROVIDER_TIMEOUT_MS, deadlineAt = null, validateResponse = null }) {
  const startedAt = Date.now()
  let statusCode = null
  let schemaStatus = 'not-checked'
  let finalState = provider.apiKey ? 'error' : 'not_configured'
  let requestTimeoutMs = timeoutMs
  if (!provider.apiKey) {
    emitProviderTelemetry(telemetry, { requestId, operation, provider: provider.name, model: provider.model, providerAttempt, fallbackPath, fallback, timeoutMs: requestTimeoutMs, statusCode, schemaStatus, finalState, durationMs: Date.now() - startedAt })
    return null
  }
  let timeout = null
  try {
    requestTimeoutMs = effectiveAiTimeoutMs(timeoutMs, deadlineAt)
    const controller = new AbortController()
    timeout = setTimeout(() => controller.abort(), requestTimeoutMs)
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: provider.model, messages, ...providerSampling(provider, temperature), stream: false, ...(json ? { response_format: { type: 'json_object' } } : {}) }),
      signal: controller.signal,
    })
    statusCode = response.status
    if (!response.ok) {
      const providerPayload = await response.json().catch(() => ({}))
      const providerCode = compactText(providerPayload?.error?.code || providerPayload?.code, 80)
      const providerDetail = compactText(providerPayload?.error?.message || providerPayload?.message, 140)
      throw new Error(`AI provider returned ${response.status}${providerCode ? ` (${providerCode})` : ''}${providerDetail ? `: ${providerDetail}` : ''}`)
    }
    let payload
    try {
      payload = await response.json()
    } catch (error) {
      schemaStatus = 'invalid'
      throw aiResponseSchemaError(error)
    }
    const answer = String(payload?.choices?.[0]?.message?.content || '').trim()
    if (!Array.isArray(payload?.choices) || !answer) {
      schemaStatus = 'invalid'
      throw aiResponseSchemaError('AI provider returned an invalid response schema.')
    }
    if (typeof validateResponse === 'function') {
      try {
        validateResponse(answer)
      } catch (error) {
        schemaStatus = 'invalid'
        throw aiResponseSchemaError(error)
      }
    }
    schemaStatus = 'valid'
    finalState = 'connected'
    return answer
  } catch (error) {
    finalState = error?.name === 'AbortError' ? 'timeout' : 'error'
    throw error
  } finally {
    if (timeout) clearTimeout(timeout)
    emitProviderTelemetry(telemetry, { requestId, operation, provider: provider.name, model: provider.model, providerAttempt, fallbackPath, fallback, timeoutMs: requestTimeoutMs, statusCode, schemaStatus, finalState, durationMs: Date.now() - startedAt })
  }
}

export function parseStructuredJson(value) {
  const source = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('AI response did not contain structured JSON.')
  return JSON.parse(source.slice(start, end + 1))
}

function validateMarkAssessment(value, requestedMaxMarks) {
  const maxMarks = Math.max(1, Math.round(Number(requestedMaxMarks) || 1))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AI assessment must be an object.')
  if (!Object.hasOwn(value, 'rawMarks') || typeof value.rawMarks !== 'number' || !Number.isFinite(value.rawMarks) || !Number.isInteger(value.rawMarks)) throw new Error('AI assessment rawMarks is missing or invalid.')
  if (Number(value.rawMarks) < 0 || Number(value.rawMarks) > maxMarks) throw new Error('AI assessment rawMarks is outside the requested mark range.')
  if (!Object.hasOwn(value, 'confidence') || typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) throw new Error('AI assessment confidence is missing or invalid.')
  if (typeof value.reviewRequired !== 'boolean') throw new Error('AI assessment reviewRequired is missing or invalid.')
  if (!Array.isArray(value.markPoints) || !value.markPoints.length) throw new Error('AI assessment markPoints are missing or invalid.')
  const pointIds = new Set()
  let totalMarks = 0
  for (const point of value.markPoints) {
    if (!point || typeof point !== 'object' || Array.isArray(point)) throw new Error('AI assessment mark point is invalid.')
    if (typeof point.id !== 'string' || !point.id.trim() || pointIds.has(point.id.trim())) throw new Error('AI assessment mark point ID is missing or duplicated.')
    if (typeof point.awarded !== 'boolean') throw new Error('AI assessment mark point awarded must be boolean.')
    if (typeof point.marks !== 'number' || !Number.isFinite(point.marks) || !Number.isInteger(point.marks) || point.marks < 0 || point.marks > maxMarks) throw new Error('AI assessment mark point marks are invalid.')
    if ((!point.awarded && point.marks !== 0) || (point.awarded && point.marks <= 0)) throw new Error('AI assessment mark point awarded state conflicts with marks.')
    if (typeof point.reason !== 'string' || !point.reason.trim()) throw new Error('AI assessment mark point rationale is missing.')
    if (typeof point.studentEvidence !== 'string' || !point.studentEvidence.trim()) throw new Error('AI assessment mark point student evidence is missing.')
    pointIds.add(point.id.trim())
    totalMarks += point.marks
  }
  if (totalMarks !== value.rawMarks) throw new Error('AI assessment mark points do not reconcile with rawMarks.')
  return value
}

export function normalizeMarkResult(value, requestedMaxMarks) {
  const maxMarks = Math.max(1, Math.round(Number(requestedMaxMarks) || 1))
  const rawMarks = Math.min(maxMarks, Math.max(0, Math.round(Number(value.rawMarks) || 0)))
  const suppliedMarkPoints = Array.isArray(value.markPoints) ? value.markPoints.slice(0, maxMarks + 4).map((point, index) => ({
    id: String(point.id || `M${index + 1}`).slice(0, 30),
    awarded: Boolean(point.awarded),
    marks: Math.min(maxMarks, Math.max(0, Number(point.marks) || (point.awarded ? 1 : 0))),
    reason: compactText(point.reason, 500),
    studentEvidence: compactText(point.studentEvidence, 500),
  })) : []
  const markPoints = suppliedMarkPoints.length ? suppliedMarkPoints : [{
    id: 'AI-overall',
    awarded: rawMarks > 0,
    marks: rawMarks,
    reason: compactText(value.summary, 500) || `AI examiner awarded ${rawMarks}/${maxMarks}.`,
    studentEvidence: compactText(value.recognizedWork, 500),
  }]
  return {
    rawMarks,
    maxMarks,
    confidence: Math.max(0, Math.min(1, Number(value.confidence) || 0.5)),
    reviewRequired: Boolean(value.reviewRequired) || Number(value.confidence) < 0.7,
    summary: compactText(value.summary, 1000) || 'Handwritten response reviewed.',
    recognizedWork: compactText(value.recognizedWork, 4000),
    correctedSolution: compactText(value.correctedSolution, 5000),
    nextAction: compactText(value.nextAction, 800),
    markPoints,
  }
}

export function buildCoachSystemPrompt({ verifiedSubmitted = false, hintLevel = 1 } = {}) {
  return [
    'You are AI Coach, a rigorous and patient STEM teacher inside a Cambridge IGCSE, International AS & A Level and admissions-test practice platform.',
    'Support Physics, Mathematics, Further Mathematics, Chemistry, Economics, BPhO, ESAT and TMUA. Respond in concise Chinese while preserving Cambridge command words, symbols and subject terminology in English.',
    'For a broad conceptual question, teach the idea and ask one useful follow-up when scope is ambiguous. For a focused question, use the supplied question, syllabus component, source paper, student work and prior messages.',
    'When agentIntent.type is clarify-practice, do not invent a topic or questions. Ask the student to choose one of the supplied syllabus topics and confirm the stage before building a verified set.',
    'Official question text, answers and marks may only be stated when present in the supplied QP/MS context. Never invent, complete or paraphrase missing past-paper content as if it were official. Clearly separate general teaching from source-backed marking.',
    `Hint level is ${hintLevel}/5. Level 1 identifies the concept; level 2 points to data or a formula; level 3 diagnoses one step; level 4 shows the next step; level 5 may give a worked solution.`,
    verifiedSubmitted ? 'This practice attempt is submitted, so a complete worked correction is allowed using the available source evidence.' : 'The attempt is in progress. Do not reveal the final answer or a complete worked solution, even if asked.',
    'For calculations, check method, substitution, units, signs, significant figures and whether the conclusion answers the command word.',
    'For image input, read only handwriting, equations, graphs or diagrams you can actually see. Give the first blocked or incorrect step and a concrete next action. State uncertainty explicitly.',
  ].join('\n')
}

function localCoachReply(context, hintLevel) {
  const question = compactText(context?.question?.prompt || context?.question?.title || '', 500)
  const hint = compactText(context?.question?.hint || '', 500)
  if (hint) return `提示 ${hintLevel}/5: ${hint}`
  if (question) return `提示 ${hintLevel}/5: 先确定题目的 command word 和对应定义或公式，再把已知量统一成 SI units。当前使用本地安全提示，因此不会猜测完整解答。`
  return '先选择一道具体题目，再问我概念、下一步或方法检查。当前使用本地安全提示。'
}
async function hydrateCoachPaperContext(context, libraryRoot, allowedSubjects) {
  const subject = String(context?.subject?.code || context?.subject || '')
  const questionFile = String(context?.paper?.questionFile || '')
  const questionNumber = Number(context?.question?.number || context?.questionNumber)
  if (!subject || !questionFile || !questionNumber) return context
  const questionReference = resolvePdfReference(libraryRoot, allowedSubjects, subject, questionFile)
  const { cacheKey } = await pdfBytes(questionReference)
  const contextKey = `${cacheKey}:q${questionNumber}`
  let questionText = coachContextCache.get(contextKey)
  if (questionText) {
    coachContextCache.delete(contextKey)
    coachContextCache.set(contextKey, questionText)
  } else {
    questionText = questionExcerpt(await extractPdfText(questionReference), questionNumber)
    boundedCacheSet(coachContextCache, contextKey, questionText, COACH_CONTEXT_CACHE_MAX_ENTRIES)
  }
  return { ...context, sourceQuestionExtract: compactText(questionText, COACH_CONTEXT_MAX_CHARS) }
}

function shouldUseLocalCoachFirst({ message, hasImages, hintLevel }) {
  if (hasImages) return false
  const clean = String(message || '').trim()
  if (!clean || clean.length > 180 || Number(hintLevel) > 2) return false
  return /(?:hint|nudge|next step|what should i practise|check my method|提示|下一步|练什么|方法检查)/i.test(clean)
}

function coachRequestContext(context, message) {
  return compactText(JSON.stringify({
    subject: context.subject,
    syllabus: context.syllabus,
    stage: context.stage,
    topic: context.topic,
    question: context.question,
    paper: context.paper,
    sourceQuestionExtract: context.sourceQuestionExtract,
    studentRequest: message,
  }), COACH_CONTEXT_MAX_CHARS)
}

async function handleCoach(request, response, provider, visionProvider, libraryRoot, allowedSubjects, env, telemetry, timeoutConfig) {
  const payload = await readJsonBody(request)
  const message = compactText(payload.message, 3000)
  const history = Array.isArray(payload.history) ? payload.history.slice(-10).map((item) => ({ role: item.role === 'assistant' ? 'assistant' : 'user', content: compactText(item.content, 3000) })) : []
  // Client context is useful for tutoring, but cannot authorize answer release.
  // In particular, `context.submitted` is deliberately discarded here.
  const suppliedContext = safeCoachContext(payload.context)
  const context = await hydrateCoachPaperContext(suppliedContext, libraryRoot, allowedSubjects)
  const verifiedSubmitted = verifiedCoachSubmission(payload, request, env)
  const hintLevel = Math.min(5, Math.max(1, Number(payload.hintLevel) || 1))
  const imageDataUrls = coachImageDataUrls(payload)
  const hasImages = imageDataUrls.length > 0
  if (!message && !hasImages) throw Object.assign(new Error('Ask a question or attach an image.'), { statusCode: 400 })
  const localAnswer = localCoachReply(context, hintLevel)
  if (shouldUseLocalCoachFirst({ message, hasImages, hintLevel })) {
    return sendJson(response, 200, {
      mode: 'local',
      providerStatus: 'skipped',
      answer: localAnswer,
      warning: 'Local first hint. Ask for a detailed explanation to escalate to AI Coach.',
      retryable: false,
      canEscalate: true,
    })
  }
  if (!authenticatedStemUser(request, env)) {
    throw Object.assign(new Error('Sign in to STEM before using detailed AI Coach.'), { statusCode: 401 })
  }
  const configuredProvider = hasImages ? visionProvider : provider
  const activeProviders = providerCandidates(configuredProvider)
  if (!activeProviders.length) return sendJson(response, 200, { mode: 'offline', providerStatus: 'not_configured', answer: localAnswer, warning: 'AI Coach provider is not configured on this server. This is an offline hint, not an AI review.' })
  const userText = coachRequestContext(context, message)
  const deadlineAt = Date.now() + timeoutConfig.requestDeadlineMs
  const requestId = crypto.randomUUID()
  let lastError = null
  for (const [providerIndex, activeProvider] of activeProviders.entries()) {
    let providerImages = []
    try {
      providerImages = await temporaryProviderImages(imageDataUrls, imagePublicBase(activeProvider, request))
      const content = providerMessageContent(userText, providerImages)
      const answer = await callCompatibleAi(activeProvider, {
        messages: [{ role: 'system', content: buildCoachSystemPrompt({ verifiedSubmitted, hintLevel }) }, ...history, { role: 'user', content }],
        temperature: 0.2,
        operation: hasImages ? 'coach-vision' : 'coach',
        requestId,
        providerAttempt: providerIndex + 1,
        fallbackPath: activeProviders.slice(0, providerIndex + 1).map((candidate) => candidate.name).join('>'),
        fallback: providerIndex > 0,
        telemetry,
        timeoutMs: timeoutConfig.providerTimeoutMs,
        deadlineAt,
      })
      return sendJson(response, 200, { mode: 'ai', provider: activeProvider.name, providerStatus: 'connected', answer: answer || localAnswer, model: activeProvider.model })
    } catch (error) {
      lastError = error
    } finally {
      providerImages.forEach((image) => image.cleanup())
    }
  }
  const failedProvider = activeProviders.at(-1)
  return sendJson(response, 200, { mode: 'offline', provider: failedProvider.name, providerStatus: 'error', answer: localAnswer, warning: providerMessage(lastError, failedProvider), retryable: true })
}

async function callCompatibleAiStream(provider, { messages, temperature = 0.2, onDelta, operation = 'ai-stream', requestId = '', providerAttempt = 1, fallbackPath = '', fallback = false, telemetry = null, timeoutMs = DEFAULT_AI_PROVIDER_TIMEOUT_MS, deadlineAt = null }) {
  const startedAt = Date.now()
  let statusCode = null
  let schemaStatus = 'not-checked'
  let finalState = provider.apiKey ? 'error' : 'not_configured'
  let requestTimeoutMs = timeoutMs
  if (!provider.apiKey) {
    emitProviderTelemetry(telemetry, { requestId, operation, provider: provider.name, model: provider.model, providerAttempt, fallbackPath, fallback, timeoutMs: requestTimeoutMs, statusCode, schemaStatus, finalState, durationMs: Date.now() - startedAt })
    return { answer: '', providerStatus: 'not_configured' }
  }
  let timeout = null
  let answer = ''
  try {
    requestTimeoutMs = effectiveAiTimeoutMs(timeoutMs, deadlineAt)
    const controller = new AbortController()
    timeout = setTimeout(() => controller.abort(), requestTimeoutMs)
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: provider.model, messages, ...providerSampling(provider, temperature), stream: true }),
      signal: controller.signal,
    })
    statusCode = response.status
    if (!response.ok) {
      const providerPayload = await response.json().catch(() => ({}))
      const providerCode = compactText(providerPayload?.error?.code || providerPayload?.code, 80)
      const providerDetail = compactText(providerPayload?.error?.message || providerPayload?.message, 140)
      throw new Error(`AI provider returned ${response.status}${providerCode ? ` (${providerCode})` : ''}${providerDetail ? `: ${providerDetail}` : ''}`)
    }

    const contentType = response.headers.get('content-type') || ''
    if (!response.body || !contentType.includes('text/event-stream')) {
      let payload
      try {
        payload = await response.json()
      } catch (error) {
        schemaStatus = 'invalid'
        throw aiResponseSchemaError(error)
      }
      answer = String(payload?.choices?.[0]?.message?.content || '').trim()
      if (!Array.isArray(payload?.choices) || !answer) {
        schemaStatus = 'invalid'
        throw new Error('AI provider returned an invalid response schema.')
      }
      schemaStatus = 'valid'
      await onDelta?.(answer)
      finalState = 'connected'
      return { answer, providerStatus: 'connected' }
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let receivedDone = false
    async function consumeLine(line) {
      const clean = line.trim()
      if (!clean || !clean.startsWith('data:')) return
      const data = clean.slice(5).trim()
      if (!data) return
      if (data === '[DONE]') {
        receivedDone = true
        return
      }
      let payload
      try {
        payload = JSON.parse(data)
      } catch (error) {
        schemaStatus = 'invalid'
        throw aiResponseSchemaError(error)
      }
      const delta = String(payload?.choices?.[0]?.delta?.content || payload?.choices?.[0]?.message?.content || '')
      if (!delta) return
      answer += delta
      await onDelta?.(delta)
    }

    while (true) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ''
      for (const line of lines) await consumeLine(line)
      if (done) break
    }
    if (buffer) await consumeLine(buffer)
    answer = answer.trim()
    if (!answer || !receivedDone) {
      schemaStatus = 'invalid'
      throw aiResponseSchemaError('AI provider stream ended without a complete response.')
    }
    schemaStatus = 'valid'
    finalState = 'connected'
    return { answer, providerStatus: 'connected' }
  } catch (error) {
    finalState = error?.name === 'AbortError' ? 'timeout' : 'error'
    throw error
  } finally {
    if (timeout) clearTimeout(timeout)
    emitProviderTelemetry(telemetry, { requestId, operation, provider: provider.name, model: provider.model, providerAttempt, fallbackPath, fallback, timeoutMs: requestTimeoutMs, statusCode, schemaStatus, finalState, durationMs: Date.now() - startedAt })
  }
}

function sendCoachEvent(response, event, value) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`)
}

async function handleCoachStream(request, response, provider, visionProvider, libraryRoot, allowedSubjects, env, telemetry, timeoutConfig) {
  const payload = await readJsonBody(request)
  const message = compactText(payload.message, 3000)
  const history = Array.isArray(payload.history)
    ? payload.history.slice(-8).map((item) => ({
      role: item.role === 'assistant' ? 'assistant' : 'user',
      content: compactText(item.content, 1200),
    }))
    : []
  const suppliedContext = safeCoachContext(payload.context)
  const context = await hydrateCoachPaperContext(suppliedContext, libraryRoot, allowedSubjects)
  const verifiedSubmitted = verifiedCoachSubmission(payload, request, env)
  const hintLevel = Math.min(5, Math.max(1, Number(payload.hintLevel) || 1))
  const imageDataUrls = coachImageDataUrls(payload)
  const hasImages = imageDataUrls.length > 0
  if (!message && !hasImages) throw Object.assign(new Error('Ask a question or attach an image.'), { statusCode: 400 })
  if (!shouldUseLocalCoachFirst({ message, hasImages, hintLevel }) && !authenticatedStemUser(request, env)) {
    throw Object.assign(new Error('Sign in to STEM before using detailed AI Coach.'), { statusCode: 401 })
  }

  response.statusCode = 200
  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  response.setHeader('Cache-Control', 'no-cache, no-transform')
  response.setHeader('Connection', 'keep-alive')
  response.flushHeaders?.()

  const localAnswer = localCoachReply(context, hintLevel)
  if (shouldUseLocalCoachFirst({ message, hasImages, hintLevel })) {
    sendCoachEvent(response, 'meta', { mode: 'local', providerStatus: 'skipped', canEscalate: true })
    sendCoachEvent(response, 'delta', { text: localAnswer })
    sendCoachEvent(response, 'done', {
      mode: 'local',
      providerStatus: 'skipped',
      answer: localAnswer,
      canEscalate: true,
      warning: 'Local first hint. Ask for a detailed explanation to escalate to AI Coach.',
    })
    response.end()
    return
  }
  const configuredProvider = hasImages ? visionProvider : provider
  const activeProviders = providerCandidates(configuredProvider)
  if (!activeProviders.length) {
    sendCoachEvent(response, 'meta', { mode: 'offline', providerStatus: 'not_configured' })
    sendCoachEvent(response, 'delta', { text: localAnswer })
    sendCoachEvent(response, 'done', {
      mode: 'offline',
      providerStatus: 'not_configured',
      answer: localAnswer,
      warning: 'AI Coach provider is not configured on this server. This is an offline hint, not an AI review.',
      retryable: true,
    })
    response.end()
    return
  }

  const userText = coachRequestContext(context, message)
  const deadlineAt = Date.now() + timeoutConfig.requestDeadlineMs
  const requestId = crypto.randomUUID()
  let streamedAnswer = ''
  let lastPartialAnswer = ''
  let lastError = null
  let lastAttemptedProvider = activeProviders[0]
  const heartbeat = setInterval(() => {
    if (!response.writableEnded && !response.destroyed) response.write(': keep-alive\n\n')
  }, 15_000)
  try {
    for (const [providerIndex, activeProvider] of activeProviders.entries()) {
      lastAttemptedProvider = activeProvider
      let providerImages = []
      let attemptAnswer = ''
      try {
        providerImages = await temporaryProviderImages(imageDataUrls, imagePublicBase(activeProvider, request))
        const content = providerMessageContent(userText, providerImages)
        sendCoachEvent(response, 'meta', {
          mode: 'ai',
          provider: activeProvider.name,
          providerStatus: 'connecting',
          model: activeProvider.model,
        })
        const result = await callCompatibleAiStream(activeProvider, {
          messages: [{ role: 'system', content: buildCoachSystemPrompt({ verifiedSubmitted, hintLevel }) }, ...history, { role: 'user', content }],
          temperature: 0.2,
          operation: hasImages ? 'coach-vision-stream' : 'coach-stream',
          requestId,
          providerAttempt: providerIndex + 1,
          fallbackPath: activeProviders.slice(0, providerIndex + 1).map((candidate) => candidate.name).join('>'),
          fallback: providerIndex > 0,
          telemetry,
          timeoutMs: timeoutConfig.providerTimeoutMs,
          deadlineAt,
          onDelta: async (delta) => {
            attemptAnswer += delta
            sendCoachEvent(response, 'delta', { text: delta })
          },
        })
        streamedAnswer = result.answer || attemptAnswer
        const answer = streamedAnswer || localAnswer
        sendCoachEvent(response, 'done', {
          mode: 'ai',
          provider: activeProvider.name,
          providerStatus: 'connected',
          answer,
          model: activeProvider.model,
        })
        response.end()
        return
      } catch (error) {
        lastError = error
        if (attemptAnswer) {
          lastPartialAnswer = attemptAnswer
          if (providerIndex < activeProviders.length - 1) {
            sendCoachEvent(response, 'reset', { provider: activeProvider.name })
          }
        }
      } finally {
        providerImages.forEach((image) => image.cleanup())
      }
    }
    const failedProvider = lastAttemptedProvider
    const preservedAnswer = lastPartialAnswer || streamedAnswer || localAnswer
    const partial = Boolean(lastPartialAnswer)
    sendCoachEvent(response, 'done', {
      mode: partial ? 'interrupted' : 'offline',
      provider: failedProvider.name,
      providerStatus: 'error',
      answer: preservedAnswer,
      warning: providerMessage(lastError, failedProvider),
      retryable: true,
      ...(partial ? { partial: true } : {}),
    })
    response.end()
  } finally {
    clearInterval(heartbeat)
  }
}

async function handleHandwritingMark(request, response, provider, libraryRoot, allowedSubjects, sourceAssetRoot, env, questionBank, telemetry, timeoutConfig) {
  const payload = await readJsonBody(request)
  const identitySigningKey = env.STEM_IDENTITY_SIGNING_KEY || env.STEM_INTERNAL_AUTH_KEY
  const capability = verifyMarkingCapability({
    request,
    payload,
    identitySigningKey,
    capabilitySigningKey: env.STEM_MARKING_CAPABILITY_SIGNING_KEY || identitySigningKey,
  })
  if (!capability.ok) {
    return sendJson(response, capability.statusCode || 403, {
      code: capability.code,
      error: capability.message,
      reviewRequired: true,
    })
  }
  const canonical = canonicalHandwritingMarkingContext(payload, { questionBank })
  if (!canonical.ok) {
    return sendJson(response, 422, {
      code: canonical.code,
      error: 'This response is no longer backed by a current AI-markable source record. It remains saved for a later retry.',
      reviewRequired: true,
    })
  }
  const typedResponse = compactText(payload.typedResponse, 6000)
  const hasStudentImage = Boolean(String(payload.imageDataUrl || '').trim())
  if (!hasStudentImage && !typedResponse) {
    return sendJson(response, 400, {
      code: 'student_response_missing',
      error: 'Add a typed response or a handwriting image before requesting AI marking.',
      reviewRequired: true,
    })
  }
  if (hasStudentImage) imageBytes(payload.imageDataUrl)
  // The request budget includes trusted QP/MS image rendering. Without this,
  // a stalled local renderer can outlive the reverse proxy and become a 504.
  const deadlineAt = Date.now() + timeoutConfig.requestDeadlineMs
  let officialImages
  try {
    officialImages = await canonicalHandwritingMarkingImages(canonical, { assetRoot: sourceAssetRoot, libraryRoot, env, deadlineAt })
  } catch (error) {
    return sendJson(response, error.statusCode || 422, {
      code: error.code || 'source_asset_unavailable',
      error: 'The paired official source images are unavailable for this response. Your work remains saved for self-review.',
      reviewRequired: true,
    })
  }
  const { questionImages, markSchemeImages } = officialImages
  const requestedMaxMarks = Number(canonical.part.marks)
  const activeProviders = providerCandidates(provider)
  if (!activeProviders.length) return sendJson(response, 503, { code: 'vision_not_configured', error: 'AI vision marking is not configured on this local server.' })
  const context = {
    subject: canonical.subject,
    syllabus: compactText(canonical.question.specification || canonical.question.qualification, 200),
    questionNumber: canonical.questionNumber,
    question: { prompt: canonical.part.promptFragment, answerType: canonical.part.answerArea?.type || canonical.question.answerType },
    expectedMarkPoints: canonical.part.markSchemePoints || [],
    requestedMaxMarks,
    typedResponse,
    officialSourceImages: [
      ...questionImages.map((image) => ({ role: image.role, page: image.page, sha256: image.sha256 })),
      ...markSchemeImages.map((image) => ({ role: image.role, page: image.page, sha256: image.sha256 })),
    ],
  }
  const requestId = crypto.randomUUID()
  const system = [
    'You are an assisted examiner reviewing one handwritten response for the exact qualification and subject supplied in context.',
    'Read the student image directly. Use the exact mark-scheme extract when supplied; otherwise use only explicit stored expected mark points.',
    'When official question-paper and mark-scheme page images are supplied, treat those images as the authoritative source and do not fill missing content from memory.',
    'Award objective method and accuracy marks conservatively. Check units, signs, significant figures, algebraic equivalence and error-carried-forward only when supported.',
    'Do not award marks for handwriting you cannot read. Set reviewRequired true when the question, diagram, handwriting or mark scheme is incomplete or ambiguous.',
    'Return JSON only with: rawMarks, maxMarks, confidence (0-1), reviewRequired, summary, recognizedWork, correctedSolution, nextAction, markPoints[].',
    'Each markPoints item must contain id, awarded, marks, reason and studentEvidence.',
  ].join('\n')
  let lastError = null
  let lastAttemptedProvider = activeProviders[0]
  for (const [providerIndex, activeProvider] of activeProviders.entries()) {
    lastAttemptedProvider = activeProvider
    let studentImage = null
    let sourceImages = []
    try {
      const publicBase = imagePublicBase(activeProvider, request)
      const officialSourceImages = [...questionImages, ...markSchemeImages]
      ;[studentImage, ...sourceImages] = await Promise.all([
        hasStudentImage ? temporaryImageUrl(payload.imageDataUrl, publicBase) : null,
        ...officialSourceImages.map((image) => temporaryImageUrl(image.dataUrl, publicBase)),
      ])
      const questionProviderImages = sourceImages.slice(0, questionImages.length)
      const markSchemeProviderImages = sourceImages.slice(questionImages.length)
      const content = [
        { type: 'text', text: compactText(JSON.stringify({ ...context, imageOrder: { questionPaperPages: questionImages.length, markSchemePages: markSchemeImages.length, studentResponsePages: hasStudentImage ? 1 : 0 } }), 30000) },
        ...questionProviderImages.flatMap((image, index) => [
          { type: 'text', text: `Official question-paper page ${questionImages[index].page}; SHA-256 ${questionImages[index].sha256}.` },
          { type: 'image_url', image_url: { url: image.url } },
        ]),
        ...markSchemeProviderImages.flatMap((image, index) => [
          { type: 'text', text: `Official mark-scheme page ${markSchemeImages[index].page}; SHA-256 ${markSchemeImages[index].sha256}.` },
          { type: 'image_url', image_url: { url: image.url } },
        ]),
        { type: 'text', text: hasStudentImage ? 'Student handwritten response.' : 'Student typed response (no handwriting image attached).' },
        ...(studentImage ? [{ type: 'image_url', image_url: { url: studentImage.url } }] : []),
      ]
      // Providers accept the OpenAI-compatible image message, but some reject
      // response_format. The prompt still requires JSON and the parser validates it.
      const raw = await callCompatibleAi(activeProvider, {
        messages: [{ role: 'system', content: system }, { role: 'user', content }],
        temperature: 0.05,
        operation: 'handwriting-marking',
        requestId,
        providerAttempt: providerIndex + 1,
        fallbackPath: activeProviders.slice(0, providerIndex + 1).map((candidate) => candidate.name).join('>'),
        fallback: providerIndex > 0,
        telemetry,
        timeoutMs: timeoutConfig.providerTimeoutMs,
        deadlineAt,
        validateResponse: (answer) => validateMarkAssessment(parseStructuredJson(answer), requestedMaxMarks),
      })
      const assessment = validateMarkAssessment(parseStructuredJson(raw), requestedMaxMarks)
      const result = normalizeMarkResult(assessment, requestedMaxMarks)
      const autoFinal = canonical.autoFinal && result.reviewRequired === false && result.confidence >= 0.7
      return sendJson(response, 200, {
        mode: 'vision',
        provider: activeProvider.name,
        providerStatus: 'connected',
        model: activeProvider.model,
        autoFinal,
        humanReviewRequired: result.reviewRequired,
        score: result.rawMarks,
        maxScore: result.maxMarks,
        criteria: result.markPoints,
        evidence: result.markPoints.map((point) => point.studentEvidence),
        rationale: result.summary,
        ...result,
      })
    } catch (error) {
      lastError = error
    } finally {
      studentImage?.cleanup()
      sourceImages.forEach((image) => image.cleanup())
    }
  }
  if (lastError?.code === 'AI_RESPONSE_SCHEMA_INVALID' || /^AI assessment /.test(String(lastError?.message || ''))) {
    return sendJson(response, 422, {
      code: 'ai_assessment_schema_invalid',
      provider: lastAttemptedProvider.name,
      providerStatus: 'invalid_schema',
      error: 'The AI marking response could not be validated. Your answer remains saved for review or retry.',
      reviewRequired: true,
      retryable: true,
    })
  }
  console.error(`[${lastAttemptedProvider.name}-vision] ${providerMessage(lastError, lastAttemptedProvider)}`)
  return sendJson(response, 200, { mode: 'offline', code: 'vision_review_failed', provider: lastAttemptedProvider.name, providerStatus: 'error', error: providerMessage(lastError, lastAttemptedProvider), retryable: true })
}

export function createAiApi({ env = process.env, libraryRoot, allowedSubjects, sourceAssetRoot = DEFAULT_SOURCE_ASSET_ROOT, questionBankProvider = null, telemetry = null }) {
  const config = providerConfig(env)
  const timeoutConfig = aiTimeoutConfig(env)
  const currentAiMarkingQuestionBank = () => {
    if (typeof questionBankProvider !== 'function') return studyQuestionBank
    try {
      return mergeAiMarkingQuestionBanks(studyQuestionBank, questionBankProvider())
    } catch {
      return studyQuestionBank
    }
  }
  return async function aiApi(request, response, next) {
    const requestUrl = new URL(request.url, 'http://127.0.0.1')
    if (!requestUrl.pathname.startsWith('/api/ai/')) return next()
    try {
      if (request.method === 'GET' && requestUrl.pathname.startsWith('/api/ai/image/')) return handleTemporaryImage(requestUrl, response)
      if (request.method === 'GET' && requestUrl.pathname === '/api/ai/status') {
        const coachProvider = providerCandidates(config.coach)[0]
        const visionProvider = providerCandidates(config.vision)[0]
        return sendJson(response, 200, {
          provider: config.provider,
          coachEnabled: Boolean(coachProvider),
          visionEnabled: Boolean(visionProvider),
          coachProvider: coachProvider?.name || null,
          visionProvider: visionProvider?.name || null,
          coachModel: coachProvider?.model || null,
          visionModel: visionProvider?.model || null,
        })
      }
      if (request.method === 'POST' && requestUrl.pathname === '/api/ai/coach') return await handleCoach(request, response, config.coach, config.vision, libraryRoot, allowedSubjects, env, telemetry, timeoutConfig)
      if (request.method === 'POST' && requestUrl.pathname === '/api/ai/coach/stream') return await handleCoachStream(request, response, config.coach, config.vision, libraryRoot, allowedSubjects, env, telemetry, timeoutConfig)
      if (request.method === 'POST' && requestUrl.pathname === '/api/ai/mark-handwriting') return await handleHandwritingMark(request, response, config.vision, libraryRoot, allowedSubjects, sourceAssetRoot, env, currentAiMarkingQuestionBank(), telemetry, timeoutConfig)
      return sendJson(response, 404, { error: 'AI route not found.' })
    } catch (error) {
      return sendJson(response, error.statusCode || 500, { error: error.statusCode ? error.message : 'The AI request could not be completed.' })
    }
  }
}
