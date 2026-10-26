import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { buildAdmissionsAdvisorSystemPrompt } from '../server/admissionsAdvisor.js'
import { buildIeltsTeacherSystemPrompt } from '../server/ieltsTeacher.js'

const admissionsPrompt = buildAdmissionsAdvisorSystemPrompt()
const ieltsPrompt = buildIeltsTeacherSystemPrompt()
const fixturePath = path.join(import.meta.dirname, 'fixtures', 'advisor-prompt-product-cases.json')
const catalog = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))

function assertAny(text, patterns, message) {
  assert.ok(patterns.some((pattern) => pattern.test(text)), message)
}

function assertPromptContinuity(prompt, roleLabel) {
  assertAny(prompt, [
    /(?:use|reuse|carry forward).{0,80}(?:already[- ]known|already supplied|previously supplied|earlier).{0,50}(?:facts|information|context)/is,
    /(?:already[- ]known|previously supplied).{0,50}(?:facts|information|context).{0,80}(?:use|reuse|retain)/is,
  ], `${roleLabel} must explicitly reuse already-known conversation facts`)
  assertAny(prompt, [
    /(?:latest|later|newer|most recent).{0,50}(?:user )?(?:correction|fact).{0,80}(?:supersede|replace|override|take precedence)/is,
    /(?:correction|corrected fact).{0,80}(?:supersede|replace|override|take precedence).{0,80}(?:older|earlier|previous)/is,
  ], `${roleLabel} must make the latest user correction supersede older facts`)
  assertAny(prompt, [
    /ask only (?:for )?(?:material|essential|necessary|decision-relevant).{0,40}(?:missing|unknown) (?:facts|information|details)/is,
    /only ask.{0,50}(?:missing|unknown).{0,40}(?:material|essential|necessary|decision-relevant)/is,
  ], `${roleLabel} must ask only for material missing information`)
  assertAny(prompt, [
    /(?:avoid|do not use|no).{0,40}(?:routine|repeated|default).{0,30}(?:questionnaire|questions)/is,
    /(?:do not|never).{0,40}(?:restart|repeat).{0,40}(?:profile|questionnaire|questions already answered)/is,
  ], `${roleLabel} must prevent routine or repeated questionnaires`)
}

function assertPromptDeliveryStyle(prompt, roleLabel) {
  assertAny(prompt, [
    /answer (?:the )?(?:student'?s )?(?:current|immediate) request first/i,
    /(?:current|immediate) request.{0,40}(?:comes|goes|answer).{0,20}first/is,
  ], `${roleLabel} must answer the current request first`)
  assertAny(prompt, [
    /(?:concise|brief) by default/i,
    /default.{0,30}(?:concise|brief)/i,
  ], `${roleLabel} must be concise by default`)
  assertAny(prompt, [
    /(?:mobile[- ]friendly|easy to read on (?:a )?phone|phone[- ]readable)/i,
    /(?:brief|short|compact).{0,30}(?:sections?|headings?).{0,50}(?:mobile|phone)/is,
  ], `${roleLabel} must make optional structure mobile-friendly`)
  assertAny(prompt, [
    /(?:avoid|do not use|no).{0,70}(?:wide tables?|raw JSON|code blocks?)/is,
    /(?:wide tables?|raw JSON|code blocks?).{0,60}(?:avoid|not appropriate|do not use)/is,
  ], `${roleLabel} must prohibit wide tables, raw JSON or prose code blocks`)
  assertAny(prompt, [
    /honou?r.{0,50}(?:requested|specified).{0,30}(?:length|format|deliverable)/is,
    /(?:requested|specified).{0,30}(?:length|format).{0,40}(?:honou?r|follow|respect)/is,
  ], `${roleLabel} must honor an explicitly requested deliverable length or format`)
}

test('protected admissions prompt boundaries remain explicit and compact', () => {
  assert.ok(Array.from(admissionsPrompt).length <= 8_500, 'admissions prompt must stay within the product prompt budget')
  assert.match(admissionsPrompt, /fixed server-owned role/i)
  assert.match(admissionsPrompt, /no live browsing tool/i)
  assert.match(admissionsPrompt, /never fabricate/i)
  assert.match(admissionsPrompt, /never guarantee/i)
  assert.match(admissionsPrompt, /at most three/i)
  assert.match(admissionsPrompt, /do not infer or import Tavern history/i)
})

test('protected IELTS prompt boundaries remain explicit and compact', () => {
  assert.ok(Array.from(ieltsPrompt).length <= 8_500, 'IELTS prompt must stay within the product prompt budget')
  assert.match(ieltsPrompt, /fixed server-owned, text-only teaching role/i)
  assert.match(ieltsPrompt, /no live browsing tool/i)
  assert.match(ieltsPrompt, /Task Achievement/)
  assert.match(ieltsPrompt, /Task Response/)
  assert.match(ieltsPrompt, /exactly one question or one cue card at a time/i)
  assert.match(ieltsPrompt, /never claim to hear/i)
  assert.match(ieltsPrompt, /pronunciation, accent, pace, pauses/i)
  assert.match(ieltsPrompt, /never derive an overall Speaking band from text alone/i)
})

test('both advisor prompts reuse context and give latest corrections precedence', () => {
  assertPromptContinuity(admissionsPrompt, 'admissions advisor')
  assertPromptContinuity(ieltsPrompt, 'IELTS teacher')
})

test('both advisor prompts prioritize concise direct mobile-friendly delivery', () => {
  assertPromptDeliveryStyle(admissionsPrompt, 'admissions advisor')
  assertPromptDeliveryStyle(ieltsPrompt, 'IELTS teacher')
})

test('admissions prompt produces requested drafts and edits before clarification', () => {
  assertAny(admissionsPrompt, [
    /(?:draft|edit|deliverable).{0,80}(?:first|before asking|before clarification)/is,
    /provide.{0,50}(?:usable|requested).{0,30}(?:draft|edit).{0,40}first/is,
  ], 'admissions direct drafting/editing requests need the usable deliverable first')
  assert.match(admissionsPrompt, /human[- ]readable placeholders?/i)
  assert.doesNotMatch(admissionsPrompt, /\[NEEDS USER FACT:/i, 'machine-like NEEDS USER FACT markers are not phone-friendly')
  assertAny(admissionsPrompt, [
    /(?:default|normally|usually).{0,40}(?:one or two|1\s*(?:-|–|to)\s*2).{0,30}(?:questions?|information requests?)/is,
    /(?:one or two|1\s*(?:-|–|to)\s*2).{0,30}(?:questions?|information requests?).{0,40}(?:by default|normally|usually)/is,
  ], 'admissions may retain a three-question ceiling but should default to one or two material questions')
})

test('admissions targeted edits preserve factual qualifiers and avoid unnecessary rewrites', () => {
  assert.ok(/preserve.{0,70}qualifiers.{0,70}(?:can|may)/is.test(admissionsPrompt), 'editing must preserve uncertainty and supplied detail')
  assert.ok(/already meets.{0,50}(?:limit|constraint).{0,100}(?:keep|retain|reuse)/is.test(admissionsPrompt), 'do not alter meaning merely to make another revision')
})

test('meaning-preserving edits use the original user text and surgical changes', () => {
  assert.ok(/original user text.{0,65}source of truth/is.test(admissionsPrompt), 'the original must remain authoritative after a lossy assistant revision')
  assert.ok(/redundant function words.{0,80}(?:grammar|grammatical)/is.test(admissionsPrompt), 'minimal edits must avoid dropping content claims')
  assert.ok(/content-bearing.{0,70}(?:outcomes|claims)/is.test(admissionsPrompt), 'outcome and comparison meaning must remain intact')
})

test('admissions prompt separates facts requirements fit and optional enrichment', () => {
  assert.match(admissionsPrompt, /achieved.{0,50}predicted|predicted.{0,50}achieved/is)
  assertAny(admissionsPrompt, [
    /requirements?.{0,100}(?:optional|competitions?|research)/is,
    /(?:optional|competitions?|research).{0,100}requirements?/is,
  ], 'admissions must distinguish requirements from optional competitions or research')
  assertAny(admissionsPrompt, [
    /eligibility.{0,60}(?:fit|preparation).{0,60}(?:next actions?|verification)/is,
    /(?:eligibility|requirements?).{0,80}(?:qualitative )?fit.{0,80}(?:next actions?|verify)/is,
  ], 'admissions must separate eligibility, qualitative fit and next actions')
  assertAny(admissionsPrompt, [
    /(?:one|single).{0,30}(?:nearby|brief).{0,30}(?:source )?(?:qualifier|caveat)/is,
    /(?:source )?(?:qualifier|caveat).{0,40}(?:once|one time|nearby)/is,
  ], 'unverified programme facts need one nearby qualifier rather than repeated disclaimers')
  assertAny(admissionsPrompt, [
    /(?:do not|never|avoid).{0,80}(?:sensitive )?(?:identity|financial).{0,50}(?:documents?|data)/is,
    /(?:identity|financial).{0,30}(?:documents?|data).{0,60}(?:do not request|never request|avoid collecting)/is,
  ], 'admissions must avoid unnecessary sensitive identity or financial documents')
})

test('admissions drafting does not add invented administrative procedures or source-authentication shortcuts', () => {
  assert.ok(/do not (?:invent|infer).{0,45}administrative procedures/is.test(admissionsPrompt), 'administrative procedures must remain unverified')
  assert.ok(/draft-only.{0,60}(?:draft only|only the draft)/is.test(admissionsPrompt), 'draft-only requests should not acquire unsolicited policy advice')
  assert.ok(/(?:email address|domain).{0,100}(?:not proof|not establish)/is.test(admissionsPrompt), 'institutional-looking addresses do not establish policy truth')
})

test('admissions delta-only updates preserve fixed time budgets without repeated intake', () => {
  assert.ok(/fixed time budget.{0,35}hard cap/is.test(admissionsPrompt), 'fixed time must be a hard constraint')
  assert.ok(/reallocate.{0,80}(?:subtract|remove)/is.test(admissionsPrompt), 'added work must replace existing minutes')
  assert.ok(/do not repeat unanswered intake questions.{0,70}update-only/is.test(admissionsPrompt), 'delta-only updates should not repeat unanswered intake')
})

test('admissions routine drafts keep unknown personal facts as questions not declarations', () => {
  assert.ok(/unknown personal facts.{0,150}first-person declarative/is.test(admissionsPrompt), 'unknown timelines and application stages cannot become personal assertions')
  assert.ok(/routine enquiry.{0,150}name.{0,80}email/is.test(admissionsPrompt), 'routine enquiries should have only minimal contact placeholders')
  assert.ok(/(?:birth|DOB).{0,100}(?:even if|conditional)|(?:even if|conditional).{0,100}(?:birth|DOB)/is.test(admissionsPrompt), 'do not add conditional requests for unnecessary birth data')
})

test('no-profile enquiry emails use questions rather than invented personal history', () => {
  assert.ok(/no personal profile.{0,100}questions.{0,60}thanks/is.test(admissionsPrompt), 'no-profile enquiries must not acquire an autobiography')
  assert.ok(/not knowing.{0,70}does not mean.{0,40}(?:not having|not owning)/is.test(admissionsPrompt), 'unknown reference information is not a claim that no identifier exists')
})

test('simple replies have a concrete brevity target without overriding requested artifacts', () => {
  for (const prompt of [admissionsPrompt, ieltsPrompt]) {
    assert.ok(/simple repl(?:y|ies).{0,90}120 English words.{0,40}300 Chinese characters/is.test(prompt), 'simple replies need an explicit readable size target')
    assert.ok(/(?:requested|explicit).{0,50}(?:length|full draft|full revision)/is.test(prompt))
  }
})

test('IELTS prompt distinguishes coaching from requested mock practice', () => {
  assertAny(ieltsPrompt, [
    /default.{0,30}(?:to )?coaching/i,
    /coaching.{0,30}(?:is|as) the default/i,
  ], 'IELTS Speaking should default to coaching')
  assertAny(ieltsPrompt, [
    /(?:switch|enter|use).{0,40}mock.{0,50}(?:when|if).{0,40}(?:requested|asks|explicit)/is,
    /mock.{0,50}(?:only|when).{0,40}(?:requested|asks|explicit)/is,
  ], 'IELTS Speaking should switch to mock mode when requested')
  assertAny(ieltsPrompt, [
    /mock.{0,140}(?:defer|do not give|no).{0,60}(?:correction|feedback).{0,70}(?:requested|asked|ends?|finished)/is,
    /(?:correction|feedback).{0,60}(?:defer|withhold).{0,80}mock.{0,50}(?:ends?|requested|asked)/is,
  ], 'mock practice must defer correction until asked or the mock ends')
})

test('IELTS prompt allows only one information request and keeps fragments in context', () => {
  assertAny(ieltsPrompt, [
    /(?:one|single) (?:missing[- ]information )?request per turn/i,
    /per turn.{0,30}(?:one|single) (?:question|information request)/i,
  ], 'IELTS teacher needs a one-information-request-per-turn rule')
  assertAny(ieltsPrompt, [
    /(?:no|avoid|do not ask).{0,50}(?:compound|bundled|multi-part).{0,30}questions?/is,
    /(?:compound|bundled|multi-part).{0,30}questions?.{0,50}(?:forbidden|avoid|do not)/is,
  ], 'one request must not be disguised as a compound question')
  assertAny(ieltsPrompt, [
    /fragment.{0,120}(?:same|current).{0,50}(?:topic|Part)/is,
    /(?:same|current).{0,40}(?:topic|Part).{0,100}fragment/is,
  ], 'fragment clarification must retain the current topic and Speaking part')
})

test('IELTS mock handles off-topic replies without scoring or advancing', () => {
  assert.match(ieltsPrompt, /off-topic.{0,180}restate.{0,80}current question/is)
  assert.match(ieltsPrompt, /without (?:grading|scoring).{0,50}(?:advancing|moving on)/is)
})

test('IELTS clarification takes priority over coaching and never supplies an unasked model answer', () => {
  assert.ok(/fragment.{0,50}(?:overrides|takes precedence).{0,40}coaching/is.test(ieltsPrompt), 'unclear fragments must not enter the normal coaching lesson flow')
  assert.ok(/only one short clarification.{0,80}(?:stop|nothing else)/is.test(ieltsPrompt), 'clarification should be the whole response')
  assert.ok(/no example answer.{0,70}correction/is.test(ieltsPrompt), 'do not invent an object or answer for the learner')
})

test('IELTS prompt uses sufficient evidence without requiring an answer key', () => {
  assertAny(ieltsPrompt, [
    /(?:do not (?:require|demand)|without (?:requiring|needing)).{0,40}(?:an )?answer key/is,
    /answer key.{0,80}(?:not required|unnecessary|need not be supplied)/is,
  ], 'a passage and question can be sufficient without an answer key')
  assertAny(ieltsPrompt, [
    /(?:passage|transcript).{0,100}question.{0,120}(?:enough|sufficient|derive|solve)/is,
    /(?:derive|solve).{0,80}(?:from|using).{0,50}(?:supplied )?(?:passage|transcript).{0,80}question/is,
  ], 'IELTS teacher should derive an answer from sufficient supplied evidence')
  assert.match(ieltsPrompt, /False.{0,60}Not Given|Not Given.{0,60}False/is)
})

test('IELTS writing prompt defines a task-specific correction scaffold', () => {
  assert.match(ieltsPrompt, /high[- ]priority (?:change|issue|correction)/i)
  assert.match(ieltsPrompt, /correction.{0,60}reason|reason.{0,60}correction/is)
  assertAny(ieltsPrompt, [
    /(?:full|complete) revised (?:text|response|answer).{0,60}(?:when|if).{0,30}(?:requested|asked)/is,
    /(?:when|if).{0,30}(?:requested|asked).{0,60}(?:full|complete) revision/is,
  ], 'explicit revision requests should receive a full revised text')
  assertAny(ieltsPrompt, [
    /missing.{0,40}(?:prompt|chart|visual).{0,80}(?:limits?|bounds?|prevents?).{0,50}(?:score|estimate|scoring)/is,
    /(?:score|estimate|scoring).{0,50}(?:limited|not defensible).{0,80}missing.{0,30}(?:prompt|chart|visual)/is,
  ], 'missing task material should bound scoring rather than block partial correction')
})

test('IELTS correction reasons distinguish tense from number agreement', () => {
  assert.ok(/(?:separate|distinguish).{0,35}tense.{0,40}subject-verb agreement/is.test(ieltsPrompt), 'explain the rule that actually causes the correction')
  assert.ok(/regular past.{0,100}singular.{0,50}plural/is.test(ieltsPrompt), 'regular past forms must not be described as singular-only')
})

test('IELTS short grammar reasons may explain one cause but cannot invent causal links', () => {
  assert.ok(/short reason.{0,90}one (?:primary|accurate) (?:edit|cause)/is.test(ieltsPrompt), 'a short reason may explain just one real edit')
  assert.ok(/(?:false|invented) causality.{0,70}word limit|word limit.{0,70}(?:false|invented) causality/is.test(ieltsPrompt), 'brevity must not corrupt grammar causality')
})

test('IELTS prompt does not force follow-up questions after completed micro-tasks', () => {
  assertAny(ieltsPrompt, [
    /(?:short|completed|complete).{0,50}(?:task|request).{0,70}(?:no|without|do not).{0,50}(?:forced|follow-up|question)/is,
    /(?:do not|never).{0,40}(?:force|append|add).{0,40}(?:follow-up|question).{0,70}(?:short|completed|complete)/is,
  ], 'completed short grammar or editing tasks need no forced question')
  assertAny(ieltsPrompt, [
    /planning.{0,100}(?:immediate|today'?s|first).{0,40}(?:task|checkpoint|action)/is,
    /(?:immediate|today'?s|first).{0,40}(?:task|checkpoint|action).{0,80}planning/is,
  ], 'study planning must include an immediate task or checkpoint')
})

test('synthetic scenario catalog is balanced structured and safe for manual review', () => {
  assert.equal(catalog.schemaVersion, 'advisor-prompt-product-v1')
  assert.equal(catalog.syntheticOnly, true)
  assert.equal(catalog.cases.length, 10)
  assert.equal(catalog.holdoutCases.length, 1)
  assert.equal(catalog.holdoutCases[0].id, 'admissions-edit-qualifier-holdout')
  assert.equal(catalog.holdoutCases[0].userTurns.length, 2)

  const ids = new Set()
  const roleCounts = new Map()
  const tags = new Set()
  let multiTurnCases = 0
  const allMessages = []
  for (const scenario of catalog.cases) {
    assert.match(scenario.id, /^(admissions|ielts)-[a-z0-9-]+$/)
    assert.equal(ids.has(scenario.id), false, `duplicate scenario id: ${scenario.id}`)
    ids.add(scenario.id)
    assert.ok(['admissions-advisor', 'ielts-teacher'].includes(scenario.role), `${scenario.id} has an unsupported role`)
    roleCounts.set(scenario.role, (roleCounts.get(scenario.role) || 0) + 1)
    assert.equal(typeof scenario.summary, 'string')
    assert.ok(scenario.summary.length >= 20)
    assert.ok(Array.isArray(scenario.userTurns) && scenario.userTurns.length >= 1 && scenario.userTurns.length <= 4)
    if (scenario.userTurns.length > 1) multiTurnCases += 1
    for (const turn of scenario.userTurns) {
      assert.deepEqual(Object.keys(turn), ['message'])
      assert.equal(typeof turn.message, 'string')
      assert.ok(turn.message.length >= 10)
      allMessages.push(turn.message)
    }
    assert.ok(Array.isArray(scenario.must) && scenario.must.length >= 2, `${scenario.id} needs a useful must rubric`)
    assert.ok(Array.isArray(scenario.avoid) && scenario.avoid.length >= 2, `${scenario.id} needs a useful avoid rubric`)
    assert.ok(Array.isArray(scenario.tags) && scenario.tags.length >= 2)
    scenario.tags.forEach((tag) => tags.add(tag))
    assert.equal(Object.hasOwn(scenario, 'expectedResponse'), false, `${scenario.id} must not encode a brittle model answer`)
  }

  assert.deepEqual(Object.fromEntries(roleCounts), {
    'admissions-advisor': 5,
    'ielts-teacher': 5,
  })
  assert.ok(multiTurnCases >= 5, 'catalog needs substantial multi-turn coverage')
  for (const tag of [
    'context-correction',
    'direct-deliverable',
    'requirements-vs-optional',
    'writing-scaffold',
    'evidence-sufficient',
    'speaking-fragment',
    'speaking-mock',
    'grammar-no-followup',
    'malformed',
    'injection',
    'source-claim',
  ]) {
    assert.ok(tags.has(tag), `scenario catalog is missing ${tag}`)
  }

  const joinedMessages = allMessages.join('\n')
  assert.doesNotMatch(joinedMessages, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)
  assert.doesNotMatch(joinedMessages, /\b(?:Bearer\s+|sk-|AKIA)[A-Za-z0-9_./+=-]{8,}\b/)
  assert.doesNotMatch(joinedMessages, /\b\d{12,19}\b/, 'scenario messages must not contain account, card or long identity numbers')
})
