import { courseRoutes } from '../src/data/routeRegistry.js'
import { unifiedQuestionBank } from '../src/data/questionBank.js'
import { syllabusTopicsInventory } from '../src/lib/syllabusPractice.js'
import { MIN_VERIFIED_GROUPS_FOR_PRACTICE } from '../src/lib/practiceConstants.js'

const reportOnly = process.argv.includes('--report-only')

function optionValues(name) {
  const values = []
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== name) continue
    const value = String(process.argv[index + 1] || '').trim()
    if (value) values.push(...value.split(',').map((item) => item.trim()).filter(Boolean))
  }
  return [...new Set(values)]
}

const requiredRouteIds = optionValues('--route')
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
const availableRouteIds = new Set(routeReports.map((route) => route.routeId))
const unknownRouteIds = requiredRouteIds.filter((routeId) => !availableRouteIds.has(routeId))
if (unknownRouteIds.length) {
  throw new Error(`Unknown syllabus release route: ${unknownRouteIds.join(', ')}`)
}

const scopedRoutes = requiredRouteIds.length
  ? routeReports.filter((route) => requiredRouteIds.includes(route.routeId))
  : routeReports
const blockersForRoutes = (items) => items.flatMap((route) => route.topics
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
const blockers = blockersForRoutes(scopedRoutes)
const allBlockers = blockersForRoutes(routeReports)
const report = {
  schemaVersion: 'all-syllabus-coverage-v1',
  scope: requiredRouteIds.length ? 'release-routes' : 'all-routes',
  requiredRouteIds,
  minimumReviewedGroupsPerTopic: MIN_VERIFIED_GROUPS_FOR_PRACTICE,
  routeCount: routeReports.length,
  readyRouteCount: routeReports.filter((route) => route.routeReady).length,
  scopedRouteCount: scopedRoutes.length,
  scopedReadyRouteCount: scopedRoutes.filter((route) => route.routeReady).length,
  scopedBlockerCount: blockers.length,
  allBlockerCount: allBlockers.length,
  blockerCount: blockers.length,
  routeReady: blockers.length === 0 && scopedRoutes.length > 0,
  routes: routeReports,
  blockers,
}

console.log(JSON.stringify(report, null, 2))
if (!reportOnly && blockers.length > 0) process.exitCode = 1
