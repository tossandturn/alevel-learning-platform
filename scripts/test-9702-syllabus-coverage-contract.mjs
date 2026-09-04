import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  MIN_QUESTION_GROUPS_PER_TEST,
  MIN_TESTS_PER_TOPIC,
  MIN_VERIFIED_GROUPS_FOR_PRACTICE,
} from '../src/lib/practiceConstants.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const coveragePath = path.join(projectRoot, 'scripts', 'verify-9702-syllabus-coverage.mjs')

assert.equal(MIN_QUESTION_GROUPS_PER_TEST, 6, 'each Topic Drill test must contain at least six distinct source groups')
assert.equal(MIN_TESTS_PER_TOPIC, 2, 'each official syllabus topic must support at least two tests')
assert.equal(MIN_VERIFIED_GROUPS_FOR_PRACTICE, 12, 'formal readiness must require two disjoint six-question tests')
assert.equal(
  MIN_VERIFIED_GROUPS_FOR_PRACTICE,
  MIN_QUESTION_GROUPS_PER_TEST * MIN_TESTS_PER_TOPIC,
  'the formal readiness floor must be derived from the Topic Drill test contract',
)

const strictResult = spawnSync(process.execPath, [coveragePath], {
  cwd: projectRoot,
  encoding: 'utf8',
})
assert.equal(
  strictResult.status,
  0,
  `the production coverage command must pass once every official 9702 AS topic reaches the formal floor.\nstdout:\n${strictResult.stdout}\nstderr:\n${strictResult.stderr}`,
)
const strictReport = JSON.parse(strictResult.stdout)
assert.equal(strictReport.status, 'ready')
assert.equal(strictReport.formalReadiness.routeReady, true)
assert.equal(strictReport.formalReadiness.readyTopicCount, 11)
assert.equal(strictReport.formalReadiness.underFloorTopicCount, 0)

const result = spawnSync(process.execPath, [coveragePath, '--report-only'], {
  cwd: projectRoot,
  encoding: 'utf8',
})
assert.equal(
  result.status,
  0,
  `9702 coverage verification must validate the complete reviewed inventory.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
)

const report = JSON.parse(result.stdout)
assert.equal(report.status, 'ready', 'the route should report full coverage once every official topic reaches the formal floor')
assert.equal(report.formalReadiness.routeReady, true)
assert.equal(report.formalReadiness.underFloorTopicCount, 0)

const underFloorTopics = report.topics.filter((topic) => topic.verifiedQuestionCount < MIN_VERIFIED_GROUPS_FOR_PRACTICE)
assert.equal(underFloorTopics.length, 0)
assert.ok(
  underFloorTopics.every((topic) => (
    topic.ready === false
    && topic.ctaPolicy === 'hidden'
    && Array.isArray(topic.availableSetSizes)
    && topic.availableSetSizes.length === 0
  )),
  'every under-floor topic must remain hidden and advertise no formal set size',
)

const readyTopics = report.topics.filter((topic) => topic.verifiedQuestionCount >= MIN_VERIFIED_GROUPS_FOR_PRACTICE)
assert.ok(readyTopics.length > 0, 'the fixture must retain a qualifying topic')
assert.equal(readyTopics.length, 11, 'reviewed mappings must raise the ready-topic count to all eleven topics')
assert.ok(
  readyTopics.every((topic) => topic.ready === true && topic.ctaPolicy === 'start'),
  'topics at or above the formal floor must remain startable',
)

console.log('9702 syllabus coverage contract regression passed.')
