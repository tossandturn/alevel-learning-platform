import { courseRoutes } from '../src/data/routeRegistry.js'
import { unifiedQuestionBank } from '../src/data/questionBank.js'
import { syllabusTopicsInventory } from '../src/lib/syllabusPractice.js'
import { MIN_VERIFIED_GROUPS_FOR_PRACTICE } from '../src/lib/practiceConstants.js'

const reportOnly = process.argv.includes('--report-only')
const routes = courseRoutes.filter((route) => Array.isArray(route.syllabus?.topics) && route.syllabus.topics.length > 0)
const routeReports = routes.map((route) => {
  const inventory = syllabusTopicsInventory({ routeId: route.routeId, questionBank: unifiedQuestionBank })
  const topics = inventory.topics.map((topic) => ({
    id: topic.id,
    code: topic.code,
    name: topic.name,
    verifiedQuestionCount: topic.verifiedQuestionCount,
    ready: topic.verifiedQuestionCount >= MIN_VERIFIED_GROUPS_FOR_PRACTICE,
    availableSetSizes: topic.availableSetSizes,
  }))
  return {
    routeId: route.routeId,
    stage: route.stage,
    subjectCode: route.subjectCode,
    subject: route.subject,
    components: route.paperComponents,
    syllabusVersion: inventory.syllabusVersion,
    topicCount: topics.length,
    readyTopicCount: topics.filter((topic) => topic.ready).length,
    verifiedQuestionGroupCount: inventory.verifiedQuestionGroupCount,
    routeReady: inventory.ready === true && topics.length > 0 && topics.every((topic) => topic.ready),
    topics,
  }
})
const blockers = routeReports.flatMap((route) => route.topics
  .filter((topic) => !topic.ready)
  .map((topic) => ({
    routeId: route.routeId,
    subjectCode: route.subjectCode,
    stage: route.stage,
    topicId: topic.id,
    topic: topic.name,
    verifiedQuestionCount: topic.verifiedQuestionCount,
    requiredReviewedGroups: MIN_VERIFIED_GROUPS_FOR_PRACTICE,
  })))
const report = {
  schemaVersion: 'all-syllabus-coverage-v1',
  minimumReviewedGroupsPerTopic: MIN_VERIFIED_GROUPS_FOR_PRACTICE,
  routeCount: routeReports.length,
  readyRouteCount: routeReports.filter((route) => route.routeReady).length,
  blockerCount: blockers.length,
  routeReady: blockers.length === 0 && routeReports.length > 0,
  routes: routeReports,
  blockers,
}

console.log(JSON.stringify(report, null, 2))
if (!reportOnly && blockers.length > 0) process.exitCode = 1
