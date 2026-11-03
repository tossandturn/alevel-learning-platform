import assert from 'node:assert/strict'
import { TAVERN_STORIES, tavernStorySystemPrompt } from '../server/tavernStoryBible.js'
import { loadTavernMediaCatalog, selectTavernMediaCandidates } from '../server/tavernMedia.js'
import { tavernCharacterCard, tavernCharacterPrompt } from '../server/tavernPersonas.js'
import { resolveCoachFeature, buildTavernSystemPrompt, tavernPresetDescriptors } from '../server/coachFeatures.js'

const horror = TAVERN_STORIES['horror-guide']
const mystery = TAVERN_STORIES['mystery-guide']
assert.equal(horror.title, '雨窗茶室·00:17')
assert.deepEqual(horror.clues.map(item => item.id), ['bell', 'switch', 'logbook'])
assert.equal(horror.truth.id, 'the-last-signal')
assert.equal(horror.endings.length, 3)
assert.equal(mystery.title, '河岸档案室的第九张票')
assert.deepEqual(mystery.clues.map(item => item.id), ['reflection', 'dust', 'clock', 'stamp'])
assert.equal(mystery.truth.id, 'double-exposure-and-log-alteration')
assert.equal(mystery.revealAfterClues, 3)
assert.ok(horror.openingMediaId && mystery.openingMediaId)

for (const [persona, story] of Object.entries(TAVERN_STORIES)) {
  const prompt = tavernStorySystemPrompt(persona)
  assert.ok(prompt.includes(story.title))
  assert.match(prompt, /用户是玩家/)
  assert.match(prompt, /不能替用户写.*动作/)
  assert.match(prompt, /【旁白】/)
  assert.match(prompt, /【可选行动】/)
  assert.ok(prompt.length < 6500, `${persona}: bounded story canon`)
}

const mysteryCard = tavernCharacterCard('mystery-guide')
assert.ok(mysteryCard.biography.length > 40)
assert.ok(mysteryCard.storyArc.length > 80)
const xianxiaCard = tavernCharacterCard('xianxia-guide')
assert.ok(xianxiaCard.biography.includes('白汀渡'))
assert.ok(xianxiaCard.storyArc.includes('白汀渡'))
assert.match(tavernCharacterPrompt('xianxia-guide'), /人物经历与持续故事/)

const mysteryPrompt = buildTavernSystemPrompt(resolveCoachFeature({ feature: 'tavern', persona: 'mystery-guide' }))
assert.ok(mysteryPrompt.includes('河岸档案室的第九张票'))
assert.ok(mysteryPrompt.includes('【可选行动】'))
assert.ok(tavernPresetDescriptors().some(item => item.id === 'horror-guide'))
assert.throws(() => tavernStorySystemPrompt('not-a-persona'), /Unknown Tavern story/)

const catalog = loadTavernMediaCatalog()
for (const [persona, message, mediaId] of [
  ['story-traveler', '进入无名信与银翼鸟', 'image-floating-story-city'],
  ['xianxia-guide', '进入白汀渡的旧灯', 'image-bamboo-courtyard'],
  ['horror-guide', '进入《雨窗茶室·00:17》', 'image-rainy-tea-window'],
  ['mystery-guide', '进入《河岸档案室的第九张票》', 'image-city-night-walk'],
]) {
  const chosen = selectTavernMediaCandidates(catalog, { persona, message })
  assert.ok(chosen.some(item => item.id === mediaId), `${persona} opening scene must offer its matching original mood illustration`)
}
console.log('Tavern story bibles: immutable plots, clue order, player agency, character lives and original scene-art mapping PASS')
