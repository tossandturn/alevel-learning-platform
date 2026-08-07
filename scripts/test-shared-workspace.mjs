import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'

const signingKey = 'shared-workspace-test-signing-key'
const databasePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stem-workspace-test-')), 'stem.sqlite')

function tokenFor(userId, username, roles = []) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: 'ieltsist.com', aud: 'stem.ieltsist.com', sub: `ielts:${userId}`, username,
    roles, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300,
  })).toString('base64url')
  const signature = crypto.createHmac('sha256', signingKey).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

function call(api, { method, url, token, body }) {
  return new Promise((resolve, reject) => {
    const request = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : [])
    request.method = method
    request.url = url
    request.headers = { authorization: `Bearer ${token}` }
    const response = {
      headers: new Map(),
      statusCode: 0,
      setHeader(name, value) { this.headers.set(name.toLowerCase(), value) },
      end(raw) { resolve({ statusCode: this.statusCode, body: JSON.parse(raw || '{}') }) },
    }
    Promise.resolve(api(request, response, () => reject(new Error(`Unhandled ${url}`)))).catch(reject)
  })
}

try {
  const api = createStemApi({ env: { STEM_IDENTITY_SIGNING_KEY: signingKey, STEM_DB_PATH: databasePath } })
  const teacherToken = tokenFor(1, 'teacher_one', ['teacher'])
  const studentToken = tokenFor(2, 'student_one')
  const schoolToken = tokenFor(3, 'school_admin', ['school'])
  const unverifiedStaffToken = tokenFor(4, 'unverified_staff')
  const deniedClass = await call(api, { method: 'POST', url: '/api/stem/classrooms', token: unverifiedStaffToken, body: { name: 'Should be denied' } })
  assert.equal(deniedClass.statusCode, 403)
  assert.match(deniedClass.body.error, /server-verified teacher or owner claim/)
  const createdClass = await call(api, { method: 'POST', url: '/api/stem/classrooms', token: teacherToken, body: { name: 'AS Physics' } })
  assert.equal(createdClass.statusCode, 201, createdClass.body.error)
  assert.equal(createdClass.body.classroom.role, 'owner')

  const joined = await call(api, { method: 'POST', url: '/api/stem/classrooms/join', token: studentToken, body: { inviteCode: createdClass.body.classroom.inviteCode } })
  assert.equal(joined.statusCode, 200)
  assert.equal(joined.body.classroom.role, 'student')
  const roleEscalationAttempt = await call(api, { method: 'POST', url: '/api/stem/classrooms/join', token: studentToken, body: { inviteCode: createdClass.body.classroom.inviteCode, role: 'teacher' } })
  assert.equal(roleEscalationAttempt.statusCode, 200)
  assert.equal(roleEscalationAttempt.body.classroom.role, 'student')
  const schoolJoined = await call(api, { method: 'POST', url: '/api/stem/classrooms/join', token: schoolToken, body: { inviteCode: createdClass.body.classroom.inviteCode, role: 'teacher' } })
  assert.equal(schoolJoined.statusCode, 200)
  assert.equal(schoolJoined.body.classroom.role, 'school')

  const assignment = await call(api, {
    method: 'POST', url: '/api/stem/assignments', token: teacherToken,
    body: { classroomId: createdClass.body.classroom.id, subjectId: 'physics', stage: 'AS', syllabusPointId: 'physics-9702-waves', title: 'Waves evidence set', sourceScope: { questionIds: ['qp-1', 'qp-2'] } },
  })
  assert.equal(assignment.statusCode, 201)

  const submission = await call(api, {
    method: 'POST', url: `/api/stem/assignments/${assignment.body.assignment.id}/submissions`, token: studentToken,
    body: { idempotencyKey: 'student-one-waves-attempt-one', attemptId: 'attempt-1', rawMarks: 8, maxMarks: 10, percentage: 80, elapsedSeconds: 900, markingMode: 'assisted' },
  })
  assert.equal(submission.statusCode, 201)
  const duplicate = await call(api, {
    method: 'POST', url: `/api/stem/assignments/${assignment.body.assignment.id}/submissions`, token: studentToken,
    body: { idempotencyKey: 'student-one-waves-attempt-one', attemptId: 'attempt-1', rawMarks: 8, maxMarks: 10, percentage: 80 },
  })
  assert.equal(duplicate.statusCode, 200)
  assert.equal(duplicate.body.duplicate, true)

  const summary = await call(api, { method: 'GET', url: `/api/stem/classrooms/${createdClass.body.classroom.id}/summary`, token: teacherToken })
  assert.equal(summary.statusCode, 200)
  assert.equal(summary.body.summary.submissions, 1)
  assert.equal(summary.body.summary.averagePercentage, 80)
  assert.equal(summary.body.summary.studentCount, 1)
  assert.equal(summary.body.summary.teacherCount, 1)
  assert.equal(summary.body.summary.assignmentCompletionRate, 100)
  assert.equal(summary.body.summary.coverageBySyllabusPoint['physics-9702-waves'].submissions, 1)
  assert.doesNotMatch(JSON.stringify(summary.body.summary), /student_one|payload_json|student_user_id/)
  const schoolSubmissions = await call(api, { method: 'GET', url: `/api/stem/classrooms/${createdClass.body.classroom.id}/submissions`, token: schoolToken })
  assert.equal(schoolSubmissions.statusCode, 200)
  assert.equal(schoolSubmissions.body.submissions.length, 1)
  assert.equal(Object.hasOwn(schoolSubmissions.body.submissions[0], 'studentUserId'), false)
  assert.doesNotMatch(JSON.stringify(schoolSubmissions.body), /student_one|student_user_id/)

  const reminder = await call(api, {
    method: 'POST', url: `/api/stem/assignments/${assignment.body.assignment.id}/reminders`, token: teacherToken,
    body: { audience: 'incomplete', message: 'Please complete the Waves evidence set before Friday.' },
  })
  assert.equal(reminder.statusCode, 201, reminder.body.error)
  assert.equal(reminder.body.reminder.audienceCount, 1)
  assert.equal(reminder.body.delivery, 'recorded')

  const feedback = await call(api, {
    method: 'POST', url: `/api/stem/assignments/${assignment.body.assignment.id}/feedback`, token: teacherToken,
    body: { studentUserId: 'ielts:2', body: 'Revisit the wave equation, then retry Question 2.' },
  })
  assert.equal(feedback.statusCode, 201, feedback.body.error)
  const studentFeedback = await call(api, { method: 'GET', url: `/api/stem/assignments/${assignment.body.assignment.id}/feedback`, token: studentToken })
  assert.equal(studentFeedback.statusCode, 200)
  assert.equal(studentFeedback.body.feedback.length, 1)
  assert.equal(studentFeedback.body.feedback[0].body, 'Revisit the wave equation, then retry Question 2.')

  const lifecycle = await call(api, {
    method: 'PATCH', url: `/api/stem/assignments/${assignment.body.assignment.id}`, token: teacherToken,
    body: { status: 'closed' },
  })
  assert.equal(lifecycle.statusCode, 200, lifecycle.body.error)
  assert.equal(lifecycle.body.assignment.status, 'closed')
  const closedReminder = await call(api, {
    method: 'POST', url: `/api/stem/assignments/${assignment.body.assignment.id}/reminders`, token: teacherToken,
    body: {},
  })
  assert.equal(closedReminder.statusCode, 409)

  const analytics = await call(api, { method: 'GET', url: '/api/stem/school/analytics?from=2020-01-01T00%3A00%3A00.000Z', token: teacherToken })
  assert.equal(analytics.statusCode, 200, analytics.body.error)
  assert.equal(analytics.body.analytics.cohortCount, 1)
  assert.equal(analytics.body.analytics.topicCoverage[0].topicId, 'physics-9702-waves')
  assert.doesNotMatch(JSON.stringify(analytics.body.analytics), /student_one|student_user_id|payload_json/)
  const anonymousReport = await call(api, { method: 'GET', url: '/api/stem/school/reports/anonymous', token: teacherToken })
  assert.equal(anonymousReport.statusCode, 200, anonymousReport.body.error)
  assert.equal(anonymousReport.body.report.cohorts[0].cohort, 'Cohort 1')
  assert.doesNotMatch(JSON.stringify(anonymousReport.body.report), /AS Physics|student_one|student_user_id|payload_json/)
  console.log('Shared workspace API checks passed')
} finally {
  closeStemDatabaseForTests()
  fs.rmSync(path.dirname(databasePath), { recursive: true, force: true })
}
