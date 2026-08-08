import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { importedPdfLibrary, practiceUnits } from '../src/data/catalog.js'
import { learningPlan, stagesForComponentTags } from '../src/data/learningPlan.js'
import { getExamPaperProfile, getRouteOptions, getStageGuidance } from '../src/data/examStructure.js'
import { reviewAttempt } from '../src/lib/aiReview.js'
import { latestBphoSpcPaper, parseCoachIntent } from '../src/lib/coachIntent.js'
import { isVerifiedPastPaperItem, selectTaggedQuestions, unifiedQuestionBank } from '../src/data/questionBank.js'
import { buildCoachPractice } from '../src/lib/coachPractice.js'
import { scoreAttempt } from '../src/lib/scoring.js'
import { buildCoachSystemPrompt, normalizeMarkResult, parseStructuredJson, providerConfig } from '../server/aiApi.js'

const unitIds = new Set(practiceUnits.map((unit) => unit.id))
assert.equal(unitIds.size, practiceUnits.length, 'practice unit IDs must be unique')

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
assert.ok(paperAnswerSheetSource.includes('<HandwritingPad'), 'structured paper questions must use the unified handwriting pad')
assert.ok(!paperAnswerSheetSource.includes('Show your working'), 'structured paper questions must not expose a separate working field')
assert.ok(!paperAnswerSheetSource.includes('Final answer</span>'), 'structured paper questions must not expose a separate final-answer field')

assert.equal(practiceUnits.length, 0, 'formal practice must not expose generated seed questions')
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
assert.ok(new Set(mixedPhysicsDrill.map((item) => item.answerType)).size >= 2, 'topic drills should expose multiple answer surfaces when the source bank has them')
assert.ok(new Set(mixedPhysicsDrill.map((item) => item.sourceRef.paperId)).size >= 2, 'topic drills should draw from more than one official paper when available')
assert.ok(mixedPhysicsDrill.every((item) => item.answerBinding && item.answerRef), 'every selected question must retain its paired answer binding')
assert.ok(mixedPhysicsDrill.every((item) => item.routeId === 'cie-9702-as-physics' && item.stage === 'AS'), 'AS drills must never contain A2 or IGCSE questions')

const igcseBiologyDrill = buildCoachPractice({ routeId: 'cie-0610-igcse-biology', knowledgeGroupId: 'biology-0610-cell', questionCount: 10 })
assert.equal(igcseBiologyDrill.parts.length, 10, '0610 Cells must unlock a ten-question verified drill')
assert.ok(igcseBiologyDrill.parts.every(isVerifiedPastPaperItem), '0610 drill must retain verified question bindings')
const a2BiologyDrill = buildCoachPractice({ routeId: 'cie-9700-a2-biology', knowledgeGroupId: 'biology-9700-a2-energy', questionCount: 10 })
assert.equal(a2BiologyDrill.parts.length, 10, '9700 A2 Energy must unlock a ten-question verified drill')
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
assert.ok(questionIndex.bindings.every((item) => ['machine-indexed', 'reviewed'].includes(item.verificationStatus)), 'bindings must disclose their verification state')

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

const { courseRoutes: routeContractRegistry } = await import('../src/data/routeRegistry.js')
const { LEGACY_UNSCOPED_ROUTE_ID: unscopedRouteId, resolveRouteBinding: resolveRouteContract } = await import('../src/lib/routeMigration.js')
const { mergeStoredState, normalizeState: normalizeStoredState, normalizeSyncItem } = await import('../src/lib/storage.js')

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
