import assert from 'node:assert/strict'
import { TAVERN_PRESENTATION } from '../server/tavernPresentation.js'
import { resolveCoachFeature } from '../server/coachFeatures.js'

let module
try { module = await import('../server/nativeProductConfig.js') } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error }
assert.equal(typeof module?.buildNativeProductConfig, 'function', 'a backend-owned native presentation builder must exist')
const { buildNativeProductConfig } = module
const legacyIds = ['keeper', 'study-buddy', 'cat-companion', 'story-traveler', 'xianxia-guide', 'mystery-guide', 'eastern-oracle', 'tarot-reader']
const icons = ['keeper-tree-lantern.svg', 'study-buddy-banter.svg', 'cat-companion-face.svg', 'story-traveler-map.svg', 'xianxia-sword-bamboo.svg', 'mystery-tea-lens.svg', 'eastern-oracle-lots.svg', 'tarot-moon-cards.svg']
const base = {
  schemaVersion: 'stemist-product-config-v1', revision: 'old-v1', publishedAt: '2026-10-30T00:00:00Z', minCapabilityVersion: 1,
  home: { heading: '今天想学什么？', entries: [{ id: 'calculator', detail: '免费开放' }], secondary: [] },
  coach: { modes: [{ id: 'tavern', title: 'AI 休闲酒馆', detail: '现有入口' }] },
  pages: [{ id: 'guide', title: '保留运营内容', sections: [] }],
  tavern: { categories: [{ id: 'all', label: '全部' }], presets: legacyIds.map((id, i) => ({
    id, name: '旧名', tag: '旧标签', detail: '旧文案', greeting: '旧开场', placeholder: '旧输入提示', starters: ['旧话题'],
    category: i < 3 ? 'companion' : i < 6 ? 'story' : 'fortune', icon: icons[i],
  })) },
}
const original = structuredClone(base), iconAllowlist = new Set(icons)
let validations = 0
// Unit seam: integration acceptance must also run the deployed strict schema
// and the exact frozen client validators, not substitute this seam for them.
const validate = value => { validations++; assert.equal(value.schemaVersion, 'stemist-product-config-v1'); return value }
const options = { base, revision: 'backend-content-20261105-v1', publishedAt: '2026-11-05T16:00:00+08:00', iconAllowlist, validate }
const result = buildNativeProductConfig(options)
assert.equal(validations, 2, 'validate input and output with the caller-pinned service schema')
assert.deepEqual(base, original, 'preparation never mutates the active publication')
for (const field of ['home', 'coach', 'pages']) assert.deepEqual(result[field], base[field], `preserve ${field}`)
assert.deepEqual(result.tavern.categories, base.tavern.categories)
assert.deepEqual(result.tavern.presets.map(x => x.id), [...legacyIds.slice(0, 6), 'horror-guide', ...legacyIds.slice(6)])
for (const preset of result.tavern.presets) {
  const canonical = TAVERN_PRESENTATION[preset.id]
  assert.equal(preset.name, canonical.name)
  assert.equal(preset.detail, canonical.tagline)
  assert.equal(preset.greeting, canonical.greeting)
  assert.deepEqual(preset.starters, canonical.starters)
  assert.equal(resolveCoachFeature({ feature: 'tavern', persona: preset.id }).persona, preset.id)
  assert.ok(iconAllowlist.has(preset.icon), 'icons must work in legacy clients too')
  assert.deepEqual(Object.keys(preset).sort(), ['id','name','tag','detail','greeting','placeholder','starters','category','icon'].sort(), 'public projection only')
}
assert.equal(result.tavern.presets.find(x => x.id === 'horror-guide').icon, 'mystery-tea-lens.svg', 'never require the newer packaged horror icon for capability 1')
assert.notEqual(result.tavern.presets[0].starters, TAVERN_PRESENTATION.keeper.starters)
assert.deepEqual(buildNativeProductConfig(options), result, 'a publication is deterministic for identical inputs')
assert.equal(buildNativeProductConfig({ ...options, base: result, revision: 'backend-content-20261105-v2' }).tavern.presets.length, 9, 'later publications must not duplicate the ninth persona')
assert.throws(() => buildNativeProductConfig({ ...options, validate: undefined }), /validator/)
assert.throws(() => buildNativeProductConfig({ ...options, iconAllowlist: new Set() }), /icon/)
assert.throws(() => buildNativeProductConfig({ ...options, revision: 'none' }), /revision/)
assert.throws(() => buildNativeProductConfig({ ...options, revision: base.revision }), /revision/)
const unknown = structuredClone(base); unknown.tavern.presets.push({ ...unknown.tavern.presets[0], id: 'unsupported-role' })
assert.throws(() => buildNativeProductConfig({ ...options, base: unknown }), /unsupported.*persona/)
const missing = structuredClone(base); missing.tavern.presets.pop()
assert.throws(() => buildNativeProductConfig({ ...options, base: missing }), /required.*persona/)
const duplicate = structuredClone(base); duplicate.tavern.presets.push(duplicate.tavern.presets[0])
assert.throws(() => buildNativeProductConfig({ ...options, base: duplicate }), /duplicate/)
assert.throws(() => buildNativeProductConfig({ ...options, validate: () => { throw Error('strict schema rejected') } }), /strict schema rejected/)
console.log('PASS_NATIVE_PRODUCT_CONFIG canonical nine personas, legacy icons, preserved unrelated sections, validated input/output, no public authority')
