import assert from 'node:assert/strict'
import { buildTavernSystemPrompt, resolveCoachFeature, tavernPresetDescriptors } from '../server/coachFeatures.js'
import { TAVERN_CHARACTER_VERSION, tavernCharacterCard, tavernCharacterPrompt } from '../server/tavernPersonas.js'
import { TAVERN_PRESENTATION } from '../server/tavernPresentation.js'

const expected = ['keeper', 'study-buddy', 'cat-companion', 'story-traveler', 'xianxia-guide', 'mystery-guide', 'eastern-oracle', 'tarot-reader']
assert.equal(TAVERN_CHARACTER_VERSION, 'tavern-characters.v2')
const names = new Set()
for (const id of expected) {
  const card = tavernCharacterCard(id)
  assert.ok(Object.isFrozen(card))
  for (const field of ['name', 'identity', 'personality', 'preferences', 'voice', 'scenario']) assert.ok(card[field]?.length > 1, `${id}: ${field}`)
  assert.ok(Object.isFrozen(card.examples))
  assert.ok(card.examples.length >= 3)
  assert.ok(card.examples.every(example => Object.isFrozen(example) && example.user && example.reply))
  names.add(card.name)
  assert.ok(TAVERN_PRESENTATION[id].name.startsWith(card.name))
  if (['eastern-oracle', 'tarot-reader'].includes(id)) assert.ok(TAVERN_PRESENTATION[id].starters.every(text => !/刚才|刚抽|那张|那一卦/.test(text)), 'empty-history starters must not assume a prior draw')
  const prompt = buildTavernSystemPrompt(resolveCoachFeature({ feature: 'tavern', persona: id }))
  assert.ok(prompt.includes(card.name) && prompt.includes(card.preferences))
  assert.ok(prompt.includes(tavernCharacterPrompt(id)))
  assert.match(prompt, /示例不是聊天历史/)
  assert.match(prompt, /不必每轮提问/)
  assert.match(prompt, /最新.*纠正/)
  assert.match(prompt, /不把.*示例.*当成.*用户/)
  assert.match(prompt, /不默认.*学生/)
  assert.match(prompt, /旧回复.*不.*模仿/)
  assert.match(prompt, /AI.*虚构/)
  assert.doesNotMatch(prompt, /Ask exactly one observation|Use conditional Chinese phrasing such as/)
  assert.ok(prompt.length < 9500, `${id}: bounded character context`)
  assert.ok(!JSON.stringify(tavernPresetDescriptors()).includes(card.examples[0].reply), 'private examples are not a public descriptor field')
}
assert.equal(names.size, expected.length)
for (const invalid of ['toString', '__proto__', 'not-a-role', null, {}]) {
  assert.equal(tavernCharacterCard(invalid), null)
  assert.throws(() => tavernCharacterPrompt(invalid), /Unknown Tavern character/)
}
console.log('PASS_TAVERN_CHARACTER_CARDS eight original cards, style examples, continuity, optional questions, bounded prompts')
