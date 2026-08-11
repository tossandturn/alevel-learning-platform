import assert from 'node:assert/strict'
import { routeById } from '../src/data/routeRegistry.js'
import { buildStemVocabularyContext, vocabularyCoverageForRoute } from '../src/data/stemVocabularyTaxonomy.js'
import { professionalTermsUrl } from '../src/lib/sharedAccount.js'

const route = routeById('cie-9702-as-physics')
assert.ok(route, 'A canonical STEM route is required')

const context = buildStemVocabularyContext({
  route,
  topicId: 'physics-9702-topic-03',
  termIds: ['stem.physics.dynamics', 'stem.physics.dynamics'],
  attemptId: 'att-contract-1',
  returnTo: 'https://stem.ieltsist.com/?view=result',
})

assert.deepEqual(Object.keys(context), [
  'contractVersion', 'family', 'taxonomyId', 'routeId', 'subjectCode', 'stage',
  'topicId', 'termIds', 'attemptId', 'returnTo', 'source', 'sourceStatus',
  'termInventoryStatus', 'availableCount',
])
assert.equal(context.contractVersion, 'stem-vocabulary-context-v1')
assert.equal(context.family, 'exam')
assert.equal(context.taxonomyId, 'exam.9702.as')
assert.deepEqual(context.termIds, ['stem.physics.dynamics', 'stem.physics.electricity', 'stem.physics.waves'])
assert.equal(context.sourceStatus, 'taxonomy-mapped')
assert.equal(context.termInventoryStatus, 'not-imported')
assert.equal(context.availableCount, null)

const url = new URL(professionalTermsUrl({
  subject: route.subject,
  subjectCode: route.subjectCode,
  stage: route.stage,
  routeId: route.routeId,
  taxonomyId: context.taxonomyId,
  topicId: context.topicId,
  termIds: context.termIds,
  attemptId: context.attemptId,
  returnTo: context.returnTo,
}))
for (const [key, value] of Object.entries({
  from: 'stem', contractVersion: 'stem-vocabulary-context-v1', family: 'exam',
  taxonomyId: context.taxonomyId, routeId: route.routeId, subjectCode: route.subjectCode,
  stage: route.stage, topicId: context.topicId, termIds: context.termIds.join(','),
  attemptId: context.attemptId, sourceStatus: 'taxonomy-mapped', termInventoryStatus: 'not-imported',
})) assert.equal(url.searchParams.get(key), value, `${key} must use the canonical context`)
assert.equal(url.searchParams.has('availableCount'), false, 'Unimported glossary must not claim a count')

const backed = vocabularyCoverageForRoute(route)
assert.equal(backed.availableCount, null)
console.log('STEM vocabulary context contract passed')
