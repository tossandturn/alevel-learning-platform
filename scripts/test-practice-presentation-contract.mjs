import assert from 'node:assert/strict'
import * as practicePresentation from '../src/lib/practicePresentation.js'
import { recommendForRoute } from '../src/lib/learningProgress.js'

const {
  practiceMetricsSummary,
  practiceUnitMetrics,
  recommendedPracticeMinutes,
  markingStatusForPart,
  topicDisplayNames,
  topicPracticeInventory,
  practiceAttemptMetrics,
  sourceQuestionDisplayLabel,
  responsePresent,
  evidencePresent,
  aggregateTopicPracticeInventory,
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

const attemptMetricsUnit = {
  parts: [
    { id: 'attempt-q1-a', sourceQuestionId: 'paper:q1', displayLabel: 'M25/12 · Q1(a)', marks: 1, answerType: 'numeric', paperComponent: 1 },
    { id: 'attempt-q1-b', sourceQuestionId: 'paper:q1', displayLabel: 'M25/12 · Q1(b)', marks: 2, answerType: 'written', paperComponent: 1 },
    { id: 'attempt-q2-a', sourceQuestionId: 'paper:q2', displayLabel: 'M25/12 · Q2(a)', marks: 1, answerType: 'numeric', paperComponent: 1 },
  ],
}
const attemptMetrics = practiceAttemptMetrics({ answers: { 'attempt-q1-a': 0 } }, attemptMetricsUnit)
assert.equal(attemptMetrics.answeredPartCount, 1, 'numeric zero is an answered part, not an empty response')
assert.equal(attemptMetrics.unansweredAnswerPartCount, 2, 'unanswered counts must use answer parts')
assert.equal(attemptMetrics.answeredQuestionCount, 0, 'a partially answered source question is not complete')
assert.equal(attemptMetrics.unansweredSourceQuestionCount, 2, 'source question completion remains separate from answer-part completion')
assert.equal(sourceQuestionDisplayLabel(attemptMetricsUnit.parts[0], 'Question 1'), 'M25/12 · Q1(a)')
assert.equal(responsePresent(0), true, 'numeric zero must remain a response in every consumer')
assert.equal(evidencePresent({ dataUrl: 'data:image/jpeg;base64,fixture', hasVisualContent: false }), false, 'an explicitly blank handwriting snapshot must not become answer evidence')
assert.equal(evidencePresent({ dataUrl: 'data:image/jpeg;base64,fixture', hasVisualContent: true }), true, 'real handwriting/image evidence must remain eligible')

const topics = [
  { id: 'physics-9702-topic-02', code: '2', name: 'Kinematics' },
  { id: 'physics-9702-topic-03', code: '3', name: 'Dynamics' },
]
assert.deepEqual(topicDisplayNames(['physics-9702-topic-02', 'physics-9702-topic-03'], topics), ['Kinematics', 'Dynamics'])
assert.deepEqual(topicPracticeInventory({
  verifiedQuestionCount: 8,
  studyQuestionCount: 5,
  availableQuestionCount: 13,
  componentCounts: {
    1: { verifiedQuestionCount: 4, studyQuestionCount: 2, availableQuestionCount: 6 },
    2: { verifiedQuestionCount: 4, studyQuestionCount: 3, availableQuestionCount: 7 },
  },
}, [1]), {
  verifiedQuestionCount: 4,
  studyQuestionCount: 2,
  availableQuestionCount: 6,
  indexedQuestionCount: 0,
  pendingReviewCount: 0,
}, 'AI Practice inventory must follow the selected paper component')
assert.deepEqual(topicPracticeInventory({ verifiedQuestionCount: 8, studyQuestionCount: 5, availableQuestionCount: 13 }), {
  verifiedQuestionCount: 8,
  studyQuestionCount: 5,
  availableQuestionCount: 13,
  indexedQuestionCount: 0,
  pendingReviewCount: 0,
}, 'available source questions must not be presented as all formally reviewed')

assert.deepEqual(aggregateTopicPracticeInventory([
  {
    id: 'topic-a',
    questionIdsByComponent: {
      1: {
        indexedQuestionIds: ['q1', 'shared'],
        verifiedQuestionIds: ['q1'],
        studyQuestionIds: ['shared'],
        pendingReviewQuestionIds: ['shared'],
      },
    },
  },
  {
    id: 'topic-b',
    questionIdsByComponent: {
      1: {
        indexedQuestionIds: ['shared', 'q2'],
        verifiedQuestionIds: ['q2'],
        studyQuestionIds: ['shared'],
        pendingReviewQuestionIds: ['shared'],
      },
    },
  },
], [1]), {
  verifiedQuestionCount: 2,
  studyQuestionCount: 1,
  availableQuestionCount: 3,
  indexedQuestionCount: 3,
  pendingReviewCount: 1,
}, 'multi-topic inventory must deduplicate a question mapped to more than one syllabus topic')

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
const paperWorkspaceSource = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('../src/components/PaperWorkspace.jsx', import.meta.url), 'utf8'))
const questionPlayerCss = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('../src/components/QuestionPlayer.css', import.meta.url), 'utf8'))
const historySource = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('../src/components/HistoryView.jsx', import.meta.url), 'utf8'))
const handwritingSource = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('../src/components/HandwritingPad.jsx', import.meta.url), 'utf8'))

assert.match(appSource, /Build multi-topic practice/, 'Topic Drill must expose the multi-topic builder before opening a topic')
assert.match(appSource, /view !== 'practice'/, 'the global Coach must not duplicate the workspace Coach during an attempt')
assert.match(appSource, /recommendForRoute\(\{[\s\S]*topicId: selectedTopicId[\s\S]*\}\)/, 'Recommended must query with the selected topic ID')
assert.match(appSource, /value=\{selectedTopicId \|\| ''\}/, 'Topic focus must bind to a topic ID instead of a display label or search query')
assert.match(appSource, /AiPracticeLanding activeRoute=\{activeRoute\} selectedTopicId=\{selectedTopicId\}/, 'AI Practice must inherit the current Topic focus instead of silently resetting to the first topic')
assert.match(appSource, /topicPracticeInventory\(topic, selectedComponents\)/, 'AI Practice must calculate inventory for the selected paper components')
assert.match(appSource, /available for study only/, 'study-only inventory must be explicit in AI Practice')
assert.match(appSource, /const syllabusComponents = syllabusPracticeComponentsForRoute\(activeRoute\.routeId\)/, 'AI Practice must use the canonical route component allowlist')
assert.match(appSource, /defaultComponents\.map\(\(component\)/, 'AI Practice must not expose raw practical or out-of-route components')
assert.match(appSource, /activeRoute\.subjectCode === '9702' && Number\(component\) === 3/, 'practical labeling must use subject semantics, not a global component number')
assert.match(appSource, /Browse practice/, 'Saved empty state must offer a discoverable path back to practice')
assert.match(appSource, /topic-detail__question-picker/, 'Topic details must expose a keyword-searchable question picker')
assert.match(appSource, /Search question text, source, mark points, or tags/, 'Topic question search must clearly search question content, not only topic titles')
assert.match(appSource, /Build selected set/, 'Topic question search must let students build a set from selected source questions')
assert.match(appSource, /sourceQuestionIds: selectedQuestionIdsForBuild/, 'selected topic questions must be sent to the server as exact sourceQuestionIds')
assert.doesNotMatch(appSource, /function openAiPractice\(\)[\s\S]{0,220}setCoachBuilderOpenRequest/, 'opening AI Practice must not duplicate the builder inside Coach')
assert.doesNotMatch(paperLibrarySource, /item\.sha256\.slice/, 'student paper rows must not expose file hashes')
assert.doesNotMatch(paperLibrarySource, /catalogState\.catalog\.totals\.bytes/, 'student Papers must not expose storage diagnostics')
assert.match(paperWorkspaceSource, /const coachAvailable = studyMode === 'past-paper-practice' \|\| submitted/, 'Past-paper practice must allow Coach before submit while Exam Simulation keeps the submit boundary')
assert.match(workspaceSource, /unansweredAnswerPartCount/, 'submit confirmation must use the canonical unanswered answer-part count')
assert.match(workspaceSource, /answer part is|answer parts are/, 'submit confirmation must describe unresolved answer parts explicitly')
assert.match(workspaceSource, /sourceQuestionDisplayLabel/, 'question navigation must identify the source paper and question')
assert.match(workspaceSource, /paperCount/, 'practice workspace must display the canonical paper count')
assert.match(workspaceSource, /totalMarks/, 'practice workspace must display the canonical total marks')
assert.match(workspaceSource, /qp-answer-list--multi/, 'multi-part answers must be rendered with a dedicated horizontal layout class')
assert.match(questionPlayerCss, /qp-answer-list--multi[\s\S]*grid-template-columns: repeat\(auto-fit, minmax\(300px, 1fr\)\)/, 'multi-part answers must lay out horizontally on desktop')
assert.match(workspaceSource, /Semantic-reviewed/, 'reviewed written parts must use the student-facing semantic-reviewed status')
assert.match(workspaceSource, /official question/, 'student practice metrics must call question groups official questions')
assert.doesNotMatch(workspaceSource, /metrics\.markTotal|source question\{/, 'student practice metrics must use the canonical totalMarks and official-question terminology')
assert.doesNotMatch(workspaceSource, /Source-backed study set|Verified past-paper set|It has been quarantined/, 'student practice must not expose internal source-gate terminology')
assert.match(workspaceSource, /Select one option/, 'MCQ instructions must not reuse written-response copy')
assert.match(handwritingSource, /hasVisualResponseRef/, 'blank handwriting pads must track whether visual response content exists')
assert.match(handwritingSource, /!hasVisualResponseRef\.current/, 'submit flush must skip blank handwriting pads')
assert.match(handwritingSource, /hasVisualContent: true/, 'saved handwriting evidence must identify real visual content')
assert.doesNotMatch(historySource, /SHA-256/, 'student exports must show the downloaded filename instead of an internal checksum')
assert.match(paperAnswerSheetSource, /showSubmitAction/, 'the paper answer sheet must allow PaperWorkspace to keep one primary submit action')

console.log('Practice presentation contract passed.')
