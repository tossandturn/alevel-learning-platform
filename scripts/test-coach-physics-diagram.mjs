import assert from 'node:assert/strict'
import { compilePhysicsDiagram } from '../server/coachPhysicsDiagram.js'
import { validateCoachDiagram, sanitizeCoachDiagramAnswer, createCoachDiagramStream } from '../server/coachDiagram.js'
import { buildCoachSystemPrompt, resolveCoachRequestPolicy } from '../server/coachPolicy.js'
import {resolveCoachDiagramIntent} from '../server/coachDiagramConsent.js'

const base = {
  version: 'stem-force-v1', title: '受力图', body: 'block',
  description: '物块相对斜面向下滑动。', axes: 'surface',
  surface: { angleDeg: 30, label: 'ramp', contactSide: 'above' },
  forces: [
    { kind: 'weight', label: 'mg', source: '地球对物块的重力' },
    { kind: 'normal', label: 'N', source: '物块与斜面保持接触' },
    { kind: 'friction', label: 'f', source: '粗糙斜面；物块相对斜面下滑', slip: 'negative', frictionType: 'kinetic' },
  ],
}
const result = compilePhysicsDiagram(base)
assert.equal(result.version, 'stem-diagram-v1')
assert.deepEqual(validateCoachDiagram(result), result)
const arrow = label => result.elements.find(e => e.type === 'line' && e.arrow && e.label === label)
const vector = e => [e.x2 - e.x1, e.y1 - e.y2]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1]
const mg = vector(arrow('mg')), normal = vector(arrow('N')), friction = vector(arrow('f'))
assert.ok(Math.abs(mg[0]) < .01 && mg[1] < 0, 'weight must remain vertical, not perpendicular to an incline')
assert.ok(normal[0] < 0 && normal[1] > 0)
assert.ok(Math.abs(dot(normal, friction)) < .05, 'normal must be perpendicular to the contact plane')
assert.ok(friction[0] > 0 && friction[1] > 0, 'kinetic friction opposes down-slope relative slip')
assert.match(result.description, /not to scale/)
assert.ok(result.elements.some(e => e.type === 'text' && e.text.includes('30°')))
assert.ok(result.elements.some(e => e.label === '+x'))
assert.ok(!JSON.stringify(result).includes('source'), 'internal recipe must not be emitted as client metadata')

const freeFall = compilePhysicsDiagram({ ...base, surface: undefined, axes: 'horizontal', forces: [base.forces[0]] })
assert.equal(freeFall.elements.filter(e => e.type === 'line' && e.arrow && !/^[+]?[xy]$/.test(e.label || '')).length, 1, 'compiler must not infer contact, normal or drag')
assert.throws(() => compilePhysicsDiagram({ ...base, surface: undefined }), /surface/i)
assert.throws(() => compilePhysicsDiagram({ ...base, axes: 'unknown' }), /axes/i)
for (const force of [
  { kind: 'normal', label: 'N', source: 'contact', angleDeg: 90 },
  { kind: 'weight', label: 'mg', source: 'gravity', angleDeg: 30 },
  { kind: 'friction', label: 'f', source: 'rough' },
  { kind: 'friction', label: 'f', source: 'rough', slip: 'unknown', frictionType: 'static' },
  { kind: 'friction', label: 'f', source: 'rough', slip: 'positive', frictionType: 'invented' },
  { kind: 'resultant', label: 'F', source: 'sum', angleDeg: 0 },
  { kind: 'acceleration', label: 'a', source: 'motion', angleDeg: 0 },
  { kind: 'weight-component', label: 'mg sin θ', source: 'sum', angleDeg: 0 },
  { kind: 'applied', label: 'P', source: 'push', angleDeg: Infinity },
  { kind: 'tension', label: 'T', source: '', angleDeg: 90 },
  { kind: 'weight', label: '<img>', source: 'gravity' },
]) assert.throws(() => compilePhysicsDiagram({ ...base, forces: [force] }), /force|source|unsupported|slip|friction|unsafe/i)
assert.throws(() => compilePhysicsDiagram({ ...base, surface: { angleDeg: 91, label: 'ramp', contactSide: 'above' } }), /surface/i)
assert.throws(() => compilePhysicsDiagram({ ...base, forces: [] }), /forces/i)
assert.throws(() => compilePhysicsDiagram({ ...base, forces: Array(7).fill(base.forces[0]) }), /forces/i)
assert.throws(() => compilePhysicsDiagram({ ...base, forces: [base.forces[0], base.forces[0]] }), /duplicate/i)
const upwards = compilePhysicsDiagram({ ...base, forces: [{ ...base.forces[2], slip: 'positive' }] })
const fUp = vector(upwards.elements.find(e => e.label === 'f'))
assert.ok(fUp[0] < 0 && fUp[1] < 0)
const ceiling = compilePhysicsDiagram({ ...base, surface: { ...base.surface, angleDeg: 0, contactSide: 'below' }, forces: [base.forces[1]] })
assert.ok(vector(ceiling.elements.find(e => e.label === 'N'))[1] < 0, 'normal acts away from the surface even when contact is underneath')
const tension = compilePhysicsDiagram({ ...base, surface: undefined, axes: 'none', forces: [{ kind: 'tension', label: 'T', source: 'taut string at 45 degrees above horizontal', angleDeg: 45 }] })
const tv = vector(tension.elements.find(e => e.label === 'T'))
assert.ok(tv[0] > 0 && tv[1] > 0 && Math.abs(tv[0] - tv[1]) < .01)

const fence = value => '```stem-diagram\n' + JSON.stringify(value) + '\n```'
const answer = '先隔离物块。\n' + fence(base) + '\n沿斜面列式。'
const expected = '先隔离物块。\n' + fence(result) + '\n沿斜面列式。'
assert.equal(sanitizeCoachDiagramAnswer(answer, { enabled: true }), expected)
assert.equal(sanitizeCoachDiagramAnswer(answer), '先隔离物块。\n\n沿斜面列式。')
for (let split = 0; split < answer.length; split += 1) {
  const stream = createCoachDiagramStream({ enabled: true })
  assert.equal(stream.push(answer.slice(0, split)) + stream.push(answer.slice(split)) + stream.finish(), expected)
}
assert.equal(sanitizeCoachDiagramAnswer('Keep text ' + JSON.stringify(base), { enabled: true }), 'Keep text ')
assert.equal(sanitizeCoachDiagramAnswer('Keep text\n' + fence({ ...base, forces: [{ kind: 'normal' }] }), { enabled: true }), 'Keep text\n')

for (const typedIntent of ['hint', 'worked-solution', 'check-work']) {
  const policy = resolveCoachRequestPolicy({ typedIntent })
  const diagramPolicy=resolveCoachDiagramIntent({diagramFormat:'stem-diagram-v1',diagramIntent:'draw'})
  const prompt = buildCoachSystemPrompt({ policy, diagramFormat: 'stem-diagram-v1', diagramPolicy, context: { subject: 'Physics' } })
  assert.match(prompt, /stem-force-v1/)
  assert.match(prompt, /free-body diagram/i)
  assert.match(prompt, /not.*invent|never.*invent/i)
  assert.match(prompt, /hint.*diagram|diagram.*hint/i)
}
assert.doesNotMatch(buildCoachSystemPrompt({}), /stem-force-v1/)
assert.doesNotMatch(buildCoachSystemPrompt({diagramFormat:'stem-diagram-v1'}),/stem-force-v1/,'capability alone leaves the first prompt text-only')
console.log('PASS physics diagrams: semantic geometry, missing-evidence rejection, hint policy, old-client output and split streams')
