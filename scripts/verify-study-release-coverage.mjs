import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { createAiVerifiedQuestionBankLoader } from '../server/aiVerifiedQuestionBank.js'
import { createStemApi, closeStemDatabaseForTests } from '../server/stemApi.js'
import { isStudentReleasedAiStudyItem } from '../src/data/questionBank.js'
import { assertStudyReleaseInventory, parseStudyTopicScopes } from './study-release-policy.mjs'

const values = (name) => process.argv.flatMap((argument, index) => (
  argument === name ? [String(process.argv[index + 1] || '')] : []
))
const routes = values('--route')
const roots = values('--artifact-root')
const libraryRoot = values('--pdf-library-root')[0]
const topicScopeEntries = [...values('--topic-scope'), ...values('--topic')]

assert.ok(
  routes.length
  && routes.every((routeId) => /^[A-Za-z0-9-]+$/.test(routeId))
  && new Set(routes).size === routes.length,
  'explicit unique routes required',
)
assert.ok(roots.length && libraryRoot, 'explicit artifact and PDF roots required')
for (const sourcePath of [...roots, libraryRoot]) {
  assert.ok(fs.statSync(path.resolve(sourcePath)).isDirectory(), 'source directory required')
}
const topicScopes = parseStudyTopicScopes(topicScopeEntries, routes)
const groups = roots.flatMap((artifactRoot) => createAiVerifiedQuestionBankLoader({ artifactRoot, libraryRoot })().groups)
assert.ok(groups.length, 'AI study release requires approved runtime artifacts')
assert.equal(
  new Set(groups.map((question) => `${question.routeId}:${question.sourceQuestionId}`)).size,
  groups.length,
  'duplicate runtime identity',
)
assert.ok(
  groups.every((question) => isStudentReleasedAiStudyItem(question) && question.formalProgressEligible === false),
  'runtime AI must be released-study and excluded from formal progress',
)

const api = createStemApi({
  env: { NODE_ENV: 'production', STEM_DB_PATH: ':memory:' },
  topicQuestionBankProvider: () => groups,
  libraryRoot,
})
const server = http.createServer((request, response) => api(request, response, () => {
  response.statusCode = 404
  response.end()
}))
const reports = []
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  for (const routeId of routes) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/stem/routes/${routeId}/syllabus-topics`)
    assert.equal(response.status, 200)
    reports.push(assertStudyReleaseInventory(await response.json(), routeId, topicScopes[routeId]))
  }
  console.log(JSON.stringify({
    status: 'PASS',
    readinessMode: 'student-study',
    runtimeGroups: groups.length,
    aiStudyFormalProgressEligible: false,
    ...(topicScopeEntries.length ? { topicScopes } : {}),
    routes: reports,
  }))
} finally {
  await new Promise((resolve) => server.close(resolve))
  closeStemDatabaseForTests()
}
