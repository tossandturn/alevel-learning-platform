import assert from 'node:assert/strict'

import { formatRouteComponents, routeById } from '../src/data/routeRegistry.js'
import { syllabusTopicsInventory } from '../src/lib/syllabusPractice.js'
import { syllabusPracticeComponentsForRoute } from '../src/lib/syllabusPracticeRoutes.js'

const routes = [
  {
    routeId: 'cie-9709-as-p1-p2',
    components: [1, 2],
    label: 'P1 + P2',
    topicCodes: ['1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '1.8', '2.1', '2.2', '2.3', '2.4', '2.5', '2.6'],
  },
  {
    routeId: 'cie-9709-as-p1-p4',
    components: [1, 4],
    label: 'P1 + M1',
    topicCodes: ['1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '1.8', '4.1', '4.2', '4.3', '4.4', '4.5'],
  },
  {
    routeId: 'cie-9709-as-p1-p5',
    components: [1, 5],
    label: 'P1 + S1',
    topicCodes: ['1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '1.8', '5.1', '5.2', '5.3', '5.4', '5.5'],
  },
  {
    routeId: 'cie-9709-a2-after-p1-p5-p3-p4',
    components: [3, 4],
    label: 'P3 + M1',
    topicCodes: ['3.1', '3.2', '3.3', '3.4', '3.5', '3.6', '3.7', '3.8', '3.9', '4.1', '4.2', '4.3', '4.4', '4.5'],
  },
  {
    routeId: 'cie-9709-a2-after-p1-p5-p3-p6',
    components: [3, 6],
    label: 'P3 + S2',
    topicCodes: ['3.1', '3.2', '3.3', '3.4', '3.5', '3.6', '3.7', '3.8', '3.9', '6.1', '6.2', '6.3', '6.4', '6.5'],
  },
  {
    routeId: 'cie-9709-a2-after-p1-p4-p3-p5',
    components: [3, 5],
    label: 'P3 + S1',
    topicCodes: ['3.1', '3.2', '3.3', '3.4', '3.5', '3.6', '3.7', '3.8', '3.9', '5.1', '5.2', '5.3', '5.4', '5.5'],
  },
]

for (const expected of routes) {
  const route = routeById(expected.routeId)
  assert.ok(route, `${expected.routeId} must be registered`)
  assert.deepEqual(route.paperComponents, expected.components)
  assert.deepEqual(syllabusPracticeComponentsForRoute(route.routeId), expected.components)
  assert.equal(formatRouteComponents(route.paperComponents, route), expected.label)
  assert.deepEqual(route.syllabus.topics.map((topic) => topic.code), expected.topicCodes, `${route.routeId} must expose official syllabus chapters`)
  assert.equal(new Set(route.syllabus.topics.map((topic) => topic.id)).size, route.syllabus.topics.length)
  assert.ok(route.syllabus.topics.every((topic) => topic.routeId === route.routeId))
  assert.ok(route.syllabus.topics.every((topic) => expected.components.includes(Number(topic.component))))

  const inventory = syllabusTopicsInventory({ routeId: route.routeId, questionBank: [] })
  assert.deepEqual(inventory.assessmentComponents.map((item) => item.component), expected.components)
  assert.deepEqual(inventory.topics.map((topic) => topic.code), expected.topicCodes)
}

console.log(JSON.stringify({ status: 'passed', scope: '9709-official-syllabus-routes', routes: routes.length }))
