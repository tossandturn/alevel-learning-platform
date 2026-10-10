import crypto from 'node:crypto'
import { isIP } from 'node:net'

import { productConfigError } from './errors.mjs'

export const CONFIG_SCHEMA_VERSION = 'stemist-product-config-v1'
export const MAX_CONFIG_BYTES = 128 * 1024
export const CHANNELS = Object.freeze(['release', 'trial', 'develop'])

const REVISION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
const ICON_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const HOME_IDS = Object.freeze(['alevel', 'ap', 'ib', 'ielts', 'competition', 'calculator'])
const COACH_IDS = Object.freeze(['steps', 'answers', 'pdf', 'tavern'])
const CATEGORY_IDS = Object.freeze(['all', 'companion', 'story', 'fortune'])
const REQUIRED_PRESET_IDS = Object.freeze([
  'keeper',
  'study-buddy',
  'cat-companion',
  'story-traveler',
  'xianxia-guide',
  'mystery-guide',
  'eastern-oracle',
  'tarot-reader',
])
const PAGE_TARGETS = new Set([
  'alevel', 'ap', 'ib', 'ielts', 'competition', 'calculator', 'coach', 'announcements', 'university-directory',
])
const RESERVED_HOST_SUFFIXES = new Set(['localhost', 'local', 'internal', 'lan', 'home', 'test', 'invalid', 'example', 'onion'])
const DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

function invalid(message, details) {
  throw productConfigError('invalid_config', message, { statusCode: 400, details })
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasControlCharacters(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true
  }
  return false
}

function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      index += 1
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true
    }
  }
  return false
}

function exactObject(value, keys, label) {
  if (!isPlainObject(value)) invalid(`${label} must be an object.`)
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalid(`${label} has unknown or missing properties.`)
  }
  return value
}

function boundedString(value, { label, min = 0, max, pattern = null }) {
  if (typeof value !== 'string') invalid(`${label} must be a string.`)
  if (value !== value.trim()) invalid(`${label} must be trimmed.`)
  if (hasControlCharacters(value)) invalid(`${label} contains control characters.`)
  if (hasUnpairedSurrogate(value)) invalid(`${label} contains an unpaired UTF-16 surrogate.`)
  const length = [...value].length
  if (length < min || length > max) invalid(`${label} is outside its length limit.`)
  if (pattern && !pattern.test(value)) invalid(`${label} has an invalid format.`)
  return value
}

function boundedArray(value, { label, min = 0, max }) {
  if (!Array.isArray(value) || value.length < min || value.length > max) invalid(`${label} is outside its item limit.`)
  return value
}

function uniqueIds(items, label) {
  const seen = new Set()
  for (const item of items) {
    const id = boundedString(item?.id, { label: `${label}.id`, min: 1, max: 64, pattern: ID_PATTERN })
    if (seen.has(id)) invalid(`${label} contains duplicate IDs.`)
    seen.add(id)
  }
  return seen
}

function exactIdSet(items, expectedIds, label) {
  const actual = uniqueIds(items, label)
  if (actual.size !== expectedIds.length || expectedIds.some((id) => !actual.has(id))) {
    invalid(`${label} must contain the exact supported IDs.`)
  }
  return actual
}

function validatePublishedAt(value) {
  boundedString(value, { label: 'publishedAt', min: 20, max: 40 })
  const match = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?<fraction>\.\d{1,3})?(?<zone>Z|(?<offsetSign>[+-])(?<offsetHour>\d{2}):(?<offsetMinute>\d{2}))$/u.exec(value)
  if (!match) {
    invalid('publishedAt must be a timezone-aware ISO timestamp.')
  }
  const year = Number(match.groups.year)
  const month = Number(match.groups.month)
  const day = Number(match.groups.day)
  const hour = Number(match.groups.hour)
  const minute = Number(match.groups.minute)
  const second = Number(match.groups.second)
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]
      || hour > 23 || minute > 59 || second > 59) {
    invalid('publishedAt is not a valid calendar time.')
  }
  if (match.groups.zone !== 'Z') {
    const offsetHour = Number(match.groups.offsetHour)
    const offsetMinute = Number(match.groups.offsetMinute)
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) {
      invalid('publishedAt has an invalid timezone offset.')
    }
  }
  if (!Number.isFinite(Date.parse(value))) invalid('publishedAt is not a valid timestamp.')
}

function validateIcon(value, iconAllowlist, label) {
  const icon = boundedString(value, { label, min: 1, max: 128, pattern: ICON_PATTERN })
  if (icon.includes('/') || icon.includes('\\') || icon === '.' || icon === '..') invalid(`${label} must be a packaged icon basename.`)
  if (!(iconAllowlist instanceof Set) || !iconAllowlist.has(icon)) invalid(`${label} is not in the packaged icon allowlist.`)
}

export function validatePublicCopyUrl(value, label = 'copy.url') {
  const raw = boundedString(value, { label, min: 1, max: 2048 })
  if (!raw.startsWith('https://')) invalid(`${label} must use canonical lowercase HTTPS.`)
  if (/\s|\\/u.test(raw)) invalid(`${label} contains unsafe characters.`)
  if (/[?#]/u.test(raw)) invalid(`${label} cannot contain a query or fragment.`)
  if (/%2f|%5c/iu.test(raw)) invalid(`${label} cannot contain encoded path separators.`)
  const authorityEnd = raw.indexOf('/', 'https://'.length)
  const rawAuthority = raw.slice('https://'.length, authorityEnd === -1 ? raw.length : authorityEnd)
  if (rawAuthority.includes(':')) invalid(`${label} cannot contain an explicit port.`)
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    invalid(`${label} is not a valid URL.`)
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) {
    invalid(`${label} must be public HTTPS without credentials, port, query or fragment.`)
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/gu, '')
  const labels = hostname.split('.')
  const tld = labels.at(-1) || ''
  if (rawAuthority !== hostname
      || hostname.length > 253
      || !/^[a-z0-9.-]+$/u.test(hostname)
      || labels.length < 2
      || labels.some((dnsLabel) => !DNS_LABEL_PATTERN.test(dnsLabel))
      || !/^[a-z]{2,63}$/u.test(tld)
      || RESERVED_HOST_SUFFIXES.has(tld)
      || isIP(hostname)) {
    invalid(`${label} must use a public DNS hostname.`)
  }
  const rawPath = authorityEnd === -1 ? '/' : raw.slice(authorityEnd)
  let decodedPath = rawPath
  let stable = false
  for (let pass = 0; pass < 8; pass += 1) {
    if (/%2f|%5c/iu.test(decodedPath)
        || hasControlCharacters(decodedPath)
        || /\\/u.test(decodedPath)
        || decodedPath.split('/').some((segment) => segment === '.' || segment === '..')) {
      invalid(`${label} cannot contain encoded separators, controls or traversal.`)
    }
    let next
    try {
      next = decodeURIComponent(decodedPath)
    } catch {
      invalid(`${label} contains invalid URL encoding.`)
    }
    if (next === decodedPath) {
      stable = true
      break
    }
    decodedPath = next
  }
  if (!stable) invalid(`${label} encoding does not stabilize within eight decoding passes.`)
  return raw
}

function validateAction(action, pageIds, label) {
  if (!isPlainObject(action) || typeof action.kind !== 'string') invalid(`${label} must be a supported action.`)
  if (action.kind === 'page') {
    exactObject(action, ['kind', 'target'], label)
    boundedString(action.target, { label: `${label}.target`, min: 1, max: 64 })
    if (!PAGE_TARGETS.has(action.target)) invalid(`${label} uses an unsupported native page target.`)
    return
  }
  if (action.kind === 'screen') {
    exactObject(action, ['kind', 'target'], label)
    boundedString(action.target, { label: `${label}.target`, min: 1, max: 64, pattern: ID_PATTERN })
    if (!pageIds.has(action.target)) invalid(`${label} references an unknown generic screen.`)
    return
  }
  if (action.kind === 'copy') {
    exactObject(action, ['kind', 'url'], label)
    validatePublicCopyUrl(action.url, `${label}.url`)
    return
  }
  invalid(`${label} uses an unsupported action kind.`)
}

function validatePages(pages) {
  boundedArray(pages, { label: 'pages', min: 0, max: 16 })
  const pageIds = uniqueIds(pages, 'pages')
  for (const [pageIndex, page] of pages.entries()) {
    const pageLabel = `pages[${pageIndex}]`
    exactObject(page, ['id', 'title', 'sections'], pageLabel)
    boundedString(page.title, { label: `${pageLabel}.title`, min: 1, max: 60 })
    boundedArray(page.sections, { label: `${pageLabel}.sections`, min: 1, max: 20 })
    uniqueIds(page.sections, `${pageLabel}.sections`)
  }
  for (const [pageIndex, page] of pages.entries()) {
    const pageLabel = `pages[${pageIndex}]`
    let totalItems = page.sections.length
    for (const [sectionIndex, section] of page.sections.entries()) {
      const label = `${pageLabel}.sections[${sectionIndex}]`
      if (!isPlainObject(section) || typeof section.type !== 'string') invalid(`${label} must be a supported section.`)
      if (section.type === 'text') {
        exactObject(section, ['id', 'type', 'title', 'text'], label)
        boundedString(section.title, { label: `${label}.title`, min: 0, max: 80 })
        boundedString(section.text, { label: `${label}.text`, min: 1, max: 4000 })
      } else if (section.type === 'notice') {
        exactObject(section, ['id', 'type', 'title', 'text', 'tone'], label)
        boundedString(section.title, { label: `${label}.title`, min: 0, max: 80 })
        boundedString(section.text, { label: `${label}.text`, min: 1, max: 1000 })
        if (!['info', 'warning'].includes(section.tone)) invalid(`${label}.tone is unsupported.`)
      } else if (section.type === 'links') {
        exactObject(section, ['id', 'type', 'title', 'items'], label)
        boundedString(section.title, { label: `${label}.title`, min: 0, max: 80 })
        boundedArray(section.items, { label: `${label}.items`, min: 1, max: 30 })
        uniqueIds(section.items, `${label}.items`)
        totalItems += section.items.length
        for (const [itemIndex, item] of section.items.entries()) {
          const itemLabel = `${label}.items[${itemIndex}]`
          exactObject(item, ['id', 'label', 'detail', 'action'], itemLabel)
          boundedString(item.label, { label: `${itemLabel}.label`, min: 1, max: 80 })
          boundedString(item.detail, { label: `${itemLabel}.detail`, min: 0, max: 160 })
          validateAction(item.action, pageIds, `${itemLabel}.action`)
        }
      } else {
        invalid(`${label}.type is unsupported.`)
      }
    }
    if (totalItems > 100) invalid(`${pageLabel} exceeds the total item limit.`)
  }
  return pageIds
}

export function validateProductConfig(config, { iconAllowlist } = {}) {
  exactObject(config, ['schemaVersion', 'revision', 'publishedAt', 'minCapabilityVersion', 'home', 'coach', 'tavern', 'pages'], 'config')
  if (config.schemaVersion !== CONFIG_SCHEMA_VERSION) invalid('schemaVersion is unsupported.')
  boundedString(config.revision, { label: 'revision', min: 1, max: 64, pattern: REVISION_PATTERN })
  if (config.revision === 'none') invalid('revision uses the reserved absent-current sentinel.')
  validatePublishedAt(config.publishedAt)
  if (config.minCapabilityVersion !== 1) invalid('minCapabilityVersion must be 1.')

  const pageIds = validatePages(config.pages)

  exactObject(config.home, ['heading', 'entries', 'secondary'], 'home')
  boundedString(config.home.heading, { label: 'home.heading', min: 1, max: 40 })
  boundedArray(config.home.entries, { label: 'home.entries', min: 6, max: 6 })
  exactIdSet(config.home.entries, HOME_IDS, 'home.entries')
  for (const [index, entry] of config.home.entries.entries()) {
    const label = `home.entries[${index}]`
    exactObject(entry, ['id', 'title', 'detail', 'tone'], label)
    boundedString(entry.title, { label: `${label}.title`, min: 1, max: 30 })
    boundedString(entry.detail, { label: `${label}.detail`, min: 1, max: 80 })
    if (!HOME_IDS.includes(entry.tone)) invalid(`${label}.tone is unsupported.`)
  }
  boundedArray(config.home.secondary, { label: 'home.secondary', min: 0, max: 6 })
  uniqueIds(config.home.secondary, 'home.secondary')
  for (const [index, item] of config.home.secondary.entries()) {
    const label = `home.secondary[${index}]`
    exactObject(item, ['id', 'label', 'action'], label)
    boundedString(item.label, { label: `${label}.label`, min: 1, max: 40 })
    validateAction(item.action, pageIds, `${label}.action`)
  }

  exactObject(config.coach, ['modes'], 'coach')
  boundedArray(config.coach.modes, { label: 'coach.modes', min: 4, max: 4 })
  exactIdSet(config.coach.modes, COACH_IDS, 'coach.modes')
  for (const [index, mode] of config.coach.modes.entries()) {
    const label = `coach.modes[${index}]`
    exactObject(mode, ['id', 'title', 'detail'], label)
    boundedString(mode.title, { label: `${label}.title`, min: 1, max: 30 })
    boundedString(mode.detail, { label: `${label}.detail`, min: 1, max: 100 })
  }

  exactObject(config.tavern, ['categories', 'presets'], 'tavern')
  boundedArray(config.tavern.categories, { label: 'tavern.categories', min: 4, max: 4 })
  exactIdSet(config.tavern.categories, CATEGORY_IDS, 'tavern.categories')
  for (const [index, category] of config.tavern.categories.entries()) {
    const label = `tavern.categories[${index}]`
    exactObject(category, ['id', 'label'], label)
    boundedString(category.label, { label: `${label}.label`, min: 1, max: 20 })
  }

  boundedArray(config.tavern.presets, { label: 'tavern.presets', min: 8, max: 24 })
  const presetIds = uniqueIds(config.tavern.presets, 'tavern.presets')
  if (REQUIRED_PRESET_IDS.some((id) => !presetIds.has(id))) invalid('tavern.presets must retain every required preset ID.')
  for (const [index, preset] of config.tavern.presets.entries()) {
    const label = `tavern.presets[${index}]`
    exactObject(preset, ['id', 'name', 'tag', 'detail', 'greeting', 'placeholder', 'starters', 'category', 'icon'], label)
    boundedString(preset.name, { label: `${label}.name`, min: 1, max: 30 })
    boundedString(preset.tag, { label: `${label}.tag`, min: 1, max: 30 })
    boundedString(preset.detail, { label: `${label}.detail`, min: 1, max: 120 })
    boundedString(preset.greeting, { label: `${label}.greeting`, min: 1, max: 500 })
    boundedString(preset.placeholder, { label: `${label}.placeholder`, min: 1, max: 120 })
    boundedArray(preset.starters, { label: `${label}.starters`, min: 1, max: 4 })
    for (const [starterIndex, starter] of preset.starters.entries()) {
      boundedString(starter, { label: `${label}.starters[${starterIndex}]`, min: 1, max: 100 })
    }
    if (!['companion', 'story', 'fortune'].includes(preset.category)) invalid(`${label}.category is unsupported.`)
    if (!REQUIRED_PRESET_IDS.includes(preset.id) && !['companion', 'story'].includes(preset.category)) {
      invalid(`${label} adds an unsupported backend persona category.`)
    }
    validateIcon(preset.icon, iconAllowlist, `${label}.icon`)
  }
  return config
}

export function validateProductConfigBytes(input, options = {}) {
  const bytes = Buffer.isBuffer(input) ? Buffer.from(input) : Buffer.from(input || '')
  if (bytes.length === 0) throw productConfigError('invalid_json', 'Configuration JSON is empty.', { statusCode: 400 })
  if (bytes.length > MAX_CONFIG_BYTES) {
    throw productConfigError('config_too_large', 'Configuration exceeds the 128 KiB response limit.', { statusCode: 413 })
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw productConfigError('invalid_json', 'Configuration must be UTF-8 without a byte-order mark.', { statusCode: 400 })
  }
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw productConfigError('invalid_json', 'Configuration is not valid UTF-8.', { statusCode: 400 })
  }
  let config
  try {
    config = JSON.parse(text)
  } catch {
    throw productConfigError('invalid_json', 'Configuration is not valid JSON.', { statusCode: 400 })
  }
  validateProductConfig(config, options)
  return {
    config,
    bytes,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }
}
