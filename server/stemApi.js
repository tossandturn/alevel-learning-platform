import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const MAX_BODY_BYTES = 2 * 1024 * 1024
const TOKEN_AUDIENCE = 'stem.ieltsist.com'
const TOKEN_ISSUER = 'ieltsist.com'
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

function nowIso() {
  return new Date().toISOString()
}

function appDatabase(env) {
  if (database) return database
  if (!globalThis.process?.versions?.node) throw new Error('STEM storage requires Node.js.')
  // node:sqlite is available in the Node 22 runtime used by the deployment.
  const { DatabaseSync } = requireNodeSqlite()
  const databasePath = path.resolve(env.STEM_DB_PATH || path.join(process.cwd(), 'data', 'stem.sqlite'))
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
      payload_json TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      UNIQUE (student_user_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS idx_submission_events_assignment ON submission_events(assignment_id, student_user_id, occurred_at DESC);
  `)
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
  return [...new Set(values.map((value) => asText(value, 40).toLowerCase()))].filter((value) => ['teacher', 'owner', 'school', 'school_admin'].includes(value))
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
  return {
    id: row.id,
    classroomId: row.classroom_id,
    subjectId: row.subject_id,
    stage: row.stage,
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
  const result = {
    id: row.id,
    assignmentId: row.assignment_id,
    eventType: row.event_type,
    occurredAt: row.occurred_at,
    syllabusPointId: row.syllabus_point_id,
    ...payload,
  }
  if (includeStudentUserId) result.studentUserId = row.student_user_id
  return result
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

function submissionFilter(column, window) {
  const conditions = [`${column}.event_type = 'submitted'`]
  const parameters = []
  if (window?.from) { conditions.push(`${column}.occurred_at >= ?`); parameters.push(window.from) }
  if (window?.to) { conditions.push(`${column}.occurred_at <= ?`); parameters.push(window.to) }
  return { sql: conditions.join(' AND '), parameters }
}

function summaryForClass(database, classroomId, window = {}) {
  const latestFilter = submissionFilter('submission_events', window)
  const outerFilter = submissionFilter('events', window)
  const rows = database.prepare(`
    SELECT events.student_user_id, events.payload_json, events.occurred_at, assignments.syllabus_point_id, assignments.status
    FROM submission_events AS events
    JOIN assignments ON assignments.id = events.assignment_id
    JOIN (
      SELECT assignment_id, student_user_id, MAX(occurred_at) AS latest_at
      FROM submission_events WHERE ${latestFilter.sql} GROUP BY assignment_id, student_user_id
    ) latest ON latest.assignment_id = events.assignment_id AND latest.student_user_id = events.student_user_id AND latest.latest_at = events.occurred_at
    WHERE assignments.classroom_id = ? AND ${outerFilter.sql}
  `).all(...latestFilter.parameters, classroomId, ...outerFilter.parameters)
  const results = rows.map((row) => ({ ...row, payload: JSON.parse(row.payload_json) }))
  const percentages = results.map((row) => Number(row.payload.percentage)).filter(Number.isFinite)
  const enrolment = database.prepare(`
    SELECT
      SUM(CASE WHEN role = 'student' THEN 1 ELSE 0 END) AS student_count,
      SUM(CASE WHEN role IN ('owner', 'teacher') THEN 1 ELSE 0 END) AS teacher_count
    FROM class_memberships WHERE classroom_id = ?
  `).get(classroomId)
  const activeAssignments = database.prepare("SELECT COUNT(*) AS count FROM assignments WHERE classroom_id = ? AND status = 'active'").get(classroomId).count
  const reportableResults = results.filter((row) => !['draft', 'archived'].includes(row.status))
  const activeCutoff = new Date(Date.now() - 28 * 86_400_000).toISOString()
  const coverageBySyllabusPoint = reportableResults.reduce((coverage, row) => {
    const item = coverage[row.syllabus_point_id] || { submissions: 0, percentages: [] }
    item.submissions += 1
    const percentage = Number(row.payload.percentage)
    if (Number.isFinite(percentage)) item.percentages.push(percentage)
    coverage[row.syllabus_point_id] = item
    return coverage
  }, {})
  const publicCoverage = Object.fromEntries(Object.entries(coverageBySyllabusPoint).map(([topicId, item]) => [topicId, {
    submissions: item.submissions,
    averagePercentage: item.percentages.length ? Math.round(item.percentages.reduce((total, value) => total + value, 0) / item.percentages.length) : null,
  }]))
  const studentCount = Number(enrolment.student_count) || 0
  const expectedCompletions = activeAssignments * studentCount
  const completionRate = expectedCompletions ? Math.round((reportableResults.filter((row) => row.status === 'active').length / expectedCompletions) * 100) : null
  const riskReasons = []
  if (studentCount && new Set(results.filter((row) => row.occurred_at >= activeCutoff).map((row) => row.student_user_id)).size / studentCount < 0.6) riskReasons.push('Low recent participation')
  if (completionRate != null && completionRate < 60) riskReasons.push('Low assignment completion')
  if (percentages.length && percentages.reduce((total, value) => total + value, 0) / percentages.length < 60) riskReasons.push('Low submitted accuracy')
  if (!reportableResults.length && activeAssignments) riskReasons.push('No submitted evidence')
  return {
    submissions: results.length,
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

function schoolAnalytics(database, user, window) {
  const classes = accessibleStaffClasses(database, user.id)
  const cohorts = classes.map((classroom) => ({
    classroomId: classroom.id,
    name: classroom.name,
    summary: summaryForClass(database, classroom.id, window),
  }))
  const coverage = {}
  const risks = new Map()
  for (const cohort of cohorts) {
    for (const [topicId, item] of Object.entries(cohort.summary.coverageBySyllabusPoint)) {
      const current = coverage[topicId] || { submissions: 0, weightedScore: 0, scoredSubmissions: 0 }
      current.submissions += item.submissions
      if (Number.isFinite(item.averagePercentage)) {
        current.weightedScore += item.averagePercentage * item.submissions
        current.scoredSubmissions += item.submissions
      }
      coverage[topicId] = current
    }
    for (const reason of cohort.summary.riskReasons) risks.set(reason, (risks.get(reason) || 0) + 1)
  }
  const topics = Object.entries(coverage).map(([topicId, item]) => ({
    topicId,
    submissions: item.submissions,
    averagePercentage: item.scoredSubmissions ? Math.round(item.weightedScore / item.scoredSubmissions) : null,
  })).sort((left, right) => (left.averagePercentage ?? 101) - (right.averagePercentage ?? 101))
  return {
    generatedAt: nowIso(),
    window,
    cohortCount: cohorts.length,
    cohorts,
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
  if (![rawMarks, maxMarks, percentage].every(Number.isFinite) || rawMarks < 0 || maxMarks <= 0 || percentage < 0 || percentage > 100) {
    throw Object.assign(new Error('Submission requires valid mark totals and percentage.'), { statusCode: 400 })
  }
  return {
    rawMarks: Math.min(rawMarks, maxMarks),
    maxMarks,
    percentage: Math.round(percentage),
    elapsedSeconds: Math.max(0, Math.min(Number(value.elapsedSeconds) || 0, 86_400)),
    markingMode: asText(value.markingMode || 'assisted', 40),
    reviewRequired: Boolean(value.reviewRequired),
    attemptId: asText(value.attemptId, 100),
  }
}

export function createStemApi({ env }) {
  const signingKey = String(env.STEM_IDENTITY_SIGNING_KEY || '')
  return async function stemApi(request, response, next) {
    const url = new URL(request.url, 'http://127.0.0.1')
    if (!url.pathname.startsWith('/api/stem/') && url.pathname !== '/api/auth/status') return next()
    try {
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
        const role = user.roles.includes('school') || user.roles.includes('school_admin')
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
        const window = timeWindow(url)
        sendJson(response, 200, { classroomId, summary: summaryForClass(db, classroomId, window), window })
        return
      }
      const submissionsMatch = url.pathname.match(/^\/api\/stem\/classrooms\/([^/]+)\/submissions$/)
      if (request.method === 'GET' && submissionsMatch) {
        const classroomId = decodeURIComponent(submissionsMatch[1])
        const record = requireMembership(db, classroomId, user.id, new Set(['owner', 'teacher', 'school']))
        const rows = db.prepare(`
          SELECT events.*, assignments.syllabus_point_id
          FROM submission_events AS events
          JOIN assignments ON assignments.id = events.assignment_id
          WHERE assignments.classroom_id = ? AND events.event_type = 'submitted'
          ORDER BY events.occurred_at DESC
          LIMIT 500
        `).all(classroomId)
        sendJson(response, 200, { classroomId, submissions: rows.map((row) => publicSubmission(row, { includeStudentUserId: record.role !== 'school' })) })
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/stem/assignments') {
        const payload = await readJson(request)
        const classroomId = asText(payload.classroomId, 80)
        requireMembership(db, classroomId, user.id, new Set(['owner', 'teacher']))
        const title = asText(payload.title, 160)
        const subjectId = asText(payload.subjectId, 80)
        const stage = asText(payload.stage, 40)
        const syllabusPointId = asText(payload.syllabusPointId, 120)
        const sourceScope = payload.sourceScope && typeof payload.sourceScope === 'object' ? payload.sourceScope : null
        if (!title || !subjectId || !stage || !syllabusPointId || !sourceScope?.questionIds?.length) throw Object.assign(new Error('Assignment details and verified source question IDs are required.'), { statusCode: 400 })
        const id = crypto.randomUUID()
        const createdAt = nowIso()
        const status = payload.status === 'draft' ? 'draft' : 'active'
        db.prepare(`INSERT INTO assignments (id, classroom_id, created_by_user_id, subject_id, stage, syllabus_point_id, title, source_scope_json, due_at, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, classroomId, user.id, subjectId, stage, syllabusPointId, title, JSON.stringify({ questionIds: sourceScope.questionIds.slice(0, 60).map((id) => asText(id, 160)), provenanceVersion: asText(sourceScope.provenanceVersion, 40) || 'v1' }), validDueAt(payload.dueAt), status, createdAt)
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
        const classes = accessibleStaffClasses(db, user.id)
        if (!classes.length) throw Object.assign(new Error('No school or teaching classes are available for this account.'), { statusCode: 403 })
        sendJson(response, 200, { analytics: schoolAnalytics(db, user, timeWindow(url)) })
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/stem/school/reports/anonymous') {
        const classes = accessibleStaffClasses(db, user.id)
        if (!classes.length) throw Object.assign(new Error('No school or teaching classes are available for this account.'), { statusCode: 403 })
        const analytics = schoolAnalytics(db, user, timeWindow(url))
        const report = {
          generatedAt: analytics.generatedAt,
          window: analytics.window,
          cohorts: analytics.cohorts.map((cohort, index) => ({ cohort: `Cohort ${index + 1}`, summary: cohort.summary })),
          topicCoverage: analytics.topicCoverage,
          riskReasons: analytics.riskReasons,
          privacy: analytics.privacy,
        }
        sendJson(response, 200, { report })
        return
      }
      const submissionMatch = url.pathname.match(/^\/api\/stem\/assignments\/([^/]+)\/submissions$/)
      if (request.method === 'POST' && submissionMatch) {
        const assignmentId = decodeURIComponent(submissionMatch[1])
        const assignment = db.prepare('SELECT * FROM assignments WHERE id = ? AND status = \'active\'').get(assignmentId)
        if (!assignment) throw Object.assign(new Error('This assignment is not available.'), { statusCode: 404 })
        requireMembership(db, assignment.classroom_id, user.id, new Set(['student', 'teacher', 'owner']))
        const payload = await readJson(request)
        const idempotencyKey = asText(payload.idempotencyKey, 100)
        if (!idempotencyKey) throw Object.assign(new Error('Submission needs an idempotency key.'), { statusCode: 400 })
        const existing = db.prepare('SELECT id, occurred_at FROM submission_events WHERE student_user_id = ? AND idempotency_key = ?').get(user.id, idempotencyKey)
        if (existing) {
          sendJson(response, 200, { eventId: existing.id, occurredAt: existing.occurred_at, duplicate: true })
          return
        }
        const eventId = crypto.randomUUID()
        const occurredAt = nowIso()
        db.prepare('INSERT INTO submission_events (id, assignment_id, student_user_id, idempotency_key, event_type, payload_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(eventId, assignmentId, user.id, idempotencyKey, 'submitted', JSON.stringify(eventPayload(payload)), occurredAt)
        sendJson(response, 201, { eventId, occurredAt, duplicate: false })
        return
      }
      sendJson(response, 404, { error: 'STEM workspace endpoint not found.' })
    } catch (error) {
      sendJson(response, error.statusCode || 500, { error: error.statusCode ? error.message : 'STEM workspace could not complete that request.' })
    }
  }
}

export function closeStemDatabaseForTests() {
  database?.close()
  database = null
}
