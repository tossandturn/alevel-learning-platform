export const COACH_DIAGRAM_FORMAT = 'stem-diagram-v1'

const OPEN_FENCE = '```stem-diagram'
const CLOSE_FENCE = '```'
const MAX_ELEMENTS = 60
const MAX_POLYLINE_POINTS = 100
const MAX_TOTAL_POLYLINE_POINTS = 1200
const MAX_BUFFER_CHARS = 64 * 1024
const ROOT_FIELDS = new Set(['version', 'title', 'description', 'width', 'height', 'elements'])
const ELEMENT_FIELDS = Object.freeze({
  line: new Set(['type', 'x1', 'y1', 'x2', 'y2', 'arrow', 'label']),
  rect: new Set(['type', 'x', 'y', 'width', 'height', 'label']),
  circle: new Set(['type', 'cx', 'cy', 'r', 'label']),
  polyline: new Set(['type', 'points', 'label']),
  text: new Set(['type', 'x', 'y', 'text']),
})

function diagramError(message) {
  return Object.assign(new Error(message), { code: 'COACH_DIAGRAM_INVALID' })
}

function assertFields(value, allowed, label) {
  const unexpected = Object.keys(value).find((key) => !allowed.has(key))
  if (unexpected) throw diagramError(`${label} contains unsupported field ${unexpected}.`)
}

function boundedText(value, label, maxLength, { optional = false } = {}) {
  if (value === undefined && optional) return undefined
  if (typeof value !== 'string') throw diagramError(`${label} must be text.`)
  const text = value.trim()
  if (!text || Array.from(text).length > maxLength) throw diagramError(`${label} is empty or too long.`)
  if (/(?:https?:\/\/|javascript:|data:|\beval\s*\(|\bfunction\s*\(|<|>)/iu.test(text)) {
    throw diagramError(`${label} contains unsafe content.`)
  }
  return text
}

function finiteNumber(value, label, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw diagramError(`${label} must be a finite number.`)
  if (value < min || value > max) throw diagramError(`${label} is outside diagram bounds.`)
  return value
}

function positiveNumber(value, label, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > max) {
    throw diagramError(`${label} must be a positive finite number within diagram bounds.`)
  }
  return value
}

function optionalLabel(value, label = 'label') {
  return value === undefined ? undefined : boundedText(value, label, 120)
}

function normalizeElement(element, width, height, index) {
  if (!element || typeof element !== 'object' || Array.isArray(element)) throw diagramError(`element ${index + 1} must be an object.`)
  const type = String(element.type || '')
  const fields = ELEMENT_FIELDS[type]
  if (!fields) throw diagramError(`element ${index + 1} has an unsupported type.`)
  assertFields(element, fields, `element ${index + 1}`)
  if (type === 'line') {
    const normalized = {
      type,
      x1: finiteNumber(element.x1, 'line x1', 0, width),
      y1: finiteNumber(element.y1, 'line y1', 0, height),
      x2: finiteNumber(element.x2, 'line x2', 0, width),
      y2: finiteNumber(element.y2, 'line y2', 0, height),
    }
    if (element.arrow !== undefined) {
      if (typeof element.arrow !== 'boolean') throw diagramError('line arrow must be boolean.')
      normalized.arrow = element.arrow
    }
    const label = optionalLabel(element.label, 'line label')
    if (label !== undefined) normalized.label = label
    return normalized
  }
  if (type === 'rect') {
    const x = finiteNumber(element.x, 'rect x', 0, width)
    const y = finiteNumber(element.y, 'rect y', 0, height)
    const rectWidth = positiveNumber(element.width, 'rect width', width)
    const rectHeight = positiveNumber(element.height, 'rect height', height)
    if (x + rectWidth > width || y + rectHeight > height) throw diagramError('rect is outside diagram bounds.')
    const normalized = { type, x, y, width: rectWidth, height: rectHeight }
    const label = optionalLabel(element.label, 'rect label')
    if (label !== undefined) normalized.label = label
    return normalized
  }
  if (type === 'circle') {
    const cx = finiteNumber(element.cx, 'circle cx', 0, width)
    const cy = finiteNumber(element.cy, 'circle cy', 0, height)
    const r = positiveNumber(element.r, 'circle radius', Math.min(width, height) / 2)
    if (cx - r < 0 || cx + r > width || cy - r < 0 || cy + r > height) throw diagramError('circle is outside diagram bounds.')
    const normalized = { type, cx, cy, r }
    const label = optionalLabel(element.label, 'circle label')
    if (label !== undefined) normalized.label = label
    return normalized
  }
  if (type === 'polyline') {
    if (!Array.isArray(element.points) || element.points.length < 2 || element.points.length > MAX_POLYLINE_POINTS) {
      throw diagramError(`polyline points must contain 2 to ${MAX_POLYLINE_POINTS} coordinate pairs.`)
    }
    const points = element.points.map((point, pointIndex) => {
      if (!Array.isArray(point) || point.length !== 2) throw diagramError(`polyline point ${pointIndex + 1} must be an [x, y] pair.`)
      return [
        finiteNumber(point[0], `polyline point ${pointIndex + 1} x`, 0, width),
        finiteNumber(point[1], `polyline point ${pointIndex + 1} y`, 0, height),
      ]
    })
    const normalized = { type, points }
    const label = optionalLabel(element.label, 'polyline label')
    if (label !== undefined) normalized.label = label
    return normalized
  }
  return {
    type,
    x: finiteNumber(element.x, 'text x', 0, width),
    y: finiteNumber(element.y, 'text y', 0, height),
    text: boundedText(element.text, 'text element content', 160),
  }
}

export function validateCoachDiagram(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw diagramError('diagram must be an object.')
  assertFields(value, ROOT_FIELDS, 'diagram')
  if (value.version !== COACH_DIAGRAM_FORMAT) throw diagramError(`diagram version must be ${COACH_DIAGRAM_FORMAT}.`)
  const width = finiteNumber(value.width, 'diagram width', 200, 800)
  const height = finiteNumber(value.height, 'diagram height', 120, 600)
  if (!Number.isInteger(width) || !Number.isInteger(height)) throw diagramError('diagram width and height must be integers.')
  if (!Array.isArray(value.elements) || value.elements.length < 1 || value.elements.length > MAX_ELEMENTS) {
    throw diagramError(`diagram must contain 1 to ${MAX_ELEMENTS} elements.`)
  }
  const totalPoints = value.elements.reduce((total, element) => total + (element?.type === 'polyline' && Array.isArray(element.points) ? element.points.length : 0), 0)
  if (totalPoints > MAX_TOTAL_POLYLINE_POINTS) throw diagramError(`diagram may contain at most ${MAX_TOTAL_POLYLINE_POINTS} polyline points in total.`)
  return {
    version: COACH_DIAGRAM_FORMAT,
    title: boundedText(value.title, 'diagram title', 100),
    description: boundedText(value.description, 'diagram description', 400),
    width,
    height,
    elements: value.elements.map((element, index) => normalizeElement(element, width, height, index)),
  }
}

function canonicalDiagramFence(raw, enabled) {
  if (!enabled || String(raw || '').length > MAX_BUFFER_CHARS) return ''
  try {
    const normalized = validateCoachDiagram(JSON.parse(String(raw || '').trim()))
    return `${OPEN_FENCE}\n${JSON.stringify(normalized)}\n${CLOSE_FENCE}`
  } catch {
    return ''
  }
}

function suffixPrefixLength(value, marker) {
  const lower = value.toLowerCase()
  const target = marker.toLowerCase()
  for (let length = Math.min(value.length, marker.length - 1); length > 0; length -= 1) {
    if (lower.endsWith(target.slice(0, length))) return length
  }
  return 0
}

function completeObjectLength(value) {
  if (!String(value || '').startsWith('{')) return 0
  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
      continue
    }
    if (char === '"') quoted = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return index + 1
    }
  }
  return -1
}

function isRawDiagramObject(value) {
  try {
    const parsed = JSON.parse(String(value || ''))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.version === COACH_DIAGRAM_FORMAT
  } catch {
    return false
  }
}

export function createCoachDiagramStream({ enabled = false } = {}) {
  let mode = 'text'
  let pending = ''
  let diagram = ''
  let diagramOverflow = false
  let rawObject = ''
  return Object.freeze({
    push(value) {
      pending += String(value || '')
      let output = ''
      while (pending) {
        if (mode === 'text') {
          const fenceAt = pending.toLowerCase().indexOf(OPEN_FENCE)
          const objectAt = pending.indexOf('{')
          if (objectAt >= 0 && (fenceAt < 0 || objectAt < fenceAt)) {
            output += pending.slice(0, objectAt)
            pending = pending.slice(objectAt + 1)
            rawObject = '{'
            mode = 'raw-object'
            continue
          }
          if (fenceAt >= 0) {
            output += pending.slice(0, fenceAt)
            pending = pending.slice(fenceAt + OPEN_FENCE.length)
            mode = 'diagram'
            diagram = ''
            diagramOverflow = false
            continue
          }
          const hold = suffixPrefixLength(pending, OPEN_FENCE)
          output += pending.slice(0, pending.length - hold)
          pending = pending.slice(pending.length - hold)
          break
        }
        if (mode === 'raw-object') {
          rawObject += pending
          pending = ''
          const objectLength = completeObjectLength(rawObject)
          if (objectLength > 0) {
            const candidate = rawObject.slice(0, objectLength)
            if (!isRawDiagramObject(candidate)) output += candidate
            pending = rawObject.slice(objectLength)
            rawObject = ''
            mode = 'text'
            continue
          }
          if (rawObject.length > MAX_BUFFER_CHARS) {
            if (!rawObject.includes(COACH_DIAGRAM_FORMAT)) output += rawObject
            rawObject = ''
            mode = 'text'
          }
          break
        }
        const closeAt = pending.indexOf(CLOSE_FENCE)
        if (closeAt >= 0) {
          if (!diagramOverflow) diagram += pending.slice(0, closeAt)
          output += canonicalDiagramFence(diagram, enabled)
          pending = pending.slice(closeAt + CLOSE_FENCE.length)
          mode = 'text'
          diagram = ''
          diagramOverflow = false
          continue
        }
        const hold = suffixPrefixLength(pending, CLOSE_FENCE)
        const visible = pending.slice(0, pending.length - hold)
        if (!diagramOverflow) {
          diagram += visible
          if (diagram.length > MAX_BUFFER_CHARS) {
            diagram = ''
            diagramOverflow = true
          }
        }
        pending = pending.slice(pending.length - hold)
        break
      }
      return output
    },
    finish() {
      const output = mode === 'text'
        ? pending
        : mode === 'raw-object' && !rawObject.includes(COACH_DIAGRAM_FORMAT)
          ? rawObject
          : ''
      pending = ''
      diagram = ''
      diagramOverflow = false
      rawObject = ''
      mode = 'text'
      return output
    },
  })
}

export function sanitizeCoachDiagramAnswer(value, { enabled = false } = {}) {
  const stream = createCoachDiagramStream({ enabled })
  return `${stream.push(value)}${stream.finish()}`
}

export function resolveCoachDiagramFormat(payload, feature = null) {
  if (!Object.hasOwn(payload || {}, 'diagramFormat')) return ''
  if (payload.diagramFormat !== COACH_DIAGRAM_FORMAT || feature?.feature === 'tavern') {
    throw Object.assign(new Error(`diagramFormat must be ${COACH_DIAGRAM_FORMAT} for Academic Coach requests.`), {
      statusCode: 400,
      code: 'coach_diagram_format_invalid',
    })
  }
  return COACH_DIAGRAM_FORMAT
}
