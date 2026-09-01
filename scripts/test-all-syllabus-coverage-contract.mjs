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
console.log(JSON.stringify({ status: 'passed', routeCount: report.routeCount, readyRouteCount: report.readyRouteCount, blockerCount: report.blockerCount }))
