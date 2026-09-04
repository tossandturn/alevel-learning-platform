import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'

import { studyQuestionBank } from '../src/data/questionBank.js'
import { routeById } from '../src/data/routeRegistry.js'
import {
  seedSyllabusTables,
  syllabusDatabaseInventory,
  syllabusTopicsInventory,
} from '../src/lib/syllabusPractice.js'

const routeIds = [
  'cie-9709-as-p1-p2',
  'cie-9709-as-p1-p4',
  'cie-9709-as-p1-p5',
  'cie-9709-a2-after-p1-p5-p3-p4',
  'cie-9709-a2-after-p1-p5-p3-p6',
  'cie-9709-a2-after-p1-p4-p3-p5',
]

const database = new DatabaseSync(':memory:')
try {
  seedSyllabusTables(database, [])
  for (const routeId of routeIds) {
    assert.equal(
      syllabusDatabaseInventory(database, routeId).length,
      routeById(routeId).syllabus.topics.length,
      `${routeId} must retain its own route-scoped syllabus rows`,
    )
  }

  seedSyllabusTables(database, studyQuestionBank)
  for (const routeId of routeIds) {
    const staticInventory = syllabusTopicsInventory({ routeId, questionBank: studyQuestionBank })
    const databaseInventory = syllabusDatabaseInventory(database, routeId)
    assert.deepEqual(
      databaseInventory.map((topic) => ({
        id: topic.id,
        indexed: topic.indexedQuestionCount,
        verified: topic.verifiedQuestionCount,
        study: topic.studyQuestionCount,
        available: topic.availableQuestionCount,
      })),
      staticInventory.topics.map((topic) => ({
        id: topic.id,
        indexed: topic.indexedQuestionCount,
        verified: topic.verifiedQuestionCount,
        study: topic.studyQuestionCount,
        available: topic.availableQuestionCount,
      })),
      `${routeId} SQLite count/list inventory must match the canonical in-memory eligibility result`,
    )
  }

  console.log(JSON.stringify({ status: 'passed', scope: 'syllabus-database-route-isolation', routes: routeIds.length }))
} finally {
  database.close()
}
