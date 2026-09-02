import assert from 'node:assert/strict'
import fs from 'node:fs'

import { CAMBRIDGE_LATEST_SYLLABUS_CATALOG } from '../src/data/syllabus/cambridge-latest-official.js'
import { courseRoutes } from '../src/data/routeRegistry.js'
import { syllabusPracticeComponentsForRoute, supportsSyllabusPracticeRoute } from '../src/lib/syllabusPracticeRoutes.js'
import { syllabusTopicsInventory } from '../src/lib/syllabusPractice.js'

const sourceManifest = JSON.parse(fs.readFileSync(new URL('../docs/latest-syllabus-source-manifest.json', import.meta.url), 'utf8'))
assert.equal(sourceManifest.schemaVersion, 'cambridge-latest-syllabus-source-manifest.v1')

const codes = ['0580', '0606', '0610', '0625', '9231', '9700', '9701', '9702', '9708', '9709']
for (const code of codes) {
  const source = CAMBRIDGE_LATEST_SYLLABUS_CATALOG[code]
  const manifestSource = sourceManifest.sources[code]
  assert.ok(source, `${code} must have a pinned official syllabus source`)
  assert.deepEqual({ version: source.syllabusVersion, url: source.officialUrl, sha256: source.sourceSha256 }, manifestSource, `${code} catalog must match its source manifest`)
  assert.match(source.sourceSha256, /^[A-F0-9]{64}$/)
  assert.ok(source.officialUrl.includes('cambridgeinternational.org/Images/'))
  assert.ok(source.topics.length > 0, `${code} must expose official syllabus topics`)
}

for (const route of courseRoutes.filter((candidate) => codes.includes(candidate.subjectCode))) {
  const source = CAMBRIDGE_LATEST_SYLLABUS_CATALOG[route.subjectCode]
  assert.equal(route.syllabus.version, source.syllabusVersion, `${route.routeId} must use the latest official syllabus version`)
  assert.equal(route.syllabus.url, source.officialUrl, `${route.routeId} must use the pinned official syllabus URL`)
  assert.ok(route.syllabus.topics.length > 0, `${route.routeId} must not fall back to a generic topic list`)
  assert.ok(route.syllabus.topics.every((topic) => topic.points.length > 0), `${route.routeId} topics must retain official point anchors`)
  const topicIds = route.syllabus.topics.map((topic) => topic.id)
  assert.equal(new Set(topicIds).size, topicIds.length, `${route.routeId} topic ids must be unique`)
  const pointIds = route.syllabus.points.map((point) => point.id)
  assert.equal(new Set(pointIds).size, pointIds.length, `${route.routeId} point ids must be unique`)
  assert.equal(supportsSyllabusPracticeRoute(route.routeId), true, `${route.routeId} must expose a Topic Drill route`) 
  assert.ok(syllabusPracticeComponentsForRoute(route.routeId).length > 0, `${route.routeId} must expose theory components for Topic Drill`)
  const inventory = syllabusTopicsInventory({ routeId: route.routeId, questionBank: [], includeStudyOnly: false })
  assert.equal(inventory.topics.length, route.syllabus.topics.length, `${route.routeId} inventory must use the official route topics`)
  assert.equal(inventory.paperComponents.join(','), syllabusPracticeComponentsForRoute(route.routeId).join(','), `${route.routeId} inventory must use the theory component scope`)
}

const physicsA2 = courseRoutes.find((route) => route.routeId === 'cie-9702-a2-physics')
assert.ok(physicsA2.syllabus.topics.every((topic) => topic.components.includes(4)), '9702 A2 Topic Drill taxonomy must remain P4-only')
assert.ok(physicsA2.syllabus.topics.every((topic) => !topic.components.includes(5)), '9702 A2 P5 practical content must stay outside Topic Drill')

console.log(JSON.stringify({ codes: codes.length, routes: courseRoutes.filter((route) => codes.includes(route.subjectCode)).length }))
