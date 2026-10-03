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
assert.equal(physicsRoute.routeReady, false, '9702 AS must remain formally blocked while any topic has fewer than twelve reviewed groups')
assert.ok(physicsRoute.readyTopicCount < physicsRoute.topicCount)
const physicsFormalBlockers = physicsRoute.topics.filter((topic) => !topic.ready)
assert.ok(physicsFormalBlockers.length > 0, '9702 AS must retain an explicit formal-readiness blocker')
assert.ok(physicsFormalBlockers.every((topic) => topic.verifiedQuestionCount < 12))
assert.ok(
  physicsFormalBlockers.filter((topic) => topic.verifiedQuestionCount >= 6)
    .every((topic) => topic.availableSetSizes.includes(6)),
  'an under-formal topic may still expose a six-question study set without becoming formally ready',
)

const scopedResult = spawnSync(process.execPath, [coveragePath, '--route', 'cie-9702-as-physics'], { cwd: projectRoot, encoding: 'utf8' })
assert.notEqual(scopedResult.status, 0, 'a formal release scoped to incomplete 9702 AS coverage must fail closed')
const scopedReportResult = spawnSync(process.execPath, [coveragePath, '--report-only', '--route', 'cie-9702-as-physics'], { cwd: projectRoot, encoding: 'utf8' })
assert.equal(scopedReportResult.status, 0, `the scoped report must remain inspectable:\n${scopedReportResult.stderr}`)
const scopedReport = JSON.parse(scopedReportResult.stdout)
assert.equal(scopedReport.scope, 'release-routes')
assert.deepEqual(scopedReport.requiredRouteIds, ['cie-9702-as-physics'])
assert.equal(scopedReport.scopedRouteCount, 1)
assert.equal(scopedReport.scopedReadyRouteCount, 0)
assert.ok(scopedReport.scopedBlockerCount > 0)
assert.equal(scopedReport.routeReady, false)
assert.ok(scopedReport.blockers.every((blocker) => blocker.requiredReviewedGroups === 12 && blocker.verifiedQuestionCount < 12))
assert.ok(scopedReport.allBlockerCount > 0, 'a scoped report must not hide unfinished catalog routes')

const unknownRoute = spawnSync(process.execPath, [coveragePath, '--route', 'unknown-route'], { cwd: projectRoot, encoding: 'utf8' })
assert.notEqual(unknownRoute.status, 0, 'an unknown release route must fail closed')
console.log(JSON.stringify({ status: 'passed', routeCount: report.routeCount, readyRouteCount: report.readyRouteCount, blockerCount: report.blockerCount }))
