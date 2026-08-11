import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { unifiedQuestionBank } from '../src/data/questionBank.js'
import { issueMarkingCapabilities } from './markingCapability.js'

const MAX_BODY_BYTES = 2 * 1024 * 1024
const TOKEN_AUDIENCE = 'stem.ieltsist.com'
const TOKEN_ISSUER = 'ieltsist.com'
const LEGACY_SCOPE = 'legacy-unscoped'
const ROUTE_STAGES = new Map([
  ['igcse', 'IGCSE'],
  ['as', 'AS'],
  ['a2', 'A2'],
  ['competition', 'Competition'],
  ['admissions', 'Admissions'],
])
const REGISTERED_ROUTES = new Map(Object.entries({
  'cie-0580-igcse-mathematics': ['IGCSE', 'math-0580'],
  'cie-0606-igcse-additional-mathematics': ['IGCSE', 'math-0606'],
  'cie-0610-igcse-biology': ['IGCSE', 'biology-0610'],
  'cie-0625-igcse-physics': ['IGCSE', 'physics-0625'],
  'cie-9700-as-biology': ['AS', 'biology-9700'],
  'cie-9700-a2-biology': ['A2', 'biology-9700'],
  'cie-9701-as-chemistry': ['AS', 'chemistry-9701'],
  'cie-9701-a2-chemistry': ['A2', 'chemistry-9701'],
  'cie-9702-as-physics': ['AS', 'physics-9702'],
  'cie-9702-a2-physics': ['A2', 'physics-9702'],
  'cie-9708-as-economics': ['AS', 'economics-9708'],
  'cie-9708-a2-economics': ['A2', 'economics-9708'],
  'cie-9709-as-p1-p2': ['AS', 'math-9709'],
  'cie-9709-as-p1-p4': ['AS', 'math-9709'],
  'cie-9709-as-p1-p5': ['AS', 'math-9709'],
  'cie-9709-a2-after-p1-p5-p3-p4': ['A2', 'math-9709'],
  'cie-9709-a2-after-p1-p5-p3-p6': ['A2', 'math-9709'],
  'cie-9709-a2-after-p1-p4-p3-p5': ['A2', 'math-9709'],
  'cie-9231-as-p1-p3': ['AS', 'math-9231'],
  'cie-9231-as-p1-p4': ['AS', 'math-9231'],
  'cie-9231-a2-after-p1-p3-p2-p4': ['A2', 'math-9231'],
  'cie-9231-a2-after-p1-p4-p2-p3': ['A2', 'math-9231'],
  'bpho-admissions-physics': ['Competition', 'bpho'],
  'maa-amc12-admissions-mathematics': ['Competition', 'amc12'],
  'uatuk-esat-admissions': ['Admissions', 'esat'],
  'uatuk-tmua-admissions': ['Admissions', 'tmua'],
}))
let database = null

function sendJson(response, statusCode, body) {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(body))
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
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

function asText(value, maxLength = 200) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength)
}

function canonicalStage(value, { allowLegacy = false } = {}) {
  const raw = asText(value, 40)
  if (allowLegacy && raw === LEGACY_SCOPE) return LEGACY_SCOPE
  const stage = ROUTE_STAGES.get(raw.toLowerCase())
  if (!stage) throw Object.assign(new Error('Stage must be IGCSE, AS, A2, Competition or Admissions.'), { statusCode: 400 })
  return stage
}

function canonicalRouteId(value, { allowLegacy = false } = {}) {
  const routeId = asText(value, 120).toLowerCase()
  if (allowLegacy && routeId === LEGACY_SCOPE) return LEGACY_SCOPE
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(routeId)) {
    throw Object.assign(new Error('A valid routeId is required.'), { statusCode: 400 })
  }
  if (!REGISTERED_ROUTES.has(routeId)) throw Object.assign(new Error('routeId is not registered.'), { statusCode: 400 })
  return routeId
}

function stageForRoute(routeId) {
  if (routeId === LEGACY_SCOPE) return LEGACY_SCOPE
  return REGISTERED_ROUTES.get(routeId)?.[0] || null
}

function verifiedRouteScope(routeValue, stageValue, { allowLegacy = false } = {}) {
  const routeId = canonicalRouteId(routeValue, { allowLegacy })
  const stage = canonicalStage(stageValue, { allowLegacy })
  if (stageForRoute(routeId) !== stage) {
    throw Object.assign(new Error('routeId and stage must identify the same learning route.'), { statusCode: 400 })
  }
  return { routeId, stage }
}

function verifiedAssignmentScope(routeValue, stageValue, subjectValue) {
  const scope = verifiedRouteScope(routeValue, stageValue)
  const subjectId = asText(subjectValue, 80).toLowerCase()
  if (REGISTERED_ROUTES.get(scope.routeId)?.[1] !== subjectId) {
    throw Object.assign(new Error('subjectId does not match the registered routeId.'), { statusCode: 400 })
  }
  return { ...scope, subjectId }
}

export function assignableQuestionIdsForBank(questionBank = unifiedQuestionBank) {
  return new Set((Array.isArray(questionBank) ? questionBank : [])
    .map((question) => String(question?.bankId || '').trim())
    .filter(Boolean))
}

function routeScopedQuestionIds(values, routeId, assignableQuestionIds) {
  if (!Array.isArray(values) || !values.length) throw Object.assign(new Error('Assignment needs route-scoped question IDs.'), { statusCode: 400 })
  if (values.length > 60) throw Object.assign(new Error('An assignment can contain at most 60 question IDs.'), { statusCode: 400 })
  const questionIds = values.map((value) => {
    const bankId = asText(value, 320)
    const separator = bankId.indexOf('@')
    const sourceQuestionId = bankId.slice(0, separator)
    const suffix = bankId.slice(separator + 1)
    if (separator <= 0 || sourceQuestionId.includes('@') || /\s/.test(bankId) || suffix !== routeId) {
      throw Object.assign(new Error(`Every question bankId must use <sourceQuestionId>@${routeId}.`), { statusCode: 400 })
    }
    return bankId
  })
  if (new Set(questionIds).size !== questionIds.length) {
    throw Object.assign(new Error('Assignment question IDs must be unique.'), { statusCode: 400 })
  }
  for (const questionId of questionIds) {
    if (!assignableQuestionIds.has(questionId)) {
      throw Object.assign(new Error('Assignment question IDs must be verified and source-complete for this route.'), { statusCode: 400 })
    }
  }
  return questionIds
}

function storedScope(row) {
  const routeId = asText(row.route_id, 120) || LEGACY_SCOPE
  if (routeId === LEGACY_SCOPE) return { routeId: LEGACY_SCOPE, stage: LEGACY_SCOPE, scopeStatus: LEGACY_SCOPE }
  return { routeId, stage: asText(row.stage, 40), scopeStatus: 'scoped' }
}

function nowIso() {
  return new Date().toISOString()
}

function ensureColumn(database, table, column, definition) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all()
  if (!columns.some((item) => item.name === column)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

function migrateRouteScope(database) {
  ensureColumn(database, 'assignments', 'route_id', 'TEXT')
  ensureColumn(database, 'submission_events', 'route_id', 'TEXT')
  ensureColumn(database, 'submission_events', 'stage', 'TEXT')
  database.prepare("UPDATE assignments SET route_id = ? WHERE route_id IS NULL OR TRIM(route_id) = ''").run(LEGACY_SCOPE)
  database.prepare("UPDATE submission_events SET route_id = ? WHERE route_id IS NULL OR TRIM(route_id) = ''").run(LEGACY_SCOPE)
  database.prepare("UPDATE submission_events SET stage = ? WHERE stage IS NULL OR TRIM(stage) = ''").run(LEGACY_SCOPE)
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_assignments_route_stage ON assignments(route_id, stage, classroom_id);
  `)
}

function canonicalStoredSourceScope(value, routeId, stage) {
  try {
    const scope = JSON.parse(value)
    if (!scope || Array.isArray(scope) || typeof scope !== 'object') return value
    return JSON.stringify({ ...scope, routeId, stage })
  } catch {
    // Preserve malformed historical payloads for manual review instead of erasing provenance.
    return value
  }
}

function migrateRegisteredRouteStages(database) {
  const assignments = database.prepare('SELECT id, route_id, stage, source_scope_json FROM assignments WHERE route_id IS NOT NULL AND TRIM(route_id) <> ?').all(LEGACY_SCOPE)
  const updates = assignments.flatMap((assignment) => {
    const routeId = asText(assignment.route_id, 120)
    const stage = stageForRoute(routeId)
    if (!stage) return []
    const sourceScopeJson = canonicalStoredSourceScope(assignment.source_scope_json, routeId, stage)
    if (asText(assignment.stage, 40) === stage && sourceScopeJson === assignment.source_scope_json) return []
    return [{ id: assignment.id, routeId, stage, sourceScopeJson }]
  })
  const stageCorrections = [...REGISTERED_ROUTES.entries()].filter(([, [stage]]) => Boolean(stage))
  if (!updates.length && !stageCorrections.length) return

  const updateAssignment = database.prepare('UPDATE assignments SET stage = ?, source_scope_json = ? WHERE id = ?')
  const updateSubmissionStage = database.prepare('UPDATE submission_events SET stage = ? WHERE route_id = ? AND (stage IS NULL OR TRIM(stage) <> ?)')
  database.exec('BEGIN IMMEDIATE')
  try {
    for (const update of updates) updateAssignment.run(update.stage, update.sourceScopeJson, update.id)
    for (const [routeId, [stage]] of stageCorrections) updateSubmissionStage.run(stage, routeId, stage)
    database.exec('COMMIT')
  } catch (error) {
    try { database.exec('ROLLBACK') } catch { /* No active migration transaction. */ }
    throw error
  }
}

function hasAssignmentScopedIdempotency(database) {
  return database.prepare('PRAGMA index_list(submission_events)').all().some((index) => {
    if (!index.unique) return false
    const columns = database.prepare(`PRAGMA index_info(${index.name})`).all().sort((left, right) => left.seqno - right.seqno).map((item) => item.name)
    return columns.join(',') === 'assignment_id,student_user_id,idempotency_key'
  })
}

function migrateSubmissionIdempotency(database) {
  if (!hasAssignmentScopedIdempotency(database)) {
    database.exec('PRAGMA foreign_keys = OFF')
    try {
      database.exec(`
        BEGIN IMMEDIATE;
        DROP TABLE IF EXISTS submission_events_route_migration;
        CREATE TABLE submission_events_route_migration (
          id TEXT PRIMARY KEY,
          assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
          student_user_id TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          event_type TEXT NOT NULL,
          route_id TEXT NOT NULL,
          stage TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          UNIQUE (assignment_id, student_user_id, idempotency_key)
        );
        INSERT INTO submission_events_route_migration
          (id, assignment_id, student_user_id, idempotency_key, event_type, route_id, stage, payload_json, occurred_at)
        SELECT id, assignment_id, student_user_id, idempotency_key, event_type, route_id, stage, payload_json, occurred_at
        FROM submission_events;
        DROP TABLE submission_events;
        ALTER TABLE submission_events_route_migration RENAME TO submission_events;
        COMMIT;
      `)
    } catch (error) {
      try { database.exec('ROLLBACK') } catch { /* No active migration transaction. */ }
      throw error
    } finally {
      database.exec('PRAGMA foreign_keys = ON')
    }
  }
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_submission_events_assignment ON submission_events(assignment_id, student_user_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_submission_events_route_stage ON submission_events(route_id, stage, occurred_at DESC);
  `)
}

function appDatabase(env) {
  if (database) return database
  if (!globalThis.process?.versions?.node) throw new Error('STEM storage requires Node.js.')
  // node:sqlite is available in the Node 22 runtime used by the deployment.
  const { DatabaseSync } = requireNodeSqlite()
  const databasePath = path.resolve(env.STEM_DATABASE_PATH || env.STEM_DB_PATH || path.join(process.cwd(), 'data', 'stem.sqlite'))
  fs.mkdirSync(path.dirname(databasePath), { recursive: true })
  database = new DatabaseSync(databasePath)
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS classrooms (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      invite_code TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      archived_at TEXT
    );
    CREATE TABLE IF NOT EXISTS class_memberships (
      classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      joined_at TEXT NOT NULL,
      PRIMARY KEY (classroom_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_class_memberships_user ON class_memberships(user_id, classroom_id);
    CREATE TABLE IF NOT EXISTS assignments (
      id TEXT PRIMARY KEY,
      classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
      created_by_user_id TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      route_id TEXT NOT NULL,
      syllabus_point_id TEXT NOT NULL,
      title TEXT NOT NULL,
      source_scope_json TEXT NOT NULL,
      due_at TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_assignments_classroom ON assignments(classroom_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS assignment_reminders (
      id TEXT PRIMARY KEY,
      assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
      created_by_user_id TEXT NOT NULL,
      message TEXT NOT NULL,
      audience TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_assignment_reminders_assignment ON assignment_reminders(assignment_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS assignment_feedback (
      id TEXT PRIMARY KEY,
      assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
      student_user_id TEXT,
      author_user_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_assignment_feedback_assignment ON assignment_feedback(assignment_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS submission_events (
      id TEXT PRIMARY KEY,
      assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
      student_user_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      event_type TEXT NOT NULL,
      route_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      UNIQUE (assignment_id, student_user_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS idx_submission_events_assignment ON submission_events(assignment_id, student_user_id, occurred_at DESC);
    CREATE TABLE IF NOT EXISTS private_notes (
      user_id TEXT NOT NULL,
      route_id TEXT NOT NULL,
      body TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      PRIMARY KEY (user_id, route_id)
    );
    CREATE INDEX IF NOT EXISTS idx_private_notes_user ON private_notes(user_id, updated_at DESC);
  `)
  ensureColumn(database, 'private_notes', 'deleted_at', 'TEXT')
  migrateRouteScope(database)
  migrateRegisteredRouteStages(database)
  migrateSubmissionIdempotency(database)
  return database
}

function requireNodeSqlite() {
  // This indirection keeps browser bundling out of the Vite client graph.
  const module = process.getBuiltinModule?.('node:sqlite')
  if (!module?.DatabaseSync) throw Object.assign(new Error('Server storage is unavailable.'), { statusCode: 503 })
  return module
}

function decodeBase64Url(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
}

function verifiedRoleClaims(payload) {
  const values = []
  for (const value of [payload.roles, payload.workspaceRoles]) {
    if (Array.isArray(value)) values.push(...value)
    else if (typeof value === 'string') values.push(...value.split(','))
  }
  if (typeof payload.role === 'string') values.push(payload.role)
  return [...new Set(values.map((value) => asText(value, 40).toLowerCase()))].filter((value) => ['teacher', 'owner', 'school', 'school_admin', 'school_owner'].includes(value))
}

function identityFromRequest(request, signingKey) {
  const header = String(request.headers.authorization || '')
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token || !signingKey) throw Object.assign(new Error('Sign in with your IELTS-ist account to continue.'), { statusCode: 401 })
  const parts = token.split('.')
  if (parts.length !== 3) throw Object.assign(new Error('Your shared sign-in has expired. Please refresh and try again.'), { statusCode: 401 })
  const [encodedHeader, encodedPayload, signature] = parts
  const expected = crypto.createHmac('sha256', signingKey).update(`${encodedHeader}.${encodedPayload}`).digest('base64url')
  if (expected.length !== signature.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
    throw Object.assign(new Error('Your shared sign-in could not be verified.'), { statusCode: 401 })
  }
  let tokenHeader
  let payload
  try {
    tokenHeader = decodeBase64Url(encodedHeader)
    payload = decodeBase64Url(encodedPayload)
  } catch {
    throw Object.assign(new Error('Your shared sign-in is invalid.'), { statusCode: 401 })
  }
  const now = Math.floor(Date.now() / 1000)
  if (tokenHeader.alg !== 'HS256' || payload.iss !== TOKEN_ISSUER || payload.aud !== TOKEN_AUDIENCE || !/^ielts:\d+$/.test(String(payload.sub || '')) || Number(payload.exp) <= now) {
    throw Object.assign(new Error('Your shared sign-in has expired. Please refresh and try again.'), { statusCode: 401 })
  }
  return { id: payload.sub, username: asText(payload.username, 80), avatarDataUrl: String(payload.avatarDataUrl || '').slice(0, 500_000), roles: verifiedRoleClaims(payload) }
}

function requireVerifiedStaffClaim(user) {
  if (!user.roles.includes('teacher') && !user.roles.includes('owner')) {
    throw Object.assign(new Error('A server-verified teacher or owner claim is required to create a class.'), { statusCode: 403 })
  }
}

function requireSchoolAdminClaim(user) {
  if (!user.roles.includes('school_admin') && !user.roles.includes('school_owner')) {
    throw Object.assign(new Error('A server-verified school administrator claim is required for school analytics and reports.'), { statusCode: 403 })
  }
}

function membership(database, classroomId, userId) {
  return database.prepare('SELECT role FROM class_memberships WHERE classroom_id = ? AND user_id = ?').get(classroomId, userId) || null
}

function requireMembership(database, classroomId, userId, roles) {
  const record = membership(database, classroomId, userId)
  if (!record || !roles.has(record.role)) throw Object.assign(new Error('You do not have permission for this class.'), { statusCode: 403 })
  return record
}

function publicClassroom(row, role) {
  return { id: row.id, name: row.name, inviteCode: role === 'owner' || role === 'teacher' ? row.invite_code : undefined, role, createdAt: row.created_at, archivedAt: row.archived_at || null }
}

function publicAssignment(row) {
  const scope = storedScope(row)
  return {
    id: row.id,
    classroomId: row.classroom_id,
    subjectId: row.subject_id,
    ...scope,
    legacyStage: scope.scopeStatus === LEGACY_SCOPE ? asText(row.stage, 40) || null : undefined,
    syllabusPointId: row.syllabus_point_id,
    title: row.title,
    sourceScope: JSON.parse(row.source_scope_json),
    dueAt: row.due_at || null,
    status: row.status,
    createdAt: row.created_at,
    reminderCount: Number(row.reminder_count) || 0,
  }
}

function publicFeedback(row) {
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    studentUserId: row.student_user_id || null,
    body: row.body,
    createdAt: row.created_at,
  }
}

function assignmentsForWorkspace(database, classes) {
  if (!classes.length) return []
  const classIds = classes.map((item) => item.id)
  const staffClassIds = classes.filter((item) => ['owner', 'teacher', 'school'].includes(item.role)).map((item) => item.id)
  const statusPredicate = staffClassIds.length
    ? `(assignments.status = 'active' OR assignments.classroom_id IN (${staffClassIds.map(() => '?').join(',')}))`
    : "assignments.status = 'active'"
  return database.prepare(`
    SELECT assignments.*, (
      SELECT COUNT(*) FROM assignment_reminders WHERE assignment_id = assignments.id
    ) AS reminder_count
    FROM assignments
    WHERE assignments.classroom_id IN (${classIds.map(() => '?').join(',')}) AND ${statusPredicate}
    ORDER BY assignments.created_at DESC
  `).all(...classIds, ...staffClassIds)
}

function publicSubmission(row, { includeStudentUserId = true } = {}) {
  const payload = JSON.parse(row.payload_json)
  const scope = storedScope(row)
  const result = {
    ...payload,
    id: row.id,
    assignmentId: row.assignment_id,
    eventType: row.event_type,
    occurredAt: row.occurred_at,
    syllabusPointId: row.syllabus_point_id,
    ...scope,
  }
  if (includeStudentUserId) result.studentUserId = row.student_user_id
  return result
}

function scoreStatus(payload) {
  // Assignment completion is authenticated server-side, but browser-calculated
  // marks are untrusted until a server-owned marking workflow verifies them.
  return payload?.scoreStatus === 'verified' ? 'verified' : 'reported'
}

function currentWorkspace(database, user) {
  const classes = database.prepare(`
    SELECT classrooms.*, class_memberships.role
    FROM class_memberships JOIN classrooms ON classrooms.id = class_memberships.classroom_id
    WHERE class_memberships.user_id = ? AND classrooms.archived_at IS NULL
    ORDER BY classrooms.created_at DESC
  `).all(user.id)
  const assignmentRows = assignmentsForWorkspace(database, classes)
  return { identity: user, classrooms: classes.map((item) => publicClassroom(item, item.role)), assignments: assignmentRows.map(publicAssignment) }
}

function timeWindow(url) {
  const from = validDueAt(url.searchParams.get('from'))
  const to = validDueAt(url.searchParams.get('to'))
  if (from && to && from > to) throw Object.assign(new Error('The report start must be before its end.'), { statusCode: 400 })
  return { from, to }
}

function reportFilter(url) {
  const filter = timeWindow(url)
  const requestedRouteId = asText(url.searchParams.get('routeId'), 120)
  const requestedStage = asText(url.searchParams.get('stage'), 40)
  if (!requestedRouteId && !requestedStage) return { ...filter, routeId: null, stage: null }
  if (requestedRouteId) {
    const routeId = canonicalRouteId(requestedRouteId, { allowLegacy: true })
    const stage = requestedStage
      ? canonicalStage(requestedStage, { allowLegacy: true })
      : stageForRoute(routeId)
    if (stageForRoute(routeId) !== stage) throw Object.assign(new Error('routeId and stage filters must match.'), { statusCode: 400 })
    return { ...filter, routeId, stage }
  }
  return { ...filter, routeId: null, stage: canonicalStage(requestedStage, { allowLegacy: true }) }
}

function submissionFilter(column, filter) {
  const conditions = [`${column}.event_type IN ('submitted', 'verified')`]
  const parameters = []
  if (filter?.from) { conditions.push(`${column}.occurred_at >= ?`); parameters.push(filter.from) }
  if (filter?.to) { conditions.push(`${column}.occurred_at <= ?`); parameters.push(filter.to) }
  if (filter?.routeId) { conditions.push(`${column}.route_id = ?`); parameters.push(filter.routeId) }
  if (filter?.stage) {
    conditions.push(`${column}.stage = ?`)
    parameters.push(filter.stage)
    if (filter.stage !== LEGACY_SCOPE) { conditions.push(`${column}.route_id <> ?`); parameters.push(LEGACY_SCOPE) }
  }
  return { sql: conditions.join(' AND '), parameters }
}

function assignmentFilter(column, filter, { activeOnly = false } = {}) {
  const conditions = []
  const parameters = []
  if (activeOnly) conditions.push(`${column}.status = 'active'`)
  if (filter?.routeId) { conditions.push(`${column}.route_id = ?`); parameters.push(filter.routeId) }
  if (filter?.stage === LEGACY_SCOPE && !filter?.routeId) { conditions.push(`${column}.route_id = ?`); parameters.push(LEGACY_SCOPE) }
  else if (filter?.stage && filter.stage !== LEGACY_SCOPE) {
    conditions.push(`${column}.stage = ?`, `${column}.route_id <> ?`)
    parameters.push(filter.stage, LEGACY_SCOPE)
  }
  return { sql: conditions.length ? conditions.join(' AND ') : '1 = 1', parameters }
}

function routeScopesForClass(database, classroomId, filter = {}) {
  const stageCondition = filter.stage && filter.stage !== LEGACY_SCOPE ? 'AND stage = ? AND route_id <> ?' : filter.stage === LEGACY_SCOPE ? 'AND route_id = ?' : ''
  const parameters = filter.stage ? filter.stage === LEGACY_SCOPE ? [LEGACY_SCOPE] : [filter.stage, LEGACY_SCOPE] : []
  return database.prepare(`
    SELECT DISTINCT route_id, CASE WHEN route_id = ? THEN ? ELSE stage END AS stage
    FROM assignments WHERE classroom_id = ? AND status <> 'archived' ${stageCondition}
    ORDER BY route_id, stage
  `).all(LEGACY_SCOPE, LEGACY_SCOPE, classroomId, ...parameters).map(storedScope)
}

function summaryForClass(database, classroomId, filter = {}, { includeRouteGroups = true } = {}) {
  const latestFilter = submissionFilter('submission_events', filter)
  const outerFilter = submissionFilter('events', filter)
  const rows = database.prepare(`
    SELECT events.student_user_id, events.payload_json, events.occurred_at, events.route_id, events.stage,
      assignments.syllabus_point_id, assignments.status
    FROM submission_events AS events
    JOIN assignments ON assignments.id = events.assignment_id
    JOIN (
      SELECT assignment_id, student_user_id, MAX(occurred_at) AS latest_at
      FROM submission_events WHERE ${latestFilter.sql} GROUP BY assignment_id, student_user_id
    ) latest ON latest.assignment_id = events.assignment_id AND latest.student_user_id = events.student_user_id AND latest.latest_at = events.occurred_at
    WHERE assignments.classroom_id = ? AND assignments.status <> 'archived' AND ${outerFilter.sql}
  `).all(...latestFilter.parameters, classroomId, ...outerFilter.parameters)
  const results = rows.map((row) => ({ ...row, payload: JSON.parse(row.payload_json) }))
  const verifiedResults = results.filter((row) => scoreStatus(row.payload) === 'verified')
  const reportedScoreCount = results.length - verifiedResults.length
  const percentages = verifiedResults.map((row) => Number(row.payload.percentage)).filter(Number.isFinite)
  const enrolment = database.prepare(`
    SELECT
      SUM(CASE WHEN role = 'student' THEN 1 ELSE 0 END) AS student_count,
      SUM(CASE WHEN role IN ('owner', 'teacher') THEN 1 ELSE 0 END) AS teacher_count
    FROM class_memberships WHERE classroom_id = ?
  `).get(classroomId)
  const activeFilter = assignmentFilter('assignments', filter, { activeOnly: true })
  const activeAssignments = database.prepare(`SELECT COUNT(*) AS count FROM assignments WHERE classroom_id = ? AND ${activeFilter.sql}`).get(classroomId, ...activeFilter.parameters).count
  const reportableResults = results.filter((row) => !['draft', 'archived'].includes(row.status))
  const activeCutoff = new Date(Date.now() - 28 * 86_400_000).toISOString()
  const coverageBySyllabusPoint = reportableResults.reduce((coverage, row) => {
    const scope = storedScope(row)
    const key = `${scope.routeId}::${row.syllabus_point_id}`
    const item = coverage[key] || { ...scope, topicId: row.syllabus_point_id, submissions: 0, verifiedScoreCount: 0, percentages: [] }
    item.submissions += 1
    const percentage = scoreStatus(row.payload) === 'verified' ? Number(row.payload.percentage) : NaN
    if (Number.isFinite(percentage)) {
      item.percentages.push(percentage)
      item.verifiedScoreCount += 1
    }
    coverage[key] = item
    return coverage
  }, {})
  const publicCoverage = Object.fromEntries(Object.entries(coverageBySyllabusPoint).map(([key, item]) => [key, {
    routeId: item.routeId,
    stage: item.stage,
    scopeStatus: item.scopeStatus,
    topicId: item.topicId,
    submissions: item.submissions,
    totalSubmissionCount: item.submissions,
    verifiedScoreCount: item.verifiedScoreCount,
    averagePercentage: item.percentages.length ? Math.round(item.percentages.reduce((total, value) => total + value, 0) / item.percentages.length) : null,
  }]))
  const studentCount = Number(enrolment.student_count) || 0
  const expectedCompletions = activeAssignments * studentCount
  const completionRate = expectedCompletions ? Math.round((reportableResults.filter((row) => row.status === 'active').length / expectedCompletions) * 100) : null
  const riskReasons = []
  if (studentCount && new Set(results.filter((row) => row.occurred_at >= activeCutoff).map((row) => row.student_user_id)).size / studentCount < 0.6) riskReasons.push('Low recent participation')
  if (completionRate != null && completionRate < 60) riskReasons.push('Low assignment completion')
  if (percentages.length && percentages.reduce((total, value) => total + value, 0) / percentages.length < 60) riskReasons.push('Low verified accuracy')
  if (reportedScoreCount) riskReasons.push('Scores await verified marking')
  if (!reportableResults.length && activeAssignments) riskReasons.push('No submitted evidence')
  const summary = {
    filter: { routeId: filter.routeId || null, stage: filter.stage || null },
    aggregationMode: filter.routeId || filter.stage ? 'single-scope' : 'cross-route-overview',
    submissions: results.length,
    totalSubmissionCount: results.length,
    verifiedScoreCount: verifiedResults.length,
    reportedScoreCount,
    averagePercentage: percentages.length ? Math.round(percentages.reduce((total, value) => total + value, 0) / percentages.length) : null,
    needsSupport: percentages.filter((value) => value < 60).length,
    studentCount,
    teacherCount: Number(enrolment.teacher_count) || 0,
    activeStudentCount: new Set(results.filter((row) => row.occurred_at >= activeCutoff).map((row) => row.student_user_id)).size,
    activeAssignments,
    completedActiveAssignments: reportableResults.filter((row) => row.status === 'active').length,
    expectedCompletions,
    assignmentCompletionRate: completionRate,
    coverageBySyllabusPoint: publicCoverage,
    riskReasons,
  }
  if (includeRouteGroups && !filter.routeId) {
    summary.routeGroups = routeScopesForClass(database, classroomId, filter).map((scope) => ({
      ...scope,
      summary: summaryForClass(database, classroomId, { ...filter, routeId: scope.routeId, stage: scope.stage }, { includeRouteGroups: false }),
    }))
    summary.legacyUnscoped = summary.routeGroups.find((item) => item.routeId === LEGACY_SCOPE)?.summary || null
  }
  return summary
}

function accessibleStaffClasses(database, userId) {
  return database.prepare(`
    SELECT classrooms.*, class_memberships.role
    FROM class_memberships JOIN classrooms ON classrooms.id = class_memberships.classroom_id
    WHERE class_memberships.user_id = ?
      AND classrooms.archived_at IS NULL
      AND class_memberships.role IN ('owner', 'teacher', 'school')
    ORDER BY classrooms.created_at DESC
  `).all(userId)
}

function schoolAnalytics(database, user, filter) {
  const classes = accessibleStaffClasses(database, user.id)
  const cohorts = classes.map((classroom) => ({
    classroomId: classroom.id,
    name: classroom.name,
    summary: summaryForClass(database, classroom.id, filter),
  }))
  const coverage = {}
  const groupedRoutes = {}
  const risks = new Map()
  for (const cohort of cohorts) {
    for (const item of Object.values(cohort.summary.coverageBySyllabusPoint)) {
      const key = `${item.routeId}::${item.topicId}`
      const current = coverage[key] || { routeId: item.routeId, stage: item.stage, scopeStatus: item.scopeStatus, topicId: item.topicId, totalSubmissionCount: 0, weightedScore: 0, verifiedScoreCount: 0 }
      current.totalSubmissionCount += item.totalSubmissionCount ?? item.submissions
      if (Number.isFinite(item.averagePercentage)) {
        current.weightedScore += item.averagePercentage * item.verifiedScoreCount
        current.verifiedScoreCount += item.verifiedScoreCount
      }
      coverage[key] = current
    }
    const cohortGroups = cohort.summary.routeGroups || [{
      routeId: filter.routeId || LEGACY_SCOPE,
      stage: filter.stage || LEGACY_SCOPE,
      scopeStatus: filter.routeId === LEGACY_SCOPE ? LEGACY_SCOPE : 'scoped',
      summary: cohort.summary,
    }]
    for (const group of cohortGroups) {
      const key = `${group.routeId}::${group.stage}`
      const current = groupedRoutes[key] || { routeId: group.routeId, stage: group.stage, scopeStatus: group.scopeStatus, totalSubmissionCount: 0, verifiedScoreCount: 0, weightedScore: 0, activeAssignments: 0, needsSupport: 0, cohorts: 0 }
      current.totalSubmissionCount += group.summary.totalSubmissionCount ?? group.summary.submissions
      current.verifiedScoreCount += group.summary.verifiedScoreCount
      current.activeAssignments += group.summary.activeAssignments
      current.needsSupport += group.summary.needsSupport
      current.cohorts += 1
      if (Number.isFinite(group.summary.averagePercentage)) current.weightedScore += group.summary.averagePercentage * group.summary.verifiedScoreCount
      groupedRoutes[key] = current
    }
    for (const reason of cohort.summary.riskReasons) risks.set(reason, (risks.get(reason) || 0) + 1)
  }
  const topics = Object.values(coverage).map((item) => ({
    routeId: item.routeId,
    stage: item.stage,
    scopeStatus: item.scopeStatus,
    topicId: item.topicId,
    submissions: item.totalSubmissionCount,
    totalSubmissionCount: item.totalSubmissionCount,
    verifiedScoreCount: item.verifiedScoreCount,
    averagePercentage: item.verifiedScoreCount ? Math.round(item.weightedScore / item.verifiedScoreCount) : null,
  })).sort((left, right) => (left.averagePercentage ?? 101) - (right.averagePercentage ?? 101))
  return {
    generatedAt: nowIso(),
    window: { from: filter.from, to: filter.to },
    filter: { routeId: filter.routeId || null, stage: filter.stage || null },
    aggregationMode: filter.routeId || filter.stage ? 'single-scope' : 'grouped-by-route',
    cohortCount: cohorts.length,
    cohorts,
    routeGroups: Object.values(groupedRoutes).map((item) => ({
      routeId: item.routeId,
      stage: item.stage,
      scopeStatus: item.scopeStatus,
      submissions: item.totalSubmissionCount,
      totalSubmissionCount: item.totalSubmissionCount,
      verifiedScoreCount: item.verifiedScoreCount,
      averagePercentage: item.verifiedScoreCount ? Math.round(item.weightedScore / item.verifiedScoreCount) : null,
      activeAssignments: item.activeAssignments,
      needsSupport: item.needsSupport,
      cohortCount: item.cohorts,
    })).sort((left, right) => left.routeId.localeCompare(right.routeId)),
    topicCoverage: topics,
    riskReasons: [...risks.entries()].map(([reason, cohortsAffected]) => ({ reason, cohortsAffected })).sort((left, right) => right.cohortsAffected - left.cohortsAffected),
    privacy: 'Aggregate only. This report excludes student notes, handwriting, drafts and AI Coach conversations.',
  }
}

function validDueAt(value) {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function eventPayload(value) {
  const rawMarks = Number(value?.rawMarks)
  const maxMarks = Number(value?.maxMarks)
  const percentage = Number(value?.percentage)
  if (![rawMarks, maxMarks, percentage].every(Number.isFinite) || rawMarks < 0 || maxMarks <= 0 || rawMarks > maxMarks || percentage < 0 || percentage > 100) {
    throw Object.assign(new Error('Submission requires valid mark totals and percentage.'), { statusCode: 400 })
  }
  const calculatedPercentage = Math.round((rawMarks / maxMarks) * 100)
  if (percentage !== calculatedPercentage) {
    throw Object.assign(new Error('Submission percentage must match rawMarks and maxMarks.'), { statusCode: 400 })
  }
  const requestedMarkingMode = asText(value.markingMode || 'student-reported', 40)
  const supportedMarkingModes = new Set(['deterministic', 'assisted', 'assisted-vision', 'student-self-mark', 'student-reported', 'teacher-reviewed'])
  return {
    rawMarks,
    maxMarks,
    percentage: calculatedPercentage,
    elapsedSeconds: Math.max(0, Math.min(Number(value.elapsedSeconds) || 0, 86_400)),
    markingMode: supportedMarkingModes.has(requestedMarkingMode) ? requestedMarkingMode : 'student-reported',
    scoreStatus: 'reported',
    reviewRequired: Boolean(value.reviewRequired),
    attemptId: asText(value.attemptId, 100),
  }
}

export function createStemApi({ env, questionBank = unifiedQuestionBank }) {
  const signingKey = String(env.STEM_IDENTITY_SIGNING_KEY || '')
  const markingCapabilitySigningKey = String(env.STEM_MARKING_CAPABILITY_SIGNING_KEY || signingKey)
  const identityOrigin = String(env.IELTSIST_ORIGIN || 'https://ieltsist.com').replace(/\/$/, '')
  const stemOrigin = String(env.STEM_ORIGIN || 'https://stem.ieltsist.com').replace(/\/$/, '')
  // Production uses unifiedQuestionBank, which fails closed on file and
  // semantic source completeness. Supplying a fixture is test-only.
  const assignableQuestionIds = assignableQuestionIdsForBank(questionBank)
  return async function stemApi(request, response, next) {
    const url = new URL(request.url, 'http://127.0.0.1')
    if (!url.pathname.startsWith('/api/stem/') && !['/api/auth/status', '/api/auth/config'].includes(url.pathname)) return next()
    try {
      if (request.method === 'GET' && url.pathname === '/api/auth/config') {
        sendJson(response, 200, {
          protocol: 'stem-sso-v1',
          provider: 'ieltsist',
          providerOrigin: identityOrigin,
          clientOrigin: stemOrigin,
          browserFlow: {
            login: `${identityOrigin}/?from=stem&auth=login&returnTo=${encodeURIComponent(stemOrigin) }#mine`,
            register: `${identityOrigin}/?from=stem&auth=register&returnTo=${encodeURIComponent(stemOrigin) }#mine`,
            logout: `${identityOrigin}/?from=stem&auth=logout&returnTo=${encodeURIComponent(stemOrigin) }#mine`,
          },
          endpoints: {
            login: `${identityOrigin}/api/auth/login`,
            register: `${identityOrigin}/api/auth/register`,
            logout: `${identityOrigin}/api/auth/logout`,
            currentUser: `${identityOrigin}/api/me`,
            identityExchange: `${identityOrigin}/api/stem/identity`,
          },
          session: {
            browserCookie: 'ieltsist_session',
            cookieOwner: 'ieltsist.com',
            exchange: 'short-lived-hmac-jwt',
            tokenStorage: 'memory-only',
          },
          responses: {
            loginSuccess: 200,
            registerSuccess: 200,
            invalidCredentials: 401,
            duplicateIdentifier: 409,
            validationError: 400,
            logoutSuccess: 200,
          },
          note: 'STEM never accepts or stores the IELTSist password. The provider owns account creation and browser logout.',
        })
        return
      }
      const user = identityFromRequest(request, signingKey)
      const db = appDatabase(env)
      if (request.method === 'GET' && url.pathname === '/api/auth/status') {
        sendJson(response, 200, { authenticated: true, ...currentWorkspace(db, user) })
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/stem/workspace') {
        sendJson(response, 200, currentWorkspace(db, user))
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/stem/marking/capabilities') {
        const payload = await readJson(request)
        const issued = issueMarkingCapabilities({
          userId: user.id,
          payload,
          questionBank,
          signingKey: markingCapabilitySigningKey,
        })
        if (!issued.ok) throw Object.assign(new Error(issued.message), { statusCode: issued.statusCode || 422, code: issued.code })
        sendJson(response, 201, issued)
        return
      }
      if (url.pathname === '/api/stem/notebook/notes' && request.method === 'GET') {
        const routeId = canonicalRouteId(url.searchParams.get('routeId'))
        const note = db.prepare('SELECT route_id, body, updated_at, deleted_at FROM private_notes WHERE user_id = ? AND route_id = ?').get(user.id, routeId)
        sendJson(response, 200, {
          routeId,
          note: note ? {
            routeId: note.route_id,
            body: note.deleted_at ? '' : note.body,
            updatedAt: note.updated_at,
            deleted: Boolean(note.deleted_at),
            deletedAt: note.deleted_at || null,
          } : null,
          privacy: 'private-to-student',
        })
        return
      }
      const privateNoteMatch = url.pathname.match(/^\/api\/stem\/notebook\/notes\/([^/]+)$/)
      if (privateNoteMatch && ['PUT', 'DELETE'].includes(request.method)) {
        const routeId = canonicalRouteId(decodeURIComponent(privateNoteMatch[1]))
        if (request.method === 'DELETE') {
          const deletedAt = nowIso()
          db.prepare(`INSERT INTO private_notes (user_id, route_id, body, updated_at, deleted_at) VALUES (?, ?, '', ?, ?)
            ON CONFLICT(user_id, route_id) DO UPDATE SET body = '', updated_at = excluded.updated_at, deleted_at = excluded.deleted_at`)
            .run(user.id, routeId, deletedAt, deletedAt)
          sendJson(response, 200, { routeId, note: { routeId, body: '', updatedAt: deletedAt, deleted: true, deletedAt }, privacy: 'private-to-student' })
          return
        }
        const payload = await readJson(request)
        const body = asText(payload.body, 20_000)
        const updatedAt = nowIso()
        const deletedAt = body ? null : updatedAt
        db.prepare(`INSERT INTO private_notes (user_id, route_id, body, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(user_id, route_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at`).run(user.id, routeId, body, updatedAt, deletedAt)
        sendJson(response, 200, { routeId, note: { routeId, body, updatedAt, deleted: Boolean(deletedAt), deletedAt }, privacy: 'private-to-student' })
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/stem/classrooms') {
        requireVerifiedStaffClaim(user)
        const payload = await readJson(request)
        const name = asText(payload.name, 120)
        if (!name) throw Object.assign(new Error('A class needs a name.'), { statusCode: 400 })
        const id = crypto.randomUUID()
        const createdAt = nowIso()
        const inviteCode = crypto.randomBytes(6).toString('base64url')
        db.prepare('INSERT INTO classrooms (id, owner_user_id, name, invite_code, created_at) VALUES (?, ?, ?, ?, ?)').run(id, user.id, name, inviteCode, createdAt)
        db.prepare('INSERT INTO class_memberships (classroom_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(id, user.id, 'owner', createdAt)
        sendJson(response, 201, { classroom: { id, name, inviteCode, role: 'owner', createdAt, archivedAt: null } })
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/stem/classrooms/join') {
        const payload = await readJson(request)
        const inviteCode = asText(payload.inviteCode, 64)
        const classroom = db.prepare('SELECT * FROM classrooms WHERE invite_code = ? AND archived_at IS NULL').get(inviteCode)
        if (!classroom) throw Object.assign(new Error('That class code is invalid or archived.'), { statusCode: 404 })
        const role = user.roles.includes('school') || user.roles.includes('school_admin') || user.roles.includes('school_owner')
          ? 'school'
          : user.roles.includes('teacher') || user.roles.includes('owner') ? 'teacher' : 'student'
        db.prepare('INSERT INTO class_memberships (classroom_id, user_id, role, joined_at) VALUES (?, ?, ?, ?) ON CONFLICT(classroom_id, user_id) DO NOTHING').run(classroom.id, user.id, role, nowIso())
        sendJson(response, 200, { classroom: publicClassroom(classroom, membership(db, classroom.id, user.id).role) })
        return
      }
      const classroomMatch = url.pathname.match(/^\/api\/stem\/classrooms\/([^/]+)\/summary$/)
      if (request.method === 'GET' && classroomMatch) {
        const classroomId = decodeURIComponent(classroomMatch[1])
        requireMembership(db, classroomId, user.id, new Set(['owner', 'teacher', 'school']))
        const filter = reportFilter(url)
        sendJson(response, 200, { classroomId, summary: summaryForClass(db, classroomId, filter), filter })
        return
      }
      const submissionsMatch = url.pathname.match(/^\/api\/stem\/classrooms\/([^/]+)\/submissions$/)
      if (request.method === 'GET' && submissionsMatch) {
        const classroomId = decodeURIComponent(submissionsMatch[1])
        requireMembership(db, classroomId, user.id, new Set(['owner', 'teacher']))
        const rows = db.prepare(`
          SELECT events.*, assignments.syllabus_point_id
          FROM submission_events AS events
          JOIN assignments ON assignments.id = events.assignment_id
          JOIN (
            SELECT assignment_id, student_user_id, MAX(occurred_at) AS latest_at
            FROM submission_events
            WHERE event_type IN ('submitted', 'verified')
            GROUP BY assignment_id, student_user_id
          ) AS latest ON latest.assignment_id = events.assignment_id
            AND latest.student_user_id = events.student_user_id
            AND latest.latest_at = events.occurred_at
          WHERE assignments.classroom_id = ? AND events.event_type IN ('submitted', 'verified')
          ORDER BY events.occurred_at DESC
          LIMIT 500
        `).all(classroomId)
        sendJson(response, 200, { classroomId, submissions: rows.map((row) => publicSubmission(row)) })
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/stem/assignments') {
        const payload = await readJson(request)
        const classroomId = asText(payload.classroomId, 80)
        requireMembership(db, classroomId, user.id, new Set(['owner', 'teacher']))
        const title = asText(payload.title, 160)
        const { routeId, stage, subjectId } = verifiedAssignmentScope(payload.routeId, payload.stage, payload.subjectId)
        const syllabusPointId = asText(payload.syllabusPointId, 120)
        const sourceScope = payload.sourceScope && typeof payload.sourceScope === 'object' ? payload.sourceScope : null
        if (!title || !subjectId || !syllabusPointId || !sourceScope?.questionIds?.length) throw Object.assign(new Error('Assignment details and verified source question IDs are required.'), { statusCode: 400 })
        if (!sourceScope.routeId || !sourceScope.stage) throw Object.assign(new Error('sourceScope must include routeId and stage.'), { statusCode: 400 })
        const sourceRoute = verifiedRouteScope(sourceScope.routeId, sourceScope.stage)
        if (sourceRoute.routeId !== routeId || sourceRoute.stage !== stage) throw Object.assign(new Error('Assignment questions must use the assignment routeId and stage.'), { statusCode: 400 })
        const questionIds = routeScopedQuestionIds(sourceScope.questionIds, routeId, assignableQuestionIds)
        const id = crypto.randomUUID()
        const createdAt = nowIso()
        const status = payload.status === 'draft' ? 'draft' : 'active'
        db.prepare(`INSERT INTO assignments (id, classroom_id, created_by_user_id, subject_id, stage, route_id, syllabus_point_id, title, source_scope_json, due_at, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, classroomId, user.id, subjectId, stage, routeId, syllabusPointId, title, JSON.stringify({ questionIds, routeId, stage, provenanceVersion: asText(sourceScope.provenanceVersion, 40) || 'v1' }), validDueAt(payload.dueAt), status, createdAt)
        sendJson(response, 201, { assignment: publicAssignment(db.prepare('SELECT * FROM assignments WHERE id = ?').get(id)) })
        return
      }
      const assignmentMatch = url.pathname.match(/^\/api\/stem\/assignments\/([^/]+)$/)
      if (request.method === 'PATCH' && assignmentMatch) {
        const assignmentId = decodeURIComponent(assignmentMatch[1])
        const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(assignmentId)
        if (!assignment) throw Object.assign(new Error('This assignment no longer exists.'), { statusCode: 404 })
        requireMembership(db, assignment.classroom_id, user.id, new Set(['owner', 'teacher']))
        const payload = await readJson(request)
        const nextStatus = asText(payload.status, 20)
        const allowedStatuses = new Set(['draft', 'active', 'closed', 'archived'])
        if (nextStatus && !allowedStatuses.has(nextStatus)) throw Object.assign(new Error('That assignment status is not recognised.'), { statusCode: 400 })
        if (assignment.status === 'archived' && nextStatus && nextStatus !== 'archived') throw Object.assign(new Error('Archived assignments cannot be reopened.'), { statusCode: 409 })
        const nextTitle = Object.hasOwn(payload, 'title') ? asText(payload.title, 160) : assignment.title
        if (!nextTitle) throw Object.assign(new Error('An assignment needs a title.'), { statusCode: 400 })
        const dueAt = Object.hasOwn(payload, 'dueAt') ? validDueAt(payload.dueAt) : assignment.due_at
        db.prepare('UPDATE assignments SET title = ?, due_at = ?, status = ? WHERE id = ?').run(nextTitle, dueAt, nextStatus || assignment.status, assignment.id)
        sendJson(response, 200, { assignment: publicAssignment(db.prepare('SELECT * FROM assignments WHERE id = ?').get(assignment.id)) })
        return
      }
      const reminderMatch = url.pathname.match(/^\/api\/stem\/assignments\/([^/]+)\/reminders$/)
      if (request.method === 'POST' && reminderMatch) {
        const assignmentId = decodeURIComponent(reminderMatch[1])
        const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(assignmentId)
        if (!assignment) throw Object.assign(new Error('This assignment no longer exists.'), { statusCode: 404 })
        requireMembership(db, assignment.classroom_id, user.id, new Set(['owner', 'teacher']))
        if (assignment.status !== 'active') throw Object.assign(new Error('Only published assignments can be reminded.'), { statusCode: 409 })
        const payload = await readJson(request)
        const message = asText(payload.message || 'A teacher has asked you to complete this assignment.', 280)
        const audience = payload.audience === 'incomplete' ? 'incomplete' : 'class'
        const id = crypto.randomUUID()
        const createdAt = nowIso()
        db.prepare('INSERT INTO assignment_reminders (id, assignment_id, created_by_user_id, message, audience, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, assignment.id, user.id, message, audience, createdAt)
        const enrolled = db.prepare("SELECT COUNT(*) AS count FROM class_memberships WHERE classroom_id = ? AND role = 'student'").get(assignment.classroom_id).count
        sendJson(response, 201, { reminder: { id, assignmentId: assignment.id, audience, message, createdAt, audienceCount: Number(enrolled) || 0 }, delivery: 'recorded' })
        return
      }
      const feedbackMatch = url.pathname.match(/^\/api\/stem\/assignments\/([^/]+)\/feedback$/)
      if (feedbackMatch) {
        const assignmentId = decodeURIComponent(feedbackMatch[1])
        const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(assignmentId)
        if (!assignment) throw Object.assign(new Error('This assignment no longer exists.'), { statusCode: 404 })
        const role = membership(db, assignment.classroom_id, user.id)?.role
        if (!role) throw Object.assign(new Error('You do not have permission for this class.'), { statusCode: 403 })
        if (request.method === 'GET') {
          const rows = ['owner', 'teacher'].includes(role)
            ? db.prepare('SELECT * FROM assignment_feedback WHERE assignment_id = ? ORDER BY created_at DESC').all(assignment.id)
            : db.prepare('SELECT * FROM assignment_feedback WHERE assignment_id = ? AND (student_user_id IS NULL OR student_user_id = ?) ORDER BY created_at DESC').all(assignment.id, user.id)
          sendJson(response, 200, { assignmentId: assignment.id, feedback: rows.map(publicFeedback) })
          return
        }
        if (request.method === 'POST') {
          if (!['owner', 'teacher'].includes(role)) throw Object.assign(new Error('Only a teacher can send assignment feedback.'), { statusCode: 403 })
          const payload = await readJson(request)
          const body = asText(payload.body, 1000)
          if (!body) throw Object.assign(new Error('Feedback cannot be empty.'), { statusCode: 400 })
          const studentUserId = asText(payload.studentUserId, 100)
          if (studentUserId) requireMembership(db, assignment.classroom_id, studentUserId, new Set(['student']))
          const id = crypto.randomUUID()
          const createdAt = nowIso()
          db.prepare('INSERT INTO assignment_feedback (id, assignment_id, student_user_id, author_user_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, assignment.id, studentUserId || null, user.id, body, createdAt)
          sendJson(response, 201, { feedback: publicFeedback(db.prepare('SELECT * FROM assignment_feedback WHERE id = ?').get(id)) })
          return
        }
      }
      if (request.method === 'GET' && url.pathname === '/api/stem/school/analytics') {
        requireSchoolAdminClaim(user)
        const classes = accessibleStaffClasses(db, user.id)
        if (!classes.length) throw Object.assign(new Error('No school classes are available for this account.'), { statusCode: 403 })
        sendJson(response, 200, { analytics: schoolAnalytics(db, user, reportFilter(url)) })
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/stem/school/reports/anonymous') {
        requireSchoolAdminClaim(user)
        const classes = accessibleStaffClasses(db, user.id)
        if (!classes.length) throw Object.assign(new Error('No school classes are available for this account.'), { statusCode: 403 })
        const analytics = schoolAnalytics(db, user, reportFilter(url))
        const minimumCohortSize = 5
        const eligibleCohorts = analytics.cohorts.filter((cohort) => Number(cohort.summary.studentCount) >= minimumCohortSize)
        const suppressedCohorts = analytics.cohorts.length - eligibleCohorts.length
        const report = {
          generatedAt: analytics.generatedAt,
          window: analytics.window,
          filter: analytics.filter,
          aggregationMode: analytics.aggregationMode,
          cohorts: eligibleCohorts.map((cohort, index) => ({ cohort: `Cohort ${index + 1}`, summary: cohort.summary })),
          routeGroups: suppressedCohorts ? [] : analytics.routeGroups,
          topicCoverage: suppressedCohorts ? [] : analytics.topicCoverage,
          riskReasons: suppressedCohorts ? [] : analytics.riskReasons,
          suppressedCohorts,
          minimumCohortSize,
          privacy: `${analytics.privacy} Cohorts with fewer than ${minimumCohortSize} students are suppressed in anonymous reports.`,
        }
        sendJson(response, 200, { report })
        return
      }
      const verificationMatch = url.pathname.match(/^\/api\/stem\/submissions\/([^/]+)\/verify$/)
      if (request.method === 'POST' && verificationMatch) {
        const sourceEventId = decodeURIComponent(verificationMatch[1])
        const source = db.prepare(`
          SELECT events.*, assignments.classroom_id, assignments.syllabus_point_id
          FROM submission_events AS events
          JOIN assignments ON assignments.id = events.assignment_id
          WHERE events.id = ? AND events.event_type IN ('submitted', 'verified')
        `).get(sourceEventId)
        if (!source) throw Object.assign(new Error('This submitted result is not available.'), { statusCode: 404 })
        requireMembership(db, source.classroom_id, user.id, new Set(['owner', 'teacher']))
        const idempotencyKey = `verify:${sourceEventId}`
        const existing = db.prepare(`
          SELECT events.*, assignments.syllabus_point_id
          FROM submission_events AS events
          JOIN assignments ON assignments.id = events.assignment_id
          WHERE events.assignment_id = ? AND events.student_user_id = ? AND events.idempotency_key = ?
        `).get(source.assignment_id, source.student_user_id, idempotencyKey)
        if (existing) {
          sendJson(response, 200, { submission: publicSubmission(existing), duplicate: true })
          return
        }
        const latest = db.prepare(`
          SELECT id FROM submission_events
          WHERE assignment_id = ? AND student_user_id = ? AND event_type IN ('submitted', 'verified')
          ORDER BY occurred_at DESC LIMIT 1
        `).get(source.assignment_id, source.student_user_id)
        if (latest?.id !== source.id) throw Object.assign(new Error('A newer student result must be reviewed instead.'), { statusCode: 409 })
        const sourcePayload = JSON.parse(source.payload_json)
        if (scoreStatus(sourcePayload) === 'verified') {
          sendJson(response, 200, { submission: publicSubmission(source), duplicate: true })
          return
        }
        const review = await readJson(request)
        const rawMarks = review.rawMarks == null ? sourcePayload.rawMarks : Number(review.rawMarks)
        const maxMarks = review.maxMarks == null ? sourcePayload.maxMarks : Number(review.maxMarks)
        const percentage = maxMarks > 0 ? Math.round((rawMarks / maxMarks) * 100) : NaN
        const verifiedAt = nowIso()
        const verifiedPayload = {
          ...eventPayload({ ...sourcePayload, rawMarks, maxMarks, percentage, markingMode: 'teacher-reviewed', reviewRequired: false }),
          scoreStatus: 'verified',
          reviewRequired: false,
          verifiedAt,
          verifiedByUserId: user.id,
          verifiedFromEventId: source.id,
          reviewerNote: asText(review.reviewerNote, 500),
        }
        const eventId = crypto.randomUUID()
        db.prepare('INSERT INTO submission_events (id, assignment_id, student_user_id, idempotency_key, event_type, route_id, stage, payload_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(eventId, source.assignment_id, source.student_user_id, idempotencyKey, 'verified', source.route_id, source.stage, JSON.stringify(verifiedPayload), verifiedAt)
        const created = db.prepare(`
          SELECT events.*, assignments.syllabus_point_id
          FROM submission_events AS events
          JOIN assignments ON assignments.id = events.assignment_id
          WHERE events.id = ?
        `).get(eventId)
        sendJson(response, 201, { submission: publicSubmission(created), duplicate: false })
        return
      }
      const submissionMatch = url.pathname.match(/^\/api\/stem\/assignments\/([^/]+)\/submissions$/)
      if (request.method === 'POST' && submissionMatch) {
        const assignmentId = decodeURIComponent(submissionMatch[1])
        const assignment = db.prepare('SELECT * FROM assignments WHERE id = ? AND status = \'active\'').get(assignmentId)
        if (!assignment) throw Object.assign(new Error('This assignment is not available.'), { statusCode: 404 })
        requireMembership(db, assignment.classroom_id, user.id, new Set(['student']))
        const payload = await readJson(request)
        const idempotencyKey = asText(payload.idempotencyKey, 100)
        if (!idempotencyKey) throw Object.assign(new Error('Submission needs an idempotency key.'), { statusCode: 400 })
        const assignmentScope = storedScope(assignment)
        if (assignmentScope.scopeStatus === LEGACY_SCOPE) throw Object.assign(new Error('Legacy unscoped assignments cannot accept new submissions.'), { statusCode: 409 })
        if (payload.routeId || payload.stage) {
          const submittedScope = verifiedRouteScope(payload.routeId, payload.stage)
          if (submittedScope.routeId !== assignmentScope.routeId || submittedScope.stage !== assignmentScope.stage) {
            throw Object.assign(new Error('Submission routeId and stage must match the assignment.'), { statusCode: 400 })
          }
        }
        const existing = db.prepare('SELECT id, occurred_at, route_id, stage FROM submission_events WHERE assignment_id = ? AND student_user_id = ? AND idempotency_key = ?').get(assignment.id, user.id, idempotencyKey)
        if (existing) {
          sendJson(response, 200, { eventId: existing.id, occurredAt: existing.occurred_at, duplicate: true, ...storedScope(existing) })
          return
        }
        const eventId = crypto.randomUUID()
        const occurredAt = nowIso()
        db.prepare('INSERT INTO submission_events (id, assignment_id, student_user_id, idempotency_key, event_type, route_id, stage, payload_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(eventId, assignmentId, user.id, idempotencyKey, 'submitted', assignmentScope.routeId, assignmentScope.stage, JSON.stringify(eventPayload(payload)), occurredAt)
        sendJson(response, 201, { eventId, occurredAt, duplicate: false, ...assignmentScope })
        return
      }
      sendJson(response, 404, { error: 'STEM workspace endpoint not found.' })
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        ...(error.code ? { code: error.code } : {}),
        error: error.statusCode ? error.message : 'STEM workspace could not complete that request.',
      })
    }
  }
}

export function closeStemDatabaseForTests() {
  database?.close()
  database = null
}
