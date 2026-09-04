import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const coveragePath = path.join(projectRoot, 'scripts', 'verify-all-syllabus-coverage.mjs')
const strictResult = spawnSync(process.execPath, [coveragePath], { cwd: projectRoot, encoding: 'utf8' })
assert.notEqual(strictResult.status, 0, 'the all-syllabus production gate must block incomplete subject coverage')
const reportResult = spawnSync(process.execPath, [coveragePath, '--report-only'], { cwd: projectRoot, encoding: 'utf8' })
assert.equal(reportResult.status, 0, `report-only coverage must remain inspectable:\n${reportResult.stderr}`)
const report = JSON.parse(reportResult.stdout)
assert.equal(report.schemaVersion, 'all-syllabus-coverage-v1')
assert.ok(report.routeCount >= 20, 'the all-syllabus gate must include every official route registered by the product')
assert.equal(report.routeReady, false, 'the current fixture must remain blocked until every syllabus topic is ready')
assert.ok(report.blockers.length > 0)
assert.ok(report.blockers.every((blocker) => blocker.verifiedQuestionCount < 12 && blocker.requiredReviewedGroups === 12))
assert.ok(report.routes.every((route) => route.topicCount > 0 && route.topics.every((topic) => topic.ready === (topic.verifiedQuestionCount >= 12))))
const physicsRoute = report.routes.find((route) => route.routeId === 'cie-9702-as-physics')
assert.ok(physicsRoute, 'the all-syllabus report must include the 9702 AS Physics route')
assert.equal(physicsRoute.routeReady, true, 'the completed 9702 AS route must pass its own formal syllabus gate')
assert.equal(physicsRoute.readyTopicCount, 11, 'all eleven 9702 AS topics must be ready after the second review pass')

const scopedResult = spawnSync(process.execPath, [coveragePath, '--route', 'cie-9702-as-physics'], { cwd: projectRoot, encoding: 'utf8' })
assert.equal(scopedResult.status, 0, `a release scoped to the fully reviewed 9702 AS route must pass:\n${scopedResult.stdout}\n${scopedResult.stderr}`)
const scopedReport = JSON.parse(scopedResult.stdout)
assert.equal(scopedReport.scope, 'release-routes')
assert.deepEqual(scopedReport.requiredRouteIds, ['cie-9702-as-physics'])
assert.equal(scopedReport.scopedRouteCount, 1)
assert.equal(scopedReport.scopedReadyRouteCount, 1)
assert.equal(scopedReport.scopedBlockerCount, 0)
assert.equal(scopedReport.routeReady, true)
assert.ok(scopedReport.allBlockerCount > 0, 'scoped release success must not hide unfinished catalog routes')

const unknownRoute = spawnSync(process.execPath, [coveragePath, '--route', 'unknown-route'], { cwd: projectRoot, encoding: 'utf8' })
assert.notEqual(unknownRoute.status, 0, 'an unknown release route must fail closed')
console.log(JSON.stringify({ status: 'passed', routeCount: report.routeCount, readyRouteCount: report.readyRouteCount, blockerCount: report.blockerCount }))
