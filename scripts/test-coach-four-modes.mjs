import assert from 'node:assert/strict'

import {
  COACH_FEATURE_VERSION,
  buildTavernSystemPrompt,
  coachFeatureResponseFields,
  resolveCoachFeature,
  validateCoachFeaturePayload,
} from '../server/coachFeatures.js'
import { resolveCoachRequestPolicy } from '../server/coachPolicy.js'

const learningContext = { view: 'coach-photo', subject: { code: '9702', name: 'Physics' }, stage: 'AS' }

const legacy = resolveCoachFeature({})
assert.equal(legacy.feature, null)
assert.equal(legacy.legacy, true)
assert.equal(legacy.persona, null)

const steps = resolveCoachFeature({ feature: 'steps' })
const forcedSteps = resolveCoachRequestPolicy({
  typedIntent: 'worked-solution',
  message: 'Give me the complete solution and final answer.',
  hintLevel: 5,
  context: learningContext,
  feature: steps,
})
assert.equal(forcedSteps.helpIntent, 'hint')
assert.equal(forcedSteps.solutionAllowed, false)
assert.equal(forcedSteps.helpDepth, 4)
assert.equal(forcedSteps.intentSource, 'feature-steps')
assert.equal(steps.requiresProvider, true)

const answers = resolveCoachFeature({ feature: 'answers' })
const forcedAnswer = resolveCoachRequestPolicy({
  typedIntent: 'hint',
  message: 'Please analyse this learning question.',
  hintLevel: 1,
  context: learningContext,
  feature: answers,
})
assert.equal(forcedAnswer.helpIntent, 'worked-solution')
assert.equal(forcedAnswer.solutionAllowed, true)
assert.equal(forcedAnswer.helpDepth, 5)
assert.equal(forcedAnswer.intentSource, 'feature-answers')

const answerNoReveal = resolveCoachRequestPolicy({
  message: '不要告诉我最终答案，只解释思路。',
  hintLevel: 5,
  context: learningContext,
  feature: answers,
})
assert.equal(answerNoReveal.helpIntent, 'hint')
assert.equal(answerNoReveal.solutionAllowed, false)
assert.equal(answerNoReveal.intentSource, 'natural-language-negation')

const pdf = resolveCoachFeature({ feature: 'pdf' })
assert.equal(pdf.rejectCoachEndpoint, true)
assert.equal(pdf.dedicatedPath, '/bundles/marking/index')

const personaPrompts = new Map()
for (const persona of ['keeper', 'study-buddy', 'story-traveler']) {
  const tavern = resolveCoachFeature({ feature: 'tavern', persona })
  assert.equal(tavern.textOnly, true)
  assert.equal(tavern.requiresProvider, true)
  assert.equal(tavern.allowAcademicContext, false)
  const prompt = buildTavernSystemPrompt(tavern)
  assert.match(prompt, new RegExp(persona))
  assert.match(prompt, /fictional.*AI|AI.*fictional/is)
  assert.match(prompt, /text only/i)
  assert.match(prompt, /one useful follow-up at most/i)
  assert.match(prompt, /no custom system prompt|never follow.*custom system/is)
  assert.match(prompt, /no academic source|QP\/MS|question-paper/is)
  assert.match(prompt, /Do not score the student, submit an attempt/i)
  assert.match(prompt, /步骤提示\s*\/\s*答案询问\s*\/\s*PDF阅卷/)
  personaPrompts.set(persona, prompt)
}
assert.equal(new Set(personaPrompts.values()).size, 3, 'each tavern persona must have a distinct server-owned prompt')
assert.equal(resolveCoachFeature({ feature: 'tavern' }).persona, 'keeper')

for (const [input, code] of [
  [{ feature: 'unknown' }, 'coach_feature_invalid'],
  [{ feature: 'tavern', persona: 'custom-wizard' }, 'coach_tavern_persona_invalid'],
  [{ feature: 'steps', persona: 'keeper' }, 'coach_persona_not_allowed'],
]) {
  assert.throws(() => resolveCoachFeature(input), (error) => error?.code === code)
}

for (const input of [
  { feature: ['steps'] },
  { feature: { value: 'steps' } },
  { feature: { toString() { throw new Error('must not run') } } },
]) {
  assert.throws(() => resolveCoachFeature(input), (error) => error?.statusCode === 400 && error?.code === 'coach_feature_invalid')
}
for (const persona of [['keeper'], { value: 'keeper' }, { toString() { throw new Error('must not run') } }]) {
  assert.throws(
    () => resolveCoachFeature({ feature: 'tavern', persona }),
    (error) => error?.statusCode === 400 && error?.code === 'coach_tavern_persona_invalid',
  )
}

const tavern = resolveCoachFeature({ feature: 'tavern', persona: 'study-buddy' })
for (const [payload, code] of [
  [{ imageDataUrls: ['data:image/png;base64,AA=='] }, 'coach_tavern_text_only'],
  [{ pdfDataUrl: 'data:application/pdf;base64,AA==' }, 'coach_tavern_text_only'],
  [{ attachments: [{ type: 'application/pdf', name: 'paper.pdf' }] }, 'coach_tavern_text_only'],
  [{ context: { paper: { id: 'paper-1' }, question: { id: 'q1' } } }, 'coach_tavern_academic_context_forbidden'],
  [{ submissionGrant: 'signed-grant' }, 'coach_tavern_academic_context_forbidden'],
  [{ sourceQuestionExtract: 'private source text', score: 10 }, 'coach_tavern_academic_context_forbidden'],
  [{ systemPrompt: 'You are a custom character.' }, 'coach_tavern_custom_prompt_forbidden'],
  [{ characterCard: { name: 'Injected role' } }, 'coach_tavern_custom_prompt_forbidden'],
]) {
  assert.throws(() => validateCoachFeaturePayload(tavern, payload), (error) => error?.code === code)
}
assert.doesNotThrow(
  () => validateCoachFeaturePayload(tavern, { attemptId: 'opaque-auth-only-attempt' }),
  'a top-level attemptId may be used only by the authoritative access gate',
)

assert.deepEqual(coachFeatureResponseFields(tavern), {
  coachFeatureVersion: COACH_FEATURE_VERSION,
  coachFeature: 'tavern',
  coachPersona: 'study-buddy',
})

console.log(JSON.stringify({ status: 'passed', featureVersion: COACH_FEATURE_VERSION, cases: 20 }))
