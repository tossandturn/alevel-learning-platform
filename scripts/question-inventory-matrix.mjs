import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import papers from '../public/data/papers.json' with { type: 'json' }
import importedIndex from '../src/data/importedQuestionIndex.json' with { type: 'json' }
import sourceManifest from '../src/data/sourceContentManifest.json' with { type: 'json' }
import { courseRoutes } from '../src/data/routeRegistry.js'
import { unifiedQuestionBank } from '../src/data/questionBank.js'
import { MIN_VERIFIED_GROUPS_FOR_PRACTICE, topicPracticeEligibility } from '../src/lib/practiceConstants.js'
import { canonicalSyllabusTopicIdForRoute } from '../src/lib/syllabusPracticeRoutes.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const indexItems = Array.isArray(importedIndex.items) ? importedIndex.items : importedIndex.questions || []
const manifestItems = sourceManifest.items || {}
const catalogItems = Array.isArray(papers.items) ? papers.items : []
const assetsRoot = path.join(root, 'public', 'question-assets')
const assets = fs.existsSync(assetsRoot)
  ? fs.readdirSync(assetsRoot, { recursive: true }).filter((entry) => /\.(?:png|jpe?g|webp)$/i.test(entry))
  : []

function stageFor(item, route) {
  if (route.stage === 'Competition') return ['bpho', 'amc12'].includes(String(item.qualificationId || '').toLowerCase())
  if (route.stage === 'Admissions') return ['esat', 'tmua'].includes(String(item.qualificationId || '').toLowerCase())
  return (item.stageTags || []).includes(route.stage)
}

function routeMatches(item, route) {
  const subject = String(item.subjectId || '').toLowerCase()
  const code = String(route.subjectCode || '').toLowerCase()
  const subjectMatches = subject === route.subjectId
    || subject === code
    || String(item.subjectCode || '').toLowerCase() === code
  return subjectMatches
    && stageFor(item, route)
    && (route.stage === 'Competition' || route.stage === 'Admissions' || !route.paperComponents.length || route.paperComponents.includes(Number(item.sourceRef?.component || item.componentTags?.[0])))
}

function distinct(values) {
  return [...new Set(values.filter(Boolean))]
}

const sourcePolicies = distinct(catalogItems.map((item) => item.copyrightStatus || item.provenance))
const officialRouteUrls = Object.fromEntries(courseRoutes.map((route) => [route.routeId, route.syllabus?.url || route.syllabus?.board || null]))
const indexQuarantined = Object.values(manifestItems).filter((item) => (
  item.fileComplete === false && (item.reasons || []).includes('index-quarantined')
)).length
const sourceAdditionalQuarantined = Object.values(manifestItems).filter((item) => (
  item.fileComplete === false && !(item.reasons || []).includes('index-quarantined')
)).length
function topicIdsForItem(item, routeId) {
  const mapping = item.syllabusMapping || {}
  const reviewed = String(mapping.reviewStatus || '').toLowerCase() === 'reviewed'
  const suppliedSecondaryTopicIds = reviewed && Array.isArray(mapping.secondaryTopicIds)
    ? mapping.secondaryTopicIds
    : []
  const primaryTopicId = mapping.primaryTopicId || mapping.knowledgeGroupId || item.knowledgeGroupId || item.topicId
  const suppliedExplicitTopicIds = reviewed && Array.isArray(mapping.topicIds)
    ? mapping.topicIds
    : []
  const suppliedTopicIds = [primaryTopicId, ...suppliedExplicitTopicIds, ...suppliedSecondaryTopicIds]
  return distinct(suppliedTopicIds
    .map((topicId) => canonicalSyllabusTopicIdForRoute(routeId, topicId)))
}

function topicMatrixForRoute(route) {
  const topics = new Map((route.syllabus?.topics || []).map((topic) => [topic.id, {
    topicId: topic.id,
    practiceAvailable: 0,
    papers: new Set(),
  }]))
  for (const item of unifiedQuestionBank.filter((question) => question.routeId === route.routeId)) {
    for (const topicId of topicIdsForItem(item, route.routeId)) {
      const current = topics.get(topicId)
      if (!current) continue
      current.practiceAvailable += 1
      if (item.sourceRef?.paperId) current.papers.add(item.sourceRef.paperId)
    }
  }
  return [...topics.values()]
    .map((topic) => {
      const eligibility = topicPracticeEligibility({
        verifiedQuestionCount: topic.practiceAvailable,
        availableQuestionCount: topic.practiceAvailable,
      })
      return {
        topicId: topic.topicId,
        practiceAvailableQuestionGroups: topic.practiceAvailable,
        referencedPapers: topic.papers.size,
        ready: eligibility.ready,
        ctaPolicy: eligibility.ctaPolicy,
        sourceGap: eligibility.ready
          ? null
          : `Only ${topic.practiceAvailable} verified question group${topic.practiceAvailable === 1 ? '' : 's'}; ${MIN_VERIFIED_GROUPS_FOR_PRACTICE} required before formal readiness.`,
      }
    })
    .sort((left, right) => left.topicId.localeCompare(right.topicId))
}
const routes = courseRoutes.map((route) => {
  const indexed = indexItems.filter((item) => routeMatches(item, route))
  const questionIds = distinct(indexed.map((item) => item.questionId))
  const paperIds = distinct(indexed.map((item) => item.sourceRef?.paperId))
  const fileComplete = questionIds.filter((id) => manifestItems[id]?.fileComplete === true).length
  const semanticVerified = questionIds.filter((id) => manifestItems[id]?.semanticStatus === 'verified-complete').length
  const practiceAvailable = unifiedQuestionBank.filter((item) => item.routeId === route.routeId).length
  const catalogForRoute = catalogItems.filter((item) => item.examProfile?.courseRouteId === route.routeId)
  const topicMatrix = topicMatrixForRoute(route)
  const ready = topicMatrix.length > 0 && topicMatrix.every((topic) => topic.ready)
  const studyReady = topicMatrix.some((topic) => topic.ctaPolicy === 'start' || topic.ctaPolicy === 'start-study')
  return {
    routeId: route.routeId,
    qualification: route.qualification,
    stage: route.stage,
    subjectCode: route.subjectCode,
    officialSourceUrl: officialRouteUrls[route.routeId],
    catalogItems: catalogForRoute.length,
    indexedQuestionGroups: questionIds.length,
    indexedPapers: paperIds.length,
    fileCompleteQuestionGroups: fileComplete,
    semanticVerifiedQuestionGroups: semanticVerified,
    practiceAvailableQuestionGroups: practiceAvailable,
    readyTopics: topicMatrix.filter((topic) => topic.ready).length,
    topicMatrix,
    sourceGap: ready
      ? null
      : studyReady
        ? `${topicMatrix.filter((topic) => topic.ready).length}/${topicMatrix.length} official topics meet the ${MIN_VERIFIED_GROUPS_FOR_PRACTICE}-group formal readiness floor.`
        : practiceAvailable > 0
          ? `No official topic has the six reviewed question groups required to start a Topic Drill.`
        : 'No semantic-reviewed source question is currently available for practice.',
    ready,
    ctaPolicy: ready ? 'start' : studyReady ? 'start-study' : 'hidden',
  }
})

const output = {
  schemaVersion: 'stem-question-inventory-v1',
  generatedAt: new Date().toISOString(),
  policy: {
    catalogNumbersAreReferenceInventoryOnly: true,
    practicePoolRequiresFileAndSemanticReview: true,
    unverifiedContentIsExcludedFromPractice: true,
  },
  totals: {
    catalogItems: catalogItems.length,
    indexedQuestionGroups: indexItems.length,
    indexedPapers: distinct(indexItems.map((item) => item.sourceRef?.paperId)).length,
    indexQuarantined,
    sourceAdditionalQuarantined,
    effectiveFileQuarantined: indexQuarantined + sourceAdditionalQuarantined,
    semanticVerifiedQuestionGroups: Object.values(manifestItems).filter((item) => item.semanticStatus === 'verified-complete').length,
    effectivePracticeAvailableQuestionGroups: unifiedQuestionBank.length,
    effectivePracticeQuarantinedQuestionGroups: indexItems.length - unifiedQuestionBank.length,
    minimumGroupsForReadyRouteOrTopic: MIN_VERIFIED_GROUPS_FOR_PRACTICE,
    readyRoutes: routes.filter((route) => route.ready).length,
    limitedIndexingRoutes: routes.filter((route) => route.ctaPolicy === 'limited-indexing').length,
    hiddenRoutes: routes.filter((route) => route.ctaPolicy === 'hidden').length,
    questionAssetFiles: assets.length,
    questionAssetBytes: assets.reduce((sum, entry) => sum + fs.statSync(path.join(assetsRoot, entry)).size, 0),
  },
  sourcePolicies,
  routes,
}

console.log(JSON.stringify(output, null, 2))
