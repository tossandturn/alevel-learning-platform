import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { importedPdfLibrary, practiceUnits } from '../src/data/catalog.js'
import { learningPlan, stagesForComponentTags } from '../src/data/learningPlan.js'
import { getExamPaperProfile, getRouteOptions, getStageGuidance } from '../src/data/examStructure.js'
import { reviewAttempt } from '../src/lib/aiReview.js'
import { latestBphoSpcPaper, parseCoachIntent } from '../src/lib/coachIntent.js'
import { isHumanReviewedPastPaperItem, isVerifiedPastPaperItem, paperQuestionMarkingMetadata, selectTaggedQuestions, unifiedQuestionBank } from '../src/data/questionBank.js'
import { PracticeInventoryError, buildCoachPractice, buildVerifiedPracticeCatalog, rebindVerifiedPracticeUnit, verifiedPracticeCatalogMetrics } from '../src/lib/coachPractice.js'
import { buildCoachPractice as buildRuntimeCoachPractice, buildVerifiedPracticeCatalog as buildRuntimeVerifiedPracticeCatalog, rebindVerifiedPracticeUnit as rebindRuntimeVerifiedPracticeUnit, resolveVerifiedPracticeSelection, verifiedPracticeQuestionGroups as runtimeVerifiedPracticeQuestionGroups } from '../src/lib/verifiedPracticeCatalog.js'
import { pointerSamples } from '../src/lib/inkStroke.js'
import { HANDWRITING_HISTORY_MAX_BYTES, HANDWRITING_HISTORY_MAX_ENTRIES, handwritingHistorySize, trimHandwritingHistory } from '../src/lib/inkHistory.js'
import { buildSharedMarkingSubmission, completedMarksByQuestion, createSharedMarkingSubmission, paperSubmissionMarkingSummary, readSharedMarkingAvailability, retrySharedMarkingSubmission, waitForSharedMarkingSubmission } from '../src/lib/paperMarking.js'
import { buildCompletionByUnit, buildLearningEvents, buildLearningProgress, recommendForRoute } from '../src/lib/learningProgress.js'
import { answeredQuestionCount, buildLearningExport, hasAttemptResponse, hasCurrentSourceBindingForAttempt, isPendingSelfMarkAttempt, isScoredAttempt, prepareLearningExport, sourceBindingSnapshotForUnit } from '../src/lib/attemptAudit.js'
import { mergeNotebookNote, notebookNoteRequest } from '../src/lib/privateNotes.js'
import { scoreAttempt } from '../src/lib/scoring.js'
import { buildPartMarkingLifecycle, finalizePartMarking, hasCompleteStudentMarks, markingCapabilityForUnit, pendingPartsForLifecycle } from '../src/lib/markingLifecycle.js'
import { normalizeState } from '../src/lib/storage.js'
import { canonicalReturnUrl } from '../src/lib/sharedAccount.js'
import { configuredIdentityOrigin } from '../src/lib/identityOrigin.js'
import { applyProductContext, parseProductContext, termIdsForStemContext, topicIdForTermIds } from '../src/lib/productContext.js'
import { buildCoachSystemPrompt, canonicalHandwritingMarkingContext, normalizeMarkResult, parseStructuredJson, providerConfig } from '../server/aiApi.js'
import { buildLegacyQuestionGroup, normalisePartLabel, normaliseQuestionGroup, validateQuestionGroup } from '../src/data/questionParts.js'
import { COURSE_STAGE_ORDER } from '../src/data/stages.js'
import { ARCHIVE_SOURCES, BPHO_ROUNDS, archiveSeasonLabel, buildArchiveStats } from '../src/data/competitionArchive.js'
import { stagesForSubject } from '../src/data/audience.js'
import sourceContentManifest from '../src/data/sourceContentManifest.json' with { type: 'json' }
import importedQuestionIndex from '../src/data/importedQuestionIndex.json' with { type: 'json' }
import { canonicalSourceMarkingProvenance, canonicalSourceQuestionId, sourceBindingSignature, sourceBindingStatus, sourceQuestionId } from '../src/lib/sourceContentContract.js'
import { HIGH_PRIORITY_SOURCE_RANGE_REVIEW_IDS, RESOLVED_NON_CONTENT_PAGE_GAPS, SEMANTIC_REVIEW_FIXTURES } from '../src/lib/sourceSemanticContract.js'
import { reviewedSourceFocusBinding, sourceContentStatus } from '../src/lib/questionContent.js'

const unitIds = new Set(practiceUnits.map((unit) => unit.id))
assert.equal(unitIds.size, practiceUnits.length, 'practice unit IDs must be unique')

const missingMiddleSourcePage = sourceBindingStatus({
  questionId: 'fixture-source-gap',
  sourceRef: {
    paperId: 'fixture-paper',
    sha256: 'fixture-sha',
    pageStart: 8,
    pageEnd: 10,
    assetUrls: [
      '/question-assets/fixture-paper/qp-08.jpg',
      '/question-assets/fixture-paper/qp-10.jpg',
    ],
  },
  parts: [{ partId: 'fixture-source-gap:a', sourcePage: 8 }],
})
assert.deepEqual(missingMiddleSourcePage.sourcePages, [8, 9, 10], 'source page ranges must expand every inclusive page, not only the endpoints')
assert.ok(missingMiddleSourcePage.reasons.includes('missing-page-asset:9'), 'a missing intermediate source page must quarantine the item')
const partOutsideSourcePage = sourceBindingStatus({
  questionId: 'fixture-source-part-range',
  sourceRef: {
    paperId: 'fixture-paper',
    sha256: 'fixture-sha',
    pageStart: 8,
    pageEnd: 10,
    assetUrls: [
      '/question-assets/fixture-paper/qp-08.jpg',
      '/question-assets/fixture-paper/qp-09.jpg',
      '/question-assets/fixture-paper/qp-10.jpg',
    ],
  },
  parts: [{ partId: 'fixture-source-part-range:a', sourcePage: 11 }],
})
assert.ok(partOutsideSourcePage.reasons.includes('part-source-page-outside-range:fixture-source-part-range:a:11'), 'every part page must remain inside the declared source page range')
assert.equal(sourceContentManifest.schemaVersion, 'source-content-audit-v2', 'client source manifest must use the audited schema')
assert.equal(Object.keys(sourceContentManifest.items).length, importedQuestionIndex.questions.length, 'every imported source question must receive an explicit runtime audit state')
assert.equal(Object.values(sourceContentManifest.items).filter((item) => !item.fileComplete).length, 413, 'source audit must preserve the 410 index quarantines plus 3 source-file quarantines')
assert.equal(Object.values(sourceContentManifest.items).filter((item) => !item.complete).length, 1150, 'effective practice gate must exclude every unreviewed or semantically quarantined source record')
assert.equal(Object.values(sourceContentManifest.items).filter((item) => item.complete).length, 230, 'only reviewed source-complete question groups may enter the effective practice bank')

const semanticFixtureIds = ['bpho-2025_IPC:q13', 'bpho-2025_IPC:q14']
for (const questionId of semanticFixtureIds) {
  assert.equal(sourceContentManifest.items[questionId]?.semanticStatus, 'semantic-quarantined', `${questionId} must remain fail-closed until its QP/MS semantics are rebuilt and reviewed`)
  assert.equal(sourceContentManifest.items[questionId]?.complete, false, `${questionId} must not be practice-available from the old truncated record`)
}
for (const questionId of Object.keys(RESOLVED_NON_CONTENT_PAGE_GAPS)) {
  const item = sourceContentManifest.items[questionId]
  assert.ok(item, `${questionId} blank/working-space counterexample must remain in the audit manifest`)
  assert.equal(item?.fileComplete, true, `${questionId} non-content page must not create a false file-missing failure`)
  assert.doesNotMatch((item?.reasons || []).join('|'), /source-range-ends-before-next-question/, `${questionId} must not be quarantined merely because a blank/working-space page is omitted`)
  assert.notEqual(item?.semanticStatus, 'semantic-quarantined', `${questionId} must not receive a semantic range quarantine from a resolved non-content page`)
}
for (const questionId of HIGH_PRIORITY_SOURCE_RANGE_REVIEW_IDS) {
  assert.equal(sourceContentManifest.items[questionId]?.complete, false, `${questionId} high-priority range candidate must fail closed pending semantic review`)
}

const focusedQ1 = unifiedQuestionBank.find((question) => question.sourceQuestionId === 'cie-0580-0580_m25_qp_12:q1')
const focusedQ2 = unifiedQuestionBank.find((question) => question.sourceQuestionId === 'cie-0580-0580_m25_qp_12:q2')
assert.equal(focusedQ1?.parts?.[0]?.sourceFocus, null, 'a reviewed item without explicit display-bound review must default to the full original page')
assert.equal(focusedQ2?.parts?.[0]?.sourceFocus, null, 'multi-part items without explicit display-bound review must default to the full original page')
const focusedQ10 = unifiedQuestionBank.find((question) => question.sourceQuestionId === 'cie-0580-0580_m25_qp_12:q10')
const focusedQ14 = unifiedQuestionBank.find((question) => question.sourceQuestionId === 'cie-0580-0580_m25_qp_12:q14')
const focusedQ16 = unifiedQuestionBank.find((question) => question.sourceQuestionId === 'cie-0580-0580_m25_qp_12:q16')
const focusedQ18 = unifiedQuestionBank.find((question) => question.sourceQuestionId === 'cie-0580-0580_m25_qp_12:q18')
const focusedQ5 = unifiedQuestionBank.find((question) => question.sourceQuestionId === 'cie-0580-0580_m25_qp_12:q5')
assert.deepEqual(focusedQ5?.parts?.[0]?.sourceFocus?.pages?.[0]?.region, [80, 98, 930, 660], 'reviewed shape Q5 must use the padded safe display crop')
assert.equal(focusedQ10?.parts?.[0]?.sourceFocus, null, 'Q10 must default to its complete original page when a source crop cannot provide a safe visual boundary')
assert.deepEqual(focusedQ14?.parts?.[0]?.sourceFocus?.pages?.map((page) => page.page), [8, 9], 'reviewed cross-page Q14 must bind both QP pages into every dependent part')
assert.deepEqual(focusedQ14?.parts?.[2]?.sourceFocus?.pages?.[1]?.region, [88, 92, 930, 1030], 'reviewed Q14(c) must use the padded safe net crop')
assert.deepEqual(focusedQ16?.parts?.[0]?.sourceFocus?.pages?.[0]?.region, [84, 96, 930, 670], 'reviewed scatter Q16 must use the padded safe display crop')
assert.deepEqual(focusedQ18?.parts?.[0]?.sourceFocus?.pages?.[0]?.region, [80, 92, 940, 1090], 'reviewed table-and-grid Q18 must use the padded safe display crop')
assert.deepEqual(focusedQ18?.parts?.[0]?.sourceFocus?.pages?.[0]?.safetyMargin, [40, 6, 38, 30], 'reviewed display bounds must retain auditable padding from raw evidence')

const rawQ1 = importedQuestionIndex.questions.find((question) => question.questionId === 'cie-0580-0580_m25_qp_12:q1')
const rawQ1Binding = importedQuestionIndex.bindings.find((binding) => binding.questionId === rawQ1?.questionId)
const malformedFocus = structuredClone({ ...rawQ1, answerBinding: rawQ1Binding })
malformedFocus.answerBinding.reviewEvidence.partAllocations[0].questionRegion = [0, 0, 99999, 99999]
assert.equal(reviewedSourceFocusBinding(malformedFocus).complete, false, 'an out-of-bounds reviewed crop must fall back to the full page')

const staleBphoUnit = {
  id: 'stale-bpho-q13-unit',
  routeId: 'bpho-competition',
  type: 'topic',
  parts: [{ sourceKind: 'past-paper', sourceQuestionId: 'bpho-2025_IPC:q13', questionPartId: 'bpho-2025_IPC:q13:part-a', sourceContentComplete: true, reviewStatus: 'reviewed', aiAssistedMarkingAvailable: true }],
}
assert.equal(rebindVerifiedPracticeUnit(staleBphoUnit), null, 'a stale persisted BPhO unit must not be rebound from client capability flags')
assert.equal(canonicalSourceQuestionId('bpho-2025_IPC:q13@forged-version'), '', 'canonical source IDs must reject forged @ versions instead of truncating them')
assert.equal(sourceQuestionId({ sourceQuestionId: 'bpho-2025_IPC:q13@forged-version' }), '', 'question provenance must not normalize a suffixed source ID into an older reviewed record')
const validProvenance = canonicalSourceMarkingProvenance(focusedQ1, focusedQ1?.parts?.[0])
const validCanonicalContext = canonicalHandwritingMarkingContext({ provenance: { ...validProvenance, routeId: focusedQ1?.routeId } })
assert.equal(validCanonicalContext.ok, true, 'a current reviewed source part must be accepted by the server canonical marking gate')
const missingCanonicalContext = canonicalHandwritingMarkingContext({ provenance: { sourceQuestionId: focusedQ1?.sourceQuestionId, questionPartId: focusedQ1?.parts?.[0]?.partId, routeId: focusedQ1?.routeId } })
assert.equal(missingCanonicalContext.code, 'source_provenance_missing', 'AI marking must require a complete manifest-v2 provenance tuple')
const staleCanonicalContext = canonicalHandwritingMarkingContext({ provenance: { ...validProvenance, routeId: focusedQ1?.routeId, bindingSignature: 'fnv1a64:0000000000000000' } })
assert.equal(staleCanonicalContext.code, 'source_provenance_mismatch', 'a stale binding signature must not enter AI marking')
const forgedCanonicalContext = canonicalHandwritingMarkingContext({ provenance: {
  ...validProvenance,
  sourceQuestionId: 'bpho-2025_IPC:q13',
  questionPartId: 'bpho-2025_IPC:q13:part-a',
  routeId: 'bpho-competition',
} })
assert.equal(forgedCanonicalContext.ok, false, 'a forged reviewed capability must be rejected before an AI provider call')
const tamperedAnswerSource = structuredClone(focusedQ1)
tamperedAnswerSource.answerRef.sha256 = 'f'.repeat(64)
assert.notEqual(sourceBindingSignature(tamperedAnswerSource), sourceBindingSignature(focusedQ1), 'the canonical source signature must include the current answer-document checksum')
assert.equal(sourceContentStatus(tamperedAnswerSource).complete, false, 'a changed answer-document checksum must fail the runtime source-content gate')
assert.ok(sourceContentStatus(tamperedAnswerSource).reasons.includes('source-audit-stale'), 'a changed answer-document checksum must not remain eligible through a stale audit record')
for (const questionId of Object.keys(SEMANTIC_REVIEW_FIXTURES)) {
  assert.equal(sourceContentManifest.items[questionId]?.complete, false, `${questionId} semantic fixture must remain unavailable`)
}

assert.equal(pointerSamples({ nativeEvent: { clientX: 10, clientY: 12, getCoalescedEvents: () => [] } }).length, 1, 'an empty Safari coalesced-event list must retain the current pointer sample')
const iPadHistorySnapshot = handwritingHistorySize(2048, 2732)
assert.ok(iPadHistorySnapshot.bytes < 2 * 1024 * 1024, 'one iPad undo snapshot must stay below 2 MB instead of retaining a full-DPR canvas')
assert.equal(iPadHistorySnapshot.fullDpr, false, 'iPad undo history must use bounded preview snapshots')
const boundedHistory = trimHandwritingHistory(Array.from({ length: 40 }, () => ({ bytes: iPadHistorySnapshot.bytes })))
assert.ok(boundedHistory.entries.length <= HANDWRITING_HISTORY_MAX_ENTRIES, 'undo history must have a hard entry cap')
assert.ok(boundedHistory.bytes <= HANDWRITING_HISTORY_MAX_BYTES, 'undo history must have a measurable byte budget')

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
const localIdentityOrigin = configuredIdentityOrigin('http://127.0.0.1:4999/auth/path')
let markingAvailabilityRequestUrl = ''
await readSharedMarkingAvailability({
  token: 'test-token',
  origin: localIdentityOrigin,
  fetchImpl: async (url) => {
    markingAvailabilityRequestUrl = String(url)
    return { ok: true, status: 200, json: async () => ({ enabled: true, modelConfigured: true, queueAvailable: true, authenticationRequired: false }) }
  },
})
assert.equal(markingAvailabilityRequestUrl, 'http://127.0.0.1:4999/api/stem/marking/availability', 'local marking availability must use the configured identity origin')
assert.doesNotMatch(markingAvailabilityRequestUrl, /https:\/\/ieltsist\.com/, 'local or staging marking checks must not silently target production')

const dirtyStemReturn = 'https://stem.ieltsist.com/practice?routeId=cie-9702-as-physics&from=ieltsist&focus=account&returnTo=https%3A%2F%2Fevil.example%2F&token=secret&view=topic#session'
const canonicalStemReturn = canonicalReturnUrl(dirtyStemReturn, 'https://stem.ieltsist.com/')
assert.equal(canonicalStemReturn, 'https://stem.ieltsist.com/practice?routeId=cie-9702-as-physics&view=topic#session', 'shared auth returns must remove transient bridge and credential parameters')
assert.equal(canonicalReturnUrl('https://evil.example/steal?token=x', 'https://stem.ieltsist.com/practice?routeId=cie-9702-as-physics'), 'https://stem.ieltsist.com/practice?routeId=cie-9702-as-physics', 'external return origins must be rejected in favour of a canonical STEM URL')
assert.equal(canonicalReturnUrl('https://stem.ieltsist.com/practice#attempt?token=secret', 'https://stem.ieltsist.com/'), 'https://stem.ieltsist.com/practice', 'fragment credentials and nested query text must be removed from return URLs')
assert.equal(canonicalReturnUrl('https://stem.ieltsist.com/practice#attempt/saved-attempt-1', 'https://stem.ieltsist.com/'), 'https://stem.ieltsist.com/practice#attempt/saved-attempt-1', 'known in-app route fragments may survive the auth bridge')
assert.equal(canonicalReturnUrl('https://stem.ieltsist.com/practice#untrusted-fragment', 'https://stem.ieltsist.com/'), 'https://stem.ieltsist.com/practice', 'unknown fragments must not cross the auth bridge')
assert.equal(canonicalReturnUrl('https://stem.ieltsist.com/practice#attempt%3Fcode%3Dsecret', 'https://stem.ieltsist.com/'), 'https://stem.ieltsist.com/practice', 'encoded fragment credentials must not cross the auth bridge')
assert.equal(canonicalReturnUrl('https://stem.ieltsist.com/practice?routeId=cie-9702-as-physics&access_token=secret&refresh_token=secret&session=secret&callback=secret&redirect=https%3A%2F%2Fevil.example#attempt?refresh_token=secret', 'https://stem.ieltsist.com/'), 'https://stem.ieltsist.com/practice?routeId=cie-9702-as-physics', 'all credential and callback parameters must be removed from shared return URLs')
assert.ok(canonicalReturnUrl(`https://stem.ieltsist.com/${'a'.repeat(2_000)}?view=topic#attempt`, 'https://stem.ieltsist.com/').length <= 1_200, 'canonical return URLs must enforce the length limit even when the pathname is oversized')
const legacyProductContext = parseProductContext('?from=ieltsist&route_id=cie-9702-as-physics&topic_id=physics-9702-topic-03&term_ids=stem.physics.dynamics,stem.physics.forces-momentum&return_attempt=att-123&return_to=https%3A%2F%2Fstem.ieltsist.com%2F%3Fview%3Dpractice')
assert.deepEqual(legacyProductContext, {
  from: 'ieltsist', focus: '', routeId: 'cie-9702-as-physics', topicId: 'physics-9702-topic-03', termIds: ['stem.physics.dynamics', 'stem.physics.forces-momentum'], attemptId: 'att-123', returnTo: 'https://stem.ieltsist.com/?view=practice',
}, 'STEM must parse legacy IELTS product context without guessing display labels')
assert.deepEqual(termIdsForStemContext({ topicId: 'physics-9702-topic-03', topicTags: ['dynamics'] }), ['stem.physics.dynamics', 'stem.physics.forces-momentum'], 'topic and term mapping must use explicit stable IDs')
assert.equal(topicIdForTermIds(['stem.physics.dynamics']), 'physics-9702-topic-03', 'known IELTS term IDs must return to their exact STEM topic')
const canonicalProductUrl = applyProductContext(new URL('https://ieltsist.com/?from=stem&focus=language'), {
  routeId: 'cie-9702-as-physics', topicId: 'physics-9702-topic-03', termIds: ['stem.physics.dynamics'], attemptId: 'att-123', returnTo: 'https://stem.ieltsist.com/?view=practice',
}).href
assert.match(canonicalProductUrl, /routeId=cie-9702-as-physics/, 'outbound product context must use canonical camelCase routeId')
assert.match(canonicalProductUrl, /termIds=stem.physics.dynamics/, 'outbound product context must use canonical camelCase termIds')
assert.doesNotMatch(canonicalProductUrl, /(?:return_attempt|term_ids|return_to)=/, 'outbound product context must not emit legacy snake_case fields')

assert.deepEqual(parseCoachIntent('给我一套最新的bpho的spc的真题 带答案'), {
  type: 'open-latest-paper',
  contest: 'bpho-spc',
  routeId: 'bpho-admissions-physics',
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
assert.equal(parseCoachIntent('BPhO 力学 10 道练习').routeId, 'bpho-admissions-physics', 'BPhO Coach intent must carry its exact Competition route')
assert.equal(parseCoachIntent('ESAT Physics 10 questions').knowledgeGroupId, 'esat-physics', 'ESAT modules must route independently')
assert.equal(parseCoachIntent('ESAT Physics 10 questions').routeId, 'uatuk-esat-admissions', 'ESAT Coach intent must carry its exact Admissions route')
assert.equal(parseCoachIntent('TMUA proof 10 questions').knowledgeGroupId, 'tmua-proof', 'TMUA topics must route independently')
assert.equal(parseCoachIntent('TMUA proof 10 questions').routeId, 'uatuk-tmua-admissions', 'TMUA Coach intent must carry its exact Admissions route')
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
const markingLifecycleSource = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'lib', 'markingLifecycle.js'), 'utf8')
assert.ok(appSource.includes('verifiedPracticeQuestionGroups'), 'topic detail must read the compact reviewed runtime catalog')
assert.ok(!appSource.includes("from './data/questionBank"), 'the client App entry must not statically import the full question index')
assert.ok(appSource.includes('topic-detail__paper-group'), 'topic detail must render grouped real-paper questions')
assert.ok(appSource.includes('!dynamicSyllabusRoute && selectedTopicIds.length === 1'), 'every server-backed Topic Drill must honor the selected component mode and question count instead of reopening a stale prebuilt unit')
assert.ok(appSource.includes('onAgentAction={handleCoachAgentAction}'), 'Coach agent actions must be available from every current student route')
assert.ok(!appSource.includes("onAgentAction={activeRoute.stage === 'Competition'"), 'Coach actions must not be disabled merely because the current route is not Competition')
assert.ok(appSource.includes('sourceQuestionCount === 0') && appSource.includes('Topic Drill is being prepared for this course'), 'routes with archived papers but no ready topic inventory must fail closed into an honest paper-first state')
assert.ok(appSource.includes('Browse {activeRoute.stage} {activeRoute.subject} papers'), 'an empty Topic Drill route must offer a course-scoped paper-library route')
assert.ok(appSource.includes("routeById(incomingContext.routeId)?.routeId"), 'An explicit IELTSist return route must take priority over the saved STEM route')
assert.ok(appSource.includes('setSelectedTopicId(incomingContext.topicId || null)'), 'An explicit IELTSist return topic must survive shared-account state restoration')
assert.ok(appSource.includes('window.history.pushState'), 'student navigation must write meaningful browser history entries')
assert.ok(appSource.includes("window.addEventListener('popstate'"), 'student navigation must restore view state for browser back and forward')
assert.ok(appSource.includes('function SharedAccountDialog'), 'STEM must render an on-origin account dialog instead of linking sign-in away')
assert.ok(!appSource.includes('sharedAuthUrl('), 'STEM app must not generate browser auth redirects to IELTSist')
assert.ok(appSource.includes('<strong>STEM Studio</strong>'), 'the STEM shell must identify itself as STEM instead of presenting an IELTSist sign-in surface')
assert.ok(markingLifecycleSource.includes("evidenceStatus: 'not-recorded'"), 'student-recorded total marks must explicitly declare that point-level evidence was not captured')
assert.ok(!markingLifecycleSource.includes('awarded: index < awarded'), 'a student-recorded total must never fabricate which mark-scheme points were awarded')
const paperLibrarySource = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'components', 'PaperLibrary.jsx'), 'utf8')
assert.ok(paperLibrarySource.includes("activeRoute?.stage === 'Competition'"), 'competition archives must bypass Cambridge component filtering')
assert.ok(paperLibrarySource.includes("filters.subject === 'bpho' ? 'Round'"), 'BPhO archive must expose a first-class Round filter')
assert.ok(paperLibrarySource.includes('routeComponents.includes(component)'), 'route-scoped Paper selectors must be built from the route component allowlist')
const coachSource = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'components', 'AiCoach.jsx'), 'utf8')
assert.ok(coachSource.includes('context.stateOwnerId') && coachSource.includes('context.routeId') && coachSource.includes('context.stage') && coachSource.includes('context.view'), 'Coach storage keys must include owner, route, stage and view')
assert.ok(coachSource.includes('canOpenBphoSpc'), 'BPhO Coach quick action must be guarded by the Competition route')
const paperWorkspaceSource = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'components', 'PaperWorkspace.jsx'), 'utf8')
const pdfViewerSource = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'components', 'PdfViewer.jsx'), 'utf8')
assert.ok(paperWorkspaceSource.includes('pdfInkMapVersion === 2'), 'legacy inferred PDF ink mappings must be quarantined')
assert.ok(paperWorkspaceSource.includes('linkPdfInkToQuestion'), 'PDF ink must require an explicit answer-slot link before it counts as a response')
assert.ok(!paperWorkspaceSource.includes('Number(ink.questionNumber) || focusedQuestion'), 'PDF ink must not infer a question number from current focus')
assert.ok(!pdfViewerSource.includes('.toDataURL('), 'PDF pointer-up persistence must never use synchronous canvas serialization')
assert.ok(pdfViewerSource.includes('encodingPromiseRef'), 'PDF ink flushes must coalesce concurrent autosave and submit encodes')
assert.ok(handwritingPadSource.includes('dataset.historyBytes') && handwritingPadSource.includes('dataset.lastEncodeMs'), 'handwriting QA must expose measurable memory and encode-latency metrics')
assert.ok(!paperAnswerSheetSource.includes('sharedAuthUrl'), 'full-paper AI marking must open the native STEM sign-in dialog')
assert.ok(paperAnswerSheetSource.includes('onOpenAccount?.(\'login\')'), 'full-paper AI marking must request native STEM login in place')

assert.equal(practiceUnits.length, 0, 'formal practice must not expose generated seed questions')
const verifiedPracticeCatalog = buildVerifiedPracticeCatalog()
const verifiedCatalogMetrics = verifiedPracticeCatalogMetrics(verifiedPracticeCatalog)
assert.deepEqual(verifiedCatalogMetrics, { units: 39, questionGroups: 230, answerableParts: 391, referencedPapers: 16, routes: 4, topics: 33 }, 'only source-semantically reviewed question groups may be exposed as stable route/topic practice units')
assert.equal(runtimeVerifiedPracticeQuestionGroups.length, 230, 'the compact runtime catalog must expose only current reviewed groups')
assert.deepEqual(verifiedPracticeCatalogMetrics(buildRuntimeVerifiedPracticeCatalog()), verifiedCatalogMetrics, 'compact runtime catalog must preserve the reviewed practice inventory')
assert.equal(new Set(verifiedPracticeCatalog.map((unit) => unit.id)).size, verifiedPracticeCatalog.length, 'verified practice unit IDs must be stable and unique')
assert.ok(verifiedPracticeCatalog.every((unit) => unit.parts.every((part) => part.routeId === unit.routeId && part.stage === unit.stage && part.sourceRef?.sha256 && part.answerRef?.sha256)), 'catalog practice units must preserve route, stage and independent QP/MS provenance')
assert.ok(unifiedQuestionBank.every((item) => item.sourceContent?.complete === true), 'runtime inventory must fail closed for stale, missing, or incomplete source audits')
const catalogAnswerParts = verifiedPracticeCatalog.flatMap((unit) => unit.parts)
const reviewed0580Parts = catalogAnswerParts.filter((part) => part.sourceRef?.paperId === 'cie-0580-0580_m25_qp_12')
const reviewed0580QuestionIds = [...new Set(reviewed0580Parts.map((part) => part.sourceQuestionId))].sort((left, right) => Number(left.split(':q')[1]) - Number(right.split(':q')[1]))
assert.deepEqual(reviewed0580QuestionIds, Array.from({ length: 26 }, (_, index) => `cie-0580-0580_m25_qp_12:q${index + 1}`), 'reviewed 0580 March 2025 Paper 1 must cover every printed question Q1-Q26')
assert.equal(reviewed0580Parts.length, 46, 'reviewed 0580 March 2025 Paper 1 must expose all 46 answerable parts')
assert.equal(reviewed0580Parts.reduce((sum, part) => sum + (Number(part.marks) || 0), 0), 80, 'reviewed 0580 March 2025 Paper 1 mark allocations must total 80')
assert.ok(reviewed0580Parts.every((part) => part.aiAssistedMarkingAvailable && part.answerBinding?.verificationStatus === 'reviewed'), 'every reviewed 0580 part must be eligible for AI-assisted marking and retain reviewed provenance')
const reviewed9702P1Parts = catalogAnswerParts.filter((part) => (
  ['cie-9702-9702_m25_qp_12', 'cie-9702-9702_s25_qp_11'].includes(part.sourceRef?.paperId)
))
assert.equal(reviewed9702P1Parts.length, 80, 'two reviewed 9702 P1 sets must expose one independently marked MCQ part per printed question')
assert.ok(reviewed9702P1Parts.every((part) => part.answerType === 'multiple-choice' && part.aiAssistedMarkingAvailable && part.answerBinding?.verificationStatus === 'reviewed'), '9702 P1 marking capability must require current reviewed QP/MS provenance')
const reviewed0625P2Parts = catalogAnswerParts.filter((part) => part.sourceRef?.paperId === 'cie-0625-0625_m25_qp_22')
assert.equal(reviewed0625P2Parts.length, 40, 'reviewed 0625 M25 P2 must expose one independently marked MCQ part per printed question')
assert.ok(reviewed0625P2Parts.every((part) => part.answerType === 'multiple-choice' && part.aiAssistedMarkingAvailable && part.answerBinding?.verificationStatus === 'reviewed'), '0625 P2 marking capability must require current reviewed QP/MS provenance')
const reviewed0625S25P2Parts = catalogAnswerParts.filter((part) => part.sourceRef?.paperId === 'cie-0625-0625_s25_qp_21')
assert.equal(reviewed0625S25P2Parts.length, 40, 'reviewed 0625 S25 P2 must expose one independently marked MCQ part per printed question')
assert.ok(reviewed0625S25P2Parts.every((part) => part.answerType === 'multiple-choice' && part.aiAssistedMarkingAvailable && part.answerBinding?.verificationStatus === 'reviewed'), '0625 S25 P2 marking capability must require current reviewed QP/MS provenance')
const aiAssistedParts = catalogAnswerParts.filter((part) => part.aiAssistedMarkingAvailable)
assert.equal(aiAssistedParts.length, verifiedCatalogMetrics.answerableParts, 'every practice answer part must use the current reviewed AI-marking contract')
assert.ok(aiAssistedParts.every((part) => part.answerBinding?.verificationStatus === 'reviewed'), 'only reviewed source parts may unlock AI-assisted marking')
const deterministicMcqParts = catalogAnswerParts.filter((part) => part.deterministicScoringAvailable)
assert.equal(deterministicMcqParts.length, 160, 'only the reviewed MCQ parts may unlock deterministic scoring')
assert.ok(deterministicMcqParts.every((part) => [...reviewed9702P1Parts, ...reviewed0625P2Parts, ...reviewed0625S25P2Parts].includes(part) && part.answerType === 'multiple-choice' && part.answerBinding?.verificationStatus === 'reviewed'), 'deterministic scoring must stay bound to a reviewed MCQ answer key')
assert.equal(catalogAnswerParts.filter((part) => !part.aiAssistedMarkingAvailable && !part.deterministicScoringAvailable).length, 0, 'unreviewed structured items must remain outside the practice catalog rather than masquerading as self-mark units')
const asPhysicsRecommendation = recommendForRoute({
  units: verifiedPracticeCatalog,
  routeId: 'cie-9702-as-physics',
})
assert.ok(asPhysicsRecommendation.unit, 'a route with reviewed 9702 P1 inventory must expose a practice recommendation')
assert.equal(asPhysicsRecommendation.unit.routeId, 'cie-9702-as-physics', 'AS Physics recommendations must remain route-isolated')
const reviewedFixtureSource = unifiedQuestionBank.find((item) => item.sourceQuestionId === 'cie-0580-0580_m25_qp_12:q1')
assert.ok(reviewedFixtureSource, 'the reviewed 0580 pilot must provide an isolated scoring fixture')
const verifiedFixture = {
  ...reviewedFixtureSource,
  answerType: 'multiple-choice',
  answerKey: 'B',
  marks: 1,
  parts: [{ ...reviewedFixtureSource.parts[0], id: 'verified-fixture', partId: 'verified-fixture', answerType: 'multiple-choice', answerKey: 'B', answer: 'B', options: ['A', 'B'], marks: 1, markPoints: ['correct option'] }],
}
const verifiedUnit = { routeId: verifiedFixture.routeId, stage: verifiedFixture.stage, maxMarks: verifiedFixture.marks, parts: verifiedFixture.parts }
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
const pureSelfMarkLifecycle = buildPartMarkingLifecycle(selfMarkUnit, { 'self-mark-part': 'A written response containing every tempting keyword.' }, 30, {})
assert.equal(pureSelfMarkLifecycle.complete, false, 'a pure self-mark response must remain pending after submission')
assert.deepEqual(pureSelfMarkLifecycle.provisionalCriteria, [], 'self-mark parts must never enter keyword-based provisional scoring')
assert.equal(pureSelfMarkLifecycle.partStates['self-mark-part'].status, 'student-self-mark-pending')
assert.equal(hasCompleteStudentMarks(selfMarkUnit, pureSelfMarkLifecycle, { 'self-mark-part': '' }), false, 'blank explicit marks must not finalize a self-mark attempt')
const pureSelfMarkResult = finalizePartMarking(selfMarkUnit, pureSelfMarkLifecycle, { 'self-mark-part': 3 }, 30)
assert.equal(pureSelfMarkResult.rawMarks, 3)
assert.deepEqual(pureSelfMarkResult.criteria[0].evidence, [], 'student totals must not invent mark-point evidence')
assert.equal(pureSelfMarkResult.criteria[0].evidenceStatus, 'not-recorded')

const partialSelfMarkUnit = {
  ...selfMarkUnit,
  parts: [
    selfMarkUnit.parts[0],
    { id: 'unanswered-self-mark-part', marks: 5, answerType: 'written', deterministicScoringAvailable: false, aiAssistedMarkingAvailable: false, markPoints: ['point 1'] },
  ],
}
const partialSelfMarkLifecycle = buildPartMarkingLifecycle(partialSelfMarkUnit, { 'self-mark-part': 'Only this answer was submitted.' }, 30, {})
assert.equal(partialSelfMarkLifecycle.partStates['unanswered-self-mark-part'].status, 'unanswered', 'blank paper parts must remain unmarked rather than becoming self-mark blockers')
assert.deepEqual(pendingPartsForLifecycle(partialSelfMarkUnit, partialSelfMarkLifecycle).map((part) => part.id), ['self-mark-part'], 'only answered self-mark parts may require a student mark')
assert.equal(hasCompleteStudentMarks(partialSelfMarkUnit, partialSelfMarkLifecycle, { 'self-mark-part': 3 }), true, 'one independently answered part must be self-markable without entering a score for blank parts')
const partialSelfMarkResult = finalizePartMarking(partialSelfMarkUnit, partialSelfMarkLifecycle, { 'self-mark-part': 3 }, 30)
assert.deepEqual(partialSelfMarkResult.answeredPartIds, ['self-mark-part'], 'partial results must retain only explicitly answered parts')
assert.equal(partialSelfMarkResult.unansweredPartCount, 1, 'partial results must keep the blank-part count explicit')
assert.equal(partialSelfMarkResult.rawMarks, 3, 'blank parts must never become automatic zeroes')
assert.equal(partialSelfMarkResult.maxMarks, 4, 'partial score denominator must include only explicitly marked answers')
assert.equal(partialSelfMarkResult.partial, true, 'a subset score must remain provisional')

const mixedSourceUnit = verifiedPracticeCatalog.find((unit) => unit.parts.length >= 2)
assert.ok(mixedSourceUnit, 'the reviewed catalog must provide source-bound parts for a mixed lifecycle fixture')
const realMixedUnit = {
  ...mixedSourceUnit,
  id: 'fixture-mixed-reviewed-source',
  maxMarks: 2,
  parts: [
    {
      ...mixedSourceUnit.parts[0],
      id: 'mixed-deterministic-part',
      deterministicScoringAvailable: true,
      aiAssistedMarkingAvailable: false,
      answerType: 'numeric',
      acceptedValue: 20,
      tolerance: 0,
      acceptedUnits: [],
      marks: 1,
      markPoints: ['deterministic value'],
    },
    {
      ...mixedSourceUnit.parts[1],
      id: 'mixed-self-mark-part',
      deterministicScoringAvailable: false,
      aiAssistedMarkingAvailable: false,
      marks: 1,
      markPoints: ['student-recorded total only'],
    },
  ],
}
assert.equal(markingCapabilityForUnit(realMixedUnit).mode, 'mixed')
const realMixedLifecycle = buildPartMarkingLifecycle(realMixedUnit, { 'mixed-deterministic-part': '20' }, 90, {})
const realMixedPendingParts = pendingPartsForLifecycle(realMixedUnit, realMixedLifecycle)
assert.equal(realMixedLifecycle.provisionalCriteria.length, 1, 'only deterministic parts may score provisionally in a mixed unit')
assert.equal(realMixedPendingParts.length, 0, 'an unanswered written part must remain unmarked without blocking a submitted answered part')
assert.equal(realMixedLifecycle.partStates['mixed-self-mark-part'].status, 'unanswered', 'blank mixed parts must remain explicitly unmarked')
assert.ok(realMixedLifecycle.provisionalCriteria.every((criterion) => criterion.scoringSource === 'deterministic'))
assert.equal(hasCompleteStudentMarks(realMixedUnit, realMixedLifecycle, {}), false, 'no pending self-mark inputs must not be treated as an empty self-mark completion')
const realMixedResult = finalizePartMarking(realMixedUnit, realMixedLifecycle, {}, 90)
assert.equal(realMixedResult.criteria.length, 1)
assert.equal(realMixedResult.maxMarks, 1)
assert.equal(realMixedResult.unansweredPartCount, 1)
const reloadedMixedState = normalizeState({
  profile: { activeRouteId: realMixedUnit.routeId },
  attempts: [{
    id: 'mixed-route-reload',
    unitId: realMixedUnit.id,
    routeId: realMixedUnit.routeId,
    qualification: realMixedUnit.qualification,
    courseStage: realMixedUnit.stage,
    stage: realMixedUnit.stage,
    attemptStatus: 'marking-pending',
    contentScope: {
      routeId: realMixedUnit.routeId,
      qualification: realMixedUnit.qualification,
      stage: realMixedUnit.stage,
      subject: realMixedUnit.subject,
    },
  }],
}, { units: [{ id: realMixedUnit.id, routeId: realMixedUnit.routeId, stage: realMixedUnit.stage, qualification: realMixedUnit.qualification, subject: realMixedUnit.subject }] })
assert.equal(reloadedMixedState.attempts[0].routeId, realMixedUnit.routeId, 'a route-bound mixed pending attempt must remain visible after storage migration and reload')
assert.equal(reloadedMixedState.attempts[0].attemptStatus, 'marking-pending')

const reviewedAiPart = reviewed0580Parts[0]
const reviewedAiUnit = { ...verifiedPracticeCatalog.find((unit) => unit.parts.some((part) => part.id === reviewedAiPart.id)), id: 'reviewed-ai-fixture', parts: [reviewedAiPart], maxMarks: reviewedAiPart.marks }
const noEvidenceLifecycle = buildPartMarkingLifecycle(reviewedAiUnit, { [reviewedAiPart.id]: 'typed working without an image' }, 45, { [reviewedAiPart.id]: { status: 'no_evidence' } })
assert.equal(noEvidenceLifecycle.complete, false, 'typed text alone must not silently score a handwriting-reviewed part')
assert.equal(noEvidenceLifecycle.partStates[reviewedAiPart.id].status, 'ai-retry-pending')
assert.equal(noEvidenceLifecycle.provisionalRawMarks, 0)
const providerFailureLifecycle = buildPartMarkingLifecycle(reviewedAiUnit, { [reviewedAiPart.id]: 'submitted handwriting evidence' }, 45, { [reviewedAiPart.id]: { status: 'error', error: 'Provider unavailable.' } })
assert.equal(providerFailureLifecycle.partStates[reviewedAiPart.id].status, 'ai-retry-pending', 'provider failure must remain retryable and unscored')
const reviewRequiredLifecycle = buildPartMarkingLifecycle(reviewedAiUnit, { [reviewedAiPart.id]: 'submitted handwriting evidence' }, 45, { [reviewedAiPart.id]: { status: 'success', rawMarks: reviewedAiPart.marks, confidence: 0.4, reviewRequired: true, markPoints: [{ awarded: true, reason: 'candidate point' }] } })
assert.equal(reviewRequiredLifecycle.partStates[reviewedAiPart.id].status, 'ai-review-pending', 'low-confidence AI output must not become canonical')
const reviewedMarkPoints = (reviewedAiPart.markPoints || []).map((point, index) => ({ id: `${reviewedAiPart.id}-T${index + 1}`, awarded: true, reason: point }))
const aiScoredLifecycle = buildPartMarkingLifecycle(reviewedAiUnit, { [reviewedAiPart.id]: 'submitted handwriting evidence' }, 45, { [reviewedAiPart.id]: { status: 'success', rawMarks: reviewedAiPart.marks, confidence: 0.91, reviewRequired: false, markPoints: reviewedMarkPoints } })
assert.equal(aiScoredLifecycle.complete, true, 'reviewed AI evidence with sufficient confidence may complete a part')
const aiScoredResult = finalizePartMarking(reviewedAiUnit, aiScoredLifecycle, {}, 45)
assert.equal(aiScoredResult.rawMarks, reviewedAiPart.marks)
assert.equal(aiScoredResult.criteria[0].scoringSource, 'vision-assisted')
assert.ok(aiScoredResult.criteria[0].evidence.length > 0, 'AI marks must retain point-level evidence')
const selfMarkPendingAttempt = { id: 'pending-self-mark', unitId: selfMarkUnit.id, routeId: selfMarkUnit.routeId, stage: selfMarkUnit.stage, attemptStatus: 'self-mark-pending', submittedAt: '2026-08-10T00:00:00.000Z', selfMarkPending: true }
assert.equal(buildLearningEvents({ attempts: [selfMarkPendingAttempt], units: [selfMarkUnit], routeId: selfMarkUnit.routeId }).length, 0, 'self-mark-pending submissions must not create learning events')
assert.equal(buildLearningProgress({ attempts: [selfMarkPendingAttempt], units: [selfMarkUnit], routeId: selfMarkUnit.routeId }).completedSets, 0, 'self-mark-pending submissions must not change mastery or weekly completion')
assert.equal(buildCompletionByUnit({ attempts: [selfMarkPendingAttempt], units: [selfMarkUnit], routeId: selfMarkUnit.routeId })[selfMarkUnit.id].completed, false, 'self-mark-pending submissions must not mark a unit complete')
const partialAnsweredAttempt = {
  id: 'partial-answered', unitId: selfMarkUnit.id, routeId: selfMarkUnit.routeId, stage: selfMarkUnit.stage, attemptStatus: 'result', submittedAt: '2026-08-10T00:00:00.000Z',
  answers: { 'self-mark-part': 'Use the resultant force.' },
  scoreResult: { percentage: 25, rawMarks: 1, maxMarks: 4, criteria: [{ partId: 'self-mark-part', awarded: 1, maxMarks: 4 }] },
}
const blankScoredAttempt = {
  id: 'blank-scored', unitId: selfMarkUnit.id, routeId: selfMarkUnit.routeId, stage: selfMarkUnit.stage, attemptStatus: 'result', submittedAt: '2026-08-10T00:00:00.000Z',
  answers: {}, scoreResult: { percentage: 0, rawMarks: 0, maxMarks: 4, criteria: [{ partId: 'self-mark-part', awarded: 0, maxMarks: 4, status: 'blank' }] },
}
assert.equal(hasAttemptResponse(partialAnsweredAttempt, 'self-mark-part'), true, 'non-empty answers must be auditable as a response')
assert.equal(hasAttemptResponse(blankScoredAttempt, 'self-mark-part'), false, 'scoring a blank must not invent a response')
assert.equal(answeredQuestionCount(partialAnsweredAttempt, selfMarkUnit.parts), 1, 'only answered parts count as questions done')
assert.equal(answeredQuestionCount(blankScoredAttempt, selfMarkUnit.parts), 0, 'blank scored criteria must not count as questions done')
assert.equal(buildLearningProgress({ attempts: [partialAnsweredAttempt, blankScoredAttempt], units: [selfMarkUnit], routeId: selfMarkUnit.routeId }).week.completedQuestions, 1, 'weekly progress must count answered questions rather than scored criteria')
const retiredSourceAttempt = {
  ...partialAnsweredAttempt,
  id: 'retired-source-attempt',
  unitId: 'retired-source-unit',
  contentScope: { ...partialAnsweredAttempt.contentScope, title: 'Retired source record' },
}
const currentSourceProgress = buildLearningProgress({
  attempts: [partialAnsweredAttempt, retiredSourceAttempt],
  units: [selfMarkUnit],
  routeId: selfMarkUnit.routeId,
})
assert.equal(currentSourceProgress.completedSets, 1, 'a source-retired historical attempt must not enter current completion or mastery')
assert.equal(buildLearningEvents({
  attempts: [partialAnsweredAttempt, retiredSourceAttempt],
  units: [selfMarkUnit],
  routeId: selfMarkUnit.routeId,
}).filter((event) => event.attemptId === retiredSourceAttempt.id).length, 0, 'a source-retired attempt must remain raw history rather than generate learning events')
const auditExport = buildLearningExport({ attempts: [partialAnsweredAttempt, blankScoredAttempt] }, { units: [selfMarkUnit], exportedAt: '2026-08-10T01:00:00.000Z' })
assert.equal(auditExport.schemaVersion, 'alevel-learning-export-v2', 'exports must declare a stable schema version')
assert.equal(auditExport.audit.answeredQuestionCount, 1, 'exports must expose an auditable answered-question total')
assert.deepEqual(Object.keys(auditExport.data).sort(), ['attempts', 'consents', 'drafts', 'goals', 'notebook', 'paperReviews', 'paperSessions', 'responses', 'vocabulary'], 'exports must include every private learning data category without a duplicate state mirror')
assert.equal(auditExport.data.attempts.length, 2, 'exports must include every original and retest attempt explicitly')
assert.equal(auditExport.data.responses.length, 1, 'exports must omit blank criteria from response records')
assert.equal('state' in auditExport, false, 'exports must not duplicate the entire application state')
assert.equal('answers' in auditExport.data.attempts[0], false, 'attempt metadata must not duplicate response payloads')
const readyExport = await prepareLearningExport({ attempts: [partialAnsweredAttempt, blankScoredAttempt] }, { units: [selfMarkUnit], exportedAt: '2026-08-10T01:00:00.000Z' })
assert.match(readyExport.payload.integrity.checksum, /^[a-f0-9]{64}$/, 'ready exports must include a SHA-256 checksum')
assert.equal(JSON.parse(readyExport.json).integrity.checksum, readyExport.payload.integrity.checksum, 'the prepared JSON and payload must carry the same checksum')
const checksumSentinelAnswer = '0'.repeat(64)
const collisionExport = await prepareLearningExport({
  attempts: [{
    ...partialAnsweredAttempt,
    id: 'checksum-sentinel-answer',
    answers: { 'self-mark-part': checksumSentinelAnswer },
  }],
}, { units: [selfMarkUnit], exportedAt: '2026-08-10T01:00:00.000Z' })
const parsedCollisionExport = JSON.parse(collisionExport.json)
assert.equal(parsedCollisionExport.data.responses[0].answer, checksumSentinelAnswer, 'checksum embedding must not mutate an answer containing the old sentinel text')
assert.equal(parsedCollisionExport.integrity.checksum, collisionExport.checksum, 'checksum must be written only to the integrity field')
let serializationCount = 0
await prepareLearningExport({ attempts: [partialAnsweredAttempt] }, {
  units: [selfMarkUnit],
  exportedAt: '2026-08-10T01:00:00.000Z',
  serialize: (value) => {
    serializationCount += 1
    return JSON.stringify(value)
  },
})
assert.equal(serializationCount, 2, 'export preparation must serialize an unsigned checksum scope and a separate signed payload without string replacement')
await assert.rejects(
  prepareLearningExport({}, { digest: async () => { throw new Error('provider-secret-and-stack') } }),
  (error) => error.message === 'Your export could not be prepared. Try again.' && !error.message.includes('provider-secret'),
  'export preparation failures must be safe and retryable without leaking low-level details',
)
assert.equal(notebookNoteRequest('', '2026-08-10T01:00:00.000Z').method, 'DELETE', 'clearing a private note must issue a tombstone request')
assert.deepEqual(mergeNotebookNote({ body: 'old note', updatedAt: '2026-08-10T00:00:00.000Z' }, { body: '', updatedAt: '2026-08-10T01:00:00.000Z', deleted: true, deletedAt: '2026-08-10T01:00:00.000Z' }), { body: '', updatedAt: '2026-08-10T01:00:00.000Z', deleted: true, deletedAt: '2026-08-10T01:00:00.000Z', syncStatus: 'synced' }, 'a newer deletion tombstone must clear stale local note text')
assert.deepEqual(mergeNotebookNote({ body: 'stale offline note', updatedAt: '2026-08-10T02:00:00.000Z' }, { body: '', updatedAt: '2026-08-10T01:00:00.000Z', deleted: true, deletedAt: '2026-08-10T01:00:00.000Z' }, { preferTombstone: true }), { body: '', updatedAt: '2026-08-10T01:00:00.000Z', deleted: true, deletedAt: '2026-08-10T01:00:00.000Z', syncStatus: 'synced' }, 'a server tombstone must not let a stale offline device restore deleted note text')
assert.ok(learningPlan.knowledgeGroups.length >= 10, 'learning plan should expose a usable subject knowledge map')
assert.ok(learningPlan.practiceModes.some((mode) => mode.id === 'mock-exam'), 'learning plan should expose mock exam mode')
assert.deepEqual(new Set(learningPlan.subjects.map((subject) => subject.code)), new Set(['0580', '0606', '0610', '0625', '9231', '9700', '9701', '9702', '9708', '9709']), 'knowledge map must expose all requested Cambridge subjects')
assert.equal(unifiedQuestionBank.length, 230, 'question-level index must expose only the currently reviewed source-complete question groups')
assert.ok(unifiedQuestionBank.every(isVerifiedPastPaperItem), 'formal topic drills must contain only QP/MS-bound items')
assert.ok(unifiedQuestionBank.every((item) => item.sourceRef.sha256 !== item.answerRef.sha256), 'question and answer documents must remain independently bound')

const reviewedPhysicsDrill = selectTaggedQuestions({
  routeId: 'cie-9702-as-physics',
  qualificationId: 'cambridge-9702',
  stage: 'AS',
  knowledgeGroupId: 'physics-9702-topic-03',
  questionCount: 10,
})
assert.equal(reviewedPhysicsDrill.length, 10, 'the reviewed Dynamics inventory must provide a complete ten-question AS source set without substituting pending work')
assert.ok(reviewedPhysicsDrill.every((item) => [1, 2].includes(item.sourceRef?.component) && item.answerBinding?.verificationStatus === 'reviewed'), 'AS Physics Topic Drill must remain limited to reviewed AS QP/MS bindings')
const reviewedPhysicsUnit = buildCoachPractice({ routeId: 'cie-9702-as-physics', knowledgeGroupId: 'physics-9702-topic-03', questionCount: 10, allowPartial: true })
assert.equal(reviewedPhysicsUnit.parts.length, 17, 'a complete Dynamics set must retain every reviewed part across its ten coherent question groups')
assert.equal(reviewedPhysicsUnit.inventoryStatus, 'verified-source-inventory', 'a topic meeting the reviewed ten-question release threshold must expose a verified inventory status')
assert.ok(reviewedPhysicsUnit.parts.every((part) => [1, 2].includes(part.sourceRef?.component) && part.answerBinding?.verificationStatus === 'reviewed'), 'generated AS practice must not mix in unreviewed AS source groups')
const mixedPhysicsDrill = selectTaggedQuestions({
  routeId: 'cie-0580-igcse-mathematics',
  qualificationId: 'cambridge-0580',
  stage: 'IGCSE',
  knowledgeGroupId: 'math-0580-number',
  questionCount: 10,
})
assert.equal(mixedPhysicsDrill.length, 10, 'the reviewed source fixture must provide the requested topic item count')
assert.ok(new Set(mixedPhysicsDrill.map((item) => item.answerType)).size >= 1, 'topic drills should expose at least one validated answer surface')
assert.equal(new Set(mixedPhysicsDrill.map((item) => item.sourceRef.paperId)).size, 1, 'a one-paper reviewed fixture must report its actual paper provenance')
assert.ok(mixedPhysicsDrill.every((item) => item.answerBinding && item.answerRef), 'every selected question must retain its paired answer binding')
assert.ok(mixedPhysicsDrill.every((item) => item.routeId === 'cie-0580-igcse-mathematics' && item.stage === 'IGCSE'), 'reviewed drills must never cross route or stage boundaries')
const mixedPhysicsUnit = buildCoachPractice({ routeId: 'cie-0580-igcse-mathematics', knowledgeGroupId: 'math-0580-number', questionCount: 10 })
assert.ok(mixedPhysicsUnit.parts.every((part) => part.displayLabel), 'practice parts must expose a readable source label')
assert.equal(new Set(mixedPhysicsUnit.parts.map((part) => part.displayLabel)).size, mixedPhysicsUnit.parts.length, 'practice labels must remain unique when printed question numbers repeat')
const crossRouteCoachSelection = resolveVerifiedPracticeSelection({ subjectId: 'igcse-math', stage: 'IGCSE', topicId: 'math-0580-number' })
assert.equal(crossRouteCoachSelection.subject.routeId, 'cie-0580-igcse-mathematics', 'Coach must resolve IGCSE Number through the canonical verified catalog route resolver')
assert.equal(crossRouteCoachSelection.group.id, 'math-0580-number', 'Coach must retain its canonical topic ID across a route switch')
const crossRouteCoachUnit = buildRuntimeCoachPractice({
  subjectId: 'igcse-math',
  stage: 'IGCSE',
  topicId: 'math-0580-number',
  questionCount: 10,
  agentGenerated: true,
  unitId: 'coach-cross-route-igcse-number',
})
assert.equal(crossRouteCoachUnit.agentGenerated, true, 'Coach-created sets must remain visible after persistence')
assert.equal(crossRouteCoachUnit.routeId, 'cie-0580-igcse-mathematics', 'Coach-created sets must retain their canonical IGCSE route')
assert.equal(crossRouteCoachUnit.topicId, 'math-0580-number', 'Coach-created sets must retain their canonical topic context')
assert.equal(rebindRuntimeVerifiedPracticeUnit(crossRouteCoachUnit)?.agentGenerated, true, 'runtime rebinding must preserve the Coach-generated visibility contract')
const nextPhysicsDrill = selectTaggedQuestions({ routeId: 'cie-0580-igcse-mathematics', qualificationId: 'cambridge-0580', stage: 'IGCSE', knowledgeGroupId: 'math-0580-number', questionCount: 10, questionOffset: 10 })
assert.ok(nextPhysicsDrill.length > 0, 'a topic with more than ten reviewed questions must expose a second distinct set')
assert.equal(new Set([...mixedPhysicsDrill, ...nextPhysicsDrill].map((item) => item.sourceQuestionId)).size, mixedPhysicsDrill.length + nextPhysicsDrill.length, 'successive practice sets must not repeat source question groups')
const sourceBindingSnapshot = sourceBindingSnapshotForUnit(mixedPhysicsUnit)
assert.ok(sourceBindingSnapshot?.parts?.length, 'a scored source unit must capture a per-part canonical binding snapshot')
const sourceBoundAttempt = {
  id: 'source-binding-fixture',
  unitId: mixedPhysicsUnit.id,
  routeId: mixedPhysicsUnit.routeId,
  stage: mixedPhysicsUnit.stage,
  attemptStatus: 'result',
  submittedAt: '2026-08-11T10:00:00.000Z',
  sourceBinding: sourceBindingSnapshot,
  answers: { [mixedPhysicsUnit.parts[0].id]: 'source-bound response' },
  scoreResult: {
    rawMarks: 1,
    maxMarks: mixedPhysicsUnit.maxMarks,
    percentage: 10,
    criteria: [{ partId: mixedPhysicsUnit.parts[0].id, awarded: 0, maxMarks: mixedPhysicsUnit.parts[0].marks, feedback: 'Fixture evidence.' }],
  },
}
assert.equal(hasCurrentSourceBindingForAttempt(sourceBoundAttempt, mixedPhysicsUnit), true, 'a current attempt binding snapshot must remain score-eligible')
assert.equal(isScoredAttempt(sourceBoundAttempt, mixedPhysicsUnit), true, 'a current source-bound attempt may contribute to progress')
const changedSignatureUnit = structuredClone(mixedPhysicsUnit)
changedSignatureUnit.parts[0].markingProvenance.bindingSignature = 'fnv1a64:0000000000000000'
assert.equal(hasCurrentSourceBindingForAttempt(sourceBoundAttempt, changedSignatureUnit), false, 'a same-unit ID with changed source binding must be read-only')
assert.equal(isScoredAttempt(sourceBoundAttempt, changedSignatureUnit), false, 'a stale source-bound score must not contribute to progress')
const forgedSourceUnit = structuredClone(mixedPhysicsUnit)
forgedSourceUnit.parts[0].sourceQuestionId = `${forgedSourceUnit.parts[0].sourceQuestionId}@forged-version`
assert.equal(sourceBindingSnapshotForUnit(forgedSourceUnit), null, 'attempt source snapshots must fail closed for forged suffixed source IDs')
const staleBindingProgress = buildLearningProgress({
  attempts: [sourceBoundAttempt],
  units: [changedSignatureUnit],
  routeId: changedSignatureUnit.routeId,
})
assert.equal(staleBindingProgress.week.completedQuestions, 0, 'a stale source-bound score must not enter the progress denominator')
const staleBindingExport = buildLearningExport({ attempts: [sourceBoundAttempt] }, { units: [changedSignatureUnit], exportedAt: '2026-08-11T10:00:00.000Z' })
assert.equal(staleBindingExport.audit.attempts[0].sourceBindingStatus, 'stale-or-missing', 'exports must retain stale attempts only as audit evidence')
assert.equal(staleBindingExport.audit.attempts[0].score, null, 'exports must omit a stale score from its canonical scored-attempt projection')
assert.equal(staleBindingExport.data.notebook.items.length, 0, 'a stale score must not create notebook mistakes')

const march2025P1Metadata = paperQuestionMarkingMetadata({ paperId: 'cie-9709-9709_m25_qp_12', routeId: 'cie-9709-as-p1-p2' })
assert.equal(march2025P1Metadata[1], undefined, 'machine-indexed 9709 March 2025 P1 Q1 must remain self-mark only until a human review is recorded')
const reviewedMarch2025Metadata = paperQuestionMarkingMetadata({ paperId: reviewedFixtureSource.sourceRef.paperId, routeId: reviewedFixtureSource.routeId, questionBank: [reviewedFixtureSource] })
assert.equal(isHumanReviewedPastPaperItem(reviewedFixtureSource), true, 'only a reviewed binding may become AI-marking metadata')
assert.equal(reviewedMarch2025Metadata[1].maxMarks, 1, 'a reviewed source fixture must hydrate its exact part allocation')
assert.equal(reviewedMarch2025Metadata[1].answerRef.paperId, reviewedFixtureSource.answerRef.paperId, 'a reviewed fixture must bind the exact paired mark scheme')
assert.ok(reviewedMarch2025Metadata[1].expectedMarkPoints.length >= 1, 'a reviewed fixture must provide structured mark points')
const march2025P1Submission = buildSharedMarkingSubmission({
  attemptId: 'fixture-attempt',
  routeId: 'cie-9709-as-p1-p2',
  specificationVersion: '2025-2027',
  paperId: 'cie-9709-9709_m25_qp_12',
  responses: [{
    questionNumber: 1,
    questionMetadata: reviewedMarch2025Metadata[1],
    typedText: 'Use the discriminant and require it to be less than zero.',
    questionAssetsByPart: {
      [reviewedMarch2025Metadata[1].parts[0].id]: {
        status: 'available',
        assetUrl: reviewedMarch2025Metadata[1].parts[0].markingProvenance.sourceEvidence.assetUrl,
        sha256: reviewedMarch2025Metadata[1].parts[0].markingProvenance.sourceEvidence.assetSha256,
        imageDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+1P6Q6QAAAABJRU5ErkJggg==',
      },
    },
  }],
})
assert.equal(march2025P1Submission.ok, true, 'reviewed paper metadata and a typed response must build a shared structured marking submission')
assert.equal(march2025P1Submission.payload.questions[0].availableMarks, 1, 'shared marking requests must carry the reviewed available marks')
assert.equal(march2025P1Submission.payload.questions[0].assets[0].checksum, `sha256:${reviewedMarch2025Metadata[1].parts[0].markingProvenance.sourceEvidence.assetSha256}`, 'shared marking requests must carry the exact question-page image checksum')
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

const stagingMarkingOrigin = configuredIdentityOrigin('https://staging.ieltsist.test/auth/bridge')
const stagingMarkingUrls = []
const stagingCreate = await createSharedMarkingSubmission({
  token: 'staging-test-token',
  submission: march2025P1Submission.payload,
  origin: stagingMarkingOrigin,
  fetchImpl: async (url) => {
    stagingMarkingUrls.push(String(url))
    return new Response(JSON.stringify({ submission: { submissionId: 'staging-fixture', status: 'queued' } }), { status: 202 })
  },
})
assert.equal(stagingCreate.status, 'queued', 'staging marking submission must retain the shared response contract')
const stagingPoll = await waitForSharedMarkingSubmission({
  token: 'staging-test-token',
  submissionId: 'staging-fixture',
  origin: stagingMarkingOrigin,
  attempts: 1,
  fetchImpl: async (url) => {
    stagingMarkingUrls.push(String(url))
    return new Response(JSON.stringify({ submission: { submissionId: 'staging-fixture', status: 'completed', result: { questions: [] } } }), { status: 200 })
  },
})
assert.equal(stagingPoll.status, 'completed', 'staging marking polling must use the configured service')
const stagingRetry = await retrySharedMarkingSubmission({
  token: 'staging-test-token',
  submissionId: 'staging-fixture',
  origin: stagingMarkingOrigin,
  fetchImpl: async (url) => {
    stagingMarkingUrls.push(String(url))
    return new Response(JSON.stringify({ submission: { submissionId: 'staging-fixture', status: 'queued' } }), { status: 202 })
  },
})
assert.equal(stagingRetry.status, 'queued', 'staging marking retry must retain the shared response contract')
assert.deepEqual(stagingMarkingUrls, [
  'https://staging.ieltsist.test/api/stem/marking/submissions',
  'https://staging.ieltsist.test/api/stem/marking/submissions/staging-fixture',
  'https://staging.ieltsist.test/api/stem/marking/submissions/staging-fixture/retry',
], 'submission, polling and retry must all use the same configured identity origin')
assert.ok(stagingMarkingUrls.every((url) => !url.startsWith('https://ieltsist.com/')), 'local or staging marking operations must never fall through to production')

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
      : { submissionId: 'status-fixture', status: 'completed', result: { questions: [{ questionPartId: march2025P1Submission.payload.questions[0].questionPartId, awardedMarks: 1, maxMarks: 1, confidence: 0.95, reviewRequired: false, markPoints: [] }] } }
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

assert.throws(() => buildCoachPractice({ routeId: 'cie-0610-igcse-biology', knowledgeGroupId: 'biology-0610-cell', questionCount: 10 }), PracticeInventoryError, '0610 Cells must remain blocked while its source inventory is unreviewed')
assert.throws(() => buildCoachPractice({ routeId: 'cie-9700-a2-biology', knowledgeGroupId: 'biology-9700-a2-energy', questionCount: 10, allowPartial: true }), PracticeInventoryError, '9700 A2 Energy must remain blocked while its source inventory is unreviewed')

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
const missingPageRecord = questionIndex.questions.find((item) => item.questionId === 'cie-9701-9701_s25_qp_41:q7')
assert.ok(missingPageRecord, 'known multi-page source fixture must be present in the raw import')
assert.ok(sourceBindingStatus(missingPageRecord).reasons.includes('missing-page-asset:10'), 'raw source records with a missing intermediate page must be quarantined')
assert.equal(sourceContentManifest.items[missingPageRecord.questionId]?.complete, false, 'the client gate must retain the audit quarantine for a missing source page')
assert.ok(unifiedQuestionBank.every((item) => validateQuestionGroup(item).valid), 'every formal item must have reconciled question parts')
assert.ok(!unifiedQuestionBank.some((item) => item.sourceQuestionId === 'cie-0625-0625_m25_qp_42:q1'), 'the known 0625 multi-part OCR record must stay out of the scored bank')
const reviewed9702P2Q1 = unifiedQuestionBank.find((item) => item.sourceQuestionId === 'cie-9702-9702_m25_qp_22:q1')
assert.ok(reviewed9702P2Q1, 'the manually reconstructed 9702 M25/22 Q1 must enter the scored bank')
assert.equal(reviewed9702P2Q1.parts.length, 4, 'the manually reconstructed 9702 M25/22 Q1 must retain all four reviewed parts')
assert.equal(reviewed9702P2Q1.totalMarks, 7, 'the manually reconstructed 9702 M25/22 Q1 must retain the official total')
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
const reviewedGroup = unifiedQuestionBank.find((item) => item.routeId === 'cie-0580-igcse-mathematics' && item.parts.length > 1)
assert.ok(reviewedGroup, 'the reviewed 0580 pilot must provide a structured multi-part QuestionGroup fixture')
const reviewedPractice = buildCoachPractice({ routeId: reviewedGroup.routeId, knowledgeGroupId: reviewedGroup.knowledgeGroupId, questionCount: 10, allowPartial: true })
assert.ok(reviewedPractice.parts.length >= reviewedGroup.parts.length, 'Coach practice must flatten a reviewed multi-part group into explicit QuestionParts')
assert.ok(reviewedPractice.parts.every((part) => part.routeId === reviewedGroup.routeId && part.stage === reviewedGroup.stage), 'reviewed practice must remain route and stage isolated')
assert.ok(reviewedPractice.parts.every((part) => part.questionGroupId && part.questionPartId && part.sourceRef.page && part.answerRef.page), 'every Coach item must preserve group, part, QP page, and MS page bindings')
assert.throws(() => buildCoachPractice({ routeId: 'cie-9702-a2-physics', knowledgeGroupId: 'physics-9702-topic-01', questionCount: 10 }), PracticeInventoryError, 'a route without reviewed source inventory must not start a practice set')
const exactAssignedPractice = buildCoachPractice({ routeId: reviewedGroup.routeId, knowledgeGroupId: reviewedGroup.knowledgeGroupId, sourceQuestionIds: [reviewedGroup.bankId], unitId: 'assignment-test' })
assert.equal(exactAssignedPractice.questionGroupCount, 1, 'an assigned source list must not be expanded to the normal ten-question drill minimum')
assert.equal(exactAssignedPractice.parts.length, reviewedGroup.parts.length, 'an assignment must reopen the exact saved question group, including every QuestionPart')
assert.deepEqual(exactAssignedPractice.assignmentSourceIds, [reviewedGroup.bankId], 'an assignment must retain its immutable source question IDs')
assert.throws(() => buildCoachPractice({ routeId: reviewedGroup.routeId, knowledgeGroupId: reviewedGroup.knowledgeGroupId, sourceQuestionIds: [reviewedGroup.bankId, reviewedGroup.bankId] }), /duplicate question IDs/, 'duplicate assignment sources must be rejected')

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
assert.equal(paperCatalog.schemaVersion, 2, 'paper catalog schema changed')
assert.equal(paperCatalog.items.length, 10689, 'paper catalog must contain every downloaded file')
assert.equal(paperCatalog.paperGovernance?.schemaVersion, 'paper-governance-v1', 'paper catalog must carry the governed source policy contract')
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
  assert.ok(['active', 'withdrawn', 'quarantined'].includes(paper.governance?.state), `${paper.file} must declare an explicit governance state`)
  assert.ok(paper.governance?.sourcePolicyId, `${paper.file} must declare a source policy`)
  assert.ok(paper.governance?.accessPolicyId, `${paper.file} must declare an access policy`)
  assert.ok(paper.governance?.sourceVersion, `${paper.file} must declare its source version`)
}
const paperGovernanceStates = Object.groupBy(paperCatalog.items, (paper) => paper.governance?.state || 'missing')
assert.equal((paperGovernanceStates.active || []).length, 10688, 'paper catalog must keep only verified-integrity PDFs active for student access')
assert.deepEqual((paperGovernanceStates.quarantined || []).map((paper) => paper.id), ['cie-9702-9702_w07_ir_32'], 'damaged PDFs must remain explicitly quarantined instead of silently activated')

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
const { GUEST_STORAGE_CLAIM_KEY, LEGACY_STORAGE_OWNER_KEY, loadState: loadStoredState, mergeStoredState, normalizeState: normalizeStoredState, normalizeSyncItem, saveState: saveStoredState, storageKeyForUser } = await import('../src/lib/storage.js')
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
const legacyTopicIdUnit = { routeId: 'cie-9702-as-physics', knowledgeGroupId: 'physics-9702-topic-03', maxMarks: 1, parts: [{ id: 'legacy-topic-part', marks: 1, answerType: 'multiple-choice', answer: 'A', markPoints: ['A'] }] }
assert.deepEqual(
  [scoreAttempt(legacyTopicIdUnit, {}, 1).routeId, scoreAttempt(legacyTopicIdUnit, {}, 1).stage],
  ['cie-9702-as-physics', 'AS'],
  'registered route validation must accept a legacy knowledge-group ID when its syllabus topic title matches',
)
const generatedReviewedUnit = mixedPhysicsUnit
const normalizedGeneratedReviewedState = normalizeStoredState({ generatedUnits: [generatedReviewedUnit] })
assert.equal(normalizedGeneratedReviewedState.generatedUnits[0].routeId, generatedReviewedUnit.routeId, 'reviewed Topic drills must retain their registered route when persisted')
assert.equal(normalizedGeneratedReviewedState.generatedUnits[0].stage, generatedReviewedUnit.stage, 'reviewed Topic drills must retain their canonical academic stage when persisted')
assert.ok(normalizedGeneratedReviewedState.generatedUnits[0].parts.every((part) => part.routeId === generatedReviewedUnit.routeId), 'persisted reviewed Topic drill parts must remain route-isolated')
assert.throws(() => buildCoachPractice({ routeId: 'cie-9709-a2-after-p1-p5-p3-p4', knowledgeGroupId: 'math-9709-pure', questionCount: 10, allowPartial: true }), PracticeInventoryError, '9709 Topic drills must remain blocked until their source index receives semantic review')
assert.throws(() => buildCoachPractice({ routeId: 'uatuk-esat-admissions', knowledgeGroupId: 'esat-physics', questionCount: 10, allowPartial: true }), PracticeInventoryError, 'ESAT Topic drills must remain blocked until their source index receives semantic review')

assert.equal(isScoredAttempt({ attemptStatus: 'self-mark-pending', selfMarkPending: true, submittedAt: '2026-08-10T00:00:00.000Z' }), false, 'a self-mark-pending attempt must never enter score consumers')
assert.equal(isPendingSelfMarkAttempt({ attemptStatus: 'self-mark-pending' }), true, 'pending self-mark attempts must remain identifiable for append-only history')
assert.equal(isScoredAttempt({ attemptStatus: 'result', submittedAt: '2026-08-10T00:00:00.000Z', scoreResult: { rawMarks: 4, maxMarks: 5, percentage: 80 } }), true, 'a valid finalized result must enter score consumers')
assert.equal(isScoredAttempt({ attemptStatus: 'provisional-result', submittedAt: '2026-08-10T00:00:00.000Z', scoreResult: { rawMarks: 1, maxMarks: 1, percentage: 100, partial: true } }), false, 'a partial result must never enter mastery, grade, mistake or progress consumers')
assert.equal(isScoredAttempt({ attemptStatus: 'result', submittedAt: '2026-08-10T00:00:00.000Z', scoreResult: { rawMarks: 0, maxMarks: 0, percentage: 0 } }), false, 'an invalid zero-mark score shell must not enter score consumers')
const pendingAuditExport = buildLearningExport({ attempts: [selfMarkPendingAttempt] }, { units: [selfMarkUnit], exportedAt: '2026-08-10T01:00:00.000Z' })
assert.equal(pendingAuditExport.data.attempts.length, 1, 'append-only export must preserve the pending source attempt')
assert.equal(pendingAuditExport.audit.attempts[0].status, 'self-mark-pending', 'export must identify the pending lifecycle state')
assert.equal(pendingAuditExport.audit.attempts[0].score, null, 'export must not manufacture a score for pending self-mark work')
assert.equal(pendingAuditExport.data.notebook.items.length, 0, 'pending self-mark work must not create scored mistake rows')

const storageValues = new Map()
const testLocalStorage = {
  getItem: (key) => storageValues.has(key) ? storageValues.get(key) : null,
  setItem: (key, value) => storageValues.set(String(key), String(value)),
  removeItem: (key) => storageValues.delete(String(key)),
}
const previousWindow = globalThis.window
globalThis.window = { localStorage: testLocalStorage }
try {
  const legacyState = normalizeStoredState({
    profile: { activeRouteId: 'cie-9702-as-physics', learningTrack: 'AS' },
    notebookNotes: { 'cie-9702-as-physics': { body: 'Legacy note claimed by A', updatedAt: '2026-08-10T00:00:00.000Z', syncStatus: 'local-only' } },
    attempts: [{ id: 'legacy-a-attempt', unitId: 'legacy-unit', routeId: 'cie-9702-as-physics', stage: 'AS', attemptStatus: 'self-mark-pending' }],
  })
  testLocalStorage.setItem('alevel-learning-platform-v2', JSON.stringify(legacyState))
  const accountA = loadStoredState({ userId: 'ielts:101' })
  assert.equal(accountA.notebookNotes['cie-9702-as-physics'].body, 'Legacy note claimed by A', 'the first identified account must claim existing legacy learning state once')
  assert.equal(testLocalStorage.getItem(LEGACY_STORAGE_OWNER_KEY), 'ielts:101', 'legacy state migration must record its exact owner')
  assert.ok(testLocalStorage.getItem(storageKeyForUser('ielts:101', testLocalStorage)), 'legacy state must be copied into account A namespace')
  saveStoredState({ ...accountA, notebookNotes: { 'cie-9702-as-physics': { body: 'A private note', updatedAt: '2026-08-10T01:00:00.000Z' } } }, { userId: 'ielts:101', replaceSyncQueue: true })

  const accountBEmpty = loadStoredState({ userId: 'ielts:202' })
  assert.equal(accountBEmpty.notebookNotes?.['cie-9702-as-physics'], undefined, 'account B must not receive legacy or account A private notes')
  saveStoredState({ ...accountBEmpty, notebookNotes: { 'cie-9702-as-physics': { body: 'B private note', updatedAt: '2026-08-10T02:00:00.000Z' } } }, { userId: 'ielts:202', replaceSyncQueue: true })
  assert.equal(loadStoredState().notebookNotes?.['cie-9702-as-physics'], undefined, 'guest state must be isolated after legacy data receives an account owner')
  assert.equal(loadStoredState({ userId: 'ielts:101' }).notebookNotes['cie-9702-as-physics'].body, 'A private note', 'switching back to A must restore only A state')

  testLocalStorage.setItem('alevel-learning-platform-v2', JSON.stringify({ ...legacyState, notebookNotes: { 'cie-9702-as-physics': { body: 'stale legacy pollution', updatedAt: '2026-08-11T00:00:00.000Z' } } }))
  assert.equal(loadStoredState({ userId: 'ielts:202' }).notebookNotes['cie-9702-as-physics'].body, 'B private note', 'the legacy key must never merge into another account after ownership is recorded')
  assert.equal(loadStoredState({ userId: 'ielts:101' }).notebookNotes['cie-9702-as-physics'].body, 'A private note', 'later legacy-key changes must not overwrite the owning account namespace')
  saveStoredState({
    profile: { activeRouteId: 'cie-9702-as-physics', learningTrack: 'AS' },
    attempts: [{ id: 'guest-after-legacy-claim', unitId: 'guest-unit', routeId: 'cie-9702-as-physics', stage: 'AS', attemptStatus: 'self-mark-pending' }],
    notebookNotes: { 'cie-9702-as-physics': { body: 'Guest note must not replace A', updatedAt: '2026-08-09T00:00:00.000Z' } },
  }, { userId: '', replaceSyncQueue: true })
  assert.ok(testLocalStorage.getItem(storageKeyForUser('', testLocalStorage)), 'guest work created after a legacy claim must use the guest namespace')
  const accountAWithGuest = loadStoredState({ userId: 'ielts:101' })
  assert.ok(accountAWithGuest.attempts.some((attempt) => attempt.id === 'guest-after-legacy-claim'), 'the next authenticated owner must receive later guest work once')
  assert.equal(accountAWithGuest.notebookNotes['cie-9702-as-physics'].body, 'A private note', 'guest notes must not overwrite an existing owner note for the same route')
  assert.equal(testLocalStorage.getItem(storageKeyForUser('', testLocalStorage)), null, 'claimed guest work must be removed so it cannot pollute a later account')
  assert.equal(JSON.parse(testLocalStorage.getItem(GUEST_STORAGE_CLAIM_KEY)).userId, 'ielts:101', 'guest claim audit marker must name the consuming account')
  assert.equal(loadStoredState({ userId: 'ielts:101' }).attempts.filter((attempt) => attempt.id === 'guest-after-legacy-claim').length, 1, 'reloading the owner must not merge the consumed guest work again')
  assert.equal(loadStoredState({ userId: 'ielts:202' }).attempts.some((attempt) => attempt.id === 'guest-after-legacy-claim'), false, 'consumed guest work must not leak from A into B')
} finally {
  if (previousWindow === undefined) delete globalThis.window
  else globalThis.window = previousWindow
}

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
