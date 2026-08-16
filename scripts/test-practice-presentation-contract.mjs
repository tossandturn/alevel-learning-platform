import assert from 'node:assert/strict'
import * as practicePresentation from '../src/lib/practicePresentation.js'
import { recommendForRoute } from '../src/lib/learningProgress.js'

const {
  practiceMetricsSummary,
  practiceUnitMetrics,
  recommendedPracticeMinutes,
  markingStatusForPart,
  topicDisplayNames,
} = practicePresentation

const mixedUnit = {
  subjectCode: '9702',
  questionGroupCount: 10,
  referencePapers: [
    { id: 'paper-p1-a' },
    { id: 'paper-p1-b' },
    { id: 'paper-p2-a' },
  ],
  parts: [
    ...Array.from({ length: 8 }, (_, index) => ({
      id: `p1-${index + 1}`,
      sourceQuestionId: `q-${index + 1}`,
      paperComponent: 1,
      marks: index < 2 ? 2 : 1,
      ...(index === 0 ? { answerKey: 'D', reviewStatus: 'reviewed' } : {}),
      ...(index === 1 ? { aiAssistedMarkingAvailable: true, reviewStatus: 'reviewed' } : {}),
      sourceRef: { paperId: index < 4 ? 'paper-p1-a' : 'paper-p1-b', component: 1 },
    })),
    ...Array.from({ length: 11 }, (_, index) => ({
      id: `p2-${index + 1}`,
      sourceQuestionId: `q-${Math.min(10, index + 1)}`,
      paperComponent: 2,
      marks: index < 10 ? 2 : 1,
      sourceRef: { paperId: 'paper-p2-a', component: 2 },
    })),
  ],
}

assert.deepEqual(practiceUnitMetrics(mixedUnit), {
  sourceQuestionCount: 10,
  answerPartCount: 19,
  paperCount: 3,
  totalMarks: 31,
  autoScoredPartCount: 1,
  selfMarkPartCount: 17,
  semanticReviewedPartCount: 1,
})
assert.equal(typeof practiceMetricsSummary, 'function', 'practice metrics must expose one student-facing summary formatter')
assert.equal(practiceMetricsSummary(mixedUnit), '10 official questions · 19 answer parts · 31 marks')
assert.equal(recommendedPracticeMinutes(mixedUnit), 45, 'P1 and P2 timing must be accumulated from each component, not a fixed per-question default')

const largerMixedUnit = {
  subjectCode: '9702',
  parts: [
    { id: 'p1', sourceQuestionId: 'q1', paperComponent: 1, marks: 40 },
    { id: 'p2', sourceQuestionId: 'q2', paperComponent: 2, marks: 34 },
  ],
}
assert.equal(recommendedPracticeMinutes(largerMixedUnit), 118, 'a 74-mark P1/P2 set must not be capped at a generic 60 minutes')

assert.deepEqual(markingStatusForPart({ answerKey: 'D', reviewStatus: 'reviewed' }), {
  mode: 'auto-scored',
  label: 'Auto-scored',
  detail: 'Your selected option is checked against the reviewed answer key after submission.',
  formalMasteryEligible: true,
})
assert.deepEqual(markingStatusForPart({ answerKey: 'D', reviewStatus: 'machine-indexed' }), {
  mode: 'auto-scored',
  label: 'Auto-scored',
  detail: 'Your selected option can be checked, but this result stays outside formal mastery until source review is complete.',
  formalMasteryEligible: false,
})
assert.equal(markingStatusForPart({ aiAssistedMarkingAvailable: true, reviewStatus: 'reviewed' }).label, 'Semantic-reviewed')
assert.equal(markingStatusForPart({ reviewStatus: 'machine-indexed' }).label, 'Self-mark')

const topics = [
  { id: 'physics-9702-topic-02', code: '2', name: 'Kinematics' },
  { id: 'physics-9702-topic-03', code: '3', name: 'Dynamics' },
]
assert.deepEqual(topicDisplayNames(['physics-9702-topic-02', 'physics-9702-topic-03'], topics), ['Kinematics', 'Dynamics'])

const recommendationUnits = [
  {
    id: 'topic-1-set',
    routeId: 'cie-9702-as-physics',
    knowledgeGroupId: 'physics-9702-topic-01',
    parts: Array.from({ length: 10 }, (_, index) => ({ id: `topic-1-${index}` })),
  },
  {
    id: 'topic-2-set',
    routeId: 'cie-9702-as-physics',
    knowledgeGroupId: 'physics-9702-topic-02',
    parts: Array.from({ length: 10 }, (_, index) => ({ id: `topic-2-${index}` })),
  },
]
assert.equal(recommendForRoute({
  attempts: [],
  drafts: {},
  units: recommendationUnits,
  routeId: 'cie-9702-as-physics',
  topicId: 'physics-9702-topic-02',
}).unit?.id, 'topic-2-set', 'Topic focus must be the sole topic source for Recommended')

const appSource = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8'))
const workspaceSource = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('../src/components/PracticeWorkspace.jsx', import.meta.url), 'utf8'))
const paperLibrarySource = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('../src/components/PaperLibrary.jsx', import.meta.url), 'utf8'))
const paperAnswerSheetSource = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('../src/components/PaperAnswerSheet.jsx', import.meta.url), 'utf8'))
const historySource = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('../src/components/HistoryView.jsx', import.meta.url), 'utf8'))

assert.match(appSource, /Build multi-topic practice/, 'Topic Drill must expose the multi-topic builder before opening a topic')
assert.match(appSource, /view !== 'practice'/, 'the global Coach must not duplicate the workspace Coach during an attempt')
assert.match(appSource, /recommendForRoute\(\{[\s\S]*topicId: selectedTopicId[\s\S]*\}\)/, 'Recommended must query with the selected topic ID')
assert.match(appSource, /value=\{selectedTopicId \|\| ''\}/, 'Topic focus must bind to a topic ID instead of a display label or search query')
assert.match(appSource, /Browse practice/, 'Saved empty state must offer a discoverable path back to practice')
assert.doesNotMatch(appSource, /function openAiPractice\(\)[\s\S]{0,220}setCoachBuilderOpenRequest/, 'opening AI Practice must not duplicate the builder inside Coach')
assert.doesNotMatch(paperLibrarySource, /item\.sha256\.slice/, 'student paper rows must not expose file hashes')
assert.doesNotMatch(paperLibrarySource, /catalogState\.catalog\.totals\.bytes/, 'student Papers must not expose storage diagnostics')
assert.match(workspaceSource, /answer part is|answer parts are/, 'submit confirmation must name unanswered answer parts, not source questions')
assert.match(workspaceSource, /official question/, 'student practice metrics must call question groups official questions')
assert.doesNotMatch(workspaceSource, /metrics\.markTotal|source question\{/, 'student practice metrics must use the canonical totalMarks and official-question terminology')
assert.doesNotMatch(workspaceSource, /Source-backed study set|Verified past-paper set|It has been quarantined/, 'student practice must not expose internal source-gate terminology')
assert.match(workspaceSource, /Select one option/, 'MCQ instructions must not reuse written-response copy')
assert.doesNotMatch(historySource, /SHA-256/, 'student exports must show the downloaded filename instead of an internal checksum')
assert.match(paperAnswerSheetSource, /showSubmitAction/, 'the paper answer sheet must allow PaperWorkspace to keep one primary submit action')

console.log('Practice presentation contract passed.')
