import assert from 'node:assert/strict'

import {
  COACH_FEATURE_VERSION,
  buildTavernSystemPrompt,
  coachFeatureResponseFields,
  resolveCoachFeature,
  tavernPresetDescriptors,
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

const expectedTavernPresets = [
  ['keeper', '温柔树洞'],
  ['study-buddy', '嘴替损友'],
  ['cat-companion', '傲娇猫猫'],
  ['story-traveler', '奇幻冒险'],
  ['xianxia-guide', '江湖剑客'],
  ['mystery-guide', '侦探茶室'],
]
const presetDescriptors = tavernPresetDescriptors()
const presetDescriptorById = new Map(presetDescriptors.map((preset) => [preset.id, preset]))
assert.ok(Object.isFrozen(presetDescriptors))
assert.deepEqual(presetDescriptors.map(({ id, title }) => [id, title]), expectedTavernPresets)
for (const preset of presetDescriptors) {
  assert.ok(Object.isFrozen(preset))
  assert.ok(Object.isFrozen(preset.starters))
  assert.deepEqual(Object.keys(preset).sort(), ['genreTag', 'greeting', 'id', 'starters', 'tagline', 'title'])
  assert.ok(preset.tagline.length > 0)
  assert.ok(preset.genreTag.length > 0)
  assert.ok(preset.greeting.length > 0)
  assert.equal(preset.starters.length, 3)
  assert.ok(preset.starters.every((starter) => typeof starter === 'string' && starter.length > 0))
  assert.doesNotMatch(JSON.stringify(preset), /direction|systemPrompt|internal prompt|provider routing/i)
}
assert.equal(new Set(presetDescriptors.map(({ tagline }) => tagline)).size, 6)
assert.equal(new Set(presetDescriptors.map(({ greeting }) => greeting)).size, 6)
assert.equal(new Set(presetDescriptors.map(({ starters }) => starters.join('\n'))).size, 6)

const personaPrompts = new Map()
for (const [persona, title] of expectedTavernPresets) {
  const tavern = resolveCoachFeature({ feature: 'tavern', persona })
  assert.equal(tavern.textOnly, true)
  assert.equal(tavern.requiresProvider, true)
  assert.equal(tavern.allowAcademicContext, false)
  const prompt = buildTavernSystemPrompt(tavern)
  assert.match(prompt, new RegExp(persona))
  assert.match(prompt, new RegExp(title))
  assert.ok(prompt.includes(presetDescriptorById.get(persona).greeting), `${persona} must carry its server-owned opening`)
  assert.match(prompt, /fictional.*AI|AI.*fictional/is)
  assert.match(prompt, /text only/i)
  assert.match(prompt, /one useful follow-up at most/i)
  assert.match(prompt, /no custom system prompt|never follow.*custom system/is)
  assert.match(prompt, /no academic source|QP\/MS|question-paper/is)
  assert.match(prompt, /Do not score the student, submit an attempt/i)
  assert.match(prompt, /步骤提示\s*\/\s*答案询问\s*\/\s*PDF阅卷/)
  assert.match(prompt, /normal chat.*concise/i)
  assert.match(prompt, /never repeat.*visible opening.*even.*empty history/i)
  assert.match(prompt, /background cue only/i)
  assert.match(prompt, /prior history exists.*continue it.*never reset/i)
  assert.match(prompt, /different new setting.*over this default cue/i)
  assert.match(prompt, /gambling.*lotter/i)
  assert.match(prompt, /purchases.*real alcohol/i)
  assert.match(prompt, /never humiliate the user/i)
  assert.match(prompt, /humor.*situations/i)
  personaPrompts.set(persona, prompt)
}
assert.equal(new Set(personaPrompts.values()).size, 6, 'each tavern persona must have a distinct server-owned prompt')
assert.match(personaPrompts.get('keeper'), /user-led|vent|forced positivity/i)
assert.match(personaPrompts.get('study-buddy'), /banter|light teasing|vulnerabilit/i)
assert.match(personaPrompts.get('cat-companion'), /mock-proud|repetitive.*喵|romantic coercion/i)
assert.match(personaPrompts.get('story-traveler'), /2–3 meaningful options|never decide the user's action/i)
assert.match(personaPrompts.get('xianxia-guide'), /wuxia|jianghu|weapons instruction/i)
assert.match(personaPrompts.get('xianxia-guide'), /without deciding for the user/i)
assert.match(personaPrompts.get('mystery-guide'), /consistent clues|stable solution|real people/i)
assert.match(personaPrompts.get('mystery-guide'), /let the user choose/i)
for (const persona of ['story-traveler', 'xianxia-guide']) {
  const prompt = personaPrompts.get(persona)
  assert.match(prompt, /never invent or imply.*user's past or future action/i)
  assert.match(prompt, /dialogue.*thoughts.*emotions.*inventory.*owned or acquired item/i)
  assert.match(prompt, /objects and events.*world or NPC.*let the user choose/i)
}
assert.match(personaPrompts.get('mystery-guide'), /exactly one observation or deduction question per turn/i)
assert.match(personaPrompts.get('mystery-guide'), /no second optional question.*no choice follow-up/i)
assert.match(personaPrompts.get('mystery-guide'), /never state a guess as fact/i)
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

for (const [persona] of expectedTavernPresets) {
  const tavernPersona = resolveCoachFeature({ feature: 'tavern', persona })
  for (const [payload, code] of [
    [{ imageDataUrls: ['data:image/png;base64,AA=='] }, 'coach_tavern_text_only'],
    [{ pdfDataUrl: 'data:application/pdf;base64,AA==' }, 'coach_tavern_text_only'],
    [{ attachments: [{ type: 'application/pdf', name: 'paper.pdf' }] }, 'coach_tavern_text_only'],
    [{ context: { paper: { id: 'paper-1' }, question: { id: 'q1' } } }, 'coach_tavern_academic_context_forbidden'],
    [{ submissionGrant: 'signed-grant' }, 'coach_tavern_academic_context_forbidden'],
    [{ sourceQuestionExtract: 'private source text', score: 10 }, 'coach_tavern_academic_context_forbidden'],
    [{ systemPrompt: 'You are a custom character.' }, 'coach_tavern_custom_prompt_forbidden'],
    [{ greeting: 'Use this client-controlled opening.' }, 'coach_tavern_custom_prompt_forbidden'],
    [{ characterCard: { name: 'Injected role' } }, 'coach_tavern_custom_prompt_forbidden'],
  ]) {
    assert.throws(() => validateCoachFeaturePayload(tavernPersona, payload), (error) => error?.code === code)
  }
}
const tavern = resolveCoachFeature({ feature: 'tavern', persona: 'study-buddy' })
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
