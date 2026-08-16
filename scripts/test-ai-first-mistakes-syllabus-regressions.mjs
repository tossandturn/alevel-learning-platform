import assert from 'node:assert/strict'
import fs from 'node:fs'
import { normalizeState } from '../src/lib/storage.js'

const normalized = normalizeState({
  profile: { activeRouteId: 'cie-9702-as-physics', learningTrack: 'AS' },
  paperSessions: [
    null,
    { attemptId: '', routeId: 'cie-9702-as-physics' },
    {
      attemptId: 'legacy-paper-1',
      routeId: 'cie-9702-as-physics',
      paperId: 'cie-9702-9702_m25_qp_12',
      file: '9702_m25_qp_12.pdf',
      questionCount: '1',
      answeredCount: '1',
      answers: { 1: { choice: 'A' } },
      profile: { mode: 'mcq' },
      completedAt: '2026-08-16T00:00:00.000Z',
    },
  ],
  paperReviews: [
    null,
    { attemptId: '', selfMarks: { 1: 0 } },
    { attemptId: 'legacy-paper-1', routeId: 'cie-9702-as-physics', selfMarks: { 1: 0 }, maxMarksByQuestion: { 1: 1 } },
  ],
})

assert.equal(normalized.paperSessions.length, 1, 'legacy null paper sessions must be removed before Mistakes renders')
assert.equal(normalized.paperSessions[0].attemptId, 'legacy-paper-1')
assert.equal(normalized.paperSessions[0].questionCount, 1)
assert.equal(normalized.paperReviews.length, 1, 'legacy null paper reviews must be removed before Mistakes renders')
assert.equal(normalized.paperReviews[0].selfMarks[1], 0, 'explicit zero paper marks must survive normalization')

const appSource = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
assert.match(appSource, /safePaperSessions/, 'App must consume sanitized paper sessions so one bad record cannot blank the page')
assert.match(appSource, /function LibraryView\([\s\S]*onReviewAction,[\s\S]*\)/, 'LibraryView must receive the review queue handler as a prop instead of closing over App internals')
assert.match(appSource, /<MistakeList mistakes=\{mistakes\} paperMistakes=\{paperMistakes\} startPractice=\{startPractice\} retestPaper=\{retestPaper\} onReviewAction=\{onReviewAction\} \/>/, 'Practice > Mistakes must not reference an out-of-scope review handler')
assert.match(appSource, /markingLifecycle\.complete && markingLifecycle\.provisionalCriteria\.length > 0/, 'blank submissions must not finalize an empty score result')
assert.match(appSource, /AI review first, then self-mark/, 'pending submitted work must present AI review as the first marking step')
assert.match(appSource, /Record self-mark after AI review/, 'self-mark action must be explicitly secondary to the AI-first review step')
assert.doesNotMatch(appSource, /<h1>Ready to self-mark<\/h1>/, 'pending result page must not make self-marking look like the first step')

const paperLibrarySource = fs.readFileSync(new URL('../src/components/PaperLibrary.jsx', import.meta.url), 'utf8')
assert.match(paperLibrarySource, /function routeNoteForActiveRoute/, 'Papers must compute syllabus guidance for route-scoped entry points')
assert.match(paperLibrarySource, /activeRouteNote[\s\S]*Official syllabus/, 'route-scoped Papers must render the official syllabus link')

console.log('AI-first, Mistakes and Papers syllabus regressions passed.')
