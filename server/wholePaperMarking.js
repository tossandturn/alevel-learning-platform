import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {
  WHOLE_PAPER_LIMITS,
  inspectWholePaperAsset,
  orderedImagesToPdf,
  renderPdfToPageImages,
  safeArtifactFileName,
  sha256,
} from './wholePaperArtifacts.js'
import { createWholePaperAiRunner, normalizeWholePaperAiResult, WHOLE_PAPER_AI_MAX_IMAGES } from './wholePaperAi.js'
import { renderWholePaperReport } from './wholePaperReport.js'

export const WHOLE_PAPER_JOB_SCHEMA_VERSION = 'stem-paper-marking-job-v1'
const RESULT_SCHEMA_VERSION = 'stem-paper-marking-result-v1'
const JOB_STATUSES = new Set(['draft', 'queued', 'processing', 'completed', 'failed'])
const FILE_ROLES = new Set(['answer', 'question-paper', 'mark-scheme'])
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const PDF_TYPE = 'application/pdf'
const MAX_JSON_BYTES = 128 * 1024
const DEFAULT_JOB_TIMEOUT_MS = 5 * 60 * 1000
const DEFAULT_DRAFT_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_RESULT_TTL_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_USER_STORAGE_BYTES = 160 * 1024 * 1024
const DEFAULT_ACTIVE_JOBS = 3

function serviceError(code, message, statusCode = 400, retryable = false) {
  return Object.assign(new Error(message), { code, statusCode, retryable })
}

function nowIso(now) {
  return new Date(now()).toISOString()
}

function text(value, maximum) {
  return String(value || '').replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum)
}

function exactMediaType(value) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase()
}

function numericOption(value, fallback, minimum, maximum) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.floor(number))) : fallback
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function requestHash(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function withinRoot(filePath, root) {
  const relative = path.relative(path.resolve(root), path.resolve(filePath))
  return Boolean(relative) && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)
}

function parseJson(value, fallback = null) {
  try { return JSON.parse(String(value || '')) }
  catch { return fallback }
}

function readJson(request, maximum = MAX_JSON_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let bytes = 0
    let rejected = false
    request.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes > maximum) {
        rejected = true
        reject(serviceError('request_too_large', 'The request is too large.', 413))
        return
      }
      if (!rejected) chunks.push(chunk)
    })
    request.on('end', () => {
      if (rejected) return
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) }
      catch { reject(serviceError('request_json_invalid', 'Request body must be valid JSON.')) }
    })
    request.on('error', reject)
  })
}

function readRaw(request, maximum) {
  return new Promise((resolve, reject) => {
    const declaredLength = Number(request.headers['content-length'])
    if (Number.isFinite(declaredLength) && declaredLength > maximum) {
      reject(serviceError('asset_size_limit', 'The uploaded file exceeds its size limit.', 413))
      request.resume?.()
      return
    }
    const chunks = []
    let bytes = 0
    let rejected = false
    request.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes > maximum) {
        rejected = true
        reject(serviceError('asset_size_limit', 'The uploaded file exceeds its size limit.', 413))
        return
      }
      if (!rejected) chunks.push(chunk)
    })
    request.on('end', () => { if (!rejected) resolve(Buffer.concat(chunks)) })
    request.on('error', reject)
  })
}

function sendJson(response, statusCode, value) {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'private, no-store')
  response.end(JSON.stringify(value))
}

function normalizeFileSpec(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw serviceError('file_spec_invalid', 'Each file declaration must be an object.')
  const allowed = new Set(['clientAssetId', 'role', 'mediaType', 'order', 'fileName', 'size'])
  if (Object.keys(value).some((key) => !allowed.has(key))) throw serviceError('file_spec_invalid', 'A file declaration contains unsupported fields.')
  const clientAssetId = text(value.clientAssetId, 80)
  const role = text(value.role, 40).toLowerCase()
  const mediaType = exactMediaType(value.mediaType)
  const order = Number(value.order)
  const size = Number(value.size)
  const fileName = safeArtifactFileName(value.fileName, role === 'answer' ? 'answer' : `${role}.pdf`)
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(clientAssetId)) throw serviceError('client_asset_id_invalid', 'Each file needs a stable clientAssetId.')
  if (!FILE_ROLES.has(role)) throw serviceError('file_role_invalid', 'File role must be answer, question-paper or mark-scheme.')
  if (!Number.isInteger(order) || order < 1 || order > 100) throw serviceError('file_order_invalid', 'Each file needs a positive integer order.')
  if (!Number.isInteger(size) || size < 1) throw serviceError('file_size_invalid', 'Each file needs its exact byte size.')
  if (mediaType === PDF_TYPE) {
    if (size > WHOLE_PAPER_LIMITS.maxPdfBytes) throw serviceError('asset_size_limit', 'Each PDF must be 10 MiB or smaller.', 413)
  } else if (IMAGE_TYPES.has(mediaType)) {
    if (role !== 'answer') throw serviceError('reference_type_unsupported', 'References must be uploaded as PDF files.', 415)
    if (size > WHOLE_PAPER_LIMITS.maxImageBytes) throw serviceError('asset_size_limit', 'Each image must be 4 MiB or smaller.', 413)
  } else {
    throw serviceError('asset_type_unsupported', 'Only PDF, PNG, JPEG and WebP files are accepted.', 415)
  }
  return Object.freeze({ clientAssetId, role, mediaType, order, fileName, size })
}

function normalizeCreatePayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw serviceError('job_request_invalid', 'A whole-paper marking request is required.')
  const allowed = new Set(['schemaVersion', 'clientRequestId', 'title', 'studentLabel', 'instructions', 'routeId', 'stage', 'paperId', 'files'])
  if (Object.keys(value).some((key) => !allowed.has(key))) throw serviceError('job_request_invalid', 'The marking request contains unsupported fields.')
  if (value.schemaVersion !== WHOLE_PAPER_JOB_SCHEMA_VERSION) throw serviceError('job_schema_invalid', `schemaVersion must be ${WHOLE_PAPER_JOB_SCHEMA_VERSION}.`)
  const clientRequestId = text(value.clientRequestId, 100)
  if (!/^[A-Za-z0-9._:-]{8,100}$/.test(clientRequestId)) throw serviceError('client_request_id_invalid', 'A stable clientRequestId is required.')
  const title = text(value.title, 100)
  const studentLabel = text(value.studentLabel, 120)
  const instructions = text(value.instructions, 2_000)
  const routeId = text(value.routeId, 120).toLowerCase()
  const stage = text(value.stage, 40)
  const paperId = text(value.paperId, 200)
  if (routeId && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(routeId)) throw serviceError('route_id_invalid', 'routeId is invalid.')
  if (stage && !/^[A-Za-z0-9 ._-]{1,40}$/.test(stage)) throw serviceError('stage_invalid', 'stage is invalid.')
  if (paperId && !/^[A-Za-z0-9._:-]{1,200}$/.test(paperId)) throw serviceError('paper_id_invalid', 'paperId is invalid.')
  const files = (Array.isArray(value.files) ? value.files : []).map(normalizeFileSpec)
  const answerFiles = files.filter((file) => file.role === 'answer').sort((a, b) => a.order - b.order)
  const questionPapers = files.filter((file) => file.role === 'question-paper')
  const markSchemes = files.filter((file) => file.role === 'mark-scheme')
  if (!answerFiles.length || answerFiles.length > WHOLE_PAPER_LIMITS.maxAnswerImages) throw serviceError('answer_file_count', 'Upload one PDF or between 1 and 20 answer images.')
  if (new Set(files.map((file) => file.clientAssetId)).size !== files.length) throw serviceError('client_asset_id_duplicate', 'clientAssetId values must be unique.')
  if (questionPapers.length > 1 || markSchemes.length > 1) throw serviceError('reference_file_count', 'Upload at most one question paper and one mark scheme.')
  if ([...questionPapers, ...markSchemes].some((file) => file.mediaType !== PDF_TYPE || file.order !== 1)) throw serviceError('reference_file_invalid', 'Each optional reference must be one PDF with order 1.')
  const answerPdfCount = answerFiles.filter((file) => file.mediaType === PDF_TYPE).length
  if ((answerPdfCount && (answerPdfCount !== 1 || answerFiles.length !== 1)) || (!answerPdfCount && answerFiles.some((file) => !IMAGE_TYPES.has(file.mediaType)))) {
    throw serviceError('answer_file_mix_invalid', 'Answers must be one PDF or an ordered image sequence, not a mixture.')
  }
  if (answerFiles.some((file, index) => file.order !== index + 1)) throw serviceError('answer_order_invalid', 'Answer image order must be contiguous from 1.')
  const totalSize = files.reduce((sum, file) => sum + file.size, 0)
  if (totalSize > WHOLE_PAPER_LIMITS.maxJobBytes) throw serviceError('job_size_limit', 'The whole marking job must be 40 MiB or smaller.', 413)
  return Object.freeze({
    schemaVersion: WHOLE_PAPER_JOB_SCHEMA_VERSION,
    clientRequestId,
    title,
    studentLabel,
    instructions,
    routeId,
    stage,
    paperId,
    files: Object.freeze(files),
    totalSize,
  })
}

function ensureTables(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS whole_paper_marking_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      client_request_id TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      title TEXT NOT NULL,
      student_label TEXT NOT NULL,
      instructions TEXT NOT NULL,
      route_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      paper_id TEXT NOT NULL,
      status TEXT NOT NULL,
      progress_json TEXT NOT NULL,
      submission_hash TEXT,
      last_retry_request_id TEXT,
      cancel_request_id TEXT,
      processing_attempt INTEGER NOT NULL DEFAULT 0,
      retryable INTEGER NOT NULL DEFAULT 0,
      failure_code TEXT,
      result_json TEXT,
      source_pdf_key TEXT,
      report_pdf_key TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      submitted_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      UNIQUE (user_id, client_request_id)
    );
    CREATE INDEX IF NOT EXISTS idx_whole_paper_jobs_user_updated ON whole_paper_marking_jobs(user_id, updated_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_whole_paper_jobs_status_created ON whole_paper_marking_jobs(status, created_at, id);
    CREATE TABLE IF NOT EXISTS whole_paper_marking_assets (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES whole_paper_marking_jobs(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      client_asset_id TEXT NOT NULL,
      role TEXT NOT NULL,
      media_type TEXT NOT NULL,
      file_order INTEGER NOT NULL,
      file_name TEXT NOT NULL,
      declared_size INTEGER NOT NULL,
      size INTEGER,
      sha256 TEXT,
      page_count INTEGER,
      width INTEGER,
      height INTEGER,
      status TEXT NOT NULL,
      storage_key TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (job_id, client_asset_id)
    );
    CREATE INDEX IF NOT EXISTS idx_whole_paper_assets_job ON whole_paper_marking_assets(job_id, role, file_order);
    CREATE INDEX IF NOT EXISTS idx_whole_paper_assets_user ON whole_paper_marking_assets(user_id, status);
  `)
}

function safeResult(value, hasQuestionPaper, hasMarkScheme) {
  const normalized = normalizeWholePaperAiResult(value, { hasQuestionPaper, hasMarkScheme })
  return {
    ...normalized,
    schemaVersion: RESULT_SCHEMA_VERSION,
    provider: text(value?.provider, 80) || null,
    model: text(value?.model, 160) || null,
  }
}

function failureCode(error) {
  const code = text(error?.code, 80)
  if (code) return code
  return /timeout|timed out|abort/i.test(String(error?.message || '')) ? 'marking_timeout' : 'marking_failed'
}

export function wholePaperFailureIsRetryable(error) {
  if (typeof error?.retryable === 'boolean') return error.retryable
  const statusCode = Number(error?.statusCode)
  if (statusCode >= 400 && statusCode < 500 && ![408, 429].includes(statusCode)) return false
  return true
}

export function createWholePaperMarkingService({
  database,
  env = process.env,
  storageRoot,
  runner,
  reportRenderer = null,
  jobTimeoutMs,
  draftTtlMs,
  resultTtlMs,
  maxUserStorageBytes,
  maxActiveJobs,
  now = Date.now,
} = {}) {
  if (!database?.prepare || !database?.exec) throw new Error('Whole-paper marking requires the STEM SQLite database.')
  const root = path.resolve(String(storageRoot || env.STEM_WHOLE_PAPER_STORAGE_ROOT || path.join(process.cwd(), 'data', 'whole-paper-marking')))
  const publicRoot = path.resolve(process.cwd(), 'public')
  if (root === publicRoot || withinRoot(root, publicRoot)) throw new Error('Whole-paper storage must be outside the public static root.')
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  ensureTables(database)
  const configuredJobTimeout = numericOption(jobTimeoutMs ?? env.STEM_WHOLE_PAPER_JOB_TIMEOUT_MS, DEFAULT_JOB_TIMEOUT_MS, 25, 10 * 60 * 1000)
  const configuredDraftTtl = numericOption(draftTtlMs ?? env.STEM_WHOLE_PAPER_DRAFT_TTL_MS, DEFAULT_DRAFT_TTL_MS, 1_000, 30 * 24 * 60 * 60 * 1000)
  const configuredResultTtl = numericOption(resultTtlMs ?? env.STEM_WHOLE_PAPER_RESULT_TTL_MS, DEFAULT_RESULT_TTL_MS, 1_000, 90 * 24 * 60 * 60 * 1000)
  const configuredUserBytes = numericOption(maxUserStorageBytes ?? env.STEM_WHOLE_PAPER_USER_STORAGE_BYTES, DEFAULT_USER_STORAGE_BYTES, WHOLE_PAPER_LIMITS.maxJobBytes, 2 * 1024 * 1024 * 1024)
  const configuredActiveJobs = numericOption(maxActiveJobs ?? env.STEM_WHOLE_PAPER_ACTIVE_JOBS, DEFAULT_ACTIVE_JOBS, 1, 10)
  const runAi = typeof runner === 'function' ? runner : createWholePaperAiRunner({ env })
  const renderReport = typeof reportRenderer === 'function'
    ? reportRenderer
    : (input) => renderWholePaperReport(input, {
        fontPath: env.STEM_WHOLE_PAPER_CJK_FONT_PATH || undefined,
        fontSha256: env.STEM_WHOLE_PAPER_CJK_FONT_SHA256 || '',
      })
  let active = false
  let cleanupAt = 0

  const recoveredAt = nowIso(now)
  database.prepare(`
    UPDATE whole_paper_marking_jobs
    SET status = 'failed', progress_json = ?, retryable = 1, failure_code = 'worker_restarted', updated_at = ?, completed_at = ?
    WHERE status = 'processing'
  `).run(JSON.stringify({ stage: 'failed', completedPages: 0, totalPages: null }), recoveredAt, recoveredAt)

  function jobDirectory(job) {
    const owner = crypto.createHash('sha256').update(String(job.user_id)).digest('hex').slice(0, 24)
    const directory = path.join(root, owner, String(job.id))
    if (!withinRoot(directory, root)) throw new Error('Invalid whole-paper storage path.')
    return directory
  }

  function resolveStorageKey(key) {
    const filePath = path.resolve(root, String(key || ''))
    if (!withinRoot(filePath, root)) throw serviceError('artifact_not_found', 'The requested artifact is unavailable.', 404)
    return filePath
  }

  function storageKey(filePath) {
    const relative = path.relative(root, filePath)
    if (!relative || path.isAbsolute(relative) || relative.startsWith(`..${path.sep}`)) throw new Error('Invalid whole-paper storage key.')
    return relative.split(path.sep).join('/')
  }

  function assetRows(jobId) {
    return database.prepare(`
      SELECT id, job_id, user_id, client_asset_id, role, media_type, file_order, file_name, declared_size,
             size, sha256, page_count, width, height, status, storage_key, created_at, updated_at
      FROM whole_paper_marking_assets WHERE job_id = ? ORDER BY
        CASE role WHEN 'answer' THEN 0 WHEN 'question-paper' THEN 1 ELSE 2 END, file_order, id
    `).all(jobId)
  }

  function publicAsset(row, jobId) {
    return {
      clientAssetId: row.client_asset_id,
      assetId: row.id,
      role: row.role,
      mediaType: row.media_type,
      order: Number(row.file_order),
      fileName: row.file_name,
      declaredSize: Number(row.declared_size),
      size: row.size == null ? null : Number(row.size),
      pageCount: row.page_count == null ? null : Number(row.page_count),
      status: row.status,
      uploadPath: `/api/stem/paper-marking-jobs/${encodeURIComponent(jobId)}/files/${encodeURIComponent(row.id)}`,
    }
  }

  function publicJob(row, { duplicate = false } = {}) {
    const assets = assetRows(row.id).map((asset) => publicAsset(asset, row.id))
    const result = parseJson(row.result_json)
    const expiresAt = row.status === 'draft'
      ? new Date(Date.parse(row.updated_at) + configuredDraftTtl).toISOString()
      : ['completed', 'failed'].includes(row.status)
        ? new Date(Date.parse(row.updated_at) + configuredResultTtl).toISOString()
        : null
    return {
      schemaVersion: WHOLE_PAPER_JOB_SCHEMA_VERSION,
      jobId: row.id,
      clientRequestId: row.client_request_id,
      status: JOB_STATUSES.has(row.status) ? row.status : 'failed',
      title: row.title,
      studentLabel: row.student_label,
      instructions: row.instructions,
      routeId: row.route_id || null,
      stage: row.stage || null,
      paperId: row.paper_id || null,
      progress: parseJson(row.progress_json, { stage: row.status }),
      assets,
      processingAttempt: Number(row.processing_attempt) || 0,
      retryable: Boolean(row.retryable),
      failureCode: row.failure_code || null,
      result,
      sourcePdfPath: row.source_pdf_key ? `/api/stem/paper-marking-jobs/${encodeURIComponent(row.id)}/source.pdf` : null,
      reportPdfPath: row.report_pdf_key ? `/api/stem/paper-marking-jobs/${encodeURIComponent(row.id)}/report.pdf` : null,
      reportTextSelectable: row.report_pdf_key ? false : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      submittedAt: row.submitted_at || null,
      startedAt: row.started_at || null,
      completedAt: row.completed_at || null,
      expiresAt,
      ...(duplicate ? { duplicate: true } : {}),
    }
  }

  function ownedJob(userId, jobId) {
    const row = database.prepare('SELECT * FROM whole_paper_marking_jobs WHERE id = ? AND user_id = ?').get(jobId, userId)
    if (!row) throw serviceError('job_not_found', 'Whole-paper marking job not found.', 404)
    return row
  }

  function removeJobFiles(row) {
    const directory = jobDirectory(row)
    if (fs.existsSync(directory)) fs.rmSync(directory, { recursive: true, force: true })
    const ownerDirectory = path.dirname(directory)
    try { fs.rmdirSync(ownerDirectory) } catch { /* Other owned jobs may remain. */ }
  }

  function cleanupExpired({ force = false } = {}) {
    const current = now()
    if (!force && current < cleanupAt) return 0
    cleanupAt = current + Math.min(60 * 60 * 1000, configuredDraftTtl, configuredResultTtl)
    const draftCutoff = new Date(current - configuredDraftTtl).toISOString()
    const terminalCutoff = new Date(current - configuredResultTtl).toISOString()
    const rows = database.prepare(`
      SELECT * FROM whole_paper_marking_jobs
      WHERE (status = 'draft' AND updated_at < ?)
         OR (status IN ('completed', 'failed') AND updated_at < ?)
      LIMIT 100
    `).all(draftCutoff, terminalCutoff)
    for (const row of rows) {
      removeJobFiles(row)
      database.prepare('DELETE FROM whole_paper_marking_jobs WHERE id = ? AND status IN (\'draft\', \'completed\', \'failed\')').run(row.id)
    }
    return rows.length
  }

  function createJob(user, payload) {
    cleanupExpired()
    const normalized = normalizeCreatePayload(payload)
    const hash = requestHash(normalized)
    const existing = database.prepare('SELECT * FROM whole_paper_marking_jobs WHERE user_id = ? AND client_request_id = ?').get(user.id, normalized.clientRequestId)
    if (existing) {
      if (existing.request_hash !== hash) throw serviceError('idempotency_conflict', 'clientRequestId is already bound to different job metadata.', 409)
      return { statusCode: 200, body: publicJob(existing, { duplicate: true }) }
    }
    const activeCount = Number(database.prepare("SELECT COUNT(*) AS count FROM whole_paper_marking_jobs WHERE user_id = ? AND status IN ('draft','queued','processing')").get(user.id)?.count || 0)
    if (activeCount >= configuredActiveJobs) throw serviceError('active_job_quota', 'Finish or remove an active whole-paper job before creating another.', 429, true)
    const storedBytes = Number(database.prepare("SELECT COALESCE(SUM(size), 0) AS bytes FROM whole_paper_marking_assets WHERE user_id = ? AND status = 'uploaded'").get(user.id)?.bytes || 0)
    if (storedBytes + normalized.totalSize > configuredUserBytes) throw serviceError('user_storage_quota', 'The private whole-paper storage quota has been reached.', 429, true)
    const jobId = `wpm-${crypto.randomUUID()}`
    const createdAt = nowIso(now)
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare(`
        INSERT INTO whole_paper_marking_jobs
          (id, user_id, client_request_id, request_hash, title, student_label, instructions, route_id, stage, paper_id,
           status, progress_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)
      `).run(jobId, user.id, normalized.clientRequestId, hash, normalized.title, normalized.studentLabel, normalized.instructions,
        normalized.routeId, normalized.stage, normalized.paperId,
        JSON.stringify({ stage: 'awaiting-upload', completedPages: 0, totalPages: null }), createdAt, createdAt)
      for (const file of normalized.files) {
        database.prepare(`
          INSERT INTO whole_paper_marking_assets
            (id, job_id, user_id, client_asset_id, role, media_type, file_order, file_name, declared_size, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting-upload', ?, ?)
        `).run(`asset-${crypto.randomUUID()}`, jobId, user.id, file.clientAssetId, file.role, file.mediaType, file.order, file.fileName, file.size, createdAt, createdAt)
      }
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return { statusCode: 201, body: publicJob(ownedJob(user.id, jobId)) }
  }

  async function uploadAsset(request, user, jobId, assetId) {
    cleanupExpired()
    const job = ownedJob(user.id, jobId)
    if (job.status !== 'draft') throw serviceError('job_not_draft', 'Files cannot be changed after the job is submitted.', 409)
    const asset = database.prepare('SELECT * FROM whole_paper_marking_assets WHERE id = ? AND job_id = ? AND user_id = ?').get(assetId, jobId, user.id)
    if (!asset) throw serviceError('asset_not_found', 'Whole-paper asset not found.', 404)
    const receivedType = exactMediaType(request.headers['content-type'])
    if (receivedType !== asset.media_type) throw serviceError('asset_type_mismatch', 'Content-Type does not match the declared file type.', 400)
    const limit = asset.media_type === PDF_TYPE ? WHOLE_PAPER_LIMITS.maxPdfBytes : WHOLE_PAPER_LIMITS.maxImageBytes
    const bytes = await readRaw(request, limit)
    const inspected = await inspectWholePaperAsset({ bytes, role: asset.role, mediaType: asset.media_type })
    if (asset.status === 'uploaded') {
      if (asset.sha256 === inspected.sha256) return { ...publicAsset(asset, jobId), duplicate: true }
      throw serviceError('asset_already_uploaded', 'This upload slot is already bound to different bytes.', 409)
    }
    if (bytes.length !== Number(asset.declared_size)) throw serviceError('asset_size_mismatch', 'Uploaded byte size does not match the declared file size.', 400)
    const currentBytes = Number(database.prepare("SELECT COALESCE(SUM(size), 0) AS bytes FROM whole_paper_marking_assets WHERE user_id = ? AND status = 'uploaded'").get(user.id)?.bytes || 0)
    if (currentBytes + bytes.length > configuredUserBytes) throw serviceError('user_storage_quota', 'The private whole-paper storage quota has been reached.', 429, true)
    const directory = path.join(jobDirectory(job), 'assets')
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    const finalPath = path.join(directory, `${asset.id}.bin`)
    const temporaryPath = `${finalPath}.${crypto.randomUUID()}.tmp`
    try {
      fs.writeFileSync(temporaryPath, bytes, { mode: 0o600, flag: 'wx' })
      fs.renameSync(temporaryPath, finalPath)
      const updatedAt = nowIso(now)
      database.prepare(`
        UPDATE whole_paper_marking_assets
        SET size = ?, sha256 = ?, page_count = ?, width = ?, height = ?, status = 'uploaded', storage_key = ?, updated_at = ?
        WHERE id = ? AND job_id = ? AND user_id = ? AND status = 'awaiting-upload'
      `).run(bytes.length, inspected.sha256, inspected.pageCount, inspected.width || null, inspected.height || null, storageKey(finalPath), updatedAt, asset.id, jobId, user.id)
      database.prepare('UPDATE whole_paper_marking_jobs SET updated_at = ? WHERE id = ? AND user_id = ?').run(updatedAt, jobId, user.id)
    } catch (error) {
      try { fs.rmSync(temporaryPath, { force: true }) } catch { /* Preserve the upload error. */ }
      try { if (!database.prepare('SELECT status FROM whole_paper_marking_assets WHERE id = ?').get(asset.id)?.status?.includes('uploaded')) fs.rmSync(finalPath, { force: true }) } catch { /* Preserve the upload error. */ }
      throw error
    }
    return publicAsset(database.prepare('SELECT * FROM whole_paper_marking_assets WHERE id = ?').get(asset.id), jobId)
  }

  function normalizedSubmit(payload, assets, job) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw serviceError('submit_request_invalid', 'A submit request is required.')
    const allowed = new Set(['clientRequestId', 'answerAssetIds', 'questionPaperAssetId', 'markSchemeAssetId'])
    if (Object.keys(payload).some((key) => !allowed.has(key))) throw serviceError('submit_request_invalid', 'The submit request contains unsupported fields.')
    if (text(payload.clientRequestId, 100) !== job.client_request_id) throw serviceError('client_request_id_mismatch', 'clientRequestId does not match this job.', 409)
    const expectedAnswers = assets.filter((asset) => asset.role === 'answer').sort((a, b) => a.file_order - b.file_order).map((asset) => asset.id)
    const answerAssetIds = Array.isArray(payload.answerAssetIds) ? payload.answerAssetIds.map(String) : []
    if (canonicalJson(answerAssetIds) !== canonicalJson(expectedAnswers)) throw serviceError('answer_asset_order_mismatch', 'answerAssetIds must exactly match the declared answer order.', 409)
    const expectedQuestionPaper = assets.find((asset) => asset.role === 'question-paper')?.id || null
    const expectedMarkScheme = assets.find((asset) => asset.role === 'mark-scheme')?.id || null
    const questionPaperAssetId = payload.questionPaperAssetId ? String(payload.questionPaperAssetId) : null
    const markSchemeAssetId = payload.markSchemeAssetId ? String(payload.markSchemeAssetId) : null
    if (questionPaperAssetId !== expectedQuestionPaper || markSchemeAssetId !== expectedMarkScheme) throw serviceError('reference_asset_mismatch', 'Reference asset IDs do not match the declared job.', 409)
    if (assets.some((asset) => asset.status !== 'uploaded')) throw serviceError('assets_incomplete', 'Every declared file must finish uploading before submit.', 409)
    const totalVisualPages = assets.reduce((sum, asset) => sum + Number(asset.page_count || 0), 0)
    if (totalVisualPages > WHOLE_PAPER_AI_MAX_IMAGES) {
      throw serviceError('provider_image_limit', `This job has ${totalVisualPages} pages; visual review accepts at most ${WHOLE_PAPER_AI_MAX_IMAGES}.`, 413)
    }
    const totalAnswerPixels = assets
      .filter((asset) => asset.role === 'answer' && IMAGE_TYPES.has(asset.media_type))
      .reduce((sum, asset) => sum + Number(asset.width || 0) * Number(asset.height || 0), 0)
    if (totalAnswerPixels > WHOLE_PAPER_LIMITS.maxAnswerTotalPixels) {
      throw serviceError('answer_pixel_budget', 'The ordered answer images exceed the safe total pixel budget. Resize the images and retry.', 413)
    }
    return Object.freeze({ clientRequestId: job.client_request_id, answerAssetIds, questionPaperAssetId, markSchemeAssetId })
  }

  function submitJob(user, jobId, payload) {
    const job = ownedJob(user.id, jobId)
    const assets = assetRows(jobId)
    const submission = normalizedSubmit(payload, assets, job)
    const hash = requestHash(submission)
    if (job.status !== 'draft') {
      if (job.submission_hash === hash && ['queued', 'processing', 'completed', 'failed'].includes(job.status)) return { statusCode: 200, body: publicJob(job, { duplicate: true }) }
      throw serviceError('job_already_submitted', 'This job is already bound to a different submission.', 409)
    }
    const submittedAt = nowIso(now)
    database.prepare(`
      UPDATE whole_paper_marking_jobs
      SET status = 'queued', progress_json = ?, submission_hash = ?, retryable = 0, failure_code = NULL,
          submitted_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND status = 'draft'
    `).run(JSON.stringify({ stage: 'queued', completedPages: 0, totalPages: assets.filter((asset) => asset.role === 'answer').reduce((sum, asset) => sum + Number(asset.page_count || 0), 0) }), hash, submittedAt, submittedAt, jobId, user.id)
    schedulePump()
    return { statusCode: 202, body: publicJob(ownedJob(user.id, jobId)) }
  }

  function retryJob(user, jobId, payload) {
    const job = ownedJob(user.id, jobId)
    const clientRequestId = text(payload?.clientRequestId, 100)
    if (!/^[A-Za-z0-9._:-]{8,100}$/.test(clientRequestId)) throw serviceError('client_request_id_invalid', 'Retry needs a stable clientRequestId.')
    if (job.last_retry_request_id === clientRequestId && ['queued', 'processing', 'failed', 'completed'].includes(job.status)) {
      return { statusCode: 200, body: publicJob(job, { duplicate: true }) }
    }
    if (job.status !== 'failed' || !job.retryable) throw serviceError('job_not_retryable', 'This job is not in a retryable failed state.', 409)
    const updatedAt = nowIso(now)
    database.prepare(`
      UPDATE whole_paper_marking_jobs
      SET status = 'queued', progress_json = ?, last_retry_request_id = ?, retryable = 0, failure_code = NULL,
          report_pdf_key = NULL, updated_at = ?, completed_at = NULL
      WHERE id = ? AND user_id = ? AND status = 'failed'
    `).run(JSON.stringify({ stage: 'queued', completedPages: 0, totalPages: null }), clientRequestId, updatedAt, jobId, user.id)
    schedulePump()
    return { statusCode: 202, body: publicJob(ownedJob(user.id, jobId)) }
  }

  function cancelJob(user, jobId, payload) {
    const job = ownedJob(user.id, jobId)
    const clientRequestId = text(payload?.clientRequestId, 100)
    if (!/^[A-Za-z0-9._:-]{8,100}$/.test(clientRequestId)) throw serviceError('client_request_id_invalid', 'Cancel needs a stable clientRequestId.')
    if (job.status === 'failed' && job.failure_code === 'cancelled' && job.cancel_request_id === clientRequestId) {
      return { statusCode: 200, body: publicJob(job, { duplicate: true }) }
    }
    if (job.status !== 'draft') throw serviceError('job_not_cancellable', 'Only an unsubmitted draft can be cancelled.', 409)
    const cancelledAt = nowIso(now)
    database.prepare(`
      UPDATE whole_paper_marking_jobs
      SET status = 'failed', progress_json = ?, retryable = 0, failure_code = 'cancelled', cancel_request_id = ?,
          updated_at = ?, completed_at = ?
      WHERE id = ? AND user_id = ? AND status = 'draft'
    `).run(JSON.stringify({ stage: 'cancelled', completedPages: 0, totalPages: null }), clientRequestId, cancelledAt, cancelledAt, jobId, user.id)
    return { statusCode: 200, body: publicJob(ownedJob(user.id, jobId)) }
  }

  function updateProgress(jobId, progress) {
    database.prepare("UPDATE whole_paper_marking_jobs SET progress_json = ?, updated_at = ? WHERE id = ? AND status = 'processing'")
      .run(JSON.stringify(progress), nowIso(now), jobId)
  }

  function readStoredAsset(row) {
    if (row.status !== 'uploaded' || !row.storage_key) throw serviceError('asset_unavailable', 'An uploaded file is unavailable for marking.', 409, false)
    const filePath = resolveStorageKey(row.storage_key)
    const bytes = fs.readFileSync(filePath)
    if (bytes.length !== Number(row.size) || sha256(bytes) !== row.sha256) throw serviceError('asset_integrity_failed', 'An uploaded file failed its integrity check.', 409, false)
    return { ...row, bytes }
  }

  function atomicWrite(filePath, bytes) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
    if (fs.existsSync(filePath)) {
      const existing = fs.readFileSync(filePath)
      if (existing.length === bytes.length && sha256(existing) === sha256(bytes)) return
    }
    const temporary = `${filePath}.${crypto.randomUUID()}.tmp`
    try {
      fs.writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx' })
      try {
        fs.renameSync(temporary, filePath)
      } catch (error) {
        if (!['EEXIST', 'EPERM'].includes(error?.code) || !fs.existsSync(filePath)) throw error
        fs.rmSync(filePath, { force: true })
        fs.renameSync(temporary, filePath)
      }
    } finally {
      fs.rmSync(temporary, { force: true })
    }
  }

  async function renderAndCompleteJob({ job, result, directory, sourcePath, completedPages, signal }) {
    const resultJson = JSON.stringify(result)
    const reportingAt = nowIso(now)
    const persisted = database.prepare(`
      UPDATE whole_paper_marking_jobs
      SET result_json = ?, progress_json = ?, source_pdf_key = ?, updated_at = ?
      WHERE id = ? AND status = 'processing'
    `).run(resultJson, JSON.stringify({ stage: 'reporting', completedPages, totalPages: completedPages }), storageKey(sourcePath), reportingAt, job.id)
    if (!persisted.changes) throw serviceError('job_state_changed', 'The marking job state changed before report generation.', 409, true)
    const report = await renderReport({
      title: job.title || 'Whole-paper AI marking report',
      studentLabel: job.student_label,
      instructions: job.instructions,
      ...result,
    })
    if (!Buffer.isBuffer(report) || report.subarray(0, 5).toString('ascii') !== '%PDF-') throw serviceError('report_pdf_invalid', 'The AI report PDF could not be generated.', 500, true)
    if (signal.aborted) throw serviceError('marking_timeout', 'Whole-paper marking timed out.', 504, true)
    const reportPath = path.join(directory, 'report.pdf')
    atomicWrite(reportPath, report)
    const completedAt = nowIso(now)
    const update = database.prepare(`
      UPDATE whole_paper_marking_jobs
      SET status = 'completed', progress_json = ?, retryable = 0, failure_code = NULL,
          source_pdf_key = ?, report_pdf_key = ?, updated_at = ?, completed_at = ?
      WHERE id = ? AND status = 'processing'
    `).run(JSON.stringify({ stage: 'completed', completedPages, totalPages: completedPages }), storageKey(sourcePath), storageKey(reportPath), completedAt, completedAt, job.id)
    if (!update.changes) throw serviceError('job_state_changed', 'The marking job state changed before completion.', 409, true)
  }

  async function runPipeline(job, signal, deadlineAt) {
    const rows = assetRows(job.id).map(readStoredAsset)
    const answerAssets = rows.filter((asset) => asset.role === 'answer').sort((a, b) => a.file_order - b.file_order)
    const questionPaper = rows.find((asset) => asset.role === 'question-paper') || null
    const markScheme = rows.find((asset) => asset.role === 'mark-scheme') || null
    const totalVisualPages = rows.reduce((sum, asset) => sum + Number(asset.page_count || 0), 0)
    if (totalVisualPages > WHOLE_PAPER_AI_MAX_IMAGES) throw serviceError('provider_image_limit', 'The job exceeds the visual provider page limit.', 413, false)
    updateProgress(job.id, { stage: 'preparing-source-pdf', completedPages: 0, totalPages: answerAssets.reduce((sum, asset) => sum + Number(asset.page_count || 0), 0) })
    const sourcePdf = answerAssets.length === 1 && answerAssets[0].media_type === PDF_TYPE
      ? Buffer.from(answerAssets[0].bytes)
      : await orderedImagesToPdf(answerAssets.map((asset) => ({ bytes: asset.bytes, mediaType: asset.media_type })), { signal })
    if (signal.aborted) throw serviceError('marking_timeout', 'Whole-paper marking timed out.', 504, true)
    const directory = jobDirectory(job)
    const sourcePath = path.join(directory, 'source.pdf')
    atomicWrite(sourcePath, sourcePdf)
    database.prepare("UPDATE whole_paper_marking_jobs SET source_pdf_key = ?, updated_at = ? WHERE id = ? AND status = 'processing'").run(storageKey(sourcePath), nowIso(now), job.id)
    const answerPageCount = answerAssets.reduce((sum, asset) => sum + Number(asset.page_count || 0), 0)
    const storedResult = parseJson(job.result_json)
    if (storedResult?.schemaVersion === RESULT_SCHEMA_VERSION) {
      const reusableResult = safeResult(storedResult, Boolean(questionPaper), Boolean(markScheme))
      await renderAndCompleteJob({ job, result: reusableResult, directory, sourcePath, completedPages: answerPageCount, signal })
      return
    }
    updateProgress(job.id, { stage: 'rendering-answer-pages', completedPages: 0, totalPages: answerPageCount })
    const answerPages = await renderPdfToPageImages(sourcePdf, { maxPages: WHOLE_PAPER_LIMITS.maxAnswerPages, signal })
    updateProgress(job.id, { stage: 'rendering-references', completedPages: answerPages.length, totalPages: answerPages.length })
    const questionPaperPages = questionPaper ? await renderPdfToPageImages(questionPaper.bytes, { maxPages: WHOLE_PAPER_LIMITS.maxReferencePages, signal }) : []
    const markSchemePages = markScheme ? await renderPdfToPageImages(markScheme.bytes, { maxPages: WHOLE_PAPER_LIMITS.maxReferencePages, signal }) : []
    if (signal.aborted) throw serviceError('marking_timeout', 'Whole-paper marking timed out.', 504, true)
    updateProgress(job.id, { stage: 'ai-review', completedPages: answerPages.length, totalPages: answerPages.length })
    const rawResult = await runAi({
      job: { id: job.id, title: job.title, studentLabel: job.student_label, instructions: job.instructions, routeId: job.route_id, stage: job.stage, paperId: job.paper_id },
      answerPages,
      questionPaperPages,
      markSchemePages,
      deadlineAt,
      signal,
    })
    if (signal.aborted) throw serviceError('marking_timeout', 'Whole-paper marking timed out.', 504, true)
    const result = safeResult(rawResult, Boolean(questionPaper), Boolean(markScheme))
    await renderAndCompleteJob({ job, result, directory, sourcePath, completedPages: answerPages.length, signal })
  }

  async function processJob(job) {
    const controller = new AbortController()
    const deadlineAt = now() + configuredJobTimeout
    let timer
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(serviceError('marking_timeout', 'Whole-paper marking timed out.', 504, true))
      }, configuredJobTimeout)
    })
    const pipeline = runPipeline(job, controller.signal, deadlineAt)
    try {
      await Promise.race([pipeline, timeoutPromise])
    } catch (error) {
      controller.abort()
      const code = failureCode(error)
      const retryable = wholePaperFailureIsRetryable(error) ? 1 : 0
      const failedAt = nowIso(now)
      database.prepare(`
        UPDATE whole_paper_marking_jobs
        SET status = 'failed', progress_json = ?, retryable = ?, failure_code = ?, updated_at = ?, completed_at = ?
        WHERE id = ? AND status = 'processing'
      `).run(JSON.stringify({ stage: 'failed', completedPages: 0, totalPages: null }), retryable, code, failedAt, failedAt, job.id)
      // Do not release the single-worker lock while an aborted renderer/provider
      // is still live. Real provider fetches receive the abort signal; an
      // uncooperative injected runner keeps later jobs queued until it settles.
      await pipeline.catch(() => {})
    } finally {
      clearTimeout(timer)
    }
  }

  async function pump() {
    if (active) return
    active = true
    try {
      while (true) {
        const queued = database.prepare("SELECT * FROM whole_paper_marking_jobs WHERE status = 'queued' ORDER BY submitted_at, created_at, id LIMIT 1").get()
        if (!queued) break
        const startedAt = nowIso(now)
        const claimed = database.prepare(`
          UPDATE whole_paper_marking_jobs
          SET status = 'processing', progress_json = ?, processing_attempt = processing_attempt + 1,
              started_at = ?, updated_at = ?, retryable = 0, failure_code = NULL
          WHERE id = ? AND status = 'queued'
        `).run(JSON.stringify({ stage: 'starting', completedPages: 0, totalPages: null }), startedAt, startedAt, queued.id)
        if (!claimed.changes) continue
        await processJob(database.prepare('SELECT * FROM whole_paper_marking_jobs WHERE id = ?').get(queued.id))
      }
    } finally {
      active = false
      if (database.prepare("SELECT 1 FROM whole_paper_marking_jobs WHERE status = 'queued' LIMIT 1").get()) schedulePump()
    }
  }

  function schedulePump() {
    queueMicrotask(() => { void pump() })
  }

  function listJobs(user, url) {
    cleanupExpired()
    const limit = numericOption(url.searchParams.get('limit'), 20, 1, 50)
    const cursor = text(url.searchParams.get('cursor'), 500)
    let cursorValue = null
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
        if (Array.isArray(decoded) && decoded.length === 2) cursorValue = decoded.map(String)
      } catch { throw serviceError('cursor_invalid', 'The job cursor is invalid.') }
      if (!cursorValue) throw serviceError('cursor_invalid', 'The job cursor is invalid.')
    }
    const rows = cursorValue
      ? database.prepare(`SELECT * FROM whole_paper_marking_jobs WHERE user_id = ? AND (updated_at < ? OR (updated_at = ? AND id < ?)) ORDER BY updated_at DESC, id DESC LIMIT ?`).all(user.id, cursorValue[0], cursorValue[0], cursorValue[1], limit + 1)
      : database.prepare('SELECT * FROM whole_paper_marking_jobs WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?').all(user.id, limit + 1)
    const page = rows.slice(0, limit)
    const next = rows.length > limit && page.length ? Buffer.from(JSON.stringify([page.at(-1).updated_at, page.at(-1).id])).toString('base64url') : null
    return { schemaVersion: WHOLE_PAPER_JOB_SCHEMA_VERSION, jobs: page.map((row) => publicJob(row)), nextCursor: next }
  }

  function disposition(job, kind) {
    const fallback = kind === 'report' ? `ai-marking-report-${job.id.slice(-8)}.pdf` : `student-answer-${job.id.slice(-8)}.pdf`
    const requested = text(job.title, 80).replace(/[\\/:*?"<>|]/g, '-') || (kind === 'report' ? 'AI marking report' : 'Student answer')
    const unicode = `${requested}-${kind === 'report' ? 'AI-report' : 'answer'}.pdf`
    return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(unicode)}`
  }

  function download(user, jobId, kind, response) {
    const job = ownedJob(user.id, jobId)
    const key = kind === 'report' ? job.report_pdf_key : job.source_pdf_key
    if (!key) throw serviceError('artifact_not_ready', 'The requested PDF is not ready.', 409, job.status === 'queued' || job.status === 'processing')
    const filePath = resolveStorageKey(key)
    let bytes
    try { bytes = fs.readFileSync(filePath) }
    catch { throw serviceError('artifact_not_found', 'The requested PDF is unavailable.', 404) }
    if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw serviceError('artifact_not_found', 'The requested PDF is unavailable.', 404)
    response.statusCode = 200
    response.setHeader('Content-Type', 'application/pdf')
    response.setHeader('Content-Disposition', disposition(job, kind))
    response.setHeader('Content-Length', String(bytes.length))
    response.setHeader('Cache-Control', 'private, no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    if (kind === 'report') response.setHeader('X-STEM-Report-Text-Selectable', 'false')
    response.end(bytes)
  }

  async function handle({ request, response, url, user }) {
    const rootPath = '/api/stem/paper-marking-jobs'
    if (url.pathname === rootPath) {
      if (request.method === 'POST') {
        const result = createJob(user, await readJson(request))
        sendJson(response, result.statusCode, result.body)
        return true
      }
      if (request.method === 'GET') {
        sendJson(response, 200, listJobs(user, url))
        return true
      }
      throw serviceError('method_not_allowed', 'Method not allowed.', 405)
    }
    const match = url.pathname.match(/^\/api\/stem\/paper-marking-jobs\/(wpm-[0-9a-f-]{36})(?:\/(.*))?$/i)
    if (!match) throw serviceError('job_not_found', 'Whole-paper marking job not found.', 404)
    const jobId = match[1]
    const action = match[2] || ''
    const fileMatch = action.match(/^files\/(asset-[0-9a-f-]{36})$/i)
    if (!action && request.method === 'GET') {
      sendJson(response, 200, publicJob(ownedJob(user.id, jobId)))
      return true
    }
    if (fileMatch && request.method === 'PUT') {
      const asset = await uploadAsset(request, user, jobId, fileMatch[1])
      sendJson(response, 200, asset)
      return true
    }
    if (action === 'submit' && request.method === 'POST') {
      const result = submitJob(user, jobId, await readJson(request, 16 * 1024))
      sendJson(response, result.statusCode, result.body)
      return true
    }
    if (action === 'retry' && request.method === 'POST') {
      const result = retryJob(user, jobId, await readJson(request, 8 * 1024))
      sendJson(response, result.statusCode, result.body)
      return true
    }
    if (action === 'cancel' && request.method === 'POST') {
      const result = cancelJob(user, jobId, await readJson(request, 8 * 1024))
      sendJson(response, result.statusCode, result.body)
      return true
    }
    if (action === 'source.pdf' && request.method === 'GET') {
      download(user, jobId, 'source', response)
      return true
    }
    if (action === 'report.pdf' && request.method === 'GET') {
      download(user, jobId, 'report', response)
      return true
    }
    throw serviceError('job_route_not_found', 'Whole-paper marking route not found.', 404)
  }

  cleanupExpired()
  if (database.prepare("SELECT 1 FROM whole_paper_marking_jobs WHERE status = 'queued' LIMIT 1").get()) schedulePump()

  return Object.freeze({ handle, cleanupExpired: () => cleanupExpired({ force: true }), storageRoot: root })
}
