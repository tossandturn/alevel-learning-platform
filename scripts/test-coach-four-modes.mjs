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
  ['eastern-oracle', '东方玄学'],
  ['tarot-reader', '西方塔罗'],
]
const presetDescriptors = tavernPresetDescriptors()
const presetDescriptorById = new Map(presetDescriptors.map((preset) => [preset.id, preset]))
assert.ok(Object.isFrozen(presetDescriptors))
assert.deepEqual(presetDescriptors.map(({ id, title }) => [id, title]), expectedTavernPresets)
for (const preset of presetDescriptors) {
  assert.ok(Object.isFrozen(preset))
  assert.ok(Object.isFrozen(preset.starters))
  const descriptorKeys = ['genreTag', 'greeting', 'id', 'starters', 'tagline', 'title']
  if (['eastern-oracle', 'tarot-reader'].includes(preset.id)) descriptorKeys.push('divinationKind', 'supportedSpreads')
  assert.deepEqual(Object.keys(preset).sort(), descriptorKeys.sort())
  if (preset.supportedSpreads) assert.ok(Object.isFrozen(preset.supportedSpreads))
  assert.ok(preset.tagline.length > 0)
  assert.ok(preset.genreTag.length > 0)
  assert.ok(preset.greeting.length > 0)
  assert.equal(preset.starters.length, 3)
  assert.ok(preset.starters.every((starter) => typeof starter === 'string' && starter.length > 0))
  assert.doesNotMatch(JSON.stringify(preset), /direction|systemPrompt|internal prompt|provider routing/i)
}
assert.equal(new Set(presetDescriptors.map(({ tagline }) => tagline)).size, 8)
assert.equal(new Set(presetDescriptors.map(({ greeting }) => greeting)).size, 8)
assert.equal(new Set(presetDescriptors.map(({ starters }) => starters.join('\n'))).size, 8)
assert.deepEqual(presetDescriptors.slice(0, 6), [
  { id: 'keeper', title: '温柔树洞', tagline: '先接住你的心情，再慢慢聊。', genreTag: '倾听陪伴', greeting: '今晚的树洞给你留着。想讲点什么，或者只想有人陪你待一会儿？', starters: ['今天有件事想说说', '陪我安静聊一会儿', '给我一个轻松的小问题'] },
  { id: 'study-buddy', title: '嘴替损友', tagline: '嘴上吐槽，立场永远在你这边。', genreTag: '轻松吐槽', greeting: '来了？先把今天最想吐槽的一件事放桌上，我保证只损事情，不损你。', starters: ['替我吐槽一下今天', '来个不伤人的损友点评', '陪我聊点没用但好玩的'] },
  { id: 'cat-companion', title: '傲娇猫猫', tagline: '假装不在意，其实一直在听。', genreTag: '猫系陪伴', greeting: '我只是刚好路过，才不是在等你。说吧，今天要聊天、接话，还是听一句别扭的夸奖？', starters: ['猫猫今天在忙什么', '陪我玩三轮接话', '傲娇地夸我一句'] },
  { id: 'story-traveler', title: '奇幻冒险', tagline: '一句选择，就能走进另一个世界。', genreTag: '互动奇幻', greeting: '旅馆窗外，一封会发光的无名信正等人拆开。你想直接读信，还是先问问送信的银翼鸟？', starters: ['带我走进一座浮空城', '给我两个冒险选择', '继续一段雨夜旅程'] },
  { id: 'xianxia-guide', title: '江湖剑客', tagline: '一盏热茶，一段属于你的江湖路。', genreTag: '江湖奇遇', greeting: '客官，夜雨封山，前方古镇却亮着一盏无人看守的灯。是进镇避雨，还是沿河道继续赶路？', starters: ['陪我夜探一座古镇', '来一段江湖偶遇', '给我三个行路选择'] },
  { id: 'mystery-guide', title: '侦探茶室', tagline: '线索都在桌上，真相等你开口。', genreTag: '轻推理', greeting: '茶室打烊后，柜台上的蓝色信封不翼而飞：地板是干的，窗户开着，茶壶却还很烫。你想先查哪条线索？', starters: ['出一道三条线索的小案', '让我询问一位虚构嫌疑人', '继续刚才的谜案'] },
])
assert.deepEqual(presetDescriptors.slice(6), [
  { id: 'eastern-oracle', title: '东方玄学', tagline: '随机起一卦，换个角度看当下。', genreTag: '东方卦签', greeting: '这里的卦签只作休闲启发，不替你决定人生。想带着一个轻问题抽一卦，还是直接看看今天的随机提示？', starters: ['为我随机抽一卦', '用卦签换个角度想想', '解释我刚抽到的卦'], divinationKind: 'hexagram', supportedSpreads: ['single'] },
  { id: 'tarot-reader', title: '西方塔罗', tagline: '抽一张牌，把问题换个角度摆上桌。', genreTag: '塔罗娱乐', greeting: '牌面只是休闲联想的镜子，不是预言。你想抽单张提示，还是三张看看过去主题、当下主题和可能的方向？', starters: ['抽一张当下提示', '抽三张主题牌', '解读我刚抽到的牌'], divinationKind: 'tarot', supportedSpreads: ['single', 'three'] },
])

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
assert.equal(new Set(personaPrompts.values()).size, 8, 'each tavern persona must have a distinct server-owned prompt')
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
assert.match(personaPrompts.get('eastern-oracle'), /entertainment|reflective/i)
assert.match(personaPrompts.get('eastern-oracle'), /birth chart|生辰|fatality|medical|financial|legal/i)
assert.match(personaPrompts.get('tarot-reader'), /entertainment|reflective/i)
assert.match(personaPrompts.get('tarot-reader'), /guaranteed future|fatality|medical|financial|legal/i)
for (const persona of ['eastern-oracle', 'tarot-reader']) {
  const prompt = personaPrompts.get(persona)
  assert.match(prompt, /reflection question or metaphor/i)
  assert.match(prompt, /never.*proof.*actual past.*current mood.*personality.*another person's intent.*future/i)
  assert.match(prompt, /如果……，可以想想……/)
  assert.match(prompt, /你其实…….*你曾经……/)
  assert.match(prompt, /start directly.*without.*welcom.*static opening/i)
}
assert.equal(resolveCoachFeature({ feature: 'tavern' }).persona, 'keeper')
assert.deepEqual(resolveCoachFeature({ feature: 'tavern', persona: 'eastern-oracle' }).supportedSpreads, ['single'])
assert.equal(resolveCoachFeature({ feature: 'tavern', persona: 'eastern-oracle' }).divinationKind, 'hexagram')
assert.deepEqual(resolveCoachFeature({ feature: 'tavern', persona: 'tarot-reader' }).supportedSpreads, ['single', 'three'])
assert.equal(resolveCoachFeature({ feature: 'tavern', persona: 'tarot-reader' }).divinationKind, 'tarot')

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
for (const persona of expectedTavernPresets.slice(0, 6).map(([id]) => id)) {
  assert.throws(
    () => validateCoachFeaturePayload(resolveCoachFeature({ feature: 'tavern', persona }), { drawId: '00000000-0000-4000-8000-000000000001' }),
    (error) => error?.code === 'coach_tavern_draw_not_allowed',
  )
}
for (const persona of ['eastern-oracle', 'tarot-reader']) {
  const divination = resolveCoachFeature({ feature: 'tavern', persona })
  assert.doesNotThrow(() => validateCoachFeaturePayload(divination, { drawId: '00000000-0000-4000-8000-000000000001' }))
  for (const payload of [
    { drawId: ['not-scalar'] },
    { cards: [{ name: 'client card' }] },
    { draw: { cards: [] } },
    { drawNonce: 'client-nonce' },
    { spread: 'single' },
  ]) {
    assert.throws(() => validateCoachFeaturePayload(divination, payload), (error) => /^coach_tavern_draw_/.test(error?.code || ''))
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
