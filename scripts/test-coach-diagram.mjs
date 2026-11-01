import assert from 'node:assert/strict'

import {
  COACH_DIAGRAM_FORMAT,
  createCoachDiagramStream,
  sanitizeCoachDiagramAnswer,
  validateCoachDiagram,
} from '../server/coachDiagram.js'

const validDiagram = {
  version: COACH_DIAGRAM_FORMAT,
  title: 'Force diagram',
  description: 'Illustrative free-body diagram, not to scale.',
  width: 400,
  height: 260,
  elements: [
    { type: 'rect', x: 150, y: 100, width: 100, height: 60, label: 'block' },
    { type: 'line', x1: 200, y1: 100, x2: 200, y2: 30, arrow: true, label: 'N' },
    { type: 'circle', cx: 80, cy: 80, r: 20, label: 'pivot' },
    { type: 'polyline', points: [[20, 220], [100, 180], [180, 220]] },
    { type: 'text', x: 20, y: 20, text: 'not to scale' },
  ],
}

assert.deepEqual(validateCoachDiagram(validDiagram), validDiagram)
assert.throws(() => validateCoachDiagram({ ...validDiagram, version: 'other' }), /version/i)
assert.throws(() => validateCoachDiagram({ ...validDiagram, width: 801 }), /width/i)
assert.throws(() => validateCoachDiagram({ ...validDiagram, unknown: true }), /field/i)
assert.throws(() => validateCoachDiagram({ ...validDiagram, elements: [{ type: 'text', x: 1, y: 1, text: '<script>' }] }), /unsafe/i)
assert.throws(() => validateCoachDiagram({ ...validDiagram, elements: [{ type: 'text', x: 1, y: 1, text: 'https://example.com' }] }), /unsafe/i)
assert.throws(() => validateCoachDiagram({ ...validDiagram, elements: [{ type: 'line', x1: 0, y1: 0, x2: 401, y2: 2 }] }), /bounds/i)
assert.throws(() => validateCoachDiagram({ ...validDiagram, elements: Array.from({ length: 61 }, () => ({ type: 'text', x: 1, y: 1, text: 'x' })) }), /60/)
assert.throws(() => validateCoachDiagram({ ...validDiagram, elements: [{ type: 'polyline', points: Array.from({ length: 101 }, () => [1, 1]) }] }), /100/)
assert.throws(() => validateCoachDiagram({ ...validDiagram, elements: Array.from({ length: 13 }, () => ({ type: 'polyline', points: Array.from({ length: 100 }, () => [1, 1]) })) }), /1200/)
assert.throws(() => validateCoachDiagram({ ...validDiagram, description: '   ' }), /description/)

const fence = `\`\`\`stem-diagram\n${JSON.stringify(validDiagram)}\n\`\`\``
const expected = `Before\n\n${fence}\n\nAfter`
for (let split = 0; split <= expected.length; split += 1) {
  const stream = createCoachDiagramStream({ enabled: true })
  const output = stream.push(expected.slice(0, split)) + stream.push(expected.slice(split)) + stream.finish()
  assert.equal(output, expected, `diagram stream split ${split}`)
}

assert.equal(
  sanitizeCoachDiagramAnswer(expected, { enabled: false }),
  'Before\n\n\n\nAfter',
  'old clients must never receive structured diagram JSON',
)
assert.equal(
  sanitizeCoachDiagramAnswer(`Before\n\n\`\`\`stem-diagram\n{"version":"broken"}\n\`\`\`\nAfter`, { enabled: true }),
  'Before\n\n\nAfter',
  'invalid diagrams must fail closed',
)
assert.equal(
  sanitizeCoachDiagramAnswer(`Before\n\n\`\`\`stem-diagram\n${JSON.stringify(validDiagram)}`, { enabled: true }),
  'Before\n\n',
  'incomplete diagram fences must fail closed',
)
assert.equal(
  sanitizeCoachDiagramAnswer(`Before ${JSON.stringify(validDiagram)} After`, { enabled: false }),
  'Before  After',
  'unfenced diagram JSON must never reach old clients',
)
assert.equal(
  sanitizeCoachDiagramAnswer('Keep ordinary {"kind":"evidence","value":2} JSON.', { enabled: false }),
  'Keep ordinary {"kind":"evidence","value":2} JSON.',
  'ordinary non-diagram JSON must remain visible',
)

console.log('Coach diagram schema and streaming tests passed.')
