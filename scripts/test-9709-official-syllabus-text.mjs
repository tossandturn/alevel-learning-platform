import assert from 'node:assert/strict'

import { cambridge9709SyllabusForRoute } from '../src/data/syllabus/cambridge-9709-2026-2027.js'

const syllabus = cambridge9709SyllabusForRoute('official-text-audit', [1, 2, 3, 4, 5, 6])
const topicByCode = new Map(syllabus.topics.map((topic) => [topic.code, topic]))

function point(sectionCode, outcomeNumber) {
  const topic = topicByCode.get(sectionCode)
  assert.ok(topic, `Official section ${sectionCode} must exist`)
  const result = topic.points.find((item) => item.outcomeNumber === outcomeNumber)
  assert.ok(result, `Official section ${sectionCode} outcome ${outcomeNumber} must exist`)
  return result
}

function assertNoteIncludes(sectionCode, outcomeNumber, expected) {
  assert.ok(
    point(sectionCode, outcomeNumber).officialNotes.some((note) => note.includes(expected)),
    `Official section ${sectionCode} outcome ${outcomeNumber} notes must include: ${expected}`,
  )
}

assert.equal(syllabus.topics.length, 38, 'Official 9709 subject content must retain 38 sections')
assert.equal(syllabus.points.length, 153, 'Official notes must not be counted as outcomes')

assert.equal(
  point('1.1', 1).officialText,
  'carry out the process of completing the square for a quadratic polynomial ax^2 + bx + c and use a completed square form',
)
assert.equal(
  point('1.1', 2).officialText,
  'find the discriminant of a quadratic polynomial ax^2 + bx + c and use the discriminant',
)

assertNoteIncludes('1.5', 4, 'in proving identities, simplifying expressions and solving equations')
assertNoteIncludes('1.7', 1, 'the chord joining the points with x coordinates 2 and (2 + h) on the curve y = x^3')
assertNoteIncludes('1.7', 3, 'given the rate of increase of the radius of a circle')
assertNoteIncludes('1.7', 4, 'alternatives may be used in questions where no method is specified')

assert.equal(
  point('3.7', 4).officialText,
  'understand the significance of all the symbols in the vector equation of a straight line, and find the equation of a line given sufficient information',
)
assertNoteIncludes('3.9', 6, 'the square roots of 5 + 12i in exact Cartesian form')

assert.equal(
  point('4.2', 2).officialText,
  'sketch and interpret displacement-time graphs and velocity-time graphs, and in particular appreciate that the area under a velocity-time graph represents displacement, the gradient of a displacement-time graph represents velocity, and the gradient of a velocity-time graph represents acceleration',
)
assert.equal(
  point('4.5', 1).officialText,
  'understand the concept of the work done by a force, and calculate the work done by a constant force when its point of application undergoes a displacement not necessarily parallel to the force',
)
assert.equal(
  point('4.5', 5).officialText,
  'solve problems involving, for example, the instantaneous acceleration of a car moving on a hill against a resistance',
)

assert.ok(point('5.1', 5).officialText.includes('either from the data itself or from given totals'))
assert.ok(point('5.1', 5).officialText.includes('coded totals'))
assert.ok(point('5.1', 5).officialText.includes('up to two data sets'))

assert.ok(point('5.5', 2).officialText.includes('finding the value of P(X > x1), or a related probability'))
assert.ok(point('5.5', 2).officialText.includes('finding a relationship between x1, mu and sigma'))
assertNoteIncludes('5.5', 2, 'Z = (X - mu) / sigma')

assert.ok(point('6.5', 2).officialText.includes('using direct evaluation of probabilities'))
assert.ok(point('6.5', 2).officialText.includes('a normal approximation to the binomial or the Poisson distribution'))
assert.equal(
  point('6.5', 5).officialText,
  'calculate the probabilities of making Type I and Type II errors in specific situations involving tests based on a normal distribution or direct evaluation of binomial or Poisson probabilities',
)

const componentScope = new Map(syllabus.componentScope.map((scope) => [scope.component, scope.notes]))
assert.deepEqual(componentScope.get(1), [], 'Paper 1 has no official component preamble on page 19')
assert.ok(componentScope.get(2).includes('Knowledge of the content for Paper 1: Pure Mathematics 1 is assumed, and candidates may be required to demonstrate such knowledge in answering questions.'))
assert.ok(componentScope.get(3).includes('Knowledge of the content of Paper 1: Pure Mathematics 1 is assumed, and candidates may be required to demonstrate such knowledge in answering questions.'))
assert.ok(componentScope.get(4).includes('Knowledge of algebraic methods from the content for Paper 1: Pure Mathematics 1 is assumed.'))
assert.ok(componentScope.get(4).some((note) => note.includes("This content list refers to the equilibrium or motion of a 'particle'.")))
assert.ok(componentScope.get(5).some((note) => note.includes('Knowledge of the following probability notation is also assumed:')))
assert.ok(componentScope.get(6).includes('Knowledge of calculus within the content for Paper 3: Pure Mathematics 3 will also be assumed.'))

for (const notes of componentScope.values()) {
  assert.ok(!notes.some((note) => /foundational|Knowledge of Paper 1 algebra/i.test(note)), 'Product summaries must not be exposed as official component notes')
}

console.log('9709 official syllabus text regression passed')
