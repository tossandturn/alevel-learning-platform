import assert from 'node:assert/strict'

import {
  createTavernDivinationStore,
  HEXAGRAM_DECK,
  TAROT_DECK,
  TAVERN_DIVINATION_CONFIG,
  tavernDrawSystemPrompt,
} from '../server/tavernDivination.js'

assert.equal(HEXAGRAM_DECK.length, 64)
assert.equal(new Set(HEXAGRAM_DECK.map(({ id }) => id)).size, 64)
assert.equal(new Set(HEXAGRAM_DECK.map(({ name }) => name)).size, 64)
assert.deepEqual(HEXAGRAM_DECK.slice(0, 3), [
  { id: 'hexagram-01', name: '乾' },
  { id: 'hexagram-02', name: '坤' },
  { id: 'hexagram-03', name: '屯' },
])
assert.deepEqual(HEXAGRAM_DECK.slice(-2), [
  { id: 'hexagram-63', name: '既济' },
  { id: 'hexagram-64', name: '未济' },
])

assert.equal(TAROT_DECK.length, 78)
assert.equal(new Set(TAROT_DECK.map(({ id }) => id)).size, 78)
assert.equal(new Set(TAROT_DECK.map(({ name }) => name)).size, 78)
assert.deepEqual(TAROT_DECK.slice(0, 3), [
  { id: 'tarot-major-00-fool', name: '愚者 · The Fool' },
  { id: 'tarot-major-01-magician', name: '魔术师 · The Magician' },
  { id: 'tarot-major-02-high-priestess', name: '女祭司 · The High Priestess' },
])
assert.deepEqual(TAROT_DECK.slice(-2), [
  { id: 'tarot-pentacles-queen', name: '星币王后 · Queen of Pentacles' },
  { id: 'tarot-pentacles-king', name: '星币国王 · King of Pentacles' },
])
assert.deepEqual(TAROT_DECK.find(({ id }) => id === 'tarot-cups-knight'), {
  id: 'tarot-cups-knight',
  name: '圣杯骑士 · Knight of Cups',
})
assert.ok(TAROT_DECK.every(({ name }) => /^[^A-Za-z]+ · [A-Za-z]/.test(name)))

assert.deepEqual(TAVERN_DIVINATION_CONFIG, {
  'eastern-oracle': {
    kind: 'hexagram',
    deckVersion: 'zhouyi-64-v1',
    supportedSpreads: ['single'],
  },
  'tarot-reader': {
    kind: 'tarot',
    deckVersion: 'rws-text-78-v1',
    supportedSpreads: ['single', 'three'],
  },
})

let now = Date.parse('2026-10-06T08:00:00.000Z')
let uuidCounter = 0
let randomCalls = 0
const store = createTavernDivinationStore({
  now: () => now,
  randomUUID: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`,
  randomInt: (max) => {
    randomCalls += 1
    assert.ok(max > 0)
    return 0
  },
  ttlMs: 30 * 60 * 1000,
  maxEntries: 2,
})

const eastern = store.createDraw({
  ownerId: 'ielts:101',
  persona: 'eastern-oracle',
  spread: 'single',
  nonce: 'eastern-nonce-0001',
})
assert.deepEqual(eastern.cards, [{ id: 'hexagram-01', name: '乾', position: '本次提示' }])
assert.equal(eastern.kind, 'hexagram')
assert.equal(eastern.deckVersion, 'zhouyi-64-v1')
assert.equal(eastern.entertainmentOnly, true)
assert.equal(eastern.createdAt, '2026-10-06T08:00:00.000Z')
assert.equal(eastern.expiresAt, '2026-10-06T08:30:00.000Z')
assert.ok(Object.isFrozen(eastern))
assert.ok(Object.isFrozen(eastern.cards))
const callsAfterEastern = randomCalls
assert.strictEqual(store.createDraw({
  ownerId: 'ielts:101',
  persona: 'eastern-oracle',
  spread: 'single',
  nonce: 'eastern-nonce-0001',
}), eastern)
assert.equal(randomCalls, callsAfterEastern, 'nonce retry must not redraw')

assert.throws(() => store.createDraw({
  ownerId: 'ielts:101',
  persona: 'tarot-reader',
  spread: 'single',
  nonce: 'eastern-nonce-0001',
}), (error) => error?.statusCode === 409 && error?.code === 'coach_tavern_draw_nonce_conflict')

const tarot = store.createDraw({
  ownerId: 'ielts:101',
  persona: 'tarot-reader',
  spread: 'three',
  nonce: 'tarot-nonce-000001',
})
assert.deepEqual(tarot.cards, [
  { id: 'tarot-major-00-fool', name: '愚者 · The Fool', position: '过去主题', orientation: 'upright' },
  { id: 'tarot-major-01-magician', name: '魔术师 · The Magician', position: '当下主题', orientation: 'upright' },
  { id: 'tarot-major-02-high-priestess', name: '女祭司 · The High Priestess', position: '可能的方向', orientation: 'upright' },
])
assert.equal(new Set(tarot.cards.map(({ id }) => id)).size, 3, 'three-card spread must draw without replacement')
assert.strictEqual(store.resolveDraw({ ownerId: 'ielts:101', persona: 'tarot-reader', drawId: tarot.id }), tarot)
assert.throws(
  () => store.resolveDraw({ ownerId: 'ielts:999', persona: 'tarot-reader', drawId: tarot.id }),
  (error) => error?.statusCode === 404 && error?.code === 'coach_tavern_draw_not_found' && error?.action === 'draw_required',
)
assert.throws(
  () => store.resolveDraw({ ownerId: 'ielts:101', persona: 'eastern-oracle', drawId: tarot.id }),
  (error) => error?.statusCode === 409 && error?.code === 'coach_tavern_draw_binding_mismatch',
)

const drawPrompt = tavernDrawSystemPrompt(tarot)
for (const card of tarot.cards) {
  assert.match(drawPrompt, new RegExp(card.name))
  assert.match(drawPrompt, new RegExp(card.position))
  assert.match(drawPrompt, new RegExp(card.orientation))
}
assert.match(drawPrompt, /server-generated entertainment draw/i)
assert.match(drawPrompt, /interpret exactly these cards/i)
assert.match(drawPrompt, /reflection question or metaphor/i)
assert.match(drawPrompt, /never.*proof.*actual past.*current mood.*personality.*another person's intent.*future/i)
assert.match(drawPrompt, /如果……，可以想想……/)
assert.match(drawPrompt, /你其实…….*你曾经……/)
assert.match(drawPrompt, /start directly.*without.*welcom.*static opening/i)
assert.doesNotMatch(drawPrompt, new RegExp(tarot.id))
assert.doesNotMatch(drawPrompt, /owner|nonce|token|attempt/i)

const evicted = eastern
store.createDraw({
  ownerId: 'ielts:101',
  persona: 'eastern-oracle',
  spread: 'single',
  nonce: 'eastern-nonce-0002',
})
assert.throws(
  () => store.resolveDraw({ ownerId: 'ielts:101', persona: 'eastern-oracle', drawId: evicted.id }),
  (error) => error?.statusCode === 404 && error?.code === 'coach_tavern_draw_not_found',
)
const callsBeforeEvictedNonce = randomCalls
assert.throws(
  () => store.createDraw({ ownerId: 'ielts:101', persona: 'eastern-oracle', spread: 'single', nonce: 'eastern-nonce-0001' }),
  (error) => error?.statusCode === 409 && error?.code === 'coach_tavern_draw_unavailable',
)
assert.equal(randomCalls, callsBeforeEvictedNonce, 'evicted nonce must fail closed instead of redrawing')

const expiring = store.createDraw({
  ownerId: 'ielts:101',
  persona: 'eastern-oracle',
  spread: 'single',
  nonce: 'eastern-nonce-0003',
})
now += 31 * 60 * 1000
assert.throws(
  () => store.resolveDraw({ ownerId: 'ielts:101', persona: 'eastern-oracle', drawId: expiring.id }),
  (error) => error?.statusCode === 409 && error?.code === 'coach_tavern_draw_expired',
)
const callsBeforeExpiredNonce = randomCalls
assert.throws(
  () => store.createDraw({ ownerId: 'ielts:101', persona: 'eastern-oracle', spread: 'single', nonce: 'eastern-nonce-0003' }),
  (error) => error?.statusCode === 409 && error?.code === 'coach_tavern_draw_expired',
)
assert.equal(randomCalls, callsBeforeExpiredNonce, 'expired nonce must require an explicit new nonce instead of redrawing')

const spreadBound = store.createDraw({
  ownerId: 'ielts:101',
  persona: 'tarot-reader',
  spread: 'single',
  nonce: 'tarot-spread-nonce-1',
})
assert.equal(spreadBound.spread, 'single')
const callsBeforeSpreadConflict = randomCalls
assert.throws(
  () => store.createDraw({ ownerId: 'ielts:101', persona: 'tarot-reader', spread: 'three', nonce: 'tarot-spread-nonce-1' }),
  (error) => error?.statusCode === 409 && error?.code === 'coach_tavern_draw_nonce_conflict',
)
assert.equal(randomCalls, callsBeforeSpreadConflict, 'nonce spread conflict must not redraw')

for (const input of [
  { ownerId: 'ielts:101', persona: 'eastern-oracle', spread: 'three', nonce: 'invalid-spread-01' },
  { ownerId: 'ielts:101', persona: 'tarot-reader', spread: 'five', nonce: 'invalid-spread-02' },
  { ownerId: 'ielts:101', persona: 'tarot-reader', spread: 'single', nonce: ['not-scalar'] },
  { ownerId: 'ielts:101', persona: 'custom-reader', spread: 'single', nonce: 'invalid-persona-1' },
]) {
  assert.throws(() => store.createDraw(input), (error) => error?.statusCode === 400)
}

console.log(JSON.stringify({ status: 'passed', hexagrams: HEXAGRAM_DECK.length, tarotCards: TAROT_DECK.length }))
