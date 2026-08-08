import fs from 'node:fs'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

const IMAGE_PATTERN = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/
const MAX_BODY_BYTES = 16 * 1024 * 1024
const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const TEMP_IMAGE_TTL_MS = 5 * 60 * 1000
const pdfTextCache = new Map()
const CIE_SUBJECTS = new Set(['0580', '0606', '0625', '9231', '9701', '9702', '9708', '9709'])
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

function decodeBase64Url(value) {
  return JSON.parse(Buffer.from(String(value || ''), 'base64url').toString('utf8'))
}

function validHmacJwt(token, key, { issuer, audience, maxLifetimeSeconds = 900 } = {}) {
  if (!token || !key) return null
  const parts = String(token).split('.')
  if (parts.length !== 3) return null
  const [encodedHeader, encodedPayload, signature] = parts
  const expected = crypto.createHmac('sha256', key).update(`${encodedHeader}.${encodedPayload}`).digest('base64url')
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null
  try {
    const header = decodeBase64Url(encodedHeader)
    const claims = decodeBase64Url(encodedPayload)
    const now = Math.floor(Date.now() / 1000)
    if (header.alg !== 'HS256' || (issuer && claims.iss !== issuer) || (audience && claims.aud !== audience) || !claims.sub || !Number.isFinite(Number(claims.exp)) || Number(claims.exp) <= now || (Number(claims.iat) && Number(claims.exp) - Number(claims.iat) > maxLifetimeSeconds)) return null
    return claims
  } catch {
    return null
  }
}

function authenticatedStemUser(request, env) {
  const token = String(request.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1]
  const claims = validHmacJwt(token, env.STEM_IDENTITY_SIGNING_KEY, { issuer: 'ieltsist.com', audience: 'stem.ieltsist.com', maxLifetimeSeconds: 60 * 60 })
  return claims && /^ielts:\d+$/.test(String(claims.sub)) ? String(claims.sub) : null
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
  return {
    subject: typeof source.subject === 'object' ? { code: compactText(source.subject.code, 20), name: compactText(source.subject.name, 100) } : compactText(source.subject, 80),
    syllabus: compactText(source.syllabus, 200), stage: compactText(source.stage, 30), topic: compactText(source.topic, 200), attemptId: compactText(source.attemptId, 100),
    question: { id: compactText(question.id || question.questionId, 160), number: Number(question.number) || null, title: compactText(question.title, 300), prompt: compactText(question.prompt, 4000), hint: compactText(question.hint, 1000) },
    paper: { id: compactText(paper.id || paper.paperId, 160), questionFile: compactText(paper.questionFile, 180), markSchemeFile: compactText(paper.markSchemeFile, 180) },
    agentIntent: source.agentIntent && typeof source.agentIntent === 'object' ? { type: compactText(source.agentIntent.type, 80) } : null,
  }
}

function imageBytes(dataUrl) {
  const match = String(dataUrl || '').match(IMAGE_PATTERN)
  if (!match) throw Object.assign(new Error('Handwriting image must be PNG, JPEG or WebP.'), { statusCode: 400 })
  const bytes = Buffer.byteLength(match[2], 'base64')
  if (!bytes || bytes > MAX_IMAGE_BYTES) throw Object.assign(new Error('Handwriting image is empty or too large.'), { statusCode: 400 })
  return bytes
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
  if (pdfTextCache.has(cacheKey)) return pdfTextCache.get(cacheKey)
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
  pdfTextCache.clear()
  pdfTextCache.set(cacheKey, text)
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

export function providerConfig(env = {}) {
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
  return {
    provider: 'qwen',
    coach: {
      apiKey: env.COACH_AI_API_KEY || env.QWEN_COACH_API_KEY || sharedKey,
      baseUrl: normalizeCompatibleBaseUrl(env.COACH_AI_BASE_URL || env.QWEN_COACH_BASE_URL || sharedBaseUrl),
      model: env.COACH_AI_MODEL || env.QWEN_COACH_MODEL || env.PHYSICS_COACH_MODEL || 'qwen3.7-max',
      publicBaseUrl,
      imageMode,
    },
    vision: {
      apiKey: env.VISION_AI_API_KEY || env.QWEN_VISION_API_KEY || sharedKey,
      baseUrl: normalizeCompatibleBaseUrl(env.VISION_AI_BASE_URL || env.QWEN_VISION_BASE_URL || sharedBaseUrl),
      model: env.VISION_AI_MODEL || env.QWEN_VISION_MODEL || env.PHYSICS_VISION_MODEL || 'qwen3-vl-plus',
      publicBaseUrl,
      imageMode,
    },
  }
}

function normalizeCompatibleBaseUrl(value) {
  const source = String(value || '').trim().replace(/[\r\n]+/g, '').replace(/\/+$/, '')
  if (!source) return ''
  if (/\/chat\/completions$/i.test(source)) return source.replace(/\/chat\/completions$/i, '')
  return source
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

function providerMessage(error) {
  const message = String(error?.message || error || '')
  if (/timeout|timed out|abort/i.test(message)) return 'Qwen request timed out. Check the server network and retry.'
  if (/fetch failed|econn|enotfound|network/i.test(message)) return 'Qwen network request failed. Check the server network and retry.'
  const status = message.match(/AI provider returned (\d{3})/)?.[1]
  if (status === '401' || status === '403') return 'Qwen authentication or model access failed. Check the server key and model permission.'
  if (status === '404') return 'Qwen model or endpoint was not found. Check the Base URL and model ID.'
  if (status) return `Qwen upstream returned HTTP ${status}. Retry or check the provider configuration.`
  return 'Qwen review is temporarily unavailable. Your answer remains saved.'
}

async function callCompatibleAi(provider, { messages, temperature = 0.2, json = false }) {
  if (!provider.apiKey) return null
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60000)
  try {
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: provider.model, messages, temperature, stream: false, ...(json ? { response_format: { type: 'json_object' } } : {}) }),
      signal: controller.signal,
    })
    if (!response.ok) {
      const providerPayload = await response.json().catch(() => ({}))
      const providerCode = compactText(providerPayload?.error?.code || providerPayload?.code, 80)
      const providerDetail = compactText(providerPayload?.error?.message || providerPayload?.message, 140)
      throw new Error(`AI provider returned ${response.status}${providerCode ? ` (${providerCode})` : ''}${providerDetail ? `: ${providerDetail}` : ''}`)
    }
    const payload = await response.json()
    return String(payload?.choices?.[0]?.message?.content || '').trim()
  } finally {
    clearTimeout(timeout)
  }
}

export function parseStructuredJson(value) {
  const source = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('AI response did not contain structured JSON.')
  return JSON.parse(source.slice(start, end + 1))
}

export function normalizeMarkResult(value, requestedMaxMarks) {
  const maxMarks = Math.max(1, Math.round(Number(value.maxMarks) || Number(requestedMaxMarks) || 1))
  const rawMarks = Math.min(maxMarks, Math.max(0, Math.round(Number(value.rawMarks) || 0)))
  const markPoints = Array.isArray(value.markPoints) ? value.markPoints.slice(0, maxMarks + 4).map((point, index) => ({
    id: String(point.id || `M${index + 1}`).slice(0, 30),
    awarded: Boolean(point.awarded),
    marks: Math.min(maxMarks, Math.max(0, Number(point.marks) || (point.awarded ? 1 : 0))),
    reason: compactText(point.reason, 500),
    studentEvidence: compactText(point.studentEvidence, 500),
  })) : []
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
  const questionText = questionExcerpt(await extractPdfText(questionReference), questionNumber)
  return { ...context, sourceQuestionExtract: questionText }
}

async function handleCoach(request, response, provider, visionProvider, libraryRoot, allowedSubjects, env) {
  const payload = await readJsonBody(request)
  const message = compactText(payload.message, 3000)
  const history = Array.isArray(payload.history) ? payload.history.slice(-10).map((item) => ({ role: item.role === 'assistant' ? 'assistant' : 'user', content: compactText(item.content, 3000) })) : []
  // Client context is useful for tutoring, but cannot authorize answer release.
  // In particular, `context.submitted` is deliberately discarded here.
  const suppliedContext = safeCoachContext(payload.context)
  const context = await hydrateCoachPaperContext(suppliedContext, libraryRoot, allowedSubjects)
  const verifiedSubmitted = verifiedCoachSubmission(payload, request, env)
  const hintLevel = Math.min(5, Math.max(1, Number(payload.hintLevel) || 1))
  const imageDataUrl = payload.imageDataUrl || ''
  if (imageDataUrl) imageBytes(imageDataUrl)
  if (!message && !imageDataUrl) throw Object.assign(new Error('Ask a question or attach an image.'), { statusCode: 400 })
  const localAnswer = localCoachReply(context, hintLevel)
  const activeProvider = imageDataUrl && visionProvider?.apiKey ? visionProvider : provider
  if (!activeProvider.apiKey) return sendJson(response, 200, { mode: 'offline', providerStatus: 'not_configured', answer: localAnswer, warning: 'Qwen AI Coach is not configured on this server. This is an offline hint, not an AI review.' })
  const userText = [
    `Structured learning context:\n${compactText(JSON.stringify(context), 12000)}`,
    `Student request:\n${message || 'Explain the attached handwriting or diagram.'}`,
  ].join('\n\n')
  const providerImage = imageDataUrl ? await temporaryImageUrl(imageDataUrl, imagePublicBase(activeProvider, request)) : null
  const content = providerImage ? [{ type: 'text', text: userText }, { type: 'image_url', image_url: { url: providerImage.url } }] : userText
  try {
    const answer = await callCompatibleAi(activeProvider, {
      messages: [{ role: 'system', content: buildCoachSystemPrompt({ verifiedSubmitted, hintLevel }) }, ...history, { role: 'user', content }],
      temperature: 0.2,
    })
    return sendJson(response, 200, { mode: 'ai', provider: 'qwen', providerStatus: 'connected', answer: answer || localAnswer, model: activeProvider.model })
  } catch (error) {
    return sendJson(response, 200, { mode: 'offline', provider: 'qwen', providerStatus: 'error', answer: localAnswer, warning: providerMessage(error), retryable: true })
  } finally {
    providerImage?.cleanup()
  }
}

async function paperContext(payload, libraryRoot, allowedSubjects) {
  if (!payload.paper?.questionFile || !payload.paper?.markSchemeFile) return { questionText: '', markSchemeText: '' }
  const subject = String(payload.paper.subject || '')
  const questionReference = resolvePdfReference(libraryRoot, allowedSubjects, subject, String(payload.paper.questionFile || ''))
  const markSchemeReference = resolvePdfReference(libraryRoot, allowedSubjects, subject, String(payload.paper.markSchemeFile || ''))
  const [questionText, markSchemeText] = await Promise.all([extractPdfText(questionReference), extractPdfText(markSchemeReference)])
  return {
    questionText: questionExcerpt(questionText, payload.questionNumber),
    markSchemeText: questionExcerpt(markSchemeText, payload.questionNumber),
  }
}

async function handleHandwritingMark(request, response, provider, libraryRoot, allowedSubjects) {
  const payload = await readJsonBody(request)
  imageBytes(payload.imageDataUrl)
  const questionImages = Array.isArray(payload.questionImageDataUrls) ? payload.questionImageDataUrls.slice(0, 2) : []
  const markSchemeImages = Array.isArray(payload.markSchemeImageDataUrls) ? payload.markSchemeImageDataUrls.slice(0, 2) : []
  for (const image of [...questionImages, ...markSchemeImages]) imageBytes(image)
  const requestedMaxMarks = Number(payload.maxMarks)
  if (!Number.isFinite(requestedMaxMarks) || requestedMaxMarks <= 0) {
    return sendJson(response, 200, {
      mode: 'vision',
      status: 'review-only',
      marksAvailable: false,
      reviewRequired: true,
      confidence: 0,
      rawMarks: null,
      maxMarks: null,
      summary: 'The official question-level mark allocation is not available for this PDF item.',
      nextAction: 'Review the handwriting against the paired mark scheme and enter self-marked marks manually.',
      markPoints: [],
    })
  }
  if (!provider.apiKey) return sendJson(response, 503, { code: 'vision_not_configured', error: 'Qwen vision marking is not configured on this local server.' })
  let source
  try {
    source = await paperContext(payload, libraryRoot, allowedSubjects)
  } catch (error) {
    if (error.statusCode) throw error
    return sendJson(response, 200, { mode: 'offline', code: 'vision_context_failed', provider: 'qwen', providerStatus: 'error', error: providerMessage(error), retryable: true })
  }
  const context = {
    subject: compactText(payload.subject, 80),
    syllabus: compactText(payload.syllabus, 200),
    questionNumber: Number(payload.questionNumber) || null,
    question: payload.question || null,
    expectedMarkPoints: payload.expectedMarkPoints || [],
    requestedMaxMarks: Number(payload.maxMarks) || null,
    typedResponse: compactText(payload.typedResponse, 6000),
    questionPaperExtract: source.questionText,
    exactMarkSchemeExtract: source.markSchemeText,
  }
  const system = [
    'You are an assisted examiner reviewing one handwritten response for the exact qualification and subject supplied in context.',
    'Read the student image directly. Use the exact mark-scheme extract when supplied; otherwise use only explicit stored expected mark points.',
    'When official question-paper and mark-scheme page images are supplied, treat those images as the authoritative source and do not fill missing content from memory.',
    'Award objective method and accuracy marks conservatively. Check units, signs, significant figures, algebraic equivalence and error-carried-forward only when supported.',
    'Do not award marks for handwriting you cannot read. Set reviewRequired true when the question, diagram, handwriting or mark scheme is incomplete or ambiguous.',
    'Return JSON only with: rawMarks, maxMarks, confidence (0-1), reviewRequired, summary, recognizedWork, correctedSolution, nextAction, markPoints[].',
    'Each markPoints item must contain id, awarded, marks, reason and studentEvidence.',
  ].join('\n')
  try {
    const publicBase = imagePublicBase(provider, request)
    const [providerImage, ...sourceImages] = await Promise.all([
      temporaryImageUrl(payload.imageDataUrl, publicBase),
      ...questionImages.map((image) => temporaryImageUrl(image, publicBase)),
      ...markSchemeImages.map((image) => temporaryImageUrl(image, publicBase)),
    ])
    const content = [
      { type: 'text', text: compactText(JSON.stringify({ ...context, imageOrder: { questionPaperPages: questionImages.length, markSchemePages: markSchemeImages.length, studentResponsePages: 1 } }), 30000) },
      ...sourceImages.map((image) => ({ type: 'image_url', image_url: { url: image.url } })),
      { type: 'image_url', image_url: { url: providerImage.url } },
    ]
    // Qwen-VL accepts the OpenAI-compatible image message, but some DashScope
    // deployments reject response_format. The prompt still requires JSON and
    // parseStructuredJson validates the returned structure server-side.
    try {
      const raw = await callCompatibleAi(provider, { messages: [{ role: 'system', content: system }, { role: 'user', content }], temperature: 0.05 })
      const result = normalizeMarkResult(parseStructuredJson(raw), payload.maxMarks)
      return sendJson(response, 200, { mode: 'vision', provider: 'qwen', providerStatus: 'connected', model: provider.model, ...result })
    } finally {
      providerImage.cleanup()
      sourceImages.forEach((image) => image.cleanup())
    }
  } catch (error) {
    console.error(`[qwen-vision] ${String(error?.message || error).slice(0, 180)}`)
    return sendJson(response, 200, { mode: 'offline', code: 'vision_review_failed', provider: 'qwen', providerStatus: 'error', error: providerMessage(error), retryable: true })
  }
}

export function createAiApi({ env = process.env, libraryRoot, allowedSubjects }) {
  const config = providerConfig(env)
  return async function aiApi(request, response, next) {
    const requestUrl = new URL(request.url, 'http://127.0.0.1')
    if (!requestUrl.pathname.startsWith('/api/ai/')) return next()
    try {
      if (request.method === 'GET' && requestUrl.pathname.startsWith('/api/ai/image/')) return handleTemporaryImage(requestUrl, response)
      if (request.method === 'GET' && requestUrl.pathname === '/api/ai/status') {
        return sendJson(response, 200, {
          provider: config.provider,
          coachEnabled: Boolean(config.coach.apiKey),
          visionEnabled: Boolean(config.vision.apiKey),
          coachModel: config.coach.apiKey ? config.coach.model : null,
          visionModel: config.vision.apiKey ? config.vision.model : null,
        })
      }
      if (request.method === 'POST' && requestUrl.pathname === '/api/ai/coach') return await handleCoach(request, response, config.coach, config.vision, libraryRoot, allowedSubjects, env)
      if (request.method === 'POST' && requestUrl.pathname === '/api/ai/mark-handwriting') return await handleHandwritingMark(request, response, config.vision, libraryRoot, allowedSubjects)
      return sendJson(response, 404, { error: 'AI route not found.' })
    } catch (error) {
      return sendJson(response, error.statusCode || 500, { error: error.statusCode ? error.message : 'The AI request could not be completed.' })
    }
  }
}
