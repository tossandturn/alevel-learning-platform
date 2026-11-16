import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'

import { seedSyllabusTables } from '../src/lib/syllabusPractice.js'

const db = new DatabaseSync(':memory:')
try {
  db.exec('PRAGMA foreign_keys = ON')
  seedSyllabusTables(db, [])
  const routeId = 'cie-9708-a2-economics'
  const questionId = 'cie-9708-fixture:q1'
  db.prepare(`INSERT INTO route_question_groups
    (route_id,id,stage,subject_code,paper_component,question_paper_id,mark_scheme_id,
     question_pages_json,mark_scheme_pages_json,total_marks,source_content_complete,study_eligible,
     student_study_released,verification_status,source_json,answer_json,parts_json,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(routeId, questionId, 'A2', '9708', 3, 'fixture_qp', 'fixture_ms',
    '[1]', '[1]', 1, 1, 1, 1, 'ai-verified', '{}', '{}', '[]', '2026-11-16T00:00:00Z')
  db.prepare(`INSERT INTO route_question_syllabus_mapping
    (route_id,question_group_id,primary_topic_id,secondary_topic_ids_json,syllabus_point_ids_json,
     confidence,mapping_method,review_status,evidence_json,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(routeId, questionId, '9708-a2-topic-8-1', '[]', '[]', 1, 'fixture', 'reviewed', '{}', '2026-11-16T00:00:00Z')
  const count = (table) => db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE route_id = ? AND ${
    table === 'route_question_groups' ? 'id' : 'question_group_id'} = ?`).get(routeId, questionId).count
  assert.equal(count('route_question_groups'), 1)
  assert.equal(count('route_question_syllabus_mapping'), 1)
  const indexed = db.prepare("SELECT route_id AS routeId, id FROM route_question_groups WHERE verification_status = 'machine-indexed' LIMIT 1").get()
  assert.ok(indexed, 'an indexed source record is needed to detect overwrites')
  db.prepare("UPDATE route_question_groups SET verification_status = 'ai-verified', source_json = ? WHERE route_id = ? AND id = ?")
    .run('{"fixture":"preserve"}', indexed.routeId, indexed.id)
  db.prepare("UPDATE route_question_syllabus_mapping SET review_status = 'reviewed', evidence_json = ? WHERE route_id = ? AND question_group_id = ?")
    .run('{"fixture":"mapping-preserve"}', indexed.routeId, indexed.id)

  seedSyllabusTables(db, [], { preserveMissingAiVerified: true })
  assert.equal(count('route_question_groups'), 1, 'a partial snapshot must not delete previously synchronized AI groups')
  assert.equal(count('route_question_syllabus_mapping'), 1, 'a partial snapshot must not cascade-delete their mappings')
  assert.deepEqual({ ...db.prepare('SELECT verification_status, source_json FROM route_question_groups WHERE route_id = ? AND id = ?')
    .get(indexed.routeId, indexed.id) }, { verification_status: 'ai-verified', source_json: '{"fixture":"preserve"}' },
  'a partial snapshot must not overwrite an AI group with the raw indexed fallback')
  assert.deepEqual({ ...db.prepare('SELECT review_status, evidence_json FROM route_question_syllabus_mapping WHERE route_id = ? AND question_group_id = ?')
    .get(indexed.routeId, indexed.id) }, { review_status: 'reviewed', evidence_json: '{"fixture":"mapping-preserve"}' },
  'a partial snapshot must not overwrite the corresponding AI mapping')

  seedSyllabusTables(db, [])
  assert.equal(count('route_question_groups'), 0, 'a complete snapshot must still remove stale AI groups')
  assert.equal(count('route_question_syllabus_mapping'), 0, 'normal stale removal must still cascade to the mapping')
  console.log(JSON.stringify({ status: 'PASS_LOCAL_ONLY', partialSnapshot: 'preserved', completeSnapshot: 'removed stale rows' }))
} finally {
  db.close()
}
