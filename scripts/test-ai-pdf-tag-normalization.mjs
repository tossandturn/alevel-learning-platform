import assert from 'node:assert/strict'

import { normalizePageWindowResponse } from './ingest-ai-pdf-questions.mjs'

const normalized = normalizePageWindowResponse({
  questions: [{
    questionNumber: '12',
    questionStartPage: 27,
    regions: [],
    diagramRegions: [],
    parts: [],
    tags: {
      primaryTopicId: 'physics-9702-topic-23',
      secondaryTopicIds: [],
      syllabuPointIds: ['physics-9702-point-23-1-01'],
    },
    markSchemeEvidence: [],
  }],
})

assert.deepEqual(normalized.questions[0].tags.syllabusPointIds, ['physics-9702-point-23-1-01'])
assert.equal('syllabuPointIds' in normalized.questions[0].tags, false)

const canonicalWins = normalizePageWindowResponse({
  questions: [{
    questionNumber: '1',
    questionStartPage: 1,
    tags: {
      primaryTopicId: 'physics-9702-topic-13',
      secondaryTopicIds: [],
      syllabusPointIds: ['physics-9702-point-13-1-01'],
      syllabuPointIds: ['physics-9702-point-13-1-02'],
    },
  }],
})
assert.deepEqual(canonicalWins.questions[0].tags.syllabusPointIds, ['physics-9702-point-13-1-01'])
assert.equal('syllabuPointIds' in canonicalWins.questions[0].tags, false)

console.log(JSON.stringify({ status: 'passed', checks: 4 }))
