import { TAVERN_PRESENTATION } from './tavernPresentation.js'

// Capability 1 is shared by old and current clients. Bind to its common icon
// set; a newer packaged icon is not evidence that every installed client has it.
const BINDINGS = Object.freeze({
  keeper: ['倾听陪伴', 'companion', 'keeper-tree-lantern.svg', '和阿栖说说此刻的心情…'],
  'study-buddy': ['轻松吐槽', 'companion', 'study-buddy-banter.svg', '把那件离谱小事讲给阿岔…'],
  'cat-companion': ['猫系陪伴', 'companion', 'cat-companion-face.svg', '和栗子随便聊两句…'],
  'story-traveler': ['互动奇幻', 'story', 'story-traveler-map.svg', '和诺米聊天，或写下你的下一步…'],
  'xianxia-guide': ['江湖奇遇', 'story', 'xianxia-sword-bamboo.svg', '和沈照聊天，或说出你的行动…'],
  'mystery-guide': ['互动悬疑', 'story', 'mystery-tea-lens.svg', '和闻笙聊天，或记录你的观察…'],
  'horror-guide': ['互动恐怖', 'story', 'mystery-tea-lens.svg', '和林漪聊天，或说出你想调查的事…'],
  'eastern-oracle': ['东方卦签', 'fortune', 'eastern-oracle-lots.svg', '和闲舟聊天，或留一个轻问题…'],
  'tarot-reader': ['塔罗娱乐', 'fortune', 'tarot-moon-cards.svg', '和星遥聊天，或留一个轻问题…'],
})
const LEGACY_IDS = Object.keys(BINDINGS).filter(id => id !== 'horror-guide')

// This is an offline publication builder, not a request handler or an admin
// endpoint. The caller must supply the exact deployed service's validator.
// Keep all other public sections byte-equivalent after JSON serialization.
export function buildNativeProductConfig({ base, revision, publishedAt, iconAllowlist, validate } = {}) {
  if (typeof validate !== 'function') throw new Error('A pinned service schema validator is required')
  if (!(iconAllowlist instanceof Set) || !iconAllowlist.size) throw new Error('A packaged icon allowlist is required')
  if (typeof revision !== 'string' || revision === 'none' || revision === base?.revision || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(revision)) throw new Error('A new immutable revision is required')
  validate(base, { iconAllowlist })
  const result = structuredClone(base)
  const ids = result.tavern.presets.map(p => p.id), unique = new Set(ids)
  if (ids.length !== unique.size) throw new Error('Publication contains duplicate persona IDs')
  if (ids.some(id => !Object.hasOwn(BINDINGS, id) || !Object.hasOwn(TAVERN_PRESENTATION, id))) throw new Error('Publication contains an unsupported backend persona')
  if (LEGACY_IDS.some(id => !unique.has(id))) throw new Error('Publication is missing a required legacy persona')
  if (!unique.has('horror-guide')) {
    const next = ids.findIndex(id => BINDINGS[id][1] === 'fortune')
    ids.splice(next < 0 ? ids.length : next, 0, 'horror-guide')
  }
  result.revision = revision
  result.publishedAt = publishedAt
  result.tavern.presets = ids.map(id => {
    const { name, tagline, greeting, starters } = TAVERN_PRESENTATION[id]
    const [tag, category, icon, placeholder] = BINDINGS[id]
    if (!iconAllowlist.has(icon)) throw new Error('Publication requires an unsupported native icon')
    // Never spread a character card, prompt, private memory or game state here.
    return { id, name, tag, detail: tagline, greeting, placeholder, starters: [...starters], category, icon }
  })
  validate(result, { iconAllowlist })
  return result
}
