// Model supplies the physical interpretation; the server alone lays out the vectors.
// This is an isolated-body direction sketch, not a numeric solver or source verifier.
export const COACH_FORCE_FORMAT = 'stem-force-v1'
const ROOT = new Set(['version', 'title', 'body', 'description', 'surface', 'axes', 'forces'])
const SURFACE = new Set(['angleDeg', 'label', 'contactSide'])
const COMMON = ['kind', 'label', 'source']
const FORCE_FIELDS = Object.freeze({
  weight: COMMON, normal: COMMON,
  friction: [...COMMON, 'slip', 'frictionType'],
  tension: [...COMMON, 'angleDeg'], applied: [...COMMON, 'angleDeg'],
  drag: [...COMMON, 'angleDeg'], spring: [...COMMON, 'angleDeg'],
  electric: [...COMMON, 'angleDeg'], magnetic: [...COMMON, 'angleDeg'],
  buoyancy: [...COMMON, 'angleDeg'],
})
const NAMES = Object.freeze({ weight: '重力', normal: '接触面的支持力', friction: '摩擦力', tension: '绳的拉力', applied: '外加力', drag: '阻力', spring: '弹力', electric: '电场力', magnetic: '磁场力', buoyancy: '浮力' })
function invalid(message) { throw Object.assign(new Error(message), { code: 'COACH_DIAGRAM_INVALID' }) }
function fields(value, allowed, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${name} must be an object`)
  if (Object.keys(value).some(k => !allowed.has(k))) invalid(`${name} contains unsupported fields`)
}
function text(value, max, name) {
  if (typeof value !== 'string' || !value.trim() || Array.from(value.trim()).length > max) invalid(`${name} must be nonempty bounded text`)
  if (/[\x00-\x1f]|https?:\/\/|javascript:|data:|<|>|\beval\s*\(|\bfunction\s*\(/iu.test(value)) invalid(`${name} contains unsafe content`)
  return value.trim()
}
function angle(value, min, max, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) invalid(`${name} must be a bounded angle`)
  return value
}
const round = n => Math.round(n * 10000) / 10000
function vector(deg, length) { const a = deg * Math.PI / 180; return [round(Math.cos(a) * length), round(-Math.sin(a) * length)] }

export function compilePhysicsDiagram(value) {
  fields(value, ROOT, 'force diagram')
  if (value.version !== COACH_FORCE_FORMAT) invalid('force diagram version is unsupported')
  const title = text(value.title, 100, 'force diagram title')
  const body = text(value.body, 30, 'force diagram body')
  const description = text(value.description, 280, 'force diagram description')
  if (!['none', 'horizontal', 'surface'].includes(value.axes)) invalid('force diagram axes are unsupported')
  let surface = null
  if (value.surface !== undefined) {
    fields(value.surface, SURFACE, 'surface')
    if (!['above', 'below'].includes(value.surface.contactSide)) invalid('surface contactSide is required')
    surface = { angleDeg: angle(value.surface.angleDeg, -80, 80, 'surface angle'), label: text(value.surface.label, 24, 'surface label'), contactSide: value.surface.contactSide }
  }
  if (value.axes === 'surface' && !surface) invalid('surface axes require a known surface')
  if (!Array.isArray(value.forces) || value.forces.length < 1 || value.forces.length > 6) invalid('forces must contain 1 to 6 supported external forces')
  const labels = new Set()
  const forces = value.forces.map(force => {
    if (!force || !Object.hasOwn(FORCE_FIELDS, force.kind)) invalid('force kind is unsupported')
    fields(force, new Set(FORCE_FIELDS[force.kind]), 'force')
    const label = text(force.label, 12, 'force label')
    if (labels.has(label)) invalid('duplicate force label')
    labels.add(label)
    // A basis is mandatory, but must not be represented as independently verified evidence.
    text(force.source, 100, 'force source')
    let degrees
    if (force.kind === 'weight') degrees = 270
    else if (force.kind === 'normal') {
      if (!surface) invalid('normal force requires a surface')
      degrees = surface.angleDeg + (surface.contactSide === 'above' ? 90 : -90)
    } else if (force.kind === 'friction') {
      if (!surface) invalid('friction force requires a surface')
      if (!['positive', 'negative'].includes(force.slip)) invalid('friction slip/tendency direction is required')
      if (!['kinetic', 'static'].includes(force.frictionType)) invalid('friction type must be kinetic or static')
      degrees = surface.angleDeg + (force.slip === 'positive' ? 180 : 0)
    } else degrees = angle(force.angleDeg, 0, 360, 'force angle')
    return { kind: force.kind, label, degrees: ((degrees % 360) + 360) % 360 }
  })
  const width = 480, height = 350 + forces.length * 34
  const cx = 240, cy = 160
  const elements = [{ type: 'text', x: 18, y: 26, text: `研究对象 / Body: ${body}` }, { type: 'circle', cx, cy, r: 6 }]
  // Collinear forces share a direction arrow but retain separate legend entries.
  // This avoids overlapping arrows/labels without pretending they are a resultant.
  const groups = []
  for (const force of forces) {
    const group = groups.find(g => Math.abs(g.degrees - force.degrees) < .01)
    if (group) group.forces.push(force)
    else groups.push({ degrees: force.degrees, forces: [force] })
  }
  for (const group of groups) {
    const [dx, dy] = vector(group.degrees, 105)
    elements.push({ type: 'line', x1: cx, y1: cy, x2: round(cx + dx), y2: round(cy + dy), arrow: true, label: group.forces.map(f => f.label).join(', ') })
  }
  if (value.axes !== 'none') {
    const degrees = value.axes === 'surface' ? surface.angleDeg : 0
    const origin = [72, 296]
    for (const [label, deg] of [['+x', degrees], ['+y', degrees + 90]]) {
      const [dx, dy] = vector(deg, 45)
      elements.push({ type: 'line', x1: origin[0], y1: origin[1], x2: round(origin[0] + dx), y2: round(origin[1] + dy), arrow: true, label })
    }
  }
  if (surface) elements.push({ type: 'text', x: 175, y: 306, text: `接触面 / Surface: ${surface.angleDeg}°` })
  forces.forEach((f, i) => elements.push({ type: 'text', x: 18, y: 354 + i * 34, text: `${f.label} — ${NAMES[f.kind]}` }))
  return { version: 'stem-diagram-v1', title, description: `${description} 示意图（not to scale）；箭长不代表力的大小。${groups.length < forces.length ? '同向箭头的标签代表各个独立力，不是合力。' : ''}`, width, height, elements }
}

export function physicsDiagramPrompt() {
  return [
    'Physics visual teaching after explicit student consent: draw the requested free-body diagram, ray/path, circuit, wave or graph alongside the relevant explanation. This contract is not permission to add an unrequested diagram or decorative drawing to another topic.',
    'A diagram must obey the SAME hint depth and assessment restrictions as the text. In hints, draw only the setup or one allowed next cue, without final numbers, solved components or a complete construction that gives away the requested answer. When the task itself asks for a complete force diagram, a hint may show only the isolated body/axes or one discussed force using the primitive schema. Never invent contacts, friction, a taut string, field direction, scale, angle, equilibrium, coefficients or forces missing from the legible question. If needed information is uncertain, state the limitation and ask for the specific missing region/detail; omit the uncertain part rather than draw a plausible but unsupported diagram.',
    'For a SINGLE isolated-body force direction sketch, prefer the server-rendered recipe inside the SAME ```stem-diagram fence: {"version":"stem-force-v1","title":"受力图","body":"block","description":"Only the forces justified by the visible setup; state any explicit illustrative assumption.","axes":"horizontal","forces":[{"kind":"weight","label":"mg","source":"Earth gravity on the block"}]}. This example is a schema example, NOT evidence that every problem has weight. This recipe has no width/height/elements: the server supplies geometry and converts it for the native client. Include only the chosen body’s external forces, never resultant, acceleration, action-reaction partners on another body or both a force and its resolved components as extra forces.',
    'Recipe fields only: version,title (1-100 chars),body (1-30),description (1-280),axes (none|horizontal|surface),optional surface {angleDeg:-80..80,label:1-24 chars,contactSide:above|below},forces (1-6). A surface angle is measured counter-clockwise from horizontal to its positive/rightward tangent; axes=surface rotates +x along that tangent and +y 90 degrees counter-clockwise. Supply surface only when supported by the question. Above/below specifies which side of the contact surface the chosen body occupies, not whether it is moving up/down.',
    'Force recipe fields: kind,label (1-12 chars, unique short symbol),source (1-100 chars, the visible stated setup or physical interaction supporting this force). kind weight is local Earth gravity and always vertical down. kind normal requires surface and is perpendicular away from it. Neither accepts angleDeg. kind friction requires surface, frictionType kinetic|static and slip positive|negative; slip is the object’s relative slipping direction for kinetic friction or its impending tendency relative to the contact surface for static friction, not simply its velocity in the ground frame. The server draws friction opposite that direction. If tendency is unknown, do not guess a friction recipe. kind tension|applied|drag|spring|electric|magnetic|buoyancy instead requires angleDeg (0..360 counter-clockwise from world +x). Tension points along the taut string away from the body; drag opposes relative motion through the fluid. Do not add arbitrary fields or numeric magnitudes. For multiple contacts/bodies, curved geometry or out-of-plane fields that this recipe cannot express, use the existing primitive diagram schema with clearly separated bodies/labels, not a misleading single-surface recipe.',
  ].join('\n')
}
