import assert from 'node:assert/strict'
import { Readable } from 'node:stream'

import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'
import { routeById } from '../src/data/routeRegistry.js'
import {
  MIN_QUESTION_GROUPS_PER_TEST,
  MIN_VERIFIED_GROUPS_FOR_PRACTICE,
  topicPracticeEligibility,
} from '../src/lib/practiceConstants.js'
import { SYLLABUS_PRACTICE_ROUTE_IDS } from '../src/lib/syllabusPracticeRoutes.js'

function call(api, { method, url, body }) {
  return new Promise((resolve, reject) => {
    const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')])
    request.method = method
    request.url = url
    request.headers = body === undefined ? {} : { 'content-type': 'application/json' }
    const response = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[String(name).toLowerCase()] = value },
      end(raw = '') {
        const text = String(raw || '')
        resolve({ statusCode: this.statusCode, payload: text ? JSON.parse(text) : null })
      },
    }
    Promise.resolve(api(request, response, () => reject(new Error(`Unhandled ${method} ${url}`)))).catch(reject)
  })
}

const api = createStemApi({
  env: {
    NODE_ENV: 'test',
    STEM_DB_PATH: ':memory:',
    STEM_IDENTITY_SIGNING_KEY: 'chapter-independent-start-contract-key',
  },
})
const routeReports = []
let chapterCount = 0
let officialChapterCount = 0
let officialGapCount = 0

try {
  assert.equal(MIN_QUESTION_GROUPS_PER_TEST, 6)
  assert.equal(MIN_VERIFIED_GROUPS_FOR_PRACTICE, 12)
  assert.deepEqual(
    topicPracticeEligibility({ verifiedQuestionCount: 1, availableQuestionCount: 1 }),
    {
      ready: false,
      studyReady: false,
      releasedStudyReady: false,
      reviewedSubsetStudy: false,
      ctaPolicy: 'hidden',
      availableSetSizes: [],
    },
    'A one-question chapter-study source must not relax the legacy Topic Drill 6/12 gate.',
  )
  assert.equal(SYLLABUS_PRACTICE_ROUTE_IDS.length, 22)
  for (const routeId of SYLLABUS_PRACTICE_ROUTE_IDS) {
    const route = routeById(routeId)
    assert.ok(route, routeId)
    const inventory = await call(api, {
      method: 'GET',
      url: `/api/stem/routes/${routeId}/syllabus-topics?foundationCatalog=v2`,
    })
    assert.equal(inventory.statusCode, 200, `${routeId}: ${inventory.payload?.error || ''}`)
    assert.equal(inventory.payload.chapterStudy.topicCount, route.syllabus.topics.length)
    assert.equal(inventory.payload.chapterStudy.startableTopicCount, route.syllabus.topics.length)

    let routeOfficialChapters = 0
    let routeOfficialGaps = 0
    for (const topic of inventory.payload.topics) {
      chapterCount += 1
      const componentEntries = Object.entries(topic.componentCounts || {})
        .filter(([, counts]) => counts?.chapterStudy?.startable)
      assert.ok(componentEntries.length > 0, `${routeId}/${topic.id} needs a startable component scope`)
      const [componentKey, componentCounts] = componentEntries[0]
      const component = Number(componentKey)
      assert.ok(Number.isInteger(component), `${routeId}/${topic.id} component`)

      if (topic.chapterStudy.officialAvailable > 0) {
        officialChapterCount += 1
        routeOfficialChapters += 1
      } else {
        officialGapCount += 1
        routeOfficialGaps += 1
      }

      const single = await call(api, {
        method: 'POST',
        url: '/api/stem/practice-sets',
        body: {
          routeId,
          syllabusTopicIds: [topic.id],
          components: [component],
          questionCount: 15,
          studyMode: 'chapter-study',
          sourcePreference: 'original-foundation-only',
          foundationCatalog: 'v1',
          excludeAttempted: false,
        },
      })
      assert.equal(single.statusCode, 201, `${routeId}/${topic.id}: ${single.payload?.error || ''}`)
      assert.deepEqual(
        { available: single.payload.available, count: single.payload.count, limited: single.payload.limited },
        { available: 1, count: 1, limited: true },
        `${routeId}/${topic.id} must start independently from one complete chapter question`,
      )
      assert.deepEqual(single.payload.sourceMix, { official: 0, originalFoundation: 1 })
      assert.equal(single.payload.practiceMode, 'study-only')
      assert.equal(single.payload.formalProgressEligible, false)
      assert.deepEqual(single.payload.coveredSyllabusTopicIds, [topic.id])

      const expectedAvailable = Number(componentCounts.chapterStudy.available)
      const officialFirst = await call(api, {
        method: 'POST',
        url: '/api/stem/practice-sets',
        body: {
          routeId,
          syllabusTopicIds: [topic.id],
          components: [component],
          questionCount: 15,
          studyMode: 'chapter-study',
          sourcePreference: 'official-first',
          foundationCatalog: 'v2',
          excludeAttempted: false,
        },
      })
      assert.equal(officialFirst.statusCode, 201, `${routeId}/${topic.id}: ${officialFirst.payload?.error || ''}`)
      assert.equal(officialFirst.payload.available, expectedAvailable)
      assert.equal(officialFirst.payload.count, Math.min(15, expectedAvailable))
      assert.equal(officialFirst.payload.limited, expectedAvailable < 15)
      assert.equal(officialFirst.payload.practiceMode, 'study-only')
      assert.equal(officialFirst.payload.formalProgressEligible, false)
      assert.deepEqual(officialFirst.payload.coveredSyllabusTopicIds, [topic.id])
      assert.ok(officialFirst.payload.questionGroups.every((group) => (
        group.syllabusMapping.topicIds.includes(topic.id)
        && group.formalProgressEligible === false
      )), `${routeId}/${topic.id} returned a cross-chapter group`)
    }
    routeReports.push({
      routeId,
      chapters: route.syllabus.topics.length,
      officialAvailableChapters: routeOfficialChapters,
      officialGapChapters: routeOfficialGaps,
    })
  }
} finally {
  closeStemDatabaseForTests()
}

assert.equal(chapterCount, 222)
assert.equal(officialChapterCount + officialGapCount, 222)
console.log(JSON.stringify({
  status: 'PASS_CHAPTER_INDEPENDENT_START',
  routeCount: SYLLABUS_PRACTICE_ROUTE_IDS.length,
  chapterCount,
  independentlyStartableChapters: chapterCount,
  officialAvailableChapters: officialChapterCount,
  officialGapChapters: officialGapCount,
  formalMinimumUnchanged: 12,
  routeReports,
}))
