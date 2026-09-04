import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { artifactId } from './ai-pdf-ingestion/contract.mjs'
import { assignableQuestionIdsForBank, closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'
import { unifiedQuestionBank } from '../src/data/questionBank.js'

const signingKey = 'shared-workspace-test-signing-key'
const databasePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stem-workspace-test-')), 'stem.sqlite')
const legacyDatabasePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stem-workspace-legacy-test-')), 'stem.sqlite')
const stageDriftDatabasePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stem-workspace-stage-drift-test-')), 'stem.sqlite')
const ingestionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-ai-pdf-candidates-test-'))
const testOnlyAssignableQuestionBank = Object.freeze([
  ...unifiedQuestionBank,
  ...[
    'bpho-spc-q1@bpho-admissions-physics',
    'amc12-q1@maa-amc12-admissions-mathematics',
    'as-qp-1@cie-9702-as-physics',
    'as-qp-2@cie-9702-as-physics',
    'a2-qp-1@cie-9702-a2-physics',
    'igcse-qp-1@cie-0625-igcse-physics',
    'archived-qp-1@cie-9700-as-biology',
    'post-migration-qp@cie-9702-as-physics',
  ].map((bankId) => ({ bankId })),
])
const knownSourceIncompleteBankId = 'esat-ENGAA_2023_S1_QuestionPaper:q24@uatuk-esat-admissions'

assert.equal(assignableQuestionIdsForBank().has(knownSourceIncompleteBankId), false, 'a source-incomplete raw index record must not enter the production assignment allowlist')

const candidateQuestionPdfBytes = Buffer.from('%PDF-ai-question-fixture\n', 'utf8')
const candidateMarkSchemePdfBytes = Buffer.from('%PDF-ai-mark-scheme-fixture\n', 'utf8')
const candidateQuestionPdfSha256 = crypto.createHash('sha256').update(candidateQuestionPdfBytes).digest('hex')
const candidateMarkSchemePdfSha256 = crypto.createHash('sha256').update(candidateMarkSchemePdfBytes).digest('hex')
const candidatePaperId = 'cie-9702-9702_m25_qp_22'
const candidateArtifactId = artifactId({
  paperId: candidatePaperId,
  questionPdfSha256: candidateQuestionPdfSha256,
  markSchemePdfSha256: candidateMarkSchemePdfSha256,
})
const candidateArtifactPath = path.join(ingestionRoot, candidatePaperId, `${candidateArtifactId.slice('sha256:'.length)}.json`)
const candidateAssetRoot = path.join(ingestionRoot, candidatePaperId, `${candidateArtifactId.slice('sha256:'.length)}.assets`)
const candidateAssetPath = path.join(candidateAssetRoot, 'q1', 'question.pdf')
fs.mkdirSync(path.dirname(candidateAssetPath), { recursive: true })
fs.writeFileSync(candidateAssetPath, candidateQuestionPdfBytes)
fs.mkdirSync(path.dirname(candidateArtifactPath), { recursive: true })
fs.writeFileSync(candidateArtifactPath, JSON.stringify({
  schemaVersion: 'ai-pdf-ingestion.v1',
  artifactId: candidateArtifactId,
  paperId: candidatePaperId,
  subject: '9702',
  status: 'ai-verified',
  source: {
    paperId: candidatePaperId,
    questionPdfSha256: candidateQuestionPdfSha256,
    markSchemePdfSha256: candidateMarkSchemePdfSha256,
  },
  candidate: { secretText: 'do-not-return', questions: [{ questionNumber: '1' }] },
  verification: { questions: [{ questionNumber: '1' }] },
  assets: [{ questionId: `${candidatePaperId}:q1`, questionNumber: '1', questionPdfPath: candidateAssetPath, questionPdfSha256: candidateQuestionPdfSha256 }],
}, null, 2))

const quarantinePaperId = 'cie-9702-9702_m25_qp_12'
const quarantineQuestionPdfBytes = Buffer.from('%PDF-ai-quarantine-question\n', 'utf8')
const quarantineMarkSchemePdfBytes = Buffer.from('%PDF-ai-quarantine-mark-scheme\n', 'utf8')
const quarantineArtifactId = artifactId({
  paperId: quarantinePaperId,
  questionPdfSha256: crypto.createHash('sha256').update(quarantineQuestionPdfBytes).digest('hex'),
  markSchemePdfSha256: crypto.createHash('sha256').update(quarantineMarkSchemePdfBytes).digest('hex'),
})
const quarantineArtifactPath = path.join(ingestionRoot, quarantinePaperId, `${quarantineArtifactId.slice('sha256:'.length)}.json`)
fs.mkdirSync(path.dirname(quarantineArtifactPath), { recursive: true })
fs.writeFileSync(quarantineArtifactPath, JSON.stringify({
  schemaVersion: 'ai-pdf-ingestion.v1',
  artifactId: quarantineArtifactId,
  paperId: quarantinePaperId,
  subject: '9702',
  status: 'auto-quarantined',
  source: {
    paperId: quarantinePaperId,
    questionPdfSha256: crypto.createHash('sha256').update(quarantineQuestionPdfBytes).digest('hex'),
    markSchemePdfSha256: crypto.createHash('sha256').update(quarantineMarkSchemePdfBytes).digest('hex'),
  },
  reasonCodes: ['OPENAI_CONFIGURATION_INVALID'],
}, null, 2))

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
  const api = createStemApi({
    env: {
      STEM_IDENTITY_SIGNING_KEY: signingKey,
      STEM_DB_PATH: databasePath,
      AI_PDF_INGESTION_ROOT: ingestionRoot,
    },
    questionBank: testOnlyAssignableQuestionBank,
  })
  const teacherToken = tokenFor(1, 'teacher_one', ['teacher'])
  const assistantTeacherToken = tokenFor(5, 'teacher_two', ['teacher'])
  const studentToken = tokenFor(2, 'student_one')
  const schoolToken = tokenFor(3, 'school_admin', ['school_admin'])
  const schoolOwnerToken = tokenFor(7, 'school_owner', ['school_owner'])
  const schoolRoleToken = tokenFor(6, 'school_viewer', ['school'])
  const unverifiedStaffToken = tokenFor(4, 'unverified_staff')
  const authConfig = await call(api, { method: 'GET', url: '/api/auth/config' })
  assert.equal(authConfig.statusCode, 200)
  assert.equal(authConfig.body.protocol, 'stem-native-account-v1')
  assert.equal(authConfig.body.session.browserCookie, 'stem_session')
  assert.equal(authConfig.body.session.tokenStorage, 'memory-only')
  assert.equal(authConfig.body.browserFlow.login, '/api/auth/login')
  assert.equal(authConfig.body.browserFlow.register, '/api/auth/register')
  for (const [mode, href] of Object.entries(authConfig.body.browserFlow)) {
    assert.equal(href, `/api/auth/${mode}`, `${mode} browser flow must stay on the STEM origin`)
  }
  assert.equal(authConfig.body.responses.duplicateIdentifier, 409)
  const guestStatus = await call(api, { method: 'GET', url: '/api/auth/status' })
  assert.equal(guestStatus.statusCode, 200, 'a visitor checking current account state must receive a normal anonymous response')
  assert.deepEqual(guestStatus.body, { authenticated: false }, 'anonymous account status must not expose an identity or workspace')
  const studentCandidateListing = await call(api, {
    method: 'GET',
    url: '/api/stem/content/ai-ingestion-candidates',
    token: studentToken,
  })
  assert.equal(studentCandidateListing.statusCode, 403, 'AI ingestion candidates must not be visible to students')
  const teacherCandidateListing = await call(api, {
    method: 'GET',
    url: '/api/stem/content/ai-ingestion-candidates',
    token: teacherToken,
  })
  assert.equal(teacherCandidateListing.statusCode, 200, teacherCandidateListing.body.error)
  assert.equal(teacherCandidateListing.body.schemaVersion, 'ai-pdf-ingestion-candidates.v1')
  assert.deepEqual(teacherCandidateListing.body.counts, { 'ai-verified': 1, 'auto-quarantined': 1 })
  assert.equal(teacherCandidateListing.body.candidates.length, 2)
  assert.equal(teacherCandidateListing.body.candidates.find((item) => item.declaredStatus === 'ai-verified')?.studentEligibility, 'requires-human-review')
  assert.equal(teacherCandidateListing.body.candidates.find((item) => item.declaredStatus === 'auto-quarantined')?.studentEligibility, 'blocked')
  assert.doesNotMatch(JSON.stringify(teacherCandidateListing.body), /do-not-return/)
  assert.doesNotMatch(JSON.stringify(teacherCandidateListing.body), /questionPdfPath|verification|secretText/)
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

  const competitionClass = await call(api, { method: 'POST', url: '/api/stem/classrooms', token: teacherToken, body: { name: 'Competition Physics and Mathematics' } })
  assert.equal(competitionClass.statusCode, 201, competitionClass.body.error)
  const competitionStudent = await call(api, { method: 'POST', url: '/api/stem/classrooms/join', token: studentToken, body: { inviteCode: competitionClass.body.classroom.inviteCode } })
  assert.equal(competitionStudent.statusCode, 200)
  const studentCompetitionAssignment = await call(api, {
    method: 'POST', url: '/api/stem/assignments', token: studentToken,
    body: { classroomId: competitionClass.body.classroom.id, subjectId: 'bpho', routeId: 'bpho-admissions-physics', stage: 'Competition', syllabusPointId: 'bpho-mechanics', title: 'Student must not publish', sourceScope: { questionIds: ['bpho-denied@bpho-admissions-physics'], routeId: 'bpho-admissions-physics', stage: 'Competition' } },
  })
  assert.equal(studentCompetitionAssignment.statusCode, 403)
  const wrongCompetitionStage = await call(api, {
    method: 'POST', url: '/api/stem/assignments', token: teacherToken,
    body: { classroomId: competitionClass.body.classroom.id, subjectId: 'bpho', routeId: 'bpho-admissions-physics', stage: 'Admissions', syllabusPointId: 'bpho-mechanics', title: 'Wrong BPhO stage', sourceScope: { questionIds: ['bpho-wrong-stage@bpho-admissions-physics'], routeId: 'bpho-admissions-physics', stage: 'Admissions' } },
  })
  assert.equal(wrongCompetitionStage.statusCode, 400)
  assert.match(wrongCompetitionStage.body.error, /same learning route/)
  const bphoAssignment = await call(api, {
    method: 'POST', url: '/api/stem/assignments', token: teacherToken,
    body: { classroomId: competitionClass.body.classroom.id, subjectId: 'bpho', routeId: 'bpho-admissions-physics', stage: 'Competition', syllabusPointId: 'bpho-mechanics', title: 'BPhO Mechanics evidence set', sourceScope: { questionIds: ['bpho-spc-q1@bpho-admissions-physics'], routeId: 'bpho-admissions-physics', stage: 'Competition' } },
  })
  assert.equal(bphoAssignment.statusCode, 201, bphoAssignment.body.error)
  assert.deepEqual([bphoAssignment.body.assignment.routeId, bphoAssignment.body.assignment.stage], ['bpho-admissions-physics', 'Competition'])
  const amcAssignment = await call(api, {
    method: 'POST', url: '/api/stem/assignments', token: teacherToken,
    body: { classroomId: competitionClass.body.classroom.id, subjectId: 'amc12', routeId: 'maa-amc12-admissions-mathematics', stage: 'Competition', syllabusPointId: 'amc12-algebra', title: 'AMC12 Algebra evidence set', sourceScope: { questionIds: ['amc12-q1@maa-amc12-admissions-mathematics'], routeId: 'maa-amc12-admissions-mathematics', stage: 'Competition' } },
  })
  assert.equal(amcAssignment.statusCode, 201, amcAssignment.body.error)
  assert.equal(amcAssignment.body.assignment.stage, 'Competition')
  const teacherCompetitionSubmission = await call(api, {
    method: 'POST', url: `/api/stem/assignments/${bphoAssignment.body.assignment.id}/submissions`, token: teacherToken,
    body: { idempotencyKey: 'teacher-competition-denied', routeId: 'bpho-admissions-physics', stage: 'Competition', rawMarks: 8, maxMarks: 10, percentage: 80 },
  })
  assert.equal(teacherCompetitionSubmission.statusCode, 403)
  const crossStageCompetitionSubmission = await call(api, {
    method: 'POST', url: `/api/stem/assignments/${bphoAssignment.body.assignment.id}/submissions`, token: studentToken,
    body: { idempotencyKey: 'student-competition-wrong-stage', routeId: 'bpho-admissions-physics', stage: 'Admissions', rawMarks: 8, maxMarks: 10, percentage: 80 },
  })
  assert.equal(crossStageCompetitionSubmission.statusCode, 400)
  const bphoSubmission = await call(api, {
    method: 'POST', url: `/api/stem/assignments/${bphoAssignment.body.assignment.id}/submissions`, token: studentToken,
    body: { idempotencyKey: 'student-bpho-attempt-one', attemptId: 'bpho-attempt-1', routeId: 'bpho-admissions-physics', stage: 'Competition', rawMarks: 8, maxMarks: 10, percentage: 80 },
  })
  assert.equal(bphoSubmission.statusCode, 201, bphoSubmission.body.error)
  assert.deepEqual([bphoSubmission.body.routeId, bphoSubmission.body.stage], ['bpho-admissions-physics', 'Competition'])
  const competitionTeacherWorkspace = await call(api, { method: 'GET', url: '/api/stem/workspace', token: teacherToken })
  assert.equal(competitionTeacherWorkspace.statusCode, 200)
  assert.ok(competitionTeacherWorkspace.body.assignments.some((item) => item.id === bphoAssignment.body.assignment.id && item.stage === 'Competition'))
  assert.ok(competitionTeacherWorkspace.body.assignments.some((item) => item.id === amcAssignment.body.assignment.id && item.stage === 'Competition'))
  const competitionStudentWorkspace = await call(api, { method: 'GET', url: '/api/stem/workspace', token: studentToken })
  assert.equal(competitionStudentWorkspace.statusCode, 200)
  assert.ok(competitionStudentWorkspace.body.assignments.some((item) => item.id === bphoAssignment.body.assignment.id && item.routeId === 'bpho-admissions-physics'))

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
  assert.equal(deletedPrivateNote.body.note.body, '')
  assert.equal(deletedPrivateNote.body.note.deleted, true)
  assert.ok(deletedPrivateNote.body.note.deletedAt)
  const tombstonePrivateNote = await call(api, { method: 'GET', url: '/api/stem/notebook/notes?routeId=cie-9702-as-physics', token: studentToken })
  assert.equal(tombstonePrivateNote.statusCode, 200)
  assert.equal(tombstonePrivateNote.body.note.body, '')
  assert.equal(tombstonePrivateNote.body.note.deleted, true)
  assert.equal(tombstonePrivateNote.body.note.updatedAt, tombstonePrivateNote.body.note.deletedAt)

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
  const sourceIncompleteAssignment = await call(api, {
    method: 'POST', url: '/api/stem/assignments', token: teacherToken,
    body: { classroomId: createdClass.body.classroom.id, subjectId: 'esat', routeId: 'uatuk-esat-admissions', stage: 'Admissions', syllabusPointId: 'esat-mathematics', title: 'Must reject incomplete source record', sourceScope: { questionIds: [knownSourceIncompleteBankId], routeId: 'uatuk-esat-admissions', stage: 'Admissions' } },
  })
  assert.equal(sourceIncompleteAssignment.statusCode, 400)
  assert.match(sourceIncompleteAssignment.body.error, /verified and source-complete/)

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
  assert.equal(summary.body.summary.submissions, 0, 'client-reported results must not enter formal submission analytics')
  assert.equal(summary.body.summary.totalSubmissionCount, 0, 'client-reported results must not enter formal submission totals')
  assert.equal(summary.body.summary.verifiedScoreCount, 0)
  assert.equal(summary.body.summary.reportedScoreCount, 1, 'reported results may remain visible as a separate pending-verification count')
  assert.equal(summary.body.summary.averagePercentage, null)
  assert.equal(summary.body.summary.studentCount, 1)
  assert.equal(summary.body.summary.teacherCount, 2)
  assert.equal(summary.body.summary.activeStudentCount, 0, 'client-reported results must not create formal participation')
  assert.equal(summary.body.summary.completedActiveAssignments, 0, 'client-reported results must not complete an assignment')
  assert.equal(summary.body.summary.assignmentCompletionRate, 0)
  assert.deepEqual(summary.body.summary.coverageBySyllabusPoint, {}, 'client-reported results must not create formal topic coverage')
  assert.ok(summary.body.summary.riskReasons.includes('Low recent participation'))
  assert.ok(summary.body.summary.riskReasons.includes('Low assignment completion'))
  assert.ok(summary.body.summary.riskReasons.includes('No submitted evidence'))
  assert.ok(!summary.body.summary.riskReasons.includes('Scores await verified marking'), 'client-reported results must not alter formal risk reasons')
  assert.equal(summary.body.summary.filter.routeId, 'cie-9702-as-physics')
  assert.equal(summary.body.summary.aggregationMode, 'single-scope')
  assert.doesNotMatch(JSON.stringify(summary.body.summary), /student_one|payload_json|student_user_id/)
  const unfilteredSummary = await call(api, { method: 'GET', url: `/api/stem/classrooms/${createdClass.body.classroom.id}/summary`, token: teacherToken })
  assert.equal(unfilteredSummary.statusCode, 200)
  assert.equal(unfilteredSummary.body.summary.submissions, 0)
  assert.equal(unfilteredSummary.body.summary.totalSubmissionCount, 0)
  assert.equal(unfilteredSummary.body.summary.verifiedScoreCount, 0)
  assert.equal(unfilteredSummary.body.summary.reportedScoreCount, 3)
  assert.equal(unfilteredSummary.body.summary.averagePercentage, null)
  assert.equal(unfilteredSummary.body.summary.aggregationMode, 'cross-route-overview')
  assert.deepEqual(unfilteredSummary.body.summary.routeGroups.map((item) => item.routeId).sort(), ['cie-0625-igcse-physics', 'cie-9702-a2-physics', 'cie-9702-as-physics'])
  assert.deepEqual(unfilteredSummary.body.summary.coverageBySyllabusPoint, {})
  const schoolSubmissions = await call(api, { method: 'GET', url: `/api/stem/classrooms/${createdClass.body.classroom.id}/submissions`, token: schoolRoleToken })
  assert.equal(schoolSubmissions.statusCode, 403)
  const teacherSubmissions = await call(api, { method: 'GET', url: `/api/stem/classrooms/${createdClass.body.classroom.id}/submissions`, token: teacherToken })
  assert.equal(teacherSubmissions.statusCode, 200)
  const reportedSubmission = teacherSubmissions.body.submissions.find((item) => item.attemptId === 'attempt-1')
  assert.equal(reportedSubmission.scoreStatus, 'reported')
  assert.equal(reportedSubmission.markingMode, 'student-reported')
  const studentCannotVerify = await call(api, {
    method: 'POST', url: `/api/stem/submissions/${reportedSubmission.id}/verify`, token: studentToken,
    body: { reviewerNote: 'Students cannot promote their own browser score.' },
  })
  assert.equal(studentCannotVerify.statusCode, 403)
  const verifiedSubmission = await call(api, {
    method: 'POST', url: `/api/stem/submissions/${reportedSubmission.id}/verify`, token: teacherToken,
    body: { rawMarks: 7, maxMarks: 10, reviewerNote: 'Checked against the source-bound response.' },
  })
  assert.equal(verifiedSubmission.statusCode, 201, verifiedSubmission.body.error)
  assert.equal(verifiedSubmission.body.submission.scoreStatus, 'verified')
  assert.equal(verifiedSubmission.body.submission.markingMode, 'teacher-reviewed')
  assert.equal(verifiedSubmission.body.submission.percentage, 70)
  assert.equal(verifiedSubmission.body.submission.verifiedFromEventId, reportedSubmission.id)
  const verifiedSummary = await call(api, { method: 'GET', url: `/api/stem/classrooms/${createdClass.body.classroom.id}/summary?routeId=cie-9702-as-physics&stage=AS`, token: teacherToken })
  assert.equal(verifiedSummary.statusCode, 200)
  assert.equal(verifiedSummary.body.summary.totalSubmissionCount, 1, 'verification must promote the current result without double-counting completion')
  assert.equal(verifiedSummary.body.summary.verifiedScoreCount, 1)
  assert.equal(verifiedSummary.body.summary.reportedScoreCount, 0)
  assert.equal(verifiedSummary.body.summary.averagePercentage, 70)
  assert.equal(verifiedSummary.body.summary.activeStudentCount, 1)
  assert.equal(verifiedSummary.body.summary.completedActiveAssignments, 1)
  assert.equal(verifiedSummary.body.summary.assignmentCompletionRate, 100)
  assert.equal(verifiedSummary.body.summary.coverageBySyllabusPoint['cie-9702-as-physics::physics-waves'].submissions, 1)
  const refreshedTeacherSubmissions = await call(api, { method: 'GET', url: `/api/stem/classrooms/${createdClass.body.classroom.id}/submissions`, token: teacherToken })
  const currentVerified = refreshedTeacherSubmissions.body.submissions.find((item) => item.attemptId === 'attempt-1')
  assert.equal(currentVerified.id, verifiedSubmission.body.submission.id, 'teacher workspace must return the promoted current event')
  assert.equal(refreshedTeacherSubmissions.body.submissions.filter((item) => item.attemptId === 'attempt-1').length, 1, 'teacher review must not show source and promotion as duplicate submissions')

  await new Promise((resolve) => setTimeout(resolve, 2))
  const laterReportedSubmission = await call(api, {
    method: 'POST', url: `/api/stem/assignments/${assignment.body.assignment.id}/submissions`, token: studentToken,
    body: { idempotencyKey: 'student-one-waves-attempt-two', attemptId: 'attempt-2', rawMarks: 1, maxMarks: 10, percentage: 10 },
  })
  assert.equal(laterReportedSubmission.statusCode, 201, laterReportedSubmission.body.error)
  const summaryAfterLaterReport = await call(api, { method: 'GET', url: `/api/stem/classrooms/${createdClass.body.classroom.id}/summary?routeId=cie-9702-as-physics&stage=AS`, token: teacherToken })
  assert.equal(summaryAfterLaterReport.statusCode, 200)
  assert.equal(summaryAfterLaterReport.body.summary.totalSubmissionCount, 1, 'a later client report must not hide the existing server-verified result')
  assert.equal(summaryAfterLaterReport.body.summary.verifiedScoreCount, 1)
  assert.equal(summaryAfterLaterReport.body.summary.reportedScoreCount, 1, 'the later report must remain separately pending verification')
  assert.equal(summaryAfterLaterReport.body.summary.averagePercentage, 70, 'a later client report must not replace the verified score')
  assert.equal(summaryAfterLaterReport.body.summary.assignmentCompletionRate, 100)
  assert.equal(summaryAfterLaterReport.body.summary.coverageBySyllabusPoint['cie-9702-as-physics::physics-waves'].submissions, 1)

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
  assert.equal(analytics.body.analytics.topicCoverage.filter((item) => item.topicId === 'physics-waves').length, 1, 'school analytics must exclude client-reported topic coverage')
  assert.deepEqual(analytics.body.analytics.topicCoverage.filter((item) => item.topicId === 'physics-waves').map((item) => item.stage), ['AS'])
  assert.ok(!analytics.body.analytics.riskReasons.some((item) => item.reason === 'Scores await verified marking'), 'client-reported results must not alter formal school risk analytics')
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
  assert.equal(stageAnalytics.body.analytics.routeGroups[0].submissions, 0)
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
    CREATE TABLE private_notes (
      user_id TEXT NOT NULL, route_id TEXT NOT NULL, body TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, route_id)
    );
  `)
  const legacyAt = '2026-01-01T00:00:00.000Z'
  legacyDatabase.prepare('INSERT INTO classrooms VALUES (?, ?, ?, ?, ?, ?)').run('legacy-class', 'ielts:1', 'Legacy Physics', 'legacy-code', legacyAt, null)
  legacyDatabase.prepare('INSERT INTO class_memberships VALUES (?, ?, ?, ?)').run('legacy-class', 'ielts:1', 'owner', legacyAt)
  legacyDatabase.prepare('INSERT INTO class_memberships VALUES (?, ?, ?, ?)').run('legacy-class', 'ielts:2', 'student', legacyAt)
  legacyDatabase.prepare('INSERT INTO class_memberships VALUES (?, ?, ?, ?)').run('legacy-class', 'ielts:3', 'school', legacyAt)
  legacyDatabase.prepare('INSERT INTO assignments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('legacy-assignment', 'legacy-class', 'ielts:1', 'physics', 'AS', 'physics-waves', 'Old mixed assignment', JSON.stringify({ questionIds: ['old-question'] }), null, 'active', legacyAt)
  legacyDatabase.prepare('INSERT INTO submission_events VALUES (?, ?, ?, ?, ?, ?, ?)').run('legacy-event', 'legacy-assignment', 'ielts:2', 'legacy-key', 'submitted', JSON.stringify({ rawMarks: 4, maxMarks: 10, percentage: 40, scoreStatus: 'verified' }), legacyAt)
  legacyDatabase.prepare('INSERT INTO private_notes VALUES (?, ?, ?, ?)').run('ielts:1', 'cie-9702-as-physics', 'Legacy private note', legacyAt)
  legacyDatabase.close()

  const legacyApi = createStemApi({ env: { STEM_IDENTITY_SIGNING_KEY: signingKey, STEM_DB_PATH: legacyDatabasePath }, questionBank: testOnlyAssignableQuestionBank })
  const migratedLegacyNote = await call(legacyApi, { method: 'GET', url: '/api/stem/notebook/notes?routeId=cie-9702-as-physics', token: teacherToken })
  assert.equal(migratedLegacyNote.statusCode, 200, migratedLegacyNote.body.error)
  assert.equal(migratedLegacyNote.body.note.body, 'Legacy private note', 'legacy private notes must survive the additive deleted_at migration')
  assert.equal(migratedLegacyNote.body.note.deleted, false)
  const deletedLegacyNote = await call(legacyApi, { method: 'DELETE', url: '/api/stem/notebook/notes/cie-9702-as-physics', token: teacherToken })
  assert.equal(deletedLegacyNote.statusCode, 200, deletedLegacyNote.body.error)
  assert.equal(deletedLegacyNote.body.note.deleted, true, 'the migrated private note table must accept tombstones')
  const legacyWorkspace = await call(legacyApi, { method: 'GET', url: '/api/stem/workspace', token: teacherToken })
  assert.equal(legacyWorkspace.statusCode, 200, legacyWorkspace.body.error)
  assert.equal(legacyWorkspace.body.assignments[0].routeId, 'legacy-unscoped')
  assert.equal(legacyWorkspace.body.assignments[0].stage, 'legacy-unscoped')
  assert.equal(legacyWorkspace.body.assignments[0].legacyStage, 'AS')
  const legacyAnalytics = await call(legacyApi, { method: 'GET', url: '/api/stem/school/analytics', token: schoolToken })
  assert.equal(legacyAnalytics.statusCode, 200, legacyAnalytics.body.error)
  assert.equal(legacyAnalytics.body.analytics.routeGroups[0].routeId, 'legacy-unscoped')
  assert.equal(legacyAnalytics.body.analytics.routeGroups[0].stage, 'legacy-unscoped')
  assert.equal(legacyAnalytics.body.analytics.routeGroups[0].submissions, 0, 'legacy client-reported payloads must not be promoted into formal analytics')
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
  assert.equal(migratedAsAnalytics.body.analytics.routeGroups[0].submissions, 0)
  assert.deepEqual(migratedAsAnalytics.body.analytics.topicCoverage, [])
  const legacySubmission = await call(legacyApi, {
    method: 'POST', url: '/api/stem/assignments/legacy-assignment/submissions', token: studentToken,
    body: { idempotencyKey: 'new-legacy-attempt', rawMarks: 5, maxMarks: 10, percentage: 50 },
  })
  assert.equal(legacySubmission.statusCode, 409)
  assert.match(legacySubmission.body.error, /Legacy unscoped assignments/)

  closeStemDatabaseForTests()
  const stageDriftDatabase = new DatabaseSync(stageDriftDatabasePath)
  stageDriftDatabase.exec(`
    CREATE TABLE classrooms (id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, name TEXT NOT NULL, invite_code TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, archived_at TEXT);
    CREATE TABLE class_memberships (classroom_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, joined_at TEXT NOT NULL, PRIMARY KEY (classroom_id, user_id));
    CREATE TABLE assignments (
      id TEXT PRIMARY KEY, classroom_id TEXT NOT NULL, created_by_user_id TEXT NOT NULL, subject_id TEXT NOT NULL,
      stage TEXT NOT NULL, route_id TEXT NOT NULL, syllabus_point_id TEXT NOT NULL, title TEXT NOT NULL,
      source_scope_json TEXT NOT NULL, due_at TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE submission_events (
      id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL, student_user_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      event_type TEXT NOT NULL, route_id TEXT NOT NULL, stage TEXT NOT NULL, payload_json TEXT NOT NULL, occurred_at TEXT NOT NULL,
      UNIQUE (assignment_id, student_user_id, idempotency_key)
    );
  `)
  stageDriftDatabase.prepare('INSERT INTO classrooms VALUES (?, ?, ?, ?, ?, ?)').run('stage-drift-class', 'ielts:1', 'Competition migration', 'stage-drift', legacyAt, null)
  stageDriftDatabase.prepare('INSERT INTO class_memberships VALUES (?, ?, ?, ?)').run('stage-drift-class', 'ielts:1', 'owner', legacyAt)
  stageDriftDatabase.prepare('INSERT INTO class_memberships VALUES (?, ?, ?, ?)').run('stage-drift-class', 'ielts:2', 'student', legacyAt)
  for (const [id, routeId, subjectId, topicId] of [
    ['old-bpho-assignment', 'bpho-admissions-physics', 'bpho', 'bpho-mechanics'],
    ['old-amc-assignment', 'maa-amc12-admissions-mathematics', 'amc12', 'amc12-algebra'],
  ]) {
    const sourceScope = JSON.stringify({ questionIds: [`${id}-q1@${routeId}`], routeId, stage: 'Admissions' })
    stageDriftDatabase.prepare('INSERT INTO assignments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, 'stage-drift-class', 'ielts:1', subjectId, 'Admissions', routeId, topicId, `Old ${subjectId} assignment`, sourceScope, null, 'active', legacyAt)
  }
  stageDriftDatabase.prepare('INSERT INTO submission_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('old-bpho-event', 'old-bpho-assignment', 'ielts:2', 'old-bpho-key', 'submitted', 'bpho-admissions-physics', 'Admissions', JSON.stringify({ rawMarks: 7, maxMarks: 10, percentage: 70 }), legacyAt)
  stageDriftDatabase.close()

  const stageDriftApi = createStemApi({ env: { STEM_IDENTITY_SIGNING_KEY: signingKey, STEM_DB_PATH: stageDriftDatabasePath }, questionBank: testOnlyAssignableQuestionBank })
  const stageDriftWorkspace = await call(stageDriftApi, { method: 'GET', url: '/api/stem/workspace', token: teacherToken })
  assert.equal(stageDriftWorkspace.statusCode, 200, stageDriftWorkspace.body.error)
  const migratedCompetitionAssignments = stageDriftWorkspace.body.assignments.filter((assignment) => assignment.classroomId === 'stage-drift-class')
  assert.deepEqual(migratedCompetitionAssignments.map((assignment) => [assignment.routeId, assignment.stage, assignment.sourceScope.stage]).sort(), [
    ['bpho-admissions-physics', 'Competition', 'Competition'],
    ['maa-amc12-admissions-mathematics', 'Competition', 'Competition'],
  ], 'registered BPhO and AMC12 route IDs must migrate from the obsolete Admissions stage without mixing routes')
  const migratedCompetitionSubmission = await call(stageDriftApi, {
    method: 'POST', url: '/api/stem/assignments/old-bpho-assignment/submissions', token: studentToken,
    body: { idempotencyKey: 'new-bpho-competition-key', routeId: 'bpho-admissions-physics', stage: 'Competition', rawMarks: 8, maxMarks: 10, percentage: 80 },
  })
  assert.equal(migratedCompetitionSubmission.statusCode, 201, migratedCompetitionSubmission.body.error)
  assert.equal(migratedCompetitionSubmission.body.stage, 'Competition')
  console.log('Shared workspace API checks passed')
} finally {
  closeStemDatabaseForTests()
  fs.rmSync(path.dirname(databasePath), { recursive: true, force: true })
  fs.rmSync(path.dirname(legacyDatabasePath), { recursive: true, force: true })
  fs.rmSync(path.dirname(stageDriftDatabasePath), { recursive: true, force: true })
  fs.rmSync(ingestionRoot, { recursive: true, force: true })
}
