import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { importedPdfLibrary, practiceUnits } from '../src/data/catalog.js'
import { learningPlan, stagesForComponentTags } from '../src/data/learningPlan.js'
import { getExamPaperProfile, getRouteOptions, getStageGuidance } from '../src/data/examStructure.js'
import { reviewAttempt } from '../src/lib/aiReview.js'
import { latestBphoSpcPaper, parseCoachIntent } from '../src/lib/coachIntent.js'
import { isHumanReviewedPastPaperItem, isVerifiedPastPaperItem, paperQuestionMarkingMetadata, selectTaggedQuestions, unifiedQuestionBank } from '../src/data/questionBank.js'
import { buildCoachPractice, buildVerifiedPracticeCatalog, verifiedPracticeCatalogMetrics } from '../src/lib/coachPractice.js'
import { pointerSamples } from '../src/lib/inkStroke.js'
import { buildSharedMarkingSubmission, completedMarksByQuestion, createSharedMarkingSubmission, paperSubmissionMarkingSummary, retrySharedMarkingSubmission, waitForSharedMarkingSubmission } from '../src/lib/paperMarking.js'
import { buildCompletionByUnit, buildLearningEvents, buildLearningProgress, recommendForRoute } from '../src/lib/learningProgress.js'
import { scoreAttempt } from '../src/lib/scoring.js'
import { buildCoachSystemPrompt, normalizeMarkResult, parseStructuredJson, providerConfig } from '../server/aiApi.js'
import { buildLegacyQuestionGroup, normalisePartLabel, normaliseQuestionGroup, validateQuestionGroup } from '../src/data/questionParts.js'
import { COURSE_STAGE_ORDER } from '../src/data/stages.js'
import { ARCHIVE_SOURCES, BPHO_ROUNDS, archiveSeasonLabel, buildArchiveStats } from '../src/data/competitionArchive.js'
import { stagesForSubject } from '../src/data/audience.js'

const unitIds = new Set(practiceUnits.map((unit) => unit.id))
assert.equal(unitIds.size, practiceUnits.length, 'practice unit IDs must be unique')

assert.equal(pointerSamples({ nativeEvent: { clientX: 10, clientY: 12, getCoalescedEvents: () => [] } }).length, 1, 'an empty Safari coalesced-event list must retain the current pointer sample')

assert.deepEqual(parseStructuredJson('```json\n{"rawMarks":2}\n```'), { rawMarks: 2 }, 'AI JSON parser must accept fenced structured output')
assert.match(buildCoachSystemPrompt({ verifiedSubmitted: false, hintLevel: 4 }), /Do not reveal the final answer or a complete worked solution/, 'unverified Coach prompt must forbid answer leakage')
assert.doesNotMatch(buildCoachSystemPrompt({ submitted: true, hintLevel: 5 }), /complete worked correction is allowed/, 'client-supplied submission state must not unlock a worked answer')
assert.match(buildCoachSystemPrompt({ verifiedSubmitted: true, hintLevel: 5 }), /complete worked correction is allowed/, 'a future server-verified submission may unlock correction')
assert.deepEqual(normalizeMarkResult({ rawMarks: 9, maxMarks: 3, confidence: 0.4, markPoints: [] }, 3), {
  rawMarks: 3,
  maxMarks: 3,
  confidence: 0.4,
  reviewRequired: true,
  summary: 'Handwritten response reviewed.',
  recognizedWork: '',
  correctedSolution: '',
  nextAction: '',
  markPoints: [],
}, 'vision marks must be bounded and low-confidence results must require review')

const qwenProviders = providerConfig({ DASHSCOPE_API_KEY: 'test-only', COACH_AI_MODEL: 'qwen-coach-test', VISION_AI_MODEL: 'qwen-vision-test' })
assert.equal(qwenProviders.provider, 'qwen', 'AI routing must use Qwen')
assert.equal(qwenProviders.coach.apiKey, 'test-only', 'Coach must inherit the IELTS-ist DashScope key')
assert.equal(qwenProviders.coach.model, 'qwen-coach-test', 'Coach must use its Qwen model override')
assert.equal(qwenProviders.vision.model, 'qwen-vision-test', 'Vision marking must use its Qwen vision model override')
assert.equal(providerConfig({ OPENAI_API_KEY: 'legacy-only' }).coach.apiKey, '', 'OpenAI credentials must not silently replace Qwen')

assert.deepEqual(parseCoachIntent('给我一套最新的bpho的spc的真题 带答案'), {
  type: 'open-latest-paper',
  contest: 'bpho-spc',
  label: 'BPhO Senior Physics Challenge',
}, 'BPhO SPC Coach request must become a platform action')
assert.deepEqual(parseCoachIntent('帮我组织一套 AS 物理波章节的 10 道真题'), {
  type: 'build-topic-practice',
  subjectId: 'physics',
  subjectCode: '9702',
  stage: 'AS',
  knowledgeGroupId: 'physics-9702-topic-07',
  questionCount: 10,
  sourceRequest: 'verified-topic-drill',
}, 'AS Physics Waves Coach request must become a chapter drill action')
assert.equal(parseCoachIntent('A2 化学有机专题 15 道真题').knowledgeGroupId, 'chemistry-9701-organic', 'Coach must route Chemistry by syllabus topic')
assert.equal(parseCoachIntent('A2 经济国际经济专题 10 道题').knowledgeGroupId, 'economics-9708-international', 'Coach must route Economics by syllabus topic')
assert.equal(parseCoachIntent('BPhO 力学 10 道练习').knowledgeGroupId, 'bpho-mechanics', 'BPhO must remain a parallel olympiad qualification')
assert.equal(parseCoachIntent('ESAT Physics 10 questions').knowledgeGroupId, 'esat-physics', 'ESAT modules must route independently')
assert.equal(parseCoachIntent('TMUA proof 10 questions').knowledgeGroupId, 'tmua-proof', 'TMUA topics must route independently')
assert.equal(parseCoachIntent('0610 IGCSE Biology cells 10 questions').subjectCode, '0610', 'IGCSE Biology must route to 0610')
assert.equal(parseCoachIntent('9700 AS Biology transport 10 questions').subjectCode, '9700', 'A-Level Biology must route to 9700')
assert.equal(parseCoachIntent('Give me an AS Physics past-paper set').type, 'clarify-practice', 'an ambiguous subject request must ask for a topic instead of guessing')

const paperAnswerSheetSource = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'components', 'PaperAnswerSheet.jsx'), 'utf8')
const handwritingPadSource = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'components', 'HandwritingPad.jsx'), 'utf8')
assert.ok(paperAnswerSheetSource.includes('<HandwritingPad'), 'structured paper questions must use the unified handwriting pad')
assert.ok(paperAnswerSheetSource.includes('pdfInkActive && !submitted'), 'submitted paper questions must keep the original answer evidence visible')
assert.ok(!paperAnswerSheetSource.includes('Show your working'), 'structured paper questions must not expose a separate working field')
assert.ok(!paperAnswerSheetSource.includes('Final answer</span>'), 'structured paper questions must not expose a separate final-answer field')
assert.ok(paperAnswerSheetSource.includes("questionMetadataByNumber[questionNumber]?.reviewStatus === 'reviewed'"), 'paper AI-review copy must be gated by reviewed question metadata')
assert.ok(handwritingPadSource.includes('aiReviewEligible ?'), 'handwriting status copy must distinguish reviewed AI-assisted and self-mark evidence')
assert.ok(handwritingPadSource.includes('self-mark with the paired mark scheme after submission'), 'unreviewed handwriting must direct students to the paired mark scheme')

const appSource = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'App.jsx'), 'utf8')
assert.ok(appSource.includes('unifiedQuestionBank'), 'topic detail must read the decoupled question bank')
assert.ok(appSource.includes('topic-detail__paper-group'), 'topic detail must render grouped real-paper questions')
const paperLibrarySource = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'components', 'PaperLibrary.jsx'), 'utf8')
assert.ok(paperLibrarySource.includes("activeRoute?.stage === 'Competition'"), 'competition archives must bypass Cambridge component filtering')
assert.ok(paperLibrarySource.includes("filters.subject === 'bpho' ? 'Round'"), 'BPhO archive must expose a first-class Round filter')
assert.ok(paperLibrarySource.includes('routeComponents.includes(component)'), 'route-scoped Paper selectors must be built from the route component allowlist')
const coachSource = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'components', 'AiCoach.jsx'), 'utf8')
assert.ok(coachSource.includes('context.routeId') && coachSource.includes('context.stage') && coachSource.includes('context.view'), 'Coach storage keys must include route, stage and view')
assert.ok(coachSource.includes('canOpenBphoSpc'), 'BPhO Coach quick action must be guarded by the Competition route')
const paperWorkspaceSource = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'components', 'PaperWorkspace.jsx'), 'utf8')
assert.ok(paperWorkspaceSource.includes('pdfInkMapVersion === 2'), 'legacy inferred PDF ink mappings must be quarantined')
assert.ok(paperWorkspaceSource.includes('linkPdfInkToQuestion'), 'PDF ink must require an explicit answer-slot link before it counts as a response')
assert.ok(!paperWorkspaceSource.includes('Number(ink.questionNumber) || focusedQuestion'), 'PDF ink must not infer a question number from current focus')

assert.equal(practiceUnits.length, 0, 'formal practice must not expose generated seed questions')
const verifiedPracticeCatalog = buildVerifiedPracticeCatalog()
const verifiedCatalogMetrics = verifiedPracticeCatalogMetrics(verifiedPracticeCatalog)
assert.deepEqual(verifiedCatalogMetrics, { units: 142, questionGroups: 891, answerableParts: 932, referencedPapers: 51, routes: 25, topics: 88 }, 'all verified indexed question groups must be exposed as stable route/topic practice units')
assert.equal(new Set(verifiedPracticeCatalog.map((unit) => unit.id)).size, verifiedPracticeCatalog.length, 'verified practice unit IDs must be stable and unique')
assert.ok(verifiedPracticeCatalog.every((unit) => unit.parts.every((part) => part.routeId === unit.routeId && part.stage === unit.stage && part.sourceRef?.sha256 && part.answerRef?.sha256)), 'catalog practice units must preserve route, stage and independent QP/MS provenance')
const catalogAnswerParts = verifiedPracticeCatalog.flatMap((unit) => unit.parts)
assert.equal(catalogAnswerParts.filter((part) => part.aiAssistedMarkingAvailable).length, 0, 'machine-indexed source records must never unlock AI-assisted marking')
assert.equal(catalogAnswerParts.filter((part) => part.deterministicScoringAvailable).length, 769, 'only source-bound objective answers may use deterministic scoring')
assert.equal(catalogAnswerParts.filter((part) => !part.aiAssistedMarkingAvailable && !part.deterministicScoringAvailable).length, 163, 'structured machine-indexed items must remain explicitly self-mark only')
const asPhysicsRecommendation = recommendForRoute({
  units: verifiedPracticeCatalog,
  routeId: 'cie-9702-as-physics',
})
assert.ok(asPhysicsRecommendation.unit.parts.length >= 10, 'a new student must be recommended a complete verified set when their route contains one')
assert.equal(asPhysicsRecommendation.unit.routeId, 'cie-9702-as-physics', 'recommendations must remain route-isolated')
const verifiedFixture = unifiedQuestionBank.find((item) => item.routeId === 'cie-9702-as-physics' && item.answerType === 'multiple-choice' && item.answerKey)
assert.ok(verifiedFixture, 'a real 9702 MCQ fixture must be indexed')
const verifiedUnit = { routeId: verifiedFixture.routeId, stage: verifiedFixture.stage, maxMarks: verifiedFixture.marks, parts: [{ ...verifiedFixture, id: 'verified-fixture' }] }
const blankResult = scoreAttempt(verifiedUnit, {}, 0)
assert.equal(blankResult.rawMarks, 0, 'blank attempt must score zero')
assert.equal(blankResult.maxMarks, verifiedUnit.maxMarks)
const perfectResult = scoreAttempt(verifiedUnit, { 'verified-fixture': verifiedFixture.answerKey }, 124)
assert.equal(perfectResult.rawMarks, verifiedUnit.maxMarks, 'a bound official answer must reach full marks')
const assistedReview = reviewAttempt(verifiedUnit, { 'verified-fixture': verifiedFixture.answerKey })
assert.equal(assistedReview.awarded, verifiedUnit.maxMarks, 'assisted review should preserve deterministic scoring for a bound item')
assert.equal(assistedReview.officialResult, false, 'assisted review must not present as an official result')

const selfMarkUnit = {
  id: 'self-mark-fixture',
  routeId: 'cie-9702-as-physics',
  stage: 'AS',
  subjectId: 'physics-9702',
  knowledgeGroupId: 'physics-9702-topic-03',
  topic: 'Forces',
  maxMarks: 4,
  parts: [{ id: 'self-mark-part', marks: 4, answerType: 'written', deterministicScoringAvailable: false, aiAssistedMarkingAvailable: false, markPoints: ['point 1', 'point 2', 'point 3', 'point 4'] }],
}
const selfMarkPendingAttempt = { id: 'pending-self-mark', unitId: selfMarkUnit.id, routeId: selfMarkUnit.routeId, stage: selfMarkUnit.stage, attemptStatus: 'self-mark-pending', submittedAt: '2026-08-10T00:00:00.000Z', selfMarkPending: true }
assert.equal(buildLearningEvents({ attempts: [selfMarkPendingAttempt], units: [selfMarkUnit], routeId: selfMarkUnit.routeId }).length, 0, 'self-mark-pending submissions must not create learning events')
assert.equal(buildLearningProgress({ attempts: [selfMarkPendingAttempt], units: [selfMarkUnit], routeId: selfMarkUnit.routeId }).completedSets, 0, 'self-mark-pending submissions must not change mastery or weekly completion')
assert.equal(buildCompletionByUnit({ attempts: [selfMarkPendingAttempt], units: [selfMarkUnit], routeId: selfMarkUnit.routeId })[selfMarkUnit.id].completed, false, 'self-mark-pending submissions must not mark a unit complete')
assert.ok(learningPlan.knowledgeGroups.length >= 10, 'learning plan should expose a usable subject knowledge map')
assert.ok(learningPlan.practiceModes.some((mode) => mode.id === 'mock-exam'), 'learning plan should expose mock exam mode')
assert.deepEqual(new Set(learningPlan.subjects.map((subject) => subject.code)), new Set(['0580', '0606', '0610', '0625', '9231', '9700', '9701', '9702', '9708', '9709']), 'knowledge map must expose all requested Cambridge subjects')
assert.ok(unifiedQuestionBank.length >= 40, 'question-level index must contain a real starter bank')
assert.ok(unifiedQuestionBank.every(isVerifiedPastPaperItem), 'formal topic drills must contain only QP/MS-bound items')
assert.ok(unifiedQuestionBank.every((item) => item.sourceRef.sha256 !== item.answerRef.sha256), 'question and answer documents must remain independently bound')

const mixedPhysicsDrill = selectTaggedQuestions({
  routeId: 'cie-9702-as-physics',
  qualificationId: 'cambridge-9702',
  stage: 'AS',
  knowledgeGroupId: 'physics-9702-topic-03',
  questionCount: 10,
})
assert.equal(mixedPhysicsDrill.length, 10, 'a verified topic drill must contain the requested item count')
assert.ok(new Set(mixedPhysicsDrill.map((item) => item.answerType)).size >= 1, 'topic drills should expose at least one validated answer surface')
assert.ok(new Set(mixedPhysicsDrill.map((item) => item.sourceRef.paperId)).size >= 2, 'topic drills should draw from more than one official paper when available')
assert.ok(mixedPhysicsDrill.every((item) => item.answerBinding && item.answerRef), 'every selected question must retain its paired answer binding')
assert.ok(mixedPhysicsDrill.every((item) => item.routeId === 'cie-9702-as-physics' && item.stage === 'AS'), 'AS drills must never contain A2 or IGCSE questions')
const mixedPhysicsUnit = buildCoachPractice({ routeId: 'cie-9702-as-physics', knowledgeGroupId: 'physics-9702-topic-03', questionCount: 10 })
assert.ok(mixedPhysicsUnit.parts.every((part) => part.displayLabel), 'mixed-paper practice parts must expose a readable source label')
assert.equal(new Set(mixedPhysicsUnit.parts.map((part) => part.displayLabel)).size, mixedPhysicsUnit.parts.length, 'mixed-paper practice labels must remain unique when printed question numbers repeat')
const nextPhysicsDrill = selectTaggedQuestions({ routeId: 'cie-9702-as-physics', qualificationId: 'cambridge-9702', stage: 'AS', knowledgeGroupId: 'physics-9702-topic-03', questionCount: 10, questionOffset: 10 })
assert.ok(nextPhysicsDrill.length > 0, 'a topic with more than ten verified questions must expose a second distinct set')
assert.equal(new Set([...mixedPhysicsDrill, ...nextPhysicsDrill].map((item) => item.sourceQuestionId)).size, mixedPhysicsDrill.length + nextPhysicsDrill.length, 'successive practice sets must not repeat source question groups')

const march2025P1Metadata = paperQuestionMarkingMetadata({ paperId: 'cie-9709-9709_m25_qp_12', routeId: 'cie-9709-as-p1-p2' })
assert.equal(march2025P1Metadata[1], undefined, 'machine-indexed 9709 March 2025 P1 Q1 must remain self-mark only until a human review is recorded')
const reviewedMarch2025Fixture = {
  ...unifiedQuestionBank.find((item) => item.sourceQuestionId === 'cie-9709-9709_m25_qp_12:q1' && item.routeId === 'cie-9709-as-p1-p2'),
  answerBinding: { ...unifiedQuestionBank.find((item) => item.sourceQuestionId === 'cie-9709-9709_m25_qp_12:q1' && item.routeId === 'cie-9709-as-p1-p2').answerBinding, verificationStatus: 'reviewed' },
}
assert.equal(isHumanReviewedPastPaperItem(reviewedMarch2025Fixture), true, 'only a reviewed binding may become AI-marking metadata')
const reviewedMarch2025Metadata = paperQuestionMarkingMetadata({ paperId: 'cie-9709-9709_m25_qp_12', routeId: 'cie-9709-as-p1-p2', questionBank: [reviewedMarch2025Fixture] })
assert.equal(reviewedMarch2025Metadata[1].maxMarks, 4, 'a reviewed Q1 fixture must hydrate its exact four-mark allocation')
assert.equal(reviewedMarch2025Metadata[1].answerRef.file, '9709_m25_ms_12.pdf', 'a reviewed fixture must bind the exact paired mark scheme')
assert.ok(reviewedMarch2025Metadata[1].expectedMarkPoints.length >= 4, 'a reviewed fixture must provide structured mark points')
const march2025P1Submission = buildSharedMarkingSubmission({
  attemptId: 'fixture-attempt',
  routeId: 'cie-9709-as-p1-p2',
  specificationVersion: '2025-2027',
  paperId: 'cie-9709-9709_m25_qp_12',
  responses: [{
    questionNumber: 1,
    questionMetadata: reviewedMarch2025Metadata[1],
    typedText: 'Use the discriminant and require it to be less than zero.',
    questionAsset: { status: 'available', imageDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+1P6Q6QAAAABJRU5ErkJggg==' },
  }],
})
assert.equal(march2025P1Submission.ok, true, 'reviewed paper metadata and a typed response must build a shared structured marking submission')
assert.equal(march2025P1Submission.payload.questions[0].availableMarks, 4, 'shared marking requests must carry the reviewed available marks')
assert.equal(march2025P1Submission.payload.questions[0].assets[0].checksum, `sha256:${reviewedMarch2025Metadata[1].sourceRef.sha256}`, 'shared marking requests must carry the exact question-paper checksum')
assert.ok(march2025P1Submission.payload.questions[0].assets[0].imageDataUrl.startsWith('data:image/png'), 'shared marking requests must carry the same QuestionPart page image alongside handwriting')
assert.equal(march2025P1Submission.payload.questions[0].visualContext.status, 'available', 'available source imagery must be declared to the shared marker')
assert.deepEqual(buildSharedMarkingSubmission({ attemptId: 'fixture-attempt', responses: [{ questionNumber: 2, questionMetadata: null, typedText: 'answer' }] }).missingQuestionNumbers, [2], 'missing question metadata must be explicit before any shared marking call')
assert.doesNotMatch(paperSubmissionMarkingSummary({ submitted: true, aiMarks: { 2: { status: 'missing_metadata' } }, responseQuestionNumbers: [2] }).text, /AI marking|AI review|processing/i, 'self-mark-only paper feedback must not imply AI marking')
assert.equal(paperSubmissionMarkingSummary({ submitted: true, aiMarks: { 1: { status: 'completed' } }, responseQuestionNumbers: [1] }).tone, 'success', 'completed shared marking must render a success state')
assert.equal(paperSubmissionMarkingSummary({ submitted: true, aiMarks: { 2: { status: 'missing_metadata' } }, responseQuestionNumbers: [2] }).tone, 'missing', 'missing metadata must never render as processing')
assert.equal(paperSubmissionMarkingSummary({ submitted: true, aiMarks: { 1: { status: 'failed' } }, responseQuestionNumbers: [1] }).tone, 'error', 'shared provider failure must render a truthful saved-answer state')
const completedPaperMarks = completedMarksByQuestion({
  status: 'completed',
  result: { questions: [{ questionPartId: march2025P1Submission.payload.questions[0].questionPartId, awardedMarks: 3, maxMarks: 4, confidence: 0.91, reviewRequired: false, markPoints: [] }] },
}, march2025P1Submission.questionNumberByPartId)
assert.deepEqual([completedPaperMarks[1].rawMarks, completedPaperMarks[1].maxMarks], [3, 4], 'completed shared marks must return to their original printed question number')

const sharedFetchCalls = []
const queuedResponse = { submission: { submissionId: march2025P1Submission.payload.submissionId, status: 'queued', retryable: false } }
const sharedFetch = async (url, options = {}) => {
  sharedFetchCalls.push({ url, options })
  return new Response(JSON.stringify(queuedResponse), { status: 202, headers: { 'Content-Type': 'application/json' } })
}
const createdShared = await createSharedMarkingSubmission({ token: 'shared-test-token', submission: march2025P1Submission.payload, fetchImpl: sharedFetch })
assert.equal(createdShared.status, 'queued', 'shared marking create must expose the exact queued state')
assert.equal(sharedFetchCalls[0].url, 'https://ieltsist.com/api/stem/marking/submissions', 'shared marking must call the IELTSist-owned endpoint')
assert.equal(sharedFetchCalls[0].options.credentials, 'include', 'shared marking must include the IELTSist session cookie')
assert.equal(sharedFetchCalls[0].options.headers['X-Stem-Identity'], 'shared-test-token', 'shared marking must send the short-lived STEM identity')
assert.deepEqual(JSON.parse(sharedFetchCalls[0].options.body), JSON.parse(JSON.stringify(march2025P1Submission.payload)), 'shared marking body must preserve the stable submission contract')

const missingMetadataShared = await createSharedMarkingSubmission({
  token: 'shared-test-token',
  submission: march2025P1Submission.payload,
  fetchImpl: async () => new Response(JSON.stringify({ submission: { submissionId: 'missing-fixture', status: 'missing_metadata', metadataIssues: ['mark_allocation_mismatch'] } }), { status: 422 }),
})
assert.equal(missingMetadataShared.status, 'missing_metadata', '422 metadata rejection must stay missing_metadata and never become processing')

let statusRead = 0
const statusFlow = async (_url, _options = {}) => {
  statusRead += 1
  const submission = statusRead === 1
    ? { submissionId: 'status-fixture', status: 'queued' }
    : statusRead === 2
      ? { submissionId: 'status-fixture', status: 'processing' }
      : { submissionId: 'status-fixture', status: 'completed', result: { questions: [{ questionPartId: march2025P1Submission.payload.questions[0].questionPartId, awardedMarks: 4, maxMarks: 4, confidence: 0.95, reviewRequired: false, markPoints: [] }] } }
  return new Response(JSON.stringify({ submission }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
const completedShared = await waitForSharedMarkingSubmission({ token: 'shared-test-token', submissionId: 'status-fixture', fetchImpl: statusFlow, attempts: 4, intervalMs: 1 })
assert.equal(completedShared.status, 'completed', 'shared marking status polling must finish at completed')
assert.equal(statusRead, 3, 'shared marking polling must read queued, processing and completed exactly once')
const retriedShared = await retrySharedMarkingSubmission({ token: 'shared-test-token', submissionId: 'status-fixture', fetchImpl: async (_url, _options) => {
  assert.equal(_url, 'https://ieltsist.com/api/stem/marking/submissions/status-fixture/retry', 'retry must use the IELTSist retry endpoint')
  assert.equal(_options.method, 'POST', 'retry must be a POST')
  return new Response(JSON.stringify({ submission: { submissionId: 'status-fixture', status: 'queued' } }), { status: 202 })
} })
assert.equal(retriedShared.status, 'queued', 'failed shared submissions must be retryable through the shared service')

const igcseBiologyDrill = buildCoachPractice({ routeId: 'cie-0610-igcse-biology', knowledgeGroupId: 'biology-0610-cell', questionCount: 10 })
assert.equal(igcseBiologyDrill.parts.length, 10, '0610 Cells must unlock a ten-question verified drill')
assert.ok(igcseBiologyDrill.parts.every(isVerifiedPastPaperItem), '0610 drill must retain verified question bindings')
const a2BiologyDrill = buildCoachPractice({ routeId: 'cie-9700-a2-biology', knowledgeGroupId: 'biology-9700-a2-energy', questionCount: 10, allowPartial: true })
assert.ok(a2BiologyDrill.parts.length >= 1, '9700 A2 Energy must expose its currently verified inventory')
assert.ok(a2BiologyDrill.parts.every((item) => item.routeId === 'cie-9700-a2-biology'), 'A2 Biology drill cannot contain AS or IGCSE questions')

const questionIndex = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'data', 'importedQuestionIndex.json'), 'utf8'))
assert.equal(questionIndex.schemaVersion, 2, 'question index must use the decoupled schema')
assert.equal(questionIndex.questions.length, questionIndex.answers.length, 'every indexed question must have one answer entity')
assert.equal(questionIndex.questions.length, questionIndex.bindings.length, 'every indexed question must have one binding entity')
assert.equal(new Set(questionIndex.questions.map((item) => item.questionId)).size, questionIndex.questions.length, 'question IDs must remain stable and unique')
assert.equal(new Set(questionIndex.answers.map((item) => item.answerId)).size, questionIndex.answers.length, 'answer IDs must remain stable and unique')
assert.ok(questionIndex.questions.every((item) => item.specificationId && item.syllabusMapping?.mappingStatus), 'questions must retain syllabus version and mapping status')
assert.ok(questionIndex.questions.every((item) => !('answer' in item) && !('answerRef' in item) && !('markPoints' in item)), 'question entities must not embed answers')
assert.ok(questionIndex.answers.every((item) => !('prompt' in item) && !('sourceRef' in item)), 'answer entities must not embed question text')
assert.ok(questionIndex.bindings.every((item) => ['machine-indexed', 'reviewed', 'quarantined'].includes(item.verificationStatus)), 'bindings must disclose their verification state')
assert.ok(questionIndex.bindings.some((item) => item.verificationStatus === 'quarantined'), 'legacy multi-part records must be disclosed as quarantined')
assert.ok(unifiedQuestionBank.every((item) => validateQuestionGroup(item).valid), 'every formal item must have reconciled question parts')
assert.ok(!unifiedQuestionBank.some((item) => item.sourceQuestionId === 'cie-0625-0625_m25_qp_42:q1'), 'the known 0625 multi-part OCR record must stay out of the scored bank')
assert.ok(!unifiedQuestionBank.some((item) => item.sourceQuestionId === 'cie-9702-9702_m25_qp_22:q1'), 'the known 9702 multi-part OCR record must stay out of the scored bank')
assert.ok(questionIndex.questions.every((item) => !(item.parts || []).some((part) => part.answerKey || part.answerText || part.markSchemePoints)), 'question entities must not embed answer-part data')
assert.ok(questionIndex.answers.every((item) => Array.isArray(item.answerParts)), 'answer entities must own the independently bound answer parts')

const legacyMultiPart = buildLegacyQuestionGroup({ questionId: 'fixture-q1', prompt: 'Calculate x.\n(a) Show that x = 2. [2]\n(b) Find y. [1]', marks: 1, answerType: 'handwritten' }, { markPoints: ['method', 'result'] })
assert.equal(legacyMultiPart.status, 'quarantined', 'a legacy full-page multi-part prompt must never become a scored item')
const structuredFixture = {
  questionGroupId: 'fixture-q2',
  totalMarks: 3,
  parts: [
    { partId: 'fixture-q2:part-a', promptFragment: 'Show that x = 2.', marks: 2, answerArea: { type: 'handwritten' }, markSchemePoints: ['method', 'result'] },
    { partId: 'fixture-q2:part-b', promptFragment: 'Find y.', marks: 1, answerArea: { type: 'handwritten' }, markSchemePoints: ['correct value'] },
  ],
}
assert.equal(validateQuestionGroup(structuredFixture).valid, true, 'structured parts must reconcile to the group total')
assert.equal(normalisePartLabel('(b)(i)'), 'b(i)', 'nested printed part labels must remain distinct')
const nestedGroup = normaliseQuestionGroup({
  questionId: 'fixture-q3',
  totalMarks: 3,
  parts: [
    { partId: 'fixture-q3:part-a', label: 'a', promptFragment: 'Explain.', marks: 2, answerArea: { type: 'handwritten' } },
    { partId: 'fixture-q3:part-b(i)', label: 'b(i)', promptFragment: 'Calculate.', marks: 1, answerArea: { type: 'handwritten' } },
  ],
}, {
  answerParts: [
    { partId: 'fixture-q3:part-a', label: 'a', marks: 2, markSchemePoints: ['point 1', 'point 2'], answerText: 'A' },
    { partId: 'fixture-q3:part-b(i)', label: 'b(i)', marks: 1, markSchemePoints: ['point 3'], answerText: 'B' },
  ],
})
assert.equal(nestedGroup.status, 'verified', 'QP and MS nested parts must bind as separate scored parts')
assert.deepEqual(nestedGroup.parts.map((part) => [part.label, part.marks]), [['a', 2], ['b(i)', 1]])
const multiPartScore = scoreAttempt({ routeId: 'cie-9702-a2-physics', stage: 'A2', maxMarks: 3, parts: nestedGroup.parts.map((part) => ({
  ...part,
  id: part.partId,
  answerType: 'handwritten',
  expectedKeywords: part.label === 'a' ? ['correct', 'explain'] : ['value'],
  markPoints: part.markSchemePoints,
})) }, { 'fixture-q3:part-a': 'correct explain', 'fixture-q3:part-b(i)': 'value' }, 10)
assert.equal(multiPartScore.rawMarks, 3, 'multi-part scoring must accumulate marks per QuestionPart')
const a2Group = unifiedQuestionBank.find((item) => item.routeId === 'cie-9702-a2-physics' && item.parts.length > 1)
assert.ok(a2Group, '9702 A2 must expose at least one verified multi-part QuestionGroup')
const a2Practice = buildCoachPractice({ routeId: 'cie-9702-a2-physics', knowledgeGroupId: a2Group.knowledgeGroupId, questionCount: 10, allowPartial: true })
assert.ok(a2Practice.parts.length >= a2Group.parts.length, 'Coach practice must flatten a verified group into explicit QuestionParts')
assert.ok(a2Practice.parts.every((part) => part.routeId === 'cie-9702-a2-physics' && part.stage === 'A2'), 'A2 Coach practice must never contain AS or IGCSE parts')
assert.ok(a2Practice.parts.every((part) => part.questionGroupId && part.questionPartId && part.sourceRef.page && part.answerRef.page), 'every Coach item must preserve group, part, QP page, and MS page bindings')
const exactAssignedPractice = buildCoachPractice({ routeId: 'cie-9702-a2-physics', knowledgeGroupId: a2Group.knowledgeGroupId, sourceQuestionIds: [a2Group.bankId], unitId: 'assignment-test' })
assert.equal(exactAssignedPractice.questionGroupCount, 1, 'an assigned source list must not be expanded to the normal ten-question drill minimum')
assert.equal(exactAssignedPractice.parts.length, a2Group.parts.length, 'an assignment must reopen the exact saved question group, including every QuestionPart')
assert.deepEqual(exactAssignedPractice.assignmentSourceIds, [a2Group.bankId], 'an assignment must retain its immutable source question IDs')
assert.throws(() => buildCoachPractice({ routeId: 'cie-9702-a2-physics', knowledgeGroupId: a2Group.knowledgeGroupId, sourceQuestionIds: [a2Group.bankId, a2Group.bankId] }), /duplicate question IDs/, 'duplicate assignment sources must be rejected')

const physicsPaper1 = getExamPaperProfile('9702', '12')
assert.equal(physicsPaper1.mode, 'mcq', '9702 Paper 1 must use the MCQ answer sheet')
assert.equal(physicsPaper1.defaultQuestionCount, 40, '9702 Paper 1 must expose 40 MCQ responses')
assert.deepEqual(getExamPaperProfile('9702', '42').stages, ['a2', 'full'], '9702 Paper 4 must be an A2/full A Level component')
assert.equal(getExamPaperProfile('9709', '12').mode, 'structured', '9709 Paper 1 must not use an MCQ answer sheet')
assert.deepEqual(getExamPaperProfile('9709', '22').stages, ['as'], '9709 Paper 2 must remain AS-only')
assert.ok(getStageGuidance('9709', 'a2').includes('P3 + P4'), '9709 A2 guidance must preserve the official route choice')
assert.deepEqual(getRouteOptions('9709', 'full').map((route) => route.papers), [[1, 3, 4, 5], [1, 3, 5, 6]], '9709 full A Level routes must remain mutually explicit')
assert.deepEqual(getRouteOptions('9231', 'as').map((route) => route.papers), [[1, 3], [1, 4]], '9231 AS routes must preserve the applied-paper choice')
assert.deepEqual(getRouteOptions('9231', 'a2').map((route) => route.papers), [[2, 4], [2, 3]], '9231 Year 2 routes must add the applied paper not taken at AS')
assert.deepEqual(getRouteOptions('9231', 'full').map((route) => route.papers), [[1, 2, 3, 4]], '9231 full A Level route must include all four components')
assert.equal(getExamPaperProfile('9709', '51', 2018).title, 'Mechanics 2', 'legacy 9709 Paper 5 must not use the current S1 title')
assert.equal(getExamPaperProfile('9709', '61', 2018).title, 'Probability & Statistics 1', 'legacy 9709 Paper 6 must use its historical title')
assert.equal(getExamPaperProfile('9709', '71', 2018).title, 'Probability & Statistics 2', 'legacy 9709 Paper 7 must remain discoverable')
assert.equal(getExamPaperProfile('9702', '6', 2006).title, 'Options', 'legacy 9702 Paper 6 must remain discoverable')
assert.equal(getExamPaperProfile('9709', '1+2+3+4+5+6+7', 2003).mode, 'reference', 'combined mark schemes must not masquerade as Paper 1')
assert.equal(getExamPaperProfile('0580', '22', 2025).title, 'Extended (Non-calculator)', 'current 0580 Paper 2 profile must be available')
assert.equal(getExamPaperProfile('0580', '42', 2025).maxMarks, 100, 'current 0580 Extended calculator paper must use 100 marks')
assert.equal(getExamPaperProfile('0580', '42', 2024).maxMarks, null, 'legacy 0580 papers must not inherit current marks')
assert.equal(getExamPaperProfile('0606', '12', 2025).durationMinutes, 120, '0606 Paper 1 timing must be available')
assert.equal(getExamPaperProfile('0606', '22', 2025).title, 'Paper 2 (Calculator)', '0606 Paper 2 calculator profile must be available')
assert.equal(getExamPaperProfile('9701', '12', 2026).defaultQuestionCount, 40, '9701 Paper 1 profile must follow the current syllabus')
assert.equal(getExamPaperProfile('9708', '32', 2026).defaultQuestionCount, 30, '9708 Paper 3 profile must follow the current syllabus')
assert.deepEqual(getRouteOptions('9700', 'as').map((route) => route.papers), [[1, 2, 3]], '9700 AS route must preserve the official component set')
assert.deepEqual(getRouteOptions('9700', 'a2').map((route) => route.papers), [[4, 5]], '9700 A2 route must preserve the official component set')
assert.equal(getExamPaperProfile('0610', '4', 2026).title, 'Theory (Extended)', '0610 Extended theory must use the correct paper profile')

const totalImported = importedPdfLibrary.reduce((sum, item) => sum + item.files, 0)
assert.equal(totalImported, 10689, 'downloaded PDF library count changed')

const catalogPath = path.resolve(import.meta.dirname, '..', 'public', 'data', 'papers.json')
const paperCatalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
assert.equal(paperCatalog.schemaVersion, 1, 'paper catalog schema changed')
assert.equal(paperCatalog.items.length, 10689, 'paper catalog must contain every downloaded file')
const cieSubjects = new Set(['0580', '0606', '0610', '0625', '9231', '9700', '9701', '9702', '9708', '9709'])
const cieCatalogItems = paperCatalog.items.filter((paper) => cieSubjects.has(paper.subject))
assert.equal(cieCatalogItems.length, 10073, 'CIE PDF library count changed')
assert.equal(cieCatalogItems.reduce((sum, paper) => sum + paper.bytes, 0), 3093572350, 'CIE byte total changed')
assert.equal(paperCatalog.totals.bySubject['0610'], 154, '0610 PDF library count changed')
assert.equal(paperCatalog.totals.bySubject['9700'], 114, '9700 PDF library count changed')
assert.equal(paperCatalog.totals.bySubject['0625'], 1616, '0625 PDF library count changed')
assert.equal(paperCatalog.totals.bySubject['9701'], 1401, '9701 PDF library count changed')
assert.equal(paperCatalog.totals.bySubject['9708'], 988, '9708 PDF library count changed')
assert.equal(paperCatalog.totals.bySubject.bpho, 228, 'BPhO PDF library count changed')
assert.equal(paperCatalog.totals.bySubject.amc12, 306, 'AMC12 PDF library count changed')
assert.equal(paperCatalog.totals.bySubject.esat, 37, 'ESAT PDF library count changed')
assert.equal(paperCatalog.totals.bySubject.tmua, 45, 'TMUA PDF library count changed')
const bphoArchive = buildArchiveStats(paperCatalog.items, 'bpho')
assert.deepEqual(
  [bphoArchive.files, bphoArchive.questionPapers, bphoArchive.pairedQuestionPapers, bphoArchive.yearLabel],
  [228, 133, 78, '2002-2025'],
  'BPhO archive summary must reflect the verified local files',
)
assert.deepEqual(bphoArchive.rounds.map((round) => round.value), BPHO_ROUNDS.map((round) => round.value), 'BPhO archive must expose R1, R2, SPC, IPC, PC and Experimental rounds in product order')
assert.deepEqual(
  Object.fromEntries(bphoArchive.rounds.map((round) => [round.value, round.questionPapers])),
  { r1: 40, r2: 22, spc: 18, ipc: 23, pc: 20, expt: 10 },
  'BPhO round filters must retain every locally available historical question paper',
)
assert.deepEqual(bphoArchive.rounds.find((round) => round.value === 'pc').missingYears, [2005], 'BPhO Physics Challenge must expose the broken official 2005 source as an archive gap')
assert.equal(archiveSeasonLabel('bpho', 'spc'), 'Senior Physics Challenge', 'BPhO raw season codes must not leak into student UI')
assert.ok(ARCHIVE_SOURCES.bpho.every((source) => source.relationship === 'Official archive'), 'BPhO source links must be identified as official archives')
assert.ok(ARCHIVE_SOURCES.amc12.some((source) => source.relationship === 'Published with MAA permission'), 'AMC12 archive provenance must state its MAA permission relationship')
assert.equal(cieCatalogItems.filter((paper) => paper.kind === 'qp').length, 4619, 'CIE question-paper total changed')
assert.equal(cieCatalogItems.filter((paper) => paper.kind === 'qp' && paper.markSchemeId).length, 4576, 'CIE question/mark-scheme pairing total changed')
assert.equal(cieCatalogItems.filter((paper) => paper.kind === 'qp' && !paper.markSchemeId).length, 43, 'CIE unpaired question-paper total changed')
assert.equal(new Set(paperCatalog.items.map((item) => item.id)).size, paperCatalog.items.length, 'paper IDs must be unique')
for (const paper of paperCatalog.items) {
  assert.match(paper.sha256, /^[a-f0-9]{64}$/, `${paper.file} must have a SHA-256 checksum`)
  assert.ok(paper.localUrl.startsWith(`/local-pdf/${paper.subject}/`), `${paper.file} must use the local PDF route`)
}

const currentPhysicsMcq = paperCatalog.items.find((paper) => paper.subject === '9702' && paper.year === 2025 && paper.kind === 'qp' && paper.examProfile?.paperNumber === 1)
assert.equal(currentPhysicsMcq.examProfile.defaultQuestionCount, 40, 'current 9702 P1 metadata must reach the generated catalog')
const currentMathP1 = paperCatalog.items.find((paper) => paper.subject === '9709' && paper.year === 2025 && paper.kind === 'qp' && paper.examProfile?.paperNumber === 1)
assert.equal(currentMathP1.examProfile.mode, 'structured', 'current 9709 P1 catalog record must expose structured inputs')
assert.equal(paperCatalog.items.find((paper) => paper.file === '9709_s18_qp_51.pdf').examProfile.title, 'Mechanics 2', 'catalog must retain the pre-2020 9709 Paper 5 structure')
assert.equal(paperCatalog.items.find((paper) => paper.file === '9709_s18_qp_71.pdf').examProfile.paperNumber, 7, 'catalog must retain legacy 9709 Paper 7')
assert.equal(paperCatalog.items.find((paper) => paper.file === '9702_s06_qp_6.pdf').examProfile.title, 'Options', 'catalog must retain legacy 9702 Paper 6')
assert.equal(paperCatalog.items.find((paper) => paper.file === '9709_s03_ms_1+2+3+4+5+6+7.pdf').examProfile.paperNumber, null, 'combined mark scheme must not be labeled Paper 1')
assert.deepEqual(paperCatalog.items.find((paper) => paper.file === '9709_s18_qp_51.pdf').examProfile.routeIds, [], 'current 9709 routes must not relabel legacy papers')
assert.ok(paperCatalog.items.find((paper) => paper.subject === '9709' && paper.year === 2025 && paper.kind === 'qp' && paper.examProfile?.paperNumber === 5).examProfile.routeIds.includes('as-p1-p5'), 'current 9709 P5 must belong to the P1 + S1 AS route')

const pairedPaper = paperCatalog.items.find((paper) => paper.kind === 'qp' && paper.markSchemeId)
assert.ok(pairedPaper, 'catalog should pair question papers with mark schemes')
const pairedMarkScheme = paperCatalog.items.find((paper) => paper.id === pairedPaper.markSchemeId)
assert.equal(pairedMarkScheme.pairKey, pairedPaper.pairKey, 'paired paper and mark scheme must share provenance key')
assert.ok(paperCatalog.items.find((paper) => paper.file === 'amc12-2025A-exam.pdf')?.markSchemeId, 'AMC12 exams must link to an answer/solutions file')
assert.ok(paperCatalog.items.find((paper) => paper.file === 'TMUA-2023-paper-1.pdf')?.markSchemeId, 'TMUA papers must link to worked answers')
assert.ok(paperCatalog.items.find((paper) => paper.file === 'ENGAA_2023_S1_QuestionPaper.pdf')?.markSchemeId, 'ESAT prep papers must link to answer keys')
assert.equal(paperCatalog.items.find((paper) => paper.file === 'ESAT_Guide_Physics.pdf')?.kind, 'guide', 'ESAT subject guides must stay as reference material')
assert.equal(paperCatalog.items.find((paper) => paper.file === '2021_PC_Mark.pdf')?.kind, 'ms', 'BPhO mark files must not be treated as question papers')
assert.equal(paperCatalog.items.find((paper) => paper.file === '2021_PC.pdf')?.markSchemeId, 'bpho-2021_PC_Mark', 'BPhO physics challenge must link to its mark scheme')
assert.deepEqual(
  [paperCatalog.items.find((paper) => paper.file === 'BPhO_Paper1_2005_QP.pdf')?.year, paperCatalog.items.find((paper) => paper.file === 'BPhO_Paper1_2005_QP.pdf')?.yearSource],
  [2004, 'official source-page heading'],
  'legacy BPhO Physics Challenge years must follow the official page label rather than the PDF filename',
)
assert.equal(paperCatalog.items.find((paper) => paper.file === 'BPhO_Paper1_2011_QP.pdf')?.year, 2010, 'the official Physics Challenge year offset must be retained through the final legacy file')
assert.equal(paperCatalog.items.some((paper) => paper.subject === 'bpho' && paper.season === 'pc' && paper.year === 2005), false, 'the broken official 2005 Physics Challenge links must remain an explicit archive gap')
assert.equal(latestBphoSpcPaper(paperCatalog.items)?.file, 'BPhO_SPC_2025_QP.pdf', 'Coach latest BPhO SPC action must resolve the current paired paper')
assert.equal(paperCatalog.items.find((paper) => paper.file === 'ENGAA_2023_S1_QuestionPaper.pdf')?.examProfile.defaultQuestionCount, 40, 'ESAT ENGAA prep paper must expose 40 MCQ responses')
assert.equal(paperCatalog.items.find((paper) => paper.file === 'NSAA_2016_S1_QuestionPaper.pdf')?.examProfile.defaultQuestionCount, 54, 'ESAT legacy NSAA 2016 paper must expose 54 MCQ responses')
assert.equal(paperCatalog.items.find((paper) => paper.file === 'NSAA_2020_S1_QuestionPaper.pdf')?.examProfile.defaultQuestionCount, 40, 'ESAT legacy NSAA 2020 paper must expose 40 MCQ responses')

const sharedMarkSchemePaper = paperCatalog.items.find((paper) => paper.file === '0625_s03_qp_1.pdf')
const sharedMarkScheme = paperCatalog.items.find((paper) => paper.id === sharedMarkSchemePaper.markSchemeId)
assert.equal(sharedMarkScheme.file, '0625_s03_ms_1+2+3+5+6.pdf', 'shared mark scheme must explicitly include the paper variant')

const numericUnit = {
  maxMarks: 2,
  parts: [{ id: 'numeric-fixture', marks: 2, answerType: 'numeric', acceptedValue: 3, tolerance: 0.02, acceptedUnits: ['m/s^2'], markPoints: ['method', 'answer'] }],
}
assert.equal(scoreAttempt(numericUnit, { 'numeric-fixture': '3 m/s^2' }, 1).criteria[0].awarded, 2)
assert.equal(scoreAttempt(numericUnit, { 'numeric-fixture': '3 kg' }, 1).criteria[0].awarded, 1)
assert.equal(scoreAttempt(numericUnit, { 'numeric-fixture': '3.03 m/s^2' }, 1).criteria[0].awarded, 0)

const finalValueUnit = {
  maxMarks: 1,
  parts: [{ id: 'final-value', marks: 1, answerType: 'numeric', acceptedValue: 5, tolerance: 0, acceptedUnits: [], markPoints: ['final value'] }],
}
assert.equal(scoreAttempt(finalValueUnit, { 'final-value': 'sqrt(3^2 + (-4)^2) = 5' }, 1).rawMarks, 1, 'numeric scoring must use the final value after the last equals sign')

const mcqUnit = {
  maxMarks: 1,
  parts: [{ id: 'mcq', marks: 1, answerType: 'multiple-choice', answer: 'D', markPoints: ['D'] }],
}
assert.equal(scoreAttempt(mcqUnit, { mcq: 'D' }, 1).rawMarks, 1, 'MCQ scoring must accept the canonical option key')
assert.equal(scoreAttempt(mcqUnit, { mcq: 'D work' }, 1).rawMarks, 1, 'MCQ scoring must migrate prefixed legacy option text')
assert.deepEqual(stagesForComponentTags(['AS/A2 P4 (M1)']), ['AS', 'A2'], 'shared components must expose both AS and A2')
assert.deepEqual(stagesForComponentTags(['AS or A2 P3']), ['AS', 'A2'], 'alternative-stage components must expose both AS and A2')

console.log('Smoke checks passed')

const { courseRoutes: routeContractRegistry, resolveRouteId } = await import('../src/data/routeRegistry.js')
const { LEGACY_UNSCOPED_ROUTE_ID: unscopedRouteId, resolveRouteBinding: resolveRouteContract } = await import('../src/lib/routeMigration.js')
const { mergeStoredState, normalizeState: normalizeStoredState, normalizeSyncItem } = await import('../src/lib/storage.js')

assert.deepEqual(COURSE_STAGE_ORDER, ['IGCSE', 'AS', 'A2', 'Competition', 'Admissions'], 'student, teacher and school selectors must share separate Competition and Admissions stages')
assert.deepEqual(stagesForSubject('bpho'), ['Competition'], 'BPhO must only appear under Competition')
assert.deepEqual(stagesForSubject('amc12'), ['Competition'], 'AMC12 must only appear under Competition')
assert.deepEqual(stagesForSubject('esat'), ['Admissions'], 'ESAT must only appear under Admissions')
assert.deepEqual(stagesForSubject('tmua'), ['Admissions'], 'TMUA must only appear under Admissions')
const routeStageBySubject = Object.fromEntries(routeContractRegistry.filter((route) => ['bpho', 'amc12', 'esat', 'tmua'].includes(route.subjectId)).map((route) => [route.subjectId, [route.qualification, route.stage]]))
assert.deepEqual(routeStageBySubject, {
  bpho: ['Competition', 'Competition'],
  amc12: ['Competition', 'Competition'],
  esat: ['Admissions', 'Admissions'],
  tmua: ['Admissions', 'Admissions'],
}, 'specialist routes must not mix competitions with university admissions tests')
assert.equal(resolveRouteId({ subjectId: 'bpho', stage: 'COMPETITION' }), 'bpho-admissions-physics', 'Competition stage normalization must resolve BPhO without relabeling it as Admissions')
assert.deepEqual(
  resolveRouteContract({ routeId: 'bpho-admissions-physics', stage: 'Admissions', qualification: 'Admissions', subjectId: 'bpho' }, { routes: routeContractRegistry }),
  { routeId: 'bpho-admissions-physics', stage: 'Competition', reason: 'explicit' },
  'legacy BPhO records written as Admissions must migrate to Competition while preserving their route ID',
)

assert.equal(
  resolveRouteContract({ routeId: 'unknown-route', stage: 'AS' }, { routes: routeContractRegistry }).routeId,
  unscopedRouteId,
  'explicit route IDs must be validated against the supplied registry',
)
assert.equal(
  resolveRouteContract({ routeId: 'cie-9702-as-physics', stage: 'A2' }, { routes: routeContractRegistry }).routeId,
  unscopedRouteId,
  'explicit route metadata must not conflict with the registered stage',
)
assert.equal(
  resolveRouteContract({ routeId: 'cie-0625-igcse-physics', stage: 'IGCSE', subjectId: 'physics-9702' }, { routes: routeContractRegistry }).routeId,
  unscopedRouteId,
  'subjectId syllabus codes must be checked when validating an explicit route',
)
assert.equal(
  resolveRouteContract({ subjectId: 'physics-9702', syllabusTopic: 'Superposition' }, { routes: routeContractRegistry }).routeId,
  'cie-9702-as-physics',
  'route metadata matching must recognise subjectId and route.syllabus.topics',
)

const routeScoringPart = { id: 'route-score', marks: 1, answerType: 'multiple-choice', answer: 'A', markPoints: ['A'] }
const validRouteScore = scoreAttempt({ routeId: 'cie-9702-as-physics', maxMarks: 1, parts: [routeScoringPart] }, { 'route-score': 'A' }, 10)
assert.deepEqual([validRouteScore.routeId, validRouteScore.stage], ['cie-9702-as-physics', 'AS'], 'scoring must bind a registered route to its canonical stage')
const conflictingRouteScore = scoreAttempt({ routeId: 'cie-9702-as-physics', stage: 'A2', maxMarks: 1, parts: [routeScoringPart] }, { 'route-score': 'A' }, 10)
assert.deepEqual([conflictingRouteScore.routeId, conflictingRouteScore.stage], [unscopedRouteId, null], 'scoring must reject a route/stage mismatch')
const legacyTopicIdUnit = buildCoachPractice({ routeId: 'cie-9702-as-physics', knowledgeGroupId: 'physics-9702-topic-03', questionCount: 1, allowPartial: true })
assert.deepEqual(
  [scoreAttempt(legacyTopicIdUnit, {}, 1).routeId, scoreAttempt(legacyTopicIdUnit, {}, 1).stage],
  ['cie-9702-as-physics', 'AS'],
  'registered route validation must accept a legacy knowledge-group ID when its syllabus topic title matches',
)
const generatedMathUnit = buildCoachPractice({ routeId: 'cie-9709-a2-after-p1-p5-p3-p4', knowledgeGroupId: 'math-9709-pure', questionCount: 10, allowPartial: true })
const normalizedGeneratedMathState = normalizeStoredState({ generatedUnits: [generatedMathUnit] })
assert.equal(normalizedGeneratedMathState.generatedUnits[0].routeId, generatedMathUnit.routeId, 'Topic drills must retain their registered route when persisted')
assert.equal(normalizedGeneratedMathState.generatedUnits[0].stage, generatedMathUnit.stage, 'Topic drills must retain their canonical academic stage when persisted')
assert.ok(normalizedGeneratedMathState.generatedUnits[0].parts.every((part) => part.routeId === generatedMathUnit.routeId), 'persisted Topic drill parts must remain route-isolated')

const oldIgcseState = normalizeStoredState({ profile: { role: 'student', learningTrack: 'IGCSE' } })
assert.equal(oldIgcseState.profile.activeRouteId, null, 'legacy profiles without a unique active route must not silently switch to AS Physics')
assert.equal(oldIgcseState.profile.learningTrack, 'IGCSE', 'legacy profile stage should be preserved while route selection is unresolved')

const staticAttemptState = {
  profile: { role: 'student', learningTrack: 'AS' },
  attempts: [{ id: 'static-attempt', unitId: 'static-as-unit', stage: 'result', submittedAt: '2026-08-08T00:00:00.000Z', scoreResult: { percentage: 70, maxMarks: 1, criteria: [{}] } }],
}
const deferredStaticState = normalizeStoredState(staticAttemptState)
assert.equal(deferredStaticState.attempts[0].stage, 'result', 'missing static unit context must defer migration instead of destroying the lifecycle stage')
assert.equal(deferredStaticState.attempts[0].routeMigration.status, 'deferred', 'missing static unit context must be explicit')
const scopedStaticState = normalizeStoredState(staticAttemptState, { units: [{ id: 'static-as-unit', routeId: 'cie-9702-as-physics', stage: 'AS', subjectId: 'physics-9702' }] })
assert.deepEqual(
  [scopedStaticState.attempts[0].routeId, scopedStaticState.attempts[0].stage, scopedStaticState.attempts[0].attemptStatus],
  ['cie-9702-as-physics', 'AS', 'result'],
  'supplying static units must enable a unique route migration',
)

const legacyQueueInput = {
  resource: '/api/stem/assignments/assignment-1/submissions',
  method: 'POST',
  idempotencyKey: 'legacy-queue-key',
  attemptId: 'legacy-attempt',
  body: { idempotencyKey: 'legacy-queue-key', attemptId: 'legacy-attempt', rawMarks: 1, maxMarks: 2, percentage: 50 },
}
const legacyQueueA = normalizeSyncItem(legacyQueueInput)
const legacyQueueB = normalizeSyncItem(legacyQueueInput)
assert.equal(legacyQueueA.id, legacyQueueB.id, 'legacy queue IDs must be generated deterministically')
assert.deepEqual([legacyQueueA.syncable, legacyQueueA.syncStatus, legacyQueueA.routeId, legacyQueueA.stage], [false, 'blocked', unscopedRouteId, null], 'unscoped legacy queue entries must remain visible but unsyncable')

const validQueue = normalizeSyncItem({
  ...legacyQueueInput,
  idempotencyKey: 'route-queue-key',
  routeId: 'cie-9702-as-physics',
  stage: 'AS',
  body: { ...legacyQueueInput.body, idempotencyKey: 'route-queue-key', routeId: 'cie-9702-as-physics', stage: 'AS' },
})
assert.equal(validQueue.syncable, true, 'new route-bound submissions must remain replayable')
assert.deepEqual([validQueue.body.routeId, validQueue.body.stage], ['cie-9702-as-physics', 'AS'], 'sync payloads must preserve route and stage')

const mergedAfterCompletion = mergeStoredState(
  { attempts: [{ id: 'done-attempt', serverSync: 'synced' }], syncQueue: [], completedSyncKeys: ['done-key'] },
  { attempts: [{ id: 'done-attempt', serverSync: 'pending' }], syncQueue: [{ ...validQueue, idempotencyKey: 'done-key', attemptId: 'done-attempt' }], completedSyncKeys: [] },
)
assert.equal(mergedAfterCompletion.syncQueue.length, 0, 'a stale UI save must not resurrect a completed sync item')
assert.equal(mergedAfterCompletion.attempts[0].serverSync, 'synced', 'a stale UI save must preserve the completed attempt receipt state')
assert.ok(mergeStoredState(
  { attempts: [{ id: 'append-only-attempt', serverSync: 'synced' }], syncQueue: [], completedSyncKeys: [] },
  { attempts: [], syncQueue: [], completedSyncKeys: [] },
).attempts.some((attempt) => attempt.id === 'append-only-attempt'), 'stale state must not delete an append-only persisted attempt')

console.log('Route migration and sync queue checks passed')
