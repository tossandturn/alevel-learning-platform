import crypto from 'node:crypto'
import fs from 'node:fs'

import { createCurriculumPracticeReleaseLoader } from './curriculumPracticeRoutes.js'
import { createSqliteCurriculumPracticeStore } from './curriculumPracticeStore.js'

const API_ROOT = '/api/stem/curriculum-practice'

function codedError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code })
}

function asText(value, max = 180) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function safeId(value, label) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text || text.length > 180 || !/^[A-Za-z0-9._:-]+$/.test(text)) throw codedError(400, 'curriculum_practice_id_invalid', `${label} is invalid.`)
  return text
}

function submissionId(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(text)) throw codedError(400, 'curriculum_practice_submission_id_invalid', 'submissionId is invalid.')
  return text
}

function pathId(value, label) {
  let decoded
  try { decoded = decodeURIComponent(value) } catch { throw codedError(400, 'curriculum_practice_path_invalid', 'The request path is invalid.') }
  if ([...decoded].some((character) => character === '/' || character === '\\' || character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    throw codedError(400, 'curriculum_practice_path_invalid', 'The request path is invalid.')
  }
  return safeId(decoded, label)
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function sessionQuestionSetHash({ releaseHash, userId, routeId, topicId, questionIds }) {
  return sha256(Buffer.from(canonicalJson({ releaseHash, userId, routeId, topicId, questionIds }), 'utf8'))
}

function sendJson(response, statusCode, body) {
  const bytes = Buffer.from(JSON.stringify(body), 'utf8')
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Content-Length', String(bytes.length))
  response.setHeader('Cache-Control', 'no-store')
  response.end(bytes)
}

async function readJsonBody(request, maxBytes = 1024 * 1024) {
  const chunks = []
  let total = 0
  for await (const chunk of request) {
    total += chunk.length
    if (total > maxBytes) throw codedError(413, 'curriculum_practice_payload_too_large', 'The request payload is too large.')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw codedError(400, 'curriculum_practice_json_invalid', 'The request body must be valid JSON.')
  }
}

function publicSession(session) {
  return {
    id: session.sessionId,
    routeId: session.routeId,
    topicId: session.topicId,
    status: session.status,
    questionIds: session.questionIds,
    questionCount: session.questionIds.length,
    ...(session.status === 'submitted' ? {
      answers: session.answers,
      result: { score: session.score, maxScore: session.maxScore, items: session.results },
      submittedAt: session.submittedAt,
    } : {}),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }
}

function publicQuestion(question, release) {
  return {
    id: question.id,
    paperId: question.paperId,
    questionNumber: question.questionNumber,
    routeId: question.routeId,
    topicIds: question.topicIds,
    answerMode: question.answerMode,
    options: question.options,
    source: {
      questionPdfSha256: question.source.questionPdfSha256,
      pages: question.source.pages,
      regions: question.source.assetIds.map((assetId) => {
        const metadata = release.assetById.get(assetId)
        const asset = release.resolveSourceAsset(question.id, assetId)
        if (!metadata || !asset) throw codedError(503, 'curriculum_practice_source_unavailable', 'A released source image is unavailable.')
        return {
          assetId,
          url: `${API_ROOT}/source/${encodeURIComponent(question.id)}/${encodeURIComponent(assetId)}`,
          sha256: asset.sha256,
          bytes: asset.bytes,
          width: asset.width,
          height: asset.height,
          page: metadata.page,
          region: metadata.sourceRegion,
        }
      }),
    },
    quality: question.quality,
  }
}

function normalizeSelectedOptions(value, question, { allowEmpty = false } = {}) {
  if (!Array.isArray(value)) throw codedError(422, 'curriculum_practice_answer_invalid', 'selectedOptions must be an array.')
  const selected = [...new Set(value.map((item) => String(item).trim()))].sort()
  if (selected.length !== value.length || selected.some((option) => !question.options.includes(option))) throw codedError(422, 'curriculum_practice_answer_invalid', 'The selected option set is invalid.')
  if (allowEmpty && selected.length === 0) return selected
  if (question.answerMode === 'single' && selected.length !== 1) throw codedError(422, 'curriculum_practice_answer_invalid', 'This question requires one option.')
  if (question.answerMode === 'multiple' && selected.length < 1) throw codedError(422, 'curriculum_practice_answer_invalid', 'This question requires at least one option.')
  return selected
}

async function requiredUser(authenticateRequest, request) {
  if (typeof authenticateRequest !== 'function') throw codedError(503, 'curriculum_practice_auth_unavailable', 'Authentication is unavailable.')
  const user = await authenticateRequest(request)
  const id = asText(user?.id, 160)
  if (!id) throw codedError(401, 'authentication_required', 'Sign in to continue.')
  return { ...user, id }
}

export function createCurriculumPracticeApi({
  releaseRoot,
  sourceAssetRoot,
  releaseProvider = null,
  authenticateRequest,
  databaseProvider = null,
  store = null,
  now = () => new Date().toISOString(),
  randomUUID = () => crypto.randomUUID(),
  sourceRequiresAuthentication = false,
} = {}) {
  const loadRelease = typeof releaseProvider === 'function'
    ? releaseProvider
    : createCurriculumPracticeReleaseLoader({ releaseRoot, sourceAssetRoot })
  let sessionStore = store
  function activeStore() {
    if (sessionStore) return sessionStore
    if (typeof databaseProvider !== 'function') throw codedError(503, 'curriculum_practice_storage_unavailable', 'Practice storage is unavailable.')
    sessionStore = createSqliteCurriculumPracticeStore({ databaseProvider })
    return sessionStore
  }

  async function handle(request, response, url = new URL(request.url, 'http://127.0.0.1')) {
    if (!url.pathname.startsWith(API_ROOT)) return false
    try {
      const release = loadRelease()
      if (request.method === 'GET' && url.pathname === `${API_ROOT}/catalog`) {
        const routeId = asText(url.searchParams.get('routeId'))
        const topicId = asText(url.searchParams.get('topicId'))
        const routes = release.publicCatalog.routes
          .filter((route) => !routeId || route.id === routeId)
          .map((route) => ({
            id: route.id,
            board: route.board,
            course: route.course,
            label: route.label,
            authority: route.authority,
            formalProgressEligible: false,
            questionCount: topicId
              ? release.publicCatalog.questions.filter((question) => question.routeId === route.id && question.topicIds.includes(topicId)).length
              : route.questionCount,
            topics: route.topics.filter((topic) => !topicId || topic.id === topicId),
          }))
        sendJson(response, 200, { schemaVersion: 'curriculum-practice-catalog.v1', releaseId: release.release.releaseId, routes })
        return true
      }

      const questionMatch = url.pathname.match(new RegExp(`^${API_ROOT}/questions/([^/]+)$`))
      if (request.method === 'GET' && questionMatch) {
        const question = release.questionById.get(pathId(questionMatch[1], 'questionId'))
        if (!question) throw codedError(404, 'curriculum_practice_question_not_found', 'Question not found.')
        sendJson(response, 200, { question: publicQuestion(question, release) })
        return true
      }

      const sourceMatch = url.pathname.match(new RegExp(`^${API_ROOT}/source/([^/]+)/([^/]+)$`))
      if ((request.method === 'GET' || request.method === 'HEAD') && sourceMatch) {
        if (sourceRequiresAuthentication) await requiredUser(authenticateRequest, request)
        const asset = release.resolveSourceAsset(pathId(sourceMatch[1], 'questionId'), pathId(sourceMatch[2], 'assetId'))
        if (!asset) throw codedError(404, 'curriculum_practice_source_not_found', 'Source image not found.')
        response.statusCode = 200
        response.setHeader('Content-Type', asset.contentType)
        response.setHeader('Content-Length', String(asset.bytes))
        response.setHeader('ETag', `"${asset.sha256}"`)
        response.setHeader('Cache-Control', 'public, max-age=0, must-revalidate')
        response.setHeader('X-Content-Type-Options', 'nosniff')
        if (request.method === 'HEAD') response.end()
        else fs.createReadStream(asset.filePath).pipe(response)
        return true
      }

      if (request.method === 'POST' && url.pathname === `${API_ROOT}/sessions`) {
        const user = await requiredUser(authenticateRequest, request)
        const payload = await readJsonBody(request)
        const routeId = safeId(payload.routeId, 'routeId')
        const topicId = payload.topicId ? safeId(payload.topicId, 'topicId') : null
        const route = release.publicCatalog.routes.find((candidate) => candidate.id === routeId)
        if (!route) throw codedError(400, 'curriculum_practice_route_invalid', 'The practice route is invalid.')
        let questions = release.publicCatalog.questions.filter((question) => question.routeId === routeId && (!topicId || question.topicIds.includes(topicId)))
        if (Array.isArray(payload.questionIds)) {
          const requestedIds = [...new Set(payload.questionIds.map((id) => safeId(id, 'questionId')))]
          if (!requestedIds.length || requestedIds.length > 50) throw codedError(422, 'curriculum_practice_question_set_invalid', 'Choose between 1 and 50 questions.')
          const byId = new Map(questions.map((question) => [question.id, question]))
          questions = requestedIds.map((id) => byId.get(id))
          if (questions.some((question) => !question)) throw codedError(409, 'curriculum_practice_question_binding_mismatch', 'The selected question does not belong to this route/topic.')
        } else {
          const count = payload.count === undefined || payload.count === null ? 10 : payload.count
          if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 50) throw codedError(422, 'curriculum_practice_question_set_invalid', 'count must be an integer between 1 and 50.')
          questions = questions.slice(0, count)
        }
        if (!questions.length) throw codedError(404, 'curriculum_practice_questions_unavailable', 'No released questions are available for this scope.')
        const questionIds = questions.map((question) => question.id)
        const createdAt = now()
        const session = activeStore().create({
          userId: user.id,
          sessionId: `cps_${randomUUID()}`,
          routeId,
          topicId,
          releaseHash: release.release.releaseHash,
          questionSetHash: sessionQuestionSetHash({ releaseHash: release.release.releaseHash, userId: user.id, routeId, topicId, questionIds }),
          questionIds,
          createdAt,
        })
        sendJson(response, 201, { session: publicSession(session) })
        return true
      }

      if (request.method === 'GET' && url.pathname === `${API_ROOT}/history`) {
        const user = await requiredUser(authenticateRequest, request)
        sendJson(response, 200, { sessions: activeStore().list(user.id, { limit: 50 }).map(publicSession) })
        return true
      }

      const sessionMatch = url.pathname.match(new RegExp(`^${API_ROOT}/sessions/([^/]+)$`))
      if (request.method === 'GET' && sessionMatch) {
        const user = await requiredUser(authenticateRequest, request)
        const session = activeStore().get(user.id, pathId(sessionMatch[1], 'sessionId'))
        if (!session) throw codedError(404, 'curriculum_practice_session_not_found', 'Session not found.')
        sendJson(response, 200, { session: publicSession(session) })
        return true
      }

      const submitMatch = url.pathname.match(new RegExp(`^${API_ROOT}/sessions/([^/]+)/submit$`))
      if (request.method === 'POST' && submitMatch) {
        const user = await requiredUser(authenticateRequest, request)
        const session = activeStore().get(user.id, pathId(submitMatch[1], 'sessionId'))
        if (!session) throw codedError(404, 'curriculum_practice_session_not_found', 'Session not found.')
        if (session.releaseHash !== release.release.releaseHash) throw codedError(409, 'curriculum_practice_release_mismatch', 'This session belongs to a different content release.')
        const expectedQuestionSetHash = sessionQuestionSetHash({ releaseHash: session.releaseHash, userId: user.id, routeId: session.routeId, topicId: session.topicId, questionIds: session.questionIds })
        if (session.questionSetHash !== expectedQuestionSetHash || session.questionIds.some((questionId) => release.questionById.get(questionId)?.routeId !== session.routeId)) {
          throw codedError(409, 'curriculum_practice_session_binding_mismatch', 'The persisted session binding is invalid.')
        }
        const payload = await readJsonBody(request)
        const idempotencyKey = submissionId(payload.submissionId)
        if (!Array.isArray(payload.answers)) throw codedError(422, 'curriculum_practice_answers_invalid', 'answers must be an array.')
        const answerByQuestion = new Map()
        for (const value of payload.answers) {
          const questionId = safeId(value?.questionId, 'questionId')
          if (answerByQuestion.has(questionId)) throw codedError(422, 'curriculum_practice_answers_invalid', 'Each question may be answered once.')
          const question = release.questionById.get(questionId)
          if (!question || !session.questionIds.includes(questionId)) throw codedError(409, 'curriculum_practice_question_binding_mismatch', 'The answer does not belong to this session.')
          const unanswered = value?.unanswered === true
          const selectedOptions = normalizeSelectedOptions(value?.selectedOptions || [], question, { allowEmpty: unanswered })
          if (unanswered && selectedOptions.length) throw codedError(422, 'curriculum_practice_answer_invalid', 'An unanswered item cannot include selected options.')
          answerByQuestion.set(questionId, { questionId, selectedOptions, unanswered })
        }
        const missingQuestionIds = session.questionIds.filter((questionId) => !answerByQuestion.has(questionId))
        const hasExplicitUnanswered = [...answerByQuestion.values()].some((answer) => answer.unanswered)
        if ((missingQuestionIds.length || hasExplicitUnanswered) && payload.confirmUnanswered !== true) throw codedError(422, 'curriculum_practice_answers_incomplete', 'Confirm unanswered questions before submitting an incomplete session.')
        for (const questionId of missingQuestionIds) answerByQuestion.set(questionId, { questionId, selectedOptions: [], unanswered: true })
        const answers = session.questionIds.map((questionId) => answerByQuestion.get(questionId))
        const results = answers.map((answer) => {
          const official = release.answerById.get(answer.questionId)
          const correct = !answer.unanswered && canonicalJson(answer.selectedOptions) === canonicalJson(official.correctOptions)
          return { questionId: answer.questionId, correct, unanswered: answer.unanswered }
        })
        const score = results.filter((result) => result.correct).length
        const submittedAt = now()
        const submissionHash = sha256(Buffer.from(canonicalJson({ sessionId: session.sessionId, questionSetHash: session.questionSetHash, answers }), 'utf8'))
        const stored = activeStore().submit(user.id, session.sessionId, { submissionId: idempotencyKey, submissionHash, answers, results, score, maxScore: session.questionIds.length, submittedAt })
        if (!stored) throw codedError(404, 'curriculum_practice_session_not_found', 'Session not found.')
        sendJson(response, 200, { session: publicSession(stored.session), duplicate: stored.duplicate })
        return true
      }

      throw codedError(404, 'curriculum_practice_endpoint_not_found', 'Endpoint not found.')
    } catch (error) {
      const candidateStatus = Number(error?.statusCode)
      const statusCode = Number.isInteger(candidateStatus) && candidateStatus >= 400 && candidateStatus <= 599 ? candidateStatus : 500
      sendJson(response, statusCode, { error: { code: String(error?.code || 'curriculum_practice_failed'), message: statusCode >= 500 ? 'AP/IB practice is temporarily unavailable.' : String(error?.message || 'Request failed.') } })
      return true
    }
  }

  return Object.freeze({ handle, loadRelease })
}
