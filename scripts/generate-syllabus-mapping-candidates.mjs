import { syllabusMappingCandidates } from '../src/lib/syllabusPractice.js'

const candidates = syllabusMappingCandidates()
const byTopic = Object.groupBy(candidates, (candidate) => candidate.primaryTopicId || 'unmapped')
const output = {
  schemaVersion: 'question-syllabus-mapping-audit-v1',
  generatedAt: new Date().toISOString(),
  policy: 'Candidates are pending until a human reviewer records source/QP/MS evidence.',
  routeId: 'cie-9702-as-physics',
  totals: {
    candidates: candidates.length,
    pending: candidates.filter((candidate) => candidate.reviewStatus !== 'reviewed').length,
    reviewed: candidates.filter((candidate) => candidate.reviewStatus === 'reviewed').length,
    sourceComplete: candidates.filter((candidate) => candidate.sourceContentComplete).length,
  },
  byTopic: Object.fromEntries(Object.entries(byTopic).map(([topicId, rows]) => [topicId, {
    indexed: rows.length,
    pending: rows.filter((row) => row.reviewStatus !== 'reviewed').length,
    reviewed: rows.filter((row) => row.reviewStatus === 'reviewed').length,
    questionGroupIds: rows.map((row) => row.questionGroupId),
  }])),
  candidates,
}

console.log(JSON.stringify(output, null, 2))
