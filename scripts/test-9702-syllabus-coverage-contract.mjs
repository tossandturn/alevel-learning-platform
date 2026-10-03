import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  MIN_QUESTION_GROUPS_PER_TEST,
  MIN_TESTS_PER_TOPIC,
  MIN_VERIFIED_GROUPS_FOR_PRACTICE,
  topicPracticeEligibility,
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
assert.notEqual(
  strictResult.status,
  0,
  `the production coverage command must fail while any official 9702 AS topic remains below the formal floor.\nstdout:\n${strictResult.stdout}\nstderr:\n${strictResult.stderr}`,
)
const strictReport = JSON.parse(strictResult.stdout)
assert.equal(strictReport.status, 'partial')
assert.equal(strictReport.minimumQuestionGroupsPerTest, MIN_QUESTION_GROUPS_PER_TEST)
assert.equal(strictReport.minimumReviewedGroupsPerTopic, MIN_VERIFIED_GROUPS_FOR_PRACTICE)
assert.equal(strictReport.formalReadiness.routeReady, false)
assert.ok(strictReport.formalReadiness.readyTopicCount < 11)
assert.ok(strictReport.formalReadiness.underFloorTopicCount > 0)

const result = spawnSync(process.execPath, [coveragePath, '--report-only'], {
  cwd: projectRoot,
  encoding: 'utf8',
})
assert.equal(
  result.status,
  0,
  `9702 report-only coverage must remain inspectable while formal coverage is partial.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
)

const report = JSON.parse(result.stdout)
assert.equal(report.status, 'partial')
assert.equal(report.formalReadiness.routeReady, false)
assert.ok(report.formalReadiness.underFloorTopicCount > 0)
assert.equal(report.formalReadiness.underFloorTopicCount, strictReport.formalReadiness.underFloorTopicCount)

const underFloorTopics = report.topics.filter((topic) => topic.verifiedQuestionCount < MIN_VERIFIED_GROUPS_FOR_PRACTICE)
assert.ok(underFloorTopics.length > 0, 'the restored source truth must retain a negative proof for the formal gate')
assert.ok(
  underFloorTopics.every((topic) => {
    const policy = topicPracticeEligibility(topic)
    return topic.ready === false
      && topic.studyReady === policy.studyReady
      && topic.apiStartable === (policy.ready || policy.studyReady)
      && topic.ctaPolicy === policy.ctaPolicy
      && JSON.stringify(topic.availableSetSizes) === JSON.stringify(policy.availableSetSizes)
  }),
  'every under-formal topic must preserve the shared study-only/hidden policy without becoming formally ready',
)
const reviewedSubsetTopics = underFloorTopics.filter((topic) => topic.verifiedQuestionCount >= MIN_QUESTION_GROUPS_PER_TEST)
assert.ok(reviewedSubsetTopics.length > 0, 'the fixture must exercise reviewed subset study between the 6 and 12 gates')
assert.ok(reviewedSubsetTopics.every((topic) => (
  topic.ready === false
  && topic.studyReady === true
  && topic.apiStartable === true
  && topic.ctaPolicy === 'start-study'
  && topic.availableSetSizes.includes(MIN_QUESTION_GROUPS_PER_TEST)
)), '6-11 reviewed groups may start study-only practice but must not become formally ready')

const readyTopics = report.topics.filter((topic) => topic.verifiedQuestionCount >= MIN_VERIFIED_GROUPS_FOR_PRACTICE)
assert.ok(readyTopics.length > 0, 'the fixture must retain a qualifying topic')
assert.ok(
  readyTopics.every((topic) => topic.ready === true && topic.studyReady === false && topic.ctaPolicy === 'start'),
  'topics at or above the formal floor must remain startable',
)

console.log('9702 syllabus coverage contract regression passed.')
