import assert from 'node:assert/strict'

import { subjects } from '../src/data/subjectCatalog.js'
import { courseRoutes, routeById } from '../src/data/routeRegistry.js'
import { vocabularyCoverageForRoute } from '../src/data/stemVocabularyTaxonomy.js'
import { studyQuestionBank } from '../src/data/questionBank.js'
import { syllabusTopicsInventory } from '../src/lib/syllabusPractice.js'
import { validateSyllabusInventoryPayload } from '../src/hooks/useSyllabusInventory.js'
import { paperItemMatchesActiveRoute } from '../src/lib/paperRouteEligibility.js'
import paperCatalog from '../public/data/papers/9709.json' with { type: 'json' }

const route = routeById('cie-9709-as-p1-p2')
assert.ok(route, 'the AS 9709 P1 + P2 route must be registered')
assert.equal(route.subject, 'Mathematics')
assert.equal(route.subjectId, 'math-9709')
assert.equal(route.subjectCode, '9709')
assert.equal(route.stage, 'AS')
assert.deepEqual(route.paperComponents, [1, 2])
assert.ok(courseRoutes.filter((candidate) => candidate.subjectCode === '9709').every((candidate) => candidate.subject === 'Mathematics'))
assert.equal(courseRoutes.filter((candidate) => candidate.subjectCode === '9709' && candidate.subject === 'Physics').length, 0)

const appSubject = subjects.find((candidate) => candidate.code === '9709')
assert.ok(appSubject, 'the app subject catalogue must expose Mathematics 9709')
assert.ok(appSubject.routeIds.includes(route.routeId))

const inventory = syllabusTopicsInventory({ routeId: route.routeId, questionBank: studyQuestionBank })
assert.equal(inventory.routeId, route.routeId)
assert.equal(inventory.subjectCode, '9709')
assert.equal(inventory.subject, 'Mathematics')
assert.equal(inventory.subjectId, 'math-9709')
assert.equal(inventory.stage, 'AS')
assert.deepEqual(inventory.paperComponents, [1, 2])
assert.deepEqual(inventory.assessmentComponents.map((item) => item.component), [1, 2])
assert.ok(inventory.availableQuestionGroupCount > 0, 'the route inventory must report available 9709 study questions')
assert.ok(inventory.topics.every((topic) => topic.routeId === route.routeId))

const routeQuestions = studyQuestionBank.filter((question) => question.routeId === route.routeId)
assert.ok(routeQuestions.length > 0)
assert.ok(routeQuestions.every((question) => question.subjectCode === '9709' && question.subject === 'Mathematics' && question.stage === 'AS'))
assert.ok(routeQuestions.every((question) => route.paperComponents.includes(Number(question.paperComponent))))

const vocabulary = vocabularyCoverageForRoute(route)
assert.equal(vocabulary.taxonomyId, 'exam.9709.as')
assert.equal(vocabulary.subject, 'Mathematics')
assert.equal(vocabulary.subjectCode, '9709')
assert.equal(vocabulary.stage, 'AS')
assert.ok(vocabulary.mappedTermIds.length > 0, '9709 must have Mathematics vocabulary mappings')
assert.ok(vocabulary.mappedTermIds.every((termId) => termId.startsWith('stem.math.')))
assert.ok(vocabulary.mappedTermIds.every((termId) => !termId.startsWith('stem.physics.')))

const validated = validateSyllabusInventoryPayload(inventory, route.routeId)
assert.equal(validated.subjectCode, '9709')
assert.equal(validated.subject, 'Mathematics')
assert.deepEqual(validated.paperComponents, [1, 2])
assert.throws(
  () => validateSyllabusInventoryPayload({ ...inventory, subjectCode: '9702' }, route.routeId),
  /subjectCode/i,
  'a Physics subject code must not be accepted for a Mathematics route',
)
assert.throws(
  () => validateSyllabusInventoryPayload({ ...inventory, topics: [{ ...inventory.topics[0], routeId: 'cie-9702-as-physics' }] }, route.routeId),
  /routeId/i,
  'topics from a Physics route must not be accepted in the Mathematics inventory',
)

const mathPaper = paperCatalog.items.find((item) => item.kind === 'qp' && item.examProfile?.paperNumber === 1)
const physicsPaper = { ...mathPaper, subject: '9702' }
assert.ok(mathPaper && paperItemMatchesActiveRoute(mathPaper, route))
assert.equal(paperItemMatchesActiveRoute(physicsPaper, route), false)

console.log(JSON.stringify({ status: 'passed', routeId: route.routeId, subject: route.subject, subjectCode: route.subjectCode, stage: route.stage, components: route.paperComponents, inventory: inventory.availableQuestionGroupCount, vocabularyTerms: vocabulary.mappedTermIds.length }))
