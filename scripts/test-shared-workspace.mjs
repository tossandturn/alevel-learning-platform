import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'

const signingKey = 'shared-workspace-test-signing-key'
const databasePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stem-workspace-test-')), 'stem.sqlite')
const legacyDatabasePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stem-workspace-legacy-test-')), 'stem.sqlite')

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
  const assistantTeacherToken = tokenFor(5, 'teacher_two', ['teacher'])
  const studentToken = tokenFor(2, 'student_one')
  const schoolToken = tokenFor(3, 'school_admin', ['school_admin'])
  const schoolOwnerToken = tokenFor(7, 'school_owner', ['school_owner'])
  const schoolRoleToken = tokenFor(6, 'school_viewer', ['school'])
  const unverifiedStaffToken = tokenFor(4, 'unverified_staff')
  const authConfig = await call(api, { method: 'GET', url: '/api/auth/config' })
  assert.equal(authConfig.statusCode, 200)
  assert.equal(authConfig.body.protocol, 'stem-sso-v1')
  assert.equal(authConfig.body.session.browserCookie, 'ieltsist_session')
  assert.equal(authConfig.body.session.tokenStorage, 'memory-only')
  assert.match(authConfig.body.browserFlow.login, /auth=login/)
  assert.match(authConfig.body.browserFlow.register, /auth=register/)
  assert.equal(authConfig.body.responses.duplicateIdentifier, 409)
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
  const assistantTeacherJoined = await call(api, { method: 'POST', url: '/api/stem/classrooms/join', token: assistantTeacherToken, body: { inviteCode: createdClass.body.classroom.inviteCode } })
  assert.equal(assistantTeacherJoined.statusCode, 200)
  assert.equal(assistantTeacherJoined.body.classroom.role, 'teacher')
  const schoolRoleJoined = await call(api, { method: 'POST', url: '/api/stem/classrooms/join', token: schoolRoleToken, body: { inviteCode: createdClass.body.classroom.inviteCode } })
  assert.equal(schoolRoleJoined.statusCode, 200)
  assert.equal(schoolRoleJoined.body.classroom.role, 'school')
  const schoolOwnerJoined = await call(api, { method: 'POST', url: '/api/stem/classrooms/join', token: schoolOwnerToken, body: { inviteCode: createdClass.body.classroom.inviteCode } })
  assert.equal(schoolOwnerJoined.statusCode, 200)
  assert.equal(schoolOwnerJoined.body.classroom.role, 'school')

  const emptyPrivateNote = await call(api, { method: 'GET', url: '/api/stem/notebook/notes?routeId=cie-9702-as-physics', token: studentToken })
  assert.equal(emptyPrivateNote.statusCode, 200)
  assert.equal(emptyPrivateNote.body.note, null)
  assert.equal(emptyPrivateNote.body.privacy, 'private-to-student')
  const savedPrivateNote = await call(api, { method: 'PUT', url: '/api/stem/notebook/notes/cie-9702-as-physics', token: studentToken, body: { body: 'Use momentum conservation after defining the system.' } })
  assert.equal(savedPrivateNote.statusCode, 200, savedPrivateNote.body.error)
  assert.equal(savedPrivateNote.body.note.body, 'Use momentum conservation after defining the system.')
  const teacherPrivateNote = await call(api, { method: 'GET', url: '/api/stem/notebook/notes?routeId=cie-9702-as-physics', token: teacherToken })
  assert.equal(teacherPrivateNote.statusCode, 200)
  assert.equal(teacherPrivateNote.body.note, null)
  const loadedPrivateNote = await call(api, { method: 'GET', url: '/api/stem/notebook/notes?routeId=cie-9702-as-physics', token: studentToken })
  assert.equal(loadedPrivateNote.statusCode, 200)
  assert.equal(loadedPrivateNote.body.note.body, 'Use momentum conservation after defining the system.')
  const deletedPrivateNote = await call(api, { method: 'DELETE', url: '/api/stem/notebook/notes/cie-9702-as-physics', token: studentToken })
  assert.equal(deletedPrivateNote.statusCode, 200)
  assert.equal(deletedPrivateNote.body.note, null)

  const missingRoute = await call(api, {
    method: 'POST', url: '/api/stem/assignments', token: teacherToken,
    body: { classroomId: createdClass.body.classroom.id, subjectId: 'physics-9702', stage: 'AS', syllabusPointId: 'physics-waves', title: 'Missing route', sourceScope: { questionIds: ['qp-0@cie-9702-as-physics'], routeId: 'cie-9702-as-physics', stage: 'AS' } },
  })
  assert.equal(missingRoute.statusCode, 400)
  assert.match(missingRoute.body.error, /routeId/)
  const mismatchedRoute = await call(api, {
    method: 'POST', url: '/api/stem/assignments', token: teacherToken,
    body: { classroomId: createdClass.body.classroom.id, subjectId: 'physics-9702', routeId: 'cie-9702-a2-physics', stage: 'AS', syllabusPointId: 'physics-waves', title: 'Mixed stages', sourceScope: { questionIds: ['qp-0@cie-9702-a2-physics'], routeId: 'cie-9702-a2-physics', stage: 'AS' } },
  })
  assert.equal(mismatchedRoute.statusCode, 400)
  assert.match(mismatchedRoute.body.error, /same learning route/)
  const fakeRoute = await call(api, {
    method: 'POST', url: '/api/stem/assignments', token: teacherToken,
    body: { classroomId: createdClass.body.classroom.id, subjectId: 'physics-9702', routeId: 'cie-9999-as-physics', stage: 'AS', syllabusPointId: 'physics-waves', title: 'Fake route', sourceScope: { questionIds: ['qp-0@cie-9999-as-physics'], routeId: 'cie-9999-as-physics', stage: 'AS' } },
  })
  assert.equal(fakeRoute.statusCode, 400)
  assert.match(fakeRoute.body.error, /not registered/)
  const wrongSubject = await call(api, {
    method: 'POST', url: '/api/stem/assignments', token: teacherToken,
    body: { classroomId: createdClass.body.classroom.id, subjectId: 'biology-9700', routeId: 'cie-9702-as-physics', stage: 'AS', syllabusPointId: 'physics-waves', title: 'Wrong subject', sourceScope: { questionIds: ['qp-0@cie-9702-as-physics'], routeId: 'cie-9702-as-physics', stage: 'AS' } },
  })
  assert.equal(wrongSubject.statusCode, 400)
  assert.match(wrongSubject.body.error, /subjectId does not match/)
  const missingSourceScope = await call(api, {
    method: 'POST', url: '/api/stem/assignments', token: teacherToken,
    body: { classroomId: createdClass.body.classroom.id, subjectId: 'physics-9702', routeId: 'cie-9702-as-physics', stage: 'AS', syllabusPointId: 'physics-waves', title: 'Missing source route', sourceScope: { questionIds: ['qp-0@cie-9702-as-physics'] } },
  })
  assert.equal(missingSourceScope.statusCode, 400)
  assert.match(missingSourceScope.body.error, /sourceScope must include routeId and stage/)
  const unscopedBankId = await call(api, {
    method: 'POST', url: '/api/stem/assignments', token: teacherToken,
    body: { classroomId: createdClass.body.classroom.id, subjectId: 'physics-9702', routeId: 'cie-9702-as-physics', stage: 'AS', syllabusPointId: 'physics-waves', title: 'Unscoped bank ID', sourceScope: { questionIds: ['qp-0'], routeId: 'cie-9702-as-physics', stage: 'AS' } },
  })
  assert.equal(unscopedBankId.statusCode, 400)
  assert.match(unscopedBankId.body.error, /bankId must use/)
  const wrongBankSuffix = await call(api, {
    method: 'POST', url: '/api/stem/assignments', token: teacherToken,
    body: { classroomId: createdClass.body.classroom.id, subjectId: 'physics-9702', routeId: 'cie-9702-as-physics', stage: 'AS', syllabusPointId: 'physics-waves', title: 'Wrong bank suffix', sourceScope: { questionIds: ['qp-0@cie-9702-a2-physics'], routeId: 'cie-9702-as-physics', stage: 'AS' } },
  })
  assert.equal(wrongBankSuffix.statusCode, 400)
  assert.match(wrongBankSuffix.body.error, /bankId must use/)
  const duplicateBankIds = await call(api, {
    method: 'POST', url: '/api/stem/assignments', token: teacherToken,
    body: { classroomId: createdClass.body.classroom.id, subjectId: 'physics-9702', routeId: 'cie-9702-as-physics', stage: 'AS', syllabusPointId: 'physics-waves', title: 'Duplicate source IDs', sourceScope: { questionIds: ['qp-0@cie-9702-as-physics', 'qp-0@cie-9702-as-physics'], routeId: 'cie-9702-as-physics', stage: 'AS' } },
  })
  assert.equal(duplicateBankIds.statusCode, 400)
  assert.match(duplicateBankIds.body.error, /must be unique/)

  const assignment = await call(api, {
    method: 'POST', url: '/api/stem/assignments', token: teacherToken,
    body: { classroomId: createdClass.body.classroom.id, subjectId: 'physics-9702', routeId: 'cie-9702-as-physics', stage: 'AS', syllabusPointId: 'physics-waves', title: 'AS Waves evidence set', sourceScope: { questionIds: ['as-qp-1@cie-9702-as-physics', 'as-qp-2@cie-9702-as-physics'], routeId: 'cie-9702-as-physics', stage: 'AS' } },
  })
  assert.equal(assignment.statusCode, 201)
  assert.equal(assignment.body.assignment.routeId, 'cie-9702-as-physics')
  assert.equal(assignment.body.assignment.stage, 'AS')
  assert.equal(assignment.body.assignment.scopeStatus, 'scoped')
  assert.equal(assignment.body.assignment.sourceScope.routeId, 'cie-9702-as-physics')

  const a2Assignment = await call(api, {
    method: 'POST', url: '/api/stem/assignments', token: teacherToken,
    body: { classroomId: createdClass.body.classroom.id, subjectId: 'physics-9702', routeId: 'cie-9702-a2-physics', stage: 'A2', syllabusPointId: 'physics-waves', title: 'A2 Waves evidence set', sourceScope: { questionIds: ['a2-qp-1@cie-9702-a2-physics'], routeId: 'cie-9702-a2-physics', stage: 'A2' } },
  })
  assert.equal(a2Assignment.statusCode, 201, a2Assignment.body.error)
  const igcseAssignment = await call(api, {
    method: 'POST', url: '/api/stem/assignments', token: teacherToken,
    body: { classroomId: createdClass.body.classroom.id, subjectId: 'physics-0625', routeId: 'cie-0625-igcse-physics', stage: 'IGCSE', syllabusPointId: 'physics-electricity', title: 'IGCSE Electricity evidence set', sourceScope: { questionIds: ['igcse-qp-1@cie-0625-igcse-physics'], routeId: 'cie-0625-igcse-physics', stage: 'IGCSE' } },
  })
  assert.equal(igcseAssignment.statusCode, 201, igcseAssignment.body.error)

  const ownerSubmission = await call(api, {
    method: 'POST', url: `/api/stem/assignments/${assignment.body.assignment.id}/submissions`, token: teacherToken,
    body: { idempotencyKey: 'owner-must-not-submit', rawMarks: 8, maxMarks: 10, percentage: 80 },
  })
  assert.equal(ownerSubmission.statusCode, 403)
  const teacherSubmission = await call(api, {
    method: 'POST', url: `/api/stem/assignments/${assignment.body.assignment.id}/submissions`, token: assistantTeacherToken,
    body: { idempotencyKey: 'teacher-must-not-submit', rawMarks: 8, maxMarks: 10, percentage: 80 },
  })
  assert.equal(teacherSubmission.statusCode, 403)
  const invalidPercentage = await call(api, {
    method: 'POST', url: `/api/stem/assignments/${assignment.body.assignment.id}/submissions`, token: studentToken,
    body: { idempotencyKey: 'student-invalid-percentage', rawMarks: 8, maxMarks: 10, percentage: 70 },
  })
  assert.equal(invalidPercentage.statusCode, 400)
  assert.match(invalidPercentage.body.error, /percentage must match rawMarks and maxMarks/)
  const marksOverMaximum = await call(api, {
    method: 'POST', url: `/api/stem/assignments/${assignment.body.assignment.id}/submissions`, token: studentToken,
    body: { idempotencyKey: 'student-marks-over-maximum', rawMarks: 11, maxMarks: 10, percentage: 100 },
  })
  assert.equal(marksOverMaximum.statusCode, 400)

  const submission = await call(api, {
    method: 'POST', url: `/api/stem/assignments/${assignment.body.assignment.id}/submissions`, token: studentToken,
    body: { idempotencyKey: 'student-one-waves-attempt-one', attemptId: 'attempt-1', rawMarks: 8, maxMarks: 10, percentage: 80, elapsedSeconds: 900, markingMode: 'official' },
  })
  assert.equal(submission.statusCode, 201)
  assert.equal(submission.body.routeId, 'cie-9702-as-physics')
  assert.equal(submission.body.stage, 'AS')
  const crossStageSubmission = await call(api, {
    method: 'POST', url: `/api/stem/assignments/${assignment.body.assignment.id}/submissions`, token: studentToken,
    body: { idempotencyKey: 'cross-stage-attempt', routeId: 'cie-9702-a2-physics', stage: 'A2', rawMarks: 5, maxMarks: 10, percentage: 50 },
  })
  assert.equal(crossStageSubmission.statusCode, 400)
  assert.match(crossStageSubmission.body.error, /match the assignment/)
  const a2Submission = await call(api, {
    method: 'POST', url: `/api/stem/assignments/${a2Assignment.body.assignment.id}/submissions`, token: studentToken,
    body: { idempotencyKey: 'student-one-waves-attempt-one', routeId: 'cie-9702-a2-physics', stage: 'A2', rawMarks: 6, maxMarks: 10, percentage: 60 },
  })
  assert.equal(a2Submission.statusCode, 201, a2Submission.body.error)
  assert.equal(a2Submission.body.duplicate, false)
  const igcseSubmission = await call(api, {
    method: 'POST', url: `/api/stem/assignments/${igcseAssignment.body.assignment.id}/submissions`, token: studentToken,
    body: { idempotencyKey: 'student-one-igcse-attempt-one', rawMarks: 7, maxMarks: 10, percentage: 70 },
  })
  assert.equal(igcseSubmission.statusCode, 201, igcseSubmission.body.error)
  assert.equal(igcseSubmission.body.routeId, 'cie-0625-igcse-physics')
  assert.equal(igcseSubmission.body.stage, 'IGCSE')
  const duplicate = await call(api, {
    method: 'POST', url: `/api/stem/assignments/${assignment.body.assignment.id}/submissions`, token: studentToken,
    body: { idempotencyKey: 'student-one-waves-attempt-one', attemptId: 'attempt-1', rawMarks: 8, maxMarks: 10, percentage: 80 },
  })
  assert.equal(duplicate.statusCode, 200)
  assert.equal(duplicate.body.duplicate, true)
  assert.equal(duplicate.body.routeId, 'cie-9702-as-physics')
  assert.equal(duplicate.body.stage, 'AS')

  const archivedAssignment = await call(api, {
    method: 'POST', url: '/api/stem/assignments', token: teacherToken,
    body: { classroomId: createdClass.body.classroom.id, subjectId: 'biology-9700', routeId: 'cie-9700-as-biology', stage: 'AS', syllabusPointId: 'biology-cells', title: 'Archived biology evidence set', sourceScope: { questionIds: ['archived-qp-1@cie-9700-as-biology'], routeId: 'cie-9700-as-biology', stage: 'AS' } },
  })
  assert.equal(archivedAssignment.statusCode, 201, archivedAssignment.body.error)
  const archivedSubmission = await call(api, {
    method: 'POST', url: `/api/stem/assignments/${archivedAssignment.body.assignment.id}/submissions`, token: studentToken,
    body: { idempotencyKey: 'archived-assignment-attempt', rawMarks: 1, maxMarks: 10, percentage: 10 },
  })
  assert.equal(archivedSubmission.statusCode, 201, archivedSubmission.body.error)
  const archivedLifecycle = await call(api, {
    method: 'PATCH', url: `/api/stem/assignments/${archivedAssignment.body.assignment.id}`, token: teacherToken,
    body: { status: 'archived' },
  })
  assert.equal(archivedLifecycle.statusCode, 200, archivedLifecycle.body.error)

  const summary = await call(api, { method: 'GET', url: `/api/stem/classrooms/${createdClass.body.classroom.id}/summary?routeId=cie-9702-as-physics&stage=AS`, token: teacherToken })
  assert.equal(summary.statusCode, 200)
  assert.equal(summary.body.summary.submissions, 1)
  assert.equal(summary.body.summary.verifiedScoreCount, 0)
  assert.equal(summary.body.summary.reportedScoreCount, 1)
  assert.equal(summary.body.summary.averagePercentage, null)
  assert.equal(summary.body.summary.studentCount, 1)
  assert.equal(summary.body.summary.teacherCount, 2)
  assert.equal(summary.body.summary.assignmentCompletionRate, 100)
  assert.equal(summary.body.summary.coverageBySyllabusPoint['cie-9702-as-physics::physics-waves'].submissions, 1)
  assert.equal(summary.body.summary.filter.routeId, 'cie-9702-as-physics')
  assert.equal(summary.body.summary.aggregationMode, 'single-scope')
  assert.doesNotMatch(JSON.stringify(summary.body.summary), /student_one|payload_json|student_user_id/)
  const unfilteredSummary = await call(api, { method: 'GET', url: `/api/stem/classrooms/${createdClass.body.classroom.id}/summary`, token: teacherToken })
  assert.equal(unfilteredSummary.statusCode, 200)
  assert.equal(unfilteredSummary.body.summary.submissions, 3)
  assert.equal(unfilteredSummary.body.summary.verifiedScoreCount, 0)
  assert.equal(unfilteredSummary.body.summary.reportedScoreCount, 3)
  assert.equal(unfilteredSummary.body.summary.averagePercentage, null)
  assert.equal(unfilteredSummary.body.summary.aggregationMode, 'cross-route-overview')
  assert.deepEqual(unfilteredSummary.body.summary.routeGroups.map((item) => item.routeId).sort(), ['cie-0625-igcse-physics', 'cie-9702-a2-physics', 'cie-9702-as-physics'])
  assert.equal(unfilteredSummary.body.summary.coverageBySyllabusPoint['cie-9702-as-physics::physics-waves'].submissions, 1)
  assert.equal(unfilteredSummary.body.summary.coverageBySyllabusPoint['cie-9702-a2-physics::physics-waves'].submissions, 1)
  const schoolSubmissions = await call(api, { method: 'GET', url: `/api/stem/classrooms/${createdClass.body.classroom.id}/submissions`, token: schoolRoleToken })
  assert.equal(schoolSubmissions.statusCode, 403)
  const teacherSubmissions = await call(api, { method: 'GET', url: `/api/stem/classrooms/${createdClass.body.classroom.id}/submissions`, token: teacherToken })
  assert.equal(teacherSubmissions.statusCode, 200)
  const reportedSubmission = teacherSubmissions.body.submissions.find((item) => item.attemptId === 'attempt-1')
  assert.equal(reportedSubmission.scoreStatus, 'reported')
  assert.equal(reportedSubmission.markingMode, 'student-reported')

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

  const teacherAnalytics = await call(api, { method: 'GET', url: '/api/stem/school/analytics', token: teacherToken })
  assert.equal(teacherAnalytics.statusCode, 403)
  const schoolRoleAnalytics = await call(api, { method: 'GET', url: '/api/stem/school/analytics', token: schoolRoleToken })
  assert.equal(schoolRoleAnalytics.statusCode, 403)
  const analytics = await call(api, { method: 'GET', url: '/api/stem/school/analytics?from=2020-01-01T00%3A00%3A00.000Z', token: schoolToken })
  assert.equal(analytics.statusCode, 200, analytics.body.error)
  assert.equal(analytics.body.analytics.cohortCount, 1)
  assert.equal(analytics.body.analytics.aggregationMode, 'grouped-by-route')
  assert.deepEqual(analytics.body.analytics.routeGroups.map((item) => item.routeId).sort(), ['cie-0625-igcse-physics', 'cie-9702-a2-physics', 'cie-9702-as-physics'])
  assert.equal(analytics.body.analytics.topicCoverage.filter((item) => item.topicId === 'physics-waves').length, 2)
  assert.deepEqual(analytics.body.analytics.topicCoverage.filter((item) => item.topicId === 'physics-waves').map((item) => item.stage).sort(), ['A2', 'AS'])
  assert.doesNotMatch(JSON.stringify(analytics.body.analytics), /student_one|student_user_id|payload_json/)
  const asAnalytics = await call(api, { method: 'GET', url: '/api/stem/school/analytics?routeId=cie-9702-as-physics&stage=AS', token: schoolToken })
  assert.equal(asAnalytics.statusCode, 200, asAnalytics.body.error)
  assert.equal(asAnalytics.body.analytics.filter.routeId, 'cie-9702-as-physics')
  assert.equal(asAnalytics.body.analytics.routeGroups.length, 1)
  assert.equal(asAnalytics.body.analytics.routeGroups[0].routeId, 'cie-9702-as-physics')
  assert.equal(asAnalytics.body.analytics.routeGroups[0].submissions, 1)
  assert.ok(asAnalytics.body.analytics.topicCoverage.every((item) => item.routeId === 'cie-9702-as-physics' && item.stage === 'AS'))
  const stageAnalytics = await call(api, { method: 'GET', url: '/api/stem/school/analytics?stage=A2', token: schoolToken })
  assert.equal(stageAnalytics.statusCode, 200, stageAnalytics.body.error)
  assert.equal(stageAnalytics.body.analytics.routeGroups.length, 1)
  assert.equal(stageAnalytics.body.analytics.routeGroups[0].routeId, 'cie-9702-a2-physics')
  assert.equal(stageAnalytics.body.analytics.routeGroups[0].submissions, 1)
  const mismatchedAnalytics = await call(api, { method: 'GET', url: '/api/stem/school/analytics?routeId=cie-9702-a2-physics&stage=AS', token: schoolToken })
  assert.equal(mismatchedAnalytics.statusCode, 400)
  const teacherReport = await call(api, { method: 'GET', url: '/api/stem/school/reports/anonymous', token: teacherToken })
  assert.equal(teacherReport.statusCode, 403)
  const schoolRoleReport = await call(api, { method: 'GET', url: '/api/stem/school/reports/anonymous', token: schoolRoleToken })
  assert.equal(schoolRoleReport.statusCode, 403)
  const anonymousReport = await call(api, { method: 'GET', url: '/api/stem/school/reports/anonymous', token: schoolToken })
  assert.equal(anonymousReport.statusCode, 200, anonymousReport.body.error)
  assert.equal(anonymousReport.body.report.cohorts.length, 0)
  assert.equal(anonymousReport.body.report.suppressedCohorts, 1)
  assert.equal(anonymousReport.body.report.minimumCohortSize, 5)
  assert.equal(anonymousReport.body.report.routeGroups.length, 0)
  assert.doesNotMatch(JSON.stringify(anonymousReport.body.report), /AS Physics|student_one|student_user_id|payload_json/)
  const ownerAnalytics = await call(api, { method: 'GET', url: '/api/stem/school/analytics', token: schoolOwnerToken })
  assert.equal(ownerAnalytics.statusCode, 200, ownerAnalytics.body.error)

  closeStemDatabaseForTests()
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
  const legacyDatabase = new DatabaseSync(legacyDatabasePath)
  legacyDatabase.exec(`
    CREATE TABLE classrooms (id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, name TEXT NOT NULL, invite_code TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, archived_at TEXT);
    CREATE TABLE class_memberships (classroom_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, joined_at TEXT NOT NULL, PRIMARY KEY (classroom_id, user_id));
    CREATE TABLE assignments (
      id TEXT PRIMARY KEY, classroom_id TEXT NOT NULL, created_by_user_id TEXT NOT NULL, subject_id TEXT NOT NULL,
      stage TEXT NOT NULL, syllabus_point_id TEXT NOT NULL, title TEXT NOT NULL, source_scope_json TEXT NOT NULL,
      due_at TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE submission_events (
      id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL, student_user_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      event_type TEXT NOT NULL, payload_json TEXT NOT NULL, occurred_at TEXT NOT NULL,
      UNIQUE (student_user_id, idempotency_key)
    );
  `)
  const legacyAt = '2026-01-01T00:00:00.000Z'
  legacyDatabase.prepare('INSERT INTO classrooms VALUES (?, ?, ?, ?, ?, ?)').run('legacy-class', 'ielts:1', 'Legacy Physics', 'legacy-code', legacyAt, null)
  legacyDatabase.prepare('INSERT INTO class_memberships VALUES (?, ?, ?, ?)').run('legacy-class', 'ielts:1', 'owner', legacyAt)
  legacyDatabase.prepare('INSERT INTO class_memberships VALUES (?, ?, ?, ?)').run('legacy-class', 'ielts:2', 'student', legacyAt)
  legacyDatabase.prepare('INSERT INTO class_memberships VALUES (?, ?, ?, ?)').run('legacy-class', 'ielts:3', 'school', legacyAt)
  legacyDatabase.prepare('INSERT INTO assignments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('legacy-assignment', 'legacy-class', 'ielts:1', 'physics', 'AS', 'physics-waves', 'Old mixed assignment', JSON.stringify({ questionIds: ['old-question'] }), null, 'active', legacyAt)
  legacyDatabase.prepare('INSERT INTO submission_events VALUES (?, ?, ?, ?, ?, ?, ?)').run('legacy-event', 'legacy-assignment', 'ielts:2', 'legacy-key', 'submitted', JSON.stringify({ rawMarks: 4, maxMarks: 10, percentage: 40 }), legacyAt)
  legacyDatabase.close()

  const legacyApi = createStemApi({ env: { STEM_IDENTITY_SIGNING_KEY: signingKey, STEM_DB_PATH: legacyDatabasePath } })
  const legacyWorkspace = await call(legacyApi, { method: 'GET', url: '/api/stem/workspace', token: teacherToken })
  assert.equal(legacyWorkspace.statusCode, 200, legacyWorkspace.body.error)
  assert.equal(legacyWorkspace.body.assignments[0].routeId, 'legacy-unscoped')
  assert.equal(legacyWorkspace.body.assignments[0].stage, 'legacy-unscoped')
  assert.equal(legacyWorkspace.body.assignments[0].legacyStage, 'AS')
  const legacyAnalytics = await call(legacyApi, { method: 'GET', url: '/api/stem/school/analytics', token: schoolToken })
  assert.equal(legacyAnalytics.statusCode, 200, legacyAnalytics.body.error)
  assert.equal(legacyAnalytics.body.analytics.routeGroups[0].routeId, 'legacy-unscoped')
  assert.equal(legacyAnalytics.body.analytics.routeGroups[0].stage, 'legacy-unscoped')
  assert.equal(legacyAnalytics.body.analytics.routeGroups[0].submissions, 1)
  const migratedScopedAssignment = await call(legacyApi, {
    method: 'POST', url: '/api/stem/assignments', token: teacherToken,
    body: {
      classroomId: 'legacy-class', subjectId: 'physics-9702', routeId: 'cie-9702-as-physics', stage: 'AS',
      syllabusPointId: 'physics-waves', title: 'Scoped after migration',
      sourceScope: { questionIds: ['post-migration-qp@cie-9702-as-physics'], routeId: 'cie-9702-as-physics', stage: 'AS' },
    },
  })
  assert.equal(migratedScopedAssignment.statusCode, 201, migratedScopedAssignment.body.error)
  const reusedLegacyKey = await call(legacyApi, {
    method: 'POST', url: `/api/stem/assignments/${migratedScopedAssignment.body.assignment.id}/submissions`, token: studentToken,
    body: { idempotencyKey: 'legacy-key', rawMarks: 9, maxMarks: 10, percentage: 90 },
  })
  assert.equal(reusedLegacyKey.statusCode, 201, reusedLegacyKey.body.error)
  assert.equal(reusedLegacyKey.body.duplicate, false)
  const migratedAsAnalytics = await call(legacyApi, { method: 'GET', url: '/api/stem/school/analytics?stage=AS', token: schoolToken })
  assert.equal(migratedAsAnalytics.statusCode, 200, migratedAsAnalytics.body.error)
  assert.equal(migratedAsAnalytics.body.analytics.routeGroups.length, 1)
  assert.equal(migratedAsAnalytics.body.analytics.routeGroups[0].routeId, 'cie-9702-as-physics')
  assert.equal(migratedAsAnalytics.body.analytics.routeGroups[0].submissions, 1)
  assert.ok(migratedAsAnalytics.body.analytics.topicCoverage.every((item) => item.scopeStatus === 'scoped'))
  const legacySubmission = await call(legacyApi, {
    method: 'POST', url: '/api/stem/assignments/legacy-assignment/submissions', token: studentToken,
    body: { idempotencyKey: 'new-legacy-attempt', rawMarks: 5, maxMarks: 10, percentage: 50 },
  })
  assert.equal(legacySubmission.statusCode, 409)
  assert.match(legacySubmission.body.error, /Legacy unscoped assignments/)
  console.log('Shared workspace API checks passed')
} finally {
  closeStemDatabaseForTests()
  fs.rmSync(path.dirname(databasePath), { recursive: true, force: true })
  fs.rmSync(path.dirname(legacyDatabasePath), { recursive: true, force: true })
}
