import crypto from 'node:crypto'

export const TAVERN_DIVINATION_TTL_MS = 30 * 60 * 1000
export const TAVERN_DIVINATION_MAX_RECEIPTS = 500

const HEXAGRAM_NAMES = [
  '乾', '坤', '屯', '蒙', '需', '讼', '师', '比', '小畜', '履', '泰', '否', '同人', '大有', '谦', '豫',
  '随', '蛊', '临', '观', '噬嗑', '贲', '剥', '复', '无妄', '大畜', '颐', '大过', '坎', '离', '咸', '恒',
  '遁', '大壮', '晋', '明夷', '家人', '睽', '蹇', '解', '损', '益', '夬', '姤', '萃', '升', '困', '井',
  '革', '鼎', '震', '艮', '渐', '归妹', '丰', '旅', '巽', '兑', '涣', '节', '中孚', '小过', '既济', '未济',
]

export const HEXAGRAM_DECK = Object.freeze(HEXAGRAM_NAMES.map((name, index) => Object.freeze({
  id: `hexagram-${String(index + 1).padStart(2, '0')}`,
  name,
})))

const TAROT_MAJORS = [
  ['00-fool', '愚者', 'The Fool'],
  ['01-magician', '魔术师', 'The Magician'],
  ['02-high-priestess', '女祭司', 'The High Priestess'],
  ['03-empress', '女皇', 'The Empress'],
  ['04-emperor', '皇帝', 'The Emperor'],
  ['05-hierophant', '教皇', 'The Hierophant'],
  ['06-lovers', '恋人', 'The Lovers'],
  ['07-chariot', '战车', 'The Chariot'],
  ['08-strength', '力量', 'Strength'],
  ['09-hermit', '隐者', 'The Hermit'],
  ['10-wheel-of-fortune', '命运之轮', 'Wheel of Fortune'],
  ['11-justice', '正义', 'Justice'],
  ['12-hanged-man', '倒吊人', 'The Hanged Man'],
  ['13-death', '死神', 'Death'],
  ['14-temperance', '节制', 'Temperance'],
  ['15-devil', '恶魔', 'The Devil'],
  ['16-tower', '高塔', 'The Tower'],
  ['17-star', '星星', 'The Star'],
  ['18-moon', '月亮', 'The Moon'],
  ['19-sun', '太阳', 'The Sun'],
  ['20-judgement', '审判', 'Judgement'],
  ['21-world', '世界', 'The World'],
]
const TAROT_SUITS = [
  ['wands', '权杖', 'Wands'],
  ['cups', '圣杯', 'Cups'],
  ['swords', '宝剑', 'Swords'],
  ['pentacles', '星币', 'Pentacles'],
]
const TAROT_RANKS = [
  ['ace', '王牌', 'Ace'], ['two', '二', 'Two'], ['three', '三', 'Three'], ['four', '四', 'Four'], ['five', '五', 'Five'],
  ['six', '六', 'Six'], ['seven', '七', 'Seven'], ['eight', '八', 'Eight'], ['nine', '九', 'Nine'], ['ten', '十', 'Ten'],
  ['page', '侍从', 'Page'], ['knight', '骑士', 'Knight'], ['queen', '王后', 'Queen'], ['king', '国王', 'King'],
]

export const TAROT_DECK = Object.freeze([
  ...TAROT_MAJORS.map(([id, chineseName, englishName]) => Object.freeze({ id: `tarot-major-${id}`, name: `${chineseName} · ${englishName}` })),
  ...TAROT_SUITS.flatMap(([suitId, chineseSuit, englishSuit]) => TAROT_RANKS.map(([rankId, chineseRank, englishRank]) => Object.freeze({
    id: `tarot-${suitId}-${rankId}`,
    name: `${chineseSuit}${chineseRank} · ${englishRank} of ${englishSuit}`,
  }))),
])

export const TAVERN_DIVINATION_CONFIG = Object.freeze({
  'eastern-oracle': Object.freeze({
    kind: 'hexagram',
    deckVersion: 'zhouyi-64-v1',
    supportedSpreads: Object.freeze(['single']),
  }),
  'tarot-reader': Object.freeze({
    kind: 'tarot',
    deckVersion: 'rws-text-78-v1',
    supportedSpreads: Object.freeze(['single', 'three']),
  }),
})

const THREE_CARD_POSITIONS = Object.freeze(['过去主题', '当下主题', '可能的方向'])

function drawError(statusCode, code, message, action = '') {
  return Object.assign(new Error(message), {
    statusCode,
    code,
    ...(action ? { action } : {}),
  })
}

function ownerIdValue(value) {
  if (typeof value !== 'string' || !/^ielts:\d+$/.test(value)) {
    throw drawError(401, 'coach_auth_required', 'Sign in to STEM before drawing.')
  }
  return value
}

function personaConfig(value) {
  if (typeof value !== 'string' || !TAVERN_DIVINATION_CONFIG[value]) {
    throw drawError(400, 'coach_tavern_divination_persona_invalid', 'Choose an available entertainment divination preset.')
  }
  return { persona: value, config: TAVERN_DIVINATION_CONFIG[value] }
}

function spreadValue(value, config) {
  if (typeof value !== 'string' || !config.supportedSpreads.includes(value)) {
    throw drawError(400, 'coach_tavern_draw_spread_invalid', 'Choose a supported draw spread.')
  }
  return value
}

function nonceValue(value) {
  if (typeof value !== 'string') {
    throw drawError(400, 'coach_tavern_draw_nonce_invalid', 'drawNonce must be a bounded scalar identifier.')
  }
  const nonce = value.trim()
  if (!/^[A-Za-z0-9._:-]{8,120}$/.test(nonce)) {
    throw drawError(400, 'coach_tavern_draw_nonce_invalid', 'drawNonce must be a bounded scalar identifier.')
  }
  return nonce
}

function drawIdValue(value) {
  if (typeof value !== 'string') {
    throw drawError(400, 'coach_tavern_draw_id_invalid', 'drawId must be a scalar server receipt identifier.', 'draw_required')
  }
  const drawId = value.trim().toLowerCase()
  if (!/^[a-f0-9-]{32,48}$/.test(drawId)) {
    throw drawError(400, 'coach_tavern_draw_id_invalid', 'drawId must be a scalar server receipt identifier.', 'draw_required')
  }
  return drawId
}

function randomIndex(randomInt, max) {
  const value = randomInt(max)
  if (!Number.isInteger(value) || value < 0 || value >= max) {
    throw new Error('Divination random source returned an out-of-range value.')
  }
  return value
}

function drawnCards(config, spread, randomInt) {
  const deck = config.kind === 'hexagram' ? HEXAGRAM_DECK : TAROT_DECK
  const count = spread === 'three' ? 3 : 1
  const positions = spread === 'three' ? THREE_CARD_POSITIONS : ['本次提示']
  const pool = [...deck]
  return Object.freeze(Array.from({ length: count }, (_, index) => {
    const card = pool.splice(randomIndex(randomInt, pool.length), 1)[0]
    return Object.freeze({
      id: card.id,
      name: card.name,
      position: positions[index],
      ...(config.kind === 'tarot' ? { orientation: randomIndex(randomInt, 2) === 0 ? 'upright' : 'reversed' } : {}),
    })
  }))
}

function publicDraw({ id, config, spread, nowMs, ttlMs, cards }) {
  return Object.freeze({
    id,
    kind: config.kind,
    spread,
    deckVersion: config.deckVersion,
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
    entertainmentOnly: true,
    cards,
  })
}

export function createTavernDivinationStore({
  randomInt = (max) => crypto.randomInt(max),
  randomUUID = () => crypto.randomUUID(),
  now = () => Date.now(),
  ttlMs = TAVERN_DIVINATION_TTL_MS,
  maxEntries = TAVERN_DIVINATION_MAX_RECEIPTS,
} = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 5000) throw new Error('maxEntries must be an integer from 1 to 5000.')
  if (!Number.isFinite(ttlMs) || ttlMs < 1000 || ttlMs > 24 * 60 * 60 * 1000) throw new Error('ttlMs is outside the supported range.')
  const recordsById = new Map()
  const nonceClaims = new Map()

  function claimKey(ownerId, nonce) {
    return `${ownerId}\n${nonce}`
  }

  function trimClaims() {
    const limit = maxEntries * 2
    while (nonceClaims.size > limit) {
      let deleted = false
      for (const [key, claim] of nonceClaims) {
        if (!recordsById.has(claim.drawId)) {
          nonceClaims.delete(key)
          deleted = true
          break
        }
      }
      if (!deleted) break
    }
  }

  function evictForCapacity() {
    while (recordsById.size >= maxEntries) {
      const oldestId = recordsById.keys().next().value
      recordsById.delete(oldestId)
    }
  }

  function createDraw({ ownerId: ownerInput, persona: personaInput, spread: spreadInput, nonce: nonceInput } = {}) {
    const ownerId = ownerIdValue(ownerInput)
    const { persona, config } = personaConfig(personaInput)
    const spread = spreadValue(spreadInput, config)
    const nonce = nonceValue(nonceInput)
    const key = claimKey(ownerId, nonce)
    const existingClaim = nonceClaims.get(key)
    if (existingClaim) {
      if (existingClaim.persona !== persona || existingClaim.spread !== spread) {
        throw drawError(409, 'coach_tavern_draw_nonce_conflict', 'This drawNonce is already bound to a different preset or spread.', 'draw_required')
      }
      const existingRecord = recordsById.get(existingClaim.drawId)
      if (!existingRecord) {
        throw drawError(409, 'coach_tavern_draw_unavailable', 'This draw receipt is no longer available. Start an explicit new draw.', 'draw_required')
      }
      if (now() >= existingRecord.expiresAtMs) {
        throw drawError(409, 'coach_tavern_draw_expired', 'This draw has expired. Start an explicit new draw.', 'draw_required')
      }
      return existingRecord.draw
    }

    evictForCapacity()
    const nowMs = Number(now())
    const id = String(randomUUID()).toLowerCase()
    if (!/^[a-f0-9-]{32,48}$/.test(id) || recordsById.has(id)) throw new Error('Divination receipt ID generation failed.')
    const draw = publicDraw({ id, config, spread, nowMs, ttlMs, cards: drawnCards(config, spread, randomInt) })
    recordsById.set(id, Object.freeze({ ownerId, persona, spread, expiresAtMs: nowMs + ttlMs, draw }))
    nonceClaims.set(key, { persona, spread, drawId: id })
    trimClaims()
    return draw
  }

  function resolveDraw({ ownerId: ownerInput, persona: personaInput, drawId: drawIdInput } = {}) {
    const ownerId = ownerIdValue(ownerInput)
    const { persona } = personaConfig(personaInput)
    const drawId = drawIdValue(drawIdInput)
    const record = recordsById.get(drawId)
    if (!record || record.ownerId !== ownerId) {
      throw drawError(404, 'coach_tavern_draw_not_found', 'This draw is not available for this account.', 'draw_required')
    }
    if (record.persona !== persona) {
      throw drawError(409, 'coach_tavern_draw_binding_mismatch', 'This draw belongs to a different Tavern preset.', 'draw_required')
    }
    if (now() >= record.expiresAtMs) {
      throw drawError(409, 'coach_tavern_draw_expired', 'This draw has expired. Start an explicit new draw.', 'draw_required')
    }
    return record.draw
  }

  return Object.freeze({ createDraw, resolveDraw })
}

export function tavernDrawSystemPrompt(draw) {
  const config = Object.values(TAVERN_DIVINATION_CONFIG).find((candidate) => candidate.kind === draw?.kind && candidate.deckVersion === draw?.deckVersion)
  const deck = config?.kind === 'hexagram' ? HEXAGRAM_DECK : config?.kind === 'tarot' ? TAROT_DECK : []
  const expectedCount = draw?.spread === 'three' ? 3 : draw?.spread === 'single' ? 1 : 0
  if (!config || !expectedCount || !Array.isArray(draw?.cards) || draw.cards.length !== expectedCount) {
    throw drawError(409, 'coach_tavern_draw_binding_mismatch', 'The trusted draw receipt is invalid.', 'draw_required')
  }
  const lines = draw.cards.map((card, index) => {
    const canonical = deck.find((candidate) => candidate.id === card?.id)
    const position = draw.spread === 'three' ? THREE_CARD_POSITIONS[index] : '本次提示'
    const orientation = config.kind === 'tarot' && (card?.orientation === 'upright' || card?.orientation === 'reversed') ? card.orientation : ''
    if (!canonical || canonical.name !== card?.name || card?.position !== position || (config.kind === 'tarot' && !orientation)) {
      throw drawError(409, 'coach_tavern_draw_binding_mismatch', 'The trusted draw receipt is invalid.', 'draw_required')
    }
    return `- ${position}: ${canonical.name}${orientation ? ` (${orientation})` : ''}`
  })
  return [
    `Trusted server-generated entertainment draw (${config.kind}, ${draw.spread}).`,
    'Interpret exactly these cards or signs; never replace, add, remove or pretend to redraw them:',
    ...lines,
    'Use each card or sign theme as a reflection question or metaphor, never as proof of the user\'s actual past, current mood, personality, another person\'s intent, or future.',
    'Use conditional Chinese phrasing such as “如果……，可以想想……”, never unsupported assertions such as “你其实……” or “你曾经……”.',
    'Start directly with the card or sign meanings and positions without re-welcoming the user or repeating the static opening.',
    'Treat every interpretation as reflective entertainment, not a guaranteed fact, hidden power, diagnosis, professional advice or certain future prediction.',
  ].join('\n')
}
